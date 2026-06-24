package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// fakeStorage is an in-memory ObjectStorage. Presigned helpers return stub URLs;
// PutObject/GetObject back a key->bytes map so content streaming can be tested
// without MinIO.
type fakeStorage struct{ blobs map[string][]byte }

func newFakeStorage() *fakeStorage { return &fakeStorage{blobs: map[string][]byte{}} }

func (*fakeStorage) Bucket() string { return "media" }
func (*fakeStorage) PresignedPut(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/put/" + key, nil
}
func (*fakeStorage) PresignedGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://minio/get/" + key, nil
}
func (f *fakeStorage) PutObject(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	b, _ := io.ReadAll(r)
	f.blobs[key] = b
	return nil
}
func (f *fakeStorage) GetObject(_ context.Context, key string) (io.ReadSeekCloser, usecasemedia.ObjectInfo, error) {
	b, ok := f.blobs[key]
	if !ok {
		return nil, usecasemedia.ObjectInfo{}, domain.ErrNotFound
	}
	return nopSeekCloser{bytes.NewReader(b)}, usecasemedia.ObjectInfo{Size: int64(len(b)), ContentType: "application/octet-stream"}, nil
}

type nopSeekCloser struct{ *bytes.Reader }

func (nopSeekCloser) Close() error { return nil }

// fakeMediaRepo is an in-memory MediaRepo for content-handler unit tests.
type fakeMediaRepo struct{ m domain.Media }

func (f *fakeMediaRepo) Create(_ context.Context, m domain.Media) (domain.Media, error) {
	return m, nil
}
func (f *fakeMediaRepo) GetByID(_ context.Context, id int64) (domain.Media, error) {
	if f.m.ID != id {
		return domain.Media{}, domain.ErrNotFound
	}
	return f.m, nil
}

// fakeAccess answers CanAccessMedia with a fixed verdict.
type fakeAccess struct{ allow bool }

func (f fakeAccess) CanAccessMedia(_ context.Context, _, _ int64) (bool, error) { return f.allow, nil }

// fakeAuth authenticates token "good" to a fixed user, else errors (mirrors WS).
type fakeAuth struct{ userID int64 }

func (f fakeAuth) Authenticate(_ context.Context, token string) (domain.User, int64, error) {
	if token != "good" {
		return domain.User{}, 0, errors.New("invalid token")
	}
	return domain.User{ID: f.userID}, 1, nil
}

func newMediaRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	pool := postgres.NewTestDB(t)
	chatUC := newChatUC(pool)
	authUC := newAuthUC(pool)
	mediaH := NewMediaHandler(usecasemedia.New(pgadapter.NewMediaRepo(pool), newFakeStorage()), chatUC, authUC)
	return NewRouter(authUC, chatUC, nil, mediaH, nil, nil), pool
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

// contentRouter builds a chi router exposing only the two content endpoints over
// fakes — no DB/MinIO — so streaming + auth/access paths are tested in isolation.
func contentRouter(owner, authUser int64, allow bool) (http.Handler, *fakeStorage) {
	st := newFakeStorage()
	repo := &fakeMediaRepo{m: domain.Media{ID: 1, OwnerID: owner, ObjectKey: "k1", Mime: "image/png", Size: 3}}
	_ = st.PutObject(context.Background(), "k1", bytes.NewReader([]byte("abc")), 3, "image/png")
	h := NewMediaHandler(usecasemedia.New(repo, st), fakeAccess{allow: allow}, fakeAuth{userID: authUser})
	r := chi.NewRouter()
	r.Put("/media/{mediaID}/content", h.PutContent)
	r.Get("/media/{mediaID}/content", h.GetContent)
	return r, st
}

func TestGetContent_ValidToken(t *testing.T) {
	r, _ := contentRouter(7, 7, true)
	req := httptest.NewRequest(http.MethodGet, "/media/1/content?token=good", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "abc" {
		t.Fatalf("body = %q, want %q", rec.Body.String(), "abc")
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("content-type = %q, want image/png", ct)
	}
}

func TestGetContent_NoToken(t *testing.T) {
	r, _ := contentRouter(7, 7, true)
	req := httptest.NewRequest(http.MethodGet, "/media/1/content", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestGetContent_AccessDenied(t *testing.T) {
	r, _ := contentRouter(7, 7, false)
	req := httptest.NewRequest(http.MethodGet, "/media/1/content?token=good", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPutContent_NonOwner(t *testing.T) {
	st := newFakeStorage()
	repo := &fakeMediaRepo{m: domain.Media{ID: 1, OwnerID: 7, ObjectKey: "k1", Mime: "image/png", Size: 3}}
	h := NewMediaHandler(usecasemedia.New(repo, st), fakeAccess{allow: true}, fakeAuth{userID: 99})
	r := chi.NewRouter()
	r.Put("/media/{mediaID}/content", h.PutContent)

	// Inject a non-owner (id 99) into the context as the Bearer middleware would.
	req := httptest.NewRequest(http.MethodPut, "/media/1/content", bytes.NewReader([]byte("xyz")))
	req = req.WithContext(context.WithValue(req.Context(), userKey, domain.User{ID: 99}))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (%s)", rec.Code, rec.Body.String())
	}
}
