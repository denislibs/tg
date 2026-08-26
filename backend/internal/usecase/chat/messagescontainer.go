package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// MessagesContainer готовит содержимое контейнера messages.Messages: вектор
// сообщений вместе с карточками их АВТОРОВ.
//
// Зачем автор едет рядом. У оригинала `users` — обязательный параметр обоих
// конструкторов контейнера, и это не формальность: получатель списка обязан
// уметь нарисовать подпись, не спрашивая ни о ком отдельно. Тот же ход уже
// сделан у диалогов (dialogscontainer.go), где отсутствие авторов заставляло
// сервер склеивать имя строкой (`last_sender_name`).
//
// Здесь же у сообщения доводится ТРЕД (`replies`) — параметр самого
// конструктора `message`, который до сих пор не заполнял никто, из-за чего
// счётчик комментариев и футер поста возились отдельной ручкой
// `/channels/{id}/comment_counts`. Просмотры (`views`) доводить не надо: они
// лежат прямо в строке (messagesrepo.go:27 `messageCols`, скан
// messagesrepo.go:1202) и уезжают на провод из неё же
// (domain/messagewire.go:134) — отдельная ручка `/channels/{id}/view_counts`
// читает ТУ ЖЕ колонку (messagesrepo.go:600) и потому дублирует историю
// целиком.
//
// Аватарки авторов гасятся правилом приватности — тем же, что у собеседников
// диалогов: карточка, доехавшая мимо правила, показала бы фото тому, кому
// автор его не открывал. Гейт стоит ОДИН на весь вектор — после слияния
// авторов с комментаторами: два прогона были бы двумя запросами за одним и тем
// же правилом, а комментаторы, приехавшие мимо гейта, светили бы фото.
//
// Вектор `chats` этой функцией НЕ наполняется, и это названный долг, а не
// пропуск: карточка нужна там, где автор — канал (пост от лица канала) либо
// где список пришёл из ГЛОБАЛЬНОГО поиска по чужим чатам. В остальных случаях
// чат уже известен клиенту из списка диалогов.
func (i *Interactor) MessagesContainer(ctx context.Context, viewerID int64, msgs []domain.Message) ([]domain.MTMessage, []domain.UserReal, error) {
	wire, kinds, err := i.messagesWire(ctx, viewerID, msgs)
	if err != nil {
		return nil, nil, err
	}
	users := mergeUserCards(i.messageAuthors(ctx, msgs), i.hydrateThreads(ctx, msgs, kinds, wire))
	i.gateAuthorPhotos(ctx, viewerID, users)
	return wire, users, nil
}

// messageAuthors — карточки авторов пачки, по одной на автора.
//
// Сбой запроса не роняет выдачу: список сообщений полезен и без подписей, а
// упавшая история полезна никому. Порядок тот же, что у диалогов.
func (i *Interactor) messageAuthors(ctx context.Context, msgs []domain.Message) []domain.UserReal {
	if i.groups == nil {
		return nil
	}
	seen := make(map[int64]bool, len(msgs))
	ids := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		if m.SenderID != 0 && !seen[m.SenderID] {
			seen[m.SenderID] = true
			ids = append(ids, m.SenderID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	authors, err := i.groups.UsersByIDs(ctx, ids)
	if err != nil {
		return nil
	}
	return authors
}

// hydrateThreads проставляет сообщениям пачки `replies` — тред конструктором
// messageReplies — и отдаёт карточки последних комментаторов, на которых тред
// ссылается (в схеме recent_repliers это Vector<Peer>, то есть ССЫЛКИ).
//
// ГДЕ ЕСТЬ ПРЕДМЕТ. Тред — свойство ВИДА ЧАТА, а не строки, поэтому решает
// `kinds`, уже прочитанный messagesWire:
//
//   - канал: у поста тред есть тогда, когда каналу привязана группа обсуждения
//     (CommentCounts сам возвращает пустоту без привязки, discussion.go:255).
//     Тред едет и с нулём комментариев — у оригинала это pFlags.comments +
//     channel_id, то есть «комментировать можно», а футер поста рисуется
//     именно по нему;
//   - группа: тред у сообщения есть, если на нём висят ответы — и это ровно
//     то, что рисует setBubbleRepliesCount (tweb bubbles.ts:6410, ветка
//     `message.replies && this.chat.isAnyGroup`, bubbles.ts:9699). Ни флага
//     comments, ни channel_id тут нет: комментарии канала — другой предмет;
//   - личный чат и «Избранное»: треда не бывает, и в базу за ним не ходим
//     вовсе — лишний запрос на каждую открытую переписку.
//
// Сбой подсчёта не роняет выдачу — то же правило, что у messageAuthors: чат
// без счётчика читается, упавший чат не читается никак.
//
// Позиции wire и msgs совпадают по построению (см. messagesWire).
func (i *Interactor) hydrateThreads(ctx context.Context, msgs []domain.Message, kinds map[int64]string, wire []domain.MTMessage) []domain.UserReal {
	if i.msgs == nil || len(msgs) == 0 {
		return nil
	}
	byChat := make(map[int64][]int64, 1)
	for _, m := range msgs {
		switch kinds[m.ChatID] {
		case domain.ChatTypeChannel, domain.ChatTypeGroup:
			byChat[m.ChatID] = append(byChat[m.ChatID], m.ID)
		}
	}
	if len(byChat) == 0 {
		return nil
	}
	threads := make(map[int64]domain.MessageReplies, len(msgs))
	var repliers []domain.UserReal
	for chatID, ids := range byChat {
		if kinds[chatID] == domain.ChatTypeChannel {
			if i.groups == nil {
				continue // привязку обсуждения спросить не у кого
			}
			byPost, cards, err := i.CommentCounts(ctx, chatID, ids)
			if err != nil {
				continue
			}
			for postID, rep := range byPost {
				threads[postID] = rep
			}
			repliers = append(repliers, cards...)
			continue
		}
		counts, err := i.msgs.ThreadReplyCounts(ctx, chatID, ids)
		if err != nil {
			continue
		}
		for rootID, n := range counts {
			threads[rootID] = domain.NewMessageReplies(n, 0, nil)
		}
	}
	if len(threads) == 0 {
		return repliers
	}
	for idx := range wire {
		rep, ok := threads[msgs[idx].ID]
		if !ok {
			continue
		}
		body, ok := wire[idx].(domain.MessageReal)
		if !ok {
			// Служебное сообщение (messageService) параметра replies не имеет:
			// у конструктора его нет вовсе.
			continue
		}
		body.Replies = &rep
		wire[idx] = body
	}
	return repliers
}

// mergeUserCards склеивает векторы карточек в ОДИН, по карточке на человека:
// автор сообщения и последний комментатор — часто одно лицо, и приехать дважды
// оно не должно. Первая карточка выигрывает — вектор авторов уже отобран
// правилом «по одной на автора».
func mergeUserCards(vectors ...[]domain.UserReal) []domain.UserReal {
	total := 0
	for _, v := range vectors {
		total += len(v)
	}
	if total == 0 {
		return nil
	}
	seen := make(map[int64]bool, total)
	out := make([]domain.UserReal, 0, total)
	for _, v := range vectors {
		for _, u := range v {
			if seen[u.ID] {
				continue
			}
			seen[u.ID] = true
			out = append(out, u)
		}
	}
	return out
}
