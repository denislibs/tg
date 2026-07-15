package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestGroupFlow_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990001001")
	tokenB, idB := signUp(t, h, pool, "+79990001002")
	_, idC := signUp(t, h, pool, "+79990001003")

	// A creates a group.
	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Team"})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.ChatID == 0 {
		t.Fatalf("expected chat_id, got %s", rec.Body.String())
	}
	cid := itoa(created.ChatID)

	// A adds B as a member.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/members", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("creator add member: %d %s", rec.Code, rec.Body.String())
	}

	// Дефолтные разрешения (как в Telegram) позволяют участнику добавлять людей;
	// после выключения «Добавления участников» админом — 403.
	rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/permissions", tokenA, map[string]int{"permissions": 31 &^ 4, "slowmode_seconds": 0})
	if rec.Code != http.StatusOK {
		t.Fatalf("set permissions: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/members", tokenB, map[string]int64{"user_id": idC})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("member add without perm: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/permissions", tokenA, map[string]int{"permissions": 31, "slowmode_seconds": 0})
	if rec.Code != http.StatusOK {
		t.Fatalf("restore permissions: %d %s", rec.Code, rec.Body.String())
	}

	// GET card for A: title, creator role, member_count = 2 (A + B).
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("card: %d %s", rec.Code, rec.Body.String())
	}
	var card struct {
		Title       string `json:"title"`
		MyRole      string `json:"my_role"`
		MemberCount int    `json:"member_count"`
		CreatorID   int64  `json:"creator_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &card)
	if card.Title != "Team" {
		t.Fatalf("card title = %q; want Team", card.Title)
	}
	if card.MyRole != "creator" {
		t.Fatalf("card my_role = %q; want creator", card.MyRole)
	}
	if card.MemberCount != 2 {
		t.Fatalf("card member_count = %d; want 2", card.MemberCount)
	}
	if card.CreatorID != idA {
		t.Fatalf("card creator_id = %d; want %d", card.CreatorID, idA)
	}

	// GET /chats/{id}/members: 2 entries (A=creator, B=member), online=false
	// since no presence is wired into the test router.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/members", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("members: %d %s", rec.Code, rec.Body.String())
	}
	var ml struct {
		Members []struct {
			UserID int64  `json:"user_id"`
			Role   string `json:"role"`
			Online bool   `json:"online"`
		} `json:"members"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &ml)
	if len(ml.Members) != 2 {
		t.Fatalf("members = %d; want 2 (%s)", len(ml.Members), rec.Body.String())
	}
	roleByUser := map[int64]string{}
	for _, m := range ml.Members {
		roleByUser[m.UserID] = m.Role
		if m.Online {
			t.Fatalf("member %d online=true; want false (no presence wired)", m.UserID)
		}
	}
	if roleByUser[idA] != "creator" {
		t.Fatalf("A role = %q; want creator", roleByUser[idA])
	}
	if roleByUser[idB] != "member" {
		t.Fatalf("B role = %q; want member", roleByUser[idB])
	}

	// GET /users?ids= returns the requested users.
	rec = authedReq(t, h, http.MethodGet, "/users?ids="+itoa(idA)+","+itoa(idB), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("users: %d %s", rec.Code, rec.Body.String())
	}
	var users struct {
		Users []struct {
			ID int64 `json:"id"`
		} `json:"users"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &users)
	if len(users.Users) != 2 {
		t.Fatalf("users = %d; want 2 (%s)", len(users.Users), rec.Body.String())
	}
	got := map[int64]bool{}
	for _, u := range users.Users {
		got[u.ID] = true
	}
	if !got[idA] || !got[idB] {
		t.Fatalf("users missing requested ids: %+v", got)
	}
}

func TestJoinRequestFlow_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990002001")
	tokenB, idB := signUp(t, h, pool, "+79990002002")
	tokenC, _ := signUp(t, h, pool, "+79990002003")

	// A creates a group.
	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Approvals"})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.ChatID)

	// A creates an invite link that requires approval.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"requires_approval": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("create invite: %d %s", rec.Code, rec.Body.String())
	}
	var inv struct {
		Token            string `json:"token"`
		RequiresApproval bool   `json:"requires_approval"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &inv)
	if inv.Token == "" || !inv.RequiresApproval {
		t.Fatalf("expected token + requires_approval=true, got %s", rec.Body.String())
	}

	// B joins via token → requested (not yet a member).
	rec = authedReq(t, h, http.MethodPost, "/join/"+inv.Token, tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body.String())
	}
	var jr struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &jr)
	if jr.Status != "requested" {
		t.Fatalf("join status = %q; want requested", jr.Status)
	}

	// A lists join requests → contains B.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/join_requests", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("join_requests: %d %s", rec.Code, rec.Body.String())
	}
	var reqs struct {
		Requests []struct {
			UserID int64 `json:"user_id"`
		} `json:"requests"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &reqs)
	foundB := false
	for _, rq := range reqs.Requests {
		if rq.UserID == idB {
			foundB = true
		}
	}
	if !foundB {
		t.Fatalf("join_requests missing B (%d): %s", idB, rec.Body.String())
	}

	// A non-member (C) cannot approve → 403.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/join_requests/"+itoa(idB)+"/approve", tokenC, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-member approve: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// A approves B.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/join_requests/"+itoa(idB)+"/approve", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", rec.Code, rec.Body.String())
	}

	// B is now a member.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/members", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("members: %d %s", rec.Code, rec.Body.String())
	}
	var ml struct {
		Members []struct {
			UserID int64 `json:"user_id"`
		} `json:"members"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &ml)
	isMember := false
	for _, m := range ml.Members {
		if m.UserID == idB {
			isMember = true
		}
	}
	if !isMember {
		t.Fatalf("B (%d) not a member after approve: %s", idB, rec.Body.String())
	}
}
