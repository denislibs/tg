package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// Закрепление и архив диалогов (tweb toggleDialogPin / editPeerFolders):
// пер-юзерные флаги членства; изменения рассылаются на устройства владельца
// фреймами dialog_pin / dialog_archive (как draft_update).

// maxPinnedDialogs — лимит закреплённых в основном списке (tweb: «Sorry, you
// can only pin 5 chats to the top»).
const maxPinnedDialogs = 5

// PinDialog закрепляет/открепляет диалог вверху списка.
func (i *Interactor) PinDialog(ctx context.Context, chatID, userID int64, pinned bool) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	if pinned {
		n, err := i.groups.CountPinned(ctx, userID)
		if err != nil {
			return err
		}
		if n >= maxPinnedDialogs {
			return domain.ErrPinLimit
		}
	}
	if err := i.groups.SetPinned(ctx, chatID, userID, pinned); err != nil {
		return err
	}
	_ = i.logAndPublishPerPeer(ctx, chatID, []int64{userID}, "dialog_pin",
		func(peer domain.PeerID) map[string]any { return dialogPinPayload(peer, pinned) })
	return nil
}

// ArchiveDialog убирает диалог в архив / возвращает из него.
func (i *Interactor) ArchiveDialog(ctx context.Context, chatID, userID int64, archived bool) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrNotFound
	}
	if err := i.groups.SetArchived(ctx, chatID, userID, archived); err != nil {
		return err
	}
	folder := domain.FolderAll
	if archived {
		folder = domain.FolderArchive
	}
	_ = i.logAndPublishPerPeer(ctx, chatID, []int64{userID}, "dialog_archive",
		func(peer domain.PeerID) map[string]any { return dialogFolderPayload(peer, folder) })
	return nil
}

// Кадры уходят на ВСЕ устройства владельца и пишутся в его журнал: запись даёт
// плотный курсор, так что пин и переезд между папками доезжают и через /sync.
