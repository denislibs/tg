package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
)

// Тема оформления уехала из СТРОКИ ДИАЛОГА в полную карточку (решение Р7): в
// схеме её место — chatFull/channelFull.theme_emoticon, а в `dialog` поля нет
// вовсе. Прежде она ехала в каждой строке каждого ответа /chats.
func newThemeRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	t.Helper()
	pool := postgres.NewTestDB(t)
	privacyUC := usecaseprivacy.New(pgadapter.NewPrivacyRepo(pool))
	return NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil,
		NewICEHandler("", "test"), nil, nil, nil, privacyUC, nil, nil, nil, nil, nil, nil, nil), pool
}

func TestChatTheme_LivesInFullCard_HTTP(t *testing.T) {
	h, pool := newThemeRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000250")
	_, idB := signUp(t, h, pool, "+79990000251")

	// ── Группа: channelFull.theme_emoticon ──────────────────────────────────
	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{
		"title": "Тема", "member_ids": []int64{idB},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	groupPeerID := createdPeerID(t, rec)

	if rec := authedReq(t, h, http.MethodPut, "/chats/"+itoa(groupPeerID)+"/theme", tokenA,
		map[string]any{"theme_id": "night"}); rec.Code != http.StatusOK {
		t.Fatalf("set theme: %d %s", rec.Code, rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(groupPeerID)+"/card", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("card: %d %s", rec.Code, rec.Body.String())
	}
	// Ответ — конструктор messages.chatFull В КОРНЕ: обёртки с `muted` и
	// `creator_id` рядом больше нет вовсе.
	var card struct {
		Underscore string         `json:"_"`
		FullChat   map[string]any `json:"full_chat"`
		Muted      any            `json:"muted"`
		CreatorID  any            `json:"creator_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &card)
	if card.FullChat["theme_emoticon"] != "night" {
		t.Errorf("channelFull.theme_emoticon = %v; want night", card.FullChat["theme_emoticon"])
	}
	// Заглушённость зрителем — notify_settings САМОЙ карточки, и мьют в нём
	// выражен сроком; создатель — pFlags.creator краткой формы.
	if card.Muted != nil || card.CreatorID != nil {
		t.Errorf("плоские поля остались рядом с карточкой: muted=%v creator_id=%v", card.Muted, card.CreatorID)
	}
	ns, _ := card.FullChat["notify_settings"].(map[string]any)
	if ns == nil || ns["_"] != "peerNotifySettings" {
		t.Errorf("карточка без notify_settings: %v", card.FullChat)
	}

	// ── Приватный чат: userFull.theme_emoticon ──────────────────────────────
	rec = authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	priv := createdPeerFrom(t, rec)
	if rec := authedReq(t, h, http.MethodPut, "/chats/"+itoa(priv)+"/theme", tokenA,
		map[string]any{"theme_id": "day"}); rec.Code != http.StatusOK {
		t.Fatalf("set private theme: %d %s", rec.Code, rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodGet, "/users/"+itoa(idB), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("profile: %d %s", rec.Code, rec.Body.String())
	}
	var profile struct {
		FullUser map[string]any `json:"full_user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &profile)
	if profile.FullUser["theme_emoticon"] != "day" {
		t.Errorf("userFull.theme_emoticon = %v; want day", profile.FullUser["theme_emoticon"])
	}

	// И главное: в СТРОКЕ ДИАЛОГА темы больше нет ни у группы, ни у привата.
	body := authedReq(t, h, http.MethodGet, "/chats", tokenA, nil).Body.String()
	if strings.Contains(body, "theme_id") || strings.Contains(body, "theme_emoticon") {
		t.Errorf("тема осталась в списке диалогов: %s", body)
	}
}
