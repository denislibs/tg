package http

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
)

// newStoryRouter builds a router wired with auth, chat, media, and story
// handlers over the test DB (media uses an in-memory storage so uploads work
// without MinIO).
func newStoryRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	pool := postgres.NewTestDB(t)
	chatUC := newChatUC(pool)
	authUC := newAuthUC(pool)
	mediaH := NewMediaHandler(usecasemedia.New(pgadapter.NewMediaRepo(pool), newFakeStorage(), nil), chatUC, authUC, "test-secret")
	storySvc := storyusecase.New(
		pgadapter.NewStoryRepo(pool),
		chatUC,
		pgadapter.NewMediaAccessRepo(pool),
		pgadapter.NewTxManager(pool),
	)
	storyH := NewStoryHandler(storySvc)
	return NewRouter(authUC, chatUC, nil, mediaH, nil, nil, storyH, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil), pool
}

func TestStories_Flow_HTTP(t *testing.T) {
	h, pool := newStoryRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000060")
	tokenB, idB := signUp(t, h, pool, "+79990000061")

	// A uploads a media object they own.
	rec := authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.MediaID == 0 {
		t.Fatalf("no media id: %s", rec.Body.String())
	}

	// A↔B private chat so B is a contact (partner) of A.
	rec = authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}

	// A posts a story.
	rec = authedReq(t, h, http.MethodPost, "/stories", tokenA, map[string]any{
		"media_id": created.MediaID, "caption": "hi", "privacy": "contacts",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post story: %d %s", rec.Code, rec.Body.String())
	}
	var posted struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &posted)
	if posted.ID == 0 {
		t.Fatalf("no story id: %s", rec.Body.String())
	}

	// B's feed shows A's story group with viewed=false.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("feed: %d %s", rec.Code, rec.Body.String())
	}
	var feed struct {
		Groups []struct {
			Author struct {
				ID int64 `json:"id"`
			} `json:"author"`
			Stories []struct {
				ID     int64 `json:"id"`
				Viewed bool  `json:"viewed"`
			} `json:"stories"`
		} `json:"groups"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &feed)
	if len(feed.Groups) != 1 || len(feed.Groups[0].Stories) != 1 {
		t.Fatalf("expected 1 group/1 story, got %s", rec.Body.String())
	}
	if feed.Groups[0].Stories[0].ID != posted.ID || feed.Groups[0].Stories[0].Viewed {
		t.Fatalf("unexpected feed: %s", rec.Body.String())
	}

	// B views the story.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(posted.ID)+"/view", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("view: %d %s", rec.Code, rec.Body.String())
	}

	// A (author) sees B in the viewers list.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(posted.ID)+"/viewers", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("viewers: %d %s", rec.Code, rec.Body.String())
	}
	var viewers struct {
		Viewers []struct {
			ID int64 `json:"id"`
		} `json:"viewers"`
		Count int `json:"count"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &viewers)
	if viewers.Count != 1 || len(viewers.Viewers) != 1 || viewers.Viewers[0].ID != idB {
		t.Fatalf("expected viewers=[B], got %s", rec.Body.String())
	}

	// B (non-author) is forbidden from the viewers list.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(posted.ID)+"/viewers", tokenB, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-author viewers, got %d %s", rec.Code, rec.Body.String())
	}

	// A deletes the story; it disappears from B's feed.
	rec = authedReq(t, h, http.MethodDelete, "/stories/"+itoa(posted.ID), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &feed)
	if len(feed.Groups) != 0 {
		t.Fatalf("expected empty feed after delete, got %s", rec.Body.String())
	}
}
