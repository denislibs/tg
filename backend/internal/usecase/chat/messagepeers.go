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
	fwdSeq := i.fwdSourceSeqs(ctx, msgs)
	for idx := range msgs {
		i.hydrateOneMessagePeers(ctx, &msgs[idx], fwdSeq)
	}
	return msgs
}

func (i *Interactor) hydrateMessagePeers(ctx context.Context, m *domain.Message) {
	i.hydrateOneMessagePeers(ctx, m, i.fwdSourceSeqs(ctx, []domain.Message{*m}))
}

func (i *Interactor) hydrateOneMessagePeers(ctx context.Context, m *domain.Message, fwdSeq map[int64]int64) {
	m.FwdFrom = i.fwdHeader(ctx, *m, fwdSeq)
	m.ReplyToPeer = nil
	if m.ReplyToPeerID != nil {
		m.ReplyToPeer = i.publicChatPeer(ctx, *m.ReplyToPeerID)
	}
}

// fwdSourceSeqs — НОМЕРА исходных сообщений пересылок одним запросом на весь
// список. Колонка fwd_from_msg_id хранит внутренний ключ строки (по нему же
// резолвятся зеркала постов), а наружу «откуда именно» обязано ехать номером:
// saved_from_msg_id и channel_post в схеме адресуют сообщение В ЕГО ПИРЕ.
// N+1 здесь недопустим — история почти целиком может состоять из пересылок.
func (i *Interactor) fwdSourceSeqs(ctx context.Context, msgs []domain.Message) map[int64]int64 {
	ids := make([]int64, 0, len(msgs))
	seen := map[int64]bool{}
	for _, m := range msgs {
		if m.FwdFromMsgID == nil || m.FwdFromChatID == nil || seen[*m.FwdFromMsgID] {
			continue
		}
		seen[*m.FwdFromMsgID] = true
		ids = append(ids, *m.FwdFromMsgID)
	}
	if len(ids) == 0 {
		return nil
	}
	seqs, err := i.msgs.SeqsByIDs(ctx, ids)
	if err != nil {
		return nil
	}
	return seqs
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
func (i *Interactor) fwdHeader(ctx context.Context, m domain.Message, fwdSeq map[int64]int64) *domain.MessageFwdHeader {
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
		// Номер оригинала в ЕГО чате; исходного сообщения уже нет — ссылки нет
		// вовсе, внутренний ключ вместо номера не подставляется никогда.
		if m.FwdFromMsgID != nil {
			if seq, ok := fwdSeq[*m.FwdFromMsgID]; ok {
				h.SavedFromMsgID = seq
				if srcType == domain.ChatTypeChannel {
					h.ChannelPost = seq
				}
			}
		}
	}
	return h
}
