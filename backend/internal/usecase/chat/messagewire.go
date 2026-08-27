package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// ЕДИНАЯ точка, которой сообщения покидают процесс через HTTP. Кадр
// (messageUpdatePayload) собирает тот же Message.ToWire — второго
// сериализатора у сообщения больше нет (решение Р5 разбора).
//
// Что здесь доделывается батчево — то, чего строка выборки о себе не знает:
//
//   - НОМЕР КОРНЯ ТРЕДА (ExternalizeThreadRoots): в строке лежит внутренний
//     ключ, наружу едет номер в том же пире;
//   - ССЫЛКИ НА ПИРЫ ВНУТРИ сообщения (fwd_from.from_id, reply_to_peer_id):
//     собрать их из плоских колонок можно только зная ВИД чата-источника, см.
//     messagepeers.go;
//   - КЛЮЧ ПИРА ГЛАЗАМИ ЗРИТЕЛЯ: у приватного диалога стороны видят разный;
//   - «ЭТО ПОСТ КАНАЛА»: свойство чата, а не строки.
//
// Два последних резолвятся ПО ОДНОМУ РАЗУ НА ЧАТ: список истории почти всегда
// из одного чата, а N+1 на страницу здесь недопустим — ровно он когда-то и
// заставил сервер склеивать имя автора подзапросом вместо того, чтобы отдать
// автора пиром.

// MessagesWire переводит список сообщений в конструкторы схемы глазами
// зрителя.
//
// Сбой перевода корней треда — ОШИБКА, а не деградация «отдать как есть».
// Прежде здесь стояло `ext = msgs` с обоснованием «лучше 500-й»: тогда наружу
// уезжал внутренний ключ строки, и клиент такой корень просто не находил.
// После сведения адресации (шаг B) ключ строки и номер сообщения живут в ОДНОМ
// пространстве чисел, поэтому утёкший ключ почти наверняка попадёт в
// существующее сообщение другого чата — молчаливая подмена вместо промаха.
func (i *Interactor) MessagesWire(ctx context.Context, viewerID int64, msgs []domain.Message) ([]domain.MTMessage, error) {
	return i.messagesWire(ctx, viewerID, msgs, i.chatKinds(ctx, msgs), nil)
}

// chatKinds — вид чата каждого сообщения пачки (chatID ->
// 'private'|'group'|'channel'|'saved'), по одному запросу на ЧАТ.
//
// Отдельным проходом, а не внутри сборки конструкторов: вид нужен ДО неё —
// именно он решает, у кого из пачки вообще бывает тред (threadReplies), а тред
// едет параметром самого сообщения. Спросить вид второй раз значило бы добавить
// запрос на каждый чат страницы, в том числе на личный, где считать нечего.
func (i *Interactor) chatKinds(ctx context.Context, msgs []domain.Message) map[int64]string {
	kinds := make(map[int64]string, 1)
	if i.chats == nil {
		return kinds
	}
	for _, m := range msgs {
		if _, ok := kinds[m.ChatID]; ok {
			continue
		}
		kinds[m.ChatID], _ = i.chats.ChatType(ctx, m.ChatID)
	}
	return kinds
}

// messagesWire — тот же перевод, но с уже готовыми видами чатов и тредами.
//
// threads — тред по КЛЮЧУ СТРОКИ сообщения (см. threadReplies); nil значит «у
// этой пачки тредов не спрашивали». Тред приезжает сюда, а не дописывается в
// готовый конструктор после: replies — параметр самого `message`, и ставит его
// та же единственная сборка (Message.ToWire), что и остальные.
//
// Длина результата равна длине входа, и порядок сохранён: доводчики пачки
// адресуют сообщения по позиции.
func (i *Interactor) messagesWire(
	ctx context.Context, viewerID int64, msgs []domain.Message,
	kinds map[int64]string, threads map[int64]domain.MessageReplies,
) ([]domain.MTMessage, error) {
	ext, err := i.ExternalizeThreadRoots(ctx, msgs)
	if err != nil {
		return nil, err
	}
	ext = i.HydrateMessagePeers(ctx, ext)

	peers := make(map[int64]domain.PeerID, 1)
	out := make([]domain.MTMessage, 0, len(ext))
	for _, m := range ext {
		peer, ok := peers[m.ChatID]
		if !ok {
			// Ключ пира тоже не деградирует до нуля: peerUser(0) — существующая
			// форма адреса, и клиент отнёс бы сообщение к чужому пиру.
			peer, err = i.ChatIDToPeer(ctx, viewerID, m.ChatID)
			if err != nil {
				return nil, err
			}
			peers[m.ChatID] = peer
		}
		out = append(out, m.ToWire(domain.MessageContext{
			Peer: domain.NewPeer(peer),
			Post: kinds[m.ChatID] == domain.ChatTypeChannel,
			// Автор строки — ЗРИТЕЛЬ. Именно строки, а не проводного from_id: у
			// сообщения от лица канала автором на проводе становится канал, но
			// отправил его всё равно человек.
			Out:     m.SenderID == viewerID,
			Replies: repliesOf(threads, m.ID),
		}))
	}
	return out, nil
}

// repliesOf — тред сообщения из карты пачки. «Треда нет» — nil, а не пустой
// messageReplies: у конструктора message параметр необязательный.
func repliesOf(threads map[int64]domain.MessageReplies, msgID int64) *domain.MessageReplies {
	rep, ok := threads[msgID]
	if !ok {
		return nil
	}
	return &rep
}

// EmptyMessages — конструкторы «дыры» для номеров, у которых сообщения нет
// (решение шага: у messageEmpty появляется производитель).
//
// Сегодня на ссылку в удалённое сообщение — цель ответа, корень треда, строка
// индекса закреплённых — сервер отдавал МОЛЧАНИЕ: объекта просто не было в
// ответе, и клиент не отличал «ещё не загружено» от «больше не существует».
// Конструктор messageEmpty объявлен ровно под это.
func EmptyMessages(peer domain.PeerID, ids []int64) []domain.MTMessage {
	out := make([]domain.MTMessage, 0, len(ids))
	for _, id := range ids {
		out = append(out, domain.MessageEmpty{
			Underscore: domain.MessageEmptyTag,
			ID:         id,
			PeerID:     domain.NewPeer(peer),
		})
	}
	return out
}
