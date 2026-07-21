package http

import (
	"encoding/json"
	"net/http"
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
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, newContactsUC(pool), NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil)

	tokenA, _ := signInToken(t, h, "+79990000001")
	_, idB := signInToken(t, h, "+79990000002")

	// A adds B with a saved name + note + share-phone.
	rec := reqJSONAuth(t, h, http.MethodPost, "/contacts", map[string]any{
		"contact_id": idB, "first_name": "Maya", "last_name": "K", "note": "friend", "share_phone": true,
	}, tokenA)
	if rec.Code != http.StatusCreated {
		t.Fatalf("add contact: %d %s", rec.Code, rec.Body.String())
	}
	var added map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &added)
	if added["first_name"] != "Maya" || added["note"] != "friend" || added["share_phone"] != true {
		t.Fatalf("unexpected added contact: %v", added)
	}
	if int64(added["user_id"].(float64)) != idB {
		t.Fatalf("user_id = %v, want %d", added["user_id"], idB)
	}

	// A lists — B is present.
	rec = reqJSONAuth(t, h, http.MethodGet, "/contacts", nil, tokenA)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	var list struct {
		Contacts []map[string]any `json:"contacts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Contacts) != 1 || int64(list.Contacts[0]["user_id"].(float64)) != idB {
		t.Fatalf("list = %v, want one contact for B", list.Contacts)
	}

	// Re-adding edits in place (upsert), not duplicates.
	rec = reqJSONAuth(t, h, http.MethodPost, "/contacts", map[string]any{
		"contact_id": idB, "first_name": "Maya2",
	}, tokenA)
	if rec.Code != http.StatusCreated {
		t.Fatalf("re-add: %d %s", rec.Code, rec.Body.String())
	}
	rec = reqJSONAuth(t, h, http.MethodGet, "/contacts", nil, tokenA)
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Contacts) != 1 || list.Contacts[0]["first_name"] != "Maya2" {
		t.Fatalf("after upsert = %v, want one edited contact", list.Contacts)
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
