package media

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/store/postgres"
)

func seedUser(t *testing.T, repo *Repo, phone string) int64 {
	t.Helper()
	var id int64
	err := repo.pool.QueryRow(context.Background(),
		`INSERT INTO users (phone, display_name) VALUES ($1,$1) RETURNING id`, phone).Scan(&id)
	if err != nil {
		t.Fatalf("seedUser: %v", err)
	}
	return id
}

func TestRepo_CreateAndGet(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := NewRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, repo, "+700")

	m, err := repo.Create(ctx, Media{
		OwnerID: owner, Bucket: "media", ObjectKey: "k1", Mime: "image/jpeg",
		Size: 1024, Width: 800, Height: 600, BlurPreview: []byte{1, 2, 3},
	})
	if err != nil || m.ID == 0 {
		t.Fatalf("Create = %+v, %v", m, err)
	}
	got, err := repo.GetByID(ctx, m.ID)
	if err != nil || got.ObjectKey != "k1" || got.Width != 800 || len(got.BlurPreview) != 3 {
		t.Fatalf("GetByID = %+v, %v", got, err)
	}
	if _, err := repo.GetByID(ctx, 999999); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
