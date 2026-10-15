package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
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
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

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
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &card)
	if card.Underscore != "messages.chatFull" || len(card.Chats) != 1 {
		t.Fatalf("card = %s", rec.Body.String())
	}
	chat := card.Chats[0]
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
	// GET /chats/{id}/members: 2 entries (A=creator, B=member), online=false
	// since no presence is wired into the test router.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/participants", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("members: %d %s", rec.Code, rec.Body.String())
	}
	// Участники — конструкторы объединения ChannelParticipant: РОЛЬ выражена
	// выбором конструктора, а присутствие живёт на карточке пользователя
	// (`users[].status`), а не на строке участника.
	var ml struct {
		Count        int `json:"count"`
		Participants []struct {
			Underscore string `json:"_"`
			UserID     int64  `json:"user_id"`
			Role       string `json:"role"`
		} `json:"participants"`
		Users []struct {
			ID     int64 `json:"id"`
			Status struct {
				Underscore string `json:"_"`
			} `json:"status"`
		} `json:"users"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &ml)
	if len(ml.Participants) != 2 || ml.Count != 2 {
		t.Fatalf("participants = %d (count=%d); want 2 (%s)", len(ml.Participants), ml.Count, rec.Body.String())
	}
	roleByUser := map[int64]string{}
	for _, m := range ml.Participants {
		// Строки `role` в участнике больше НЕТ: роль это конструктор.
		if m.Role != "" {
			t.Fatalf("роль уехала строкой: %+v", m)
		}
		switch m.Underscore {
		case "channelParticipantCreator":
			roleByUser[m.UserID] = "creator"
		case "channelParticipantAdmin":
			roleByUser[m.UserID] = "admin"
		case "channelParticipant":
			roleByUser[m.UserID] = "member"
		default:
			t.Fatalf("неизвестный конструктор участника %q", m.Underscore)
		}
	}
	for _, u := range ml.Users {
		// Присутствие не подключено — о статусе НИЧЕГО не известно, и это
		// userStatusEmpty, а не «офлайн с нулевым временем».
		if u.Status.Underscore != "userStatusEmpty" {
			t.Fatalf("user %d status = %q; want userStatusEmpty (no presence wired)", u.ID, u.Status.Underscore)
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
	// Ответ — сам ВЕКТОР карточек: обёртки `{"users": …}` у него больше нет.
	var users []struct {
		Underscore string `json:"_"`
		ID         int64  `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &users); err != nil {
		t.Fatalf("карточки не вектор: %v (%s)", err, rec.Body.String())
	}
	if len(users) != 2 {
		t.Fatalf("users = %d; want 2 (%s)", len(users), rec.Body.String())
	}
	got := map[int64]bool{}
	for _, u := range users {
		if u.Underscore != "user" {
			t.Fatalf("карточка не конструктором: %s", rec.Body.String())
		}
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
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	// A creates an invite link that requires approval.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"requires_approval": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("create invite: %d %s", rec.Code, rec.Body.String())
	}
	// «Нужно одобрение» — ФЛАГ конструктора, а не булево поле рядом.
	var inv struct {
		Invite struct {
			PFlags map[string]bool `json:"pFlags"`
		} `json:"invite"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &inv)
	invToken := inviteToken(t, rec)
	if invToken == "" || !inv.Invite.PFlags["request_needed"] {
		t.Fatalf("expected link + pFlags.request_needed, got %s", rec.Body.String())
	}

	// B joins via token → requested (not yet a member). Как
	// `messages.importChatInvite`: заявка — отказ с именем INVITE_REQUEST_SENT.
	rec = authedReq(t, h, http.MethodPost, "/join/"+invToken, tokenB, nil)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "INVITE_REQUEST_SENT") {
		t.Fatalf("join = %d %s; ожидался отказ INVITE_REQUEST_SENT", rec.Code, rec.Body.String())
	}

	// A lists join requests → contains B.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/join_requests", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("join_requests: %d %s", rec.Code, rec.Body.String())
	}
	// Заявки — тот же контейнер импортёров.
	var reqs struct {
		Importers []struct {
			UserID int64 `json:"user_id"`
		} `json:"importers"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &reqs)
	foundB := false
	for _, rq := range reqs.Importers {
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
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/participants", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("members: %d %s", rec.Code, rec.Body.String())
	}
	var ml struct {
		Participants []struct {
			UserID int64 `json:"user_id"`
		} `json:"participants"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &ml)
	isMember := false
	for _, m := range ml.Participants {
		if m.UserID == idB {
			isMember = true
		}
	}
	if !isMember {
		t.Fatalf("B (%d) not a member after approve: %s", idB, rec.Body.String())
	}
}

// `messages.importChatInvite`: вступление по ссылке без одобрения отдаёт
// `Updates` с чатом ссылки в chats[0] (по нему клиент открывает чат), повтор —
// тот же ответ без повторного вступления (`chatInviteAlready` оригинала).
func TestImportChatInvite_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990002011")
	tokenB, _ := signUp(t, h, pool, "+79990002012")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Direct"})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	peerID := createdPeerID(t, rec)
	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(peerID)+"/invite_links", tokenA, map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("create invite: %d %s", rec.Code, rec.Body.String())
	}
	invToken := inviteToken(t, rec)

	for i := 0; i < 2; i++ {
		rec = authedReq(t, h, http.MethodPost, "/join/"+invToken, tokenB, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("join #%d: %d %s", i, rec.Code, rec.Body.String())
		}
		var out struct {
			Underscore string `json:"_"`
			Chats      []struct {
				ID int64 `json:"id"`
			} `json:"chats"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if out.Underscore != "updates" || len(out.Chats) != 1 || -out.Chats[0].ID != peerID {
			t.Fatalf("join #%d = %s; ожидался updates с чатом %d в chats[0]", i, rec.Body.String(), peerID)
		}
	}
}

