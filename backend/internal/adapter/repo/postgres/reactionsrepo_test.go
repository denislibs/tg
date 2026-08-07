package postgres

import (
	"context"
	"testing"
	"time"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// TestReactionsFor_RecentUserIDs проверяет, что ReactionsFor возвращает до 3
// последних реагировавших (свежие первыми) на каждую реакцию — для аватаров в
// чипе (tweb: аватары вместо числа при count<4).
func TestReactionsFor_RecentUserIDs(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewReactionsRepo(pool)
	ctx := context.Background()

	u1 := seedUser(t, pool, "+7001")
	u2 := seedUser(t, pool, "+7002")
	u3 := seedUser(t, pool, "+7003")
	u4 := seedUser(t, pool, "+7004")

	var chatID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('group') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	var msgID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'text','hi') RETURNING id`,
		chatID, u1).Scan(&msgID); err != nil {
		t.Fatalf("seed message: %v", err)
	}

	// "👍" от u1..u4 с возрастающим created_at (u4 — самый свежий); "❤️" от u1.
	base := time.Now().Add(-time.Hour)
	seed := func(uid int64, emoji string, at time.Time) {
		if _, err := pool.Exec(ctx,
			`INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES ($1,$2,$3,$4)`,
			msgID, uid, emoji, at); err != nil {
			t.Fatalf("seed reaction: %v", err)
		}
	}
	seed(u1, "👍", base.Add(1*time.Minute))
	seed(u2, "👍", base.Add(2*time.Minute))
	seed(u3, "👍", base.Add(3*time.Minute))
	seed(u4, "👍", base.Add(4*time.Minute))
	seed(u1, "❤️", base.Add(5*time.Minute))

	byMsg, err := repo.ReactionsFor(ctx, []int64{msgID}, u2)
	if err != nil {
		t.Fatalf("ReactionsFor: %v", err)
	}
	counts := byMsg[msgID]

	var thumbs, heart *struct {
		count  int
		mine   bool
		recent []int64
	}
	for _, rc := range counts {
		v := &struct {
			count  int
			mine   bool
			recent []int64
		}{rc.Count, rc.Mine, rc.RecentUserIDs}
		switch rc.Emoji {
		case "👍":
			thumbs = v
		case "❤️":
			heart = v
		}
	}
	if thumbs == nil || heart == nil {
		t.Fatalf("expected both 👍 and ❤️, got %+v", counts)
	}

	// 👍: 4 реакции, зритель u2 реагировал (mine), 3 свежих сверху (u4,u3,u2), u1 отсечён.
	if thumbs.count != 4 || !thumbs.mine {
		t.Fatalf("👍 count/mine = %d/%v, want 4/true", thumbs.count, thumbs.mine)
	}
	want := []int64{u4, u3, u2}
	if len(thumbs.recent) != 3 || thumbs.recent[0] != want[0] || thumbs.recent[1] != want[1] || thumbs.recent[2] != want[2] {
		t.Fatalf("👍 recent = %v, want %v (свежие первыми, cap 3)", thumbs.recent, want)
	}

	// ❤️: 1 реакция от u1, зритель u2 её не ставил, recent = [u1].
	if heart.count != 1 || heart.mine {
		t.Fatalf("❤️ count/mine = %d/%v, want 1/false", heart.count, heart.mine)
	}
	if len(heart.recent) != 1 || heart.recent[0] != u1 {
		t.Fatalf("❤️ recent = %v, want [%d]", heart.recent, u1)
	}
}
