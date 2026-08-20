package domain

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"time"
)

// Перевод строки витрины (domain.Message) в конструктор схемы — ЕДИНСТВЕННОЕ
// место, где сообщение получает проводную форму (решение Р5 разбора,
// docs/readiness/tl-message-analysis.md).
//
// До этого шага форм было десять: витрина `messageJSON`, кадр
// `messageUpdatePayload`, снимок поста `channelPostPayload`, ответ
// `POST /channels/{peerID}/messages`, отложенное, запись журнала звонков,
// результат Bot API, топ-посты статистики, календарь дат и пуш. Расходились
// они в ОБЕ стороны: в кадре были поля, которых нет в витрине (sender_name,
// client_msg_id, reply_quote_*), и наоборот (views, forwards, deleted,
// edited_at, reactions, star_reaction, web_page, reply_to). Цена двух
// независимых сериализаторов и есть это расхождение, поэтому сериализатор
// остаётся один.
//
// Приём тот же, что у диалогов: DialogRecord.ToDialog переводит строку
// выборки в конструктор, а вычисляемые части (Media, FwdFrom, ReplyToPeer,
// Reactions) приезжают на строке уже наполненными read-моделью.

// MessageContext — то, чего строка messages не знает о себе сама и что зависит
// от МЕСТА, куда сообщение уезжает.
//
// Peer здесь обязателен по схеме, но у кадра он зависит от ПОЛУЧАТЕЛЯ (у
// приватного диалога стороны видят разный ключ), поэтому там он приклеивается
// на выходе — см. withPeer в usecase/chat/frame.go. Nil означает ровно это:
// «ключ пира допишут позже», и других значений у него нет.
type MessageContext struct {
	// Peer — чат сообщения ГЛАЗАМИ получателя (message.peer_id).
	Peer Peer
	// Post — сообщение в вещательном канале (message.pFlags.post). Строка
	// messages этого не знает: признак у ЧАТА, а не у сообщения.
	Post bool
	// Out — сообщение отправил ЗРИТЕЛЬ (message.pFlags.out).
	//
	// Разбор изначально решал (Р7), что `out` считает клиент по
	// `sender_id == meId`, и тогда это было верно. Порт сломал основание: у
	// сообщения от лица канала (send-as) `from_id` на проводе — САМ КАНАЛ, а
	// прежнее поле `send_as` с провода ушло. То есть у клиента не осталось
	// источника, из которого прежняя формула выводилась.
	//
	// Поэтому Р7 отменено, и флаг производит сервер — как в схеме. Стоимости
	// «ответ становится зависимым от зрителя» здесь нет: он и так зависим,
	// `peer_id` считается тем же зрителем строкой выше.
	//
	// ВАЖНО про сторону бабла: `out` отвечает «я ли отправил», а НЕ «рисовать
	// справа». Сообщение от лица канала остаётся `out`, но рисуется входящим —
	// это решение клиента, и он принимает его по `from_id` (ссылка на чат, а не
	// на человека), а не по отдельному полю.
	Out bool
}

// ToWire собирает конструктор схемы: messageService, когда у сообщения есть
// действие, иначе message. «Служебное ли» — ВЫБОР КОНСТРУКТОРА, а не значение
// поля type (решение Р2): вид вложения даёт объединение MessageMedia, а
// строкового дискриминатора на проводе больше нет.
func (m Message) ToWire(ctx MessageContext) MTMessage {
	if m.Action != nil {
		return m.toService(ctx)
	}
	return m.toReal(ctx)
}

func (m Message) toService(ctx MessageContext) MessageService {
	s := NewMessageService(m.Seq, ctx.Peer, m.CreatedAt, m.Action, ctx.Post)
	setPFlag(&s.PFlags, "out", ctx.Out)
	s.FromID = m.fromID()
	s.ReplyTo = m.replyHeader()
	if m.TTLSeconds != nil {
		s.TTLPeriod = *m.TTLSeconds
	}
	// Фото действия (смена аватарки чата, предложенное фото) едет ВНУТРИ
	// действия конструктором photo, а не полем media_id рядом: у messageService
	// поля media в схеме нет вовсе. Строка при этом хранит его как обычное
	// медиа сообщения, поэтому подставляется здесь, на границе.
	if m.Media != nil && m.Media.Photo != nil {
		switch a := s.Action.(type) {
		case MessageActionChatEditPhoto:
			a.Photo = m.Media.Photo
			s.Action = a
		case MessageActionSuggestProfilePhoto:
			a.Photo = m.Media.Photo
			s.Action = a
		}
	}
	return s
}

