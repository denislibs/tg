// Package privacy — настройки конфиденциальности (tweb Privacy and Security):
// правила «кто видит/может» по ключам + глобальный чёрный список. Центральная
// проверка Check используется чатом (писать/звонить/приглашать), presence
// (last seen), контактами (номер) и read-model'ями (фото профиля).
package privacy

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

// Repo — хранилище правил, блокировок и справок о контактах/пользователях.
type Repo interface {
	Rules(ctx context.Context, userID int64) ([]domain.PrivacyRuleRecord, error) // только сохранённые
	Upsert(ctx context.Context, userID int64, r domain.PrivacyRuleRecord) error
	Get(ctx context.Context, userID int64, key domain.PrivacyKey) (domain.PrivacyRuleRecord, error) // domain.ErrNotFound → дефолт

	Block(ctx context.Context, blockerID, blockedID int64) error
	Unblock(ctx context.Context, blockerID, blockedID int64) (bool, error)
	IsBlocked(ctx context.Context, blockerID, blockedID int64) (bool, error)
	BlockedList(ctx context.Context, userID int64, offset, limit int) ([]domain.BlockedUser, int, error)

	IsContact(ctx context.Context, ownerID, userID int64) (bool, error)
	// VisibleMap — батч-проверка одним запросом: для каждого owner из ownerIDs
	// решает, видит ли viewer его аспект key (правило + контактность + блок).
	VisibleMap(ctx context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error)
	// VisibleMaps — VisibleMap по нескольким ключам одним запросом.
	VisibleMaps(ctx context.Context, viewerID int64, ownerIDs []int64, keys ...domain.PrivacyKey) (map[domain.PrivacyKey]map[int64]bool, error)

	GetUser(ctx context.Context, id int64) (domain.UserRecord, error)
	// TTLPeriod — период автоудаления переписки ЗРИТЕЛЯ с этим пиром в
	// секундах (схемное userFull.ttl_period): auto_delete_period приватного
	// чата, а пока чата нет — глобальный дефолт зрителя, которым такой чат
	// заведётся. 0 — выключено.
	TTLPeriod(ctx context.Context, viewerID, targetID int64) (int, error)
	// ChatTheme — тема оформления переписки ЗРИТЕЛЯ с этим пиром
	// (userFull.theme_emoticon, решение Р7); "" — тема не задана. Прежде она
	// ехала полем КАЖДОЙ строки списка диалогов, хотя в схеме её место — полная
	// карточка.
	ChatTheme(ctx context.Context, viewerID, targetID int64) (string, error)
	// ContactCard — что зритель знает о пире по адресным книгам: пир в его
	// книге, он в книге пира, его заметка и личное фото для пира.
	ContactCard(ctx context.Context, viewerID, targetID int64) (domain.ContactCard, error)
	// PeerFullState — общие чаты, закреп и уведомления лички зрителя с пиром,
	// видимые зрителю подарки пира (userFull, A4-19).
	PeerFullState(ctx context.Context, viewerID, targetID int64) (domain.PeerFullState, error)
}

// UserAnnouncer пересылает карточку пользователя заново, когда её ВИД у
// получателей поменялся без правки записи (реализует usecase/auth).
type UserAnnouncer interface {
	// AnnounceUser — самому и всем партнёрам.
	AnnounceUser(ctx context.Context, userID int64) error
	// AnnounceUserTo — только названным зрителям из числа партнёров.
	AnnounceUserTo(ctx context.Context, userID int64, viewers []int64) error
}

// PresenceReannouncer пересылает статус присутствия заново (реализует
// usecase/presence).
type PresenceReannouncer interface {
	// Reannounce — всем партнёрам.
	Reannounce(ctx context.Context, userID int64) error
	// ReannounceTo — только названным зрителям из числа партнёров.
	ReannounceTo(ctx context.Context, userID int64, viewers []int64) error
}

type Interactor struct {
	repo        Repo
	presence    PresenceSnapshot    // optional: присутствие для user.status
	emit        *ownsync.Emitter    // optional: журнал своих устройств
	announcer   UserAnnouncer       // optional: пересчёт карточки у собеседников
	reannouncer PresenceReannouncer // optional: пересчёт статуса у собеседников (нужен Redis)
	// async запускает пересчёт у собеседников вне запроса: он идёт по всем
	// партнёрам с проверкой правила на каждого. Подменяется в тестах.
	async func(func())
}

