package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

// wireBool — ответ-конструктор Bool (`boolTrue`/`boolFalse`).
func wireBool(t *testing.T, rec *httptest.ResponseRecorder) bool {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("ждали 200 Bool, пришло %d %s", rec.Code, rec.Body.String())
	}
	var b struct {
		Underscore string `json:"_"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &b)
	switch b.Underscore {
	case "boolTrue":
		return true
	case "boolFalse":
		return false
	}
	t.Fatalf("не Bool: %s", rec.Body.String())
	return false
}

// wireErr — текст конструктора error{code, text}.
func wireErr(t *testing.T, rec *httptest.ResponseRecorder, status int) string {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("ждали %d, пришло %d %s", status, rec.Code, rec.Body.String())
	}
	var e struct {
		Underscore string `json:"_"`
		Text       string `json:"text"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &e)
	if e.Underscore != "error" {
		t.Fatalf("не error: %s", rec.Body.String())
	}
	return e.Text
}

// Проверка публичного имени группы/канала — `channels.checkUsername(channel,
// username)` → Bool (tweb `appChatsManager.checkUsername`, вызывается
// `usernameInputField` для вкладки chatType). У Telegram ОДНО пространство
// имён на пользователей и чаты: имя занято, если оно у пользователя ИЛИ у
// другого чата; своё имя текущего чата — свободно. Та же граница — у
// сохранения: проверка не может сказать «свободно» про имя, которое сохранение
// отвергнет, и наоборот.
func TestChatUsernameAvailable_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990002001")
	tokenB, idB := signUp(t, h, pool, "+79990002002")
	tokenC, _ := signUp(t, h, pool, "+79990002003")

	rec := authedReq(t, h, http.MethodPut, "/me/username", tokenC, map[string]string{"username": "carol_user"})
	if rec.Code != http.StatusOK {
		t.Fatalf("имя пользователя: %d %s", rec.Code, rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "First"})
	first := itoa(createdPeerID(t, rec))
	rec = authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Second"})
	second := itoa(createdPeerID(t, rec))
	rec = authedReq(t, h, http.MethodPut, "/chats/"+second+"/type", tokenA, map[string]any{"is_public": true, "username": "second_group"})
	if rec.Code != http.StatusOK {
		t.Fatalf("тип второй группы: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPut, "/chats/"+first+"/type", tokenA, map[string]any{"is_public": true, "username": "first_group"})
	if rec.Code != http.StatusOK {
		t.Fatalf("тип первой группы: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+first+"/members", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("добавить B: %d %s", rec.Code, rec.Body.String())
	}

	check := func(token, chat, u string) *httptest.ResponseRecorder {
		return authedReq(t, h, http.MethodGet, "/chats/"+chat+"/username/available?u="+u, token, nil)
	}
	if !wireBool(t, check(tokenA, first, "free_name")) {
		t.Fatal("свободное имя названо занятым")
	}
	if wireBool(t, check(tokenA, first, "Carol_User")) {
		t.Fatal("имя пользователя названо свободным для чата (пространство имён общее, регистр не важен)")
	}
	if wireBool(t, check(tokenA, first, "second_group")) {
		t.Fatal("имя другого чата названо свободным")
	}
	if !wireBool(t, check(tokenA, first, "first_group")) {
		t.Fatal("своё имя текущего чата названо занятым")
	}
	if got := wireErr(t, check(tokenA, first, "ab"), http.StatusBadRequest); got != "USERNAME_INVALID" {
		t.Fatalf("негодная форма: %q; want USERNAME_INVALID", got)
	}
	// Участник без права менять инфо — отказ, а не ответ о занятости.
	if got := wireErr(t, check(tokenB, first, "free_name"), http.StatusForbidden); got != "CHAT_ADMIN_REQUIRED" {
		t.Fatalf("не админ: %q; want CHAT_ADMIN_REQUIRED", got)
	}

	// Проверка имени ПОЛЬЗОВАТЕЛЯ смотрит и чаты (общее пространство).
	rec = authedReq(t, h, http.MethodGet, "/username/available?u=second_group", tokenB, nil)
	if wireBool(t, rec) {
		t.Fatal("имя чата названо свободным для пользователя")
	}

	// Сохранение согласовано с проверкой: занятое чужим пространством имя не
	// сохраняется ни пользователю, ни чату.
	rec = authedReq(t, h, http.MethodPut, "/me/username", tokenB, map[string]string{"username": "second_group"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("имя чата сохранилось пользователю: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPut, "/chats/"+first+"/type", tokenA, map[string]any{"is_public": true, "username": "carol_user"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("имя пользователя сохранилось чату: %d %s", rec.Code, rec.Body.String())
	}
}

// denyChatInvite — приглашаемый запретил «кто может приглашать меня в группы».
type denyChatInvite struct{}

func (denyChatInvite) Check(_ context.Context, _, _ int64, key domain.PrivacyKey) (bool, error) {
	return key != domain.PrivacyChatInvite, nil
}

func (denyChatInvite) VisibleMap(_ context.Context, _ int64, ids []int64, _ domain.PrivacyKey) (map[int64]bool, error) {
	out := make(map[int64]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// Отказ приватности при добавлении в группу/канал — ошибка Telegram
// USER_PRIVACY_RESTRICTED (tweb addChatUsers.ts показывает по ней тост
// InviteToGroupError), а не наша строка `privacy`.
func TestAddMemberPrivacyRestricted_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newChatUC(pool)
	uc.SetPrivacy(denyChatInvite{})
	h := NewRouter(newAuthUC(pool), uc, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	tokenA, _ := signUp(t, h, pool, "+79990002011")
	_, idB := signUp(t, h, pool, "+79990002012")

	for _, path := range []string{"/groups", "/channels"} {
		rec := authedReq(t, h, http.MethodPost, path, tokenA, map[string]any{"title": "Team"})
		if rec.Code != http.StatusOK {
			t.Fatalf("создать %s: %d %s", path, rec.Code, rec.Body.String())
		}
		cid := itoa(createdPeerID(t, rec))
		rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/members", tokenA, map[string]int64{"user_id": idB})
		if got := wireErr(t, rec, http.StatusForbidden); got != "USER_PRIVACY_RESTRICTED" {
			t.Fatalf("%s: отказ приватности = %q; want USER_PRIVACY_RESTRICTED", path, got)
		}
	}
}
