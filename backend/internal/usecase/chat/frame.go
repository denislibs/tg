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

// frameFields encodes {t, d} with extra fields merged into a COPY of base. base
// is shared across recipients (marshalled once for the pts log), so it must never
// be mutated — every recipient gets its own d with its own per-user fields.
func frameFields(t string, base map[string]any, extra map[string]any) []byte {
	d := make(map[string]any, len(base)+len(extra))
	for k, v := range base {
		d[k] = v
	}
	for k, v := range extra {
		d[k] = v
	}
	return frame(t, d)
}

// framePts encodes {t, d} with the recipient's per-user pts (dense monotonic
// cursor) injected into d, so a live frame advances the client's cursor exactly
// like the matching /sync update row does.
func framePts(t string, base map[string]any, pts int64) []byte {
	return frameFields(t, base, map[string]any{"pts": pts})
}

// frameChannelPts encodes {t, d} with the channel's pts injected into d as
// channel_pts (a per-channel dense cursor, distinct from the per-user pts). The
// client routes any frame carrying channel_pts + peer_id through its per-channel
// funnel and gates it against the channel cursor — the same envelope the typed
// GET /channels/{id}/difference replays for catch-up.
func frameChannelPts(t string, base map[string]any, pts int64) []byte {
	return frameFields(t, base, map[string]any{"channel_pts": pts})
}

// withPeer — копия базового payload с ключом пира ПОЛУЧАТЕЛЯ. base общий для
// всех получателей (он же маршалится в журнал) и никогда не мутируется: у
// приватного диалога peer_id у двух сторон РАЗНЫЙ, см. peeraddr.go.
func withPeer(base map[string]any, peer domain.PeerID) map[string]any {
	d := make(map[string]any, len(base)+1)
	for k, v := range base {
		d[k] = v
	}
	d["peer_id"] = peer
	return d
}

// peerRef — ссылка на чат внутри снимка (пересылка, кросс-чат-ответ, send-as)
// как знаковый ключ пира; nil остаётся nil. Снимок общий для всех получателей,
// поэтому зрителя здесь нет: ссылка на группу/канал одинакова для всех.
func peerRef(chatID *int64) any {
	if chatID == nil {
		return nil
	}
	return domain.ToPeerID(*chatID, true)
}