func TestInviteEditAndImporters_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990005001")
	tokenB, idB := signUp(t, h, pool, "+79990005002")

	// A creates a group.
	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Team"})
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	// Create an invite link with a title + usage limit.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"title": "Team link", "usage_limit": 10})
	if rec.Code != http.StatusOK {
		t.Fatalf("create invite: %d %s", rec.Code, rec.Body.String())
	}
	var inv struct {
		Invite struct {
			Title      string `json:"title"`
			UsageLimit *int   `json:"usage_limit"`
		} `json:"invite"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &inv)
	invToken := inviteToken(t, rec)
	if invToken == "" || inv.Invite.Title != "Team link" || inv.Invite.UsageLimit == nil || *inv.Invite.UsageLimit != 10 {
		t.Fatalf("create invite fields = %s", rec.Body.String())
	}

	// PATCH renames the link and flips requires_approval.
	rec = authedReq(t, h, http.MethodPatch, "/chats/"+cid+"/invite_links/"+invToken, tokenA, map[string]any{"title": "Renamed", "requires_approval": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("edit invite: %d %s", rec.Code, rec.Body.String())
	}
	var edited struct {
		Invite struct {
			Title  string          `json:"title"`
			PFlags map[string]bool `json:"pFlags"`
		} `json:"invite"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &edited)
	if edited.Invite.Title != "Renamed" || !edited.Invite.PFlags["request_needed"] {
		t.Fatalf("edited invite = %s", rec.Body.String())
	}

	// B joins via the (now approval-required) link → requested, then A approves.
	rec = authedReq(t, h, http.MethodPost, "/join/"+invToken, tokenB, nil)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "INVITE_REQUEST_SENT") {
		t.Fatalf("join = %d %s; ожидался отказ INVITE_REQUEST_SENT", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/join_requests/"+itoa(idB)+"/approve", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", rec.Code, rec.Body.String())
	}

	// importers lists B.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/invite_links/"+invToken+"/importers", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("importers: %d %s", rec.Code, rec.Body.String())
	}
	// Импортёр — конструктор chatInviteImporter; вошедший и заявка это ОДИН
	// конструктор, разницу выражает pFlags.requested.
	var imp struct {
		Importers []struct {
			Underscore string `json:"_"`
			UserID     int64  `json:"user_id"`
		} `json:"importers"`
		Count int `json:"count"`
		Users []struct {
			Underscore string `json:"_"`
			ID         int64  `json:"id"`
		} `json:"users"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &imp)
	if imp.Count != 1 || len(imp.Importers) != 1 || imp.Importers[0].UserID != idB {
		t.Fatalf("importers = %s", rec.Body.String())
	}
	// Карточка вошедшего — в векторе `users` контейнера (клиент читает её из зеркала).
	if len(imp.Users) != 1 || imp.Users[0].ID != idB || imp.Users[0].Underscore != "user" {
		t.Fatalf("importers users = %s", rec.Body.String())
	}
}

func TestInviteRevokeAndDelete_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990006001")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Team"})
	createdPeerID := createdPeerID(t, rec)
	cid := itoa(createdPeerID)

	// Create an extra link (the group is born with a primary one).
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"title": "Extra"})
	invToken := inviteToken(t, rec)

	listTokens := func(revoked bool) []string {
		url := "/chats/" + cid + "/invite_links"
		if revoked {
			url += "?revoked=true"
		}
		rec := authedReq(t, h, http.MethodGet, url, tokenA, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("list (revoked=%v): %d %s", revoked, rec.Code, rec.Body.String())
		}
		// Признак отзыва — ФЛАГ конструктора, а не булево поле рядом; адрес
		// один, токен это его хвост.
		var out struct {
			Invites []struct {
				Link   string          `json:"link"`
				PFlags map[string]bool `json:"pFlags"`
			} `json:"invites"`
			Users []struct {
				ID int64 `json:"id"`
			} `json:"users"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		// Карточка создателя ссылок — в векторе `users` контейнера, одна на создателя.
		if len(out.Invites) > 0 && (len(out.Users) != 1 || out.Users[0].ID != idA) {
			t.Fatalf("list (revoked=%v) users = %s", revoked, rec.Body.String())
		}
		toks := make([]string, 0, len(out.Invites))
		for _, l := range out.Invites {
			if l.PFlags["revoked"] != revoked {
				t.Fatalf("list(revoked=%v) returned link with revoked=%v", revoked, l.PFlags["revoked"])
			}
			toks = append(toks, l.Link[strings.LastIndexByte(l.Link, '/')+1:])
		}
		return toks
	}

	// Revoke via PATCH (revoked:true) → link leaves active list, joins revoked list.
	rec = authedReq(t, h, http.MethodPatch, "/chats/"+cid+"/invite_links/"+invToken, tokenA, map[string]any{"revoked": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke via patch: %d %s", rec.Code, rec.Body.String())
	}
	if contains(listTokens(false), invToken) {
		t.Fatal("revoked link still in active list")
	}
	if !contains(listTokens(true), invToken) {
		t.Fatal("revoked link missing from revoked list")
	}

	// Hard-delete the revoked link → gone from the revoked list too.
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/invite_links/"+invToken, tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete invite: %d %s", rec.Code, rec.Body.String())
	}
	if contains(listTokens(true), invToken) {
		t.Fatal("hard-deleted link still in revoked list")
	}

	// DeleteAllRevoked clears the whole revoked list.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"title": "Extra2"})
	inv2Token := inviteToken(t, rec)
	_ = authedReq(t, h, http.MethodPatch, "/chats/"+cid+"/invite_links/"+inv2Token, tokenA, map[string]any{"revoked": true})
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

