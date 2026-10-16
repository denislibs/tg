package auth

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

// ErrQRUnavailable is returned when QR login is requested but no QRStore is
// configured (e.g. Redis is down).
var ErrQRUnavailable = errors.New("qr login unavailable")

// ErrPhoneNumberInvalid — в номере после нормализации не осталось ни одной
// цифры (Telegram PHONE_NUMBER_INVALID, tweb SignInCard.tsx:136-141). Своего
// порога длины нет: форму номера сверх «есть цифры» сервер не проверяет.
var ErrPhoneNumberInvalid = errors.New("phone number invalid")

const codeTTL = 5 * time.Minute

type Interactor struct {
	users      UserRepo
	devices    DeviceRepo
	codes      CodeRepo
	pw         PasswordRepo
	steps      LoginStepRepo // одноразовые токены шагов входа (регистрация/восстановление/веб-токен)
	devCode    string
	logf       func(string, ...any)
	cache      SessionCache       // optional
	revoker    RevocationNotifier // optional
	qr         QRStore            // optional
	svc        ServiceNotifier    // optional
	geo        GeoResolver        // optional
	premium    PremiumRepo        // optional
	mail       Mailer             // optional: доставка кода восстановления на почту
	pub        EventPublisher     // optional: realtime user_update fan-out
	partners   PartnersFunc       // optional: user_update recipient set (shared-chat peers)
	partnersIn PartnersAmongFunc  // optional: «кто из этих — партнёр» одним запросом (AnnounceUserTo)
	updates    UpdateLog          // optional: per-user update log for user_update (dense pts)
	emit       *ownsync.Emitter   // optional: строки «новый вход» (updateNewAuthorization) в журнал своих устройств
	previews   AvatarPreviewer    // optional: stripped-превью аватарки при её установке
	squarer    AvatarSquarer      // optional: квадрат неквадратной аватарки
	media      MediaReader        // обязателен для фото профиля: проверка «файл свой»
	privacy    PrivacyChecker     // optional: видимость фото профиля в кадре user_update
	contacts   ContactViewer      // optional: имя из книги получателя в кадре user_update
	pwFails    *failCounter       // счётчик неудачных попыток пароля на password_token
	recFails   *failCounter       // счётчик неудачных кодов восстановления на password_token
	// authorLocks — замок на владельца карточки (по id): строки user_update
	// одного пользователя пишутся последовательно, см. sendUserUpdate.
	authorLocks keyedLock
	// resetWait — окно ожидания отложенного сброса аккаунта; 0 = дефолт (неделя).
	resetWait time.Duration
	// now — часы usecase (правило свежей сессии); в тестах подменяются.
	now func() time.Time
}

// EventPublisher pushes a realtime WS frame to a user's connected sessions.
// Optional (wired to the Redis publisher when available); mirrors the chat
// usecase's publisher. Used to broadcast user_update on profile changes.
type EventPublisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// PartnersFunc returns the ids of users who share at least one chat with the
// given user — the user_update fan-out set. Wired to the chat usecase's
// ChatPartners, the same source presence fan-out uses.
type PartnersFunc func(ctx context.Context, userID int64) ([]int64, error)

// PartnersAmongFunc отвечает, какие из candidates — партнёры userID (то же
// отношение, что у PartnersFunc), одним точечным запросом на кандидатов, без
// выборки всех партнёров.
type PartnersAmongFunc func(ctx context.Context, userID int64, candidates []int64) ([]int64, error)

// PrivacyChecker — шов к usecase/privacy. Check отвечает, видит ли viewer
// аспект key владельца ownerID (галерея фото профиля). Кадр user_update несёт
// конструктор `user`, и аватарку с СТАТУСОМ в нём решают AccessRules и
// PresenceOf. Не подключён — фото в кадре нет вовсе (безопасная деградация:
// клиент дочитает карточку ручкой), статус не едет.
//
// AccessRules — правила фото, номера и last_seen (и блок) для ids глазами
// viewerID (privacy.AccessRules), PresenceOf — присутствие ids (privacy.PresenceOf):
// из них кадр user_update берёт аватарку и СТАТУС. Кадр заменяет карточку в кэше
// клиента целиком, и без `status` он стирал бы у получателя живое присутствие.
type PrivacyChecker interface {
	Check(ctx context.Context, ownerID, viewerID int64, key domain.PrivacyKey) (bool, error)
	AccessRules(ctx context.Context, viewerID int64, ids []int64) (domain.UserViewRules, error)
	PresenceOf(ctx context.Context, ids []int64) func(int64) domain.UserStatus
}