func New(repo Repo) *Interactor {
	return &Interactor{repo: repo, async: func(f func()) { go f() }}
}

// SetEmitter подключает журнал своих устройств; без него мутация проходит, но
// второе устройство о ней не узнаёт.
func (i *Interactor) SetEmitter(e *ownsync.Emitter) { i.emit = e }

// SetAnnouncer подключает пересчёт карточки у собеседников.
func (i *Interactor) SetAnnouncer(a UserAnnouncer) { i.announcer = a }

// SetReannouncer подключает пересчёт статуса у собеседников.
func (i *Interactor) SetReannouncer(r PresenceReannouncer) { i.reannouncer = r }

// ErrBadRule — неизвестный ключ или недопустимое значение.
var ErrBadRule = errors.New("invalid privacy rule")

// ErrSelfBlock — попытка заблокировать себя.
var ErrSelfBlock = errors.New("cannot block yourself")

// Rules возвращает полный набор правил пользователя (несохранённые — дефолты).
func (i *Interactor) Rules(ctx context.Context, userID int64) ([]domain.PrivacyRuleRecord, error) {
	stored, err := i.repo.Rules(ctx, userID)
	if err != nil {
		return nil, err
	}
	byKey := make(map[domain.PrivacyKey]domain.PrivacyRuleRecord, len(stored))
	for _, r := range stored {
		byKey[r.Key] = r
	}
	out := make([]domain.PrivacyRuleRecord, 0, len(domain.PrivacyKeys))
	for _, k := range domain.PrivacyKeys {
		if r, ok := byKey[k]; ok {
			out = append(out, r)
		} else {
			out = append(out, domain.DefaultPrivacyRule(k))
		}
	}
	return out, nil
}

// Rule возвращает правило ОДНОГО ключа (несохранённое — дефолт).
//
// Спрашивают по одному ключу, как у оригинала (`account.getPrivacy`): ручки
// «все разом» на проводе больше нет, потому что у ответа `account.privacyRules`
// нет параметра ключа — его знает спросивший.
func (i *Interactor) Rule(ctx context.Context, userID int64, key domain.PrivacyKey) (domain.PrivacyRuleRecord, error) {
	rules, err := i.Rules(ctx, userID)
	if err != nil {
		return domain.PrivacyRuleRecord{}, err
	}
	for _, r := range rules {
		if r.Key == key {
			return r, nil
		}
	}
	return domain.DefaultPrivacyRule(key), nil
}

// SetRule валидирует и сохраняет правило одного ключа целиком. Мутация
// закоммичена до записи в журнал: сбой журнала или пересчёта ответ не портит
// (клиент получает результат ответом, второе устройство — при следующей
// синхронизации) и пишется в лог.
//
// Дальше: своим устройствам — строка updatePrivacy со снимком, перечитанным под
// блокировкой журнала; собеседникам — пересчёт того, что правило меняет у них
// на экране (tweb таких кадров не знает, но применяет любой updateUserStatus и
// любую карточку user — значит, сервер сам шлёт новый статус и карточку).
func (i *Interactor) SetRule(ctx context.Context, userID int64, r domain.PrivacyRuleRecord) (domain.PrivacyRuleRecord, error) {
	if !domain.ValidPrivacyKey(r.Key) || !domain.ValidPrivacyValue(r.Key, r.Value) {
		return domain.PrivacyRuleRecord{}, ErrBadRule
	}
	// Сам себе пользователь всегда «виден» — себя в списках не храним.
	r.AllowUserIDs = dropID(r.AllowUserIDs, userID)
	r.DenyUserIDs = dropID(r.DenyUserIDs, userID)
	if err := i.repo.Upsert(ctx, userID, r); err != nil {
		return domain.PrivacyRuleRecord{}, err
	}
	err := i.emit.EmitSnapshot(ctx, userID, "privacy_update", func(ctx context.Context) (map[string]any, error) {
		cur, err := i.repo.Get(ctx, userID, r.Key)
		if errors.Is(err, domain.ErrNotFound) {
			cur, err = domain.DefaultPrivacyRule(r.Key), nil
		}
		if err != nil {
			return nil, err
		}
		u, ok := domain.NewUpdatePrivacy(cur)
		if !ok {
			return nil, ErrBadRule
		}
		return bodyOf(u)
	})
	if err != nil {
		log.Printf("ownsync: privacy_update user=%d key=%s: %v", userID, r.Key, err)
	}
	i.recomputeForPeers(ctx, userID, r.Key)
	return r, nil
}