// createdPeerID — ключ пира СОЗДАННОГО чата из ответа `POST /groups`,
// `POST /channels`.
//
// Ответ там — созданный объект, а не адрес в безымянной обёртке: у канала —
// `messages.chatFull`, у группы — `messages.invitedUsers` с чатом в
// `updates.chats` (как `messages.createChat` оригинала). Ключ выводится из
// краткой карточки, ровно как его выводит клиент.
func createdPeerID(t *testing.T, rec *httptest.ResponseRecorder) int64 {
	t.Helper()
	type chats = []struct {
		ID int64 `json:"id"`
	}
	var out struct {
		Underscore string `json:"_"`
		Chats      chats  `json:"chats"`
		Updates    struct {
			Chats chats `json:"chats"`
		} `json:"updates"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("ответ создания не разобрался: %s", rec.Body.String())
	}
	list := out.Chats
	if out.Underscore == domain.MessagesInvitedUsersTag {
		list = out.Updates.Chats
	}
	if len(list) == 0 {
		t.Fatalf("создание чата не отдало карточку: %s", rec.Body.String())
	}
	return int64(domain.ToPeerID(list[0].ID, true))
}

// Ответ создания группы — `messages.invitedUsers` оригинала
// (`messages.createChat`): созданный чат в `updates.chats`, пропущенные
// позванные — вектором `missing_invitees` (пустым, когда пропущенных нет).
func TestCreateGroup_RespondsInvitedUsers(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990001041")
	_, idB := signUp(t, h, pool, "+79990001042")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Team", "member_ids": []int64{idB}})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Underscore string `json:"_"`
		Updates    struct {
			Underscore string `json:"_"`
			Chats      []struct {
				Underscore string `json:"_"`
				Title      string `json:"title"`
			} `json:"chats"`
		} `json:"updates"`
		MissingInvitees []any `json:"missing_invitees"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Underscore != domain.MessagesInvitedUsersTag || out.Updates.Underscore != domain.UpdatesTag {
		t.Fatalf("ответ не messages.invitedUsers{updates}: %s", rec.Body.String())
	}
	if len(out.Updates.Chats) != 1 || out.Updates.Chats[0].Title != "Team" {
		t.Fatalf("созданного чата нет в updates.chats: %s", rec.Body.String())
	}
	if out.MissingInvitees == nil || len(out.MissingInvitees) != 0 {
		t.Fatalf("missing_invitees = %#v, ждали пустой вектор", out.MissingInvitees)
	}
}

// inviteToken — токен ссылки из ответа. Адрес на проводе ОДИН — параметр `link`
// конструктора chatInviteExported; токен это его хвост.
func inviteToken(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var out struct {
		Invite struct {
			Link string `json:"link"`
		} `json:"invite"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.Invite.Link == "" {
		t.Fatalf("ответ не messages.exportedChatInvite: %s", rec.Body.String())
	}
	return out.Invite.Link[strings.LastIndexByte(out.Invite.Link, '/')+1:]
}

// MC-11: название и описание — отдельные ручки, как в оригинале
// (channels.editTitle → Updates, messages.editChatAbout → Bool). Старый
// PATCH /chats/{id} снят: он писал и публичное имя из устаревшего кэша клиента.
func TestEditTitleAndAbout_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990001061")
	tokenB, idB := signUp(t, h, pool, "+79990001062")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{
		"title": "Старое", "about": "было", "username": "f7d_grp_http", "is_public": true, "member_ids": []int64{idB}})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	cid := itoa(createdPeerID(t, rec))

	// Админ с change_info правит описание: имя группы на месте.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/admins", tokenA, map[string]any{"user_id": idB, "rights": int(domain.RightChangeInfo)})
	if rec.Code != http.StatusOK {
		t.Fatalf("promote: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/about", tokenB, map[string]any{"about": "стало"})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "boolTrue") {
		t.Fatalf("about: %d %s; ждали boolTrue", rec.Code, rec.Body.String())
	}
	var card struct {
		Chats []struct {
			Title    string `json:"title"`
			Username string `json:"username"`
		} `json:"chats"`
		FullChat struct {
			About string `json:"about"`
		} `json:"full_chat"`
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &card)
	if len(card.Chats) != 1 || card.Chats[0].Username != "f7d_grp_http" || card.Chats[0].Title != "Старое" || card.FullChat.About != "стало" {
		t.Fatalf("после about: %s", rec.Body.String())
	}

	// Название: ответ — Updates с карточкой зрителя в chats[0].
	rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/title", tokenB, map[string]any{"title": "Новое"})
	if rec.Code != http.StatusOK {
		t.Fatalf("title: %d %s", rec.Code, rec.Body.String())
	}
	var up struct {
		Underscore string `json:"_"`
		Updates    []any  `json:"updates"`
		Chats      []struct {
			Underscore string `json:"_"`
			Title      string `json:"title"`
			Username   string `json:"username"`
		} `json:"chats"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &up)
	if up.Underscore != domain.UpdatesTag || len(up.Chats) != 1 || up.Chats[0].Title != "Новое" || up.Chats[0].Username != "f7d_grp_http" {
		t.Fatalf("ответ title не Updates с карточкой: %s", rec.Body.String())
	}

	// Пустое название — 400, и название на месте.
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/title", tokenB, map[string]any{"title": "  "}); rec.Code != http.StatusBadRequest {
		t.Fatalf("пустое название: %d %s; ждали 400", rec.Code, rec.Body.String())
	}
	// Старой ручки нет.
	if rec = authedReq(t, h, http.MethodPatch, "/chats/"+cid, tokenA, map[string]any{"title": "x", "about": "x", "username": ""}); rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("PATCH /chats/{id} жив: %d %s", rec.Code, rec.Body.String())
	}
	// Обычный участник без права — 403 (после сужения прав группы).
	tokenC, idC := signUp(t, h, pool, "+79990001063")
	_ = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/members", tokenA, map[string]int64{"user_id": idC})
	_ = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/permissions", tokenA, map[string]int{"permissions": 31 &^ int(domain.PermChangeInfo), "slowmode_seconds": 0})
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/about", tokenC, map[string]any{"about": "x"}); rec.Code != http.StatusForbidden {
		t.Fatalf("about без права: %d %s; ждали 403", rec.Code, rec.Body.String())
	}
}

