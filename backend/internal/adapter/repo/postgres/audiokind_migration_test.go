package postgres

import (
	"context"
	"testing"
	"time"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// Миграция 0132 приводит к виду 'audio' треки, уже легшие видом 'document'
// (mp3, выбранный пунктом «Файл»). Вид решает атрибуты документа и вкладку
// шаред-медиа, поэтому проверяем по вкладкам: трек ушёл из «Файлов» в
// «Музыку», а pdf, голосовое и видео остались, где были.
const audioKindMigrationPrevVersion = 131

func TestMigration0132_AudioDocumentsBecomeAudio(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, audioKindMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", audioKindMigrationPrevVersion, err)
	}

	a := seedUser(t, pool, "+79990000801")
	b := seedUser(t, pool, "+79990000802")
	chatID := createPrivate(t, pool, a, b)
	msgs := NewMessagesRepo(pool)

	media := func(mime string) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx,
			`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media',$2,$3) RETURNING id`,
			a, mime+time.Now().String(), mime).Scan(&id); err != nil {
			t.Fatalf("media %s: %v", mime, err)
		}
		return id
	}
	insert := func(typ, mime string) int64 {
		t.Helper()
		seq, err := msgs.NextSeq(ctx, chatID)
		if err != nil {
			t.Fatalf("nextSeq: %v", err)
		}
		mid := media(mime)
		// Строка — сырым INSERT: репозиторий пишет колонки ТЕКУЩЕЙ схемы,
		// а база здесь откачена до 0131.
		var id int64
		if err := pool.QueryRow(ctx,
			`INSERT INTO messages (chat_id, seq, sender_id, type, media_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
			chatID, seq, a, typ, mid).Scan(&id); err != nil {
			t.Fatalf("insert: %v", err)
		}
		return id
	}

	mp3 := insert("document", "audio/mpeg")
	oggVideo := insert("document", "video/ogg")
	pdf := insert("document", "application/pdf")
	mp4File := insert("document", "video/mp4")
	voice := insert("voice", "audio/ogg")
	track := insert("audio", "audio/mpeg")

	schedMedia := media("audio/flac")
	var schedID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO scheduled_messages (chat_id, sender_id, type, text, media_id, send_at)
		 VALUES ($1,$2,'document','',$3, now() + interval '1 day') RETURNING id`,
		chatID, a, schedMedia).Scan(&schedID); err != nil {
		t.Fatalf("scheduled: %v", err)
	}

	if err := storepostgres.MigrateUpTo(url, audioKindMigrationPrevVersion+1); err != nil {
		t.Fatalf("накат 0132: %v", err)
	}

	typeOf := func(id int64) string {
		t.Helper()
		var typ string
		if err := pool.QueryRow(ctx, `SELECT type FROM messages WHERE id=$1`, id).Scan(&typ); err != nil {
			t.Fatalf("type %d: %v", id, err)
		}
		return typ
	}
	for id, want := range map[int64]string{
		mp3: "audio", oggVideo: "audio", pdf: "document", mp4File: "document", voice: "voice", track: "audio",
	} {
		if got := typeOf(id); got != want {
			t.Errorf("message %d: type = %q, want %q", id, got, want)
		}
	}
	var schedType string
	if err := pool.QueryRow(ctx, `SELECT type FROM scheduled_messages WHERE id=$1`, schedID).Scan(&schedType); err != nil {
		t.Fatalf("scheduled type: %v", err)
	}
	if schedType != "audio" {
		t.Errorf("scheduled: type = %q, want audio", schedType)
	}

	counters, err := msgs.SearchCounters(ctx, chatID, a, []string{"files", "music", "voice"}, nil)
	if err != nil {
		t.Fatalf("counters: %v", err)
	}
	if counters["music"] != 3 || counters["files"] != 2 || counters["voice"] != 1 {
		t.Fatalf("счётчики вкладок после миграции = %v, want music=3 files=2 voice=1", counters)
	}
	music, _, err := msgs.MediaHistory(ctx, chatID, a, "music", usecasechat.MediaPage{Limit: 10})
	if err != nil {
		t.Fatalf("music history: %v", err)
	}
	if len(music) != 3 {
		t.Fatalf("вкладка «Музыка» = %d сообщений, want 3", len(music))
	}
}