// recomputeForPeers — пересчёт у собеседников после смены правила: «был(а)»
// живёт в статусе присутствия, фото — в карточке user. Остальные ключи
// собеседники узнают при следующей загрузке профиля.
func (i *Interactor) recomputeForPeers(ctx context.Context, userID int64, key domain.PrivacyKey) {
	ctx = context.WithoutCancel(ctx)
	switch key {
	case domain.PrivacyLastSeen:
		if i.reannouncer != nil {
			i.async(func() {
				if err := i.reannouncer.Reannounce(ctx, userID); err != nil {
					log.Printf("privacy: reannounce user=%d: %v", userID, err)
				}
			})
		}
	case domain.PrivacyProfilePhoto:
		if i.announcer != nil {
			i.async(func() {
				if err := i.announcer.AnnounceUser(ctx, userID); err != nil {
					log.Printf("privacy: announce user=%d: %v", userID, err)
				}
			})
		}
	}
}

// bodyOf — тело строки журнала из конструктора домена (ownsync принимает карту
// с дискриминатором `_`).
func bodyOf(v any) (map[string]any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	return m, json.Unmarshal(raw, &m)
}

func dropID(ids []int64, id int64) []int64 {
	out := ids[:0]
	for _, v := range ids {
		if v != id {
			out = append(out, v)
		}
	}
	return out
}

// Check — центральный вопрос «viewer может видеть/делать key по отношению к
// owner?». Сам себе и служебному аккаунту — всегда можно; блокировка (owner
// заблокировал viewer) закрывает всё.
func (i *Interactor) Check(ctx context.Context, ownerID, viewerID int64, key domain.PrivacyKey) (bool, error) {
	if ownerID == viewerID || viewerID == domain.ServiceUserID || ownerID == domain.ServiceUserID {
		return true, nil
	}
	if blocked, err := i.repo.IsBlocked(ctx, ownerID, viewerID); err != nil {
		return false, err
	} else if blocked {
		return false, nil
	}
	rule, err := i.repo.Get(ctx, ownerID, key)
	if errors.Is(err, domain.ErrNotFound) {
		rule = domain.DefaultPrivacyRule(key)
	} else if err != nil {
		return false, err
	}
	isContact, err := i.repo.IsContact(ctx, ownerID, viewerID)
	if err != nil {
		return false, err
	}
	return rule.Allows(viewerID, isContact), nil
}

// VisibleMap — батч-версия Check для read-model'ей (аватарки списка чатов,
// онлайн участников): один SQL-запрос на пачку владельцев.
func (i *Interactor) VisibleMap(ctx context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error) {
	if len(ownerIDs) == 0 {
		return map[int64]bool{}, nil
	}
	return i.repo.VisibleMap(ctx, viewerID, ownerIDs, key)
}

// Block добавляет пользователя в чёрный список. Своим устройствам уходит
// updatePeerBlocked; заблокированному — не он, а пересчитанные карточка (фото
// закрыто) и статус («недавно»): ему пересылают вид, а не факт блока. Пересчёт
// адресный, одному человеку: вид меняется только для него.
func (i *Interactor) Block(ctx context.Context, userID, targetID int64) error {
	if userID == targetID {
		return ErrSelfBlock
	}
	if err := i.repo.Block(ctx, userID, targetID); err != nil {
		return err
	}
	i.afterBlockChange(ctx, userID, targetID, true)
	return nil
}

// Unblock убирает пользователя из чёрного списка.
func (i *Interactor) Unblock(ctx context.Context, userID, targetID int64) error {
	changed, err := i.repo.Unblock(ctx, userID, targetID)
	if err != nil {
		return err
	}
	if changed {
		i.afterBlockChange(ctx, userID, targetID, false)
	}
	return nil
}

