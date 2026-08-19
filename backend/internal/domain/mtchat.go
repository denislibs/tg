package domain

import (
	"encoding/json"
	"time"
)

// Чаты и каналы в форме оригинала — конструкторы схемы TL (MTProto), а не
// строковый `Chat.Type` и не карточка `domain.ChatRecord`.
//
// Продолжение mtpeer.go: правила фазы 0, объяснение префикса MT и общий список
// «чего в модели нет» — в шапке того файла. Разбор подсистемы —
// docs/readiness/tl-peers-analysis.md.
//
// ── Вид чата: не поле, а выбор конструктора ─────────────────────────────────
// У нас вид чата был строкой из пяти значений и 89 инлайновых сравнений
// `type === '…'` в 27 файлах, без единого предиката. В схеме это разные
// конструкторы объединения Chat плюс булевы флаги, а у клиента — пять функций
// (isChannel/isBroadcast/isMegagroup/isForum/isAnyGroup).
//
// Наш вид чата ложится так:
//
//	'group'   → channel + pFlags.megagroup   (решение №2)
//	'channel' → channel + pFlags.broadcast
//	'private' → чата НЕТ вовсе: пир это собеседник (решение №1)
//	'saved'   → чата НЕТ вовсе: пир это сам зритель
//	'secret'  → не Chat, а объединение EncryptedChat (отдельный пункт программы)
//
// Решение №2 (группа это channel + megagroup) вынуждено схемой, а не вкусом:
// username, forum, slowmode и gigagroup в схеме есть ТОЛЬКО у channel, а наши
// группы всё это умеют. Базовый chat поэтому объявлен, но не производится —
// как peerChat в mtpeer.go и photoSizeProgressive в mtmedia.go.
//
// ── Права: pFlags, а не битмаск (решение №3) ────────────────────────────────
// `Rights int` и `MemberPerms int` разворачиваются в chatAdminRights и
// chatBannedRights. Роль отдельным полем НЕ заводится: creator это
// pFlags.creator, admin — наличие admin_rights.
//
// Внимание на инверсию: chatBannedRights это что НЕЛЬЗЯ, а наш MemberPerms —
// что МОЖНО. Наш же код это уже признаёт: MemberPerms.Denies (rights.go:47)
// трактует тот же битмаск как набор ЗАПРЕТОВ. Перевод делает NewChatBannedRights,
// и он единственный, кто про эту инверсию знает.

// ── Chat: chatEmpty | chat | chatForbidden | channel | channelForbidden ─────

// Chat — объединение схемы: chatEmpty | chat | chatForbidden | channel | channelForbidden.
type Chat interface {
	isChat()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
	// PeerID — знаковый ключ (у чата всегда отрицательный).
	PeerID() PeerID
}

// Значения дискриминатора `_` объединения Chat.
const (
	ChatEmptyTag        = "chatEmpty"
	ChatTag             = "chat"
	ChatForbiddenTag    = "chatForbidden"
	ChannelTag          = "channel"
	ChannelForbiddenTag = "channelForbidden"
)

// chatEmpty#29562865 id:long = Chat;
//
// «Чат недоступен»: id известен, тела нет. Производится, хотя базовый chat —
// нет: `channelEmpty` в схеме отсутствует, и заглушкой для ЛЮБОГО неизвестного
// чата служит именно chatEmpty (так же поступает tweb appChatsManager.getChat
// для неизвестного id).
type ChatEmpty struct {
	Underscore string `json:"_"`
	ID         int64  `json:"id"`
}

func (ChatEmpty) isChat()          {}
func (c ChatEmpty) Tag() string    { return c.Underscore }
func (c ChatEmpty) PeerID() PeerID { return ToPeerID(c.ID, true) }

func NewChatEmpty(id int64) ChatEmpty {
	return ChatEmpty{Underscore: ChatEmptyTag, ID: id}
}

// chat#41cbf256 flags:# creator:flags.0?true left:flags.2?true
// deactivated:flags.5?true call_active:flags.23?true call_not_empty:flags.24?true
// noforwards:flags.25?true id:long title:string photo:ChatPhoto
// participants_count:int date:int version:int migrated_to:flags.6?InputChannel
// admin_rights:flags.14?ChatAdminRights
// default_banned_rights:flags.18?ChatBannedRights = Chat;
//
// БАЗОВАЯ группа. ОБЪЯВЛЕНА, НО НЕ ПРОИЗВОДИТСЯ (решение №2): username, forum,
// slowmode и gigagroup в схеме есть только у channel, а наши группы это умеют,
// поэтому любая наша группа едет как channel + pFlags.megagroup. Структура
// нужна кодеку фазы 2: чужой кадр с базовым chat обязан пережить круг
// разбор → сборка. Конструирующей функции нет намеренно: собрать базовый chat
// можно только литералом, и такое место видно в коде.
//
// version не производится (реквизит синхронизации состояния MTProto),
// migrated_to — семейство Input*.
//
// Имя структуры с суффиксом Real: `Chat` в пакете занято уходящей моделью.
type ChatReal struct {
	Underscore        string            `json:"_"`
	PFlags            map[string]bool   `json:"pFlags,omitempty"`
	ID                int64             `json:"id"`
	Title             string            `json:"title"`
	Photo             ChatPhoto         `json:"photo"`
	ParticipantsCount int               `json:"participants_count"`
	Date              int               `json:"date"`
	AdminRights       *ChatAdminRights  `json:"admin_rights,omitempty"`
	DefaultBanned     *ChatBannedRights `json:"default_banned_rights,omitempty"`
}

