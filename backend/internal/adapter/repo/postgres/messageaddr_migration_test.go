package postgres

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0105 сводит адресацию сообщения к паре «пир + номер»: колонки
// reply_to_id (messages/drafts/scheduled_messages) переезжают из ключа строки в
// номер в чате, grouped_id — из нашей строки в схемный long, а замороженные
// кадры журналов теряют второе число.
//
// Цена ошибки здесь — не косметика: reply_to_id, оставленный ключом строки,
// после смены смысла указывает на СУЩЕСТВУЮЩЕЕ, но ЧУЖОЕ сообщение (номер и
// ключ строки — оба плотные последовательности), то есть превью ответа молча
// покажет не тот текст. Поэтому проверяем на настоящих строках в настоящем
// Postgres.
const messageAddrMigrationPrevVersion = 104

// frameKey читает одно поле замороженного кадра журнала.
func frameKey(t *testing.T, pool *pgxpool.Pool, query string, arg any, key string) (json.RawMessage, bool) {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(context.Background(), query, arg).Scan(&raw); err != nil {
		t.Fatalf("чтение кадра: %v", err)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("разбор кадра %s: %v", raw, err)
	}
	v, ok := payload[key]
	return v, ok
}

func assertFrameNumber(t *testing.T, pool *pgxpool.Pool, query string, arg any, key string, want int64) {
	t.Helper()
	v, ok := frameKey(t, pool, query, arg, key)
	if !ok {
		t.Fatalf("в кадре нет ключа %q", key)
	}
	var got int64
	if err := json.Unmarshal(v, &got); err != nil {
		t.Fatalf("ключ %q не число: %s", key, v)
	}
	if got != want {
		t.Errorf("кадр.%s = %d, ждали %d", key, got, want)
	}
}

func assertFrameNoKey(t *testing.T, pool *pgxpool.Pool, query string, arg any, key string) {
	t.Helper()
	if _, ok := frameKey(t, pool, query, arg, key); ok {
		t.Errorf("ключ %q остался в кадре, хотя внутренний ключ строки наружу не выходит", key)
	}
}

