package domain

import (
	"testing"
	"time"
)

// Мьют темы — три состояния (tweb appNotificationsManager.ts:398-405):
// нетронутая тема — пустой peerNotifySettings и наследование мьюта чата;
// явная запись — mute_until (0 — «уведомлять»), решает сама.
func TestTopicNotifySettings_ThreeStates(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	if s := TopicNotifySettings(nil, now); s.MuteUntil != nil || s.Underscore != PeerNotifySettingsTag {
		t.Fatalf("нетронутая тема: %+v, ждали пустой peerNotifySettings", s)
	}
	zero := time.Unix(0, 0)
	if s := TopicNotifySettings(&zero, now); s.MuteUntil == nil || *s.MuteUntil != MuteUntilNever {
		t.Fatalf("явное «уведомлять»: %+v", s)
	}
	past := now.Add(-time.Minute)
	if s := TopicNotifySettings(&past, now); s.MuteUntil == nil || *s.MuteUntil != MuteUntilNever {
		t.Fatalf("истёкший срок: %+v, ждали 0", s)
	}
	future := now.Add(time.Hour)
	if s := TopicNotifySettings(&future, now); s.MuteUntil == nil || int64(*s.MuteUntil) != future.Unix() {
		t.Fatalf("срок: %+v", s)
	}
}

func TestTopicMuted_Inheritance(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	zero, future := time.Unix(0, 0), now.Add(time.Hour)
	cases := []struct {
		name      string
		topic     *time.Time
		chatMuted bool
		want      bool
	}{
		{"нетронутая, чат заглушён", nil, true, true},
		{"нетронутая, чат слышен", nil, false, false},
		{"явно включена, чат заглушён", &zero, true, false},
		{"заглушена, чат слышен", &future, false, true},
	}
	for _, c := range cases {
		if got := TopicMuted(c.topic, c.chatMuted, now); got != c.want {
			t.Errorf("%s: TopicMuted = %v, ждали %v", c.name, got, c.want)
		}
	}
}
