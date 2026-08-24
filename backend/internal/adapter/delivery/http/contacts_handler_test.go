package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasecontacts "github.com/messenger-denis/backend/internal/usecase/contacts"
)

// newContactsUC builds the contacts usecase from the postgres adapter for tests.
func newContactsUC(pool *pgxpool.Pool) *usecasecontacts.Interactor {
	return usecasecontacts.New(pgadapter.NewContactsRepo(pool))
}

func TestContactsEndpoints_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, newContactsUC(pool), NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	tokenA, _ := signInToken(t, h, "+79990000001")
	_, idB := signInToken(t, h, "+79990000002")

	// A adds B with a saved name + note + share-phone.
	rec := reqJSONAuth(t, h, http.MethodPost, "/contacts", map[string]any{
		"contact_id": idB, "first_name": "Maya", "last_name": "K", "note": "friend", "share_phone": true,
	}, tokenA)
	if rec.Code != http.StatusCreated {
		t.Fatalf("add contact: %d %s", rec.Code, rec.Body.String())
	}
	// Запись адресной книги: НАША часть плоско, сам пир — конструктором `user`
	// с именем, под которым его сохранил владелец.
	added := decodeBook(t, rec)
	if len(added.Contacts) != 1 || added.Contacts[0].UserID != idB {
		t.Fatalf("строка книги = %s", rec.Body.String())
	}
	// Карточка приезжает ВЕКТОРОМ, а не внутри строки. Заметка и «делиться
	// номером» у конструктора места не имеют — они названы задачей.
	if len(added.Users) != 1 || added.Users[0]["_"] != "user" ||
		added.Users[0]["first_name"] != "Maya" || added.Users[0]["last_name"] != "K" {
		t.Fatalf("карточка контакта = %s", rec.Body.String())
	}

	// A lists — B is present.
	rec = reqJSONAuth(t, h, http.MethodGet, "/contacts", nil, tokenA)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	list := decodeBook(t, rec)
	if len(list.Contacts) != 1 || list.Contacts[0].UserID != idB {
		t.Fatalf("list = %s, want one contact for B", rec.Body.String())
	}

	// Re-adding edits in place (upsert), not duplicates.
	rec = reqJSONAuth(t, h, http.MethodPost, "/contacts", map[string]any{
		"contact_id": idB, "first_name": "Maya2",
	}, tokenA)
	if rec.Code != http.StatusCreated {
		t.Fatalf("re-add: %d %s", rec.Code, rec.Body.String())
	}
	rec = reqJSONAuth(t, h, http.MethodGet, "/contacts", nil, tokenA)
	list = decodeBook(t, rec)
	// Имя карточки — сохранённое ВЛАДЕЛЬЦЕМ, и живёт оно в векторе `users`.
	if len(list.Contacts) != 1 || len(list.Users) != 1 || list.Users[0]["first_name"] != "Maya2" {
		t.Fatalf("after upsert = %s, want one edited contact", rec.Body.String())
	}

	// Missing first name → 400.
	rec = reqJSONAuth(t, h, http.MethodPost, "/contacts", map[string]any{
		"contact_id": idB, "first_name": "  ",
	}, tokenA)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty name: %d, want 400", rec.Code)
	}

	// Adding self → 400.
	_, idA := signInToken(t, h, "+79990000001")
	rec = reqJSONAuth(t, h, http.MethodPost, "/contacts", map[string]any{
		"contact_id": idA, "first_name": "Me",
	}, tokenA)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("self contact: %d, want 400", rec.Code)
	}

	// Delete B → ok, list empty.
	rec = reqJSONAuth(t, h, http.MethodDelete, "/contacts/"+itoa(idB), nil, tokenA)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	rec = reqJSONAuth(t, h, http.MethodGet, "/contacts", nil, tokenA)
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Contacts) != 0 {
		t.Fatalf("after delete = %v, want empty", list.Contacts)
	}

	// Deleting again → 404.
	rec = reqJSONAuth(t, h, http.MethodDelete, "/contacts/"+itoa(idB), nil, tokenA)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("delete missing: %d, want 404", rec.Code)
	}
}

// contactBook — адресная книга контейнером `contacts.contacts`: СТРОКИ это
// ссылки (`contact{user_id, mutual}`), а карточки едут вектором `users`.
// Прежде карточка была вклеена в каждую строку рядом со ссылкой.
type contactBook struct {
	Contacts []struct {
		Underscore string `json:"_"`
		UserID     int64  `json:"user_id"`
	} `json:"contacts"`
	Users []map[string]any `json:"users"`
}

func decodeBook(t *testing.T, rec *httptest.ResponseRecorder) contactBook {
	t.Helper()
	var out contactBook
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("разбор книги: %v (%s)", err, rec.Body.String())
	}
	return out
}
