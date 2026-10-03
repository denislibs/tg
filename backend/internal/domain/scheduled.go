package domain

import "time"

// SendWhenOnlineTimestamp — дата отложенного «отправить, когда собеседник появится
// в сети» (tweb `SEND_WHEN_ONLINE_TIMESTAMP`, `appManagers/constants.ts:29`).
const SendWhenOnlineTimestamp = 0x7FFFFFFE

// ScheduledMessage — запланированное сообщение (Telegram scheduled messages):
// лежит в отдельной очереди и попадает в историю чата только в момент SendAt.
type ScheduledMessage struct {
	ID        int64
	ChatID    int64
	SenderID  int64
	Type      string
	Text      string
	Entities  MessageEntities
	ReplyToID *int64
	MediaID   *int64
	SendAt    time.Time
	CreatedAt time.Time
	// WhenOnline — «отправить когда онлайн» (Telegram schedule sentinel): вместо
	// SendAt сообщение ждёт, пока собеседник приватного чата появится онлайн.
	// Только для приватных чатов. При WhenOnline поле SendAt не используется.
	WhenOnline bool
}

// ToWire — отложенное сообщение тем же конструктором `message`, что и обычное.
// Собственной проводной формы у него больше нет: у оригинала отложенные едут
// вектором messages.Message (messages.getScheduledHistory), а не отдельной
// записью с ключами send_at/when_online рядом с плоским type.
//
// Идентичность здесь СВОЯ: номера в чате у отложенного нет (он назначается при
// отправке), поэтому id — ключ строки scheduled_messages, а адрес —
// /chats/{peerID}/scheduled/{schedID}. Смешивать его с номерами обычных
// сообщений нельзя, и клиент оригинала держит их в отдельном хранилище ровно
// поэтому.
//
// Дата (`date`) — ВРЕМЯ ОТПРАВКИ, как у оригинала: в messages.getScheduledHistory
// `message.date` отложенного — момент, на который оно запланировано, а «когда
// появится онлайн» — sentinel-значение даты SendWhenOnlineTimestamp (tweb
// `appManagers/constants.ts:29`). По ней клиент режет ленту отложенных на дни и
// подписывает их «Scheduled for …» (tweb `chat/dateBubble.ts`).
//
// SendAt и WhenOnline — НАШИ параметры вне схемы, дублирующие дату явным видом
// (объявлены штатным механизмом клиентских параметров).
func (m ScheduledMessage) ToWire(peer Peer) MessageReal {
	date := m.SendAt
	if m.WhenOnline {
		date = time.Unix(SendWhenOnlineTimestamp, 0)
	}
	// Out: отложенные видит только автор (`ListScheduled` отдаёт свои), значит
	// зритель и есть отправитель — как `pFlags.out` у оригинала.
	out := NewMessage(m.ID, peer, date, m.Text, MessageFlags{Out: true})
	if m.SenderID != 0 {
		out.FromID = NewPeerUser(m.SenderID)
	}
	out.Entities = m.Entities
	if m.ReplyToID != nil {
		h := NewMessageReplyHeader(*m.ReplyToID)
		out.ReplyTo = &h
	}
	setPFlag(&out.PFlags, "is_scheduled", true)
	out.SendAt = m.SendAt.Unix()
	out.WhenOnline = m.WhenOnline
	return out
}
