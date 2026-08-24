package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// «Избранное» в разрезе источников — контейнер `messages.savedDialogs`.
// Строка несёт ССЫЛКИ (`peer`, `top_message`); заголовок и аватарка источника,
// прежде подклеенные JOIN-ами прямо в строку, едут карточками в `chats`/
// `users`, а последнее сообщение — вектором `messages`.

func TestSavedDialogs_ContainerCarriesReferences(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990090001")
	tokenB, idB := signUp(t, h, pool, "+79990090002")

	// B пишет A, A пересылает это себе — источником становится B.
	rec := authedReq(t, h, http.MethodPost, "/chats", tokenB, map[string]int64{"user_id": idA})
	if rec.Code != http.StatusOK {
		t.Fatalf("создание чата: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		PeerID int64 `json:"peer_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	fromB := itoa(created.PeerID)
	rec = authedReq(t, h, http.MethodPost, "/chats/"+fromB+"/messages", tokenB,
		map[string]any{"text": "исходник", "client_msg_id": "s1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("сообщение B: %d %s", rec.Code, rec.Body.String())
	}
	var sent struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)

	// «Избранное» A — приватный чат с самим собой.
	rec = authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idA})
	if rec.Code != http.StatusOK {
		t.Fatalf("создание Избранного: %d %s", rec.Code, rec.Body.String())
	}
	created = struct {
		PeerID int64 `json:"peer_id"`
	}{}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	saved := itoa(created.PeerID)
	rec = authedReq(t, h, http.MethodPost, "/chats/"+saved+"/forward", tokenA, map[string]any{
		"from_peer_id": idB, "ids": []int64{sent.ID},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("пересылка в Избранное: %d %s", rec.Code, rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodGet, "/saved/dialogs", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("Избранное: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Underscore string `json:"_"`
		Dialogs    []struct {
			Underscore string `json:"_"`
			Peer       struct {
				Underscore string `json:"_"`
				UserID     int64  `json:"user_id"`
			} `json:"peer"`
			TopMessage int64 `json:"top_message"`
		} `json:"dialogs"`
		Messages []struct {
			ID      int64  `json:"id"`
			Message string `json:"message"`
		} `json:"messages"`
		Chats []map[string]any `json:"chats"`
		Users []struct {
			ID int64 `json:"id"`
		} `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("Избранное не разбирается: %v (%s)", err, rec.Body.String())
	}
	if out.Underscore != "messages.savedDialogs" || len(out.Dialogs) != 1 {
		t.Fatalf("контейнер = %s", rec.Body.String())
	}
	row := out.Dialogs[0]
	if row.Underscore != "savedDialog" || row.Peer.UserID != idB {
		t.Fatalf("строка = %s", rec.Body.String())
	}
	// Само сообщение приезжает вектором и адресуется числом строки.
	var found bool
	for _, m := range out.Messages {
		if m.ID == row.TopMessage {
			found = true
			if m.Message != "исходник" {
				t.Fatalf("сообщение источника = %s", rec.Body.String())
			}
		}
	}
	if !found {
		t.Fatalf("сообщение не доехало вектором: %s", rec.Body.String())
	}
	// Карточка источника — вектором `users`, а не снимком в строке.
	var card bool
	for _, u := range out.Users {
		if u.ID == idB {
			card = true
		}
	}
	if !card {
		t.Fatalf("карточка источника не доехала вектором: %s", rec.Body.String())
	}
	if out.Chats == nil {
		t.Fatalf("вектор chats пропал: %s", rec.Body.String())
	}
	// Снимков в строке не осталось.
	for _, dead := range []string{`"kind"`, `"title"`, `"photo_id"`, `"count"`, `"last_message"`} {
		if strings.Contains(rec.Body.String(), dead) {
			t.Fatalf("снимок %s остался на проводе: %s", dead, rec.Body.String())
		}
	}
}
