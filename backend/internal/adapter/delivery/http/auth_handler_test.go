package http

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// newAuthUC builds the auth usecase from the postgres adapter (which satisfies
// all three repo ports) for use in delivery tests.
func newAuthUC(pool *pgxpool.Pool) *usecaseauth.Interactor {
	r := pgadapter.NewAuthRepo(pool)
	return usecaseauth.New(r, r, r, r, r, "12345", func(string, ...any) {})
}

// signedInUser — форма пользователя в ответах входа и в /me: пара
// конструкторов схемы (users.userFull), где краткая карточка `user` лежит в
// векторе users. Третьей формы «плоский пользователь» на проводе больше нет.
type signedInUser struct {
	Users []struct {
		ID int64 `json:"id"`
	} `json:"users"`
}

func (u signedInUser) id() int64 {
	if len(u.Users) == 0 {
		return 0
	}
	return u.Users[0].ID
}

// signInWire — исход шага входа: конструктор объединения `auth.Authorization`.
// Ветку называет дискриминатор `_`, а не наличие ключей рядом. Карточка
// КРАТКАЯ (`user`), а не пара `users.userFull`: полную форму вход не отдаёт —
// её приносит первый же `/me`.
type signInWire struct {
	Underscore    string `json:"_"`
	Token         string `json:"token"`
	SignUpToken   string `json:"signup_token"`
	PasswordToken string `json:"password_token"`
	Hint          string `json:"hint"`
	User          struct {
		ID        int64  `json:"id"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
	} `json:"user"`
}

func decodeSignIn(t *testing.T, rec *httptest.ResponseRecorder) signInWire {
	t.Helper()
	var out signInWire
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("исход входа не разбирается: %v (%s)", err, rec.Body.String())
	}
	return out
}

// loginViaHTTP проходит по HTTP полный вход: request_code → sign_in, а для
// незнакомого номера ещё и sign_up. Возвращает bearer-токен и id пользователя.
func loginViaHTTP(t *testing.T, h http.Handler, phone string) (string, int64) {
	t.Helper()
	return loginViaHTTPAs(t, h, phone, nil)
}

// loginViaHTTPAs — тот же вход, но запросы несут заданные заголовки. Ими клиент
// называет себя (User-Agent → браузер и ОС, X-App-Version → версия сборки), и
// из них собирается строка устройства на экране активных сеансов.
//
// Шаги входа описаны ЗДЕСЬ и только здесь: свой список из тех же четырёх
// запросов рядом означал бы, что смену шага обновят в одной копии из двух.
func loginViaHTTPAs(t *testing.T, h http.Handler, phone string, headers map[string]string) (string, int64) {
	t.Helper()
	post := func(path string, body any) *httptest.ResponseRecorder {
		buf, _ := json.Marshal(body)
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, path, bytes.NewReader(buf))
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := post("/auth/request_code", map[string]string{"phone": phone}); rec.Code != http.StatusOK {
		t.Fatalf("request_code: %d %s", rec.Code, rec.Body.String())
	}
	rec := post("/auth/sign_in", map[string]string{
		"phone": phone, "code": "12345", "device": "web", "platform": "browser",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign_in: %d %s", rec.Code, rec.Body.String())
	}
	step := decodeSignIn(t, rec)
	if step.Underscore == "auth.authorizationSignUpRequired" {
		if step.SignUpToken == "" {
			t.Fatalf("шаг регистрации без токена: %s", rec.Body.String())
		}
		rec = post("/auth/sign_up", map[string]string{
			"signup_token": step.SignUpToken, "first_name": "Тест", "device": "web", "platform": "browser",
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("sign_up: %d %s", rec.Code, rec.Body.String())
		}
	}
	out := decodeSignIn(t, rec)
	if out.Underscore != "auth.authorization" || out.Token == "" || out.User.ID == 0 {
		t.Fatalf("вход не выдал сессию: %s", rec.Body.String())
	}
	return out.Token, out.User.ID
}

// hexOfBase64 — `token` конструктора `auth.loginToken` это БАЙТЫ (на JSON-проводе
// base64), а маршрут `/auth/qr/{token}` берёт ту же величину шестнадцатеричной
// записью.
func hexOfBase64(t *testing.T, s string) string {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("token не base64 (%q): %v", s, err)
	}
	return hex.EncodeToString(raw)
}

// newChatUC builds the chat usecase from the postgres adapters for delivery tests.
func newChatUC(pool *pgxpool.Pool) *usecasechat.Interactor {
	uc := newChatUCBase(pool)
	// Черновики, очередь отложенных, темы форума и звёзды — необязательные
	// зависимости (SetDrafts/SetScheduled/SetTopics/SetStars): без них ручки
	// `/drafts`, `/scheduled`, `/topics` и `/stars` отвечают «нет такого», и
	// витрину проверить нечем.
	uc.SetDrafts(pgadapter.NewDraftsRepo(pool))
	uc.SetScheduled(pgadapter.NewScheduledRepo(pool))
	uc.SetTopics(pgadapter.NewTopicsRepo(pool))
	uc.SetStars(pgadapter.NewStarsRepo(pool))
	uc.SetPolls(pgadapter.NewPollsRepo(pool))
	uc.SetStarReactions(pgadapter.NewStarReactionsRepo(pool))
	// Участники видеочата живут эфемерно (в производстве — Redis). Без стора
	// ручка всегда отвечала пустым вектором, и её витрину нельзя было
	// проверить ВООБЩЕ — ни форму участника, ни доступ.
	uc.SetGroupCalls(testGroupCalls)
	return uc
}

// memGroupCalls — стор участников звонка в памяти процесса. Эфемерность здесь
// не упрощение, а сама природа предмета: список живёт, пока идёт звонок.
type memGroupCalls struct {
	mu   sync.Mutex
	byID map[int64][]int64
}

func (m *memGroupCalls) Join(_ context.Context, chatID, userID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range m.byID[chatID] {
		if id == userID {
			return nil
		}
	}
	m.byID[chatID] = append(m.byID[chatID], userID)
	return nil
}

func (m *memGroupCalls) Leave(_ context.Context, chatID, userID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	kept := m.byID[chatID][:0]
	for _, id := range m.byID[chatID] {
		if id != userID {
			kept = append(kept, id)
		}
	}
	m.byID[chatID] = kept
	return nil
}

func (m *memGroupCalls) Participants(_ context.Context, chatID int64) ([]int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]int64(nil), m.byID[chatID]...), nil
}

// testGroupCalls — общий стор для роутеров теста: тесту нужен доступ к нему,
// чтобы посадить кого-то в звонок, а через HTTP это не делается (вход в
// звонок — кадр сокета).
var testGroupCalls = &memGroupCalls{byID: map[int64][]int64{}}

func newChatUCBase(pool *pgxpool.Pool) *usecasechat.Interactor {
	return usecasechat.New(
		pgadapter.NewTxManager(pool),
		pgadapter.NewChatsRepo(pool),
		pgadapter.NewMessagesRepo(pool),
		pgadapter.NewUpdatesRepo(pool),
		pgadapter.NewReactionsRepo(pool),
		pgadapter.NewMediaAccessRepo(pool),
		pgadapter.NewGroupRepo(pool),
		pgadapter.NewInviteRepo(pool),
		pgadapter.NewChannelRepo(pool),
		pgadapter.NewSearchRepo(pool),
		pgadapter.NewJoinRequestRepo(pool),
	)
}

func newTestRouter(t *testing.T) http.Handler {
	pool := postgres.NewTestDB(t)
	return routerFor(newAuthUC(pool), pool)
}

// newResetRouter — роутер с укороченным окном ожидания сброса аккаунта
// (ACCOUNT_RESET_WAIT на стенде): иначе сценарий «запланировали → окно истекло →
// удалили» непроверяем, ждать неделю.
func newResetRouter(t *testing.T, window time.Duration) http.Handler {
	pool := postgres.NewTestDB(t)
	uc := newAuthUC(pool)
	uc.SetAccountResetWindow(window)
	return routerFor(uc, pool)
}

func routerFor(auth *usecaseauth.Interactor, pool *pgxpool.Pool) http.Handler {
	return NewRouter(auth, newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
}

func postJSON(t *testing.T, h http.Handler, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, path, bytes.NewReader(buf))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAuthFlow_HTTP(t *testing.T) {
	h := newTestRouter(t)

	// Новый номер проходит через шаг регистрации.
	token, userID := loginViaHTTP(t, h, "+79990000000")

	// Знакомый номер входит одним шагом — сразу сессия того же пользователя.
	if rec := postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79990000000"}); rec.Code != http.StatusOK {
		t.Fatalf("request_code status = %d, body=%s", rec.Code, rec.Body.String())
	}
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{
		"phone": "+79990000000", "code": "12345", "device": "web", "platform": "browser",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign_in status = %d, body=%s", rec.Code, rec.Body.String())
	}
	out := decodeSignIn(t, rec)
	if out.Underscore != "auth.authorization" || out.Token == "" || out.Token == token || out.User.ID != userID {
		t.Fatalf("повторный вход = %s", rec.Body.String())
	}
}

// memQRStore is an in-memory usecaseauth.QRStore for the QR HTTP test.
type memQRStore struct{ m map[string]domain.QRLogin }

func newMemQRStore() *memQRStore { return &memQRStore{m: map[string]domain.QRLogin{}} }

func (s *memQRStore) Put(_ context.Context, h string, r domain.QRLogin, _ time.Duration) error {
	s.m[h] = r
	return nil
}

func (s *memQRStore) Get(_ context.Context, h string) (domain.QRLogin, error) {
	r, ok := s.m[h]
	if !ok {
		return domain.QRLogin{}, domain.ErrNotFound
	}
	return r, nil
}

func (s *memQRStore) Delete(_ context.Context, h string) error { delete(s.m, h); return nil }

func getReq(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func postJSONAuth(t *testing.T, h http.Handler, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, path, bytes.NewReader(buf))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestQRLoginFlow_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newAuthUC(pool)
	uc.SetQRStore(newMemQRStore())
	h := NewRouter(uc, newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	// Sign in a user → Bearer token.
	signinToken, signinUserID := loginViaHTTP(t, h, "+79992223344")

	// POST /auth/qr/new → конструктор auth.loginToken.
	rec := postJSON(t, h, "/auth/qr/new", map[string]string{"platform": "web"})
	if rec.Code != http.StatusOK {
		t.Fatalf("qr/new status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var issued struct {
		Underscore string `json:"_"`
		Expires    int64  `json:"expires"`
		Token      string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &issued)
	if issued.Underscore != "auth.loginToken" || issued.Token == "" || issued.Expires == 0 {
		t.Fatalf("qr/new = %s", rec.Body.String())
	}
	// Ссылки для сканера в ответе больше нет: её строит клиент от своего origin
	// (серверную он и раньше игнорировал — за прокси она теряла порт).
	if strings.Contains(rec.Body.String(), `"url"`) {
		t.Fatalf("адрес сканера всё ещё едет вторым ключом: %s", rec.Body.String())
	}
	qrToken := hexOfBase64(t, issued.Token)

	// GET /auth/qr/{token} → тот же конструктор: код ждёт подтверждения.
	rec = getReq(t, h, "/auth/qr/"+qrToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("qr status pending: code=%d body=%s", rec.Code, rec.Body.String())
	}
	var pending struct {
		Underscore string `json:"_"`
		Token      string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &pending)
	if pending.Underscore != "auth.loginToken" || hexOfBase64(t, pending.Token) != qrToken {
		t.Fatalf("ожидался невыкупленный код, body=%s", rec.Body.String())
	}

	// POST /auth/qr/confirm with Bearer → ok.
	rec = postJSONAuth(t, h, "/auth/qr/confirm", map[string]string{"token": qrToken}, signinToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("qr/confirm status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if !isBoolTrue(rec.Body.Bytes()) {
		t.Fatalf("ожидался boolTrue, body=%s", rec.Body.String())
	}

	// Подтверждённый код несёт ТОТ ЖЕ исход входа, что и обычный шаг, —
	// вложенным конструктором, а не соседними ключами session_token + user.
	rec = getReq(t, h, "/auth/qr/"+qrToken)
	var success struct {
		Underscore    string     `json:"_"`
		Authorization signInWire `json:"authorization"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &success)
	if success.Underscore != "auth.loginTokenSuccess" ||
		success.Authorization.Underscore != "auth.authorization" ||
		success.Authorization.Token == "" || success.Authorization.User.ID != signinUserID {
		t.Fatalf("подтверждённый QR = %s", rec.Body.String())
	}

	// Повторное чтение — код одноразовый. Протухший код теперь ОТКАЗ, а не
	// третий конструктор объединения (у оригинала `AUTH_TOKEN_EXPIRED`);
	// прежде ехало `{"status":"expired"}` со статусом 200.
	rec = getReq(t, h, "/auth/qr/"+qrToken)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("повторное чтение: %d %s", rec.Code, rec.Body.String())
	}
	var expired wireError
	_ = json.Unmarshal(rec.Body.Bytes(), &expired)
	if expired.Text != "AUTH_TOKEN_EXPIRED" {
		t.Fatalf("повторное чтение = %s", rec.Body.String())
	}
	// Неизвестный код — тот же отказ.
	if rec := getReq(t, h, "/auth/qr/bogus"); rec.Code != http.StatusNotFound {
		t.Fatalf("неизвестный код: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSignIn_WrongCode_HTTP(t *testing.T) {
	h := newTestRouter(t)
	_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79991112233"})
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{
		"phone": "+79991112233", "code": "99999",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// HTTP-контракт шага регистрации: незнакомый номер отдаёт
// `auth.authorizationSignUpRequired`, а отказы шага мапятся в 400/401.
func TestSignUp_HTTP(t *testing.T) {
	h := newTestRouter(t)

	_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79990040001"})
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{"phone": "+79990040001", "code": "12345"})
	step := decodeSignIn(t, rec)
	if step.Underscore != "auth.authorizationSignUpRequired" || step.SignUpToken == "" || step.Token != "" {
		t.Fatalf("sign_in нового номера = %s", rec.Body.String())
	}

	// Пустое имя — 400.
	rec = postJSON(t, h, "/auth/sign_up", map[string]string{"signup_token": step.SignUpToken, "first_name": " "})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("пустое имя: %d %s", rec.Code, rec.Body.String())
	}
	// Чужой токен — 401.
	rec = postJSON(t, h, "/auth/sign_up", map[string]string{"signup_token": "deadbeef", "first_name": "Денис"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("чужой токен: %d %s", rec.Code, rec.Body.String())
	}
	// Успех — сессия.
	rec = postJSON(t, h, "/auth/sign_up", map[string]string{
		"signup_token": step.SignUpToken, "first_name": "Денис", "last_name": "У",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign_up: %d %s", rec.Code, rec.Body.String())
	}
	// Карточка в ответе — КРАТКИЙ конструктор `user`, а не пара users.userFull.
	out := decodeSignIn(t, rec)
	if out.Underscore != "auth.authorization" || out.Token == "" ||
		out.User.FirstName != "Денис" || out.User.LastName != "У" {
		t.Fatalf("sign_up ответ = %s", rec.Body.String())
	}
	// Токен одноразовый — 401.
	rec = postJSON(t, h, "/auth/sign_up", map[string]string{"signup_token": step.SignUpToken, "first_name": "Денис"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("повторный sign_up: %d %s", rec.Code, rec.Body.String())
	}
}

// HTTP-контракт восстановления пароля по почте (без Mailer код = dev-OTP).
func TestPasswordRecovery_HTTP(t *testing.T) {
	h := newTestRouter(t)

	token, _ := loginViaHTTP(t, h, "+79990040002")
	if rec := postJSONAuth(t, h, "/me/password", map[string]string{
		"new_password": "s3cret", "hint": "hint", "email": "denis@example.com",
	}, token); rec.Code != http.StatusOK {
		t.Fatalf("set password: %d %s", rec.Code, rec.Body.String())
	}

	_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": "+79990040002"})
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{"phone": "+79990040002", "code": "12345"})
	step := decodeSignIn(t, rec)
	if step.Underscore != "auth.passwordNeeded" || step.PasswordToken == "" {
		t.Fatalf("sign_in с паролем = %s", rec.Body.String())
	}

	rec = postJSON(t, h, "/auth/password/recover", map[string]string{"password_token": step.PasswordToken})
	if rec.Code != http.StatusOK {
		t.Fatalf("recover: %d %s", rec.Code, rec.Body.String())
	}
	// `resend_after` рядом больше нет: паузу держит сервер, и её видно отказом
	// ниже, а клиент своего таймера не заводил.
	var req struct {
		Underscore   string `json:"_"`
		EmailPattern string `json:"email_pattern"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &req)
	if req.Underscore != "auth.passwordRecovery" || req.EmailPattern != "d****@e******.com" {
		t.Fatalf("recover ответ = %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "resend_after") {
		t.Fatalf("мёртвый resend_after всё ещё едет: %s", rec.Body.String())
	}

	// Повтор до истечения таймера — 429 с retry_after.
	rec = postJSON(t, h, "/auth/password/recover", map[string]string{"password_token": step.PasswordToken})
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("повторная отправка: %d %s", rec.Code, rec.Body.String())
	}
	// Остаток секунд едет ВНУТРИ кода (форма оригинала: FLOOD_WAIT_<N>), а не
	// соседним ключом: у конструктора `error` параметров ровно два.
	var retry wireError
	_ = json.Unmarshal(rec.Body.Bytes(), &retry)
	if !strings.HasPrefix(retry.Text, "RESEND_TOO_SOON_") || waitSeconds(retry.Text) <= 0 {
		t.Fatalf("429 тело = %s", rec.Body.String())
	}

	// Неверный код — 401.
	rec = postJSON(t, h, "/auth/password/recover/confirm", map[string]string{
		"password_token": step.PasswordToken, "code": "00000",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("неверный код: %d %s", rec.Code, rec.Body.String())
	}
	// Верный (dev) код — сессия, пароль снят. Код восстановления шестизначный
	// (RecoveryCodeLength), поэтому пятизначный dev-OTP дополняется нулём слева.
	rec = postJSON(t, h, "/auth/password/recover/confirm", map[string]string{
		"password_token": step.PasswordToken, "code": "012345", "device": "web", "platform": "browser",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm: %d %s", rec.Code, rec.Body.String())
	}
	out := decodeSignIn(t, rec)
	if out.Underscore != "auth.authorization" || out.Token == "" {
		t.Fatalf("confirm не выдал сессию: %s", rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/me/password", out.Token, nil)
	var st struct {
		Enabled bool `json:"enabled"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &st)
	if st.Enabled {
		t.Fatalf("пароль не снят: %s", rec.Body.String())
	}
}

// HTTP-контракт входа по веб-токену: выпуск под сессией → обмен → одноразовость.
func TestSignImport_HTTP(t *testing.T) {
	h := newTestRouter(t)

	token, userID := loginViaHTTP(t, h, "+79990040003")

	rec := postJSONAuth(t, h, "/auth/web_token", map[string]string{}, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("web_token: %d %s", rec.Code, rec.Body.String())
	}
	var issued struct {
		Underscore string `json:"_"`
		Token      string `json:"token"`
		Expires    int64  `json:"expires"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &issued)
	if issued.Underscore != "auth.webAuthToken" || issued.Token == "" || issued.Expires == 0 {
		t.Fatalf("web_token ответ = %s", rec.Body.String())
	}
	// Без сессии выпуск запрещён.
	if rec := postJSON(t, h, "/auth/web_token", map[string]string{}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("web_token без токена: %d", rec.Code)
	}

	rec = postJSON(t, h, "/auth/sign_import", map[string]string{
		"web_auth_token": issued.Token, "device": "desktop", "platform": "web",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("sign_import: %d %s", rec.Code, rec.Body.String())
	}
	out := decodeSignIn(t, rec)
	if out.Underscore != "auth.authorization" || out.Token == "" || out.User.ID != userID {
		t.Fatalf("sign_import ответ = %s", rec.Body.String())
	}
	// Одноразовость и неизвестный токен — 401.
	if rec := postJSON(t, h, "/auth/sign_import", map[string]string{"web_auth_token": issued.Token}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("повторный обмен: %d %s", rec.Code, rec.Body.String())
	}
	if rec := postJSON(t, h, "/auth/sign_import", map[string]string{"web_auth_token": "deadbeef"}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("чужой токен: %d %s", rec.Code, rec.Body.String())
	}
}

// wireError — тело отказа: конструктор `error{code, text}` (см. разбор
// docs/readiness/tl-rest-analysis.md, Р3). Остаток секунд, где он есть, лежит
// ВНУТРИ текста — параметра под него у конструктора нет.
type wireError struct {
	Underscore string `json:"_"`
	Code       int    `json:"code"`
	Text       string `json:"text"`
}

// isBoolTrue — ответ действия это конструктор, а не ключ `ok`.
func isBoolTrue(body []byte) bool {
	var b struct {
		Underscore string `json:"_"`
	}
	_ = json.Unmarshal(body, &b)
	return b.Underscore == "boolTrue"
}

// waitSeconds вынимает число из хвоста кода ошибки — порт tweb
// `getFloodWaitTime.ts` (`error.type.match(/^FLOOD_WAIT_(\d+)/)`).
func waitSeconds(code string) int {
	i := strings.LastIndexByte(code, '_')
	if i < 0 {
		return 0
	}
	n, err := strconv.Atoi(code[i+1:])
	if err != nil {
		return 0
	}
	return n
}

func postReset(t *testing.T, h http.Handler, pwToken string) (*httptest.ResponseRecorder, wireError) {
	t.Helper()
	rec := postJSON(t, h, "/auth/account/reset", map[string]string{"password_token": pwToken})
	var out wireError
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

// enableCloudPassword ставит облачный пароль уже вошедшему пользователю.
func enableCloudPassword(t *testing.T, h http.Handler, token, email string) {
	t.Helper()
	body := map[string]string{"new_password": "s3cret", "hint": "hint"}
	if email != "" {
		body["email"] = email
	}
	if rec := postJSONAuth(t, h, "/me/password", body, token); rec.Code != http.StatusOK {
		t.Fatalf("set password: %d %s", rec.Code, rec.Body.String())
	}
}

// HTTP-контракт сброса аккаунта: «забыли пароль?» при облачном пароле БЕЗ
// привязанной почты. Удаление отложенное: 409 2FA_CONFIRM_WAIT_<N> с остатком
// секунд, и только вызов после истечения окна отвечает 200 boolTrue.
func TestAccountReset_HTTP(t *testing.T) {
	const window = 300 * time.Millisecond
	h := newResetRouter(t, window)

	token, userID := loginViaHTTP(t, h, "+79990040010")
	// Пароль без почты восстановления — единственный выход остаётся сброс.
	enableCloudPassword(t, h, token, "")

	pwToken := passwordStep(t, h, "+79990040010")
	rec, wait := postReset(t, h, pwToken)
	if rec.Code != http.StatusConflict || !strings.HasPrefix(wait.Text, "2FA_CONFIRM_WAIT_") || waitSeconds(wait.Text) <= 0 {
		t.Fatalf("планирование сброса: %d %s", rec.Code, rec.Body.String())
	}
	// Аккаунт цел, сессия жива: удаление только запланировано.
	if rec := authedReq(t, h, http.MethodGet, "/me", token, nil); rec.Code != http.StatusOK {
		t.Fatalf("сессия отозвана на этапе планирования: %d %s", rec.Code, rec.Body.String())
	}
	// Повтор внутри окна — тот же ответ, окно не продлевается и не обнуляется.
	rec, again := postReset(t, h, pwToken)
	if rec.Code != http.StatusConflict || !strings.HasPrefix(again.Text, "2FA_CONFIRM_WAIT_") ||
		waitSeconds(again.Text) > waitSeconds(wait.Text) {
		t.Fatalf("повтор внутри окна: %d %s (было %s)", rec.Code, rec.Body.String(), wait.Text)
	}

	time.Sleep(window + 100*time.Millisecond) // окно укорочено, а не выжидается неделю

	rec, _ = postReset(t, h, pwToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("исполнение сброса: %d %s", rec.Code, rec.Body.String())
	}
	if !isBoolTrue(rec.Body.Bytes()) {
		t.Fatalf("reset тело = %s", rec.Body.String())
	}

	// Сессия удалённого аккаунта отозвана.
	if rec := authedReq(t, h, http.MethodGet, "/me", token, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("сессия пережила сброс: %d %s", rec.Code, rec.Body.String())
	}
	// Токен шага пароля одноразовый → 401 password_token_expired.
	rec, e := postReset(t, h, pwToken)
	if rec.Code != http.StatusUnauthorized || e.Text != "password_token_expired" {
		t.Fatalf("повторный сброс: %d %s", rec.Code, rec.Body.String())
	}

	// Номер освобождён: вход по нему заводит НОВЫЙ аккаунт (шаг регистрации).
	_, newID := loginViaHTTP(t, h, "+79990040010")
	if newID == userID {
		t.Fatalf("вход по освобождённому номеру вернул старый аккаунт %d", userID)
	}
}

// Владелец вошёл за время окна → 409 2fa_recent_confirm, аккаунт цел. Вход по
// одному SMS-коду отменой не считается: он упирается в шаг пароля.
func TestAccountReset_CancelledByOwner_HTTP(t *testing.T) {
	h := newTestRouter(t) // окно по умолчанию — неделя, отмена приходит раньше

	token, userID := loginViaHTTP(t, h, "+79990040012")
	enableCloudPassword(t, h, token, "")

	pwToken := passwordStep(t, h, "+79990040012")
	if rec, wait := postReset(t, h, pwToken); rec.Code != http.StatusConflict || !strings.HasPrefix(wait.Text, "2FA_CONFIRM_WAIT_") {
		t.Fatalf("планирование сброса: %d %s", rec.Code, rec.Body.String())
	}
	// Повторный вход по SMS-коду сессии не даёт — сброс в силе.
	smsToken := passwordStep(t, h, "+79990040012")
	if rec, wait := postReset(t, h, pwToken); rec.Code != http.StatusConflict || !strings.HasPrefix(wait.Text, "2FA_CONFIRM_WAIT_") {
		t.Fatalf("после входа по SMS-коду: %d %s", rec.Code, rec.Body.String())
	}

	// Владелец вводит облачный пароль — вот это отмена.
	rec := postJSON(t, h, "/auth/check_password", map[string]string{
		"password_token": smsToken, "password": "s3cret", "device": "web", "platform": "browser",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("check_password: %d %s", rec.Code, rec.Body.String())
	}

	rec, e := postReset(t, h, pwToken)
	if rec.Code != http.StatusConflict || e.Text != "2fa_recent_confirm" {
		t.Fatalf("после входа владельца: %d %s", rec.Code, rec.Body.String())
	}
	// Аккаунт на месте: вход по номеру ведёт к тому же пользователю.
	if rec := authedReq(t, h, http.MethodGet, "/me", token, nil); rec.Code != http.StatusOK {
		t.Fatalf("сессия владельца пострадала: %d %s", rec.Code, rec.Body.String())
	}
	var me signedInUser
	_ = json.Unmarshal(authedReq(t, h, http.MethodGet, "/me", token, nil).Body.Bytes(), &me)
	if me.id() != userID {
		t.Fatalf("/me вернул %d, ожидался %d", me.id(), userID)
	}
}

// Почта восстановления привязана → сброс запрещён (409 recovery_available):
// иначе номер + SMS-код давали бы удаление чужого аккаунта в обход 2FA.
func TestAccountReset_RecoveryAvailable_HTTP(t *testing.T) {
	h := newTestRouter(t)

	token, _ := loginViaHTTP(t, h, "+79990040011")
	enableCloudPassword(t, h, token, "denis@example.com")

	pwToken := passwordStep(t, h, "+79990040011")
	rec, e := postReset(t, h, pwToken)
	if rec.Code != http.StatusConflict || e.Text != "recovery_available" {
		t.Fatalf("reset с почтой: %d %s", rec.Code, rec.Body.String())
	}
	// Отказ не тронул аккаунт: шаг пароля жив, восстановление по почте доступно.
	if rec := postJSON(t, h, "/auth/password/recover", map[string]string{"password_token": pwToken}); rec.Code != http.StatusOK {
		t.Fatalf("восстановление после 409: %d %s", rec.Code, rec.Body.String())
	}
}

// passwordStep доводит вход по номеру с включённым облачным паролем до шага
// пароля и возвращает одноразовый password_token.
func passwordStep(t *testing.T, h http.Handler, phone string) string {
	t.Helper()
	_ = postJSON(t, h, "/auth/request_code", map[string]string{"phone": phone})
	rec := postJSON(t, h, "/auth/sign_in", map[string]string{"phone": phone, "code": "12345"})
	step := decodeSignIn(t, rec)
	if step.Underscore != "auth.passwordNeeded" || step.PasswordToken == "" {
		t.Fatalf("sign_in с паролем = %s", rec.Body.String())
	}
	return step.PasswordToken
}

// Страна для экрана входа: публичная ручка, без GeoIP отвечает 200 с пустым
// кодом — мягкая деградация, а не 500 (клиент оставляет свой выбор).
func TestNearestCountry_HTTP(t *testing.T) {
	h := newTestRouter(t)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/nearest_country", nil)
	req.Header.Set("X-Real-IP", "81.2.69.142")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("nearest_country: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Underscore  string `json:"_"`
		CountryCode string `json:"country_code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("тело не JSON: %s", rec.Body.String())
	}
	if out.Underscore != "help.countryCode" {
		t.Fatalf("страна не конструктором: %s", rec.Body.String())
	}
	// GeoIP в тестовом роутере не подключён (SetGeoResolver не вызывался).
	// Пустой код — ШТАТНЫЙ исход «не определилось», а не отказ.
	if out.CountryCode != "" {
		t.Fatalf("без GeoIP country_code = %q, want empty", out.CountryCode)
	}
	// Поле присутствует всегда — фронт читает его без проверки на undefined.
	if !strings.Contains(rec.Body.String(), "country_code") {
		t.Fatalf("в ответе нет country_code: %s", rec.Body.String())
	}
}