func (ChatReal) isChat()          {}
func (c ChatReal) Tag() string    { return c.Underscore }
func (c ChatReal) PeerID() PeerID { return ToPeerID(c.ID, true) }

func (c ChatReal) Creator() bool     { return c.PFlags["creator"] }
func (c ChatReal) Left() bool        { return c.PFlags["left"] }
func (c ChatReal) Deactivated() bool { return c.PFlags["deactivated"] }

func (c *ChatReal) UnmarshalJSON(b []byte) error {
	type plain ChatReal
	var v struct {
		plain
		Photo json.RawMessage `json:"photo"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*c = ChatReal(v.plain)
	c.PFlags = keepPFlags(v.plain.PFlags, "creator", "left", "deactivated")
	photo, err := UnmarshalChatPhoto(v.Photo)
	if err != nil {
		return err
	}
	c.Photo = photo
	return nil
}

// chatForbidden#6592a1a7 id:long title:string = Chat;
//
// Базовая группа, из которой зрителя выкинули: остаются только id и заголовок.
// ОБЪЯВЛЕНА, НО НЕ ПРОИЗВОДИТСЯ — базовых чатов мы не производим вовсе
// (решение №2); нашему кадру `chat_removed` соответствует channelForbidden.
// Конструирующей функции нет намеренно — см. ChatReal.
type ChatForbidden struct {
	Underscore string `json:"_"`
	ID         int64  `json:"id"`
	Title      string `json:"title"`
}

func (ChatForbidden) isChat()          {}
func (c ChatForbidden) Tag() string    { return c.Underscore }
func (c ChatForbidden) PeerID() PeerID { return ToPeerID(c.ID, true) }

// ChannelFlags — булевы флаги channel в форме, удобной для вызова. Перечислены
// ровно те, у которых есть предмет:
//
//	Creator           — chat_members.role = 'creator' у зрителя
//	Left              — зритель не состоит в чате
//	Broadcast         — chats.type = 'channel'
//	Megagroup         — chats.type = 'group' (решение №2)
//	Signatures        — chats.signatures
//	SignatureProfiles — chats.signature_profiles
//	SlowmodeEnabled   — chats.slowmode_seconds > 0
//	Forum             — chats.is_forum
//	HasLink           — chats.discussion_chat_id не пуст
//
// Остальные булевы флаги схемы (verified, scam, fake, gigagroup, noforwards,
// join_to_send, join_request, has_geo, call_active, call_not_empty, monoforum,
// autotranslation, stories_*) предмета у нас не имеют — ни колонки, ни механики
// за ними нет, поэтому они не объявляются, а не выставляются наугад.
type ChannelFlags struct {
	Creator           bool
	Left              bool
	Broadcast         bool
	Megagroup         bool
	Signatures        bool
	SignatureProfiles bool
	SlowmodeEnabled   bool
	Forum             bool
	HasLink           bool
}

// channelFlagNames — что keepPFlags пропускает в модель на разборе.
var channelFlagNames = []string{
	"creator", "left", "broadcast", "megagroup", "signatures",
	"signature_profiles", "slowmode_enabled", "forum", "has_link",
}

// channel#1c32b11c flags:# creator:flags.0?true left:flags.2?true
// broadcast:flags.5?true megagroup:flags.8?true signatures:flags.11?true
// slowmode_enabled:flags.22?true forum:flags.30?true … id:long
// access_hash:flags.13?long title:string username:flags.6?string
// photo:ChatPhoto date:int admin_rights:flags.14?ChatAdminRights
// banned_rights:flags.15?ChatBannedRights
// default_banned_rights:flags.18?ChatBannedRights
// participants_count:flags.17?int … signature_profiles:flags2.12?true
// send_paid_messages_stars:flags2.14?long = Chat;
//
// И канал, и супергруппа — разница только в pFlags.broadcast/megagroup
// (решение №2). Это тот конструктор, который у нас производится всегда.
//
// AdminRights — права ЗРИТЕЛЯ в этом чате (наш ChatCard.MyRights); их наличие и
// есть признак «зритель админ», отдельного поля роли нет (решение №3).
// BannedRights — персональные ограничения ЗРИТЕЛЯ (MemberRestriction),
// DefaultBanned — ограничения обычного участника (chats.default_permissions).
//
// access_hash и pFlags.min не производятся (реквизиты транспорта),
// restriction_reason и pFlags.restricted — предмета нет.
type Channel struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int64           `json:"id"`
	Title      string          `json:"title"`
	Username   string          `json:"username,omitempty"`
	Photo      ChatPhoto       `json:"photo"`
	Date       int             `json:"date"`
	// AdminRights/BannedRights/DefaultBanned — flags.14/15/18.
	AdminRights   *ChatAdminRights  `json:"admin_rights,omitempty"`
	BannedRights  *ChatBannedRights `json:"banned_rights,omitempty"`
	DefaultBanned *ChatBannedRights `json:"default_banned_rights,omitempty"`
	// ParticipantsCount — flags.17?int: chats.member_count.
	ParticipantsCount int `json:"participants_count,omitempty"`
	// SendPaidMessagesStars — flags2.14?long: плата за сообщение в звёздах
	// (chats.charge_stars); 0 — выключено.
	SendPaidMessagesStars int64 `json:"send_paid_messages_stars,omitempty"`
}

func (Channel) isChat()          {}
func (c Channel) Tag() string    { return c.Underscore }
func (c Channel) PeerID() PeerID { return ToPeerID(c.ID, true) }

// Предикаты вида чата — порт tweb isChannel/isBroadcast/isMegagroup/isForum.
// Именно они заменяют 89 инлайновых сравнений `type === '…'`.
func (c Channel) Creator() bool           { return c.PFlags["creator"] }
func (c Channel) Left() bool              { return c.PFlags["left"] }
func (c Channel) Broadcast() bool         { return c.PFlags["broadcast"] }
func (c Channel) Megagroup() bool         { return c.PFlags["megagroup"] }
func (c Channel) Signatures() bool        { return c.PFlags["signatures"] }
func (c Channel) SignatureProfiles() bool { return c.PFlags["signature_profiles"] }
func (c Channel) SlowmodeEnabled() bool   { return c.PFlags["slowmode_enabled"] }
func (c Channel) Forum() bool             { return c.PFlags["forum"] }
func (c Channel) HasLink() bool           { return c.PFlags["has_link"] }

// Admin — зритель админ: признак это НАЛИЧИЕ admin_rights, а не роль
// (решение №3). Создатель отдельно: у него pFlags.creator.
func (c Channel) Admin() bool { return c.AdminRights != nil }

// NewChannel собирает канал/супергруппу. Обязательны id, title, photo и date —
// они сериализуются всегда, даже нулевыми.
func NewChannel(id int64, title string, photo ChatPhoto, date time.Time, f ChannelFlags) Channel {
	if photo == nil {
		photo = NewChatPhotoEmpty()
	}
	c := Channel{Underscore: ChannelTag, ID: id, Title: title, Photo: photo, Date: unixSeconds(date)}
	setPFlag(&c.PFlags, "creator", f.Creator)
	setPFlag(&c.PFlags, "left", f.Left)
	setPFlag(&c.PFlags, "broadcast", f.Broadcast)
	setPFlag(&c.PFlags, "megagroup", f.Megagroup)
	setPFlag(&c.PFlags, "signatures", f.Signatures)
	setPFlag(&c.PFlags, "signature_profiles", f.SignatureProfiles)
	setPFlag(&c.PFlags, "slowmode_enabled", f.SlowmodeEnabled)
	setPFlag(&c.PFlags, "forum", f.Forum)
	setPFlag(&c.PFlags, "has_link", f.HasLink)
	return c
}

func (c *Channel) UnmarshalJSON(b []byte) error {
	type plain Channel
	var v struct {
		plain
		Photo json.RawMessage `json:"photo"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*c = Channel(v.plain)
	c.PFlags = keepPFlags(v.plain.PFlags, channelFlagNames...)
	photo, err := UnmarshalChatPhoto(v.Photo)
	if err != nil {
		return err
	}
	c.Photo = photo
	return nil
}

// channelForbidden#17d493d5 flags:# broadcast:flags.5?true
// megagroup:flags.8?true monoforum:flags.10?true id:long access_hash:long
// title:string until_date:flags.16?int = Chat;
//
// Канал/супергруппа, куда зрителю больше нельзя: остаются id, заголовок и вид.
// UntilDate — срок бана (flags.16), отсутствует — навсегда.
//
// access_hash здесь ОБЯЗАТЕЛЕН по схеме и не производится: реквизит
// транспорта. Он назван в списке «нет предмета» сверки со схемой.
type ChannelForbidden struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int64           `json:"id"`
	Title      string          `json:"title"`
	UntilDate  int             `json:"until_date,omitempty"`
}