// afterBlockChange — следствия закоммиченной смены блокировки: строка журнала
// себе и пересчёт вида у заблокированного. Сбои пишутся в лог.
func (i *Interactor) afterBlockChange(ctx context.Context, userID, targetID int64, blocked bool) {
	body, err := bodyOf(domain.NewUpdatePeerBlocked(domain.NewPeerUser(targetID), blocked))
	if err == nil {
		err = i.emit.Emit(ctx, []int64{userID}, "peer_blocked", body)
	}
	if err != nil {
		log.Printf("ownsync: peer_blocked user=%d target=%d: %v", userID, targetID, err)
	}
	viewers := []int64{targetID}
	if i.announcer != nil {
		if err := i.announcer.AnnounceUserTo(ctx, userID, viewers); err != nil {
			log.Printf("privacy: announce user=%d to=%d: %v", userID, targetID, err)
		}
	}
	if i.reannouncer != nil {
		if err := i.reannouncer.ReannounceTo(ctx, userID, viewers); err != nil {
			log.Printf("privacy: reannounce user=%d to=%d: %v", userID, targetID, err)
		}
	}
}

// Blocked возвращает страницу чёрного списка и общее число записей.
func (i *Interactor) Blocked(ctx context.Context, userID int64, offset, limit int) ([]domain.BlockedUser, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return i.repo.BlockedList(ctx, userID, offset, limit)
}

// Profile собирает профиль пира для viewer в форме ОРИГИНАЛА: пара
// `userFull` + `user` внутри users.userFull. Скрытые правилами приватности
// поля просто не кладутся — «нельзя показать» это ОТСУТСТВИЕ ключа, а не
// пустая строка и не отдельный флаг видимости.
//
// Здесь исчезает третья форма пользователя. Было три витрины (краткая в
// батче, полная чужая, своя в /me) с границей не по той линии: bio и день
// рождения жили в «своей», а verified/premium — в «полной чужой». Стало две,
// как в схеме: verified/premium/bot/emoji_status — краткая карточка,
// bio/birthday/blocked/звонки/ttl — полная.
//
// Всё, что зависит от книги ЗРИТЕЛЯ, — тоже здесь, как у оригинала:
// `user.pFlags.contact`/`mutual_contact`, заметка (`userFull.note`) и личное
// фото, которое зритель поставил пиру (`userFull.personal_photo` и оно же
// краткой формой с `pFlags.personal` — ровно как в книге и списке диалогов).
func (i *Interactor) Profile(ctx context.Context, viewerID, targetID int64) (domain.UsersUserFull, error) {
	u, err := i.repo.GetUser(ctx, targetID)
	if err != nil {
		return domain.UsersUserFull{}, err
	}
	check := func(key domain.PrivacyKey) bool {
		ok, err := i.Check(ctx, targetID, viewerID, key)
		return err == nil && ok
	}

	blocked, _ := i.repo.IsBlocked(ctx, viewerID, targetID)
	// Самому себе не звонят: у оригинала phone_calls_available своей карточки
	// сервер не ставит, и кнопки звонка в «Избранном» нет (tweb topbar.ts
	// verifyCallButton :409-415 решает только по этим флагам).
	calls := viewerID != targetID && check(domain.PrivacyCalls)
	full := domain.NewUserFull(u.ID, domain.UserFullFlags{
		Blocked: blocked,
		// Звонок у нас один — правило PrivacyCalls решает и голосовой, и
		// видео: отдельного правила под видео нет, поэтому оба флага схемы
		// выставляются вместе, а не выдумывается разница.
		PhoneCallsAvailable: calls,
		VideoCallsAvailable: calls,
	})
	full.TTLPeriod, _ = i.repo.TTLPeriod(ctx, viewerID, targetID)
	full.ThemeEmoticon, _ = i.repo.ChatTheme(ctx, viewerID, targetID)
	if check(domain.PrivacyAbout) {
		full.About = u.Bio
	}
	if u.Birthday != nil && check(domain.PrivacyBirthday) {
		// Одна форма дня рождения на весь провод — конструктор birthday. Прежде
		// он ехал объектом в /me и строкой "DD.MM.YYYY" в /users/{id}.
		b := domain.NewBirthday(*u.Birthday)
		full.Birthday = &b
	}

	// Книга зрителя: о себе в своей книге ничего нет.
	var card domain.ContactCard
	if viewerID != targetID {
		if card, err = i.repo.ContactCard(ctx, viewerID, targetID); err != nil {
			return domain.UsersUserFull{}, err
		}
	}
	full.Note = card.Note
	if st, err := i.repo.PeerFullState(ctx, viewerID, targetID); err == nil {
		full.CommonChatsCount = st.CommonChats
		full.PinnedMsgID = st.PinnedMsgID
		full.StargiftsCount = st.StarGifts
		full.NotifySettings = st.NotifySettings
	}

	// Краткая форма того же пользователя — глазами зрителя (SeenBy: имя из
	// его книги, contact/mutual_contact), как в любом другом ответе с этим
	// пользователем. Телефон — по правилу приватности, а не по снятому с пира
	// phone_visibility: механизм на этот вопрос один.
	brief := u.ToUser(domain.UserFlags{Self: viewerID == targetID},
		i.status(ctx, u, check(domain.PrivacyLastSeen)), check(domain.PrivacyProfilePhoto)).SeenBy(card.ContactView)
	if check(domain.PrivacyPhoneNumber) {
		brief.Phone = u.Phone
	}
	// Личное фото — поверх правила приватности фото: его поставил сам
	// зритель, и видит его только он.
	if card.PersonalPhotoID != 0 {
		full.PersonalPhoto = domain.NewPhoto(card.PersonalPhotoID, []domain.PhotoSize{})
		brief.Photo = domain.NewUserProfilePhoto(card.PersonalPhotoID, nil, false, true)
	}
	return domain.NewUsersUserFull(full, brief, check(domain.PrivacyMessages)), nil
}

