package domain

import (
	"encoding/json"
	"strings"
	"time"
)

// Пиры и пользователи в форме оригинала — конструкторы схемы TL (MTProto), а не
// плоские карточки (ушедшие `domain.User` / `UserCard` / `DialogPeer`).
//
// Фаза 0 перехода на TL (docs/readiness/tl-program.md): имена конструкторов и
// полей берутся из схемы БУКВАЛЬНО (schema/schema.json), сериализация пока
// JSON. Переход к бинарному TL станет заменой сериализатора, а не переделкой
// модели. Разбор подсистемы с таблицами соответствия —
// docs/readiness/tl-peers-analysis.md.
//
// Зачем. Прежняя форма отвечала на вопросы, которые мы догадались задать:
//   - ПЯТЬ полей на одну аватарку (avatar_url, avatar_preview, photo_media_id,
//     photo_url, photo_preview), причём id медиа приходилось выпарсивать
//     обратно из собственной же строки — `Sscanf` по `/media/%d/content` на
//     бэкенде и регулярка на фронте. Здесь это одно поле photo:
//     UserProfilePhoto с готовым photo_id;
//   - `online: true` без срока годности: потерянный кадр присутствия оставлял
//     человека онлайн навсегда. В схеме userStatusOnline несёт expires, и
//     клиент сам деградирует online → offline по таймеру;
//   - три разные витрины пользователя (краткая, полная чужая, своя) вместо
//     пары user/userFull оригинала, из-за чего bio/birthday жили в «своей», а
//     verified/premium — в «полной чужой».
//
// ── Правила фазы 0 (те же, что у mtmedia.go, mtentity.go, mtreplymarkup.go) ──
//   - у каждого объекта есть дискриминатор `_` со значением predicate схемы;
//   - поля `flags` в объекте НЕТ: битовая маска живёт только на проводе, кодек
//     считает её из присутствия полей;
//   - булевы флаги схемы (`flags.N?true`) собраны в под-объект `pFlags` и
//     всегда несут `true`; «выключено» — это ОТСУТСТВИЕ ключа, false не кладём;
//   - обязательные по схеме параметры сериализуются всегда, даже нулевые;
//     flags-параметры — только когда есть;
//   - у каждого конструктора СВОЯ структура, а не общий тип с omitempty.
//
// ── Про имена ───────────────────────────────────────────────────────────────
// Объединения схемы называются User и Chat, и на шаге A эти имена были заняты
// уходящей моделью — потому конструкторы носили временный префикс MT. Шаг C
// старые структуры снял (строка таблицы теперь UserRecord/ChatRecord, и она
// сознательно НЕ объект провода), поэтому леса убраны: User и Chat здесь —
// объединения схемы. Имена конструкторов UserReal/ChatReal окончательные —
// тот же приём, что у PhotoSizeReal и KeyboardButtonReal (конструктор,
// названный как собственное объединение).
//
// ── Чего в модели НЕТ и почему ──────────────────────────────────────────────
// Реквизиты MTProto-транспорта — предмета в нашей схеме доступа не имеют:
//   - user.access_hash, channel.access_hash, channelForbidden.access_hash —
//     токен доступа к пиру; у нас пир адресуется одним числовым id;
//   - pFlags.min у user и channel — признак «объект пришёл урезанным вместе с
//     сообщением»; кэша пиров с двумя степенями полноты у нас нет;
//   - userProfilePhoto.dc_id, chatPhoto.dc_id — номер датацентра хранилища;
//   - chat.version, channelFull.pts (в этой модели), channelFull.stats_dc;
//   - семейство Input*;
//   - user.lang_code, user.bot_info_version;
//   - restriction_reason + pFlags.restricted — географических ограничений
//     аккаунтов у нас нет.
//
// Решения разбора, исполненные здесь:
//   - №1 — ключ пира знаковый PeerID (юзер ≥ 0, чат < 0), см. ниже;
//   - №2 — наша группа это channel + pFlags.megagroup; базовый chat объявлен,
//     но не производится (см. mtchat.go);
//   - №3 — права это pFlags chatAdminRights/chatBannedRights, роль отдельным
//     полем не заводится (см. mtchat.go);
//   - №5 — phone_visibility в модель пира не переносится: это правило
//     приватности (domain.PrivacyPhoneNumber), а не свойство пользователя;
//   - №6 — emoji_status: предмет ЧАСТИЧНО другой, см. UserReal.EmojiStatus;
//   - №7 — display_name не переносится: имя собирается на клиенте (PeerTitle);
//   - секретные чаты — это отдельное объединение EncryptedChat, а не вариант
//     Chat; отдельный пункт программы.

// ── Пространство идентификаторов (решение №1) ───────────────────────────────

// PeerID — знаковый идентификатор пира: пользователь ≥ 0, любой чат < 0.
// Порт оригинала: tweb utils/peers/isUser.ts (`+peerId >= 0`), isAnyChat.ts
// (`+peerId < 0`), helpers/peerIdPolyfill.ts:25-32 (toUserId/toChatId/toPeerId).
//
// Одно пространство вместо трёх (users.id, chats.id, невостребованный PeerId)
// — и приватный чат перестаёт быть сущностью: собеседник И ЕСТЬ пир.
type PeerID int64

// NULL_PEER_ID оригинала (tweb appManagers/constants.ts:9): «пира нет».
const NullPeerID PeerID = 0

// SERVICE_PEER_ID оригинала (tweb appManagers/constants.ts:14) — аккаунт
// служебных уведомлений. Число одно и то же, что у ServiceUserID: константа
// выражена через неё, чтобы источник остался единственным.
const ServicePeerID PeerID = PeerID(ServiceUserID)

