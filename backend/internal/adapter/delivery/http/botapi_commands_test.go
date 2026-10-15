package http

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

// Bot API (Ф-6, f6-bots): sendMessage с entities/reply_parameters, команды по
// скоупам с адресом, deleteMyCommands.

type botAPIEnv struct {
	h      http.Handler
	pool   *pgxpool.Pool
	token  string // токен бота Bot API
	bot    int64
	alice  int64
	aliceT string
}

func newBotAPIEnv(t *testing.T, phone string) botAPIEnv {
	t.Helper()
	pool := postgres.NewTestDB(t)
	chatUC := newChatUC(pool)
	chatUC.SetBots(pgadapter.NewBotRepo(pool))
	chatUC.SetBotAPI(pgadapter.NewBotAPIRepo(pool))
	h := NewRouter(newAuthUC(pool), chatUC, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	tokenA, aliceID := signUp(t, h, pool, phone)
	acc, err := pgadapter.NewBotAPIRepo(pool).CreateBot(context.Background(), aliceID, "Бот", "cmd_test_bot")
	if err != nil {
		t.Fatal(err)
	}
	return botAPIEnv{h: h, pool: pool, token: acc.Token, bot: acc.BotID, alice: aliceID, aliceT: tokenA}
}

func (e botAPIEnv) call(t *testing.T, method string, body any) (int, map[string]any) {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/bot/"+e.token+"/"+method, bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// privateChat открывает чат Алисы с ботом и возвращает внутренний chats.id.
func (e botAPIEnv) privateChat(t *testing.T) int64 {
	t.Helper()
	createdPeerFrom(t, authedReq(t, e.h, http.MethodPost, "/chats", e.aliceT, map[string]int64{"user_id": e.bot}))
	var chatID int64
	if err := e.pool.QueryRow(context.Background(),
		`SELECT chat_id FROM chat_members WHERE user_id = $1`, e.bot).Scan(&chatID); err != nil {
		t.Fatal(err)
	}
	return chatID
}

// group заводит группу напрямую в БД: Алиса — создатель, бот — участник.
func (e botAPIEnv) group(t *testing.T) int64 {
	t.Helper()
	var id int64
	ctx := context.Background()
	if err := e.pool.QueryRow(ctx, `INSERT INTO chats (type, title) VALUES ('group', 'Группа') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for uid, role := range map[int64]string{e.alice: "creator", e.bot: "member"} {
		if _, err := e.pool.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,$3)`, id, uid, role); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

func TestBotAPI_SendMessage_EntitiesAndReply(t *testing.T) {
	e := newBotAPIEnv(t, "+79990000631")
	chatID := e.privateChat(t)
	ctx := context.Background()
	var firstID int64
	if err := e.pool.QueryRow(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text) VALUES ($1, 1, $2, 'text', 'вопрос') RETURNING id`,
		chatID, e.alice).Scan(&firstID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `UPDATE chats SET last_seq = 1 WHERE id = $1`, chatID); err != nil {
		t.Fatal(err)
	}

	code, res := e.call(t, "sendMessage", map[string]any{
		"chat_id":              chatID,
		"text":                 "жирный ответ",
		"entities":             []map[string]any{{"type": "bold", "offset": 0, "length": 6}},
		"reply_parameters":     map[string]any{"message_id": 1},
		"disable_notification": true,
	})
	if code != http.StatusOK || res["ok"] != true {
		t.Fatalf("sendMessage: %d %v", code, res)
	}

	var entities string
	var replyTo *int64
	if err := e.pool.QueryRow(ctx,
		`SELECT COALESCE(entities::text, ''), reply_to_id FROM messages WHERE chat_id = $1 AND sender_id = $2`,
		chatID, e.bot).Scan(&entities, &replyTo); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(entities, "messageEntityBold") {
		t.Fatalf("entities = %q; want messageEntityBold", entities)
	}
	if replyTo == nil || *replyTo != firstID {
		t.Fatalf("reply_to_id = %v; want сообщение №1 (id %d)", replyTo, firstID)
	}

	// Старая форма: reply_to_message_id.
	code, res = e.call(t, "sendMessage", map[string]any{"chat_id": chatID, "text": "ещё", "reply_to_message_id": 1})
	if code != http.StatusOK {
		t.Fatalf("reply_to_message_id: %d %v", code, res)
	}
	var n int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM messages WHERE chat_id = $1 AND reply_to_id = $2`, chatID, firstID).Scan(&n)
	if n != 2 {
		t.Fatalf("ответов на сообщение №1: %d; want 2", n)
	}
}

func TestBotAPI_DeleteMyCommands(t *testing.T) {
	e := newBotAPIEnv(t, "+79990000632")
	chatID := e.group(t)
	ctx := context.Background()
	count := func(where string) int {
		var n int
		if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM bot_commands WHERE bot_id = $1 AND `+where, e.bot).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	if code, res := e.call(t, "setMyCommands", map[string]any{"commands": []map[string]string{{"command": "start", "description": "Старт"}}}); code != 200 {
		t.Fatalf("setMyCommands default: %d %v", code, res)
	}
	scope := map[string]any{"type": "chat", "chat_id": chatID}
	if code, res := e.call(t, "setMyCommands", map[string]any{"scope": scope, "commands": []map[string]string{{"command": "only_here", "description": "Тут"}}}); code != 200 {
		t.Fatalf("setMyCommands chat: %d %v", code, res)
	}
	// Адрес скоупа сохранён: строка лежит под чатом, а не под default.
	if count(`scope = 'chat' AND scope_chat_id = `+itoa(chatID)) != 1 || count(`scope = 'default'`) != 1 {
		t.Fatal("setMyCommands с chat_id потерял адрес скоупа")
	}

	if code, res := e.call(t, "deleteMyCommands", map[string]any{"scope": scope}); code != 200 || res["result"] != true {
		t.Fatalf("deleteMyCommands: %d %v", code, res)
	}
	if count(`scope = 'chat'`) != 0 || count(`scope = 'default'`) != 1 {
		t.Fatal("deleteMyCommands снял не тот скоуп")
	}
	code, res := e.call(t, "getMyCommands", map[string]any{"scope": scope})
	if code != 200 {
		t.Fatalf("getMyCommands: %d %v", code, res)
	}
	// Фолбэк getMyCommands на default остался прежним.
	if got, _ := res["result"].([]any); len(got) != 1 {
		t.Fatalf("getMyCommands после удаления: %v", res["result"])
	}

	// default без параметров: deleteMyCommands снимает default.
	if code, _ := e.call(t, "deleteMyCommands", map[string]any{}); code != 200 || count(`scope = 'default'`) != 0 {
		t.Fatalf("deleteMyCommands без скоупа не снял default")
	}
}

func TestBotAPI_CommandScopeValidation(t *testing.T) {
	e := newBotAPIEnv(t, "+79990000633")
	chatID := e.group(t)
	cmd := []map[string]string{{"command": "x", "description": "x"}}

	for name, scope := range map[string]map[string]any{
		"неизвестный тип":         {"type": "everyone"},
		"chat без chat_id":        {"type": "chat"},
		"chat_member без user_id": {"type": "chat_member", "chat_id": chatID},
	} {
		if code, _ := e.call(t, "setMyCommands", map[string]any{"scope": scope, "commands": cmd}); code != http.StatusBadRequest {
			t.Errorf("%s: код %d; want 400", name, code)
		}
	}
	// Чужая группа, где бота нет, — отказ, а не молчаливая запись.
	var other int64
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO chats (type, title) VALUES ('group', 'Чужая') RETURNING id`).Scan(&other); err != nil {
		t.Fatal(err)
	}
	if code, _ := e.call(t, "setMyCommands", map[string]any{"scope": map[string]any{"type": "chat", "chat_id": other}, "commands": cmd}); code != http.StatusForbidden {
		t.Errorf("чат без бота: код %d; want 403", code)
	}
	// Дубль имени команды — 400, а не 500 на первичном ключе.
	dup := []map[string]string{{"command": "a", "description": "1"}, {"command": "a", "description": "2"}}
	if code, _ := e.call(t, "setMyCommands", map[string]any{"commands": dup}); code != http.StatusBadRequest {
		t.Errorf("дубль команды: код %d; want 400", code)
	}
}

func TestParseCommandScope_KeepsAddress(t *testing.T) {
	got, err := parseCommandScope(json.RawMessage(`{"type":"chat_member","chat_id":7,"user_id":9}`))
	want := domain.BotCommandScope{Type: "chat_member", ChatID: 7, UserID: 9}
	if err != nil || got != want {
		t.Fatalf("parseCommandScope = %+v %v; want %+v", got, err, want)
	}
	// chat_id строкой-числом (Bot API допускает String) тоже читается.
	if got, err := parseCommandScope(json.RawMessage(`{"type":"chat","chat_id":"7"}`)); err != nil || got.ChatID != 7 {
		t.Fatalf("chat_id строкой: %+v %v", got, err)
	}
	if got, err := parseCommandScope(nil); err != nil || got.Norm() != "default" || !got.Valid() {
		t.Fatalf("без scope: %+v %v", got, err)
	}
	for _, bad := range []string{`{"type":"chat","chat_id":"@group"}`, `[]`, `"x"`, `{"type":1}`} {
		if _, err := parseCommandScope(json.RawMessage(bad)); err == nil {
			t.Errorf("%s принят", bad)
		}
	}
}

// Нечитаемый scope или commands — 400, а не молчаливый default / пустой список
// (иначе испорченный deleteMyCommands снял бы список default и разослал это всем).
func TestBotAPI_BadCommandParamsAreRejected(t *testing.T) {
	e := newBotAPIEnv(t, "+79990000634")
	ctx := context.Background()
	if code, _ := e.call(t, "setMyCommands", map[string]any{"commands": []map[string]string{{"command": "start", "description": "Старт"}}}); code != 200 {
		t.Fatalf("setMyCommands: %d", code)
	}
	var n int
	count := func() int {
		if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM bot_commands WHERE bot_id = $1 AND scope = 'default'`, e.bot).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// scope строкой с битым JSON и со строковым chat_id вида @имя.
	for name, body := range map[string]map[string]any{
		"scope строкой-мусором": {"scope": "{not json"},
		"chat_id как @имя":      {"scope": map[string]any{"type": "chat", "chat_id": "@group"}},
	} {
		if code, _ := e.call(t, "deleteMyCommands", body); code != http.StatusBadRequest {
			t.Errorf("%s: код %d; want 400", name, code)
		}
	}
	if count() != 1 {
		t.Fatal("испорченный deleteMyCommands снял default")
	}
	// setMyCommands без commands и с нечитаемым commands.
	if code, _ := e.call(t, "setMyCommands", map[string]any{}); code != http.StatusBadRequest {
		t.Errorf("setMyCommands без commands: %d; want 400", code)
	}
	if code, _ := e.call(t, "setMyCommands", map[string]any{"commands": "не массив"}); code != http.StatusBadRequest {
		t.Errorf("setMyCommands commands строкой: %d; want 400", code)
	}
	if count() != 1 {
		t.Fatal("испорченный setMyCommands стёр default")
	}
	// Объект, присланный строкой с JSON (form-стиль), читается.
	if code, res := e.call(t, "setMyCommands", map[string]any{"commands": `[{"command":"two","description":"Два"}]`}); code != 200 {
		t.Fatalf("commands JSON-строкой: %d %v", code, res)
	}
}

func (e botAPIEnv) callRaw(t *testing.T, method, contentType, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/bot/"+e.token+"/"+method, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// Тело, которое не разобралось как JSON, — не «нет параметров»: deleteMyCommands
// с обрезанным телом не должен снимать default, а форма (urlencoded/multipart),
// которую принимает Bot API, читается.
func TestBotAPI_CommandsBodyForms(t *testing.T) {
	e := newBotAPIEnv(t, "+79990000635")
	chatID := e.group(t)
	ctx := context.Background()
	count := func(where string) int {
		var n int
		if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM bot_commands WHERE bot_id = $1 AND `+where, e.bot).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if code, _ := e.call(t, "setMyCommands", map[string]any{"commands": []map[string]string{{"command": "start", "description": "Старт"}}}); code != 200 {
		t.Fatal("setMyCommands default")
	}

	// Обрезанный JSON и мусор — 400, default цел.
	for _, body := range []string{`{"scope":{"type":"chat","chat_id":`, `not json`, `[1,2]`} {
		if code, _ := e.callRaw(t, "deleteMyCommands", "application/json", body); code != http.StatusBadRequest {
			t.Errorf("тело %q: код %d; want 400", body, code)
		}
	}
	if count(`scope = 'default'`) != 1 {
		t.Fatal("нечитаемое тело deleteMyCommands сняло default")
	}
	// Слишком большое тело — 413.
	big := `{"commands":"` + strings.Repeat("x", 300<<10) + `"}`
	if code, _ := e.callRaw(t, "setMyCommands", "application/json", big); code != http.StatusRequestEntityTooLarge {
		t.Errorf("большое тело: код %d; want 413", code)
	}

	// Form-urlencoded: scope и commands — строки с JSON.
	form := url.Values{}
	form.Set("scope", `{"type":"chat","chat_id":`+itoa(chatID)+`}`)
	form.Set("commands", `[{"command":"only_here","description":"Тут"}]`)
	if code, res := e.callRaw(t, "setMyCommands", "application/x-www-form-urlencoded", form.Encode()); code != 200 {
		t.Fatalf("form setMyCommands: %d %v", code, res)
	}
	if count(`scope = 'chat' AND scope_chat_id = `+itoa(chatID)) != 1 {
		t.Fatal("form-запрос потерял адрес скоупа")
	}
	delForm := url.Values{}
	delForm.Set("scope", `{"type":"chat","chat_id":`+itoa(chatID)+`}`)
	if code, res := e.callRaw(t, "deleteMyCommands", "application/x-www-form-urlencoded", delForm.Encode()); code != 200 {
		t.Fatalf("form deleteMyCommands: %d %v", code, res)
	}
	if count(`scope = 'chat'`) != 0 || count(`scope = 'default'`) != 1 {
		t.Fatal("form deleteMyCommands снял не тот скоуп")
	}

	// Multipart.
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("commands", `[{"command":"mp","description":"Мультипарт"}]`)
	_ = mw.Close()
	if code, res := e.callRaw(t, "setMyCommands", mw.FormDataContentType(), buf.String()); code != 200 {
		t.Fatalf("multipart setMyCommands: %d %v", code, res)
	}
	got, _ := e.call(t, "getMyCommands", map[string]any{})
	if got != 200 {
		t.Fatal("getMyCommands после multipart")
	}
}
