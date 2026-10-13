package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseNotifyType(t *testing.T) {
	for _, tag := range []string{"notifyUsers", "notifyChats", "notifyBroadcasts"} {
		nt, ok := ParseNotifyType(tag)
		if !ok || string(nt) != tag {
			t.Fatalf("ParseNotifyType(%q) = %q, %v", tag, nt, ok)
		}
	}
	for _, bad := range []string{"", "notifyPeer", "notifyForumTopic", "users", "NOTIFYUSERS"} {
		if _, ok := ParseNotifyType(bad); ok {
			t.Fatalf("ParseNotifyType(%q) принят", bad)
		}
	}
}

// Мьют типа выражается сроком: булево хранилища «замьючен» даёт навсегда или ноль.
func TestNotifySettings_ForType(t *testing.T) {
	s := DefaultNotifySettings()
	s.Groups = NotifyTypeSettings{Muted: true, Preview: false}
	cases := map[NotifyType]NotifyTypeSettings{
		NotifyTypeUsers:      s.Private,
		NotifyTypeChats:      s.Groups,
		NotifyTypeBroadcasts: s.Channels,
	}
	for nt, want := range cases {
		if got := s.ForType(nt); got != want {
			t.Errorf("ForType(%s) = %+v, want %+v", nt, got, want)
		}
	}
	ns := s.ForType(NotifyTypeChats).PeerNotifySettings()
	if ns.MuteUntil == nil || *ns.MuteUntil != MuteUntilForever || ns.ShowPreviews == nil || *ns.ShowPreviews {
		t.Fatalf("muted/no-preview -> %+v", ns)
	}
	ns = s.ForType(NotifyTypeUsers).PeerNotifySettings()
	if ns.MuteUntil == nil || *ns.MuteUntil != 0 || ns.ShowPreviews == nil || !*ns.ShowPreviews {
		t.Fatalf("unmuted/preview -> %+v", ns)
	}
}

func TestNotifyTypePeer_Constructors(t *testing.T) {
	for nt, tag := range map[NotifyType]string{
		NotifyTypeUsers: NotifyUsersTag, NotifyTypeChats: NotifyChatsTag, NotifyTypeBroadcasts: NotifyBroadcastsTag,
	} {
		raw, _ := json.Marshal(NotifyTypePeer(nt))
		if string(raw) != `{"_":"`+tag+`"}` {
			t.Errorf("NotifyTypePeer(%s) = %s", nt, raw)
		}
	}
}

func TestInputPeerNotifySettings_Decode(t *testing.T) {
	var in InputPeerNotifySettings
	if err := json.Unmarshal([]byte(`{"_":"inputPeerNotifySettings","mute_until":2147483647}`), &in); err != nil {
		t.Fatal(err)
	}
	if in.MuteUntil == nil || *in.MuteUntil != MuteUntilForever || in.ShowPreviews != nil {
		t.Fatalf("%+v", in)
	}
	if err := json.Unmarshal([]byte(`{"_":"inputPeerNotifySettings","show_previews":false}`), &in); err != nil {
		t.Fatal(err)
	}
}

// Три состояния мьюта чата, как у темы (TopicMuted): NULL — наследует тип,
// явное «уведомлять» (0 или истёкший срок) перекрывает заглушённый тип, срок в
// будущем — заглушён сам. tweb appNotificationsManager.ts:342-384: тип
// подставляется только в НЕопределённые поля пира.
func TestChatMuted_ThreeStates(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	at := func(sec int64) *time.Time { v := time.Unix(sec, 0); return &v }
	cases := []struct {
		name      string
		until     *time.Time
		typeMuted bool
		want      bool
	}{
		{"не трогали, тип включён", nil, false, false},
		{"не трогали, тип выключен — наследует", nil, true, true},
		{"явно включён (0), тип выключен — исключение", at(0), true, false},
		{"истёкший срок, тип выключен — тоже явное «включён»", at(now.Unix() - 10), true, false},
		{"срок в будущем, тип включён", at(now.Unix() + 60), false, true},
		{"навсегда, тип включён", at(MuteUntilForever), false, true},
	}
	for _, c := range cases {
		if got := ChatMuted(c.until, c.typeMuted, now); got != c.want {
			t.Errorf("%s: ChatMuted = %v, want %v", c.name, got, c.want)
		}
	}
}

// mutedAt — «замьючено ли значение на проводе в этот момент» (tweb isMuted:
// silent || mute_until > now) — проверка ПРОВОДА в тестах; решение о чате
// принимает ChatMuted.
func mutedAt(s PeerNotifySettings, now time.Time) bool {
	return (s.Silent != nil && *s.Silent) || (s.MuteUntil != nil && int64(*s.MuteUntil) > now.Unix())
}
