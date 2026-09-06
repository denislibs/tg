package postgres

import (
	"context"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// ЛИМИТ СВОИХ РЕАКЦИЙ ПОД ГОНКОЙ.
//
// Правило «не больше N своих реакций на сообщении» — read-modify-write:
// `evictExcessReactions` читает набор пользователя и дописывает в него. Наши
// транзакции идут на READ COMMITTED, поэтому два одновременных запроса одного
// пользователя (быстрый клик по двум чипам подряд) читают ОДНО И ТО ЖЕ «до» —
// каждый видит «своих ноль» — и оба вставляют. У аккаунта без премиума
// остаются две реакции при лимите одна.
//
// Проверять это фейками бесполезно: гонка живёт в изоляции СУБД, а замок
// (advisory на пару «сообщение + пользователь», ReactionsRepo.LockUserReactions)
// действует только внутри настоящей транзакции. Поэтому здесь собирается
// НАСТОЯЩИЙ юзкейс поверх настоящих репозиториев — тот же `React`, что зовёт
// обработчик POST.
func TestReact_ConcurrentAdds_KeepOneReaction(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	me := seedUser(t, pool, "+79990000201")
	author := seedUser(t, pool, "+79990000202")
	chatID := seedPrivateChat(t, pool, me, author)

	in := usecasechat.New(
		NewTxManager(pool),
		NewChatsRepo(pool),
		NewMessagesRepo(pool),
		NewUpdatesRepo(pool),
		NewReactionsRepo(pool),
		nil, nil, nil, nil, nil, nil,
	)

	// Один клик мимо второго — совпадение; правило должно держаться на каждом
	// сообщении, поэтому кейс прогоняется пачкой: без замка хотя бы одна пара
	// успевает прочитать общий пустой набор практически всегда.
	const messages = 8
	for n := 0; n < messages; n++ {
		msgID := seedMessage(t, pool, chatID, author, int64(n+1))

		start := make(chan struct{})
		var wg sync.WaitGroup
		errs := make([]error, 2)
		for k, emoji := range []string{"❤", "🔥"} {
			wg.Add(1)
			go func(k int, emoji string) {
				defer wg.Done()
				<-start // оба запроса стартуют одновременно
				errs[k] = in.React(ctx, chatID, msgID, me, emoji, true)
			}(k, emoji)
		}
		close(start)
		wg.Wait()
		for k, err := range errs {
			if err != nil {
				t.Fatalf("сообщение %d, React #%d: %v", n, k, err)
			}
		}

		var got int
		if err := pool.QueryRow(ctx,
			`SELECT count(*) FROM reactions WHERE message_id=$1 AND user_id=$2`, msgID, me).Scan(&got); err != nil {
			t.Fatalf("подсчёт реакций: %v", err)
		}
		if got != 1 {
			t.Fatalf("сообщение %d: своих реакций %d; лимит без премиума — одна, вторую должно было вытеснить", n, got)
		}
	}
}

// seedPrivateChat — приватный чат с двумя участниками (напрямую в SQL: тест
// проверяет правило реакций, а не создание чата).
func seedPrivateChat(t *testing.T, pool *pgxpool.Pool, a, b int64) int64 {
	t.Helper()
	ctx := context.Background()
	var chatID int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	for _, uid := range []int64{a, b} {
		if _, err := pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2)`, chatID, uid); err != nil {
			t.Fatalf("seed member %d: %v", uid, err)
		}
	}
	return chatID
}

func seedMessage(t *testing.T, pool *pgxpool.Pool, chatID, senderID, seq int64) int64 {
	t.Helper()
	var id int64
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,$2,$3,'text','hi') RETURNING id`,
		chatID, seq, senderID).Scan(&id); err != nil {
		t.Fatalf("seed message: %v", err)
	}
	return id
}
