package chat

import "github.com/messenger-denis/backend/internal/domain"

// sliceDialogPage режет уже упорядоченный полный список на страницу по курсору.
//
// Порт модели tweb `dialogsStorage.getDialogs` (lib/storages/dialogs.ts:1691-1710):
// там курсор — значение сортировочного ключа и позиция ищется линейным поиском
// по кэшу; у нас сортировочный ключ наружу не выходит, поэтому опорой служит
// chat_id (см. докблок domain.DialogPage).
func sliceDialogPage(all []domain.Dialog, p domain.DialogPage) domain.DialogPageResult {
	count := len(all)

	from := 0
	if p.OffsetChatID != 0 {
		for i, d := range all {
			if d.ChatID == p.OffsetChatID {
				from = i + 1
				break
			}
		}
	}
	// from — либо 0, либо i+1 для валидного индекса i из range(all), т.е.
	// не больше count; отдельная защита от выхода за границы не нужна.

	to := count
	if p.Limit > 0 && from+p.Limit < to {
		to = from + p.Limit
	}

	return domain.DialogPageResult{
		Dialogs: all[from:to],
		Count:   count,
		IsEnd:   to >= count,
	}
}
