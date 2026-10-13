package postgres

import (
	"context"
	"sync"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// F6: встречные «удалить чат у обоих» в одной личке не блокируют друг друга.
// Каждая транзакция берёт строки chat_members в порядке «свой → собеседник»,
// поэтому без общего замка пара с разных сторон ловит `deadlock detected`.
// Замок — advisory на чат, первая команда транзакции (ChatsRepo.LockDialogDelete).
func TestDeleteDialog_OppositeRevokeNoDeadlock(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	alice := seedUser(t, pool, "+79990000301")
	bob := seedUser(t, pool, "+79990000302")
	chatID := seedPrivateChat(t, pool, alice, bob)

	in := usecasechat.New(NewTxManager(pool), NewChatsRepo(pool), NewMessagesRepo(pool),
		NewUpdatesRepo(pool), NewReactionsRepo(pool), nil, nil, nil, nil, nil, nil)

	for n := 0; n < 30; n++ {
		seedMessage(t, pool, chatID, alice, int64(2*n+1))
		seedMessage(t, pool, chatID, bob, int64(2*n+2))
		start := make(chan struct{})
		var wg sync.WaitGroup
		errs := make([]error, 2)
		for k, actor := range []int64{alice, bob} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				_, errs[k] = in.DeleteDialog(ctx, chatID, actor, true)
			}()
		}
		close(start)
		wg.Wait()
		for k, err := range errs {
			if err != nil {
				t.Fatalf("итерация %d, сторона %d: %v", n, k, err)
			}
		}
	}
}
