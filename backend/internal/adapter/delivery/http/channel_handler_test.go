package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestChannelFlow_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990002001")
	tokenB, _ := signUp(t, h, pool, "+79990002002")

	// A creates a public channel with a username.
	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Go News Daily", "username": "gonews", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.ChatID == 0 {
		t.Fatalf("expected chat_id, got %s", rec.Body.String())
	}
	cid := itoa(created.ChatID)

	// Creator posts → 200 + seq.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": "hello world", "client_msg_id": "c1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("creator post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		Seq    int64 `json:"seq"`
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	if post.Seq == 0 {
		t.Fatalf("expected non-zero seq, got %s", rec.Body.String())
	}
	if post.ChatID != created.ChatID {
		t.Fatalf("post chat_id = %d; want %d", post.ChatID, created.ChatID)
	}

	// A second post so difference has more than one entry.
	_ = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{"text": "second"})

	// difference?pts=0 returns the posts.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/difference?pts=0", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("difference: %d %s", rec.Code, rec.Body.String())
	}
	var diff struct {
		Updates []json.RawMessage `json:"updates"`
		Pts     int64             `json:"pts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &diff)
	if len(diff.Updates) != 2 || diff.Pts != 2 {
		t.Fatalf("difference = %+v (%s)", diff, rec.Body.String())
	}

	// search?q= finds the public channel by username.
	rec = authedReq(t, h, http.MethodGet, "/search?q=gonews", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("search: %d %s", rec.Code, rec.Body.String())
	}
	var search struct {
		Chats []struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"chats"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &search)
	if len(search.Chats) != 1 || search.Chats[0].Username != "gonews" {
		t.Fatalf("search chats = %+v (%s)", search.Chats, rec.Body.String())
	}

	// B joins by username → 200, and the card's member_count grows.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenA, nil)
	var before struct {
		MemberCount int `json:"member_count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &before)

	rec = authedReq(t, h, http.MethodPost, "/channels/join", tokenB, map[string]any{"username": "gonews"})
	if rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/card", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("card after join: %d %s", rec.Code, rec.Body.String())
	}
	var after struct {
		MemberCount int `json:"member_count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &after)
	if after.MemberCount != before.MemberCount+1 {
		t.Fatalf("member_count = %d; want %d", after.MemberCount, before.MemberCount+1)
	}

	// B (a subscriber) cannot post → 403.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenB, map[string]any{"text": "nope"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("subscriber post: want 403, got %d %s", rec.Code, rec.Body.String())
	}
}