// ToPeerID собирает пир из «сырого» id таблицы: чат уходит в отрицательные.
// Порт Number.prototype.toPeerId (peerIdPolyfill.ts:30-32).
func ToPeerID(id int64, isChat bool) PeerID {
	if isChat {
		if id < 0 {
			return PeerID(id)
		}
		return PeerID(-id)
	}
	return PeerID(id)
}

// IsUser — порт isUser.ts: пир это пользователь.
func (p PeerID) IsUser() bool { return p >= 0 }

// IsAnyChat — порт isAnyChat.ts: пир это группа/канал.
func (p PeerID) IsAnyChat() bool { return p < 0 }

// ToUserID — id строки users. Порт Number.prototype.toUserId.
func (p PeerID) ToUserID() int64 { return int64(p) }

// ToChatID — id строки chats (модуль). Порт Number.prototype.toChatId.
func (p PeerID) ToChatID() int64 {
	if p < 0 {
		return int64(-p)
	}
	return int64(p)
}

// ── Peer: peerUser | peerChat | peerChannel ─────────────────────────────────

// Peer — объединение схемы: peerUser | peerChat | peerChannel. Это ССЫЛКА на
// пир внутри других объектов (from_id, saved_peer_id, default_send_as), а не
// сам пир: тело пользователя это User, тело чата — Chat.
type Peer interface {
	isPeer()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
	// PeerID — знаковый ключ (решение №1).
	PeerID() PeerID
}

// Значения дискриминатора `_` объединения Peer.
const (
	PeerUserTag    = "peerUser"
	PeerChatTag    = "peerChat"
	PeerChannelTag = "peerChannel"
)

// peerUser#59511722 user_id:long = Peer;
type PeerUser struct {
	Underscore string `json:"_"`
	UserID     int64  `json:"user_id"`
}

func (PeerUser) isPeer()          {}
func (p PeerUser) Tag() string    { return p.Underscore }
func (p PeerUser) PeerID() PeerID { return PeerID(p.UserID) }

func NewPeerUser(userID int64) PeerUser {
	return PeerUser{Underscore: PeerUserTag, UserID: userID}
}

// peerChat#36c6019a chat_id:long = Peer;
//
// Ссылка на БАЗОВЫЙ chat. Объявлена, но не производится — по той же причине,
// по которой не производится сам chat (решение №2: наша группа это channel +
// pFlags.megagroup). Нужна кодеку фазы 2: чужой кадр с peerChat обязан
// пережить круг разбор → сборка. Конструирующей функции поэтому нет: собрать
// peerChat можно только литералом, и это видно в коде.
type PeerChat struct {
	Underscore string `json:"_"`
	ChatID     int64  `json:"chat_id"`
}

func (PeerChat) isPeer()          {}
func (p PeerChat) Tag() string    { return p.Underscore }
func (p PeerChat) PeerID() PeerID { return ToPeerID(p.ChatID, true) }

// peerChannel#a2a5371e channel_id:long = Peer;
//
// Ссылка на канал ИЛИ супергруппу — обе у нас channel (решение №2).
type PeerChannel struct {
	Underscore string `json:"_"`
	ChannelID  int64  `json:"channel_id"`
}

func (PeerChannel) isPeer()          {}
func (p PeerChannel) Tag() string    { return p.Underscore }
func (p PeerChannel) PeerID() PeerID { return ToPeerID(p.ChannelID, true) }

func NewPeerChannel(channelID int64) PeerChannel {
	return PeerChannel{Underscore: PeerChannelTag, ChannelID: channelID}
}

// NewPeer собирает ссылку на пир из знакового ключа: пользователь → peerUser,
// чат → peerChannel. Обратная сторона getPeerId (tweb getPeerId.ts:5-28).
// peerChat здесь не появляется никогда — базовых чатов мы не производим.
func NewPeer(peerID PeerID) Peer {
	if peerID.IsUser() {
		return NewPeerUser(peerID.ToUserID())
	}
	return NewPeerChannel(peerID.ToChatID())
}

// GetPeerID — порт tweb getPeerId.ts: знаковый ключ из ссылки на пир.
// nil даёт NullPeerID, как у оригинала (там это ветка `if(!peerId)`).
func GetPeerID(p Peer) PeerID {
	if p == nil {
		return NullPeerID
	}
	return p.PeerID()
}

// UnmarshalPeer разбирает объединение Peer по дискриминатору `_`. Неизвестный
// (или отсутствующий) конструктор — nil, nil: ссылка на пир из чужого будущего
// слоя не должна ронять разбор всего кадра.
func UnmarshalPeer(raw []byte) (Peer, error) {
	tag, ok, err := peekTag(raw)
	if err != nil || !ok {
		return nil, err
	}
	switch tag {
	case PeerUserTag:
		v, err := unmarshalCtor[PeerUser](raw)
		return v, err
	case PeerChatTag:
		v, err := unmarshalCtor[PeerChat](raw)
		return v, err
	case PeerChannelTag:
		v, err := unmarshalCtor[PeerChannel](raw)
		return v, err
	}
	return nil, nil
}

// ── User: userEmpty | user ──────────────────────────────────────────────────

// User — объединение схемы: userEmpty | user.
type User interface {
	isUser()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
	// PeerID — знаковый ключ (у пользователя совпадает с id).
	PeerID() PeerID
}

// Значения дискриминатора `_` объединения User.
const (
	UserEmptyTag = "userEmpty"
	UserTag      = "user"
)

