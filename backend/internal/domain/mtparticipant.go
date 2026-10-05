package domain

import "time"

// Участник чата: РОЛЬ — это выбор конструктора, а не строка в записи.
//
// Наша витрина отдавала `{user_id, role: "admin", status: …}`, то есть вид
// участника СТРОКОЙ — та же болезнь, что программа снимала у типа сообщения,
// вида кнопки, вида чата и ключа приватности. В схеме это объединение
// `ChannelParticipant`: создатель, админ, обычный участник, забаненный и
// ушедший — пять РАЗНЫХ конструкторов, и права висят на том из них, у которого
// они бывают.
//
// Присутствие (`status`) из строки участника уходит: у оригинала оно живёт на
// карточке пользователя (`user.status`), а карточки едут вектором `users` того
// же контейнера. Держать статус на участнике значило бы иметь два дома у одного
// факта — ровно то, из-за чего он разъезжался.

// Значения дискриминатора `_` объединения ChannelParticipant.
const (
	ChannelParticipantTag        = "channelParticipant"
	ChannelParticipantSelfTag    = "channelParticipantSelf"
	ChannelParticipantCreatorTag = "channelParticipantCreator"
	ChannelParticipantAdminTag   = "channelParticipantAdmin"
	ChannelParticipantBannedTag  = "channelParticipantBanned"
	ChannelParticipantLeftTag    = "channelParticipantLeft"
)

// ChannelParticipant — объединение участников.
type ChannelParticipant interface {
	isChannelParticipant()
	// Tag — дискриминатор `_` (predicate схемы).
	Tag() string
}

// channelParticipant#1bd54456 flags:# user_id:long date:int
// subscription_until_date:flags.0?int rank:flags.2?string = ChannelParticipant;
//
// Обычный участник: прав у него нет, и это выражено ОТСУТСТВИЕМ параметра прав
// у конструктора, а не пустой маской.
type ChannelParticipantReal struct {
	Underscore string `json:"_"`
	UserID     int64  `json:"user_id"`
	Date       int64  `json:"date"`
}

func (ChannelParticipantReal) isChannelParticipant() {}
func (p ChannelParticipantReal) Tag() string         { return p.Underscore }

// channelParticipantCreator#2fe601d3 flags:# user_id:long
// admin_rights:ChatAdminRights rank:flags.0?string = ChannelParticipant;
//
// Создатель: права ОБЯЗАТЕЛЬНЫ (он может всё), даты вступления у конструктора
// нет вовсе — он в чате с самого начала.
type ChannelParticipantCreator struct {
	Underscore  string          `json:"_"`
	UserID      int64           `json:"user_id"`
	AdminRights ChatAdminRights `json:"admin_rights"`
	Rank        string          `json:"rank,omitempty"`
}

func (ChannelParticipantCreator) isChannelParticipant() {}
func (p ChannelParticipantCreator) Tag() string         { return p.Underscore }

// channelParticipantSelf#a9478a1a flags:# via_request:flags.0?true
// user_id:long inviter_id:long date:int subscription_until_date:flags.1?int
// rank:flags.2?string = ChannelParticipant;
//
// Сам ЗРИТЕЛЬ, когда он обычный участник: у оригинала строка про себя несёт
// то, чего о других не говорят, — кто привёл (inviter_id) и вошёл ли он
// одобренной заявкой (via_request). Себя создатель/админ видит своими
// конструкторами (у админа — бит self).
type ChannelParticipantSelf struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	UserID     int64           `json:"user_id"`
	InviterID  int64           `json:"inviter_id"`
	Date       int64           `json:"date"`
}

func (ChannelParticipantSelf) isChannelParticipant() {}
func (p ChannelParticipantSelf) Tag() string         { return p.Underscore }

