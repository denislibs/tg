package domain

import "time"

// Ссылка-приглашение и те, кто по ней пришёл.
//
// Наша витрина отдавала `{token, url, uses, requires_approval, expires_at,
// title, usage_limit, revoked}` — плоскую запись, где вид ссылки («отозвана»,
// «нужно одобрение») выражался булевыми полями, а адрес ехал ДВАЖДЫ: токеном и
// собранной из него строкой.
//
// В схеме это `chatInviteExported`: адрес — параметр `link` (один), а признаки
// живут в `pFlags`, где «выключено» это ОТСУТСТВИЕ ключа.

const (
	ChatInviteExportedTag          = "chatInviteExported"
	ChatInviteImporterTag          = "chatInviteImporter"
	MessagesExportedChatInviteTag  = "messages.exportedChatInvite"
	MessagesExportedInvitesTag     = "messages.exportedChatInvites"
	MessagesChatInviteImportersTag = "messages.chatInviteImporters"
)

// chatInviteExported#a22cbd96 flags:# revoked:flags.0?true permanent:flags.5?true
// request_needed:flags.6?true link:string admin_id:long date:int
// start_date:flags.4?int expire_date:flags.1?int usage_limit:flags.2?int
// usage:flags.3?int requested:flags.7?int title:flags.8?string
// = ExportedChatInvite;
//
// `link` — ЕДИНСТВЕННЫЙ адрес ссылки: токен из витрины исчез, потому что он и
// есть хвост этой строки. `admin_id` — кто её создал, `date` — когда.
type ChatInviteExported struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Link       string          `json:"link"`
	AdminID    int64           `json:"admin_id"`
	Date       int             `json:"date"`
	// ExpireDate — flags.1?int: срок в секундах эпохи; нет параметра — бессрочно.
	ExpireDate int `json:"expire_date,omitempty"`
	// UsageLimit — flags.2?int: сколько раз можно войти; нет — без лимита.
	UsageLimit int `json:"usage_limit,omitempty"`
	// Usage — flags.3?int: сколько раз уже вошли.
	Usage int `json:"usage,omitempty"`
	// Title — flags.8?string: имя ссылки.
	Title string `json:"title,omitempty"`
}

// NewChatInviteExported переводит нашу запись в конструктор.
func NewChatInviteExported(l InviteLink) ChatInviteExported {
	out := ChatInviteExported{
		Underscore: ChatInviteExportedTag,
		Link:       "/join/" + l.Token,
		AdminID:    l.CreatedBy,
		Date:       unixSeconds(l.CreatedAt),
		Usage:      l.Uses,
		Title:      l.Title,
	}
	setPFlag(&out.PFlags, "revoked", l.Revoked)
	setPFlag(&out.PFlags, "request_needed", l.RequiresApproval)
	if l.ExpiresAt != nil {
		out.ExpireDate = unixSeconds(*l.ExpiresAt)
	}
	if l.UsageLimit != nil {
		out.UsageLimit = *l.UsageLimit
	}
	return out
}

// chatInviteImporter#8c5adfd9 flags:# requested:flags.0?true via_chatlist:flags.3?true
// user_id:long date:int about:flags.2?string approved_by:flags.1?long
// = ChatInviteImporter;
//
// ОДИН конструктор и на вошедшего, и на ждущего одобрения: разницу выражает
// `pFlags.requested`. У нас это были два разных списка — «кто вошёл» и «заявки».
type ChatInviteImporter struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	UserID     int64           `json:"user_id"`
	Date       int             `json:"date"`
	// ApprovedBy — flags.1?long: кто одобрил заявку.
	ApprovedBy int64 `json:"approved_by,omitempty"`
}

// Tag — дискриминатор `_` (predicate схемы).
func (i ChatInviteImporter) Tag() string { return i.Underscore }

func NewChatInviteImporter(userID int64, at time.Time, requested bool, approvedBy int64) ChatInviteImporter {
	out := ChatInviteImporter{
		Underscore: ChatInviteImporterTag,
		UserID:     userID,
		Date:       unixSeconds(at),
		ApprovedBy: approvedBy,
	}
	setPFlag(&out.PFlags, "requested", requested)
	return out
}

// ── Контейнеры ─────────────────────────────────────────────────────────────

// messages.exportedChatInvite#1871be50 invite:ExportedChatInvite
// users:Vector<User> = messages.ExportedChatInvite;
type MessagesExportedChatInvite struct {
	Underscore string             `json:"_"`
	Invite     ChatInviteExported `json:"invite"`
	Users      []UserReal         `json:"users"`
}

func NewMessagesExportedChatInvite(l InviteLink) MessagesExportedChatInvite {
	return MessagesExportedChatInvite{
		Underscore: MessagesExportedChatInviteTag,
		Invite:     NewChatInviteExported(l),
		Users:      []UserReal{},
	}
}

// messages.exportedChatInvites#bdc62dcc count:int
// invites:Vector<ExportedChatInvite> users:Vector<User>
// = messages.ExportedChatInvites;
type MessagesExportedChatInvites struct {
	Underscore string               `json:"_"`
	Count      int                  `json:"count"`
	Invites    []ChatInviteExported `json:"invites"`
	Users      []UserReal           `json:"users"`
}

func NewMessagesExportedChatInvites(links []InviteLink) MessagesExportedChatInvites {
	invites := make([]ChatInviteExported, 0, len(links))
	for _, l := range links {
		invites = append(invites, NewChatInviteExported(l))
	}
	return MessagesExportedChatInvites{
		Underscore: MessagesExportedInvitesTag,
		Count:      len(invites),
		Invites:    invites,
		Users:      []UserReal{},
	}
}

// messages.chatInviteImporters#81b6b00a count:int
// importers:Vector<ChatInviteImporter> users:Vector<User>
// = messages.ChatInviteImporters;
type MessagesChatInviteImporters struct {
	Underscore string               `json:"_"`
	Count      int                  `json:"count"`
	Importers  []ChatInviteImporter `json:"importers"`
	Users      []UserReal           `json:"users"`
}

func NewMessagesChatInviteImporters(count int, importers []ChatInviteImporter, users []UserReal) MessagesChatInviteImporters {
	return MessagesChatInviteImporters{
		Underscore: MessagesChatInviteImportersTag,
		Count:      count,
		Importers:  orEmpty(importers),
		Users:      orEmpty(users),
	}
}