// MC-12 + MC-13 на настоящей БД: админом назначают не-участника (вступление и
// права за один вызов), а вышедший создатель остаётся создателем — карточка
// несёт creator и left сразу, тип группы ему доступен, отправка возвращает его
// в чат строкой creator.
func TestPromoteNonMember_AndLeftCreator_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990001071")
	_, idB := signUp(t, h, pool, "+79990001072")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{
		"title": "Права", "username": "f7d_left_creator", "is_public": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	cid := itoa(createdPeerID(t, rec))
	role := func(uid int64) string {
		var r string
		if err := pool.QueryRow(context.Background(),
			`SELECT role FROM chat_members WHERE chat_id=$1 AND user_id=$2`, -createdPeerID(t, rec), uid).Scan(&r); err != nil {
			return ""
		}
		return r
	}

	// MC-12: B не участник — editAdmin вводит его админом.
	rec2 := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/admins", tokenA, map[string]any{"user_id": idB, "rights": int(domain.RightPinMessages)})
	if rec2.Code != http.StatusOK {
		t.Fatalf("promote не-участника: %d %s", rec2.Code, rec2.Body.String())
	}
	if role(idB) != domain.RoleAdmin {
		t.Fatalf("B после назначения: роль %q, ждали admin", role(idB))
	}

	// MC-13: создатель выходит.
	if r := authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/members/"+itoa(idA), tokenA, nil); r.Code != http.StatusOK {
		t.Fatalf("выход создателя: %d %s", r.Code, r.Body.String())
	}
	if role(idA) != "" {
		t.Fatalf("создатель остался участником: %q", role(idA))
	}
	var card struct {
		Chats []struct {
			PFlags map[string]bool `json:"pFlags"`
		} `json:"chats"`
	}
	r := authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	_ = json.Unmarshal(r.Body.Bytes(), &card)
	if len(card.Chats) != 1 || !card.Chats[0].PFlags["creator"] || !card.Chats[0].PFlags["left"] {
		t.Fatalf("карточка вышедшего создателя: %s", r.Body.String())
	}
	// Тип группы — право создателя, и сервер его признаёт без строки участника.
	if r := authedReq(t, h, http.MethodPut, "/chats/"+cid+"/type", tokenA, map[string]any{"is_public": true, "username": "f7d_left_creator2"}); r.Code != http.StatusOK {
		t.Fatalf("тип группы вышедшим создателем: %d %s", r.Code, r.Body.String())
	}
	// Отправка возвращает его в чат создателем.
	if r := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA, map[string]any{"text": "я тут", "client_msg_id": "f7d1"}); r.Code != http.StatusOK {
		t.Fatalf("отправка вышедшего создателя: %d %s", r.Code, r.Body.String())
	}
	if role(idA) != domain.RoleCreator {
		t.Fatalf("после отправки: роль %q, ждали creator", role(idA))
	}
}

