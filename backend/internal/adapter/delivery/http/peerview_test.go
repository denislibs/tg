package http

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// cardResponse — ответ карточки чата: конструктор messages.chatFull плюс наши
// поля рядом с ним. Ровно тот же объект уходит кадром chat_update, поэтому
// разбирается он в тестах одним помощником.
type cardResponse struct {
	PeerID    int64 `json:"peer_id"`
	Muted     bool  `json:"muted"`
	CreatorID int64 `json:"creator_id"`
	ChatFull  struct {
		Underscore string `json:"_"`
		FullChat   struct {
			Underscore   string          `json:"_"`
			About        string          `json:"about"`
			LinkedChatID int64           `json:"linked_chat_id"`
			PinnedMsgID  int64           `json:"pinned_msg_id"`
			PFlags       map[string]bool `json:"pFlags"`
		} `json:"full_chat"`
		Chats []struct {
			Underscore        string          `json:"_"`
			ID                int64           `json:"id"`
			Title             string          `json:"title"`
			Username          string          `json:"username"`
			ParticipantsCount int             `json:"participants_count"`
			PFlags            map[string]bool `json:"pFlags"`
		} `json:"chats"`
	} `json:"chat_full"`
}

func decodeCard(t *testing.T, rec *httptest.ResponseRecorder) cardResponse {
	t.Helper()
	var out cardResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("разбор карточки: %v (%s)", err, rec.Body.String())
	}
	if out.ChatFull.Underscore != "messages.chatFull" || len(out.ChatFull.Chats) != 1 {
		t.Fatalf("карточка не messages.chatFull: %s", rec.Body.String())
	}
	return out
}

func (c cardResponse) participants() int      { return c.ChatFull.Chats[0].ParticipantsCount }
func (c cardResponse) title() string          { return c.ChatFull.Chats[0].Title }
func (c cardResponse) chatFlag(f string) bool { return c.ChatFull.Chats[0].PFlags[f] }

// linkedChatID отдаётся знаковым ключом пира: связанная группа это чат.
func (c cardResponse) linkedChatID() int64 {
	if id := c.ChatFull.FullChat.LinkedChatID; id != 0 {
		return -id
	}
	return 0
}
