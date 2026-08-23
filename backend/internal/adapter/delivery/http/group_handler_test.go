package http

import (
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
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/members", tokenA, nil)
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

	// B joins via token → requested (not yet a member).
	rec = authedReq(t, h, http.MethodPost, "/join/"+invToken, tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body.String())
	}
	// «Вошёл» и «заявка отправлена» — ОДИН конструктор chatInviteImporter,
	// разницу выражает pFlags.requested, а не строка состояния.
	var jr struct {
		Underscore string          `json:"_"`
		PFlags     map[string]bool `json:"pFlags"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &jr)
	if jr.Underscore != "chatInviteImporter" || !jr.PFlags["requested"] {
		t.Fatalf("join = %s; ожидался chatInviteImporter с pFlags.requested", rec.Body.String())
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
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/members", tokenA, nil)
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
	if rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body.String())
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
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
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
// Ответ там — конструктор `messages.chatFull` (созданный объект целиком), а не
// адрес в безымянной обёртке: ключ выводится из краткой карточки в `chats`,
// ровно как его выводит клиент.
func createdPeerID(t *testing.T, rec *httptest.ResponseRecorder) int64 {
	t.Helper()
	var out struct {
		Chats []struct {
			ID int64 `json:"id"`
		} `json:"chats"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Chats) == 0 {
		t.Fatalf("создание чата не отдало карточку: %s", rec.Body.String())
	}
	return int64(domain.ToPeerID(out.Chats[0].ID, true))
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
