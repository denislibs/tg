package ws

import (
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Б-9: отказ входа в видеочат — кадр одному соединению, форма как у клиента
// (core/calls/groupCallEngine.ts::handleGroupCallFrame).
func TestGroupCallRejectedFrame(t *testing.T) {
	var f struct {
		T string `json:"t"`
		D struct {
			PeerID       int64   `json:"peer_id"`
			UserID       int64   `json:"user_id"`
			Action       string  `json:"action"`
			Participants []int64 `json:"participants"`
		} `json:"d"`
	}
	raw := groupCallRejectedFrame(domain.PeerID(-1001), 8)
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if f.T != "group_call_update" || f.D.PeerID != -1001 || f.D.UserID != 8 || f.D.Action != "rejected" {
		t.Fatalf("кадр отказа = %s", raw)
	}
	if f.D.Participants != nil {
		t.Fatalf("в отказе есть participants (клиент затёр бы список идущего звонка): %s", raw)
	}
}
