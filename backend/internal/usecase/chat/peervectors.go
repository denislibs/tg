package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// chatCards — строки чатов ids глазами зрителя (один сборщик: GroupRepo.Cards),
// в порядке ids. Без репозитория групп — пусто.
func (i *Interactor) chatCards(ctx context.Context, viewerID int64, ids []int64) ([]domain.ChatRecord, error) {
	if i.groups == nil || len(ids) == 0 {
		return nil, nil
	}
	return i.groups.Cards(ctx, viewerID, ids)
}

// chatChannels — краткие `channel` чатов ids глазами зрителя: полная форма
// для читаемого, честный min для нечитаемого (ChatRecord.Hidden). Сбой
// сборки не роняет выдачу — список полезен и без подписей.
func (i *Interactor) chatChannels(ctx context.Context, viewerID int64, ids []int64) []domain.Chat {
	cards, err := i.chatCards(ctx, viewerID, ids)
	if err != nil || len(cards) == 0 {
		return nil
	}
	out := make([]domain.Chat, 0, len(cards))
	for _, c := range cards {
		out = append(out, c.ToChannel())
	}
	return out
}

// peerVectors — векторы `users`/`chats` контейнера: карточки пиров, на
// которых ссылается его содержимое (refs — domain.CollectPeerRefs), глазами
// зрителя. have — карточки, уже собранные вызывающим: их не перезапрашивают, и
// в выдаче они идут первыми.
//
// Порт смысла tweb: любой ответ и любой апдейт везут рядом карточки всех, на
// кого ссылаются, и клиент сохраняет их ДО применения
// (appMessagesManager.saveApiResult, apiUpdatesManager.processUpdateMessage
// :259-262). Прежде векторы `chats` не наполнял никто, и строка поиска из
// чужого чата, «Переслано от» канала, тред в группе обсуждения оставались без
// имени — а без карточки группы композер треда показывал «Отправка сообщений
// запрещена» (A4-03, A4-04).
func (i *Interactor) peerVectors(ctx context.Context, viewerID int64, refs domain.PeerRefs, have []domain.UserReal) ([]domain.UserReal, []domain.Chat) {
	users := have
	if i.groups != nil && len(refs.Users) > 0 {
		present := make(map[int64]bool, len(have))
		for _, u := range have {
			present[u.ID] = true
		}
		missing := make([]int64, 0, len(refs.Users))
		for _, id := range refs.Users {
			if !present[id] {
				missing = append(missing, id)
			}
		}
		if len(missing) > 0 {
			if extra, err := i.groups.UsersByIDs(ctx, viewerID, missing); err == nil {
				i.viewUsers(ctx, viewerID, extra)
				users = mergeUserCards(have, extra)
			}
		}
	}
	return users, i.chatChannels(ctx, viewerID, refs.Chats)
}

// withChats — вектор chats, дополненный карточками ids, которых в нём ещё нет
// (связанный чат, о котором содержимое само не говорит).
func (i *Interactor) withChats(ctx context.Context, viewerID int64, chats []domain.Chat, ids ...int64) []domain.Chat {
	have := make(map[int64]bool, len(chats))
	for _, c := range chats {
		have[c.PeerID().ToChatID()] = true
	}
	missing := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id != 0 && !have[id] {
			have[id] = true
			missing = append(missing, id)
		}
	}
	return append(chats, i.chatChannels(ctx, viewerID, missing)...)
}

// PeerVectorsOf — векторы `users`/`chats` для готового тела ответа v: карточки
// всех, на кого оно ссылается (domain.CollectPeerRefs), глазами зрителя.
// Витрине списка (удалённые, ограниченные, заявки, транзакции, подарки) не
// нужно перечислять свои ссылки: у оригинала эти контейнеры несут карточки
// обязательными векторами, и без них каждая строка — отдельный /users (A4-14).
func (i *Interactor) PeerVectorsOf(ctx context.Context, viewerID int64, v any) ([]domain.UserReal, []domain.Chat) {
	return i.peerVectors(ctx, viewerID, domain.CollectPeerRefs(v), nil)
}
