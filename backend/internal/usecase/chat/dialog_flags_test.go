package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Пин/архив: члены могут закреплять до 5 диалогов; архив снимает пин; не-член — ErrNotFound.
func TestPinDialog_LimitAndArchive(t *testing.T) {
	fg := newFakeGroupRepo()
	for cid := int64(1); cid <= 7; cid++ {
		fg.members[cid] = map[int64]domain.Member{10: {ChatID: cid, UserID: 10, Role: "member"}}
	}
	in := New(fakeTx{}, groupChats{fg}, nil, nil, nil, nil, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())

	ctx := context.Background()
	for cid := int64(1); cid <= 5; cid++ {
		if err := in.PinDialog(ctx, cid, 10, true); err != nil {
			t.Fatalf("pin %d: %v", cid, err)
		}
	}
	// шестой — за лимитом
	if err := in.PinDialog(ctx, 6, 10, true); !errors.Is(err, domain.ErrPinLimit) {
		t.Fatalf("want ErrPinLimit, got %v", err)
	}
	// открепить и закрепить другой — можно
	if err := in.PinDialog(ctx, 1, 10, false); err != nil {
		t.Fatalf("unpin: %v", err)
	}
	if err := in.PinDialog(ctx, 6, 10, true); err != nil {
		t.Fatalf("pin after unpin: %v", err)
	}
	// архив снимает пин → место освобождается
	if err := in.ArchiveDialog(ctx, 2, 10, true); err != nil {
		t.Fatalf("archive: %v", err)
	}
	if err := in.PinDialog(ctx, 7, 10, true); err != nil {
		t.Fatalf("pin after archive freed a slot: %v", err)
	}
	// не-член
	if err := in.PinDialog(ctx, 99, 10, true); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound for non-member, got %v", err)
	}
	if err := in.ArchiveDialog(ctx, 99, 10, true); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound for non-member archive, got %v", err)
	}
}