func (ChannelForbidden) isChat()           {}
func (c ChannelForbidden) Tag() string     { return c.Underscore }
func (c ChannelForbidden) PeerID() PeerID  { return ToPeerID(c.ID, true) }
func (c ChannelForbidden) Broadcast() bool { return c.PFlags["broadcast"] }
func (c ChannelForbidden) Megagroup() bool { return c.PFlags["megagroup"] }

// NewChannelForbidden — наш кадр `chat_removed`: зритель выпал из чата.
// untilDate нулевой — бан бессрочный.
func NewChannelForbidden(id int64, title string, broadcast, megagroup bool, untilDate time.Time) ChannelForbidden {
	c := ChannelForbidden{Underscore: ChannelForbiddenTag, ID: id, Title: title, UntilDate: unixSeconds(untilDate)}
	setPFlag(&c.PFlags, "broadcast", broadcast)
	setPFlag(&c.PFlags, "megagroup", megagroup)
	return c
}

func (c *ChannelForbidden) UnmarshalJSON(b []byte) error {
	type plain ChannelForbidden
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*c = ChannelForbidden(v)
	c.PFlags = keepPFlags(v.PFlags, "broadcast", "megagroup")
	return nil
}

// UnmarshalChat разбирает объединение Chat по дискриминатору `_`.
// Неизвестный конструктор — nil, nil.
func UnmarshalChat(raw []byte) (Chat, error) {
	tag, ok, err := peekTag(raw)
	if err != nil || !ok {
		return nil, err
	}
	switch tag {
	case ChatEmptyTag:
		v, err := unmarshalCtor[ChatEmpty](raw)
		return v, err
	case ChatTag:
		v, err := unmarshalCtor[ChatReal](raw)
		return v, err
	case ChatForbiddenTag:
		v, err := unmarshalCtor[ChatForbidden](raw)
		return v, err
	case ChannelTag:
		v, err := unmarshalCtor[Channel](raw)
		return v, err
	case ChannelForbiddenTag:
		v, err := unmarshalCtor[ChannelForbidden](raw)
		return v, err
	}
	return nil, nil
}

