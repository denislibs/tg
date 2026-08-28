package domain

import (
	"sort"
	"testing"
	"time"
)

// Механическая сверка витрины тем форума со схемой TL.

func topicSample() ForumTopicReal {
	rec := ForumTopicRecord{
		ID: 4, ChatID: 9, RootMsgSeq: 12, Title: "Баги",
		IconColor: 3, IconEmoji: "🐞", CreatedAt: time.Unix(1787334148, 0),
	}
	notify := PeerNotifySettings{Underscore: PeerNotifySettingsTag}
	return NewForumTopic(rec, NewPeer(ToPeerID(9, true)), NewPeerUser(7), 42, 40, 2, 1, notify,
		ForumTopicFlags{My: true, Closed: true, Pinned: true, Hidden: true})
}

func TestForumTopic_MatchesSchema(t *testing.T) {
	cases := []struct {
		name  string
		value any
	}{
		{"строка темы", topicSample()},
		{"General без корня", NewForumTopic(
			ForumTopicRecord{ID: 1, ChatID: 9, Title: "General", CreatedAt: time.Unix(1, 0)},
			NewPeer(ToPeerID(9, true)), NewPeerUser(7), 0, 0, 0, 0,
			PeerNotifySettings{Underscore: PeerNotifySettingsTag}, ForumTopicFlags{IsGeneral: true})},
		{"контейнер списка", NewMessagesForumTopics(
			[]ForumTopic{topicSample()},
			[]MTMessage{MessageReal{Underscore: MessageTag, ID: 42, PeerID: NewPeerUser(7), Date: 1787334148}},
			nil, []UserReal{{Underscore: UserTag, ID: 7}})},
		{"пустой контейнер", NewMessagesForumTopics(nil, nil, nil, nil)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
				omittedOK:    OmittedWithoutSubject,
			}
			c.walk(roundTripJSON(t, tc.value), "topics")
			sort.Strings(c.unexpected)
			sort.Strings(c.omitted)
			for _, s := range c.unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range c.omitted {
				t.Errorf("пропущено: %s", s)
			}
		})
	}
}

// Выжимок последнего сообщения в строке НЕТ: она несёт только ссылку
// (`top_message`), а само сообщение едет вектором `messages` контейнера.
// Прежде рядом лежали `last_text`/`last_type`/`last_at` и склеенное сервером
// подзапросом `last_sender_name`.
func TestForumTopic_CarriesReferenceNotSnapshot(t *testing.T) {
	decoded, ok := roundTripJSON(t, topicSample()).(map[string]any)
	if !ok {
		t.Fatal("строка темы не разобралась в объект")
	}
	for _, dead := range []string{"last_text", "last_type", "last_at", "last_sender_name", "last_out", "msg_count", "pos"} {
		if _, has := decoded[dead]; has {
			t.Errorf("выжимка %q осталась в строке темы", dead)
		}
	}
	if decoded["top_message"] != float64(42) {
		t.Errorf("top_message = %v, ожидалась ссылка на последнее сообщение", decoded["top_message"])
	}
}

// Заглушённость темы — СРОК внутри notify_settings, а не булево поле рядом:
// тот же предикат, что у диалога.
func TestForumTopic_MuteIsADeadline(t *testing.T) {
	decoded, ok := roundTripJSON(t, topicSample()).(map[string]any)
	if !ok {
		t.Fatal("строка темы не разобралась в объект")
	}
	if _, has := decoded["muted"]; has {
		t.Error("булево поле muted осталось рядом с конструктором")
	}
	notify, ok := decoded["notify_settings"].(map[string]any)
	if !ok || notify["_"] != PeerNotifySettingsTag {
		t.Fatalf("notify_settings = %v; ожидался конструктор", decoded["notify_settings"])
	}
}
