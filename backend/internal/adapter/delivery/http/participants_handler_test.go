package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Б-115/Б-86/Б-84 на проводе: фильтры участников с правами, getParticipant
// с USER_NOT_PARTICIPANT, «N онлайн», заявки страницей с карточками и
// счётчики в карточке зрителя.
func TestParticipants_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990015101")
	tokenB, idB := signUp(t, h, pool, "+79990015102")
	tokenC, idC := signUp(t, h, pool, "+79990015103")
	_, idD := signUp(t, h, pool, "+79990015104")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Участники"})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	cid := itoa(createdPeerID(t, rec))
	if rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/members", tokenA, map[string]int64{"user_id": idB}); rec.Code != http.StatusOK {
		t.Fatalf("add B: %d %s", rec.Code, rec.Body.String())
	}

	// Обычному участнику удалённые — 403, неизвестный фильтр — 400.
	if rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/participants?filter=kicked", tokenB, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("kicked участнику: %d", rec.Code)
	}
	if rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/participants?filter=nope", tokenA, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("неизвестный фильтр: %d", rec.Code)
	}
	// count — всего, а не длина страницы (A4-07).
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/participants?filter=recent&limit=1", tokenA, nil)
	var page struct {
		Count        int               `json:"count"`
		Participants []json.RawMessage `json:"participants"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &page)
	if rec.Code != http.StatusOK || page.Count != 2 || len(page.Participants) != 1 {
		t.Fatalf("recent limit=1: %d %s", rec.Code, rec.Body.String())
	}
	// Админы — создатель с рангом-подписью после повышения B.
	if rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/admins", tokenA, map[string]any{"user_id": idB, "rights": 4, "rank": "модер"}); rec.Code != http.StatusOK {
		t.Fatalf("promote: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/participants?filter=admins", tokenA, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"rank":"модер"`) || !strings.Contains(rec.Body.String(), `"promoted_by"`) {
		t.Fatalf("admins: %s", rec.Body.String())
	}

	// getParticipant: посторонний — USER_NOT_PARTICIPANT.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/participants/"+itoa(idD), tokenA, nil)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "USER_NOT_PARTICIPANT") {
		t.Fatalf("getParticipant постороннего: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/participants/"+itoa(idB), tokenB, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"channels.channelParticipant"`) {
		t.Fatalf("getParticipant себя: %d %s", rec.Code, rec.Body.String())
	}

	// «N онлайн»: минимум 1; постороннему — 403.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/onlines", tokenA, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"_":"chatOnlines"`) {
		t.Fatalf("onlines: %d %s", rec.Code, rec.Body.String())
	}
	if rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/onlines", tokenC, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("onlines постороннему: %d", rec.Code)
	}

	// Заявка C → карточка владельца несёт requests_pending и карточку C.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"requires_approval": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("invite: %d %s", rec.Code, rec.Body.String())
	}
	tok := inviteToken(t, rec)
	if rec = authedReq(t, h, http.MethodPost, "/join/"+tok, tokenC, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("заявка: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	var card struct {
		FullChat struct {
			AdminsCount      int     `json:"admins_count"`
			KickedCount      *int    `json:"kicked_count"`
			RequestsPending  int     `json:"requests_pending"`
			RecentRequesters []int64 `json:"recent_requesters"`
		} `json:"full_chat"`
		Users []struct {
			ID int64 `json:"id"`
		} `json:"users"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &card)
	if card.FullChat.RequestsPending != 1 || len(card.FullChat.RecentRequesters) != 1 || card.FullChat.RecentRequesters[0] != idC ||
		len(card.Users) != 1 || card.Users[0].ID != idC || card.FullChat.AdminsCount != 2 || card.FullChat.KickedCount == nil {
		t.Fatalf("карточка владельца: %s", rec.Body.String())
	}
	// Заявки страницей: count и карточки.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/join_requests?limit=10", tokenA, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"count":1`) || !strings.Contains(rec.Body.String(), `"users":[{`) {
		t.Fatalf("join_requests: %s", rec.Body.String())
	}
	// Старых GET /members, /bans, /restrictions нет — как в tweb: только
	// /participants (на путях остались POST — chi отвечает 405).
	for _, path := range []string{"/members", "/bans", "/restrictions"} {
		if rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+path, tokenA, nil); rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("GET %s жив: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	// Владелец себе подпись (п. 5); без поля rank подпись B не стирается.
	if rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/admins", tokenA, map[string]any{"user_id": idA, "rank": "основатель"}); rec.Code != http.StatusOK {
		t.Fatalf("владелец себе подпись: %d %s", rec.Code, rec.Body.String())
	}
	if rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/admins", tokenA, map[string]any{"user_id": idB, "rights": 4}); rec.Code != http.StatusOK {
		t.Fatalf("правка без rank: %d", rec.Code)
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/participants?filter=admins", tokenA, nil)
	if !strings.Contains(rec.Body.String(), `"rank":"основатель"`) || !strings.Contains(rec.Body.String(), `"rank":"модер"`) {
		t.Fatalf("подписи: %s", rec.Body.String())
	}
}
