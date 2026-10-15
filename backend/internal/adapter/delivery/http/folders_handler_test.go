package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasefolders "github.com/messenger-denis/backend/internal/usecase/folders"
)

// Ф7-З: POST /me/folders/order и all_chats_pos в GET /me/folders.
func TestFoldersOrder_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := pgadapter.NewFoldersRepo(pool)
	foldersUC := usecasefolders.New(repo, nil, pgadapter.NewTxManager(pool))
	foldersUC.SetUpdateLog(pgadapter.NewUpdatesRepo(pool))
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, foldersUC, nil, nil, nil, nil, nil, nil, nil, nil, nil, true)

	tokenA, _ := signInToken(t, h, "+79990000001")
	tokenB, _ := signInToken(t, h, "+79990000002")

	create := func(token, title string) int64 {
		t.Helper()
		rec := reqJSONAuth(t, h, http.MethodPost, "/me/folders", map[string]any{"title": title, "groups": true}, token)
		if rec.Code != http.StatusOK {
			t.Fatalf("create %s: %d %s", title, rec.Code, rec.Body.String())
		}
		var f struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &f)
		return f.ID
	}
	list := func(token string) (ids []int64, allPos int) {
		t.Helper()
		rec := reqJSONAuth(t, h, http.MethodGet, "/me/folders", nil, token)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		var r struct {
			Folders []struct {
				ID int64 `json:"id"`
			} `json:"folders"`
			AllChatsPos *int `json:"all_chats_pos"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
			t.Fatal(err)
		}
		if r.AllChatsPos == nil {
			t.Fatalf("нет all_chats_pos: %s", rec.Body.String())
		}
		for _, f := range r.Folders {
			ids = append(ids, f.ID)
		}
		return ids, *r.AllChatsPos
	}

	a1, a2 := create(tokenA, "one"), create(tokenA, "two")
	foreign := create(tokenB, "foreign")

	if ids, pos := list(tokenA); len(ids) != 2 || ids[0] != a1 || pos != 0 {
		t.Fatalf("исходный список = %v, all_chats_pos = %d", ids, pos)
	}

	// {"order":[2,1]} → boolTrue, порядок и место «Все чаты» (индекс 0 в order).
	rec := reqJSONAuth(t, h, http.MethodPost, "/me/folders/order", map[string]any{"order": []int64{a2, 0, a1}}, tokenA)
	if rec.Code != http.StatusOK {
		t.Fatalf("order: %d %s", rec.Code, rec.Body.String())
	}
	var b struct {
		Underscore string `json:"_"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &b)
	if b.Underscore != "boolTrue" {
		t.Fatalf("ответ = %s; want boolTrue", rec.Body.String())
	}
	if ids, pos := list(tokenA); len(ids) != 2 || ids[0] != a2 || ids[1] != a1 || pos != 1 {
		t.Fatalf("список после перестановки = %v, all_chats_pos = %d; want [%d %d], 1", ids, pos, a2, a1)
	}

	// Чужая, несуществующая, повтор → 400 invalid order; порядок не тронут.
	for name, order := range map[string][]int64{
		"чужая":          {foreign},
		"несуществующая": {999999},
		"повтор":         {a1, a1},
	} {
		rec := reqJSONAuth(t, h, http.MethodPost, "/me/folders/order", map[string]any{"order": order}, tokenA)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d %s; want 400", name, rec.Code, rec.Body.String())
		}
	}
	if ids, _ := list(tokenA); ids[0] != a2 || ids[1] != a1 {
		t.Fatalf("порядок изменился при отказе: %v", ids)
	}
	// Пустое тело и пустой order — ничего не делают (без записи в журнал).
	for _, body := range []any{map[string]any{}, map[string]any{"order": []int64{}}} {
		if rec := reqJSONAuth(t, h, http.MethodPost, "/me/folders/order", body, tokenA); rec.Code != http.StatusOK {
			t.Fatalf("пустой order: %d %s", rec.Code, rec.Body.String())
		}
	}
	if ids, _ := list(tokenA); ids[0] != a2 || ids[1] != a1 {
		t.Fatalf("порядок изменился от пустого order: %v", ids)
	}
	if rec := reqJSONAuth(t, h, http.MethodPost, "/me/folders/order", map[string]any{"order": []int64{a1}}, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("без токена: %d; want 401", rec.Code)
	}
}

// Ошибки ручек папок и ссылок на папки — ИМЕНА отказов tweb (`ApiError.type`),
// а не текст Go: клиент ветвится по `error.text` (editFolder.tsx:480, :690-696,
// sharedFolderInvite.tsx:212, internalLinkProcessor.ts:1437).
func TestFoldersMapErr_TwebCodes(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		text   string
	}{
		{"нечем делиться", usecasefolders.ErrNoShareable, http.StatusBadRequest, "PEERS_LIST_EMPTY"},
		{"папок слишком много", usecasefolders.ErrTooMany, http.StatusBadRequest, "DIALOG_FILTERS_TOO_MUCH"},
		{"ссылка недействительна", usecasefolders.ErrInviteSlugExpired, http.StatusBadRequest, "INVITE_SLUG_EXPIRED"},
		{"не найдено", domain.ErrNotFound, http.StatusNotFound, "not found"},
	}
	h := &FoldersHandler{}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.mapErr(rec, c.err)
			if rec.Code != c.status {
				t.Fatalf("status = %d, want %d", rec.Code, c.status)
			}
			var body domain.Error
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Text != c.text {
				t.Fatalf("text = %q, want %q", body.Text, c.text)
			}
		})
	}
	// Обёрнутая ошибка тоже узнаётся (errors.Is, а не ==).
	rec := httptest.NewRecorder()
	h.mapErr(rec, errors.Join(errors.New("ctx"), usecasefolders.ErrNoShareable))
	var wrapped domain.Error
	_ = json.Unmarshal(rec.Body.Bytes(), &wrapped)
	if rec.Code != http.StatusBadRequest || wrapped.Text != "PEERS_LIST_EMPTY" {
		t.Fatalf("обёрнутая: status = %d, text = %q", rec.Code, wrapped.Text)
	}
}

// Маршрут целиком: неизвестный slug у предпросмотра и вступления — 400
// INVITE_SLUG_EXPIRED (было 404 not found).
func TestFolderInviteUnknownSlug_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	repo := pgadapter.NewFoldersRepo(pool)
	foldersUC := usecasefolders.New(repo, nil, pgadapter.NewTxManager(pool))
	h := NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, foldersUC, nil, nil, nil, nil, nil, nil, nil, nil, nil, true)
	token, _ := signInToken(t, h, "+79990000001")

	for name, rec := range map[string]*httptest.ResponseRecorder{
		"preview": reqJSONAuth(t, h, http.MethodGet, "/folder_invites/nope", nil, token),
		"join":    reqJSONAuth(t, h, http.MethodPost, "/folder_invites/nope/join", map[string]any{}, token),
	} {
		var body domain.Error
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if rec.Code != http.StatusBadRequest || body.Text != "INVITE_SLUG_EXPIRED" {
			t.Fatalf("%s: %d %s; want 400 INVITE_SLUG_EXPIRED", name, rec.Code, rec.Body.String())
		}
	}
}
