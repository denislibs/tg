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
	ext, err := i.ExternalizeThreadRoots(ctx, msgs)
	if err != nil {
		return nil, err
	}
	ext = i.HydrateMessagePeers(ctx, ext)

	peers := make(map[int64]domain.PeerID, 1)
	posts := make(map[int64]bool, 1)
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
			typ, _ := i.chats.ChatType(ctx, m.ChatID)
			posts[m.ChatID] = typ == domain.ChatTypeChannel
		}
		out = append(out, m.ToWire(domain.MessageContext{
			Peer: domain.NewPeer(peer),
			Post: posts[m.ChatID],
			// Автор строки — ЗРИТЕЛЬ. Именно строки, а не проводного from_id: у
			// сообщения от лица канала автором на проводе становится канал, но
			// отправил его всё равно человек.
			Out: m.SenderID == viewerID,
		}))
	}
	return out, nil
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