// ContactViewer — как книги зрителей видят пользователя userID: viewerID →
// domain.ContactView (у кого связи нет — ключа нет). Кадр user_update несёт
// конструктор `user` ГЛАЗАМИ ПОЛУЧАТЕЛЯ (domain.UserReal.SeenBy): без этого
// смена профиля затирала бы у получателя имя, под которым он сохранил автора.
// Не подключён — имена профильные.
type ContactViewer interface {
	ContactViews(ctx context.Context, userID int64, viewerIDs []int64) (map[int64]domain.ContactView, error)
}

// UpdateLog appends one row to a user's per-user update log and returns the new
// dense pts (same contract as the chat usecase's UpdateRepo.AppendUpdate). A
// profile change logs user_update to every recipient (own devices + shared-chat
// peers) so getDifference catch-up replays it and the pts cursor stays dense. Optional —
// no-op when unwired (tests / no-DB setups).
type UpdateLog interface {
	AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error)
}

// GeoResolver turns an IP into a human place ("Москва, Россия") and into an ISO
// 3166-1 alpha-2 country code ("RU"). Backed by a MaxMind GeoLite2 lookup;
// optional, so auth runs without it (both return "").
type GeoResolver interface {
	Locate(ip string) string
	Country(ip string) string
}

// ServiceNotifier delivers a system message into a user's official-service chat.
// Wired to the chat usecase; optional so auth can run without it.
type ServiceNotifier interface {
	PostServiceMessage(ctx context.Context, userID int64, text string) error
}

// ClientInfo describes the device/browser that signed in, for the login alert.
// Populated by the delivery layer from the request (User-Agent, IP) and carried
// to the usecase via the request context (see WithClientInfo).
type ClientInfo struct {
	Device   string // high-level kind, e.g. "QR-код" (else derived from browser/OS)
	Browser  string // "Chrome", "Safari", …
	OS       string // "macOS", "Windows", "Android", …
	IP       string
	Location string // human place, when a GeoIP lookup is available (else empty)
	// AppVersion — версия сборки клиента, как он сам себя назвал при входе.
	// Своей у сервера нет: клиент раздаётся отдельно и обновляется отдельно.
	AppVersion string
}

type clientInfoKey struct{}

// WithClientInfo attaches sign-in client details to the context (delivery layer).
func WithClientInfo(ctx context.Context, ci ClientInfo) context.Context {
	return context.WithValue(ctx, clientInfoKey{}, ci)
}

func clientInfoFromContext(ctx context.Context) ClientInfo {
	ci, _ := ctx.Value(clientInfoKey{}).(ClientInfo)
	return ci
}

// NearestCountry — страна, из которой пришёл клиент, ISO 3166-1 alpha-2 в
// верхнем регистре (Telegram help.getNearestDc.country): экран входа
// преднастраивает по ней выбор страны в поле телефона.
//
// IP берётся из ClientInfo в контексте — тот же механизм, что наполняет
// местоположение сессии на экране активных сеансов. Определить не удалось (нет
// базы GeoIP, нет IP, приватный/петлевой адрес, нет записи) — это НЕ ошибка:
// возвращается "", клиент оставляет свой выбор по умолчанию.
func (i *Interactor) NearestCountry(ctx context.Context) string {
	if i.geo == nil {
		return ""
	}
	ip := clientInfoFromContext(ctx).IP
	if ip == "" {
		return ""
	}
	return i.geo.Country(ip)
}

// buildLoginText composes the "new login" service message from whatever client
// details we have (fields are omitted when unknown).
func buildLoginText(ci ClientInfo) string {
	var b strings.Builder
	b.WriteString("🔐 Новый вход в аккаунт\n\nВыполнен вход с нового устройства.")
	if ci.Device != "" {
		b.WriteString("\n\nСпособ: " + ci.Device)
	}
	app := ci.Browser
	if app != "" && ci.OS != "" {
		app += " · " + ci.OS
	} else if app == "" {
		app = ci.OS
	}
	if app != "" {
		b.WriteString("\nПриложение: " + app)
	}
	if ci.Location != "" {
		b.WriteString("\nМесто: " + ci.Location)
	}
	if ci.IP != "" {
		b.WriteString("\nIP-адрес: " + ci.IP)
	}
	b.WriteString("\n\nЕсли это были вы — всё в порядке. Если нет — завершите этот сеанс в Настройках → Устройства и смените код доступа.")
	return b.String()
}

