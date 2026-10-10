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
	return NewForumTopic(rec, NewPeer(ToPeerID(9, true)), NewPeerUser(7),
		ForumTopicState{TopMessage: 42, ReadInboxMaxID: 40, ReadOutboxMaxID: 41, Unread: 2, UnreadMentions: 1, UnreadReactions: 1},
		notify, ForumTopicFlags{My: true, Closed: true, Pinned: true, Hidden: true})
}

func generalSample() ForumTopicReal {
	return NewForumTopic(
		ForumTopicRecord{ID: 77, ChatID: 9, Title: "General", IsGeneral: true, CreatedAt: time.Unix(1, 0)},
		NewPeer(ToPeerID(9, true)), NewPeerUser(7), ForumTopicState{},
		PeerNotifySettings{Underscore: PeerNotifySettingsTag}, ForumTopicFlags{})
}

// П. 5 спецификации Ф-5: у темы одно число — номер служебки создания, у
// General — 1 (tweb constants.ts:26, dialogs.ts:2219). Внутренний ключ строки
// и наши `root_msg_id`/`pFlags.is_general` на провод не выходят.
func TestForumTopic_IDIsTopicNumber(t *testing.T) {
	topic, ok := roundTripJSON(t, topicSample()).(map[string]any)
	if !ok {
		t.Fatal("строка темы не разобралась в объект")
	}
	if topic["id"] != float64(12) {
		t.Errorf("id темы = %v, ждали номер служебки создания 12 (не ключ строки 4)", topic["id"])
	}
	general, _ := roundTripJSON(t, generalSample()).(map[string]any)
	if general["id"] != float64(GeneralTopicID) {
		t.Errorf("id General = %v, ждали %d", general["id"], GeneralTopicID)
	}
	for _, row := range []map[string]any{topic, general} {
		if _, has := row["root_msg_id"]; has {
			t.Error("root_msg_id остался на проводе")
		}
		if flags, _ := row["pFlags"].(map[string]any); flags["is_general"] != nil {
			t.Error("pFlags.is_general остался на проводе")
		}
	}
	if topic["read_outbox_max_id"] != float64(41) || topic["unread_reactions_count"] != float64(1) {
		t.Errorf("A1-19: read_outbox_max_id=%v unread_reactions_count=%v", topic["read_outbox_max_id"], topic["unread_reactions_count"])
	}
}

func TestForumTopic_MatchesSchema(t *testing.T) {
	cases := []struct {
		name  string
		value any
	}{
		{"строка темы", topicSample()},
		{"General без корня", generalSample()},
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