// Б-5 (матрица контракта): участник с разрешением change_info (не админ) не
// меняет и не стирает публичное имя группы. Название и описание правятся своими
// ручками, имя — только ручкой типа: она у создателя и с проверкой формы имени.
func TestMemberWithChangeInfo_CannotTouchPublicUsername_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990001081")
	tokenB, idB := signUp(t, h, pool, "+79990001082")

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{
		"title": "Имя", "username": "f7d_pub_name", "is_public": true, "member_ids": []int64{idB}})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	cid := itoa(createdPeerID(t, rec))
	usernameNow := func() string {
		var card struct {
			Chats []struct {
				Username string `json:"username"`
			} `json:"chats"`
		}
		r := authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
		_ = json.Unmarshal(r.Body.Bytes(), &card)
		if len(card.Chats) != 1 {
			t.Fatalf("карточка: %s", r.Body.String())
		}
		return card.Chats[0].Username
	}

	// B — рядовой участник, дефолтные права группы дают ему change_info.
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/about", tokenB, map[string]any{"about": "от участника"}); rec.Code != http.StatusOK {
		t.Fatalf("about участником: %d %s", rec.Code, rec.Body.String())
	}
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/title", tokenB, map[string]any{"title": "Новое имя"}); rec.Code != http.StatusOK {
		t.Fatalf("title участником: %d %s", rec.Code, rec.Body.String())
	}
	if got := usernameNow(); got != "f7d_pub_name" {
		t.Fatalf("публичное имя после правок участника = %q", got)
	}
	// Сменить или стереть имя участнику нельзя.
	for _, body := range []map[string]any{
		{"is_public": true, "username": "f7d_stolen"},
		{"is_public": false, "username": ""},
	} {
		if rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/type", tokenB, body); rec.Code != http.StatusForbidden {
			t.Fatalf("тип группы участником %v: %d %s; ждали 403", body, rec.Code, rec.Body.String())
		}
	}
	if got := usernameNow(); got != "f7d_pub_name" {
		t.Fatalf("публичное имя после попыток участника = %q", got)
	}
	// Создатель: форма имени проверяется регэкспом.
	if rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/type", tokenA, map[string]any{"is_public": true, "username": "a b!"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("негодное имя создателем: %d %s; ждали 400", rec.Code, rec.Body.String())
	}
	if got := usernameNow(); got != "f7d_pub_name" {
		t.Fatalf("публичное имя после негодного = %q", got)
	}
}