func New(users UserRepo, devices DeviceRepo, codes CodeRepo, pw PasswordRepo, steps LoginStepRepo, devCode string, logf func(string, ...any)) *Interactor {
	return &Interactor{
		users: users, devices: devices, codes: codes, pw: pw, steps: steps,
		devCode: devCode, logf: logf,
		pwFails: newFailCounter(), recFails: newFailCounter(),
		now: time.Now,
	}
}

func (i *Interactor) SetCache(c SessionCache)                    { i.cache = c }
func (i *Interactor) SetServiceNotifier(n ServiceNotifier)       { i.svc = n }
func (i *Interactor) SetGeoResolver(g GeoResolver)               { i.geo = g }
func (i *Interactor) SetRevocationNotifier(n RevocationNotifier) { i.revoker = n }
func (i *Interactor) SetQRStore(q QRStore)                       { i.qr = q }
func (i *Interactor) SetPremiumRepo(p PremiumRepo)               { i.premium = p }
func (i *Interactor) SetMailer(m Mailer)                         { i.mail = m }
func (i *Interactor) SetPublisher(p EventPublisher)              { i.pub = p }
func (i *Interactor) SetPartners(f PartnersFunc)                 { i.partners = f }
func (i *Interactor) SetPartnersAmong(f PartnersAmongFunc)       { i.partnersIn = f }
func (i *Interactor) SetUpdateLog(u UpdateLog)                   { i.updates = u }
func (i *Interactor) SetEmitter(e *ownsync.Emitter)              { i.emit = e }
func (i *Interactor) SetAvatarPreviewer(p AvatarPreviewer)       { i.previews = p }
func (i *Interactor) SetAvatarSquarer(s AvatarSquarer)           { i.squarer = s }
func (i *Interactor) SetMediaReader(m MediaReader)               { i.media = m }
func (i *Interactor) SetPrivacy(p PrivacyChecker)                { i.privacy = p }
func (i *Interactor) SetContactViewer(c ContactViewer)           { i.contacts = c }

// SetAccountResetWindow задаёт окно ожидания отложенного сброса аккаунта
// (ACCOUNT_RESET_WAIT). Неположительное значение оставляет дефолт — неделю.
func (i *Interactor) SetAccountResetWindow(d time.Duration) { i.resetWait = d }

func (i *Interactor) RequestCode(ctx context.Context, rawPhone string) error {
	phone := domain.NormalizePhone(rawPhone)
	if domain.PhoneDigits(rawPhone) == "" {
		return ErrPhoneNumberInvalid
	}
	if err := i.codes.SaveCode(ctx, phone, i.devCode, time.Now().Add(codeTTL)); err != nil {
		return err
	}
	// Значение кода НЕ логируем (утечка OTP в логи, если devCode заменят реальной
	// доставкой). В dev код статичен — DEV_OTP_CODE (12345).
	i.logf("[otp] requested for phone=%s", phone)
	return nil
}

type SignInResult struct {
	Token string
	User  domain.UserRecord
	// Облачный пароль включён: вместо сессии выдан одноразовый PasswordToken —
	// клиент завершает вход через CheckPassword (Telegram SESSION_PASSWORD_NEEDED).
	PasswordNeeded bool
	PasswordToken  string
	Hint           string
	// Номер подтверждён, но аккаунта с ним нет: вместо сессии выдан одноразовый
	// SignUpToken — клиент показывает форму имени и зовёт SignUp
	// (Telegram auth.authorizationSignUpRequired).
	SignUpRequired bool
	SignUpToken    string
	// Device — строка сессии, созданная mintSession (devices.Create). Нужна тем,
	// кто строит ответ из неё (QR: authorization новой сессии) или отзывает её.
	Device domain.Device
}