// ── ChatPhoto: chatPhotoEmpty | chatPhoto ───────────────────────────────────

// ChatPhoto — объединение схемы: chatPhotoEmpty | chatPhoto. Зеркало
// UserProfilePhoto для чатов.
type ChatPhoto interface {
	isChatPhoto()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// Значения дискриминатора `_` объединения ChatPhoto.
const (
	ChatPhotoEmptyTag = "chatPhotoEmpty"
	ChatPhotoTag      = "chatPhoto"
)

// chatPhotoEmpty#37c1011c = ChatPhoto;
type ChatPhotoEmpty struct {
	Underscore string `json:"_"`
}

func (ChatPhotoEmpty) isChatPhoto()  {}
func (p ChatPhotoEmpty) Tag() string { return p.Underscore }

func NewChatPhotoEmpty() ChatPhotoEmpty {
	return ChatPhotoEmpty{Underscore: ChatPhotoEmptyTag}
}

// chatPhoto#1c6e1c11 flags:# has_video:flags.0?true photo_id:long
// stripped_thumb:flags.1?bytes dc_id:int = ChatPhoto;
//
// PhotoID — наш chats.photo_media_id, StrippedThumb — blur_preview той же
// строки media. Три прежних поля (photo_media_id, photo_url, photo_preview)
// схлопываются сюда, и переходник с регуляркой по `/media/%d/content`
// становится не нужен.
//
// dc_id не производится: реквизит MTProto-транспорта.
type ChatPhotoReal struct {
	Underscore    string          `json:"_"`
	PFlags        map[string]bool `json:"pFlags,omitempty"`
	PhotoID       int64           `json:"photo_id"`
	StrippedThumb []byte          `json:"stripped_thumb,omitempty"`
}

func (ChatPhotoReal) isChatPhoto()     {}
func (p ChatPhotoReal) Tag() string    { return p.Underscore }
func (p ChatPhotoReal) HasVideo() bool { return p.PFlags["has_video"] }

func NewChatPhoto(photoID int64, strippedThumb []byte, hasVideo bool) ChatPhotoReal {
	p := ChatPhotoReal{Underscore: ChatPhotoTag, PhotoID: photoID, StrippedThumb: strippedThumb}
	setPFlag(&p.PFlags, "has_video", hasVideo)
	return p
}

func (p *ChatPhotoReal) UnmarshalJSON(b []byte) error {
	type plain ChatPhotoReal
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*p = ChatPhotoReal(v)
	p.PFlags = keepPFlags(v.PFlags, "has_video")
	return nil
}

// UnmarshalChatPhoto разбирает объединение ChatPhoto.
func UnmarshalChatPhoto(raw []byte) (ChatPhoto, error) {
	tag, ok, err := peekTag(raw)
	if err != nil || !ok {
		return nil, err
	}
	switch tag {
	case ChatPhotoEmptyTag:
		v, err := unmarshalCtor[ChatPhotoEmpty](raw)
		return v, err
	case ChatPhotoTag:
		v, err := unmarshalCtor[ChatPhotoReal](raw)
		return v, err
	}
	return nil, nil
}

// ── Права (решение №3) ──────────────────────────────────────────────────────

// Дискриминаторы `_` конструкторов прав.
const (
	ChatAdminRightsTag  = "chatAdminRights"
	ChatBannedRightsTag = "chatBannedRights"
)

// adminRightFlags — соответствие нашего битмаска Rights флагам схемы. Порядок
// фиксирован ради воспроизводимого вывода; имена — из схемы, а не свои.
var adminRightFlags = []struct {
	bit  Rights
	name string
}{
	{RightChangeInfo, "change_info"},
	{RightPostMessages, "post_messages"},
	{RightEditMessages, "edit_messages"},
	{RightDeleteMessages, "delete_messages"},
	{RightBanUsers, "ban_users"},
	{RightInviteUsers, "invite_users"},
	{RightPinMessages, "pin_messages"},
	{RightManageAdmins, "add_admins"},
}

var adminRightNames = flagNames(len(adminRightFlags), func(i int) string { return adminRightFlags[i].name })

// chatAdminRights#5fb224d5 flags:# change_info:flags.0?true
// post_messages:flags.1?true edit_messages:flags.2?true
// delete_messages:flags.3?true ban_users:flags.4?true invite_users:flags.5?true
// pin_messages:flags.7?true add_admins:flags.9?true anonymous:flags.10?true
// manage_call:flags.11?true other:flags.12?true manage_topics:flags.13?true
// post_stories:flags.14?true edit_stories:flags.15?true
// delete_stories:flags.16?true manage_direct_messages:flags.17?true
// manage_ranks:flags.18?true = ChatAdminRights;
//
// Единственный параметр конструктора — сама маска flags, поэтому объект целиком
// состоит из pFlags. Наличие admin_rights у чата и ЕСТЬ признак «зритель админ»
// (решение №3): роли отдельным полем больше нет.
//
// Восемь флагов имеют предмет — это ровно наш битмаск Rights. Остальные
// (anonymous, manage_call, other, manage_topics, post/edit/delete_stories,
// manage_direct_messages, manage_ranks) предмета не имеют: ни бита, ни механики.
type ChatAdminRights struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
}

