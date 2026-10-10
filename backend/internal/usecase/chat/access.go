package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// ЕДИНЫЕ ПРЕДИКАТЫ ДОСТУПА И ВИДИМОСТИ (пачка Ф-1а).
//
// Два вопроса, и на каждый — один ответ на весь сервер:
//
//   - «читает ли зритель этот чат» — domain.ChatAccess.CanRead: участник либо
//     публичный чат, и не забанен. Прежде здесь стояли проверки членства по
//     местам, и в каждом месте своя: WS-подписка на канал, обсуждение,
//     карточка, просмотры и бусты не проверяли ничего, а публичный канал без
//     вступления не читался вовсе (отсюда авто-вступление клиента);
//   - «видит ли зритель это сообщение» — предикат хранилища (messageVisibleTo
//     в adapter/repo/postgres/visibility.go): удалённое, скрытое у себя,
//     очищенное и скрытая предыстория. Выборки истории, поиска, медиа, тем и
//     счётчиков подставляют его в SQL, а выдачи по адресу (номера сообщений,
//     пересылка) спрашивают VisibleIDs.
//
// Вызывающие из соседних пачек (роли, вступление, отправка) зовут эти
// функции, а не повторяют условия у себя.

// ChatAccess — снимок доступа зрителя к чату (вид, публичность, членство с
// ролью, бан). domain.ErrNotFound — чата нет.
func (i *Interactor) ChatAccess(ctx context.Context, chatID, userID int64) (domain.ChatAccess, error) {
	return i.chats.Access(ctx, chatID, userID)
}

// RequireChatRead — зритель читает чат (domain.ChatAccess.CanRead). Отказ —
// domain.ErrNotFound: о чужом приватном чате снаружи не должно быть известно
// даже то, что он есть (Telegram отвечает CHANNEL_PRIVATE и на «нет такого»,
// и на «не пускаю»).
func (i *Interactor) RequireChatRead(ctx context.Context, chatID, userID int64) error {
	a, err := i.chats.Access(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !a.CanRead() {
		return domain.ErrNotFound
	}
	return nil
}

// RequireDiscussionRead — группа groupID читается зрителем как ОБСУЖДЕНИЕ:
// либо он читает её саму (участник или публичная группа), либо это группа
// обсуждения канала, который он читает, и в самой группе он не забанен.
// Второе — комментарии поста: подписчик канала читает их без вступления в
// группу, но только если читает сам канал (у приватного канала посторонний
// получает CHANNEL_PRIVATE и на комментарии).
func (i *Interactor) RequireDiscussionRead(ctx context.Context, groupID, userID int64) error {
	a, err := i.chats.Access(ctx, groupID, userID)
	if err != nil {
		return err
	}
	if a.CanRead() {
		return nil
	}
	if a.Banned || i.groups == nil {
		return domain.ErrNotFound
	}
	channelID, err := i.groups.DiscussionChannel(ctx, groupID)
	if err != nil {
		return err
	}
	if channelID == 0 {
		return domain.ErrNotFound
	}
	return i.RequireChatRead(ctx, channelID, userID)
}

// RequireChannelCommentsRead — комментарии постов канала channelID (адрес
// «канал + пост»): зритель читает канал, а если у канала есть группа
// обсуждения — не забанен в ней. Возвращает id группы обсуждения (0 — её нет).
func (i *Interactor) RequireChannelCommentsRead(ctx context.Context, channelID, userID int64) (int64, error) {
	if err := i.RequireChatRead(ctx, channelID, userID); err != nil {
		return 0, err
	}
	disc, err := i.groups.GetDiscussion(ctx, channelID)
	if err != nil || disc == 0 {
		return 0, err
	}
	if banned, err := i.groups.IsBanned(ctx, disc, userID); err != nil {
		return 0, err
	} else if banned {
		return 0, domain.ErrNotFound
	}
	return disc, nil
}

// CanSubscribeChannel — можно ли сокету зрителя подписаться на живой топик
// пира (хаб, вступление в канал): ровно тогда, когда он этот чат читает. Иначе
// посторонний получал бы посты, правки, просмотры и счётчики комментариев
// приватного канала, перебирая id подряд.
func (i *Interactor) CanSubscribeChannel(ctx context.Context, userID int64, peer domain.PeerID) bool {
	if !peer.IsAnyChat() {
		return false
	}
	chatID, err := i.peerToChatID(ctx, userID, peer, false)
	if err != nil {
		return false
	}
	return i.RequireChatRead(ctx, chatID, userID) == nil
}

// visibleMessages — из msgs остаются только видимые зрителю (тот же предикат,
// что у истории). На месте прочих граница ставит messageEmpty — как на месте
// удалённого: невидимое сообщение для зрителя не существует.
func (i *Interactor) visibleMessages(ctx context.Context, viewerID int64, msgs []domain.Message) ([]domain.Message, error) {
	if len(msgs) == 0 {
		return msgs, nil
	}
	ids := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		ids = append(ids, m.ID)
	}
	vis, err := i.msgs.VisibleIDs(ctx, viewerID, ids)
	if err != nil {
		return nil, err
	}
	out := msgs[:0]
	for _, m := range msgs {
		if vis[m.ID] {
			out = append(out, m)
		}
	}
	return out, nil
}

// RequireMessagesVisible — зритель видит каждое из сообщений ids (ключи
// строк); иначе domain.ErrNotFound. Для действий над сообщением по адресу
// (пересылка): адрес невидимого сообщения ничем не отличается от адреса
// несуществующего.
func (i *Interactor) RequireMessagesVisible(ctx context.Context, viewerID int64, ids []int64) error {
	vis, err := i.msgs.VisibleIDs(ctx, viewerID, ids)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if !vis[id] {
			return domain.ErrNotFound
		}
	}
	return nil
}
