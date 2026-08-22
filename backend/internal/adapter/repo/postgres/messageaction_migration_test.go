package postgres

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0106 переносит служебное действие из ТЕКСТА в колонку и в форму
// схемы, а замороженные кадры журналов — в конструктор сообщения.
//
// Цена ошибки здесь та же, что у 0100/0101: строка, оставленная в старой форме,
// становится ВТОРЫМ источником истины на проводе — клиент увидит либо сырой
// JSON вместо пилюли, либо пилюлю без действия. Поэтому проверяем на настоящих
// строках в настоящем Postgres, включая круг Down → Up.
const messageActionMigrationPrevVersion = 105

// actionOf читает колонку action одного сообщения.
func actionOf(t *testing.T, pool *pgxpool.Pool, id int64) map[string]any {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT action FROM messages WHERE id=$1`, id).Scan(&raw); err != nil {
		t.Fatalf("чтение действия: %v", err)
	}
	if len(raw) == 0 {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("действие не разбирается (%s): %v", raw, err)
	}
	return out
}

func textOf(t *testing.T, pool *pgxpool.Pool, id int64) string {
	t.Helper()
	var text string
	if err := pool.QueryRow(context.Background(),
		`SELECT text FROM messages WHERE id=$1`, id).Scan(&text); err != nil {
		t.Fatalf("чтение текста: %v", err)
	}
	return text
}

func TestMigration0106_ConvertsServiceActions(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, messageActionMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", messageActionMigrationPrevVersion, err)
	}

	alice := seedUser(t, pool, "+79990000201")
	bob := seedUser(t, pool, "+79990000202")

	var chatID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title) VALUES ('group','Команда') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}
	for _, u := range []int64{alice, bob} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member')`, chatID, u); err != nil {
			t.Fatalf("seed member: %v", err)
		}
	}
	insert := func(seq int64, typ, text string) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx,
			`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
			chatID, seq, alice, typ, text).Scan(&id); err != nil {
			t.Fatalf("seed message: %v", err)
		}
		return id
	}

	target := insert(1, "text", "закреплённое")
	// Закрепление: JSON с адресом цели и склеенным сервером превью.
	pinID := insert(2, "service", `{"action":"pin_message","actor_id":1,"msg_id":1,"msg_type":"text","msg_text":"закреплённое"}`)
	createID := insert(3, "service", `{"action":"group_create","actor_id":1}`)
	titleID := insert(4, "service", `{"action":"edit_title","actor_id":1}`)
	// Вышел сам: в схеме это ТОТ ЖЕ конструктор, что и «выгнали», а цель —
	// сам автор.
	leaveID := insert(5, "service", `{"action":"leave","actor_id":1}`)
	kickID := insert(6, "service", `{"action":"kick_user","actor_id":1,"user_id":`+itoa(bob)+`}`)
	restrictID := insert(7, "service", `{"action":"restrict","actor_id":1,"user_id":`+itoa(bob)+`,"denied_rights":3}`)
	callID := insert(8, "call", `{"video":true,"reason":"ok","duration":42}`)
	missedID := insert(9, "call", `{"video":false,"reason":"missed","duration":0}`)
	// Действие из версии, которой уже нет: конструктора для него не существует,
	// и подделывать его нечем.
	unknownID := insert(10, "service", `{"action":"пришелец","actor_id":1}`)
	// Корень темы форума: текст даже не JSON, а готовая фраза с именем автора.
	topicRootID := insert(11, "service", "Алиса создал(а) тему «Планы»")
	if _, err := pool.Exec(ctx,
		`INSERT INTO forum_topics (chat_id, root_msg_id, title, icon_color, created_by)
		 VALUES ($1,$2,'Планы',5,$3)`, chatID, topicRootID, alice); err != nil {
		t.Fatalf("seed topic: %v", err)
	}
	// Срок ограничения хранился всегда, а наружу не ехал вовсе.
	if _, err := pool.Exec(ctx,
		`INSERT INTO chat_restrictions (chat_id, user_id, denied_rights, until_date, restricted_by)
		 VALUES ($1,$2,3, to_timestamp(1800000000), $3)`, chatID, bob, alice); err != nil {
		t.Fatalf("seed restriction: %v", err)
	}
	// Вступление по ссылке: правильный inviter — СОЗДАТЕЛЬ ссылки, а не вошедший.
	if _, err := pool.Exec(ctx,
		`INSERT INTO invite_links (chat_id, token, created_by) VALUES ($1,'tok-106',$2)`,
		chatID, alice); err != nil {
		t.Fatalf("seed invite: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO invite_link_joins (chat_id, token, user_id) VALUES ($1,'tok-106',$2)`,
		chatID, bob); err != nil {
		t.Fatalf("seed invite join: %v", err)
	}
	var joinID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text)
		 VALUES ($1,12,$2,'service','{"action":"joined_by_link","actor_id":`+itoa(bob)+`}') RETURNING id`,
		chatID, bob).Scan(&joinID); err != nil {
		t.Fatalf("seed join message: %v", err)
	}

	// Снимок чужого текста, у которого предмета в схеме нет.
	if _, err := pool.Exec(ctx,
		`UPDATE messages SET reply_snapshot_name='Автор', reply_snapshot_text='чужой текст' WHERE id=$1`,
		target); err != nil {
		t.Fatalf("seed snapshot: %v", err)
	}

	// ── Замороженные кадры ──────────────────────────────────────────────────
	// Обычное сообщение: плоские sender_id/text/created_at/type.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 1, 'new_message', jsonb_build_object(
		           'peer_id', $2::bigint, 'id', 1::bigint, 'sender_id', $3::bigint,
		           'type', 'text', 'text', 'закреплённое', 'media_unread', true,
		           'created_at', '2026-01-01T00:00:00Z', 'client_msg_id', 'cm-1'))`,
		alice, -chatID, alice); err != nil {
		t.Fatalf("seed update: %v", err)
	}
	// Служебный кадр: действие JSON-строкой внутри текста.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 2, 'new_message', jsonb_build_object(
		           'peer_id', $2::bigint, 'id', 6::bigint, 'sender_id', $3::bigint,
		           'type', 'service', 'created_at', '2026-01-01T00:00:00Z',
		           'text', '{"action":"kick_user","actor_id":1,"user_id":`+itoa(bob)+`}'))`,
		alice, -chatID, alice); err != nil {
		t.Fatalf("seed service update: %v", err)
	}
	// Кадр с неопознанным действием: в старой форме его оставить нельзя, а
	// подделать конструктор нечем — такой кадр удаляется.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 3, 'new_message', jsonb_build_object(
		           'peer_id', $2::bigint, 'id', 10::bigint, 'sender_id', $3::bigint,
		           'type', 'service', 'created_at', '2026-01-01T00:00:00Z',
		           'text', '{"action":"пришелец"}'))`,
		alice, -chatID, alice); err != nil {
		t.Fatalf("seed unknown update: %v", err)
	}
	// Кадр-патч (reaction) сообщением не является и меняться не должен.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 4, 'reaction', jsonb_build_object('peer_id', $2::bigint, 'id', 1::bigint, 'emoji', '👍'))`,
		alice, -chatID); err != nil {
		t.Fatalf("seed reaction update: %v", err)
	}
	// Кадр-патч правки: сообщением он не становится, но имена ключей у него
	// схемные — text и edited_at ехали тем же смыслом под другими именами.
	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload)
		 VALUES ($1, 5, 'edit_message', jsonb_build_object(
		           'peer_id', $2::bigint, 'id', 1::bigint,
		           'text', 'правка', 'edited_at', '2026-01-02T03:04:05Z'))`,
		alice, -chatID); err != nil {
		t.Fatalf("seed edit update: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0106: %v", err)
	}

	// ── Колонка action ──────────────────────────────────────────────────────
	if a := actionOf(t, pool, pinID); a["_"] != "messageActionPinMessage" || len(a) != 1 {
		t.Errorf("закрепление = %v, ждали конструктор без параметров", a)
	}
	// Цель закрепления переехала в reply_to_id — туда же, где адрес любого
	// другого ответа.
	var pinReply *int64
	if err := pool.QueryRow(ctx, `SELECT reply_to_id FROM messages WHERE id=$1`, pinID).Scan(&pinReply); err != nil {
		t.Fatalf("чтение reply_to_id закрепления: %v", err)
	}
	if pinReply == nil || *pinReply != 1 {
		t.Errorf("цель закрепления = %v, ждали номер 1", pinReply)
	}
	if txt := textOf(t, pool, pinID); txt != "" {
		t.Errorf("текст служебного сообщения не очищен: %q", txt)
	}

	if a := actionOf(t, pool, createID); a["_"] != "messageActionChatCreate" || a["title"] != "Команда" {
		t.Errorf("создание группы = %v, ждали название из чата", a)
	}
	if a := actionOf(t, pool, titleID); a["_"] != "messageActionChatEditTitle" || a["title"] != "Команда" {
		t.Errorf("смена названия = %v, ждали название (прежде его не ехало вовсе)", a)
	}
	// leave и kick_user — ОДИН конструктор; различает их совпадение автора с целью.
	leave := actionOf(t, pool, leaveID)
	kick := actionOf(t, pool, kickID)
	if leave["_"] != "messageActionChatDeleteUser" || kick["_"] != "messageActionChatDeleteUser" {
		t.Errorf("выход/кик = %v / %v, ждали ОДИН конструктор", leave, kick)
	}
	if int64(leave["user_id"].(float64)) != alice {
		t.Errorf("вышедший = %v, ждали автора %d", leave["user_id"], alice)
	}
	if int64(kick["user_id"].(float64)) != bob {
		t.Errorf("выгнанный = %v, ждали %d", kick["user_id"], bob)
	}

	// Ограничение: запреты конструктором chatBannedRights + СРОК, которого на
	// проводе не было вовсе.
	restrict := actionOf(t, pool, restrictID)
	rights, _ := restrict["banned_rights"].(map[string]any)
	if rights["_"] != "chatBannedRights" {
		t.Fatalf("ограничение = %v, ждали chatBannedRights", restrict)
	}
	flags, _ := rights["pFlags"].(map[string]any)
	if flags["send_messages"] != true || flags["send_media"] != true {
		t.Errorf("запреты = %v, ждали send_messages+send_media из битмаска 3", flags)
	}
	if rights["until_date"] != float64(1800000000) {
		t.Errorf("срок ограничения = %v, ждали 1800000000", rights["until_date"])
	}
	if _, ok := restrict["denied_rights"]; ok {
		t.Errorf("битмаск denied_rights остался на проводе: %v", restrict)
	}

	// Лог звонка — служебное сообщение, а не «сообщение вида call».
	call := actionOf(t, pool, callID)
	reason, _ := call["reason"].(map[string]any)
	if call["_"] != "messageActionPhoneCall" || reason["_"] != "phoneCallDiscardReasonHangup" {
		t.Errorf("лог звонка = %v", call)
	}
	if call["duration"] != float64(42) {
		t.Errorf("длительность звонка = %v", call["duration"])
	}
	if pf, _ := call["pFlags"].(map[string]any); pf["video"] != true {
		t.Errorf("видеозвонок не отмечен: %v", call)
	}
	missed := actionOf(t, pool, missedID)
	if r, _ := missed["reason"].(map[string]any); r["_"] != "phoneCallDiscardReasonMissed" {
		t.Errorf("пропущенный звонок = %v", missed)
	}
	// Соединения не было — длительности НЕТ ВОВСЕ, а не ноль: именно отсутствие
	// отличает сорвавшийся звонок от состоявшегося.
	if _, ok := missed["duration"]; ok {
		t.Errorf("у пропущенного звонка уехала длительность: %v", missed)
	}

	// Тема форума: название и цвет из строки темы, имя автора больше не вклеено.
	topic := actionOf(t, pool, topicRootID)
	if topic["_"] != "messageActionTopicCreate" || topic["title"] != "Планы" || topic["icon_color"] != float64(5) {
		t.Errorf("создание темы = %v", topic)
	}
	if txt := textOf(t, pool, topicRootID); txt != "" {
		t.Errorf("склеенная фраза темы осталась: %q", txt)
	}

	// Вступление по ссылке: inviter — создатель ссылки, а не вошедший.
	join := actionOf(t, pool, joinID)
	if join["_"] != "messageActionChatJoinedByLink" || int64(join["inviter_id"].(float64)) != alice {
		t.Errorf("вступление по ссылке = %v, ждали создателя ссылки %d", join, alice)
	}

	// Неопознанное действие: конструктора нет, но и сырой JSON клиенту не уедет.
	if a := actionOf(t, pool, unknownID); a != nil {
		t.Errorf("неизвестное действие подделано конструктором: %v", a)
	}
	if txt := textOf(t, pool, unknownID); txt != "" {
		t.Errorf("сырой JSON неизвестного действия остался в тексте: %q", txt)
	}

	// Снимок чужого текста снят вместе с колонкой.
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.columns
		                 WHERE table_name='messages' AND column_name='reply_snapshot_text')`).Scan(&exists); err != nil {
		t.Fatalf("проверка колонки: %v", err)
	}
	if exists {
		t.Error("колонка reply_snapshot_text осталась, хотя предмета в схеме у неё нет")
	}

	// ── Замороженные кадры ──────────────────────────────────────────────────
	const frameByPts = `SELECT payload FROM updates WHERE pts=$1`
	msg := frameMessageOf(t, pool, frameByPts, int64(1))
	if msg["_"] != "message" {
		t.Errorf("кадр не стал конструктором: %v", msg)
	}
	if msg["message"] != "закреплённое" || msg["random_id"] != "cm-1" {
		t.Errorf("кадр = %v, ждали message/random_id", msg)
	}
	if from, _ := msg["from_id"].(map[string]any); from["_"] != "peerUser" {
		t.Errorf("автор кадра = %v, ждали ссылку на пир", msg["from_id"])
	}
	if _, ok := msg["created_at"]; ok {
		t.Errorf("created_at остался в кадре: %v", msg)
	}
	if _, ok := msg["type"]; ok {
		t.Errorf("type остался в кадре: %v", msg)
	}
	if pf, _ := msg["pFlags"].(map[string]any); pf["media_unread"] != true {
		t.Errorf("media_unread не уехал в pFlags: %v", msg)
	}

	svc := frameMessageOf(t, pool, frameByPts, int64(2))
	if svc["_"] != "messageService" {
		t.Errorf("служебный кадр = %v, ждали messageService", svc)
	}
	if a, _ := svc["action"].(map[string]any); a["_"] != "messageActionChatDeleteUser" {
		t.Errorf("действие служебного кадра = %v", svc["action"])
	}

	// Кадр с неопознанным действием удалён целиком.
	var left int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM updates WHERE pts=3`).Scan(&left); err != nil {
		t.Fatalf("подсчёт кадров: %v", err)
	}
	if left != 0 {
		t.Error("кадр с неопознанным действием остался в старой форме")
	}

	// Кадр-патч СООБЩЕНИЕМ не становится — это и проверяет 0106. Своей формы у
	// него с тех пор не осталось: реакции стали конструктором кадра (0116), и
	// проверяется теперь именно это — что патч не превратился в сообщение, а
	// получил СВОЙ конструктор.
	if v, ok := frameKey(t, pool, frameByPts, int64(4), "_"); !ok || string(v) != `"updateMessageReactions"` {
		t.Errorf("кадр реакции = %s; ждали конструктор кадра, а не сообщения", v)
	}
	if _, ok := frameKey(t, pool, frameByPts, int64(4), "message"); ok {
		t.Error("кадр реакции получил ключ message: патч приняли за сообщение")
	}
	// Кадр правки СТАРОЙ формы (патч) удалён миграцией 0115: достроить из него
	// целое сообщение нечем, а конструктор updateEditMessage несёт сообщение
	// целиком. Проверяем ровно это — строки больше нет.
	var edits int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM updates WHERE pts=5`).Scan(&edits); err != nil {
		t.Fatalf("подсчёт кадров правки: %v", err)
	}
	if edits != 0 {
		t.Error("патч правки пережил миграцию 0115")
	}

	// ── Круг Down → Up ──────────────────────────────────────────────────────
	if err := storepostgres.MigrateDownTo(url, messageActionMigrationPrevVersion); err != nil {
		t.Fatalf("откат 0106: %v", err)
	}
	if txt := textOf(t, pool, kickID); txt == "" {
		t.Error("откат не вернул JSON-действие в текст")
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат 0106: %v", err)
	}
	if a := actionOf(t, pool, kickID); a["_"] != "messageActionChatDeleteUser" {
		t.Errorf("после круга Down → Up действие = %v", a)
	}
}

// frameMessageOf — САМО СООБЩЕНИЕ из замороженного кадра: тело едет под ключом
// `message`, как updateNewMessage у оригинала.
func frameMessageOf(t *testing.T, pool *pgxpool.Pool, query string, arg any) map[string]any {
	t.Helper()
	v, ok := frameKey(t, pool, query, arg, "message")
	if !ok {
		t.Fatalf("в кадре нет сообщения")
	}
	var out map[string]any
	if err := json.Unmarshal(v, &out); err != nil {
		t.Fatalf("сообщение кадра не разбирается (%s): %v", v, err)
	}
	return out
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
