package chat

import (
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// frame encodes a WS envelope {t, d}. Errors are impossible for the maps we pass,
// so it returns just the bytes (empty on the unreachable error path).
func frame(t string, d any) []byte {
	b, err := json.Marshal(map[string]any{"t": t, "d": d})
	if err != nil {
		return nil
	}
	return b
}

func messageUpdatePayload(m domain.Message) map[string]any {
	return map[string]any{
		"chat_id": m.ChatID, "msg_id": m.ID, "seq": m.Seq,
		"sender_id": m.SenderID, "type": m.Type, "text": m.Text,
		"media_id": m.MediaID, "created_at": m.CreatedAt,
	}
}

func reactionPayload(chatID, messageID, userID int64, emoji, action string) map[string]any {
	return map[string]any{
		"chat_id": chatID, "msg_id": messageID, "user_id": userID,
		"emoji": emoji, "action": action,
	}
}
