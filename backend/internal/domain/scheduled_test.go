package domain

import (
	"testing"
	"time"
)

func scheduledWire(m ScheduledMessage) MessageReal {
	return m.ToWire(m.Message().ToWire(MessageContext{Peer: NewPeerUser(42), Out: true}).(MessageReal))
}

// Дата отложенного на проводе — момент отправки, а «когда появится онлайн» —
// sentinel 0x7FFFFFFE (tweb `SEND_WHEN_ONLINE_TIMESTAMP`): по ней клиент режет
// ленту отложенных на дни (`ChatType.Scheduled`, tweb `chat/dateBubble.ts`).
func TestScheduledToWire_DateIsSendTime(t *testing.T) {
	created := time.Unix(1_700_000_000, 0)
	sendAt := time.Unix(1_800_000_000, 0)

	dated := scheduledWire(ScheduledMessage{ID: 1, SendAt: sendAt, CreatedAt: created})
	if dated.Date != 1_800_000_000 {
		t.Fatalf("date = %d, want send_at 1800000000", dated.Date)
	}
	if !dated.PFlags["out"] || !dated.PFlags["is_scheduled"] {
		t.Fatalf("pFlags out/is_scheduled не выставлены: %v", dated.PFlags)
	}
	if dated.ID != 1 {
		t.Fatalf("id = %d, want ключ отложенного 1", dated.ID)
	}

	online := scheduledWire(ScheduledMessage{ID: 2, SendAt: sendAt, CreatedAt: created, WhenOnline: true})
	if online.Date != SendWhenOnlineTimestamp {
		t.Fatalf("date = %d, want sentinel %d", online.Date, SendWhenOnlineTimestamp)
	}
}

// Снимок отправки доезжает до провода: цитата, корень треда, send-as, эффект,
// альбом, повтор, пересылка (НО-1/A1-10 — прежде ToWire ставил только текст).
func TestScheduledToWire_CarriesSnapshot(t *testing.T) {
	quote, off, root, sendAs, g := "кусок", 3, int64(77), int64(500), int64(9)
	from, fdate := int64(5), int64(1_600_000_000)
	media := int64(11)
	m := ScheduledMessage{
		ID: 4, ChatID: 1, SenderID: 42, Type: "photo", Text: "подпись", MediaID: &media,
		ReplyToID: ptr(int64(10)), SendAt: time.Unix(1_800_000_000, 0), RepeatPeriod: 7 * 86400,
		Params: ScheduledParams{
			ReplyQuoteText: &quote, ReplyQuoteOffset: &off, ThreadRootID: &root,
			SendAsChatID: &sendAs, Effect: "fireworks", GroupedID: g, MediaSpoiler: true,
			Fwd: &ScheduledFwd{SrcMsgID: 3, FromUserID: &from, Date: &fdate},
		},
	}
	msg := m.Message()
	if msg.GroupedID == nil || *msg.GroupedID != g || !msg.MediaSpoiler || msg.Seq != 4 || msg.ID != 0 {
		t.Fatalf("Message(): %+v", msg)
	}
	if msg.FwdFromUserID == nil || *msg.FwdFromUserID != from || msg.FwdDate == nil || msg.FwdDate.Unix() != fdate {
		t.Fatalf("атрибуция пересылки потеряна: %+v", msg)
	}
	w := scheduledWire(m)
	if w.ReplyTo == nil || w.ReplyTo.QuoteText != quote || w.ReplyTo.QuoteOffset != off || w.ReplyTo.ReplyToTopID != root {
		t.Fatalf("reply_to: %+v", w.ReplyTo)
	}
	if p, ok := w.FromID.(PeerChannel); !ok || p.ChannelID != sendAs {
		t.Fatalf("from_id = %#v, want send-as канал", w.FromID)
	}
	if w.Effect != "fireworks" || w.GroupedID != g || w.ScheduleRepeatPeriod != 7*86400 {
		t.Fatalf("effect/grouped/repeat: %q %d %d", w.Effect, w.GroupedID, w.ScheduleRepeatPeriod)
	}
}

func TestValidScheduleRepeatPeriod(t *testing.T) {
	for _, p := range []int{0, 86400, 604800, 1209600, 2592000, 7862400, 15724800, 31536000} {
		if !ValidScheduleRepeatPeriod(p) {
			t.Errorf("период tweb %d отвергнут", p)
		}
	}
	for _, p := range []int{1, 3600, 86401, 31536000 * 2} {
		if ValidScheduleRepeatPeriod(p) {
			t.Errorf("чужой период %d принят", p)
		}
	}
}