// channelParticipantAdmin#34c3bb53 flags:# can_edit:flags.0?true self:flags.1?true
// user_id:long inviter_id:flags.1?long promoted_by:long date:int
// admin_rights:ChatAdminRights rank:flags.2?string = ChannelParticipant;
//
// Админ: права обязательны, плюс обязателен `promoted_by` — кто назначил
// (Б-117). Зритель-зависимы два бита: can_edit — зритель вправе править этого
// админа (tweb canEditAdmin: создатель ∨ назначил он), self — это сам зритель.
// inviter_id делит бит с self: кто привёл, схема говорит только самому админу.
type ChannelParticipantAdmin struct {
	Underscore  string          `json:"_"`
	PFlags      map[string]bool `json:"pFlags,omitempty"`
	UserID      int64           `json:"user_id"`
	InviterID   int64           `json:"inviter_id,omitempty"`
	PromotedBy  int64           `json:"promoted_by"`
	Date        int64           `json:"date"`
	AdminRights ChatAdminRights `json:"admin_rights"`
	Rank        string          `json:"rank,omitempty"`
}

func (ChannelParticipantAdmin) isChannelParticipant() {}
func (p ChannelParticipantAdmin) Tag() string         { return p.Underscore }

// channelParticipantLeft#1b03f006 peer:Peer = ChannelParticipant;
//
// Ушёл сам или выгнан без бана: в кадре updateChannelParticipant это
// new_participant выхода (у оригинала — то же).
type ChannelParticipantLeft struct {
	Underscore string `json:"_"`
	Peer       Peer   `json:"peer"`
}

func (ChannelParticipantLeft) isChannelParticipant() {}
func (p ChannelParticipantLeft) Tag() string         { return p.Underscore }

func NewChannelParticipantLeft(userID int64) ChannelParticipantLeft {
	return ChannelParticipantLeft{Underscore: ChannelParticipantLeftTag, Peer: NewPeerUser(userID)}
}

// channelParticipantBanned#d5f0ad91 flags:# left:flags.0?true peer:Peer
// kicked_by:long date:int banned_rights:ChatBannedRights rank:flags.2?string
// = ChannelParticipant;
//
// Забаненный или ограниченный — ОДИН конструктор: разница между «выгнан» и
// «ограничен, но в чате» выражена флагом `left`, а чем именно ограничен —
// маской `banned_rights`. У нас это были ДВА разных списка (`bans` и
// `restrictions`) с разной формой строки.
type ChannelParticipantBanned struct {
	Underscore   string           `json:"_"`
	PFlags       map[string]bool  `json:"pFlags,omitempty"`
	Peer         Peer             `json:"peer"`
	KickedBy     int64            `json:"kicked_by"`
	Date         int64            `json:"date"`
	BannedRights ChatBannedRights `json:"banned_rights"`
}

func (ChannelParticipantBanned) isChannelParticipant() {}
func (p ChannelParticipantBanned) Tag() string         { return p.Underscore }

// ParticipantViewer — кто смотрит на участника. От него зависят три вещи
// схемы: бит can_edit у админа (tweb canEditAdmin), бит self и строка самого
// зрителя — channelParticipantSelf вместо безымянного channelParticipant.
type ParticipantViewer struct {
	ID        int64
	IsCreator bool
}

// NewChannelParticipant — участник по роли: выбор конструктора делает РОЛЬ.
//
// `date` — когда вступил (Member.JoinedAt). У создателя параметра нет вовсе.
func NewChannelParticipant(m Member, v ParticipantViewer) ChannelParticipant {
	date := unixSecondsInt64(m.JoinedAt)
	switch m.Role {
	case RoleCreator:
		return ChannelParticipantCreator{
			Underscore:  ChannelParticipantCreatorTag,
			UserID:      m.UserID,
			AdminRights: NewChatAdminRights(m.Rights),
			Rank:        m.Rank,
		}
	case RoleAdmin:
		a := ChannelParticipantAdmin{
			Underscore:  ChannelParticipantAdminTag,
			UserID:      m.UserID,
			PromotedBy:  m.PromotedBy,
			Date:        date,
			AdminRights: NewChatAdminRights(m.Rights),
			Rank:        m.Rank,
		}
		setPFlag(&a.PFlags, "can_edit", v.ID != m.UserID && (v.IsCreator || (m.PromotedBy != 0 && m.PromotedBy == v.ID)))
		if v.ID == m.UserID {
			setPFlag(&a.PFlags, "self", true)
			a.InviterID = m.inviter()
		}
		return a
	default:
		if v.ID != 0 && v.ID == m.UserID {
			s := ChannelParticipantSelf{
				Underscore: ChannelParticipantSelfTag,
				UserID:     m.UserID,
				InviterID:  m.inviter(),
				Date:       date,
			}
			setPFlag(&s.PFlags, "via_request", m.ViaRequest)
			return s
		}
		return ChannelParticipantReal{
			Underscore: ChannelParticipantTag,
			UserID:     m.UserID,
			Date:       date,
		}
	}
}

