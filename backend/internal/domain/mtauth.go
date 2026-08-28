package domain

import "time"

// Вход: исход шага, вход по QR-коду и страна по IP.
//
// Витрины входа были безымянными картами, и что именно приехало, клиент
// выяснял по НАЛИЧИЮ ключей: есть `password_needed` — значит облачный пароль,
// есть `signup_required` — значит регистрация, нет ни того ни другого — значит
// сессия. У оригинала это ОДНО объединение `auth.Authorization`, где исход
// назван конструктором, а не набором признаков.

const (
	AuthAuthorizationTag               = "auth.authorization"
	AuthAuthorizationSignUpRequiredTag = "auth.authorizationSignUpRequired"
	AuthPasswordNeededTag              = "auth.passwordNeeded"
	AuthLoginTokenTag                  = "auth.loginToken"
	AuthLoginTokenSuccessTag           = "auth.loginTokenSuccess"
	AuthPasswordRecoveryTag            = "auth.passwordRecovery"
	AuthWebAuthTokenTag                = "auth.webAuthToken"
	HelpCountryCodeTag                 = "help.countryCode"
)

// ── auth.Authorization: чем кончился шаг входа ─────────────────────────────

// AuthAuthorization — объединение исходов шага входа: выдана сессия, нужен
// облачный пароль либо нужна регистрация. Один шаг — один конструктор.
type AuthAuthorization interface {
	isAuthAuthorization()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// auth.authorization#2ea2c0d4 flags:# setup_password_required:flags.1?true
// otherwise_relogin_days:flags.1?int tmp_sessions:flags.0?int
// future_auth_token:flags.2?bytes user:User = auth.Authorization;
//
// Сессия выдана. Пользователь едет КРАТКИМ конструктором `user` — так у
// оригинала: полной формы (`bio`, день рождения, ttl) вход не отдаёт вовсе, её
// приносит первый же `/me`. Прежде все шесть путей входа отдавали пару
// `users.userFull`, то есть полный профиль в ответе на «пусти меня».
//
// `token` — НАШ параметр, объявленный клиентским у этого конструктора
// (schema_additional_params.json). У оригинала ключ сессии телом ответа не
// едет вовсе: его выдаёт транспорт MTProto (auth_key), которого у нас нет.
type AuthAuthorizationReal struct {
	Underscore string `json:"_"`
	Token      string `json:"token"`
	User       User   `json:"user"`
}

func (AuthAuthorizationReal) isAuthAuthorization() {}
func (a AuthAuthorizationReal) Tag() string        { return a.Underscore }

// NewAuthAuthorization — вход завершён: ключ сессии и краткая карточка.
func NewAuthAuthorization(token string, user User) AuthAuthorizationReal {
	return AuthAuthorizationReal{Underscore: AuthAuthorizationTag, Token: token, User: user}
}

// auth.authorizationSignUpRequired#44747e9a flags:#
// terms_of_service:flags.0?help.TermsOfService = auth.Authorization;
//
// Номер подтверждён, аккаунта под ним нет — клиент показывает форму имени.
// `terms_of_service` не производим: соглашения у нас нет, а параметр
// необязательный.
//
// `signup_token` — НАШ параметр (schema_additional_params.json): у оригинала
// продолжение шага авторизует состояние сессии на сервере, у нас — одноразовый
// токен, потому что состояния между запросами REST нет.
type AuthAuthorizationSignUpRequired struct {
	Underscore  string `json:"_"`
	SignUpToken string `json:"signup_token"`
}

func (AuthAuthorizationSignUpRequired) isAuthAuthorization() {}
func (a AuthAuthorizationSignUpRequired) Tag() string        { return a.Underscore }

// NewAuthAuthorizationSignUpRequired — номер свободен, нужен шаг регистрации.
func NewAuthAuthorizationSignUpRequired(token string) AuthAuthorizationSignUpRequired {
	return AuthAuthorizationSignUpRequired{Underscore: AuthAuthorizationSignUpRequiredTag, SignUpToken: token}
}

// auth.passwordNeeded#3a4a3133 password_token:string hint:string
// = auth.Authorization;
//
// НАШ конструктор (объявлен в schema_additional_params.json с назначенным id).
// Предмет у оригинала есть, но выражен иначе: там это ОШИБКА
// `SESSION_PASSWORD_NEEDED` плюс состояние сессии на сервере, откуда клиент
// затем берёт подсказку отдельным вызовом `account.getPassword`. Состояния
// между запросами REST у нас нет — вместо него одноразовый `password_token`, и
// подсказка едет тем же ответом. Отказом это назвать нельзя: шаг прошёл
// успешно, просто он не последний.
type AuthPasswordNeeded struct {
	Underscore    string `json:"_"`
	PasswordToken string `json:"password_token"`
	Hint          string `json:"hint"`
}

func (AuthPasswordNeeded) isAuthAuthorization() {}
func (a AuthPasswordNeeded) Tag() string        { return a.Underscore }

// NewAuthPasswordNeeded — включён облачный пароль: вход не окончен.
func NewAuthPasswordNeeded(token, hint string) AuthPasswordNeeded {
	return AuthPasswordNeeded{Underscore: AuthPasswordNeededTag, PasswordToken: token, Hint: hint}
}

// ── auth.LoginToken: вход по QR-коду ───────────────────────────────────────

// AuthLoginToken — объединение состояний QR-входа: код ещё ждёт подтверждения
// либо подтверждён и несёт сессию. Третьего состояния, «протух», в объединении
// НЕТ: у оригинала протухший код — ошибка (`AUTH_TOKEN_EXPIRED`), и у нас
// теперь тоже.
type AuthLoginToken interface {
	isAuthLoginToken()
	Tag() string
}

// auth.loginToken#629f1980 expires:int token:bytes = auth.LoginToken;
//
// Код выпущен и ждёт подтверждения. `token` — БАЙТЫ: у нас это та же
// величина, которую маршрут `/auth/qr/{token}` берёт в шестнадцатеричной
// записи; на проводе едет само значение, а не его запись.
//
// `url` рядом больше нет. Ссылку для сканера строит клиент от своего origin —
// он и раньше строил её сам, а серверную намеренно игнорировал (за прокси она
// теряла порт): адрес ехал дважды, и второй раз никто не читал.
type AuthLoginTokenReal struct {
	Underscore string `json:"_"`
	Expires    int    `json:"expires"`
	Token      []byte `json:"token"`
}

func (AuthLoginTokenReal) isAuthLoginToken() {}
func (t AuthLoginTokenReal) Tag() string     { return t.Underscore }

// NewAuthLoginToken — выпущенный QR-код и его срок.
func NewAuthLoginToken(token []byte, expiresAt time.Time) AuthLoginTokenReal {
	return AuthLoginTokenReal{Underscore: AuthLoginTokenTag, Expires: unixSeconds(expiresAt), Token: token}
}

// auth.loginTokenSuccess#390d5c5e authorization:auth.Authorization
// = auth.LoginToken;
//
// Код подтверждён с телефона: внутри — тот же исход входа, что у обычного
// шага. Прежде подтверждённый QR отдавал `session_token` и `user` соседними
// ключами, то есть ВТОРУЮ форму того же исхода.
type AuthLoginTokenSuccess struct {
	Underscore    string            `json:"_"`
	Authorization AuthAuthorization `json:"authorization"`
}

func (AuthLoginTokenSuccess) isAuthLoginToken() {}
func (t AuthLoginTokenSuccess) Tag() string     { return t.Underscore }

// NewAuthLoginTokenSuccess — QR подтверждён, сессия выдана.
func NewAuthLoginTokenSuccess(a AuthAuthorization) AuthLoginTokenSuccess {
	return AuthLoginTokenSuccess{Underscore: AuthLoginTokenSuccessTag, Authorization: a}
}

// ── Восстановление пароля и веб-токен ──────────────────────────────────────

// auth.passwordRecovery#137948a5 email_pattern:string = auth.PasswordRecovery;
//
// Маска почты, на которую ушёл код. Соседний `resend_after` убран: паузу
// повторной отправки держит сервер (отказ `RESEND_TOO_SOON_<N>`), своего
// таймера клиент не заводит и это число не читал.
type AuthPasswordRecovery struct {
	Underscore   string `json:"_"`
	EmailPattern string `json:"email_pattern"`
}

// NewAuthPasswordRecovery — код ушёл на почту с такой маской.
func NewAuthPasswordRecovery(pattern string) AuthPasswordRecovery {
	return AuthPasswordRecovery{Underscore: AuthPasswordRecoveryTag, EmailPattern: pattern}
}

// auth.webAuthToken#0479217a token:string expires:int = auth.WebAuthToken;
//
// НАШ конструктор (объявлен в schema_additional_params.json с назначенным id).
// Обратный конец `auth.importWebTokenAuthorization`: одноразовый токен, по
// которому веб-клиент забирает сессию из ссылки `#?tgWebAuthToken=…`. У
// оригинала выпуск живёт вне схемы API — забирающая сторона там есть, а
// выдающей нет.
type AuthWebAuthToken struct {
	Underscore string `json:"_"`
	Token      string `json:"token"`
	Expires    int    `json:"expires"`
}

// NewAuthWebAuthToken — выпущенный веб-токен и его срок.
func NewAuthWebAuthToken(token string, expiresAt time.Time) AuthWebAuthToken {
	return AuthWebAuthToken{Underscore: AuthWebAuthTokenTag, Token: token, Expires: unixSeconds(expiresAt)}
}

// ── help.CountryCode: страна по IP ─────────────────────────────────────────

// help.countryCode#4203c5ef flags:# country_code:string
// prefixes:flags.0?Vector<string> patterns:flags.1?Vector<string>
// = help.CountryCode;
//
// Страна клиента для преднастройки экрана входа. Префиксы и маски номера у нас
// не заводятся — они необязательны. Пустой `country_code` — штатный исход
// «не определилось», а не отказ.
type HelpCountryCode struct {
	Underscore  string `json:"_"`
	CountryCode string `json:"country_code"`
}

// NewHelpCountryCode — определённая по IP страна (пустая строка допустима).
func NewHelpCountryCode(code string) HelpCountryCode {
	return HelpCountryCode{Underscore: HelpCountryCodeTag, CountryCode: code}
}
