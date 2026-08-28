package domain

import "time"

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
// SendAt и WhenOnline — НАШИ параметры вне схемы: у оригинала время отправки
// живёт в отдельном списке scheduled-состояний, а «когда появится онлайн» это
// его sentinel-значение даты (0x7FFFFFFE). Оба объявлены штатным механизмом
// клиентских параметров.
func (m ScheduledMessage) ToWire(peer Peer) MessageReal {
	out := NewMessage(m.ID, peer, m.CreatedAt, m.Text, MessageFlags{})
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
