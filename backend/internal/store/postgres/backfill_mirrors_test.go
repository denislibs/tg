package postgres_test

// Тест живёт в отдельном пакете, чтобы звать BackfillDiscussionMirrors как
// внешний API и не тянуть внутренности.

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Старая схема: комментарий висит на id ПОСТА КАНАЛА. Бэкфилл обязан создать
// зеркало в группе обсуждения и перевести тред на него.
func TestBackfillDiscussionMirrors(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()

	// сид «старой формы» — сырым SQL, потому что usecase так писать уже не умеет
	var userID, ch, disc, postID, commentID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (phone) VALUES ('+79990000001') RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('channel','Chan',true) RETURNING id`).Scan(&ch); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title, is_public) VALUES ('group','Disc',false) RETURNING id`).Scan(&disc); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chats SET discussion_chat_id=$2 WHERE id=$1`, ch, disc); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,1,$2,'text','post') RETURNING id`,
		ch, userID).Scan(&postID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, thread_root_id) VALUES ($1,1,$2,'text','comment',$3) RETURNING id`,
		disc, userID, postID).Scan(&commentID); err != nil {
		t.Fatal(err)
	}

	n, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("создано зеркал: %d, ожидалось 1", n)
	}

	var mirrorID, rootID int64
	if err := pool.QueryRow(ctx,
		`SELECT id FROM messages WHERE chat_id=$1 AND is_discussion_mirror AND fwd_from_msg_id=$2`,
		disc, postID).Scan(&mirrorID); err != nil {
		t.Fatalf("зеркало не создано: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT thread_root_id FROM messages WHERE id=$1`, commentID).Scan(&rootID); err != nil {
		t.Fatal(err)
	}
	if rootID != mirrorID {
		t.Fatalf("тред остался на %d, ожидалось зеркало %d", rootID, mirrorID)
	}

	// идемпотентность: второй прогон ничего не создаёт и не ломает
	n2, err := storepostgres.BackfillDiscussionMirrors(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if n2 != 0 {
		t.Fatalf("повторный прогон создал %d зеркал, ожидалось 0", n2)
	}
}
