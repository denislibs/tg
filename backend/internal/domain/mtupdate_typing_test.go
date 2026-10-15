package domain

import (
	"encoding/json"
	"testing"
)

// top_msg_id у печати — только когда она в треде/теме (flags.0?int): вне треда
// поля нет, у General форума оно 1.
func TestUpdateTyping_TopMsgIDOptional(t *testing.T) {
	act := SendMessageActionByTag(SendMessageTypingActionTag)
	from := NewPeerUser(7)
	cases := []struct {
		name string
		u    any
		want float64 // 0 — ключа нет
	}{
		{"группа вне треда", NewUpdateChannelUserTyping(5, 0, from, act), 0},
		{"тема", NewUpdateChannelUserTyping(5, 12, from, act), 12},
		{"General", NewUpdateChannelUserTyping(5, GeneralTopicID, from, act), 1},
		{"личка вне треда", NewUpdateUserTyping(7, 0, act), 0},
		{"личка в треде", NewUpdateUserTyping(7, 3, act), 3},
	}
	for _, c := range cases {
		raw, err := json.Marshal(c.u)
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		got, has := m["top_msg_id"]
		if c.want == 0 {
			if has {
				t.Errorf("%s: ключ top_msg_id не нужен, есть %v", c.name, got)
			}
			continue
		}
		if got != c.want {
			t.Errorf("%s: top_msg_id = %v, want %v", c.name, got, c.want)
		}
	}
}