// userEmpty#d3bc4b7a id:long = User;
//
// «Пользователь недоступен»: id известен, тела нет. У нас это ссылка на
// удалённую строку users — раньше витрина отдавала на её месте пустую карточку
// с придуманным именем.
type UserEmpty struct {
	Underscore string `json:"_"`
	ID         int64  `json:"id"`
}

func (UserEmpty) isUser()          {}
func (u UserEmpty) Tag() string    { return u.Underscore }
func (u UserEmpty) PeerID() PeerID { return PeerID(u.ID) }

func NewUserEmpty(id int64) UserEmpty {
	return UserEmpty{Underscore: UserEmptyTag, ID: id}
}

// UserFlags — булевы флаги user в форме, удобной для вызова: в pFlags попадают
// только выставленные. Перечислены ровно те, у которых есть предмет.
//
//	Self           — это сам зритель (у нас витрина знает по session.User.ID)
//	Contact        — есть строка contacts(owner=зритель, user=этот)
//	MutualContact  — строки contacts есть в ОБЕ стороны
//	Deleted        — users.deleted_at не пуст
//	Bot            — users.is_bot
//	Verified       — users.is_verified (defect 5 разбора: в батче терялся)
//	Premium        — users.is_premium
//
// Остальные булевы флаги схемы (support, scam, fake, bot_chat_history,
// bot_nochats, bot_inline_geo, apply_min_photo, attach_menu_enabled,
// close_friend, stories_*, contact_require_premium, bot_*) предмета у нас не
// имеют: ни колонки, ни механики за ними нет. Они не объявляются вовсе, а не
// выставляются наугад.
type UserFlags struct {
	Self          bool
	Contact       bool
	MutualContact bool
	Deleted       bool
	Bot           bool
	Verified      bool
	Premium       bool
}

// userFlagNames — что keepPFlags пропускает в модель на разборе. Флаг, которого
// здесь нет, из чужого кадра в модель не попадёт.
var userFlagNames = []string{"self", "contact", "mutual_contact", "deleted", "bot", "verified", "premium"}

// user#31774388 flags:# self:flags.10?true contact:flags.11?true
// mutual_contact:flags.12?true deleted:flags.13?true bot:flags.14?true
// verified:flags.17?true premium:flags.28?true … id:long
// access_hash:flags.0?long first_name:flags.1?string last_name:flags.2?string
// username:flags.3?string phone:flags.4?string photo:flags.5?UserProfilePhoto
// status:flags.6?UserStatus emoji_status:flags.30?EmojiStatus … = User;
//
// КРАТКАЯ форма пользователя — та, что едет вместе с сообщениями и списком
// диалогов. Bio и день рождения здесь отсутствуют по схеме: их место — UserFull
// (граница у нас была проведена не по этой линии, см. разбор).
//
// Имя структуры с суффиксом Real: `User` в пакете занято уходящей моделью
// (см. шапку файла).
type UserReal struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int64           `json:"id"`
	FirstName  string          `json:"first_name,omitempty"`
	LastName   string          `json:"last_name,omitempty"`
	Username   string          `json:"username,omitempty"`
	// Phone — flags.4?string. Видимость номера решает ПРАВИЛО ПРИВАТНОСТИ
	// (PrivacyPhoneNumber), а не поле пира: решение №5 сняло с модели
	// phone_visibility. Витрина просто не кладёт сюда номер, когда правило не
	// пускает зрителя.
	Phone string `json:"phone,omitempty"`
	// Photo — flags.5?UserProfilePhoto: userProfilePhotoEmpty | userProfilePhoto.
	// Пять прежних полей аватарки схлопнулись сюда; выпарсивание id медиа из
	// собственной строки (`Sscanf` по `/media/%d/content`) больше не нужно.
	Photo UserProfilePhoto `json:"photo,omitempty"`
	// Status — flags.6?UserStatus. Присутствие с СРОКОМ ГОДНОСТИ: см. UserStatus.
	Status UserStatus `json:"status,omitempty"`
	// EmojiStatus — КЛИЕНТСКИЙ параметр (schema_additional_params.json,
	// предикат `user`, имя emoji_status_emoticon), а не схемный emoji_status.
	//
	// Предмет ЧАСТИЧНО другой: у нас это unicode-символ (users.emoji_status), а
	// схемный emoji_status:EmojiStatus несёт document_id кастом-эмодзи —
	// заполнить его нечем, пока нет подсистемы кастом-эмодзи. Класть unicode в
	// поле, которое на фазе 2 станет long, нельзя: кодек сломается молча.
	// Вернуться сюда в подсистеме кастом-эмодзи (решение №6).
	EmojiStatus string `json:"emoji_status_emoticon,omitempty"`
}

func (UserReal) isUser()          {}
func (u UserReal) Tag() string    { return u.Underscore }
func (u UserReal) PeerID() PeerID { return PeerID(u.ID) }

// Флаги пользователя: выставлен = ключ присутствует в pFlags.
func (u UserReal) Self() bool          { return u.PFlags["self"] }
func (u UserReal) Contact() bool       { return u.PFlags["contact"] }
func (u UserReal) MutualContact() bool { return u.PFlags["mutual_contact"] }
func (u UserReal) Deleted() bool       { return u.PFlags["deleted"] }
func (u UserReal) Bot() bool           { return u.PFlags["bot"] }
func (u UserReal) Verified() bool      { return u.PFlags["verified"] }
func (u UserReal) Premium() bool       { return u.PFlags["premium"] }

