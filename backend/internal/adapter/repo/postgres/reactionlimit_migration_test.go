package postgres

import (
	"context"
	"sort"
	"testing"
	"time"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0130 приводит УЖЕ НАКОПЛЕННЫЕ реакции к правилу «один пользователь —
// не больше N своих реакций на одном сообщении» (N = 1 без премиума, 3 с ним —
// дефолты Telegram reactions_user_max_default/_premium, tweb
// src/lib/appManagers/apiManagerMethods.ts:375).
//
// Проверять глазами по тексту SQL тут нечего: вопрос не «синтаксис верен», а
// «остались ли ИМЕННО новейшие и не задело ли чужие строки». Схема теста — по
// соседям (langpack_migration_test.go): откат на версию назад, запись строк в
// нарушающей форме, накат, чтение результата.
const reactionLimitMigrationPrevVersion = 129

func TestMigration0130_TrimsUserReactionsToLimit(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	// ── 1. Откат: строки, накопленные до правила, никуда не деваются ────────
	if err := storepostgres.MigrateDownTo(url, reactionLimitMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", reactionLimitMigrationPrevVersion, err)
	}

	plain := seedUser(t, pool, "+79990000101")
	premium := seedUser(t, pool, "+79990000102")
	if _, err := pool.Exec(ctx, `UPDATE users SET is_premium = true WHERE id = $1`, premium); err != nil {
		t.Fatalf("выдача премиума: %v", err)
	}

	var chatID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('group') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	var msgID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'text','hi') RETURNING id`,
		chatID, plain).Scan(&msgID); err != nil {
		t.Fatalf("seed message: %v", err)
	}

	base := time.Now().Add(-time.Hour)
	seed := func(uid int64, emoji string, at time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES ($1,$2,$3,$4)`,
			msgID, uid, emoji, at); err != nil {
			t.Fatalf("seed reaction: %v", err)
		}
	}
	// Ровно случай из отчёта: три реакции одного аккаунта на одном посте.
	seed(plain, "❤", base.Add(1*time.Minute))
	seed(plain, "🔥", base.Add(2*time.Minute))
	seed(plain, "🥰", base.Add(3*time.Minute))
	// У премиума четыре — вытесниться должна ровно одна, самая старая.
	seed(premium, "❤", base.Add(1*time.Minute))
	seed(premium, "🔥", base.Add(2*time.Minute))
	seed(premium, "🥰", base.Add(3*time.Minute))
	seed(premium, "👏", base.Add(4*time.Minute))

	// ── 2. Накат: данные приведены к правилу ────────────────────────────────
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0130: %v", err)
	}

	mine := func(uid int64) []string {
		t.Helper()
		rows, err := pool.Query(ctx,
			`SELECT emoji FROM reactions WHERE message_id=$1 AND user_id=$2`, msgID, uid)
		if err != nil {
			t.Fatalf("чтение реакций: %v", err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var e string
			if err := rows.Scan(&e); err != nil {
				t.Fatalf("скан: %v", err)
			}
			out = append(out, e)
		}
		sort.Strings(out)
		return out
	}

	// Без премиума остаётся ОДНА, и именно новейшая.
	if got, want := mine(plain), []string{"🥰"}; !equalStringsPG(got, want) {
		t.Fatalf("у не-подписчика осталось %v; want %v (новейшая)", got, want)
	}
	// С премиумом остаются ТРИ новейшие: старейшая ❤ вытеснена.
	if got, want := mine(premium), []string{"👏", "🔥", "🥰"}; !equalStringsPG(got, want) {
		t.Fatalf("у подписчика осталось %v; want %v (три новейшие)", got, want)
	}
}

// Порядок постановки — то, чем юзкейс выбирает жертву вытеснения; без него
// «самая старая» была бы любой.
func TestReactionsRepo_UserReactionsOldestFirst(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewReactionsRepo(pool)
	ctx := context.Background()

	me := seedUser(t, pool, "+79990000111")
	other := seedUser(t, pool, "+79990000112")

	var chatID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('group') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	var msgID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'text','hi') RETURNING id`,
		chatID, me).Scan(&msgID); err != nil {
		t.Fatalf("seed message: %v", err)
	}

	base := time.Now().Add(-time.Hour)
	seed := func(uid int64, emoji string, at time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES ($1,$2,$3,$4)`,
			msgID, uid, emoji, at); err != nil {
			t.Fatalf("seed reaction: %v", err)
		}
	}
	seed(me, "🥰", base.Add(3*time.Minute))
	seed(me, "❤", base.Add(1*time.Minute))
	seed(me, "🔥", base.Add(2*time.Minute))
	seed(other, "👏", base.Add(1*time.Second)) // чужая — в мой список не попадает

	got, err := repo.UserReactions(ctx, msgID, me)
	if err != nil {
		t.Fatalf("UserReactions: %v", err)
	}
	if want := []string{"❤", "🔥", "🥰"}; !equalStringsPG(got, want) {
		t.Fatalf("UserReactions = %v; want %v (старейшие первыми, только свои)", got, want)
	}
}

func equalStringsPG(a, b []string) bool {
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
