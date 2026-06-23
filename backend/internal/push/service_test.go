package push

import (
	"context"
	"strconv"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/messenger-denis/backend/internal/store/postgres"
	"github.com/redis/go-redis/v9"
)

func setup(t *testing.T) (*Service, *miniredis.Miniredis, *redis.Client, int64, int64, int64) {
	t.Helper()
	pool := postgres.NewTestDB(t)
	mr, _ := miniredis.Run()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx := context.Background()
	var a, b, chatID int64
	_ = pool.QueryRow(ctx, `INSERT INTO users (phone, display_name) VALUES ('+700','+700') RETURNING id`).Scan(&a)
	_ = pool.QueryRow(ctx, `INSERT INTO users (phone, display_name) VALUES ('+701','+701') RETURNING id`).Scan(&b)
	_ = pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chatID)
	_, _ = pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2),($1,$3)`, chatID, a, b)
	return NewService(rdb, pool), mr, rdb, a, b, chatID
}

func streamLen(t *testing.T, rdb *redis.Client) int64 {
	n, _ := rdb.XLen(context.Background(), QueueStream).Result()
	return n
}

func TestService_EnqueuesWhenOffline(t *testing.T) {
	s, mr, rdb, a, b, chatID := setup(t)
	defer mr.Close()
	s.NotifyNewMessage(context.Background(), b, chatID, 10, 1, a, "hi")
	if streamLen(t, rdb) != 1 {
		t.Fatalf("expected 1 queued job, got %d", streamLen(t, rdb))
	}
}

func TestService_SkipsWhenOnline(t *testing.T) {
	s, mr, rdb, a, b, chatID := setup(t)
	defer mr.Close()
	mr.Set("presence:"+itoa(b), "1") // b is online
	s.NotifyNewMessage(context.Background(), b, chatID, 10, 1, a, "hi")
	if streamLen(t, rdb) != 0 {
		t.Fatalf("expected no queued job for online user, got %d", streamLen(t, rdb))
	}
}

func TestService_SkipsWhenMuted(t *testing.T) {
	s, mr, rdb, a, b, chatID := setup(t)
	defer mr.Close()
	_, _ = s.pool.Exec(context.Background(),
		`UPDATE chat_members SET muted=true WHERE chat_id=$1 AND user_id=$2`, chatID, b)
	s.NotifyNewMessage(context.Background(), b, chatID, 10, 1, a, "hi")
	if streamLen(t, rdb) != 0 {
		t.Fatalf("expected no queued job for muted chat, got %d", streamLen(t, rdb))
	}
}

func itoa(v int64) string { return strconvFormatInt(v) }

func strconvFormatInt(v int64) string { return strconv.FormatInt(v, 10) }
