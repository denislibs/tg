package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestDraftsRepo_CRUD(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewDraftsRepo(pool)
	ctx := context.Background()
	user := seedUser(t, pool, "+7911")

	var chat1, chat2 int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chat1); err != nil {
		t.Fatalf("seed chat1: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chat2); err != nil {
		t.Fatalf("seed chat2: %v", err)
	}

	// Upsert создаёт, повторный — обновляет (та же пара чат+пользователь).
	reply := int64(42)
	d, err := r.Upsert(ctx, user, domain.Draft{
		ChatID: chat1, Text: "*bold* черновик",
		Entities:  []domain.MessageEntity{{Type: "bold", Offset: 0, Length: 4}},
		ReplyToID: &reply,
	})
	if err != nil || d.Text != "*bold* черновик" || d.ReplyToID == nil || *d.ReplyToID != 42 || len(d.Entities) != 1 {
		t.Fatalf("Upsert: %+v, %v", d, err)
	}
	d2, err := r.Upsert(ctx, user, domain.Draft{ChatID: chat1, Text: "обновлённый"})
	if err != nil || d2.Text != "обновлённый" || d2.ReplyToID != nil || d2.Entities != nil {
		t.Fatalf("Upsert update: %+v, %v", d2, err)
	}
	if !d2.UpdatedAt.Before(d.UpdatedAt) && !d2.UpdatedAt.After(d.UpdatedAt) && !d2.UpdatedAt.Equal(d.UpdatedAt) {
		t.Fatalf("UpdatedAt not set")
	}

	// Список пользователя.
	_, _ = r.Upsert(ctx, user, domain.Draft{ChatID: chat2, Text: "второй"})
	list, err := r.ListByUser(ctx, user)
	if err != nil || len(list) != 2 {
		t.Fatalf("ListByUser: %+v, %v", list, err)
	}

	// Delete: true при удалении, false при отсутствии.
	if ok, err := r.Delete(ctx, chat1, user); err != nil || !ok {
		t.Fatalf("Delete: %v %v", ok, err)
	}
	if ok, _ := r.Delete(ctx, chat1, user); ok {
		t.Fatalf("Delete again must be false")
	}

	// DeleteAllByUser возвращает chat_id удалённых.
	_, _ = r.Upsert(ctx, user, domain.Draft{ChatID: chat1, Text: "снова"})
	ids, err := r.DeleteAllByUser(ctx, user)
	if err != nil || len(ids) != 2 {
		t.Fatalf("DeleteAllByUser: %v, %v", ids, err)
	}
	if list, _ := r.ListByUser(ctx, user); len(list) != 0 {
		t.Fatalf("drafts must be empty: %+v", list)
	}
}
