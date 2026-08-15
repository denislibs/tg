package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeReactions struct{ list []domain.AvailableReaction }

func (f *fakeReactions) List(context.Context) ([]domain.AvailableReaction, error) {
	return f.list, nil
}

// fakeReactionsErr — репозиторий, падающий на List (например, БД недоступна).
type fakeReactionsErr struct{}

func (fakeReactionsErr) List(context.Context) ([]domain.AvailableReaction, error) {
	return nil, errors.New("db down")
}

func TestReactionsList(t *testing.T) {
	h := NewReactionsHandler(&fakeReactions{list: []domain.AvailableReaction{
		{Emoji: "❤", Title: "Red Heart", Position: 1, CenterMediaID: 7},
		{Emoji: "👍", Title: "Thumbs Up", Position: 2},
	}})

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/reactions", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("код %d, ожидался 200", rec.Code)
	}
	var body struct {
		Reactions []domain.AvailableReaction `json:"reactions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Reactions) != 2 || body.Reactions[0].Emoji != "❤" {
		t.Fatalf("выдача %+v", body.Reactions)
	}
	if body.Reactions[0].CenterMediaID != 7 {
		t.Errorf("center_media_id = %d, ожидался 7", body.Reactions[0].CenterMediaID)
	}
}

// Пустой список должен приезжать как [], иначе клиент получает null и падает
// на .map — тот же контракт, что у StickersHandler.Featured.
func TestReactionsListEmpty(t *testing.T) {
	h := NewReactionsHandler(&fakeReactions{})
	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/reactions", nil))

	if got := rec.Body.String(); got != `{"reactions":[]}`+"\n" {
		t.Errorf("тело %q", got)
	}
}

// Ошибка репозитория (например, БД недоступна) не должна утекать наружу
// сырым текстом — 500 с обобщённым сообщением, как у остальных хендлеров.
func TestReactionsListError(t *testing.T) {
	h := NewReactionsHandler(fakeReactionsErr{})
	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/reactions", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("код %d, ожидался 500", rec.Code)
	}
}
