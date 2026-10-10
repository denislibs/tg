package domain

import "time"

// Участники чата как ВЫБОРКА (channels.getParticipants): фильтр, строка и
// счётчики полной карточки. Конструкторы провода — в mtparticipant.go.

// ParticipantsFilterKind — фильтр ChannelParticipantsFilter схемы
// (channelParticipantsRecent/Admins/Kicked/Banned/Bots/Search/Contacts/
// Mentions), на проводе ручки — короткое имя без префикса.
type ParticipantsFilterKind string

const (
	ParticipantsRecent   ParticipantsFilterKind = "recent"
	ParticipantsAdmins   ParticipantsFilterKind = "admins"
	ParticipantsKicked   ParticipantsFilterKind = "kicked"
	ParticipantsBanned   ParticipantsFilterKind = "banned"
	ParticipantsBots     ParticipantsFilterKind = "bots"
	ParticipantsSearch   ParticipantsFilterKind = "search"
	ParticipantsContacts ParticipantsFilterKind = "contacts"
	ParticipantsMentions ParticipantsFilterKind = "mentions"
)

// Valid — фильтр из перечисления схемы.
func (k ParticipantsFilterKind) Valid() bool {
	switch k {
	case ParticipantsRecent, ParticipantsAdmins, ParticipantsKicked, ParticipantsBanned,
		ParticipantsBots, ParticipantsSearch, ParticipantsContacts, ParticipantsMentions:
		return true
	}
	return false
}

// ParticipantsFilter — фильтр со своими параметрами: q (поиск по имени и
// @username — у Kicked/Banned/Search/Contacts/Mentions/Admins) и top_msg_id
// (Mentions: сначала писавшие в этом треде).
type ParticipantsFilter struct {
	Kind     ParticipantsFilterKind
	Q        string
	TopMsgID int64
}

// Participant — строка выборки участников: членство (Member) и, если есть,
// бан или ограничение. Выгнанный не участник — у него Member без роли и Kicked.
type Participant struct {
	Member
	// Kicked — в списке удалённых (chat_bans): кто и когда.
	Kicked   bool
	KickedBy int64
	KickedAt time.Time
	// Restriction — действующее личное ограничение участника.
	Restriction *MemberRestriction
}

// ToChannelParticipant — конструктор строки глазами зрителя. Выгнанный и
// ограниченный — channelParticipantBanned (разница во флаге left); чужое
// ограничение видит только зритель с ban_users (v.CanBan), остальным
// ограниченный — обычный участник: кем, что и до какого срока запрещено,
// раскрывать всем читателям нельзя (ревью #404, п. 2).
func (p Participant) ToChannelParticipant(v ParticipantViewer) ChannelParticipant {
	if p.Kicked {
		// Кто и когда исключил — тоже сведения админа с ban_users: остальным
		// (админ без ban_users в кадре участника) — просто «вышел» (ревью #409 п. 4).
		if !v.CanBan && v.ID != p.UserID {
			return NewChannelParticipantLeft(p.UserID)
		}
		return NewChannelParticipantBanned(p.UserID, p.KickedBy, unixSecondsInt64(p.KickedAt), AllMemberPerms, time.Time{}, true)
	}
	if r := p.Restriction; r != nil && (p.Role == RoleMember || p.Role == RoleSubscriber) &&
		(v.CanBan || v.ID == p.UserID) {
		var until time.Time
		if r.UntilDate != nil {
			until = *r.UntilDate
		}
		return NewChannelParticipantBanned(p.UserID, r.RestrictedBy, unixSecondsInt64(r.CreatedAt), r.DeniedRights, until, false)
	}
	return NewChannelParticipant(p.Member, v)
}

// ParticipantCounters — счётчики полной карточки (channelFull admins_count,
// kicked_count, banned_count, requests_pending, recent_requesters). Кто какие
// видит, решает usecase (ChatCard): kicked/banned — ban_users, заявки —
// invite_users. Снимок chat_update без зрителя их не несёт вовсе.
type ParticipantCounters struct {
	Admins int
	// Kicked/Banned — nil, когда зрителю не положено (у схемы один бит на оба).
	Kicked *int
	Banned *int
	// RequestsPending/RecentRequesters — nil/пусто, когда не положено или заявок нет.
	RequestsPending  *int
	RecentRequesters []int64
	// CanViewParticipants — pFlags.can_view_participants (tweb hasRights
	// view_participants): участник группы или админ канала.
	CanViewParticipants bool
}

// ViewerBannedRights — channel.banned_rights зрителя: ДЕЙСТВУЮЩИЕ запреты,
// как их отдаёт сервер Telegram, — личные ∪ запреты чата по умолчанию, срок —
// личного ограничения (запреты по умолчанию бессрочны). Клиент оригинала их
// НЕ объединяет: tweb hasRights.ts:41 берёт `admin_rights || banned_rights ||
// default_banned_rights` как есть, поэтому объединяет сервер. При смене прав
// по умолчанию ограниченным уходит свежий снимок (republishRestricted,
// фоном). nil — личного ограничения нет или оно истекло.
func ViewerBannedRights(r *MemberRestriction, defaultPerms MemberPerms, now time.Time) *ChatBannedRights {
	if r == nil || !r.Active(now) {
		return nil
	}
	var until time.Time
	if r.UntilDate != nil {
		until = *r.UntilDate
	}
	br := NewChatBannedRights(defaultPerms&^r.DeniedRights, until)
	return &br
}
