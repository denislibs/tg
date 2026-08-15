// Package reactions — порт каталога доступных реакций (Telegram
// messages.getAvailableReactions). Интерактора нет: хендлер зовёт порт
// напрямую, как PushHandler зовёт usecasepush.SubRepo, — чистое чтение
// справочника без бизнес-логики не нуждается в промежуточном слое.
package reactions

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// CatalogRepo — часть AvailableReactionsRepo (пакет postgres), нужная
// хендлеру. Не путать с ReactionsRepo (тот же пакет postgres): тот хранит
// реакции пользователей на конкретных сообщениях, а этот — общий для всех
// справочник эмодзи-реакций с их файлами-ролями.
type CatalogRepo interface {
	List(ctx context.Context) ([]domain.AvailableReaction, error)
}
