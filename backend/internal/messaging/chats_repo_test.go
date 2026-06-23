package messaging

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func TestChatsRepo_CreateAndFindPrivate(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewChatsRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+700")
	b := seedUser(t, pool, "+701")

	if _, err := repo.FindPrivateChat(ctx, pool, a, b); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound before create, got %v", err)
	}
	chatID, err := repo.CreatePrivateChat(ctx, pool, a, b)
	if err != nil {
		t.Fatalf("CreatePrivateChat: %v", err)
	}
	found, err := repo.FindPrivateChat(ctx, pool, b, a) // order-independent
	if err != nil || found != chatID {
		t.Fatalf("FindPrivateChat = %d, %v; want %d", found, err, chatID)
	}

	ids, err := repo.MemberIDs(ctx, pool, chatID)
	if err != nil || len(ids) != 2 {
		t.Fatalf("MemberIDs = %v, %v", ids, err)
	}
	ok, _ := repo.IsMember(ctx, pool, chatID, a)
	if !ok {
		t.Fatal("expected a to be a member")
	}
	notMember := seedUser(t, pool, "+702")
	if ok, _ := repo.IsMember(ctx, pool, chatID, notMember); ok {
		t.Fatal("expected non-member to not be a member")
	}
}

func TestChatsRepo_ListDialogs(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewChatsRepo()
	ctx := context.Background()
	a := seedUser(t, pool, "+710")
	b := seedUser(t, pool, "+711")
	chatID, _ := repo.CreatePrivateChat(ctx, pool, a, b)

	dialogs, err := repo.ListDialogs(ctx, pool, a)
	if err != nil {
		t.Fatalf("ListDialogs: %v", err)
	}
	if len(dialogs) != 1 || dialogs[0].ChatID != chatID {
		t.Fatalf("unexpected dialogs: %+v", dialogs)
	}
	if dialogs[0].HasLast {
		t.Fatal("expected no last message in empty chat")
	}
}
