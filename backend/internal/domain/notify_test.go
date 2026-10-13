package domain

import (
	"encoding/json"
	"testing"
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