func (m Message) toReal(ctx MessageContext) MessageReal {
	r := NewMessage(m.Seq, ctx.Peer, m.CreatedAt, m.Text, MessageFlags{
		MediaUnread: m.MediaUnread,
		Post:        ctx.Post,
		Out:         ctx.Out,
	})
	r.FromID = m.fromID()
	r.FwdFrom = m.FwdFrom
	r.ReplyTo = m.replyHeader()
	r.Media = m.Media
	r.ReplyMarkup = m.ReplyMarkup
	r.Entities = m.Entities
	r.Views = m.Views
	r.Forwards = m.Forwards
	if m.EditedAt != nil {
		r.EditDate = unixSeconds(*m.EditedAt)
	}
	if m.GroupedID != nil {
		r.GroupedID = *m.GroupedID
	}
	r.Reactions = m.reactions()
	// Срок самоуничтожения ехал ТОЛЬКО внутри ветки шифрованного сообщения —
	// на обычном он терялся на проводе, хотя колонка одна и та же.
	if m.TTLSeconds != nil {
		r.TTLPeriod = *m.TTLSeconds
	}
	r.Effect = m.Effect
	if m.FactCheck != nil {
		r.FactCheck = &MTFactCheck{
			Underscore: FactCheckTag,
			Country:    m.FactCheck.Country,
			Text:       NewTextWithEntities(m.FactCheck.Text, m.FactCheck.Entities),
		}
	}
	m.attachOurPayload(&r)
	return r
}

// fromID — АВТОР сообщения ссылкой на пир. Отправка от имени канала/группы
// (send-as) выражается тем, что автором становится САМ КАНАЛ: в схеме это
// message.from_id, а не отдельный снимок send_as{peer_id,title,photo_id} рядом
// с настоящим отправителем. Название и аватарка отображаемого автора едут
// карточкой чата, как у любого другого пира.
func (m Message) fromID() Peer {
	if m.SendAsChatID != nil {
		return NewPeerChannel(*m.SendAsChatID)
	}
	if m.SenderID == 0 {
		return nil
	}
	return NewPeerUser(m.SenderID)
}

// replyHeader — ССЫЛКА на отвечаемое сообщение (решение Р4), а не его снимок.
//
// Три случая, которые схема различает, а плоские поля витрины смешивали:
//
//   - ответ в СВОЁМ чате: reply_to_msg_id, и всё;
//   - ответ в ЧУЖОЙ чат: плюс reply_to_peer_id;
//   - оригинал НЕДОСТУПЕН зрителю (публичного ключа у чата-источника нет):
//     reply_from — атрибуция автора конструктором messageFwdHeader, где имя без
//     ссылки на аккаунт это from_name, ровно как у скрытой пересылки;
//
// и отдельно ЦИТАТА, которая едет всегда, когда она есть: выделенный фрагмент
// нельзя вывести из оригинала, если оригинал потом изменили.
//
// Корень треда — reply_to_top_id ЗДЕСЬ ЖЕ и всегда в ТОМ ЖЕ пире: отдельного
// поля thread_root_id в схеме нет вовсе.
func (m Message) replyHeader() *MessageReplyHeader {
	if m.ReplyToID == nil && m.ThreadRootID == nil {
		return nil
	}
	h := MessageReplyHeader{Underscore: MessageReplyHeaderTag}
	if m.ReplyToID != nil {
		h.ReplyToMsgID = *m.ReplyToID
	}
	if m.ThreadRootID != nil {
		h.ReplyToTopID = *m.ThreadRootID
	}
	if m.ReplyToPeerID != nil {
		if m.ReplyToPeer != nil {
			h.ReplyToPeerID = m.ReplyToPeer
		} else if m.ReplySnapshotName != "" {
			// Оригинал зрителю недоступен: ключа пира у приватного чата-источника
			// не существует, поэтому едет атрибуция автора, а не ссылка.
			h.ReplyFrom = &MessageFwdHeader{
				Underscore: MessageFwdHeaderTag,
				FromName:   m.ReplySnapshotName,
			}
		}
	}
	if m.ReplyQuoteText != nil && *m.ReplyQuoteText != "" {
		offset := 0
		if m.ReplyQuoteOffset != nil {
			offset = *m.ReplyQuoteOffset
		}
		h.Quote(*m.ReplyQuoteText, nil, offset)
	}
	return &h
}