// NewChatAdminRights переводит наш битмаск в конструктор схемы. Это
// единственное место, знающее соответствие бит → имя флага.
func NewChatAdminRights(r Rights) ChatAdminRights {
	out := ChatAdminRights{Underscore: ChatAdminRightsTag}
	for _, f := range adminRightFlags {
		setPFlag(&out.PFlags, f.name, r&f.bit == f.bit)
	}
	return out
}

// Rights собирает наш битмаск обратно — нужен там, где права ещё уходят в
// колонку chat_members.rights.
func (r ChatAdminRights) Rights() Rights {
	var out Rights
	for _, f := range adminRightFlags {
		if r.PFlags[f.name] {
			out |= f.bit
		}
	}
	return out
}

// Can — есть ли флаг схемы по имени. Именованные предикаты вида CanPostMessages
// здесь не заводятся: у оригинала обращение к правам тоже идёт по имени поля
// (`chat.admin_rights.pFlags.post_messages`).
func (r ChatAdminRights) Can(flag string) bool { return r.PFlags[flag] }

func (r *ChatAdminRights) UnmarshalJSON(b []byte) error {
	type plain ChatAdminRights
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*r = ChatAdminRights(v)
	r.PFlags = keepPFlags(v.PFlags, adminRightNames...)
	return nil
}

// bannedRightFlags — соответствие нашего MemberPerms флагам схемы. ВНИМАНИЕ на
// инверсию: MemberPerms это что МОЖНО, chatBannedRights — что НЕЛЬЗЯ. Бит,
// снятый в MemberPerms, даёт ВЫСТАВЛЕННЫЙ флаг запрета.
var bannedRightFlags = []struct {
	perm MemberPerms
	name string
}{
	{PermSendMessages, "send_messages"},
	{PermSendMedia, "send_media"},
	{PermAddMembers, "invite_users"},
	{PermPinMessages, "pin_messages"},
	{PermChangeInfo, "change_info"},
}

var bannedRightNames = flagNames(len(bannedRightFlags), func(i int) string { return bannedRightFlags[i].name })

// chatBannedRights#9f120418 flags:# view_messages:flags.0?true
// send_messages:flags.1?true send_media:flags.2?true send_stickers:flags.3?true
// send_gifs:flags.4?true send_games:flags.5?true send_inline:flags.6?true
// embed_links:flags.7?true send_polls:flags.8?true change_info:flags.10?true
// invite_users:flags.15?true pin_messages:flags.17?true
// manage_topics:flags.18?true … until_date:int = ChatBannedRights;
//
// Что участнику НЕЛЬЗЯ. UntilDate обязателен по схеме и сериализуется всегда:
// 0 означает «бессрочно» — ровно так его читает оригинал.
//
// Гранулярные запреты новых слоёв (send_photos/videos/roundvideos/audios/
// voices/docs/plain, send_stickers/gifs/games/inline/polls, embed_links,
// view_messages, manage_topics, edit_rank, send_reactions) предмета у нас не
// имеют: наш MemberPerms знает ровно пять разрешений.
type ChatBannedRights struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	UntilDate  int             `json:"until_date"`
}

