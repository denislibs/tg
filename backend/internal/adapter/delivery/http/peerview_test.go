package http

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// cardResponse — ответ карточки чата: конструктор messages.chatFull В КОРНЕ.
// Обёртки вокруг него нет — `peer_id` был выводим из краткой карточки, а
// `creator_id` не читал никто. Ровно тот же объект уходит кадром chat_update,
// поэтому разбирается он в тестах одним помощником.
type cardResponse struct {
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
}

func decodeCard(t *testing.T, rec *httptest.ResponseRecorder) cardResponse {
	t.Helper()
	var out cardResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("разбор карточки: %v (%s)", err, rec.Body.String())
	}
	if out.Underscore != "messages.chatFull" || len(out.Chats) != 1 {
		t.Fatalf("карточка не messages.chatFull: %s", rec.Body.String())
	}
	return out
}

func (c cardResponse) participants() int      { return c.Chats[0].ParticipantsCount }
func (c cardResponse) title() string          { return c.Chats[0].Title }
func (c cardResponse) chatFlag(f string) bool { return c.Chats[0].PFlags[f] }

// linkedChatID отдаётся знаковым ключом пира: связанная группа это чат.
func (c cardResponse) linkedChatID() int64 {
	if id := c.FullChat.LinkedChatID; id != 0 {
		return -id
	}
	return 0
}
