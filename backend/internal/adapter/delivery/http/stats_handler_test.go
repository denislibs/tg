package http

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasestats "github.com/messenger-denis/backend/internal/usecase/stats"
)

// newStatsRouter builds a router wired with auth, chat, and stats handlers over
// the test DB, so the channel + post-stats endpoints are both available.
func newStatsRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	pool := postgres.NewTestDB(t)
	statsUC := usecasestats.New(pgadapter.NewStatsRepo(pool))
	return NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, statsUC), pool
}

func TestPostStats_HTTP(t *testing.T) {
	h, pool := newStatsRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990004001")
	tokenC, _ := signUp(t, h, pool, "+79990004002") // not a member of the channel

	// A creates a channel and posts a message.
	rec := authedReq(t, h, http.MethodPost, "/channels", tokenA, map[string]any{
		"title": "Stats Chan", "username": "statschan", "is_public": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("create channel: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	cid := itoa(created.ChatID)

	rec = authedReq(t, h, http.MethodPost, "/channels/"+cid+"/messages", tokenA, map[string]any{"text": "post"})
	if rec.Code != http.StatusOK {
		t.Fatalf("post: %d %s", rec.Code, rec.Body.String())
	}
	var post struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &post)
	if post.ID == 0 {
		t.Fatalf("no post id: %s", rec.Body.String())
	}

	// Seed real interactions: view counters, one dedup'd view row, one emoji
	// reaction. Stats are computed on the fly from exactly these rows.
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE messages SET views=5, forwards=2 WHERE id=$1`, post.ID); err != nil {
		t.Fatalf("seed counters: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO message_views (message_id, user_id) VALUES ($1,$2)`, post.ID, idA); err != nil {
		t.Fatalf("seed view: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1,$2,'❤️')`, post.ID, idA); err != nil {
		t.Fatalf("seed reaction: %v", err)
	}

	// Creator reads post stats.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/"+itoa(post.ID)+"/stats", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
	}
	var stats struct {
		Views          int64 `json:"views"`
		Forwards       int64 `json:"forwards"`
		ReactionsTotal int64 `json:"reactions_total"`
		Reactions      []struct {
			Emoji string `json:"emoji"`
			Count int64  `json:"count"`
		} `json:"reactions"`
		ViewsByDay []struct {
			Value int64 `json:"value"`
		} `json:"views_by_day"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &stats)
	if stats.Views != 5 || stats.Forwards != 2 {
		t.Fatalf("overview mismatch: %s", rec.Body.String())
	}
	if stats.ReactionsTotal != 1 || len(stats.Reactions) != 1 || stats.Reactions[0].Emoji != "❤️" {
		t.Fatalf("reactions mismatch: %s", rec.Body.String())
	}
	if len(stats.ViewsByDay) != 1 || stats.ViewsByDay[0].Value != 1 {
		t.Fatalf("views_by_day mismatch: %s", rec.Body.String())
	}

	// Non-member is forbidden.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/"+itoa(post.ID)+"/stats", tokenC, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-member, got %d %s", rec.Code, rec.Body.String())
	}

	// Missing post → 404.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/999999/stats", tokenA, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing post, got %d %s", rec.Code, rec.Body.String())
	}
}