// NewChatBannedRights переводит наши РАЗРЕШЕНИЯ в ЗАПРЕТЫ схемы. Нулевой until
// — бессрочно.
//
// ЛОВУШКА при вызове: тип MemberPerms в нашем коде носят ДВА поля с
// противоположным смыслом. ChatSettings.DefaultPerms (chats.default_permissions,
// дефолт 31 = AllMemberPerms) — что МОЖНО, и его сюда передают как есть.
// MemberRestriction.DeniedRights (rights.go: «what this member is NOT allowed
// to do») — уже что НЕЛЬЗЯ, то есть готовый ChatBannedRights; его надо
// перевернуть на входе: NewChatBannedRights(AllMemberPerms&^r.DeniedRights, …).
func NewChatBannedRights(allowed MemberPerms, until time.Time) ChatBannedRights {
	out := ChatBannedRights{Underscore: ChatBannedRightsTag, UntilDate: unixSeconds(until)}
	for _, f := range bannedRightFlags {
		setPFlag(&out.PFlags, f.name, allowed&f.perm != f.perm)
	}
	return out
}

// Allowed собирает наш MemberPerms обратно — снова разрешения, не запреты.
func (r ChatBannedRights) Allowed() MemberPerms {
	var out MemberPerms
	for _, f := range bannedRightFlags {
		if !r.PFlags[f.name] {
			out |= f.perm
		}
	}
	return out
}

// Denies — запрещает ли объект действие с именем схемы.
func (r ChatBannedRights) Denies(flag string) bool { return r.PFlags[flag] }

func (r *ChatBannedRights) UnmarshalJSON(b []byte) error {
	type plain ChatBannedRights
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*r = ChatBannedRights(v)
	r.PFlags = keepPFlags(v.PFlags, bannedRightNames...)
	return nil
}

// flagNames собирает список имён флагов для keepPFlags из таблицы соответствия
// — чтобы имя схемы было записано ровно один раз.
func flagNames(n int, at func(int) string) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = at(i)
	}
	return out
}

// ── ChatReactions ───────────────────────────────────────────────────────────

// ChatReactions — объединение схемы: chatReactionsNone | chatReactionsAll |
// chatReactionsSome. Наш ChatSettings.ReactionsMode ('none'|'all'|'some') это
// ровно выбор конструктора, а ReactionsAllowed — параметр третьего.
type ChatReactions interface {
	isChatReactions()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// Значения дискриминатора `_` объединения ChatReactions.
const (
	ChatReactionsNoneTag = "chatReactionsNone"
	ChatReactionsAllTag  = "chatReactionsAll"
	ChatReactionsSomeTag = "chatReactionsSome"
)

// chatReactionsNone#eafc32bc = ChatReactions;
type ChatReactionsNone struct {
	Underscore string `json:"_"`
}

func (ChatReactionsNone) isChatReactions() {}
func (r ChatReactionsNone) Tag() string    { return r.Underscore }

func NewChatReactionsNone() ChatReactionsNone {
	return ChatReactionsNone{Underscore: ChatReactionsNoneTag}
}

// chatReactionsAll#52928bca flags:# allow_custom:flags.0?true = ChatReactions;
//
// pFlags.allow_custom (разрешены ли кастом-эмодзи) объявлен, но не
// производится: подсистемы кастом-эмодзи у нас пока нет — та же причина, что у
// emoji_status (решение №6).
type ChatReactionsAll struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
}

func (ChatReactionsAll) isChatReactions()    {}
func (r ChatReactionsAll) Tag() string       { return r.Underscore }
func (r ChatReactionsAll) AllowCustom() bool { return r.PFlags["allow_custom"] }

func NewChatReactionsAll(allowCustom bool) ChatReactionsAll {
	r := ChatReactionsAll{Underscore: ChatReactionsAllTag}
	setPFlag(&r.PFlags, "allow_custom", allowCustom)
	return r
}

func (r *ChatReactionsAll) UnmarshalJSON(b []byte) error {
	type plain ChatReactionsAll
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*r = ChatReactionsAll(v)
	r.PFlags = keepPFlags(v.PFlags, "allow_custom")
	return nil
}

// chatReactionsSome#661d4037 reactions:Vector<Reaction> = ChatReactions;
//
// Разрешён список реакций. Вектор обязателен по схеме: пустой это [], а не null.
type ChatReactionsSome struct {
	Underscore string    `json:"_"`
	Reactions  Reactions `json:"reactions"`
}

func (ChatReactionsSome) isChatReactions() {}
func (r ChatReactionsSome) Tag() string    { return r.Underscore }

// NewChatReactionsSome собирает список из наших эмодзи-строк
// (ChatSettings.ReactionsAllowed).
func NewChatReactionsSome(emoticons []string) ChatReactionsSome {
	out := make(Reactions, 0, len(emoticons))
	for _, e := range emoticons {
		out = append(out, NewReactionEmoji(e))
	}
	return ChatReactionsSome{Underscore: ChatReactionsSomeTag, Reactions: out}
}

func (r *ChatReactionsSome) UnmarshalJSON(b []byte) error {
	type plain ChatReactionsSome
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*r = ChatReactionsSome(v)
	if r.Reactions == nil {
		r.Reactions = Reactions{}
	}
	return nil
}

