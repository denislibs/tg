package http

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger-denis/backend/internal/auth"
	"github.com/messenger-denis/backend/internal/media"
	"github.com/messenger-denis/backend/internal/messaging"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

type fakeStorage struct{}

func (fakeStorage) Bucket() string { return "media" }
func (fakeStorage) PresignedPut(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/put/" + key, nil
}
func (fakeStorage) PresignedGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/get/" + key, nil
}

func newMediaRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	pool := postgres.NewTestDB(t)
	authSvc := auth.NewService(auth.NewRepo(pool), "12345", func(string, ...any) {})
	chatSvc := messaging.NewService(pool)
	mediaH := NewMediaHandler(media.NewService(media.NewRepo(pool), fakeStorage{}), chatSvc)
	return NewRouter(authSvc, chatSvc, nil, mediaH, nil), pool
}

func TestMedia_UploadAndGet_HTTP(t *testing.T) {
	h, pool := newMediaRouter(t)
	token, _ := signUp(t, h, pool, "+79990000030")

	rec := authedReq(t, h, http.MethodPost, "/media/upload", token, map[string]any{
		"mime": "image/jpeg", "size": 2048, "width": 100, "height": 100,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		MediaID   int64  `json:"media_id"`
		UploadURL string `json:"upload_url"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.MediaID == 0 || created.UploadURL == "" {
		t.Fatalf("bad upload response: %s", rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodGet, "/media/"+itoa(created.MediaID), token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: %d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		DownloadURL string `json:"download_url"`
		Mime        string `json:"mime"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.DownloadURL == "" || got.Mime != "image/jpeg" {
		t.Fatalf("bad get response: %s", rec.Body.String())
	}
}

func TestMedia_AccessControl_HTTP(t *testing.T) {
	h, pool := newMediaRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000040")
	tokenB, idB := signUp(t, h, pool, "+79990000041")

	// A uploads media.
	rec := authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	mid := itoa(created.MediaID)

	// B, sharing no chat with A, cannot resolve A's media → 404.
	rec = authedReq(t, h, http.MethodGet, "/media/"+mid, tokenB, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unrelated user, got %d", rec.Code)
	}

	// A creates a chat with B and sends the media; now B can resolve it.
	rec = authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	var chat struct {
		ChatID int64 `json:"chat_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &chat)
	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(chat.ChatID)+"/messages", tokenA,
		map[string]any{"type": "photo", "media_id": created.MediaID})
	if rec.Code != http.StatusOK {
		t.Fatalf("send with media: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/media/"+mid, tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected B to access shared media, got %d %s", rec.Code, rec.Body.String())
	}
}