// Payload-строители НЕ кладут ключ чата: он зависит от получателя и
// приклеивается на выходе (withPeer / peerPayloads в updates_log.go).
func messageUpdatePayload(m domain.Message) map[string]any {
	p := map[string]any{
		"msg_id": m.ID, "seq": m.Seq,
		"sender_id": m.SenderID, "type": m.Type, "text": m.Text,
		"entities": m.Entities,
		"media_id": m.MediaID, "created_at": m.CreatedAt,
		"reply_to_id":      m.ReplyToID,
		"fwd_from_user_id": m.FwdFromUserID, "fwd_from_peer_id": peerRef(m.FwdFromChatID),
		"fwd_from_msg_id": m.FwdFromMsgID, "fwd_date": m.FwdDate, "fwd_from_name": m.FwdFromName,
		"media_unread": m.MediaUnread, "sender_name": m.SenderName,
		"grouped_id":     m.GroupedID,
		"thread_root_id": m.ThreadRootID,
		"poll_id":        m.PollID,
		"poll":           m.Poll,
		"checklist_id":   m.ChecklistID,
		"checklist":      m.Checklist,
		"giveaway_id":    m.GiveawayID,
		"giveaway":       m.Giveaway,
		"gift_id":        m.GiftID,
		"gift":           m.Gift,
	}
	// client_msg_id едет в echo нового сообщения: отправитель матчит его со своим
	// оптимистичным баблом тем же ключом, что и message_ack (у остальных
	// получателей такого ключа нет — поле для них безвредно).
	if m.ClientMsgID != nil {
		p["client_msg_id"] = *m.ClientMsgID
	}
	if m.ReplyMarkup != nil {
		p["reply_markup"] = m.ReplyMarkup
	}
	if m.Effect != "" {
		p["effect"] = m.Effect
	}
	// Вложение live-кадра — ТОТ ЖЕ объект, что отдаёт history read model
	// (chat_handler: messageJSON). Одна форма на обе витрины: иначе получатель
	// (и echo отправителя) рисует файл заглушкой «media-N» без имени/размера,
	// гифку — видео-баблом, а спойлер вообще не появляется, пока историю не
	// перезагрузят (ровно тот класс дефектов, что был у send_as). Спойлер здесь
	// живёт внутри media.pFlags — его отсутствие означало бы утечку того, что
	// отправитель просил скрыть.
	if m.Media != nil {
		p["media"] = m.Media
	}
	if m.PaidMediaPrice != nil {
		p["paid_media"] = map[string]any{"price": *m.PaidMediaPrice, "locked": m.PaidMediaLocked}
	}
	if m.FactCheck != nil {
		p["factcheck"] = factCheckJSON(m.FactCheck)
	}
	if m.Transcription != nil && *m.Transcription != "" {
		p["transcription"] = *m.Transcription
	}
	// Send-as: отображаемый автор (канал/группа). sender_id остаётся реальным —
	// клиент рисует бабл от имени send_as, не теряя настоящего отправителя.
	if m.SendAsChatID != nil {
		p["send_as"] = sendAsJSON(m)
	}
	// Reply quote: цитата хранится на самом сообщении — превью реплая на клиенте
	// собирается из уже загруженного окна, так что фрагмент едет отдельным полем.
	if m.ReplyQuoteText != nil {
		p["reply_quote_text"] = *m.ReplyQuoteText
		p["reply_quote_offset"] = m.ReplyQuoteOffset
	}
	// Кросс-чат-ответ (Telegram reply_to_peer_id): исходный чат + снимок превью
	// (имя автора + текст/лейбл), т.к. получатель может не иметь к нему доступа.
	if m.ReplyToPeerID != nil {
		p["reply_to_peer_id"] = domain.ToPeerID(*m.ReplyToPeerID, true)
		p["reply_snapshot_name"] = m.ReplySnapshotName
		p["reply_snapshot_text"] = m.ReplySnapshotText
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

// sendAsJSON — представление отображаемого автора send-as (peer_id + снимок
// title/photo). Реальный sender_id сериализуется отдельным полем и не теряется.
func sendAsJSON(m domain.Message) map[string]any {
	s := map[string]any{"peer_id": domain.ToPeerID(*m.SendAsChatID, true)}
	if m.SendAsTitle != "" {
		s["title"] = m.SendAsTitle
	}
	if m.SendAsPhotoID != nil {
		s["photo_id"] = *m.SendAsPhotoID
	}
	return s
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
		"msg_id": m.ID, "seq": m.Seq, "geo": geoJSON(m),
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

// factCheckJSON — представление «проверки фактов» для клиента (nil → nil).
func factCheckJSON(fc *domain.FactCheck) map[string]any {
	if fc == nil {
		return nil
	}
	m := map[string]any{"text": fc.Text}
	if len(fc.Entities) > 0 {
		m["entities"] = fc.Entities
	}
	if fc.Country != "" {
		m["country"] = fc.Country
	}
	return m
}

// factCheckUpdatePayload — тело фрейма/апдейта factcheck_update: клиент патчит
// блок проверки фактов в уже отрисованном бабле. factcheck==null — проверка снята.
func factCheckUpdatePayload(m domain.Message) map[string]any {
	return map[string]any{
		"msg_id": m.ID, "seq": m.Seq,
		"factcheck": factCheckJSON(m.FactCheck),
	}
}

// editUpdatePayload is the body of an "edit_message" update/frame. reply_markup
// rides along so a bot editing a message's keyboard updates the bubble live.
func editUpdatePayload(m domain.Message) map[string]any {
	p := map[string]any{
		"msg_id": m.ID, "seq": m.Seq,
		"text": m.Text, "entities": m.Entities, "edited_at": m.EditedAt,
	}
	p["reply_markup"] = m.ReplyMarkup // may be null → keyboard removed
	return p
}

// deleteUpdatePayload is the body of a "delete_message" update/frame. `forMe`
// flags a per-user "delete for me" (only that user's own tabs receive it).
func deleteUpdatePayload(msgID, seq int64, forMe bool) map[string]any {
	return map[string]any{
		"msg_id": msgID, "seq": seq, "for_me": forMe,
	}
}

// reactionPayload — тело фрейма/апдейта reaction. Помимо диффа (user_id + emoji +
// action, нужного для анимации и вычисления mine на клиенте) несёт АБСОЛЮТНЫЙ
// агрегат counts: [{emoji, count}] — полное текущее состояние реакций сообщения,
// посчитанное в той же транзакции после Add/Remove. Абсолютный агрегат делает
// повтор из /sync идемпотентным по построению. counts viewer-agnostic (без mine):
// один и тот же payload уходит всем получателям и в лог.
func reactionPayload(messageID, userID, authorID int64, emoji, action string, counts []domain.ReactionCount) map[string]any {
	if counts == nil {
		counts = []domain.ReactionCount{}
	}
	return map[string]any{
		"msg_id": messageID, "user_id": userID,
		"author_id": authorID, "emoji": emoji, "action": action,
		"counts": counts,
	}
}

// starReactionPayload — тело фрейма/апдейта star_reaction: новый агрегат звёзд
// сообщения (total) плюс отправитель этой порции (sender_id) с его суммарным
// вкладом (mine). Получатели правят агрегат бабла; тот, чей id == sender_id,
// обновляет ещё и свой личный вклад (mine).
func starReactionPayload(messageID, senderID, total, mine int64) map[string]any {
	return map[string]any{
		"msg_id": messageID, "sender_id": senderID,
		"total": total, "mine": mine,
	}
}
