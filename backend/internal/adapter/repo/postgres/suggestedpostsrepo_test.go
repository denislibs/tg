package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestSuggestedPostsRepo_Lifecycle(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	author := seedUser(t, pool, "+7101")
	admin := seedUser(t, pool, "+7102")
	gr := NewGroupRepo(pool)
	chatID, err := gr.CreateMultiMember(ctx, "channel", "News", "", "", true, admin)
	if err != nil {
		t.Fatal(err)
	}
	if err := gr.AddMember(ctx, chatID, admin, domain.RoleCreator, domain.AllRights); err != nil {
		t.Fatal(err)
	}
	if err := gr.AddMember(ctx, chatID, author, domain.RoleSubscriber, 0); err != nil {
		t.Fatal(err)
	}

	r := NewSuggestedPostsRepo(pool)

	// Create pending with entities.
	sp, err := r.Create(ctx, domain.SuggestedPost{
		ChatID: chatID, AuthorID: author, Text: "hello",
		Entities: []domain.MessageEntity{{Type: "bold", Offset: 0, Length: 5}},
		Status:   "pending",
	})
	if err != nil {
		t.Fatal(err)
	}
	if sp.ID == 0 || sp.Status != "pending" || len(sp.Entities) != 1 {
		t.Fatalf("created = %+v", sp)
	}

	got, err := r.ByID(ctx, sp.ID)
	if err != nil || got.Text != "hello" || got.Entities[0].Type != "bold" {
		t.Fatalf("byID = %+v, %v", got, err)
	}

	pending, err := r.ListPending(ctx, chatID)
	if err != nil || len(pending) != 1 {
		t.Fatalf("pending = %d, %v", len(pending), err)
	}
	mine, err := r.ListByAuthor(ctx, chatID, author)
	if err != nil || len(mine) != 1 {
		t.Fatalf("byAuthor = %d, %v", len(mine), err)
	}

	// Decide → approved with a future publish time.
	future := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	dec, err := r.Decide(ctx, sp.ID, "approved", admin, &future)
	if err != nil {
		t.Fatal(err)
	}
	if dec.Status != "approved" || dec.DecidedBy == nil || *dec.DecidedBy != admin || dec.PublishAt == nil {
		t.Fatalf("decided = %+v", dec)
	}
	// pending list is now empty.
	if p, _ := r.ListPending(ctx, chatID); len(p) != 0 {
		t.Fatalf("pending after decide = %d", len(p))
	}
	// deciding an already-decided post fails.
	if _, err := r.Decide(ctx, sp.ID, "rejected", admin, nil); err != domain.ErrNotFound {
		t.Fatalf("re-decide = %v, want not found", err)
	}

	// Not due yet (future); make it due and check.
	if due, _ := r.DuePublish(ctx, time.Now(), 10); len(due) != 0 {
		t.Fatalf("due (future) = %d, want 0", len(due))
	}
	past := time.Now().Add(-time.Minute)
	if _, err := r.Decide(ctx, sp.ID, "approved", admin, &past); err != domain.ErrNotFound {
		// (post is no longer pending — Decide won't move it; adjust via a fresh row instead)
		_ = err
	}

	// Fresh row approved in the past → due; then MarkPublished clears it.
	sp2, _ := r.Create(ctx, domain.SuggestedPost{ChatID: chatID, AuthorID: author, Text: "later", Status: "pending"})
	if _, err := r.Decide(ctx, sp2.ID, "approved", admin, &past); err != nil {
		t.Fatal(err)
	}
	due, err := r.DuePublish(ctx, time.Now(), 10)
	if err != nil || len(due) != 1 || due[0].ID != sp2.ID {
		t.Fatalf("due = %+v, %v", due, err)
	}
	if err := r.MarkPublished(ctx, sp2.ID); err != nil {
		t.Fatal(err)
	}
	if d, _ := r.DuePublish(ctx, time.Now(), 10); len(d) != 0 {
		t.Fatalf("due after publish = %d, want 0", len(d))
	}

	// AdminIDs returns the creator only (subscriber excluded).
	admins, err := gr.AdminIDs(ctx, chatID)
	if err != nil || len(admins) != 1 || admins[0] != admin {
		t.Fatalf("adminIDs = %v, %v", admins, err)
	}
}
