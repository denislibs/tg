package ws

import (
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// Frame is the WS envelope: a type tag and an opaque JSON payload.
type Frame struct {
	T string          `json:"t"`
	D json.RawMessage `json:"d,omitempty"`
}

type sendMessageData struct {
	ChatID      int64                  `json:"chat_id"`
	Type        string                 `json:"type"`
	Text        string                 `json:"text"`
	Entities    []domain.MessageEntity `json:"entities"`
	ReplyToID   *int64                 `json:"reply_to_id"`
	ClientMsgID string                 `json:"client_msg_id"`
	MediaID     *int64                 `json:"media_id"`
	GroupedID   string                 `json:"grouped_id"`
}

type readData struct {
	ChatID  int64 `json:"chat_id"`
	UpToSeq int64 `json:"up_to_seq"`
}

type readMediaData struct {
	ChatID int64 `json:"chat_id"`
	MsgID  int64 `json:"msg_id"`
}

type typingData struct {
	ChatID int64  `json:"chat_id"`
	Action string `json:"action"` // "typing" | "voice" | "video" (default typing)
}
