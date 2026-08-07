package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
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
	var thumbs, heart *domain.ReactionCount
	for i := range byMsg[msgID] {
		switch byMsg[msgID][i].Emoji {
		case "👍":
			thumbs = &byMsg[msgID][i]
		case "❤️":
			heart = &byMsg[msgID][i]
		}
	}
	if thumbs == nil || heart == nil {
		t.Fatalf("expected both 👍 and ❤️, got %+v", byMsg[msgID])
	}

	recentIDs := func(rc *domain.ReactionCount) []int64 {
		ids := make([]int64, len(rc.Recent))
		for i, p := range rc.Recent {
			ids[i] = p.ID
		}
		return ids
	}

	// 👍: 4 реакции, зритель u2 реагировал (mine), 3 свежих сверху (u4,u3,u2), u1 отсечён.
	if thumbs.Count != 4 || !thumbs.Mine {
		t.Fatalf("👍 count/mine = %d/%v, want 4/true", thumbs.Count, thumbs.Mine)
	}
	if got, want := recentIDs(thumbs), []int64{u4, u3, u2}; !equalInt64(got, want) {
		t.Fatalf("👍 recent = %v, want %v (свежие первыми, cap 3)", got, want)
	}
	// карточка несёт display_name (в сидере = phone) и пустой avatar.
	if thumbs.Recent[0].Name != "+7004" || thumbs.Recent[0].Avatar != "" {
		t.Fatalf("👍 recent[0] card = %+v, want name=+7004 avatar=''", thumbs.Recent[0])
	}

	// ❤️: 1 реакция от u1, зритель u2 её не ставил, recent = [u1].
	if heart.Count != 1 || heart.Mine {
		t.Fatalf("❤️ count/mine = %d/%v, want 1/false", heart.Count, heart.Mine)
	}
	if got := recentIDs(heart); len(got) != 1 || got[0] != u1 {
		t.Fatalf("❤️ recent = %v, want [%d]", got, u1)
	}
}

func equalInt64(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
