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
	// ВАЖНО про сторону бабла: `out` отвечает «я ли отправил», а сторону решает
	// КЛИЕНТ — и решает он её иначе, чем сказано было здесь раньше.
	//
	// Прежняя формулировка («сообщение от лица канала рисуется входящим, клиент
	// понимает это по `from_id`») смешивала два разных случая и оказалась
	// ошибкой. В оригинале (tweb `chat.ts:1374-1390`) ветка МЕГАГРУППЫ берёт
	// сырой `out` первой же строкой — значит своё сообщение от лица канала
	// рисуется ИСХОДЯЩИМ. Входящим рисуется другое: автофорвард поста канала в
	// группу обсуждения, у которого `out` не стоит вовсе, и собственный пост
	// ВЕЩАТЕЛЬНОГО канала — его отсекает терм `!pFlags.post`.
	//
	// Серверу от этого не меняется ничего: он по-прежнему отвечает только на
	// вопрос «отправил ли это зритель». Оговорка стоит здесь потому, что
	// неверная её версия однажды уже уехала в постановку порта фронта.
	Out bool
}

// ToWire собирает конструктор схемы: messageService, когда у сообщения есть
// действие, иначе message. «Служебное ли» — ВЫБОР КОНСТРУКТОРА, а не значение
// поля type (решение Р2): вид вложения даёт объединение MessageMedia, а
// строкового дискриминатора на проводе больше нет.
func (m Message) ToWire(ctx MessageContext) MTMessage {
	if action := m.wireAction(); action != nil {
		return m.toService(ctx, action)
	}
	return m.toReal(ctx)
}

// wireAction — служебное действие сообщения. Обычно это колонка messages.action,
// но у ПОДАРКА действие собирается из read-модели, и это не поблажка: медиа
// подарка в схеме не существует, там подарок — служебное сообщение с действием
// messageActionStarGift (разбор в mtgift.go). Наше сообщение типа 'gift' и так
// не несёт ни текста, ни медиа, ни разметки — то есть уже является пилюлей, и
// выбор конструктора лишь называет это вслух.
func (m Message) wireAction() MessageAction {
	if m.Action != nil {
		return m.Action
	}
	if m.Gift != nil {
		return m.Gift.ToAction()
	}
	return nil
}

