package domain

import (
	"reflect"
	"sort"
	"testing"
)

func sorted(ids []int64) []int64 {
	out := append([]int64(nil), ids...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// A4-03: ссылки на пиров выводятся из провода — peer_id, from_id, fwd_from,
// reply_to, replies.channel_id/recent_repliers, действие, упоминание, контакт.
// Вектор карточек вложенного контейнера ссылками не считается.
func TestCollectPeerRefs(t *testing.T) {
	body := map[string]any{
		"_": "updateNewMessage",
		"message": map[string]any{
			"_":        "message",
			"peer_id":  NewPeerChannel(5),
			"from_id":  NewPeerUser(10),
			"fwd_from": map[string]any{"from_id": NewPeerChannel(4), "saved_from_peer": NewPeerChannel(6)},
			"reply_to": map[string]any{"reply_to_peer_id": NewPeerChannel(7)},
			"replies":  map[string]any{"channel_id": 8, "recent_repliers": []any{NewPeerUser(11)}},
			"entities": []any{map[string]any{"_": "messageEntityMentionName", "user_id": 12}},
			"media":    map[string]any{"_": "messageMediaContact", "user_id": 13},
			"action":   map[string]any{"_": "messageActionChatAddUser", "users": []any{14, 15}},
		},
		"chat_full": map[string]any{
			"users": []any{map[string]any{"_": "user", "id": 99}},
			"chats": []any{map[string]any{"_": "channel", "id": 98}},
		},
		"peer_id": -3,
	}
	got := CollectPeerRefs(body)
	if want := []int64{10, 11, 12, 13, 14, 15}; !reflect.DeepEqual(sorted(got.Users), want) {
		t.Errorf("users = %v, want %v", sorted(got.Users), want)
	}
	if want := []int64{3, 4, 5, 6, 7, 8}; !reflect.DeepEqual(sorted(got.Chats), want) {
		t.Errorf("chats = %v, want %v", sorted(got.Chats), want)
	}
}
