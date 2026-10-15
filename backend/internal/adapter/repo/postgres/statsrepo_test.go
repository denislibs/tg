package postgres

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// statsWindowFixture — канал с участниками и постами в двух неделях: «до»
// (now−14d…now−7d) и «последняя» (now−7d…now). Возвращает чат, границы окон
// в seq и момент «сейчас».
type statsWindowFixture struct {
	chat       int64
	now        time.Time
	seq0, seq1 int64 // последний seq до now−14d и до now−7d
}

func seedStatsWindows(t *testing.T) (*StatsRepo, statsWindowFixture) {
	t.Helper()
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	author := seedUser(t, pool, "+7980")
	other := seedUser(t, pool, "+7981")
	late := seedUser(t, pool, "+7982")
	ch := createGroupLike(t, pool, "channel", author)
	groups := NewGroupRepo(pool)
	for _, u := range []int64{other, late} {
		if err := groups.AddMember(ctx, ch, u, domain.RoleSubscriber, 0); err != nil {
			t.Fatal(err)
		}
	}
	// Автор вступил давно, other — 10 дней назад (до границы now−7d), late —
	// 2 дня назад (внутри окна).
	mustExec(t, pool, `UPDATE chat_members SET joined_at = now() - interval '30 days' WHERE chat_id=$1 AND user_id=$2`, ch, author)
	mustExec(t, pool, `UPDATE chat_members SET joined_at = now() - interval '10 days' WHERE chat_id=$1 AND user_id=$2`, ch, other)
	mustExec(t, pool, `UPDATE chat_members SET joined_at = now() - interval '2 days' WHERE chat_id=$1 AND user_id=$2`, ch, late)

	post := func(seq int64, sender int64, age string, views, forwards int64, reactions int, typ string, deleted bool) {
		id := seedMessage(t, pool, ch, sender, seq)
		mustExec(t, pool, `UPDATE messages SET created_at = now() - $2::interval, views=$3, forwards=$4, type=$5,
			deleted_at = CASE WHEN $6 THEN now() ELSE NULL END WHERE id=$1`, id, age, views, forwards, typ, deleted)
		for i := 0; i < reactions; i++ {
			voter := []int64{author, other, late}[i]
			mustExec(t, pool, `INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1,$2,'👍')`, id, voter)
		}
	}
	post(1, author, "20 days", 100, 9, 3, "text", false) // до обоих окон
	post(2, author, "12 days", 10, 2, 1, "text", false)  // предыдущее окно
	post(3, other, "9 days", 20, 0, 0, "text", false)    // предыдущее окно
	post(4, author, "8 days", 500, 50, 0, "text", true)  // удалён — не считается
	post(5, author, "6 days", 0, 0, 0, "service", false) // служебное — не пост
	post(6, author, "3 days", 8, 4, 2, "text", false)    // последнее окно
	post(7, late, "1 day", 12, 2, 1, "text", false)      // последнее окно

	return NewStatsRepo(pool), statsWindowFixture{chat: ch, now: time.Now().Add(time.Minute)}
}

func TestStatsRepo_SeqBeforeSkipsDeletedAndFindsWindowBounds(t *testing.T) {
	r, f := seedStatsWindows(t)
	ctx := context.Background()
	cases := []struct {
		name string
		age  time.Duration
		want int64
	}{
		{"раньше всех постов", 30 * 24 * time.Hour, 0},
		{"до now−14d — только пост 1", 14 * 24 * time.Hour, 1},
		// пост 4 (8 дней) удалён, пост 5 — 6 дней: последний видимый до now−7d — 3.
		{"до now−7d — пост 3, удалённый 4 пропущен", 7 * 24 * time.Hour, 3},
	}
	for _, tc := range cases {
		got, err := r.SeqBefore(ctx, f.chat, f.now.Add(-tc.age))
		if err != nil {
			t.Fatal(err)
		}
		if got != tc.want {
			t.Errorf("%s: SeqBefore = %d, want %d", tc.name, got, tc.want)
		}
	}
}

// Окно 7 дней (решение В-9): текущее — последняя неделя, предыдущее — неделя
// перед ней; посты считаются по seq-диапазону, участники — по joined_at.
func TestStatsRepo_SummaryWindowsCurrentAndPrevious(t *testing.T) {
	r, f := seedStatsWindows(t)
	ctx := context.Background()
	week := 7 * 24 * time.Hour
	seq0, err := r.SeqBefore(ctx, f.chat, f.now.Add(-2*week))
	if err != nil {
		t.Fatal(err)
	}
	seq1, err := r.SeqBefore(ctx, f.chat, f.now.Add(-week))
	if err != nil {
		t.Fatal(err)
	}

	cur, err := r.Summary(ctx, f.chat, seq1, math.MaxInt64, f.now)
	if err != nil {
		t.Fatal(err)
	}
	prev, err := r.Summary(ctx, f.chat, seq0, seq1, f.now.Add(-week))
	if err != nil {
		t.Fatal(err)
	}

	wantCur := domain.ChannelStatsSummary{Members: 3, TotalViews: 20, TotalForwards: 6, TotalReactions: 3, PostsCount: 2, PostersCount: 2}
	wantPrev := domain.ChannelStatsSummary{Members: 2, TotalViews: 30, TotalForwards: 2, TotalReactions: 1, PostsCount: 2, PostersCount: 2}
	if cur != wantCur {
		t.Errorf("current = %+v, want %+v", cur, wantCur)
	}
	if prev != wantPrev {
		t.Errorf("previous = %+v, want %+v", prev, wantPrev)
	}
}

// До создания первого поста окно пустое: нули, не ошибка.
func TestStatsRepo_SummaryEmptyWindow(t *testing.T) {
	r, f := seedStatsWindows(t)
	s, err := r.Summary(context.Background(), f.chat, 100, math.MaxInt64, f.now)
	if err != nil {
		t.Fatal(err)
	}
	if s.PostsCount != 0 || s.TotalViews != 0 || s.PostersCount != 0 {
		t.Errorf("пустое окно: %+v", s)
	}
}
