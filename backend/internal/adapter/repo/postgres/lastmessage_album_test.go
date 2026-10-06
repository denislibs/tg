package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// LastMessageAt отдаёт медленному режиму альбом последнего сообщения: его
// grouped_id и сколько живых элементов этого альбома у отправителя (аудит
// A5-20 — альбом считается одной единицей, а не каждым элементом).
func TestLastMessageAt_ReportsAlbum(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	me := seedUser(t, pool, "+79990000211")
	peer := seedUser(t, pool, "+79990000212")
	chatID := seedPrivateChat(t, pool, me, peer)
	repo := NewMessagesRepo(pool)

	if _, _, _, err := repo.LastMessageAt(ctx, chatID, me); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("без сообщений: %v, want ErrNotFound", err)
	}
	seedMessage(t, pool, chatID, me, 1)
	if _, g, n, err := repo.LastMessageAt(ctx, chatID, me); err != nil || g != 0 || n != 0 {
		t.Fatalf("одиночное: grouped=%d size=%d err=%v, want 0/0", g, n, err)
	}
	for seq := int64(2); seq <= 4; seq++ {
		id := seedMessage(t, pool, chatID, me, seq)
		if _, err := pool.Exec(ctx, `UPDATE messages SET grouped_id=77 WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	// Чужой элемент с тем же ключом не в счёт; удалённый свой — в счёт
	// (снятие элементов не открывает альбом заново).
	other := seedMessage(t, pool, chatID, peer, 5)
	if _, err := pool.Exec(ctx, `UPDATE messages SET grouped_id=77 WHERE id=$1`, other); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE messages SET deleted_at=now() WHERE chat_id=$1 AND seq=2`, chatID); err != nil {
		t.Fatal(err)
	}
	at, g, n, err := repo.LastMessageAt(ctx, chatID, me)
	if err != nil || g != 77 || n != 3 || at.IsZero() {
		t.Fatalf("альбом: at=%v grouped=%d size=%d err=%v, want 77/3", at, g, n, err)
	}
}
