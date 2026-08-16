package chat

import "github.com/messenger-denis/backend/internal/domain"

// scopeDialogs — оставить диалоги запрошенной реальной папки. Порт tweb
// getFolderDialogs (dialogs.ts:433): выборка режется ДО подсчёта, поэтому
// Count и IsEnd относятся к папке, а не к полному набору, — без этого у
// клиента нет размера набора архива и его список не догружается вовсе
// (спека, «Размер набора известен только для Всех чатов»).
func scopeDialogs(all []domain.Dialog, f domain.DialogFolder) []domain.Dialog {
	if f == domain.FolderGlobal {
		return all
	}
	want := f == domain.FolderArchive
	out := make([]domain.Dialog, 0, len(all))
	for _, d := range all {
		if d.Archived == want {
			out = append(out, d)
		}
	}
	return out
}

// sliceDialogPage режет уже упорядоченный полный список на страницу по курсору.
//
// Порт модели tweb `dialogsStorage.getDialogs` (lib/storages/dialogs.ts:1691-1710):
// там курсор — значение сортировочного ключа и позиция ищется линейным поиском
// по кэшу; у нас сортировочный ключ наружу не выходит, поэтому опорой служит
// chat_id (см. докблок domain.DialogPage).
func sliceDialogPage(all []domain.Dialog, p domain.DialogPage) domain.DialogPageResult {
	all = scopeDialogs(all, p.Folder)
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