// reactions — агрегаты реакций конструктором messageReactions. Платная
// ⭐-реакция — ТОТ ЖЕ вектор results, но с конструктором reactionPaid: пары
// {star_reaction:{total,mine}} рядом с обычными чипами в схеме нет.
func (m Message) reactions() *MessageReactions {
	if len(m.Reactions) == 0 && m.StarReactionTotal == 0 {
		return nil
	}
	results := make([]MTReactionCount, 0, len(m.Reactions)+1)
	var recent []MessagePeerReaction
	for _, rc := range m.Reactions {
		emoji := NewReactionEmoji(rc.Emoji)
		results = append(results, NewReactionCount(emoji, rc.Count, rc.Mine))
		for _, p := range rc.Recent {
			// Времени постановки реакции витрина не несёт (колонки нет), а
			// параметр date обязателен — едет нулём.
			recent = append(recent, NewMessagePeerReaction(p, zeroTime, emoji))
		}
	}
	out := NewMessageReactions(results, recent)
	if m.StarReactionTotal > 0 {
		out.Results = append(out.Results,
			NewReactionCount(NewReactionPaid(), int(m.StarReactionTotal), m.StarReactionMine > 0))
		if m.StarReactionMine > 0 {
			out.TopReactors = []MessageReactor{NewMyMessageReactor(int(m.StarReactionMine))}
		}
	}
	return &out
}

// attachOurPayload переносит на конструктор то, чего объединение MessageMedia
// у нас ещё не покрывает, плюс два наших параметра вне схемы (шифртекст
// секретного чата и ключ сопоставления эха). Всё перечисленное названо в
// MessageReal — здесь только перенос.
func (m Message) attachOurPayload(r *MessageReal) {
	if m.ClientMsgID != nil {
		r.RandomID = *m.ClientMsgID
	}
	if m.GeoLat != nil && m.GeoLng != nil {
		g := map[string]any{"lat": *m.GeoLat, "lng": *m.GeoLng}
		putIfSet(g, "title", m.GeoTitle)
		putIfSet(g, "address", m.GeoAddress)
		if m.GeoLivePeriod != nil {
			g["live_period"] = *m.GeoLivePeriod
			g["live_stopped"] = m.GeoLiveStopped
			putIfSet(g, "heading", m.GeoHeading)
			// Времени последнего обновления трансляции здесь НЕТ: это
			// message.edit_date, и второго смысла у него не бывает. Прежде одно
			// и то же edited_at ехало и на верхнем уровне (время правки), и
			// внутри geo (время обновления координат).
		}
		r.Geo = g
	}
	if m.ContactUserID != nil {
		c := map[string]any{"user_id": *m.ContactUserID}
		putIfSet(c, "name", m.ContactName)
		putIfSet(c, "phone", m.ContactPhone)
		r.Contact = c
	}
	r.Poll = m.Poll
	r.Checklist = m.Checklist
	r.Giveaway = m.Giveaway
	r.Gift = m.Gift
	r.WebPage = m.WebPage
	if m.PaidMediaPrice != nil {
		r.PaidMedia = map[string]any{"price": *m.PaidMediaPrice, "locked": m.PaidMediaLocked}
	}
	if m.EncBody != nil {
		r.EncBody = base64.StdEncoding.EncodeToString(m.EncBody)
		if m.DestructAt != nil {
			at := m.DestructAt.Format(time.RFC3339Nano)
			r.DestructAt = &at
		}
	}
}

func putIfSet[T any](dst map[string]any, key string, v *T) {
	if v != nil {
		dst[key] = *v
	}
}

// ToWireMap — тот же конструктор в виде карты. Нужен кадрам: ключ пира у них
// зависит от ПОЛУЧАТЕЛЯ и дописывается на выходе, а журнал обновлений хранит
// готовое тело (см. peerPayloads в usecase/chat/updates_log.go).
//
// UseNumber — не украшение: разбор в any иначе превратил бы каждое число в
// float64, и большой id уехал бы к получателю округлённым.
func (m Message) ToWireMap(ctx MessageContext) map[string]any {
	raw, err := json.Marshal(m.ToWire(ctx))
	if err != nil {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var out map[string]any
	if err := dec.Decode(&out); err != nil {
		return nil
	}
	return out
}
