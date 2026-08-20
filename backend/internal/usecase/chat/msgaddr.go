package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// Адресация СООБЩЕНИЯ: наружу оно адресуется парой «пир + номер в чате».
//
// В схеме идентификатор сообщения один — `message.id`, и он по-пирный:
// идентичность это пара «пир + id». Наш `seq` (счётчик `UPDATE chats SET
// last_seq = last_seq + 1`) — ровно он: плотный, уникальный в пределах чата,
// от зрителя не зависит.
//
// Глобальный `messages.id BIGSERIAL PRIMARY KEY` остаётся ключом строки НАШЕЙ
// базы и наружу не выходит — тот же ход, что порт пиров сделал с `chats.id`.
// Внутренние ссылки на него (message_reactions.msg_id, message_mentions.msg_id,
// pinned_messages.msg_id — внешние ключи с ON DELETE CASCADE) остаются как есть:
// переводить целостность на (chat_id, seq) значило бы переделывать её ради
// косметики.
//
// Отдельного слоя вроде peeraddr.go здесь нет намеренно: там он существовал,
// потому что ключ пира приватного диалога ЗАВИСИТ ОТ ЗРИТЕЛЯ, а seq не зависит
// ни от кого. Перевод — обычный поиск по UNIQUE (chat_id, seq) из миграции
// 0002, поэтому этот файл только даёт ему имя и одну точку входа для границы
// (delivery/http, delivery/ws), а не заводит кэш или таблицу соответствий.

// MessageIDBySeq — внешний адрес (пир + номер) во внутренний ключ строки.
// Экспортирован для пограничных хендлеров: ровно как peerChatID переводит
// {peerID} в chatID, msgSeqID переводит {msgSeq} в messages.id.
// domain.ErrNotFound — такого номера в чате нет.
func (i *Interactor) MessageIDBySeq(ctx context.Context, chatID, seq int64) (int64, error) {
	return i.msgs.IDBySeq(ctx, chatID, seq)
}

// MessageIDsBySeqs — то же батчем (списки постов у счётчиков комментариев и
// просмотров): seq -> id, ненайденные в карту не попадают.
func (i *Interactor) MessageIDsBySeqs(ctx context.Context, chatID int64, seqs []int64) (map[int64]int64, error) {
	return i.msgs.IDsBySeqs(ctx, chatID, seqs)
}

// MessageSeqsByIDs — обратный батч (внутренний ключ -> номер) для витрин,
// которые отдают наружу ссылку, хранимую внутренним id: корень треда, корень
// форум-топика, счётчики по постам канала.
func (i *Interactor) MessageSeqsByIDs(ctx context.Context, ids []int64) (map[int64]int64, error) {
	return i.msgs.SeqsByIDs(ctx, ids)
}

// messageBySeq — сообщение чата по его номеру; domain.ErrNotFound, если номера
// в чате нет.
func (i *Interactor) messageBySeq(ctx context.Context, chatID, seq int64) (domain.Message, error) {
	msgs, err := i.msgs.GetBySeqs(ctx, chatID, []int64{seq})
	if err != nil {
		return domain.Message{}, err
	}
	if len(msgs) == 0 {
		return domain.Message{}, domain.ErrNotFound
	}
	return msgs[0], nil
}