func (i *Interactor) SignIn(ctx context.Context, rawPhone, suppliedCode, deviceName, platform string) (SignInResult, error) {
	phone := domain.NormalizePhone(rawPhone)
	stored, err := i.codes.GetCode(ctx, phone)
	if errors.Is(err, domain.ErrNotFound) {
		return SignInResult{}, domain.ErrInvalidCode
	}
	if err != nil {
		return SignInResult{}, err
	}
	if !domain.CodeMatches(stored, suppliedCode) {
		return SignInResult{}, domain.ErrInvalidCode
	}
	user, err := i.users.ByPhone(ctx, phone)
	if errors.Is(err, domain.ErrNotFound) {
		// Незнакомый номер: аккаунт НЕ создаём — отправляем на шаг регистрации.
		return i.startSignUp(ctx, phone)
	}
	if err != nil {
		return SignInResult{}, err
	}
	// Второй фактор: при включённом облачном пароле сессия не выдаётся — только
	// короткий токен для шага «введите пароль».
	if res, needed, err := i.startPasswordStep(ctx, user.ID, false); err != nil {
		return SignInResult{}, err
	} else if needed {
		_ = i.codes.DeleteCode(ctx, phone)
		return res, nil
	}
	res, err := i.mintSession(ctx, user, deviceName, platform, false)
	if err != nil {
		return SignInResult{}, err
	}
	_ = i.codes.DeleteCode(ctx, phone)
	return res, nil
}

// startPasswordStep выдаёт одноразовый password_token, если у пользователя
// включён облачный пароль. needed=false — пароля нет, вход продолжается сессией.
// Общий шаг для SignIn, SignImport, PasskeySignIn и QR. approved — вход одобрила
// уже вошедшая сессия (QR, веб-токен): признак сохраняется в токене и доходит до
// mintSession после ввода пароля (CheckPassword), иначе такой вход ложно спросил
// бы «это вы?».
func (i *Interactor) startPasswordStep(ctx context.Context, userID int64, approved bool) (SignInResult, bool, error) {
	if i.pw == nil {
		return SignInResult{}, false, nil
	}
	pwHash, hint, _, err := i.pw.Password(ctx, userID)
	if err != nil {
		// Сбой чтения — не «пароля нет»: иначе сбой БД отдавал бы вход без
		// второго фактора. Закрываемся (вход отвечает 500).
		return SignInResult{}, false, err
	}
	if pwHash == nil {
		return SignInResult{}, false, nil // пароля нет — обычный вход
	}
	pwToken, pwTokenHash, err := domain.GenerateToken()
	if err != nil {
		return SignInResult{}, false, err
	}
	if err := i.pw.SavePasswordToken(ctx, pwTokenHash, userID, time.Now().Add(passwordTokenTTL), approved); err != nil {
		return SignInResult{}, false, err
	}
	return SignInResult{PasswordNeeded: true, PasswordToken: pwToken, Hint: hint}, true, nil
}

// mintSession выдаёт новую сессию (строка devices + токен) и шлёт login-alert.
// Общий хвост всех путей входа.
//
// approved — вход одобрила уже вошедшая сессия (QR: AcceptLoginToken; веб-токен:
// его выпускает живая сессия). Такой вход спрашивать «это вы?» бессмысленно.
// Прочие пути (код, пароль, ключ доступа, восстановление, регистрация): если у
// аккаунта уже есть сессии, новая строка несёт unconfirmed, и остальные
// устройства получают updateNewAuthorization (tweb appAccountManager.ts:41-59,
// 277-294); у первой сессии аккаунта спросить некого.
func (i *Interactor) mintSession(ctx context.Context, user domain.UserRecord, deviceName, platform string, approved bool) (SignInResult, error) {
	token, hash, err := domain.GenerateToken()
	if err != nil {
		return SignInResult{}, err
	}
	// Строка сессии несёт реквизиты входа для экрана активных сеансов, и несёт
	// их РАЗДЕЛЬНО — как параметры `initConnection` у оригинала: браузер
	// (device_model), ОС (system_version), версия сборки клиента (app_version),
	// плюс IP и место по GeoIP, когда оно известно. Прежде браузер и ОС
	// склеивались в одну строку имени, и витрина сессий не могла отдать их
	// разными параметрами конструктора.
	ci := clientInfoFromContext(ctx)
	if ci.Location == "" && i.geo != nil && ci.IP != "" {
		ci.Location = i.geo.Locate(ci.IP)
	}
	// Имя, присланное клиентом, — только запасное: разбирать User-Agent должен
	// сервер (так же делает Telegram), иначе клиент назовётся как угодно.
	name := deviceName
	if ci.Browser != "" {
		name = ci.Browser
	}
	device := domain.Device{
		UserID:        user.ID,
		Name:          name,
		Platform:      platform,
		SystemVersion: ci.OS,
		AppVersion:    ci.AppVersion,
		TokenHash:     hash,
		IP:            ci.IP,
		Location:      ci.Location,
	}
	if !approved {
		// Проверяем ДО Create, иначе сама новая строка дала бы true. Сбой чтения
		// — отказ входа, а не «сессий нет»: иначе сбой БД молча глушил бы
		// уведомление о чужом входе.
		has, err := i.devices.HasSessions(ctx, user.ID)
		if err != nil {
			return SignInResult{}, err
		}
		device.Unconfirmed = has
	}
	created, err := i.devices.Create(ctx, device)
	if err != nil {
		return SignInResult{}, err
	}
	if created.Unconfirmed {
		i.emitOwnSessions(ctx, user.ID, domain.NewUpdateNewAuthorization(created))
	}
	// Владелец вошёл — чужая попытка сброса аккаунта снимается. Общий хвост всех
	// веток входа: отмену вешаем здесь, а не в каждой из них.
	i.cancelAccountReset(ctx, user.ID)
	i.notifyLogin(user.ID, ci)
	return SignInResult{Token: token, User: user, Device: created}, nil
}

