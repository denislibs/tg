package http

import (
	"encoding/json"
	"net/http"
	"testing"
)

// f6-pin: POST/DELETE …/pin принимает {silent, pm_oneside} и отвечает Updates
// (updatePinnedMessages), DELETE /chats/{p}/pins — messages.affectedHistory,
// GET /pins — закрепы глазами зрителя (общие + его «только у себя»).
func TestPinFlags_UpdatesAndUnpinAll_HTTP(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990000270")
	tokenB, idB := signUp(t, h, pool, "+79990000271")

	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	peerA := itoa(createdPeerFrom(t, rec)) // путь Алисы (собеседник — Боб)
	peerB := itoa(idA)                     // путь Боба (собеседник — Алиса)
	var seqs []int64
	for _, text := range []string{"раз", "два"} {
		rec := authedReq(t, h, http.MethodPost, "/chats/"+peerA+"/messages", tokenA, map[string]any{"text": text})
		if rec.Code != http.StatusOK {
			t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
		}
		var m struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &m)
		seqs = append(seqs, m.ID)
	}

	type updates struct {
		Underscore string `json:"_"`
		Updates    []struct {
			Underscore string          `json:"_"`
			PFlags     map[string]bool `json:"pFlags"`
			Messages   []int64         `json:"messages"`
			Pts        int64           `json:"pts"`
			PtsCount   int             `json:"pts_count"`
		} `json:"updates"`
	}
	pins := func(token, peer string) int {
		t.Helper()
		rec := authedReq(t, h, http.MethodGet, "/chats/"+peer+"/pins", token, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET pins: %d %s", rec.Code, rec.Body.String())
		}
		var out struct {
			Messages []json.RawMessage `json:"messages"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return len(out.Messages)
	}

	// Боб закрепляет «только у себя»: ответ Updates, у Алисы закрепа нет.
	rec = authedReq(t, h, http.MethodPost, "/chats/"+peerB+"/messages/"+itoa(seqs[0])+"/pin", tokenB,
		map[string]any{"pm_oneside": true, "silent": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("pin oneside: %d %s", rec.Code, rec.Body.String())
	}
	var up updates
	if err := json.Unmarshal(rec.Body.Bytes(), &up); err != nil {
		t.Fatalf("decode updates: %v", err)
	}
	if up.Underscore != "updates" || len(up.Updates) != 1 || up.Updates[0].Underscore != "updatePinnedMessages" ||
		!up.Updates[0].PFlags["pinned"] || len(up.Updates[0].Messages) != 1 || up.Updates[0].Messages[0] != seqs[0] ||
		up.Updates[0].Pts <= 0 || up.Updates[0].PtsCount != 1 {
		t.Fatalf("ответ pin: %s", rec.Body.String())
	}
	if pins(tokenA, peerA) != 0 || pins(tokenB, peerB) != 1 {
		t.Fatalf("закрепы: Алиса %d (want 0), Боб %d (want 1)", pins(tokenA, peerA), pins(tokenB, peerB))
	}

	// Алиса закрепляет общий (без тела) и снимает: ответ без pinned.
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+peerA+"/messages/"+itoa(seqs[1])+"/pin", tokenA, nil); rec.Code != http.StatusOK {
		t.Fatalf("pin shared: %d %s", rec.Code, rec.Body.String())
	}
	if pins(tokenB, peerB) != 2 {
		t.Fatalf("у Боба общий + свой: %d, want 2", pins(tokenB, peerB))
	}

	// «Открепить все» Бобом: affectedHistory, закрепов не осталось у обоих.
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+peerB+"/pins", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE pins: %d %s", rec.Code, rec.Body.String())
	}
	var aff struct {
		Underscore string `json:"_"`
		Pts        int64  `json:"pts"`
		PtsCount   int    `json:"pts_count"`
		Offset     *int   `json:"offset"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &aff); err != nil {
		t.Fatalf("decode affected: %v", err)
	}
	if aff.Underscore != "messages.affectedHistory" || aff.Pts <= 0 || aff.PtsCount != 1 || aff.Offset == nil || *aff.Offset != 0 {
		t.Fatalf("ответ unpinAll: %s", rec.Body.String())
	}
	if pins(tokenA, peerA) != 0 || pins(tokenB, peerB) != 0 {
		t.Fatalf("после «открепить все»: Алиса %d, Боб %d", pins(tokenA, peerA), pins(tokenB, peerB))
	}
	// Повтор — pts_count 0.
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+peerB+"/pins", tokenB, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &aff)
	if rec.Code != http.StatusOK || aff.PtsCount != 0 {
		t.Fatalf("повтор unpinAll: %d %s", rec.Code, rec.Body.String())
	}

	// Снятие: Updates без pinned.
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+peerA+"/messages/"+itoa(seqs[1])+"/pin", tokenA, nil); rec.Code != http.StatusOK {
		t.Fatalf("pin: %d", rec.Code)
	}
	rec = authedReq(t, h, http.MethodDelete, "/chats/"+peerA+"/messages/"+itoa(seqs[1])+"/pin", tokenA, nil)
	up = updates{}
	if err := json.Unmarshal(rec.Body.Bytes(), &up); err != nil || rec.Code != http.StatusOK ||
		len(up.Updates) != 1 || up.Updates[0].PFlags["pinned"] {
		t.Fatalf("ответ unpin: %d %s", rec.Code, rec.Body.String())
	}

	// Чужой пользователь: чата с этим собеседником у него нет — 404.
	tokenC, _ := signUp(t, h, pool, "+79990000272")
	if rec := authedReq(t, h, http.MethodDelete, "/chats/"+peerA+"/pins", tokenC, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unpinAll чужим: %d, want 404", rec.Code)
	}
}