// ViewUsers доводит карточки `user` до вида глазами зрителя — ОДИН сборщик на
// все витрины (A4-08): фото, номер и статус по правилам приватности их
// владельцев (domain.UserViewRules). Правила спрашиваются пакетом, по запросу
// на ключ. Сбой правила гасит то, что оно охраняет: фото и номер не
// показываются, статус — «недавно».
func (i *Interactor) ViewUsers(ctx context.Context, viewerID int64, users []domain.UserReal) {
	if len(users) == 0 {
		return
	}
	ids := make([]int64, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.ID)
	}
	rules := domain.UserViewRules{ViewerID: viewerID}
	// Три правила — одним запросом, присутствие — одним конвейером: витрина
	// доводит пачку, а не каждого по отдельности.
	if maps, err := i.repo.VisibleMaps(ctx, viewerID, ids,
		domain.PrivacyProfilePhoto, domain.PrivacyPhoneNumber, domain.PrivacyLastSeen); err == nil {
		rules.Photo = maps[domain.PrivacyProfilePhoto]
		rules.Phone = maps[domain.PrivacyPhoneNumber]
		rules.LastSeen = maps[domain.PrivacyLastSeen]
	}
	// Присутствие не подключено — о статусе ничего не известно: это
	// userStatusEmpty, а не «офлайн с нулевым временем».
	rules.Status = func(int64) domain.UserStatus { return domain.NewUserStatusEmpty() }
	if i.presence != nil {
		statuses := i.presence.Statuses(ctx, ids)
		rules.Status = func(id int64) domain.UserStatus {
			if st, ok := statuses[id]; ok {
				return st
			}
			return domain.NewUserStatusEmpty()
		}
	}
	rules.Apply(users)
}

// PresenceSnapshot — присутствие пользователя: онлайн ли он и до какого
// момента (дедлайн TTL ключа присутствия), плюс время последнего захода.
// Реализуется presence-менеджером; optional — без него статус не производится.
type PresenceSnapshot interface {
	Status(ctx context.Context, userID int64) (online bool, expires, lastSeen time.Time)
	// Statuses — UserStatus пачки пользователей одним обращением к хранилищу.
	Statuses(ctx context.Context, userIDs []int64) map[int64]domain.UserStatus
}

// SetPresence подключает источник присутствия (usecase/presence).
func (i *Interactor) SetPresence(p PresenceSnapshot) { i.presence = p }

// status — UserStatus пира глазами зрителя. Правило last_seen не пускает —
// точного времени НЕТ ВОВСЕ: это userStatusRecently, то есть сама приватность
// выражена ВЫБОРОМ КОНСТРУКТОРА, а не отдельным флагом last_seen_visible
// рядом с обнулённым временем.
func (i *Interactor) status(ctx context.Context, u domain.UserRecord, lastSeenVisible bool) domain.UserStatus {
	if u.Deleted {
		return domain.NewUserStatusEmpty()
	}
	if !lastSeenVisible {
		return domain.NewUserStatusRecently(false)
	}
	if i.presence == nil {
		return domain.NewUserStatusEmpty()
	}
	return domain.PresenceStatus(i.presence.Status(ctx, u.ID))
}
