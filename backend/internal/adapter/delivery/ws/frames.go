package ws

import "encoding/json"

// Frame is the WS envelope: a type tag and an opaque JSON payload.
type Frame struct {
	T string          `json:"t"`
	D json.RawMessage `json:"d,omitempty"`
}

type sendMessageData struct {
	ChatID      int64  `json:"chat_id"`
	Type        string `json:"type"`
	Text        string `json:"text"`
	ReplyToID   *int64 `json:"reply_to_id"`
	ClientMsgID string `json:"client_msg_id"`
	MediaID     *int64 `json:"media_id"`
}

type readData struct {
	ChatID  int64 `json:"chat_id"`
	UpToSeq int64 `json:"up_to_seq"`
}

type typingData struct {
	ChatID int64 `json:"chat_id"`
}