// UnmarshalChatReactions разбирает объединение ChatReactions.
func UnmarshalChatReactions(raw []byte) (ChatReactions, error) {
	tag, ok, err := peekTag(raw)
	if err != nil || !ok {
		return nil, err
	}
	switch tag {
	case ChatReactionsNoneTag:
		v, err := unmarshalCtor[ChatReactionsNone](raw)
		return v, err
	case ChatReactionsAllTag:
		v, err := unmarshalCtor[ChatReactionsAll](raw)
		return v, err
	case ChatReactionsSomeTag:
		v, err := unmarshalCtor[ChatReactionsSome](raw)
		return v, err
	}
	return nil, nil
}

// Reaction — объединение схемы: reactionEmpty | reactionEmoji |
// reactionCustomEmoji | reactionPaid.
//
// Здесь заведён ОДИН конструктор — reactionEmoji: без него обязательный вектор
// chatReactionsSome.reactions было бы нечем наполнить. Полное объединение
// Reaction (и перевод на него ReactionCount/SavedTag/платных реакций) — своя
// подсистема программы; когда до неё дойдёт очередь, объявление переедет туда.
type Reaction interface {
	isReaction()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// ReactionEmojiTag — дискриминатор `_` конструктора reactionEmoji.
const ReactionEmojiTag = "reactionEmoji"

// reactionEmoji#1b2286b8 emoticon:string = Reaction;
type ReactionEmoji struct {
	Underscore string `json:"_"`
	Emoticon   string `json:"emoticon"`
}

func (ReactionEmoji) isReaction()   {}
func (r ReactionEmoji) Tag() string { return r.Underscore }

func NewReactionEmoji(emoticon string) ReactionEmoji {
	return ReactionEmoji{Underscore: ReactionEmojiTag, Emoticon: emoticon}
}

// Reactions — Vector<Reaction>. Именованный тип нужен ради UnmarshalJSON: в
// объединение по дискриминатору encoding/json сам не умеет.
type Reactions []Reaction

// UnmarshalJSON разбирает вектор, ветвясь по дискриминатору `_`. Элемент с
// неизвестным конструктором отбрасывается, а не роняет весь список: политика
// реакций чата важнее одной незнакомой реакции из чужого слоя.
func (rs *Reactions) UnmarshalJSON(raw []byte) error {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return err
	}
	out := make(Reactions, 0, len(items))
	for _, item := range items {
		tag, ok, err := peekTag(item)
		if err != nil {
			return err
		}
		if !ok || tag != ReactionEmojiTag {
			continue
		}
		v, err := unmarshalCtor[ReactionEmoji](item)
		if err != nil {
			return err
		}
		out = append(out, v)
	}
	*rs = out
	return nil
}

// ── ChatFull / ChannelFull ──────────────────────────────────────────────────

// Дискриминаторы `_` полных карточек.
const (
	ChatFullTag    = "chatFull"
	ChannelFullTag = "channelFull"
)

// chatFull#2633421b flags:# can_set_username:flags.7?true
// has_scheduled:flags.8?true translations_disabled:flags.19?true id:long
// about:string participants:ChatParticipants chat_photo:flags.2?Photo
// notify_settings:PeerNotifySettings exported_invite:flags.13?ExportedChatInvite
// bot_info:flags.3?Vector<BotInfo> pinned_msg_id:flags.6?int … = ChatFull;
//
// Полная карточка БАЗОВОЙ группы. ОБЪЯВЛЕНА, НО НЕ ПРОИЗВОДИТСЯ — базового chat
// мы не производим (решение №2), любая наша группа отдаёт channelFull.
//
// Обязательные participants:ChatParticipants и notify_settings:
// PeerNotifySettings не производятся; причины — в списке «нет предмета».
// Конструирующей функции нет намеренно — см. ChatReal.
type ChatFull struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int64           `json:"id"`
	About      string          `json:"about"`
	// PinnedMsgID — flags.6?int; 0 — закреплённого нет.
	PinnedMsgID int `json:"pinned_msg_id,omitempty"`
}

func (f *ChatFull) UnmarshalJSON(b []byte) error {
	type plain ChatFull
	var v plain
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*f = ChatFull(v)
	f.PFlags = keepPFlags(v.PFlags, "can_set_username")
	return nil
}