// notifyLogin fires a best-effort "new login" service message. It runs detached
// (own context, goroutine) so a slow/failing notification never blocks or fails
// sign-in; the request context would also be cancelled once the response is sent.
func (i *Interactor) notifyLogin(userID int64, ci ClientInfo) {
	if i.svc == nil {
		return
	}
	if ci.Location == "" && i.geo != nil && ci.IP != "" {
		ci.Location = i.geo.Locate(ci.IP)
	}
	text := buildLoginText(ci)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := i.svc.PostServiceMessage(ctx, userID, text); err != nil {
			i.logf("service login notification failed: %v", err)
		}
	}()
}

func (i *Interactor) Authenticate(ctx context.Context, token string) (domain.UserRecord, int64, error) {
	hash := domain.HashToken(token)
	if i.cache != nil {
		if s, err := i.cache.GetSession(ctx, hash); err == nil && s != nil {
			return s.User, s.DeviceID, nil
		}
	}
	// Версия сборки берётся из ClientInfo запроса (её кладёт AuthMiddleware) и
	// освежает строку устройства на промахе кэша — то есть не чаще раза в
	// SessionCacheTTL на сессию, а не на каждом запросе.
	user, deviceID, err := i.devices.SessionByTokenHash(ctx, hash, clientInfoFromContext(ctx).AppVersion)
	if err != nil {
		return domain.UserRecord{}, 0, err
	}
	if i.cache != nil {
		_ = i.cache.SetSession(ctx, hash, domain.Session{User: user, DeviceID: deviceID}, SessionCacheTTL)
	}
	return user, deviceID, nil
}

// ExportResult — исход auth.exportLoginToken; ровно одно поле не пустое.
type ExportResult struct {
	Pending  *QRPendingCode // код ждёт подтверждения: показать QR
	Session  *SignInResult  // вход окончен: Token + User
	Password *SignInResult  // облачный пароль: PasswordNeeded, PasswordToken, Hint
}

// QRPendingCode — выпущенный код: hex 64 (он же в QR) и момент протухания.
type QRPendingCode struct {
	Token     string
	ExpiresAt time.Time
}

// qrClientInfo переводит реквизиты экспортёра в ClientInfo для mintSession.
func qrClientInfo(c domain.QRClient) ClientInfo {
	return ClientInfo{
		Device: "QR-код", Browser: c.Browser, OS: c.OS,
		IP: c.IP, Location: c.Location, AppVersion: c.AppVersion,
	}
}

