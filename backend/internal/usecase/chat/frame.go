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
		"entities": m.Entities,
		"media_id": m.MediaID, "created_at": m.CreatedAt,
		"reply_to_id": m.ReplyToID,
		"fwd_from_user_id": m.FwdFromUserID, "fwd_from_chat_id": m.FwdFromChatID,
		"fwd_from_msg_id": m.FwdFromMsgID, "fwd_date": m.FwdDate,
	}
}

// editUpdatePayload is the body of an "edit_message" update/frame.
func editUpdatePayload(m domain.Message) map[string]any {
	return map[string]any{
		"chat_id": m.ChatID, "msg_id": m.ID, "seq": m.Seq,
		"text": m.Text, "entities": m.Entities, "edited_at": m.EditedAt,
	}
}

// deleteUpdatePayload is the body of a "delete_message" update/frame. `forMe`
// flags a per-user "delete for me" (only that user's own tabs receive it).
func deleteUpdatePayload(chatID, msgID, seq int64, forMe bool) map[string]any {
	return map[string]any{
		"chat_id": chatID, "msg_id": msgID, "seq": seq, "for_me": forMe,
	}
}

func reactionPayload(chatID, messageID, userID int64, emoji, action string) map[string]any {
	return map[string]any{
		"chat_id": chatID, "msg_id": messageID, "user_id": userID,
		"emoji": emoji, "action": action,
	}
}
