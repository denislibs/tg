package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Self-destruct на реальной схеме: SetDestructOnRead запускает таймер только для
// секретных сообщений, которые читатель ПОЛУЧИЛ (sender_id<>reader), а реапер
// (ExpiredMessages+SoftDelete) стирает шифртекст.
func TestMessagesRepo_SelfDestruct(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()

	a := seedUser(t, pool, "+801") // отправитель
	b := seedUser(t, pool, "+802") // получатель
	chID, err := chats.CreateSecret(ctx, a, b)
	if err != nil {
		t.Fatalf("create secret: %v", err)
	}

	ttl := 60
	// Сообщение от A с ttl и шифртекстом — B его получил.
	recv, err := msgs.Insert(ctx, domain.Message{
		ChatID: chID, Seq: 1, SenderID: a, Type: "encrypted",
		EncBody: []byte{1, 2, 3}, TTLSeconds: &ttl,
	})
	if err != nil {
		t.Fatalf("insert received: %v", err)
	}
	// Второе сообщение от A — используем, чтобы убедиться, что для отправителя
	// таймер не запускается.
	own, err := msgs.Insert(ctx, domain.Message{
		ChatID: chID, Seq: 2, SenderID: a, Type: "encrypted",
		EncBody: []byte{4, 5, 6}, TTLSeconds: &ttl,
	})
	if err != nil {
		t.Fatalf("insert own: %v", err)
	}

	destructAt := func(msgID int64) *time.Time {
		t.Helper()
		var at *time.Time
		if err := pool.QueryRow(ctx, `SELECT destruct_at FROM messages WHERE id=$1`, msgID).Scan(&at); err != nil {
			t.Fatalf("load destruct_at(%d): %v", msgID, err)
		}
		return at
	}

	// B читает до seq 2 → таймер армится для полученного сообщения recv (sender=A).
	if err := msgs.SetDestructOnRead(ctx, chID, b, 2); err != nil {
		t.Fatalf("SetDestructOnRead(reader=B): %v", err)
	}
	if destructAt(recv.ID) == nil {
		t.Fatalf("destruct_at for received message must be armed after recipient read")
	}
	if destructAt(own.ID) == nil {
		// оба от A, оба получены B — own тоже должен армиться при чтении B
		t.Fatalf("destruct_at for own.ID must be armed for reader B (sender A)")
	}

	// Отправитель A читает свой чат — для сообщений, отправленных им самим,
	// таймер НЕ должен запускаться (sender==reader). Проверяем на свежем
	// сообщении от B, полученном A, а также что сообщения A не трогаются повторно.
	// Здесь ключевая проверка: SetDestructOnRead(reader=A) не армит сообщения A.
	senderMsg, err := msgs.Insert(ctx, domain.Message{
		ChatID: chID, Seq: 3, SenderID: a, Type: "encrypted",
		EncBody: []byte{7, 8, 9}, TTLSeconds: &ttl,
	})
	if err != nil {
		t.Fatalf("insert senderMsg: %v", err)
	}
	if err := msgs.SetDestructOnRead(ctx, chID, a, 3); err != nil {
		t.Fatalf("SetDestructOnRead(reader=A): %v", err)
	}
	if destructAt(senderMsg.ID) != nil {
		t.Fatalf("destruct_at must NOT be armed for the sender's own message when the sender reads")
	}

	// Реапер: форсируем истечение таймера у recv, проверяем, что ExpiredMessages
	// его отдаёт, а SoftDelete стирает шифртекст.
	if _, err := pool.Exec(ctx, `UPDATE messages SET destruct_at = now() - interval '1 second' WHERE id=$1`, recv.ID); err != nil {
		t.Fatalf("force expire: %v", err)
	}
	expired, err := msgs.ExpiredMessages(ctx, 10)
	if err != nil {
		t.Fatalf("ExpiredMessages: %v", err)
	}
	var found bool
	for _, m := range expired {
		if m.ID == recv.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("ExpiredMessages must include the self-destructed message %d", recv.ID)
	}
	if err := msgs.SoftDelete(ctx, recv.ID); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}
	var deletedAt *time.Time
	var encBody []byte
	if err := pool.QueryRow(ctx, `SELECT deleted_at, enc_body FROM messages WHERE id=$1`, recv.ID).Scan(&deletedAt, &encBody); err != nil {
		t.Fatalf("reload after delete: %v", err)
	}
	if deletedAt == nil {
		t.Fatalf("deleted_at must be set after SoftDelete")
	}
	if encBody != nil {
		t.Fatalf("enc_body must be NULL after SoftDelete, got %v", encBody)
	}
}
