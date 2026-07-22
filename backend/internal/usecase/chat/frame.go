package chat

import (
	"encoding/base64"
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
	p := map[string]any{
		"chat_id": m.ChatID, "msg_id": m.ID, "seq": m.Seq,
		"sender_id": m.SenderID, "type": m.Type, "text": m.Text,
		"entities": m.Entities,
		"media_id": m.MediaID, "created_at": m.CreatedAt,
		"reply_to_id":      m.ReplyToID,
		"fwd_from_user_id": m.FwdFromUserID, "fwd_from_chat_id": m.FwdFromChatID,
		"fwd_from_msg_id": m.FwdFromMsgID, "fwd_date": m.FwdDate, "fwd_from_name": m.FwdFromName,
		"media_unread": m.MediaUnread, "sender_name": m.SenderName,
		"grouped_id":     m.GroupedID,
		"thread_root_id": m.ThreadRootID,
		"poll_id":        m.PollID,
		"poll":           m.Poll,
		"gift_id":        m.GiftID,
		"gift":           m.Gift,
	}
	if m.ReplyMarkup != nil {
		p["reply_markup"] = m.ReplyMarkup
	}
	if m.Effect != "" {
		p["effect"] = m.Effect
	}
	// Медиа-мета live-кадра — те же ключи, что history read model (chat_handler):
	// иначе получатель (и echo отправителя) рисует файл заглушкой «media-N» без
	// имени/размера до перезагрузки истории.
	if m.MediaWidth > 0 && m.MediaHeight > 0 {
		p["media_w"] = m.MediaWidth
		p["media_h"] = m.MediaHeight
	}
	if m.MediaMime != "" {
		p["media_mime"] = m.MediaMime
	}
	if len(m.MediaBlur) > 0 {
		p["media_blur"] = m.MediaBlur
	}
	if m.MediaHasThumb {
		p["media_has_thumb"] = true
	}
	if m.MediaDuration > 0 {
		p["media_duration"] = m.MediaDuration
	}
	if m.MediaSize > 0 {
		p["media_size"] = m.MediaSize
	}
	if m.MediaName != "" {
		p["media_name"] = m.MediaName
	}
	if m.PaidMediaPrice != nil {
		p["paid_media"] = map[string]any{"price": *m.PaidMediaPrice, "locked": m.PaidMediaLocked}
	}
	// Reply quote: цитата хранится на самом сообщении — превью реплая на клиенте
	// собирается из уже загруженного окна, так что фрагмент едет отдельным полем.
	if m.ReplyQuoteText != nil {
		p["reply_quote_text"] = *m.ReplyQuoteText
		p["reply_quote_offset"] = m.ReplyQuoteOffset
	}
	if m.GeoLat != nil && m.GeoLng != nil {
		p["geo"] = geoJSON(m)
	}
	if m.ContactUserID != nil {
		p["contact"] = contactJSON(m)
	}
	if m.EncBody != nil {
		p["enc_body"] = base64.StdEncoding.EncodeToString(m.EncBody)
		p["ttl_seconds"] = m.TTLSeconds
		p["destruct_at"] = m.DestructAt
	}
	return p
}

// geoJSON — представление гео-сообщения: точка + опционально venue (title/address)
// и live location (live_period/heading/stopped + edited_at = время обновления).
func geoJSON(m domain.Message) map[string]any {
	g := map[string]any{"lat": *m.GeoLat, "lng": *m.GeoLng}
	if m.GeoTitle != nil {
		g["title"] = *m.GeoTitle
	}
	if m.GeoAddress != nil {
		g["address"] = *m.GeoAddress
	}
	if m.GeoLivePeriod != nil {
		g["live_period"] = *m.GeoLivePeriod
		g["live_stopped"] = m.GeoLiveStopped
		if m.GeoHeading != nil {
			g["heading"] = *m.GeoHeading
		}
		if m.EditedAt != nil {
			g["edited_at"] = *m.EditedAt
		}
	}
	return g
}

// geoLiveUpdatePayload — тело фрейма geo_live_update (обновление координат
// трансляции): клиент правит гео открытого бабла без перезагрузки истории.
func geoLiveUpdatePayload(m domain.Message) map[string]any {
	return map[string]any{
		"chat_id": m.ChatID, "msg_id": m.ID, "seq": m.Seq, "geo": geoJSON(m),
	}
}

// contactJSON — представление контакта сообщения (снимок имени/телефона).
func contactJSON(m domain.Message) map[string]any {
	c := map[string]any{"user_id": *m.ContactUserID}
	if m.ContactName != nil {
		c["name"] = *m.ContactName
	}
	if m.ContactPhone != nil {
		c["phone"] = *m.ContactPhone
	}
	return c
}

// editUpdatePayload is the body of an "edit_message" update/frame. reply_markup
// rides along so a bot editing a message's keyboard updates the bubble live.
func editUpdatePayload(m domain.Message) map[string]any {
	p := map[string]any{
		"chat_id": m.ChatID, "msg_id": m.ID, "seq": m.Seq,
		"text": m.Text, "entities": m.Entities, "edited_at": m.EditedAt,
	}
	p["reply_markup"] = m.ReplyMarkup // may be null → keyboard removed
	return p
}

// deleteUpdatePayload is the body of a "delete_message" update/frame. `forMe`
// flags a per-user "delete for me" (only that user's own tabs receive it).
func deleteUpdatePayload(chatID, msgID, seq int64, forMe bool) map[string]any {
	return map[string]any{
		"chat_id": chatID, "msg_id": msgID, "seq": seq, "for_me": forMe,
	}
}

func reactionPayload(chatID, messageID, userID, authorID int64, emoji, action string) map[string]any {
	return map[string]any{
		"chat_id": chatID, "msg_id": messageID, "user_id": userID,
		"author_id": authorID, "emoji": emoji, "action": action,
	}
}