func TestMigration0105_ConvertsMessageAddressing(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, messageAddrMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", messageAddrMigrationPrevVersion, err)
	}

	alice := seedUser(t, pool, "+79990000105")
	bob := seedUser(t, pool, "+79990000106")

	newChat := func(typ string) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ($1) RETURNING id`, typ).Scan(&id); err != nil {
			t.Fatalf("seed chat: %v", err)
		}
		for _, u := range []int64{alice, bob} {
			if _, err := pool.Exec(ctx,
				`INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member')`, id, u); err != nil {
				t.Fatalf("seed member: %v", err)
			}
		}
		return id
	}
	insert := func(chatID, seq int64, typ, text string) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx,
			`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
			chatID, seq, alice, typ, text).Scan(&id); err != nil {
			t.Fatalf("seed message: %v", err)
		}
		return id
	}

	// ── Первый чат съедает низкие ключи строк, чтобы во ВТОРОМ ключ строки и
	// номер разошлись. Пока id == seq (а именно так выглядит база с одним
	// чатом), подмена не проявляется вовсе — и именно поэтому её так долго не
	// замечали.
	filler := newChat("group")
	for s := int64(1); s <= 5; s++ {
		insert(filler, s, "text", "заполнение")
	}

	chatA := newChat("group")
	origID := insert(chatA, 1, "text", "оригинал")    // id 6, seq 1
	replyID := insert(chatA, 2, "text", "ответ")      // id 7, seq 2
	danglingID := insert(chatA, 3, "text", "висячий") // id 8, seq 3

	chatB := newChat("group")
	foreignID := insert(chatB, 1, "text", "чужой оригинал") // id 9, seq 1
	crossID := insert(chatB, 2, "text", "кросс-чат-ответ")  // id 10, seq 2

	// ответ внутри чата
	if _, err := pool.Exec(ctx, `UPDATE messages SET reply_to_id=$2 WHERE id=$1`, replyID, origID); err != nil {
		t.Fatalf("seed reply: %v", err)
	}
	// ответ на сообщение, которого в базе нет (жёстко удалён вместе с чатом)
	if _, err := pool.Exec(ctx, `UPDATE messages SET reply_to_id=$2 WHERE id=$1`, danglingID, int64(999999)); err != nil {
		t.Fatalf("seed dangling reply: %v", err)
	}
	// кросс-чат-ответ БЕЗ проставленного reply_to_peer_id — строка из версий до
	// появления колонки: миграция обязана достроить пир, иначе номер уедет в
	// свой чат и укажет на чужое сообщение.
	if _, err := pool.Exec(ctx, `UPDATE messages SET reply_to_id=$2 WHERE id=$1`, crossID, origID); err != nil {
		t.Fatalf("seed cross reply: %v", err)
	}

	// grouped_id — наша строка
	if _, err := pool.Exec(ctx,
		`UPDATE messages SET grouped_id='gabc123' WHERE id IN ($1,$2)`, foreignID, crossID); err != nil {
		t.Fatalf("seed grouped: %v", err)
	}

	// Служебное сообщение о закреплении: два числа на одну цель в JSON текста.
	pinID := insert(chatA, 4, "service", `{"action":"pin_message","actor_id":1,"msg_id":6,"msg_seq":1,"msg_type":"text"}`)

	// Черновик и отложенное отвечают на сообщение своего чата.
	if _, err := pool.Exec(ctx,
		`INSERT INTO drafts (chat_id, user_id, text, reply_to_id) VALUES ($1,$2,'черновик',$3)`,
		chatA, alice, origID); err != nil {
		t.Fatalf("seed draft: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO scheduled_messages (chat_id, sender_id, type, text, reply_to_id, send_at)
		 VALUES ($1,$2,'text','отложенное',$3, now() + interval '1 hour')`,
		chatA, alice, origID); err != nil {
		t.Fatalf("seed scheduled: %v", err)
	}

	// ── Замороженные кадры ──────────────────────────────────────────────────
	// new_message нёс ОБА числа + ссылки на другие сообщения строкой grouped_id.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 1, 'new_message', jsonb_build_object(
		           'peer_id', $2::bigint, 'msg_id', $3::bigint, 'seq', 2::bigint,
		           'reply_to_id', $4::bigint, 'grouped_id', 'gabc123', 'text', 'ответ'))`,
		alice, -chatA, replyID, origID); err != nil {
		t.Fatalf("seed update: %v", err)
	}
	// reaction нёс ТОЛЬКО ключ строки — номер приходится резолвить по базе.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 2, 'reaction', jsonb_build_object('peer_id', $2::bigint, 'msg_id', $3::bigint, 'emoji', '👍'))`,
		alice, -chatA, origID); err != nil {
		t.Fatalf("seed reaction update: %v", err)
	}
	// Кадр про сообщение, которого больше нет: адреса у него не существует, и
	// подставленный ноль отправил бы клиента к «самому новому».
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 3, 'media_read', jsonb_build_object('peer_id', $2::bigint, 'msg_id', 999999::bigint))`,
		alice, -chatA); err != nil {
		t.Fatalf("seed orphan update: %v", err)
	}
	// Кадр служебного закрепления с JSON в тексте.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 4, 'new_message', jsonb_build_object(
		           'peer_id', $2::bigint, 'msg_id', $3::bigint, 'seq', 4::bigint,
		           'text', '{"action":"pin_message","actor_id":1,"msg_id":6,"msg_seq":1,"msg_type":"text"}'))`,
		alice, -chatA, pinID); err != nil {
		t.Fatalf("seed pin update: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO channel_updates (channel_id, pts, pts_count, type, payload)
		 VALUES ($1, 1, 1, 'new_message', jsonb_build_object(
		           'peer_id', $2::bigint, 'msg_id', $3::bigint, 'seq', 1::bigint))`,
		chatB, -chatB, foreignID); err != nil {
		t.Fatalf("seed channel update: %v", err)
	}

	// Накатываем РОВНО 0105: следующая миграция переписывает те же служебные
	// тексты, и проверка превратилась бы в проверку суммы, а не шага.
	if err := storepostgres.MigrateUpTo(url, messageAddrMigrationPrevVersion+1); err != nil {
		t.Fatalf("накат 0105: %v", err)
	}

	// ── Колонки ─────────────────────────────────────────────────────────────
	replyOf := func(id int64) (*int64, *int64) {
		t.Helper()
		var seq, peer *int64
		if err := pool.QueryRow(ctx, `SELECT reply_to_id, reply_to_peer_id FROM messages WHERE id=$1`, id).
			Scan(&seq, &peer); err != nil {
			t.Fatalf("чтение reply_to: %v", err)
		}
		return seq, peer
	}
	if seq, peer := replyOf(replyID); seq == nil || *seq != 1 || peer != nil {
		t.Errorf("ответ в своём чате: reply_to_id=%v peer=%v, ждали номер 1 без пира", seq, peer)
	}
	if seq, _ := replyOf(danglingID); seq != nil {
		t.Errorf("висячая ссылка = %v, ждали NULL: номера у несуществующего сообщения нет", *seq)
	}
	if seq, peer := replyOf(crossID); seq == nil || *seq != 1 || peer == nil || *peer != chatA {
		t.Errorf("кросс-чат-ответ: reply_to_id=%v peer=%v, ждали номер 1 в чате %d", seq, peer, chatA)
	}

	var draftSeq, schedSeq int64
	if err := pool.QueryRow(ctx, `SELECT reply_to_id FROM drafts WHERE chat_id=$1`, chatA).Scan(&draftSeq); err != nil {
		t.Fatalf("чтение черновика: %v", err)
	}
	if draftSeq != 1 {
		t.Errorf("черновик: reply_to_id=%d, ждали 1", draftSeq)
	}
	if err := pool.QueryRow(ctx, `SELECT reply_to_id FROM scheduled_messages WHERE chat_id=$1`, chatA).Scan(&schedSeq); err != nil {
		t.Fatalf("чтение отложенного: %v", err)
	}
	if schedSeq != 1 {
		t.Errorf("отложенное: reply_to_id=%d, ждали 1", schedSeq)
	}

	// grouped_id стал числом и остался ОДИНАКОВЫМ у элементов одной группы.
	var g1, g2 int64
	if err := pool.QueryRow(ctx, `SELECT grouped_id FROM messages WHERE id=$1`, foreignID).Scan(&g1); err != nil {
		t.Fatalf("grouped_id как число не читается: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT grouped_id FROM messages WHERE id=$1`, crossID).Scan(&g2); err != nil {
		t.Fatalf("grouped_id как число не читается: %v", err)
	}
	if g1 == 0 || g1 != g2 {
		t.Errorf("grouped_id = %d и %d, ждали одинаковое ненулевое: альбом обязан остаться собранным", g1, g2)
	}

	// Служебный текст закрепления: одно число, msg_seq исчез.
	var pinText string
	if err := pool.QueryRow(ctx, `SELECT text FROM messages WHERE id=$1`, pinID).Scan(&pinText); err != nil {
		t.Fatalf("чтение служебного текста: %v", err)
	}
	var pinAct map[string]any
	if err := json.Unmarshal([]byte(pinText), &pinAct); err != nil {
		t.Fatalf("служебный текст испорчен: %s", pinText)
	}
	if _, ok := pinAct["msg_seq"]; ok {
		t.Errorf("в экшене закрепления осталось второе число: %s", pinText)
	}
	if v, _ := pinAct["msg_id"].(float64); int64(v) != 1 {
		t.Errorf("экшен закрепления адресует %v, ждали номер 1: %s", pinAct["msg_id"], pinText)
	}

	// ── Кадры ───────────────────────────────────────────────────────────────
	const upd = `SELECT payload FROM updates WHERE pts=$1`
	assertFrameNumber(t, pool, upd, 1, "id", 2)
	assertFrameNoKey(t, pool, upd, 1, "msg_id")
	assertFrameNoKey(t, pool, upd, 1, "seq")
	assertFrameNumber(t, pool, upd, 1, "reply_to_id", 1)
	assertFrameNumber(t, pool, upd, 1, "grouped_id", g1)

	// reaction: номера в кадре не было — резолвится по ключу строки.
	assertFrameNumber(t, pool, upd, 2, "id", 1)
	assertFrameNoKey(t, pool, upd, 2, "msg_id")

	// осиротевший кадр: адреса нет ВОВСЕ, а не ноль.
	assertFrameNoKey(t, pool, upd, 3, "msg_id")
	assertFrameNoKey(t, pool, upd, 3, "id")

	pinFrame, ok := frameKey(t, pool, upd, 4, "text")
	if !ok {
		t.Fatal("кадр закрепления потерял текст")
	}
	var pinFrameText string
	if err := json.Unmarshal(pinFrame, &pinFrameText); err != nil {
		t.Fatalf("текст кадра не строка: %s", pinFrame)
	}
	var framePin map[string]any
	if err := json.Unmarshal([]byte(pinFrameText), &framePin); err != nil {
		t.Fatalf("экшен в кадре испорчен: %s", pinFrameText)
	}
	if _, ok := framePin["msg_seq"]; ok {
		t.Errorf("в кадре закрепления осталось второе число: %s", pinFrameText)
	}
	if v, _ := framePin["msg_id"].(float64); int64(v) != 1 {
		t.Errorf("кадр закрепления адресует %v, ждали номер 1", framePin["msg_id"])
	}

	assertFrameNumber(t, pool, `SELECT payload FROM channel_updates WHERE pts=$1`, 1, "id", 1)
	assertFrameNoKey(t, pool, `SELECT payload FROM channel_updates WHERE pts=$1`, 1, "msg_id")

	// ── Круг вниз-вверх: откат не должен стоить адресов ──────────────────────
	if err := storepostgres.MigrateDownTo(url, messageAddrMigrationPrevVersion); err != nil {
		t.Fatalf("повторный откат: %v", err)
	}
	// После Down колонка снова хранит ключ строки — проверяем на самом сложном
	// случае, кросс-чатном ответе.
	var backID *int64
	if err := pool.QueryRow(ctx, `SELECT reply_to_id FROM messages WHERE id=$1`, crossID).Scan(&backID); err != nil {
		t.Fatalf("чтение после отката: %v", err)
	}
	if backID == nil || *backID != origID {
		t.Errorf("после отката reply_to_id=%v, ждали ключ строки %d", backID, origID)
	}
	if err := storepostgres.MigrateUpTo(url, messageAddrMigrationPrevVersion+1); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if seq, peer := replyOf(crossID); seq == nil || *seq != 1 || peer == nil || *peer != chatA {
		t.Errorf("после круга вниз-вверх кросс-чат-ответ: reply_to_id=%v peer=%v", seq, peer)
	}
	if seq, _ := replyOf(replyID); seq == nil || *seq != 1 {
		t.Errorf("после круга вниз-вверх ответ в своём чате: reply_to_id=%v", seq)
	}
}