func (m Message) toService(ctx MessageContext, action MessageAction) MessageService {
	s := NewMessageService(m.Seq, ctx.Peer, m.CreatedAt, action, ctx.Post)
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
	if photo := MediaPhoto(m.Media); photo != nil {
		switch a := s.Action.(type) {
		case MessageActionChatEditPhoto:
			a.Photo = photo
			s.Action = a
		case MessageActionSuggestProfilePhoto:
			a.Photo = photo
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
	r.Media = m.mediaWire()
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
// WireReactions — тот же агрегат, что едет внутри сообщения. Экспортирован для
// кадра реакций: второй сборки у этого объекта быть не должно.
func (m Message) WireReactions() *MessageReactions { return m.reactions() }

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

// mediaWire — вложение сообщения ОДНИМ конструктором объединения MessageMedia.
// Единственное место, где строка витрины отвечает на вопрос «что приложено»:
// прежде гео, контакт, опрос, чек-лист, розыгрыш, превью ссылки и платное медиа
// ехали СЕМЬЮ собственными ключами рядом с `media`, то есть вид вложения был
// подделан наличием поля — ровно так же, как вид кнопки клавиатуры до порта
// разметки.
//
// Порядок ветвей — не вкусовщина, а взаимоисключительность в схеме: вложение
// ровно одно.
//
//   - ПЛАТНОЕ МЕДИА идёт первым, потому что оно ОБЁРТКА: настоящее фото или
//     документ лежит внутри его вектора extended_media (либо не лежит вовсе,
//     если зритель не оплатил);
//   - гео/место/контакт/опрос/чек-лист/розыгрыш — виды сообщения, у которых
//     файла нет вовсе (колонка media_id у них пуста);
//   - фото/документ — обычное вложение;
//   - ПРЕВЬЮ ССЫЛКИ идёт последним и только у сообщения без файла: у оригинала
//     карточка ссылки — это messageMediaWebPage, то есть само вложение, а у
//     сообщения-картинки со ссылкой в подписи превью не бывает вовсе.
func (m Message) mediaWire() MessageMedia {
	switch {
	case m.PaidMediaPrice != nil:
		return NewMessageMediaPaidMedia(*m.PaidMediaPrice, m.Media, m.PaidMediaLocked)
	case m.GeoLat != nil && m.GeoLng != nil:
		return m.geoWire()
	case m.ContactUserID != nil:
		return NewMessageMediaContact(*m.ContactUserID, deref(m.ContactName), deref(m.ContactPhone))
	case m.Poll != nil:
		return m.Poll.ToMedia()
	case m.Checklist != nil:
		return m.Checklist.ToMedia()
	case m.Giveaway != nil:
		return m.Giveaway.ToMedia(m.Seq)
	case m.Media != nil:
		return m.Media
	case m.WebPage != nil:
		return m.WebPage.ToMedia()
	}
	return nil
}

// geoWire — три конструктора гео, которые наши плоские поля смешивали в один
// ключ: живая трансляция, место с подписью и просто точка.
//
// ── Про два смысла edited_at ────────────────────────────────────────────────
// Времени обновления координат внутри гео НЕТ и быть не может: на верхнем
// уровне это message.edit_date, и в схеме у гео своего времени не существует.
// Прежде одно и то же edited_at ехало ДВАЖДЫ — временем правки снаружи и
// временем обновления трансляции внутри geo.
//
// Зато edit_date участвует здесь иначе, и это не возврат склейки: досрочно
// остановленная трансляция едет с УКОРОЧЕННЫМ period, потому что «остановлена»
// в схеме выражается истечением срока (см. докблок MessageMediaGeoLive), а
// момент остановки — это и есть время последней правки.
func (m Message) geoWire() MessageMedia {
	lat, lng := *m.GeoLat, *m.GeoLng
	if m.GeoLivePeriod != nil {
		period := *m.GeoLivePeriod
		if m.GeoLiveStopped {
			// Ноль — «истекла в момент отправки»: он остаётся, если времени
			// остановки в строке почему-то нет. Подделать «идёт» нельзя.
			period = 0
			if m.EditedAt != nil {
				if elapsed := int(m.EditedAt.Sub(m.CreatedAt).Seconds()); elapsed > 0 && elapsed < *m.GeoLivePeriod {
					period = elapsed
				}
			}
		}
		return NewMessageMediaGeoLive(lat, lng, period, deref(m.GeoHeading))
	}
	if deref(m.GeoTitle) != "" || deref(m.GeoAddress) != "" {
		return NewMessageMediaVenue(lat, lng, deref(m.GeoTitle), deref(m.GeoAddress))
	}
	return NewMessageMediaGeo(lat, lng)
}

// attachOurPayload переносит на конструктор наши параметры вне схемы: ключ
// сопоставления эха и шифртекст секретного чата. Оба названы в MessageReal —
// здесь только перенос.
func (m Message) attachOurPayload(r *MessageReal) {
	if m.ClientMsgID != nil {
		r.RandomID = *m.ClientMsgID
	}
	if m.EncBody != nil {
		r.EncBody = base64.StdEncoding.EncodeToString(m.EncBody)
		if m.DestructAt != nil {
			at := m.DestructAt.Format(time.RFC3339Nano)
			r.DestructAt = &at
		}
	}
}

// deref — значение необязательного поля строки витрины либо нулевое. Нужен
// ровно там, где параметр схемы ОБЯЗАТЕЛЕН: пустая строка это «значения нет», а
// не «ключа нет».
func deref[T any](v *T) T {
	if v == nil {
		var zero T
		return zero
	}
	return *v
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
