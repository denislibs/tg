package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф7-И1 (MC-08): реакция, которую чат не принимает, — 400 REACTION_INVALID.
// По этому имени tweb откатывает локальную реакцию (appReactionsManager.ts:977-989);
// раньше «реакции выключены» уходили 403/500, и откат срабатывал по другой ветке.
func TestReact_Invalid_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990170021")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Team"})
	gid := itoa(createdPeerID(t, rec))
	rec = authedReq(t, h, http.MethodPost, "/chats/"+gid+"/messages", tokenA, map[string]any{"text": "hi"})
	var msg struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &msg)
	path := "/chats/" + gid + "/messages/" + itoa(msg.ID) + "/reactions"

	wantInvalid := func(what string, rec *httptest.ResponseRecorder) {
		t.Helper()
		var e struct {
			Text string `json:"text"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &e)
		if rec.Code != http.StatusBadRequest || e.Text != "REACTION_INVALID" {
			t.Fatalf("%s: %d %s; want 400 REACTION_INVALID", what, rec.Code, rec.Body.String())
		}
	}

	// Реакции выключены (mode none) — любая реакция отклоняется.
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+gid+"/reactions", tokenA, map[string]any{"mode": "none"}); rec.Code != http.StatusOK {
		t.Fatalf("mode none: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, path, tokenA, map[string]string{"emoji": "🔥"})
	wantInvalid("mode none", rec)

	// Только из списка: эмодзи не из списка отклоняется, из списка проходит.
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+gid+"/reactions", tokenA, map[string]any{"mode": "some", "emojis": []string{"👍"}}); rec.Code != http.StatusOK {
		t.Fatalf("mode some: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, path, tokenA, map[string]string{"emoji": "🔥"})
	wantInvalid("не из списка", rec)
	if rec = authedReq(t, h, http.MethodPost, path, tokenA, map[string]string{"emoji": "👍"}); rec.Code != http.StatusOK {
		t.Fatalf("из списка: %d %s", rec.Code, rec.Body.String())
	}
}

// Медленный режим: второе сообщение участника в окне — HTTP 420
// SLOWMODE_WAIT_<N>, N — остаток окна (tweb appImManager.ts:551-565 берёт N из
// error.type и показывает попап «Медленный режим»).
func TestSlowmode_HTTP_Wait(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990170031")
	tokenB, idB := signUp(t, h, pool, "+79990170032")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Slow", "member_ids": []int64{idB}})
	gid := itoa(createdPeerID(t, rec))
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+gid+"/permissions", tokenA, map[string]int{"permissions": 31, "slowmode_seconds": 30}); rec.Code != http.StatusOK {
		t.Fatalf("permissions: %d %s", rec.Code, rec.Body.String())
	}
	if rec = authedReq(t, h, http.MethodPost, "/chats/"+gid+"/messages", tokenB, map[string]any{"text": "раз", "client_msg_id": "s1"}); rec.Code != http.StatusOK {
		t.Fatalf("первое: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+gid+"/messages", tokenB, map[string]any{"text": "два", "client_msg_id": "s2"})
	var e struct {
		Code int    `json:"code"`
		Text string `json:"text"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &e)
	n := waitSeconds(e.Text)
	if rec.Code != 420 || !strings.HasPrefix(e.Text, "SLOWMODE_WAIT_") || n < 28 || n > 30 {
		t.Fatalf("второе: %d %s; want 420 SLOWMODE_WAIT_28..30", rec.Code, rec.Body.String())
	}
}

// Переключатели отказов ручек отправки (комментарий к посту, правка отложенного,
// группы, истории, папки) отдают ErrSlowmodeWait как 420, а не 500. Саму форму
// охраняет TestErrorSwitches_DefaultIsDomainError; здесь — наблюдаемый код.
func TestErrorMappers_SlowmodeWait(t *testing.T) {
	wait := domain.ErrSlowmodeWait{Seconds: 12}
	mappers := map[string]func(http.ResponseWriter, error){
		"ChannelHandler.mapErr":    (&ChannelHandler{}).mapErr,
		"ChatHandler.mapScheduled": (&ChatHandler{}).mapScheduledErr,
		"GroupHandler.mapErr":      (&GroupHandler{}).mapErr,
		"StoryHandler.mapErr":      (&StoryHandler{}).mapErr,
	}
	for name, fn := range mappers {
		rec := httptest.NewRecorder()
		fn(rec, wait)
		if e := errText(t, rec); rec.Code != 420 || e != "SLOWMODE_WAIT_12" {
			t.Errorf("%s: %d %q, want 420 SLOWMODE_WAIT_12", name, rec.Code, e)
		}
	}
}