// Title — «Имя Фамилия» одной строкой. НА ПРОВОД НЕ ИДЁТ: имя пира собирает
// клиент из first_name/last_name (порт tweb PeerTitle), и денормализованного
// display_name на проводе больше нет. Метод нужен там, где имя ЗАМОРАЖИВАЕТСЯ
// в снимок и пира на принимающей стороне может не быть вовсе: скрытая
// атрибуция пересылки (messageFwdHeader.from_name), снимок кросс-чат-ответа,
// текст push-уведомления.
func (u UserReal) Title() string {
	return strings.TrimSpace(strings.TrimSpace(u.FirstName) + " " + strings.TrimSpace(u.LastName))
}

// ShortName — имя для компактных контекстов (префикс превью в списке чатов,
// подпись «печатает»): первое имя, если задано, иначе полное.
func (u UserReal) ShortName() string {
	if u.FirstName != "" {
		return u.FirstName
	}
	return u.Title()
}

// NewUser собирает краткую форму. Обязателен только id: всё остальное —
// flags-параметры, и пустое значение означает ОТСУТСТВИЕ ключа.
func NewUser(id int64, f UserFlags) UserReal {
	u := UserReal{Underscore: UserTag, ID: id}
	setPFlag(&u.PFlags, "self", f.Self)
	setPFlag(&u.PFlags, "contact", f.Contact)
	setPFlag(&u.PFlags, "mutual_contact", f.MutualContact)
	setPFlag(&u.PFlags, "deleted", f.Deleted)
	setPFlag(&u.PFlags, "bot", f.Bot)
	setPFlag(&u.PFlags, "verified", f.Verified)
	setPFlag(&u.PFlags, "premium", f.Premium)
	return u
}

