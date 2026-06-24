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

func TestChannelDiscussion_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990003001")
	tokenB, _ := signUp(t, h, pool, "+79990003002")

	// A creates a public channel.
	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Discuss Channel", "username": "discusschan", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.ChatID)

	// A posts → capture the post message id.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{
		"text": "discuss this", "client_msg_id": "p1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	if post.ID == 0 {
		t.Fatalf("expected post id, got %s", rec.Body.String())
	}
	pid := itoa(post.ID)

	// A enables discussion.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/discussion", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("enable discussion: %d %s", rec.Code, rec.Body.String())
	}
	var disc struct {
		DiscussionChatID int64 `json:"discussion_chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &disc)
	if disc.DiscussionChatID == 0 {
		t.Fatalf("expected discussion_chat_id, got %s", rec.Body.String())
	}

	// B posts a comment on the post → 200.
	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/posts/"+pid+"/comments", tokenB, map[string]any{
		"text": "nice post", "client_msg_id": "k1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post comment: %d %s", rec.Code, rec.Body.String())
	}
	var comment struct {
		ThreadRootID *int64 `json:"thread_root_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &comment)
	if comment.ThreadRootID == nil || *comment.ThreadRootID != post.ID {
		t.Fatalf("comment thread_root_id = %v; want %d (%s)", comment.ThreadRootID, post.ID, rec.Body.String())
	}

	// GET comments → 1 message + count 1.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/posts/"+pid+"/comments", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list comments: %d %s", rec.Code, rec.Body.String())
	}
	var list struct {
		Messages []json.RawMessage `json:"messages"`
		Count    int               `json:"count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Messages) != 1 || list.Count != 1 {
		t.Fatalf("list comments = %d msgs / count %d; want 1/1 (%s)", len(list.Messages), list.Count, rec.Body.String())
	}

	// comment_counts?ids={postId} → 1.
	rec = authedReq(t, h, http.MethodGet, "/channels/"+cid+"/comment_counts?ids="+pid, tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("comment_counts: %d %s", rec.Code, rec.Body.String())
	}
	var cc struct {
		Counts map[string]int `json:"counts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &cc)
	if cc.Counts[pid] != 1 {
		t.Fatalf("comment_counts[%s] = %d; want 1 (%s)", pid, cc.Counts[pid], rec.Body.String())
	}
}
