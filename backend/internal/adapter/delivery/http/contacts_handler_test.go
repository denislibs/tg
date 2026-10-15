package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasecontacts "github.com/messenger-denis/backend/internal/usecase/contacts"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
)

// newContactsUC builds the contacts usecase from the postgres adapter for tests.
func newContactsUC(pool *pgxpool.Pool) *usecasecontacts.Interactor {
	return usecasecontacts.New(pgadapter.NewContactsRepo(pool))
}

func TestContactsEndpoints_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, newContactsUC(pool), NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, true)

	tokenA, _ := signInToken(t, h, "+79990000001")
	_, idB := signInToken(t, h, "+79990000002")

	// A adds B with a saved name + note + share-phone.
	rec := reqJSONAuth(t, h, http.MethodPost, "/contacts", map[string]any{
		"contact_id": idB, "first_name": "Maya", "last_name": "K", "note": textWithEntities("friend"), "share_phone": true,
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

// onlineNow — присутствие для теста: все «в сети».
type onlineNow struct{}

func (onlineNow) Status(context.Context, int64) (bool, time.Time, time.Time) {
	return true, time.Now().Add(time.Minute), time.Now()
}

func (onlineNow) Statuses(_ context.Context, ids []int64) map[int64]domain.UserStatus {
	out := make(map[int64]domain.UserStatus, len(ids))
	for _, id := range ids {
		out[id] = domain.NewUserStatusOnline(time.Now().Add(time.Minute))
	}
	return out
}

// P0 №2: карточки GET /contacts и ответа добавления несут `status`. Клиент
// заменяет карточку в кэше целиком; без поля «Добавить участников» показывало
// «был(а) давно» у контакта, который в сети.
func TestContactsCards_CarryStatus_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	privacyUC := usecaseprivacy.New(pgadapter.NewPrivacyRepo(pool))
	privacyUC.SetPresence(onlineNow{})
	contactsUC := newContactsUC(pool)
	contactsUC.SetPrivacy(privacyUC)
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, contactsUC, NewICEHandler("", "test"), nil, nil, nil, privacyUC, nil, nil, nil, nil, nil, nil, nil)

	tokenA, idA := signInToken(t, h, "+79990000011")
	tokenB, idB := signInToken(t, h, "+79990000012")
	statusOf := func(rec *httptest.ResponseRecorder) string {
		t.Helper()
		book := decodeBook(t, rec)
		if len(book.Users) != 1 {
			t.Fatalf("карточек = %d: %s", len(book.Users), rec.Body.String())
		}
		st, _ := book.Users[0]["status"].(map[string]any)
		tag, _ := st["_"].(string)
		return tag
	}

	rec := reqJSONAuth(t, h, http.MethodPost, "/contacts", map[string]any{"contact_id": idB, "first_name": "Егор"}, tokenA)
	if rec.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}
	if got := statusOf(rec); got != "userStatusOnline" {
		t.Fatalf("ответ добавления: статус %q; want userStatusOnline", got)
	}
	rec = reqJSONAuth(t, h, http.MethodGet, "/contacts", nil, tokenA)
	if got := statusOf(rec); got != "userStatusOnline" {
		t.Fatalf("GET /contacts: статус %q; want userStatusOnline (%s)", got, rec.Body.String())
	}

	// Контакт скрыл время захода и заблокировал зрителя: статус — «давно».
	if rec := reqJSONAuth(t, h, http.MethodPut, "/me/privacy/privacyKeyStatusTimestamp", map[string]any{
		"rules": []map[string]any{{"_": "privacyValueDisallowAll"}},
	}, tokenB); rec.Code != http.StatusOK {
		t.Fatalf("last_seen: %d %s", rec.Code, rec.Body.String())
	}
	if got := statusOf(reqJSONAuth(t, h, http.MethodGet, "/contacts", nil, tokenA)); got != "userStatusRecently" {
		t.Fatalf("скрыто правилом: %q; want userStatusRecently", got)
	}
	if rec := reqJSONAuth(t, h, http.MethodPost, "/me/blocked", map[string]any{"user_id": idA}, tokenB); rec.Code != http.StatusOK {
		t.Fatalf("block: %d %s", rec.Code, rec.Body.String())
	}
	if got := statusOf(reqJSONAuth(t, h, http.MethodGet, "/contacts", nil, tokenA)); got != "userStatusEmpty" {
		t.Fatalf("заблокировал: %q; want userStatusEmpty", got)
	}
}