// ExportLoginToken — auth.exportLoginToken. keyHash — sha256 ключа входа
// (заголовок X-Login-Key): запись и право забрать сессию принадлежат ему, а не
// самому коду, который нарисован в QR и виден любому. Клиентские реквизиты
// (браузер/ОС/IP) берутся из ctx (WithClientInfo).
func (i *Interactor) ExportLoginToken(ctx context.Context, keyHash string, exceptIDs []int64, platform string) (ExportResult, error) {
	if i.qr == nil {
		return ExportResult{}, ErrQRUnavailable
	}
	// Несколько попыток: запись могла протухнуть между проигранным NX и чтением,
	// а ждущая запись — дожить до своего срока раньше TTL хранилища.
	for attempt := 0; attempt < 3; attempt++ {
		rec, err := i.qr.GetByKey(ctx, keyHash)
		if err == nil && rec.Status == domain.QRPending && !time.Now().Before(rec.ExpiresAt) {
			_ = i.qr.DeleteByKey(ctx, keyHash) // отдавать код с expires <= now нельзя
			err = domain.ErrNotFound
		}
		if errors.Is(err, domain.ErrNotFound) {
			token, tokenHash, err := domain.GenerateToken()
			if err != nil {
				return ExportResult{}, err
			}
			ci := clientInfoFromContext(ctx)
			rec = domain.QRLogin{
				Token: token, ExpiresAt: time.Now().Add(QRLoginTTL), Status: domain.QRPending,
				ExceptIDs: exceptIDs, Platform: platform,
				Client: domain.QRClient{Browser: ci.Browser, OS: ci.OS, IP: ci.IP, Location: ci.Location, AppVersion: ci.AppVersion},
			}
			created, err := i.qr.Create(ctx, keyHash, tokenHash, rec, QRLoginTTL)
			if err != nil {
				return ExportResult{}, err
			}
			if created {
				return ExportResult{Pending: &QRPendingCode{Token: rec.Token, ExpiresAt: rec.ExpiresAt}}, nil
			}
			continue // проиграли гонку двух первых опросов: берём чужую запись
		}
		if err != nil {
			return ExportResult{}, err
		}
		return i.exportFromRecord(ctx, keyHash, rec)
	}
	return ExportResult{}, domain.ErrNotFound
}

// exportFromRecord — исход экспорта по существующей записи ключа. Подтверждённая
// запись НЕ удаляется при чтении, а живёт до TTL: секрет — сам ключ входа, и
// повторное чтение им безопасно; потерянный ответ (обрыв сети, 502) иначе
// оставил бы выпущенную сессию без получателя.
func (i *Interactor) exportFromRecord(ctx context.Context, keyHash string, rec domain.QRLogin) (ExportResult, error) {
	switch rec.Status {
	case domain.QRConfirmed:
		return ExportResult{Session: &SignInResult{Token: rec.SessionToken, User: rec.User}}, nil
	case domain.QRPasswordNeeded:
		res, needed, err := i.startPasswordStep(ctx, rec.UserID, true)
		if err != nil {
			_ = i.qr.DeleteByKey(ctx, keyHash)
			return ExportResult{}, err
		}
		if needed {
			// Шаг пароля выдаётся ОДИН раз: каждый опрос выпускал бы новый
			// password_token со своими пятью попытками, и перебор пароля обходил бы
			// лимит попыток на токен. Потерянный ответ здесь — не потеря сессии
			// (её нет): карточка получит новый код и сканирование повторится.
			_ = i.qr.DeleteByKey(ctx, keyHash)
			return ExportResult{Password: &res}, nil
		}
		// Пароль сняли, пока экспортёр не опросил: пароля больше нет — сессия.
		u, err := i.users.GetByID(ctx, rec.UserID)
		if err != nil {
			_ = i.qr.DeleteByKey(ctx, keyHash)
			return ExportResult{}, err
		}
		res, err = i.mintSession(ctx, u, "QR login", rec.Platform, true)
		if err != nil {
			_ = i.qr.DeleteByKey(ctx, keyHash)
			return ExportResult{}, err
		}
		// Запись становится подтверждённой: повторный опрос отдаст ту же сессию,
		// а не выпустит вторую.
		rec.Status, rec.SessionToken, rec.User = domain.QRConfirmed, res.Token, u
		if err := i.qr.PutByKey(ctx, keyHash, rec, QRLoginTTL); err != nil {
			_, _ = i.RevokeSession(ctx, u.ID, res.Device.ID)
			_ = i.qr.DeleteByKey(ctx, keyHash)
			return ExportResult{}, err
		}
		return ExportResult{Session: &res}, nil
	default:
		return ExportResult{Pending: &QRPendingCode{Token: rec.Token, ExpiresAt: rec.ExpiresAt}}, nil
	}
}

