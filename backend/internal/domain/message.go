package domain

import "time"

// MessageEntity is a rich-text formatting span over the message Text (Telegram
// MessageEntity model). Offset/Length are in UTF-16 code units (matching JS
// string indices on the client), so the same numbers slice the text identically
// on both ends. The backend stores/returns these opaquely (jsonb) — only the
// client interprets the units. URL is set only for "text_link" spans.
type MessageEntity struct {
	Type   string `json:"type"`               // bold|italic|underline|strikethrough|code|pre|spoiler|blockquote|text_link
	Offset int    `json:"offset"`             // start, in UTF-16 code units
	Length int    `json:"length"`             // span length, in UTF-16 code units
	URL    string `json:"url,omitempty"`      // target for text_link
	Lang   string `json:"language,omitempty"` // language hint for pre code blocks
}

type Message struct {
	ID           int64
	ChatID       int64
	Seq          int64
	SenderID     int64
	Type         string
	Text         string
	Entities     []MessageEntity // rich-text formatting spans over Text (nil when plain)
	ReplyToID    *int64
	MediaID      *int64
	ClientMsgID  *string
	ThreadRootID *int64
	CreatedAt    time.Time
	Deleted      bool
	EditedAt     *time.Time
	// Forward attribution (set when the message was forwarded from elsewhere).
	FwdFromUserID *int64
	FwdFromChatID *int64
	FwdFromMsgID  *int64
	FwdDate       *time.Time
	// ReplyTo is a lightweight preview of the replied-to message, populated by
	// the history read model (not stored). Nil when this isn't a reply.
	ReplyTo *ReplyPreview
	// Media dimensions/mime, populated by the history read model (not stored on the
	// message row) so the client can reserve the exact media box before the bytes
	// load — no layout shift. Zero when there's no media or it's unprocessed.
	MediaWidth    int
	MediaHeight   int
	MediaMime     string
	MediaBlur     []byte // blur preview bytes (JSON base64 — LQIP placeholder)
	MediaHasThumb bool
	MediaDuration int
	MediaSize     int64
	MediaName     string
	// Views is the deduplicated viewer count for a channel post (0 for
	// group/private messages, which don't track views).
	Views int64
	// MediaUnread mirrors Telegram's pFlags.media_unread: a voice/round-video
	// message whose content hasn't been played by the recipient yet. Set on
	// send, cleared by ReadMedia.
	MediaUnread bool
}

// ReplyPreview is the quoted snippet shown above a reply bubble.
type ReplyPreview struct {
	MsgID    int64
	Seq      int64
	SenderID int64
	Text     string
	Entities []MessageEntity // formatting of the quoted snippet (nil when truncated/plain)
	Type     string
	MediaID  *int64 // the replied message's media, for a thumbnail in the quote box
}
