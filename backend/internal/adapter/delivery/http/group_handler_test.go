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
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.PeerID == 0 {
		t.Fatalf("expected chat_id, got %s", rec.Body.String())
	}
	cid := itoa(created.PeerID)

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
	// Карточка — messages.chatFull: полная форма вместе с краткой. Роль
	// отдельным полем не едет: creator это pFlags.creator, admin — наличие
	// admin_rights (решение №3 разбора).
	var card struct {
		CreatorID int64 `json:"creator_id"`
		ChatFull  struct {
			Underscore string `json:"_"`
			Chats      []struct {
				Underscore        string          `json:"_"`
				Title             string          `json:"title"`
				ParticipantsCount int             `json:"participants_count"`
				PFlags            map[string]bool `json:"pFlags"`
				AdminRights       *struct {
					Underscore string `json:"_"`
				} `json:"admin_rights"`
			} `json:"chats"`
		} `json:"chat_full"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &card)
	if card.ChatFull.Underscore != "messages.chatFull" || len(card.ChatFull.Chats) != 1 {
		t.Fatalf("card = %s", rec.Body.String())
	}
	chat := card.ChatFull.Chats[0]
	if chat.Underscore != "channel" || chat.Title != "Team" {
		t.Fatalf("card chat = %+v (%s)", chat, rec.Body.String())
	}
	if !chat.PFlags["megagroup"] {
		t.Fatalf("группа не помечена megagroup: %+v", chat.PFlags)
	}
	if !chat.PFlags["creator"] || chat.AdminRights == nil {
		t.Fatalf("создатель не выражен флагами: %+v", chat)
	}
	if chat.ParticipantsCount != 2 {
		t.Fatalf("participants_count = %d; want 2", chat.ParticipantsCount)
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
			Status struct {
				Underscore string `json:"_"`
			} `json:"status"`
		} `json:"members"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &ml)
	if len(ml.Members) != 2 {
		t.Fatalf("members = %d; want 2 (%s)", len(ml.Members), rec.Body.String())
	}
	roleByUser := map[int64]string{}
	for _, m := range ml.Members {
		roleByUser[m.UserID] = m.Role
		// Присутствие не подключено — о статусе НИЧЕГО не известно, и это
		// userStatusEmpty, а не «офлайн с нулевым временем».
		if m.Status.Underscore != "userStatusEmpty" {
			t.Fatalf("member %d status = %q; want userStatusEmpty (no presence wired)", m.UserID, m.Status.Underscore)
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
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

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

func TestInviteEditAndImporters_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990005001")
	tokenB, idB := signUp(t, h, pool, "+79990005002")

	// A creates a group.
	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Team"})
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

	// Create an invite link with a title + usage limit.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"title": "Team link", "usage_limit": 10})
	if rec.Code != http.StatusOK {
		t.Fatalf("create invite: %d %s", rec.Code, rec.Body.String())
	}
	var inv struct {
		Token      string `json:"token"`
		Title      string `json:"title"`
		UsageLimit *int   `json:"usage_limit"`
		Revoked    bool   `json:"revoked"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &inv)
	if inv.Token == "" || inv.Title != "Team link" || inv.UsageLimit == nil || *inv.UsageLimit != 10 {
		t.Fatalf("create invite fields = %s", rec.Body.String())
	}

	// PATCH renames the link and flips requires_approval.
	rec = authedReq(t, h, http.MethodPatch, "/chats/"+cid+"/invite_links/"+inv.Token, tokenA, map[string]any{"title": "Renamed", "requires_approval": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("edit invite: %d %s", rec.Code, rec.Body.String())
	}
	var edited struct {
		Title            string `json:"title"`
		RequiresApproval bool   `json:"requires_approval"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &edited)
	if edited.Title != "Renamed" || !edited.RequiresApproval {
		t.Fatalf("edited invite = %s", rec.Body.String())
	}

	// B joins via the (now approval-required) link → requested, then A approves.
	rec = authedReq(t, h, http.MethodPost, "/join/"+inv.Token, tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/join_requests/"+itoa(idB)+"/approve", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", rec.Code, rec.Body.String())
	}

	// importers lists B.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/invite_links/"+inv.Token+"/importers", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("importers: %d %s", rec.Code, rec.Body.String())
	}
	var imp struct {
		Importers []struct {
			UserID int64 `json:"user_id"`
		} `json:"importers"`
		Count int `json:"count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &imp)
	if imp.Count != 1 || len(imp.Importers) != 1 || imp.Importers[0].UserID != idB {
		t.Fatalf("importers = %s", rec.Body.String())
	}
}

func TestInviteRevokeAndDelete_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990006001")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Team"})
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.PeerID)

	// Create an extra link (the group is born with a primary one).
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"title": "Extra"})
	var inv struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &inv)
	if inv.Token == "" {
		t.Fatalf("create invite: %s", rec.Body.String())
	}

	listTokens := func(revoked bool) []string {
		url := "/chats/" + cid + "/invite_links"
		if revoked {
			url += "?revoked=true"
		}
		rec := authedReq(t, h, http.MethodGet, url, tokenA, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("list (revoked=%v): %d %s", revoked, rec.Code, rec.Body.String())
		}
		var out struct {
			InviteLinks []struct {
				Token   string `json:"token"`
				Revoked bool   `json:"revoked"`
			} `json:"invite_links"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		toks := make([]string, 0, len(out.InviteLinks))
		for _, l := range out.InviteLinks {
			if l.Revoked != revoked {
				t.Fatalf("list(revoked=%v) returned link with revoked=%v", revoked, l.Revoked)
			}
			toks = append(toks, l.Token)
		}
		return toks
	}

	// Revoke via PATCH (revoked:true) → link leaves active list, joins revoked list.
	rec = authedReq(t, h, http.MethodPatch, "/chats/"+cid+"/invite_links/"+inv.Token, tokenA, map[string]any{"revoked": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke via patch: %d %s", rec.Code, rec.Body.String())
	}
	if contains(listTokens(false), inv.Token) {
		t.Fatal("revoked link still in active list")
	}
	if !contains(listTokens(true), inv.Token) {
		t.Fatal("revoked link missing from revoked list")
	}

	// Hard-delete the revoked link → gone from the revoked list too.
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/invite_links/"+inv.Token, tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete invite: %d %s", rec.Code, rec.Body.String())
	}
	if contains(listTokens(true), inv.Token) {
		t.Fatal("hard-deleted link still in revoked list")
	}

	// DeleteAllRevoked clears the whole revoked list.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"title": "Extra2"})
	var inv2 struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &inv2)
	_ = authedReq(t, h, http.MethodPatch, "/chats/"+cid+"/invite_links/"+inv2.Token, tokenA, map[string]any{"revoked": true})
	if len(listTokens(true)) == 0 {
		t.Fatal("expected a revoked link before delete-all")
	}
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/revoked_invite_links", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete-all revoked: %d %s", rec.Code, rec.Body.String())
	}
	if len(listTokens(true)) != 0 {
		t.Fatal("revoked list not empty after delete-all")
	}
}

func contains(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}
