package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// SQL-копия правила (chatMutedSQL) и Go-правило (domain.ChatMuted) обязаны
// совпадать на ВСЕЙ матрице: тип чата × состояние мьюта чата × тип чатов
// включён/выключен. Опечатка в ветке CASE (например, groups_muted вместо
// private_muted) иначе прошла бы молча. Гейты, считающие в Go (ShouldNotify),
// и гейты, считающие в SQL (архив), сверяются с тем же правилом.
func TestChatMutedSQL_MatchesDomain(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewPushRepo(pool)
	chats := NewChatsRepo(pool)
	ctx := context.Background()
	now := time.Now()

	// тип чата → колонка notify_settings, которая им управляет (ForChatType)
	typeCol := map[string]string{
		"private": "private_muted", "saved": "private_muted", "group": "groups_muted", "channel": "channels_muted",
	}
	allCols := []string{"private_muted", "groups_muted", "channels_muted"}
	states := map[string]string{ // состояние muted_until → SQL-значение
		"NULL": "NULL", "0": "to_timestamp(0)",
		"past": "now() - interval '1 hour'", "future": "now() + interval '1 hour'",
	}
	stateTime := map[string]*time.Time{
		"NULL": nil, "0": ptrTime(time.Unix(0, 0)),
		"past": ptrTime(now.Add(-time.Hour)), "future": ptrTime(now.Add(time.Hour)),
	}

	n := 0
	for chatType, col := range typeCol {
		for stateName, stateSQL := range states {
			for _, typeMuted := range []bool{false, true} {
				n++
				user := seedUser(t, pool, fmt.Sprintf("+7980%05d", n))
				var chatID int64
				if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ($1) RETURNING id`, chatType).Scan(&chatID); err != nil {
					t.Fatal(err)
				}
				mustExec(t, pool, `INSERT INTO chat_members (chat_id, user_id, archived, muted_until) VALUES ($1,$2,true,`+stateSQL+`)`, chatID, user)
				// Управляющая колонка = typeMuted, остальные две — наоборот: ветка CASE,
				// взявшая не ту колонку, даст другой ответ.
				for _, c := range allCols {
					v := !typeMuted
					if c == col {
						v = typeMuted
					}
					mustExec(t, pool, `INSERT INTO notify_settings (user_id, `+c+`) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET `+c+`=$2`, user, v)
				}
				want := domain.ChatMuted(stateTime[stateName], typeMuted, now)
				label := fmt.Sprintf("%s/%s/тип заглушён=%v", chatType, stateName, typeMuted)

				var gotSQL bool
				if err := pool.QueryRow(ctx, `SELECT `+chatMutedSQL(joinedNotify)+`
				  FROM chat_members m JOIN chats c ON c.id = m.chat_id
				  LEFT JOIN notify_settings ns ON ns.user_id = m.user_id
				  WHERE m.chat_id=$1 AND m.user_id=$2`, chatID, user).Scan(&gotSQL); err != nil || gotSQL != want {
					t.Errorf("%s: chatMutedSQL(join) = %v,%v; ChatMuted = %v", label, gotSQL, err, want)
				}
				if ok, _, err := repo.ShouldNotify(ctx, chatID, user, 0, false); err != nil || ok == want {
					t.Errorf("%s: ShouldNotify = %v,%v; ChatMuted = %v", label, ok, err, want)
				}
				back, err := chats.UnarchiveUnmuted(ctx, chatID, []int64{user})
				if err != nil || (len(back) == 1) == want {
					t.Errorf("%s: UnarchiveUnmuted = %v,%v; ChatMuted = %v", label, back, err, want)
				}
			}
		}
	}

	if n != 32 {
		t.Fatalf("матрица прошла %d ячеек, want 32", n)
	}

	// Форум: чат с явным «уведомлять» при выключенном типе — нетронутая тема
	// наследует ЭТО решение (domain.TopicMuted поверх ChatMuted), а не тип.
	user := seedUser(t, pool, "+79809999")
	var forum int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, is_forum) VALUES ('group', true) RETURNING id`).Scan(&forum); err != nil {
		t.Fatal(err)
	}
	mustExec(t, pool, `INSERT INTO chat_members (chat_id, user_id, muted_until) VALUES ($1,$2,to_timestamp(0))`, forum, user)
	mustExec(t, pool, `INSERT INTO notify_settings (user_id, groups_muted) VALUES ($1, true)`, user)
	if ok, _, err := repo.ShouldNotify(ctx, forum, user, 4242, false); err != nil || !ok {
		t.Errorf("форум: явное «уведомлять» у чата, нетронутая тема, тип заглушён: ShouldNotify = %v,%v; want true", ok, err)
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
