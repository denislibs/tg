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
