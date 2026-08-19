package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ссылки на пиры ВНУТРИ сообщения: атрибуция пересылки (messageFwdHeader) и
// исходный чат кросс-чат-ответа. Долг шага B, закрытый здесь.
//
// В строке messages лежат плоские fwd_from_user_id / fwd_from_chat_id /
// reply_to_peer_id, и до сих пор витрина переводила их в ключ пира одним
// правилом «чат → -chatID». Для группы и канала это верно, а для ПРИВАТНОГО
// чата — нет: публичного ключа у той строки chats не существует вовсе (пир
// приватного диалога это собеседник, и он разный у двух сторон). Наружу
// уезжал внутренний ключ сервера — ровно тот, который шаг B из провода убрал.
//
// Поэтому перевод знает ВИД чата-источника и живёт в одном месте: слой
// адресации (peeraddr.go) уже кэширует «чем чат представляется наружу», и
// второго обращения к базе на сообщение здесь не возникает.

// HydrateMessagePeers наполняет вычисляемые ссылки на пиры (Message.FwdFrom и
// Message.ReplyToPeer) у каждого сообщения списка. Ошибка резолва не роняет
// выдачу: у сообщения просто не будет ссылки — это лучше 500-й на всю историю.
func (i *Interactor) HydrateMessagePeers(ctx context.Context, msgs []domain.Message) []domain.Message {
	for idx := range msgs {
		i.hydrateMessagePeers(ctx, &msgs[idx])
	}
	return msgs
}

func (i *Interactor) hydrateMessagePeers(ctx context.Context, m *domain.Message) {
	m.FwdFrom = i.fwdHeader(ctx, *m)
	m.ReplyToPeer = nil
	if m.ReplyToPeerID != nil {
		m.ReplyToPeer = i.publicChatPeer(ctx, *m.ReplyToPeerID)
	}
}

// publicChatPeer — ссылка на чат, ОДИНАКОВАЯ для всех получателей: peerChannel
// у группы и канала. У приватного чата такой ссылки нет — возвращается nil, и
// ключ просто не едет. Снимок ответа (имя автора + текст) при этом остаётся на
// сообщении, поэтому превью рисуется и без ссылки.
func (i *Interactor) publicChatPeer(ctx context.Context, chatID int64) domain.Peer {
	a, err := i.peerAddress(ctx, chatID)
	if err != nil || a.members != nil {
		return nil
	}
	return domain.NewPeerChannel(chatID)
}

// fwdHeader собирает messageFwdHeader сообщения. nil — пересылки нет.
func (i *Interactor) fwdHeader(ctx context.Context, m domain.Message) *domain.MessageFwdHeader {
	if m.FwdFromUserID == nil && m.FwdFromChatID == nil && m.FwdFromName == nil {
		return nil
	}
	h := &domain.MessageFwdHeader{Underscore: domain.MessageFwdHeaderTag}
	if m.FwdDate != nil {
		h.Date = int(m.FwdDate.Unix())
	}
	// Скрытая атрибуция (правило приватности forwards): только имя, ссылки на
	// аккаунт нет вовсе — так же, как from_name в схеме.
	if m.FwdFromName != nil {
		h.FromName = *m.FwdFromName
		return h
	}

	var srcPeer domain.Peer
	var srcType string
	if m.FwdFromChatID != nil {
		if a, err := i.peerAddress(ctx, *m.FwdFromChatID); err == nil && a.members == nil {
			srcPeer = domain.NewPeerChannel(*m.FwdFromChatID)
			srcType, _ = i.chats.ChatType(ctx, *m.FwdFromChatID)
		}
	}
	switch {
	case m.FwdFromUserID != nil:
		h.FromID = domain.NewPeerUser(*m.FwdFromUserID)
	case srcPeer != nil:
		// Пост канала: автором выступает сам канал.
		h.FromID = srcPeer
	}
	// «Откуда именно» заполняется только для группы/канала: у приватного
	// источника публичного ключа нет, и подделывать его нечем.
	if srcPeer != nil {
		h.SavedFromPeer = srcPeer
		if m.FwdFromMsgID != nil {
			h.SavedFromMsgID = *m.FwdFromMsgID
			if srcType == domain.ChatTypeChannel {
				h.ChannelPost = *m.FwdFromMsgID
			}
		}
	}
	return h
}