// inviter — обязательный inviter_id строки про себя: кто привёл, а вошедший
// сам (по @имени, создатель) — он же и привёл, как у оригинала.
func (m Member) inviter() int64 {
	if m.InviterID != 0 {
		return m.InviterID
	}
	return m.UserID
}

func unixSecondsInt64(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.Unix()
}

// NewChannelParticipantBanned — выгнанный (`left`) или ограниченный.
//
// Один конструктор на оба случая: «выгнан» это `pFlags.left`, а ограничения —
// маска запретов. Пустая маска у выгнанного не значит «ему всё можно»: его в
// чате нет.
func NewChannelParticipantBanned(userID, kickedBy, date int64, denied MemberPerms, until time.Time, left bool) ChannelParticipantBanned {
	var flags map[string]bool
	if left {
		flags = map[string]bool{"left": true}
	}
	return ChannelParticipantBanned{
		Underscore: ChannelParticipantBannedTag,
		PFlags:     flags,
		Peer:       NewPeerUser(userID),
		KickedBy:   kickedBy,
		Date:       date,
		// Ловушка перевода названа в докблоке NewChatBannedRights: на вход ему
		// идут РАЗРЕШЕНИЯ, а у нас на руках запреты.
		BannedRights: NewChatBannedRights(AllMemberPerms&^denied, until),
	}
}

// ── channels.channelParticipants: контейнер списка ─────────────────────────

const ChannelsChannelParticipantsTag = "channels.channelParticipants"

// channels.channelParticipants#9ab0feaf count:int
// participants:Vector<ChannelParticipant> chats:Vector<Chat> users:Vector<User>
// = channels.ChannelParticipants;
//
// `users` — карточки участников, и присутствие живёт ИМЕННО там
// (`user.status`), а не строкой участника.
type ChannelsChannelParticipants struct {
	Underscore   string               `json:"_"`
	Count        int                  `json:"count"`
	Participants []ChannelParticipant `json:"participants"`
	Chats        []Chat               `json:"chats"`
	Users        []UserReal           `json:"users"`
}

func NewChannelsChannelParticipants(count int, participants []ChannelParticipant, users []UserReal) ChannelsChannelParticipants {
	return ChannelsChannelParticipants{
		Underscore:   ChannelsChannelParticipantsTag,
		Count:        count,
		Participants: orEmpty(participants),
		Chats:        []Chat{},
		Users:        orEmpty(users),
	}
}

// ── channels.channelParticipant: один участник ─────────────────────────────

const ChannelsChannelParticipantTag = "channels.channelParticipant"

// channels.channelParticipant#dfb80317 participant:ChannelParticipant
// chats:Vector<Chat> users:Vector<User> = channels.ChannelParticipant;
//
// Ответ channels.getParticipant: участник по ключу плюс карточки тех, кого
// строка называет (сам он, назначивший, пригласивший).
type ChannelsChannelParticipant struct {
	Underscore  string             `json:"_"`
	Participant ChannelParticipant `json:"participant"`
	Chats       []Chat             `json:"chats"`
	Users       []UserReal         `json:"users"`
}

func NewChannelsChannelParticipant(p ChannelParticipant, users []UserReal) ChannelsChannelParticipant {
	return ChannelsChannelParticipant{
		Underscore:  ChannelsChannelParticipantTag,
		Participant: p,
		Chats:       []Chat{},
		Users:       orEmpty(users),
	}
}