func (u *UserReal) UnmarshalJSON(b []byte) error {
	type plain UserReal
	var v struct {
		plain
		Photo  json.RawMessage `json:"photo"`
		Status json.RawMessage `json:"status"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*u = UserReal(v.plain)
	u.PFlags = keepPFlags(v.plain.PFlags, userFlagNames...)

	photo, err := UnmarshalUserProfilePhoto(v.Photo)
	if err != nil {
		return err
	}
	u.Photo = photo

	status, err := UnmarshalUserStatus(v.Status)
	if err != nil {
		return err
	}
	u.Status = status
	return nil
}

// UnmarshalUser разбирает объединение User по дискриминатору `_`.
func UnmarshalUser(raw []byte) (User, error) {
	tag, ok, err := peekTag(raw)
	if err != nil || !ok {
		return nil, err
	}
	switch tag {
	case UserEmptyTag:
		v, err := unmarshalCtor[UserEmpty](raw)
		return v, err
	case UserTag:
		v, err := unmarshalCtor[UserReal](raw)
		return v, err
	}
	return nil, nil
}

// ── UserProfilePhoto: userProfilePhotoEmpty | userProfilePhoto ──────────────

// UserProfilePhoto — объединение схемы: userProfilePhotoEmpty |
// userProfilePhoto.
type UserProfilePhoto interface {
	isUserProfilePhoto()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// Значения дискриминатора `_` объединения UserProfilePhoto.
const (
	UserProfilePhotoEmptyTag = "userProfilePhotoEmpty"
	UserProfilePhotoTag      = "userProfilePhoto"
)

// userProfilePhotoEmpty#4f11bae1 = UserProfilePhoto;
//
// Аватарки нет — клиент рисует градиент по id. Отдельный конструктор, а не
// пустая строка avatar_url: «нет фото» это состояние, а не пустое значение.
type UserProfilePhotoEmpty struct {
	Underscore string `json:"_"`
}

func (UserProfilePhotoEmpty) isUserProfilePhoto() {}
func (p UserProfilePhotoEmpty) Tag() string       { return p.Underscore }

func NewUserProfilePhotoEmpty() UserProfilePhotoEmpty {
	return UserProfilePhotoEmpty{Underscore: UserProfilePhotoEmptyTag}
}

// userProfilePhoto#82d1f706 flags:# has_video:flags.0?true personal:flags.2?true
// photo_id:long stripped_thumb:flags.1?bytes dc_id:int = UserProfilePhoto;
//
// PhotoID — то самое число, которого ждёт воркерный downloadMediaURL; раньше
// его выпарсивали регуляркой из avatar_url на обеих сторонах провода.
// StrippedThumb — наш users.avatar_preview (формат — как у media.blur_preview,
// см. domain.Media).
//
// pFlags.has_video — есть видео-вариант аватарки (profile_photos.video_url);
// pFlags.personal — фото задано ЗРИТЕЛЕМ для этого контакта
// (contact_custom_photo), сам контакт о нём не знает.
//
// dc_id не производится: реквизит MTProto-транспорта.
type UserProfilePhotoReal struct {
	Underscore    string          `json:"_"`
	PFlags        map[string]bool `json:"pFlags,omitempty"`
	PhotoID       int64           `json:"photo_id"`
	StrippedThumb []byte          `json:"stripped_thumb,omitempty"`
}

func (UserProfilePhotoReal) isUserProfilePhoto() {}
func (p UserProfilePhotoReal) Tag() string       { return p.Underscore }
func (p UserProfilePhotoReal) HasVideo() bool    { return p.PFlags["has_video"] }
func (p UserProfilePhotoReal) Personal() bool    { return p.PFlags["personal"] }

func NewUserProfilePhoto(photoID int64, strippedThumb []byte, hasVideo, personal bool) UserProfilePhotoReal {
	p := UserProfilePhotoReal{Underscore: UserProfilePhotoTag, PhotoID: photoID, StrippedThumb: strippedThumb}
	setPFlag(&p.PFlags, "has_video", hasVideo)
	setPFlag(&p.PFlags, "personal", personal)
	return p
}

func (p *UserProfilePhotoReal) UnmarshalJSON(b []byte) error {
	type plain UserProfilePhotoReal
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*p = UserProfilePhotoReal(v)
	p.PFlags = keepPFlags(v.PFlags, "has_video", "personal")
	return nil
}

// UnmarshalUserProfilePhoto разбирает объединение UserProfilePhoto.
func UnmarshalUserProfilePhoto(raw []byte) (UserProfilePhoto, error) {
	tag, ok, err := peekTag(raw)
	if err != nil || !ok {
		return nil, err
	}
	switch tag {
	case UserProfilePhotoEmptyTag:
		v, err := unmarshalCtor[UserProfilePhotoEmpty](raw)
		return v, err
	case UserProfilePhotoTag:
		v, err := unmarshalCtor[UserProfilePhotoReal](raw)
		return v, err
	}
	return nil, nil
}

// ── UserStatus ──────────────────────────────────────────────────────────────

// UserStatus — объединение схемы: userStatusEmpty | userStatusOnline |
// userStatusOffline | userStatusRecently | userStatusLastWeek |
// userStatusLastMonth.
//
// Здесь чинится дефект 1 разбора. Наш `online: true` срока годности не имел:
// потерянный кадр присутствия оставлял человека онлайн навсегда. В схеме
// userStatusOnline несёт expires, и клиент сам деградирует online → offline по
// таймеру (tweb appUsersManager.ts:880-889). Источник у нас ЕСТЬ — это TTL
// ключа присутствия в Redis, просто на провод он не выпускался.
//
// Три «размытых» конструктора (Recently/LastWeek/LastMonth) — это ответ, когда
// точное время скрыто правилом приватности PrivacyLastSeen.
type UserStatus interface {
	isUserStatus()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// Значения дискриминатора `_` объединения UserStatus.
const (
	UserStatusEmptyTag      = "userStatusEmpty"
	UserStatusOnlineTag     = "userStatusOnline"
	UserStatusOfflineTag    = "userStatusOffline"
	UserStatusRecentlyTag   = "userStatusRecently"
	UserStatusLastWeekTag   = "userStatusLastWeek"
	UserStatusLastMonthTag  = "userStatusLastMonth"
	userStatusByMeFlagsName = "by_me"
)

// userStatusEmpty#09d05049 = UserStatus;
//
// О присутствии ничего не известно (никогда не заходил / статус не запрашивали).
type UserStatusEmpty struct {
	Underscore string `json:"_"`
}

func (UserStatusEmpty) isUserStatus() {}
func (s UserStatusEmpty) Tag() string { return s.Underscore }

func NewUserStatusEmpty() UserStatusEmpty {
	return UserStatusEmpty{Underscore: UserStatusEmptyTag}
}

// userStatusOnline#edb93949 expires:int = UserStatus;
//
// Expires — момент, ПОСЛЕ которого клиент обязан считать пира офлайн, даже не
// получив ни одного кадра. У нас это дедлайн TTL ключа присутствия.
type UserStatusOnline struct {
	Underscore string `json:"_"`
	Expires    int    `json:"expires"`
}

func (UserStatusOnline) isUserStatus() {}
func (s UserStatusOnline) Tag() string { return s.Underscore }

func NewUserStatusOnline(expires time.Time) UserStatusOnline {
	return UserStatusOnline{Underscore: UserStatusOnlineTag, Expires: unixSeconds(expires)}
}

// userStatusOffline#008c703f was_online:int = UserStatus;
type UserStatusOffline struct {
	Underscore string `json:"_"`
	WasOnline  int    `json:"was_online"`
}

func (UserStatusOffline) isUserStatus() {}
func (s UserStatusOffline) Tag() string { return s.Underscore }

func NewUserStatusOffline(wasOnline time.Time) UserStatusOffline {
	return UserStatusOffline{Underscore: UserStatusOfflineTag, WasOnline: unixSeconds(wasOnline)}
}

// userStatusRecently#7b197dc8 flags:# by_me:flags.0?true = UserStatus;
//
// «Был(а) недавно». pFlags.by_me — точное время скрыто не чужой настройкой, а
// МОЕЙ собственной (я прячу свой last_seen, поэтому не вижу чужой). Предмет у
// нас есть: правило PrivacyLastSeen самого зрителя.
type UserStatusRecently struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
}

func (UserStatusRecently) isUserStatus() {}
func (s UserStatusRecently) Tag() string { return s.Underscore }
func (s UserStatusRecently) ByMe() bool  { return s.PFlags[userStatusByMeFlagsName] }

func NewUserStatusRecently(byMe bool) UserStatusRecently {
	s := UserStatusRecently{Underscore: UserStatusRecentlyTag}
	setPFlag(&s.PFlags, userStatusByMeFlagsName, byMe)
	return s
}

func (s *UserStatusRecently) UnmarshalJSON(b []byte) error {
	type plain UserStatusRecently
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*s = UserStatusRecently(v)
	s.PFlags = keepPFlags(v.PFlags, userStatusByMeFlagsName)
	return nil
}

// userStatusLastWeek#541a1d1a flags:# by_me:flags.0?true = UserStatus;
type UserStatusLastWeek struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
}

func (UserStatusLastWeek) isUserStatus() {}
func (s UserStatusLastWeek) Tag() string { return s.Underscore }
func (s UserStatusLastWeek) ByMe() bool  { return s.PFlags[userStatusByMeFlagsName] }

func NewUserStatusLastWeek(byMe bool) UserStatusLastWeek {
	s := UserStatusLastWeek{Underscore: UserStatusLastWeekTag}
	setPFlag(&s.PFlags, userStatusByMeFlagsName, byMe)
	return s
}

func (s *UserStatusLastWeek) UnmarshalJSON(b []byte) error {
	type plain UserStatusLastWeek
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*s = UserStatusLastWeek(v)
	s.PFlags = keepPFlags(v.PFlags, userStatusByMeFlagsName)
	return nil
}

// userStatusLastMonth#65899777 flags:# by_me:flags.0?true = UserStatus;
type UserStatusLastMonth struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
}

func (UserStatusLastMonth) isUserStatus() {}
func (s UserStatusLastMonth) Tag() string { return s.Underscore }
func (s UserStatusLastMonth) ByMe() bool  { return s.PFlags[userStatusByMeFlagsName] }

func NewUserStatusLastMonth(byMe bool) UserStatusLastMonth {
	s := UserStatusLastMonth{Underscore: UserStatusLastMonthTag}
	setPFlag(&s.PFlags, userStatusByMeFlagsName, byMe)
	return s
}

func (s *UserStatusLastMonth) UnmarshalJSON(b []byte) error {
	type plain UserStatusLastMonth
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*s = UserStatusLastMonth(v)
	s.PFlags = keepPFlags(v.PFlags, userStatusByMeFlagsName)
	return nil
}

// PresenceStatus собирает статус из снимка присутствия: онлайн ли пир, до
// какого момента (дедлайн TTL ключа присутствия) и когда заходил в последний
// раз. ЕДИНСТВЕННОЕ место перевода — витрины и кадры зовут его, а не собирают
// конструктор сами.
//
// Здесь и чинится дефект 1 разбора. Прежний `online: true` срока годности не
// имел, и потерянный кадр присутствия оставлял человека онлайн НАВСЕГДА.
// userStatusOnline несёт expires, и клиент сам деградирует online → offline по
// таймеру (tweb appUsersManager.ts:880-889), даже не получив ни одного кадра.
//
// Пустой expires у онлайна был бы худшим из миров: ключ есть, срок нулевой —
// клиент счёл бы пира просроченным немедленно. Поэтому онлайн без известного
// дедлайна отдаётся как userStatusOffline с последним заходом: «точно был», а
// не «точно есть».
func PresenceStatus(online bool, expires, lastSeen time.Time) UserStatus {
	if online && !expires.IsZero() {
		return NewUserStatusOnline(expires)
	}
	if lastSeen.IsZero() {
		return NewUserStatusEmpty()
	}
	return NewUserStatusOffline(lastSeen)
}

// UnmarshalUserStatus разбирает объединение UserStatus.
func UnmarshalUserStatus(raw []byte) (UserStatus, error) {
	tag, ok, err := peekTag(raw)
	if err != nil || !ok {
		return nil, err
	}
	switch tag {
	case UserStatusEmptyTag:
		v, err := unmarshalCtor[UserStatusEmpty](raw)
		return v, err
	case UserStatusOnlineTag:
		v, err := unmarshalCtor[UserStatusOnline](raw)
		return v, err
	case UserStatusOfflineTag:
		v, err := unmarshalCtor[UserStatusOffline](raw)
		return v, err
	case UserStatusRecentlyTag:
		v, err := unmarshalCtor[UserStatusRecently](raw)
		return v, err
	case UserStatusLastWeekTag:
		v, err := unmarshalCtor[UserStatusLastWeek](raw)
		return v, err
	case UserStatusLastMonthTag:
		v, err := unmarshalCtor[UserStatusLastMonth](raw)
		return v, err
	}
	return nil, nil
}

// ── Birthday ────────────────────────────────────────────────────────────────

// BirthdayTag — дискриминатор `_` конструктора birthday.
const BirthdayTag = "birthday"

// birthday#6c8e1e06 flags:# day:int month:int year:flags.0?int = Birthday;
//
// День и месяц обязательны, год — нет: Telegram разрешает дату без года. У нас
// «без года» кодировалось часовым поясом-сентинелом BirthdayNoYear в колонке
// DATE; здесь это просто ОТСУТСТВИЕ year, как в схеме.
//
// Заодно чинится дефект 6 разбора: день рождения ехал в двух разных формах —
// объектом в /me и строкой "DD.MM.YYYY" в /users/{id}.
type Birthday struct {
	Underscore string `json:"_"`
	Day        int    `json:"day"`
	Month      int    `json:"month"`
	Year       int    `json:"year,omitempty"`
}

// NewBirthday собирает конструктор из нашей time.Time; год-сентинел
// BirthdayNoYear даёт дату БЕЗ года (ключ year отсутствует).
func NewBirthday(t time.Time) Birthday {
	b := Birthday{Underscore: BirthdayTag, Day: t.Day(), Month: int(t.Month())}
	if t.Year() != BirthdayNoYear {
		b.Year = t.Year()
	}
	return b
}

// ── UserFull ────────────────────────────────────────────────────────────────

// UserFullTag — дискриминатор `_` конструктора userFull.
const UserFullTag = "userFull"

// userFull#06cbe645 flags:# blocked:flags.0?true … id:long about:flags.1?string
// settings:PeerSettings personal_photo:flags.21?Photo profile_photo:flags.2?Photo
// fallback_photo:flags.22?Photo notify_settings:PeerNotifySettings
// bot_info:flags.3?BotInfo pinned_msg_id:flags.6?int common_chats_count:int
// folder_id:flags.11?int ttl_period:flags.14?int … flags2:#
// birthday:flags2.5?Birthday … = UserFull;
//
// ПОЛНАЯ форма — то, что запрашивается один раз при открытии профиля, в отличие
// от краткой user, которая едет с каждым списком. Здесь живут bio и день
// рождения: у нас они лежали в «своей» витрине (/me), а verified/premium — в
// «полной чужой» (/users/{id}), то есть граница шла не по этой линии.
//
// Обязательные по схеме settings:PeerSettings, notify_settings:
// PeerNotifySettings, common_chats_count:int здесь не производятся — см.
// mtpeer_schema_test.go, список «нет предмета», там же причины.
type UserFull struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int64           `json:"id"`
	// About — flags.1?string: наш users.bio.
	About string `json:"about,omitempty"`
	// TTLPeriod — flags.14?int: период автоудаления сообщений переписки с этим
	// пиром в секундах; 0 — выключено.
	TTLPeriod int `json:"ttl_period,omitempty"`
	// Birthday — flags2.5?Birthday (users.birthday). Видимость решает правило
	// PrivacyBirthday: не пускает — витрина просто не кладёт ключ.
	Birthday *Birthday `json:"birthday,omitempty"`
	// ThemeEmoticon — тема оформления переписки с этим пиром (решение Р7).
	//
	// НАЗВАННОЕ ОТСТУПЛЕНИЕ, и потому это НАШ параметр (объявлен в
	// schema/schema_additional_params.json), а не поле схемы: в схеме у userFull
	// стоит `theme: flags.15?ChatTheme` — объект с обоями и палитрой, которые
	// приезжают С СЕРВЕРА. У нас тема это пресет НА КЛИЕНТЕ, и с сервера едет
	// только его id, ровно как у групп (chatFull/channelFull.theme_emoticon).
	// Класть id в поле, где на фазе 2 будет объект, значило бы сломать кодек
	// молча. См. docs/readiness/port-divergences.md.
	ThemeEmoticon string `json:"theme_emoticon,omitempty"`
}

// UserFullFlags — булевы флаги userFull в форме, удобной для вызова.
// Перечислены ровно те, у которых есть предмет:
//
//	Blocked            — пир в чёрном списке зрителя (user_blocks)
//	PhoneCallsAvailable — зрителю можно звонить этому пиру (правило PrivacyCalls)
//	VideoCallsAvailable — то же для видеозвонка: у нас это одно правило
//
// Остальные булевы флаги схемы (phone_calls_private, can_pin_message,
// has_scheduled, voice_messages_forbidden, translations_disabled, stories_*,
// contact_require_premium, read_dates_private, sponsored_enabled, …) предмета
// у нас не имеют — ни колонки, ни механики за ними нет.
type UserFullFlags struct {
	Blocked             bool
	PhoneCallsAvailable bool
	VideoCallsAvailable bool
}

// userFullFlagNames — что keepPFlags пропускает в модель на разборе.
var userFullFlagNames = []string{"blocked", "phone_calls_available", "video_calls_available"}

// Blocked — пользователь в чёрном списке зрителя (user_blocks).
func (f UserFull) Blocked() bool { return f.PFlags["blocked"] }

// PhoneCallsAvailable/VideoCallsAvailable — пройдёт ли звонок (PrivacyCalls).
func (f UserFull) PhoneCallsAvailable() bool { return f.PFlags["phone_calls_available"] }
func (f UserFull) VideoCallsAvailable() bool { return f.PFlags["video_calls_available"] }

// NewUserFull собирает полную форму. Обязателен только id.
func NewUserFull(id int64, f UserFullFlags) UserFull {
	out := UserFull{Underscore: UserFullTag, ID: id}
	setPFlag(&out.PFlags, "blocked", f.Blocked)
	setPFlag(&out.PFlags, "phone_calls_available", f.PhoneCallsAvailable)
	setPFlag(&out.PFlags, "video_calls_available", f.VideoCallsAvailable)
	return out
}

func (f *UserFull) UnmarshalJSON(b []byte) error {
	type plain UserFull
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*f = UserFull(v)
	f.PFlags = keepPFlags(v.PFlags, userFullFlagNames...)
	return nil
}

// ── users.userFull ──────────────────────────────────────────────────────────

// UsersUserFullTag — дискриминатор `_` конструктора users.userFull.
const UsersUserFullTag = "users.userFull"

// users.userFull#3b6d152e full_user:UserFull chats:Vector<Chat>
// users:Vector<User> = users.UserFull;
//
// ОТВЕТ на запрос профиля целиком: полная форма ВМЕСТЕ с краткой. Именно он
// сводит наши три витрины пользователя к паре оригинала — краткий `user` едет
// не отдельной ручкой, а тем же ответом, и вопрос «где живёт verified, а где
// bio» перестаёт быть нашим: он решён схемой.
//
// Chats обязателен по схеме и едет пустым вектором: общих чатов мы не считаем
// (см. common_chats_count в списке «нет предмета»).
type UsersUserFull struct {
	Underscore string     `json:"_"`
	FullUser   UserFull   `json:"full_user"`
	Chats      []Chat     `json:"chats"`
	Users      []UserReal `json:"users"`
	// CanMessage — НАШ параметр, объявленный в schema_additional_params.json.
	//
	// Прежде он ехал ключом РЯДОМ с конструктором, в безымянной обёртке
	// `{user_full, can_message}`. На проводе TL «рядом» не бывает: у обёртки нет
	// конструктора, и записать её нечем. Механизм для своих полей у оригинала
	// уже есть — тот же, которым в `message` живут `mid`/`peerId`; им и
	// пользуемся.
	//
	// Предмета в схеме у поля нет: оригинал выражает «можно ли писать» иначе —
	// `user.pFlags.deleted` плюс премиум-гейт `contact_require_premium`
	// (tweb `canSendToUser.ts`, `appUsersManager.ts:1250`), — а у нас это ответ
	// ПРАВИЛА приватности, которое считает сервер.
	CanMessage bool `json:"can_message,omitempty"`
}

// NewUsersUserFull собирает ответ из пары. Краткая форма — того же пользователя.
func NewUsersUserFull(full UserFull, user UserReal, canMessage bool) UsersUserFull {
	return UsersUserFull{
		Underscore: UsersUserFullTag,
		FullUser:   full,
		Chats:      []Chat{},
		Users:      []UserReal{user},
		CanMessage: canMessage,
	}
}

// ── Чёрный список ───────────────────────────────────────────────────────────

// Дискриминаторы `_` списочных ответов подсистемы.
const (
	PeerBlockedTag          = "peerBlocked"
	ContactsBlockedSliceTag = "contacts.blockedSlice"
	ContactsFoundTag        = "contacts.found"
)

// peerBlocked#e8fd8014 peer_id:Peer date:int = PeerBlocked;
//
// СТРОКА чёрного списка — ссылка на пир и когда заблокирован, а не снимок
// профиля. Профиль едет отдельным вектором users того же ответа: иначе внутри
// строки блокировки жила бы вторая форма того же `user`.
type PeerBlocked struct {
	Underscore string `json:"_"`
	PeerID     Peer   `json:"peer_id"`
	Date       int    `json:"date"`
}

func NewPeerBlocked(peer Peer, date time.Time) PeerBlocked {
	return PeerBlocked{Underscore: PeerBlockedTag, PeerID: peer, Date: unixSeconds(date)}
}

// contacts.blockedSlice#e1664194 count:int blocked:Vector<PeerBlocked>
// chats:Vector<Chat> users:Vector<User> = contacts.Blocked;
//
// Ответ СТРАНИЦЫ чёрного списка: count — размер полного набора, blocked —
// строки страницы, users — тела пиров.
type ContactsBlockedSlice struct {
	Underscore string        `json:"_"`
	Count      int           `json:"count"`
	Blocked    []PeerBlocked `json:"blocked"`
	Chats      []Chat        `json:"chats"`
	Users      []UserReal    `json:"users"`
}

func NewContactsBlockedSlice(count int, blocked []PeerBlocked, users []UserReal) ContactsBlockedSlice {
	if blocked == nil {
		blocked = []PeerBlocked{}
	}
	if users == nil {
		users = []UserReal{}
	}
	return ContactsBlockedSlice{
		Underscore: ContactsBlockedSliceTag,
		Count:      count, Blocked: blocked, Chats: []Chat{}, Users: users,
	}
}

// ── Поиск пиров ─────────────────────────────────────────────────────────────

// contacts.found#b3134d9d my_results:Vector<Peer> results:Vector<Peer>
// chats:Vector<Chat> users:Vector<User> = contacts.Found;
//
// Результаты поиска: СПИСОК ССЫЛОК на пиры плюс их тела. my_results — попадания
// среди своих (контакты/свои чаты); у нас такого разделения выдачи нет, поэтому
// вектор едет пустым, а не заполняется наугад.
type ContactsFound struct {
	Underscore string     `json:"_"`
	MyResults  []Peer     `json:"my_results"`
	Results    []Peer     `json:"results"`
	Chats      []Chat     `json:"chats"`
	Users      []UserReal `json:"users"`
}

func NewContactsFound(chats []Chat, users []UserReal) ContactsFound {
	results := make([]Peer, 0, len(chats)+len(users))
	for _, c := range chats {
		results = append(results, NewPeer(c.PeerID()))
	}
	for _, u := range users {
		results = append(results, NewPeerUser(u.ID))
	}
	if chats == nil {
		chats = []Chat{}
	}
	if users == nil {
		users = []UserReal{}
	}
	return ContactsFound{
		Underscore: ContactsFoundTag,
		MyResults:  []Peer{}, Results: results, Chats: chats, Users: users,
	}
}

// ── Общие мелочи разбора ────────────────────────────────────────────────────

// peekTag достаёт дискриминатор `_`. ok=false — значения нет вовсе (null,
// пустой вход, объект без `_`): вызывающий отдаёт nil, а не роняет разбор.
func peekTag(raw []byte) (tag string, ok bool, err error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", false, nil
	}
	var head struct {
		Underscore string `json:"_"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return "", false, err
	}
	if head.Underscore == "" {
		return "", false, nil
	}
	return head.Underscore, true, nil
}

// unmarshalCtor разбирает объект известного конструктора. Вызывающий отдаёт
// результат как значение объединения — на возвращаемом типе Go сам подставит
// интерфейс, а вывести его в параметрах помощника не умеет.
func unmarshalCtor[T any](raw []byte) (T, error) {
	var v T
	err := json.Unmarshal(raw, &v)
	return v, err
}

// unixSeconds — дата схемы (`int`, секунды эпохи). Нулевое время даёт 0:
// «даты нет».
func unixSeconds(t time.Time) int {
	if t.IsZero() {
		return 0
	}
	return int(t.Unix())
}