// Б-6: ссылки-приглашения — только свои; чужие видит и правит создатель.
func TestInviteLinks_OwnerScope_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990006101") // создатель
	tokenB, idB := signUp(t, h, pool, "+79990006102") // админ с invite_users

	rec := authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Team"})
	cid := itoa(createdPeerID(t, rec))
	if rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/members", tokenA, map[string]int64{"user_id": idB}); rec.Code != http.StatusOK {
		t.Fatalf("add member: %d %s", rec.Code, rec.Body.String())
	}
	if rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/admins", tokenA, map[string]any{"user_id": idB, "rights": int(domain.RightInviteUsers)}); rec.Code != http.StatusOK {
		t.Fatalf("promote: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenA, map[string]any{"title": "creator-link"})
	cTok := inviteToken(t, rec)
	rec = authedReq(t, h, http.MethodPost, "/chats/"+cid+"/invite_links", tokenB, map[string]any{"title": "admin-link"})
	bTok := inviteToken(t, rec)

	tokens := func(rec *httptest.ResponseRecorder) []string {
		t.Helper()
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		var out struct {
			Invites []struct {
				Link string `json:"link"`
			} `json:"invites"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		var toks []string
		for _, l := range out.Invites {
			toks = append(toks, l.Link[strings.LastIndexByte(l.Link, '/')+1:])
		}
		return toks
	}
	base := "/chats/" + cid + "/invite_links"

	// Админ без admin_id видит только свою.
	got := tokens(authedReq(t, h, http.MethodGet, base, tokenB, nil))
	if !contains(got, bTok) || contains(got, cTok) {
		t.Fatalf("admin list = %v; want only own %s", got, bTok)
	}
	// Чужие через admin_id — 403 админу, ок создателю.
	if rec = authedReq(t, h, http.MethodGet, base+"?admin_id="+itoa(idA), tokenB, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("admin lists creator's: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	got = tokens(authedReq(t, h, http.MethodGet, base+"?admin_id="+itoa(idB), tokenA, nil))
	if !contains(got, bTok) || contains(got, cTok) {
		t.Fatalf("creator lists admin's = %v", got)
	}
	if rec = authedReq(t, h, http.MethodGet, base+"?admin_id=oops", tokenA, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad admin_id: want 400, got %d", rec.Code)
	}

	// Правка, импортёры и удаление чужой ссылки — 403 админу.
	if rec = authedReq(t, h, http.MethodPatch, base+"/"+cTok, tokenB, map[string]any{"revoked": true}); rec.Code != http.StatusForbidden {
		t.Fatalf("admin revokes creator's: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	if rec = authedReq(t, h, http.MethodGet, base+"/"+cTok+"/importers", tokenB, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("admin importers of creator's: want 403, got %d", rec.Code)
	}
	if rec = authedReq(t, h, http.MethodDelete, base+"/"+cTok, tokenB, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("admin deletes creator's: want 403, got %d", rec.Code)
	}
	// Создатель отзывает ссылку админа; админ свою отозванную чистит сам, чужую — нет.
	if rec = authedReq(t, h, http.MethodPatch, base+"/"+bTok, tokenA, map[string]any{"revoked": true}); rec.Code != http.StatusOK {
		t.Fatalf("creator revokes admin's: %d %s", rec.Code, rec.Body.String())
	}
	if rec = authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/revoked_invite_links?admin_id="+itoa(idA), tokenB, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("admin clears creator's revoked: want 403, got %d", rec.Code)
	}
	if rec = authedReq(t, h, http.MethodDelete, "/chats/"+cid+"/revoked_invite_links", tokenB, nil); rec.Code != http.StatusOK {
		t.Fatalf("admin clears own revoked: %d %s", rec.Code, rec.Body.String())
	}
	if got = tokens(authedReq(t, h, http.MethodGet, base+"?revoked=true&admin_id="+itoa(idB), tokenA, nil)); len(got) != 0 {
		t.Fatalf("admin's revoked not cleared: %v", got)
	}

	// admins_with_invites: только создатель; контейнер со счётчиками и карточками.
	if rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/admins_with_invites", tokenB, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("admin admins_with_invites: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/admins_with_invites", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("admins_with_invites: %d %s", rec.Code, rec.Body.String())
	}
	var awi struct {
		Underscore string `json:"_"`
		Admins     []struct {
			Underscore          string `json:"_"`
			AdminID             int64  `json:"admin_id"`
			InvitesCount        int    `json:"invites_count"`
			RevokedInvitesCount int    `json:"revoked_invites_count"`
		} `json:"admins"`
		Users []struct {
			ID int64 `json:"id"`
		} `json:"users"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &awi)
	if awi.Underscore != "messages.chatAdminsWithInvites" || len(awi.Admins) != 1 || awi.Admins[0].AdminID != idA {
		// админ B после очистки отозванных ссылок не оставил ни одной — в списке только создатель
		t.Fatalf("admins_with_invites = %s", rec.Body.String())
	}
	if awi.Admins[0].Underscore != "chatAdminWithInvites" || awi.Admins[0].InvitesCount < 2 || awi.Admins[0].RevokedInvitesCount != 0 {
		t.Fatalf("creator counts = %+v", awi.Admins[0])
	}
	if len(awi.Users) != 1 || awi.Users[0].ID != idA {
		t.Fatalf("admins_with_invites users = %s", rec.Body.String())
	}
}