// AcceptLoginToken — auth.acceptLoginToken: уже вошедшее устройство подтверждает
// код, показанный экспортёром. Сессия выпускается экспортёру (он заберёт её по
// своему ключу входа), а не подтверждающему. Любой отказ — ErrNotFound
// (AUTH_TOKEN_EXPIRED): код неизвестен, протух, принят, пользователь в
// except_ids экспортёра. Указатель кода снимается только на пути подтверждения —
// отказ чужому аккаунту не хоронит код для остальных.
func (i *Interactor) AcceptLoginToken(ctx context.Context, token string, user domain.UserRecord) (domain.Authorization, error) {
	if i.qr == nil {
		return domain.Authorization{}, ErrQRUnavailable
	}
	tokenHash := domain.HashToken(token)
	keyHash, err := i.qr.PeekToken(ctx, tokenHash)
	if err != nil {
		return domain.Authorization{}, err
	}
	rec, err := i.qr.GetByKey(ctx, keyHash)
	if err != nil {
		return domain.Authorization{}, err
	}
	// Ключ мог получить новый код — старый указатель тогда ничего не значит.
	if rec.Status != domain.QRPending || !time.Now().Before(rec.ExpiresAt) ||
		subtle.ConstantTimeCompare([]byte(rec.Token), []byte(token)) != 1 {
		return domain.Authorization{}, domain.ErrNotFound
	}
	if slices.Contains(rec.ExceptIDs, user.ID) {
		return domain.Authorization{}, domain.ErrNotFound
	}
	has, err := i.hasPassword(ctx, user.ID)
	if err != nil {
		return domain.Authorization{}, err
	}
	// Гонка двух Accept: GETDEL пропускает одного, проигравший получает 404.
	if _, err := i.qr.ClaimToken(ctx, tokenHash); err != nil {
		return domain.Authorization{}, err
	}
	if has {
		rec.Status = domain.QRPasswordNeeded
		rec.UserID = user.ID
		if err := i.qr.PutByKey(ctx, keyHash, rec, QRLoginTTL); err != nil {
			_ = i.qr.DeleteByKey(ctx, keyHash)
			return domain.Authorization{}, err
		}
		// Сессии ещё нет: второй фактор не пройден (cancelAccountReset и
		// notifyLogin не зовутся). Реквизиты — экспортёра; hash 0 здесь значит
		// «сессии нет», а не «текущая» (pFlags.current не ставится).
		now := time.Now()
		place := rec.Client.Location
		if place == "" && i.geo != nil && rec.Client.IP != "" {
			place = i.geo.Locate(rec.Client.IP) // как mintSession в ветке без пароля
		}
		out := domain.NewAuthorization(domain.Device{
			Name: rec.Client.Browser, Platform: rec.Platform, SystemVersion: rec.Client.OS,
			AppVersion: rec.Client.AppVersion, IP: rec.Client.IP, Location: place,
			CreatedAt: now, LastActive: now,
		}, false, now)
		out.PFlags["password_pending"] = true
		return out, nil
	}
	res, err := i.mintSession(WithClientInfo(ctx, qrClientInfo(rec.Client)), user, "QR login", rec.Platform, true)
	if err != nil {
		_ = i.qr.DeleteByKey(ctx, keyHash)
		return domain.Authorization{}, err
	}
	rec.Status = domain.QRConfirmed
	rec.SessionToken = res.Token
	rec.User = user
	if err := i.qr.PutByKey(ctx, keyHash, rec, QRLoginTTL); err != nil {
		// Токен сессии никому не дойдёт — сессию отзываем, чтобы она не висела.
		_, _ = i.RevokeSession(ctx, user.ID, res.Device.ID)
		_ = i.qr.DeleteByKey(ctx, keyHash)
		return domain.Authorization{}, err
	}
	return domain.NewAuthorization(res.Device, false, i.now()), nil
}

// hasPassword — включён ли у пользователя облачный пароль. Ошибка чтения —
// ошибка (не «нет пароля»): см. startPasswordStep.
func (i *Interactor) hasPassword(ctx context.Context, userID int64) (bool, error) {
	if i.pw == nil {
		return false, nil
	}
	h, _, _, err := i.pw.Password(ctx, userID)
	if err != nil {
		return false, err
	}
	return h != nil, nil
}
