package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestPublicRepo_Resolve(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewPublicRepo(pool)
	ctx := context.Background()

	uid := seedUser(t, pool, "+7901")
	if _, err := pool.Exec(ctx,
		`UPDATE users SET username='pub_user', display_name='Паша', bio='обо мне', avatar_url='/media/42/content' WHERE id=$1`, uid); err != nil {
		t.Fatal(err)
	}

	p, err := r.Resolve(ctx, "pub_user")
	if err != nil || p.Kind != "user" || p.Title != "Паша" || p.About != "обо мне" || p.AvatarMediaID != 42 {
		t.Fatalf("user resolve = %+v, %v", p, err)
	}

	var chatID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, about, username, is_public, member_count)
		 VALUES ('channel','Новости','описание','pub_channel',true,7) RETURNING id`).Scan(&chatID); err != nil {
		t.Fatal(err)
	}
	p, err = r.Resolve(ctx, "pub_channel")
	if err != nil || p.Kind != "channel" || p.Title != "Новости" || p.MemberCount != 7 {
		t.Fatalf("channel resolve = %+v, %v", p, err)
	}

	if _, err := r.Resolve(ctx, "nope_nope"); err != domain.ErrNotFound {
		t.Fatalf("missing username: %v, want ErrNotFound", err)
	}
}