// channelFull#a04e8d3a flags:# hidden_prehistory:flags.10?true … id:long
// about:string participants_count:flags.0?int … read_inbox_max_id:int
// read_outbox_max_id:int unread_count:int chat_photo:Photo
// notify_settings:PeerNotifySettings bot_info:Vector<BotInfo>
// pinned_msg_id:flags.5?int folder_id:flags.11?int linked_chat_id:flags.14?long
// slowmode_seconds:flags.17?int stats_dc:flags.12?int pts:int
// ttl_period:flags.24?int available_reactions:flags.30?ChatReactions
// send_paid_messages_stars:flags2.21?long = ChatFull;
//
// Полная карточка канала/супергруппы — то, что открывается один раз на экране
// информации, в отличие от channel, который едет со списком диалогов. Здесь
// живут настройки экрана «Изменить» (наш ChatSettings) и горизонты чтения.
//
// ChatPhoto здесь — ПОЛНОЕ Photo с лестницей размеров (mtmedia.go), а не
// chatPhoto с одним id: экран информации открывает аватарку в медиавьювере.
// Параметр обязателен, и «фото нет» пока едет как null: в оригинале на этом
// месте стоял бы photoEmpty, но объединение Photo относится к подсистеме
// медиа, где photoEmpty не объявлен (domain.Photo там — структура, а не
// объединение). Шов закроется вместе с ним; здесь его чинить нечем.
//
// pts и stats_dc не производятся (реквизиты синхронизации и статистики
// MTProto); обязательные notify_settings и bot_info — см. список «нет предмета».
type ChannelFull struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	ID         int64           `json:"id"`
	About      string          `json:"about"`
	// ReadInboxMaxID/ReadOutboxMaxID/UnreadCount обязательны по схеме и
	// сериализуются всегда, даже нулевыми: у нас это last_read_seq зрителя,
	// горизонт чтения другой стороны и счётчик непрочитанного.
	ReadInboxMaxID  int64  `json:"read_inbox_max_id"`
	ReadOutboxMaxID int64  `json:"read_outbox_max_id"`
	UnreadCount     int    `json:"unread_count"`
	ChatPhoto       *Photo `json:"chat_photo"`
	// ParticipantsCount — flags.0?int: chats.member_count.
	ParticipantsCount int `json:"participants_count,omitempty"`
	// PinnedMsgID — flags.5?int; 0 — закреплённого нет.
	PinnedMsgID int `json:"pinned_msg_id,omitempty"`
	// LinkedChatID — flags.14?long: наш chats.discussion_chat_id (чат
	// обсуждения канала). 0 — обсуждения нет.
	LinkedChatID int64 `json:"linked_chat_id,omitempty"`
	// SlowmodeSeconds — flags.17?int: chats.slowmode_seconds; 0 — выключен.
	SlowmodeSeconds int `json:"slowmode_seconds,omitempty"`
	// TTLPeriod — flags.24?int: chats.auto_delete_period; 0 — выключено.
	TTLPeriod int `json:"ttl_period,omitempty"`
	// AvailableReactions — flags.30?ChatReactions: политика реакций чата.
	AvailableReactions ChatReactions `json:"available_reactions,omitempty"`
	// SendPaidMessagesStars — flags2.21?long: chats.charge_stars; 0 — выключено.
	SendPaidMessagesStars int64 `json:"send_paid_messages_stars,omitempty"`
}

// HiddenPrehistory — история чата скрыта от новых участников; наш
// chats.history_for_new с обратным знаком.
func (f ChannelFull) HiddenPrehistory() bool { return f.PFlags["hidden_prehistory"] }

// NewChannelFull собирает полную карточку. Обязательные по схеме параметры
// (about, горизонты чтения, unread_count, chat_photo) едут всегда, даже
// нулевыми; photo == nil означает «фото нет».
func NewChannelFull(id int64, about string, photo *Photo, hiddenPrehistory bool) ChannelFull {
	f := ChannelFull{Underscore: ChannelFullTag, ID: id, About: about, ChatPhoto: photo}
	setPFlag(&f.PFlags, "hidden_prehistory", hiddenPrehistory)
	return f
}

func (f *ChannelFull) UnmarshalJSON(b []byte) error {
	type plain ChannelFull
	var v struct {
		plain
		AvailableReactions json.RawMessage `json:"available_reactions"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*f = ChannelFull(v.plain)
	f.PFlags = keepPFlags(v.plain.PFlags, "hidden_prehistory")
	reactions, err := UnmarshalChatReactions(v.AvailableReactions)
	if err != nil {
		return err
	}
	f.AvailableReactions = reactions
	return nil
}

// ── messages.chatFull ───────────────────────────────────────────────────────

// MessagesChatFullTag — дискриминатор `_` конструктора messages.chatFull.
const MessagesChatFullTag = "messages.chatFull"

// messages.chatFull#e5d7d19c full_chat:ChatFull chats:Vector<Chat>
// users:Vector<User> = messages.ChatFull;
//
// ОТВЕТ экрана информации о чате: полная карточка ВМЕСТЕ с краткой формой
// самого чата. Прежде `GET /chats/{id}/card` и кадр chat_update отдавали одну и
// ту же ChatCard в двух разных формах — плоско с id против вложенно; здесь обе
// стороны собирают один и тот же ответ.
//
// Users обязателен по схеме и едет пустым вектором: карточек ботов чата
// (bot_info) мы не производим, а участники — своя ручка со страницами.
type MessagesChatFull struct {
	Underscore string      `json:"_"`
	FullChat   ChannelFull `json:"full_chat"`
	Chats      []Chat      `json:"chats"`
	Users      []UserReal  `json:"users"`
}

// NewMessagesChatFull собирает ответ из пары конструкторов одного чата.
func NewMessagesChatFull(full ChannelFull, chat Chat) MessagesChatFull {
	return MessagesChatFull{
		Underscore: MessagesChatFullTag,
		FullChat:   full,
		Chats:      []Chat{chat},
		Users:      []UserReal{},
	}
}
