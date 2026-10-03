package domain

import (
	"testing"
	"time"
)

// Дата отложенного на проводе — момент отправки, а «когда появится онлайн» —
// sentinel 0x7FFFFFFE (tweb `SEND_WHEN_ONLINE_TIMESTAMP`): по ней клиент режет
// ленту отложенных на дни (`ChatType.Scheduled`, tweb `chat/dateBubble.ts`).
func TestScheduledToWire_DateIsSendTime(t *testing.T) {
	created := time.Unix(1_700_000_000, 0)
	sendAt := time.Unix(1_800_000_000, 0)

	dated := ScheduledMessage{ID: 1, SendAt: sendAt, CreatedAt: created}.ToWire(NewPeerUser(42))
	if dated.Date != 1_800_000_000 {
		t.Fatalf("date = %d, want send_at 1800000000", dated.Date)
	}
	if _, out := dated.PFlags["out"]; !out {
		t.Fatalf("pFlags.out не выставлен: %v", dated.PFlags)
	}

	online := ScheduledMessage{ID: 2, SendAt: sendAt, CreatedAt: created, WhenOnline: true}.ToWire(NewPeerUser(42))
	if online.Date != SendWhenOnlineTimestamp {
		t.Fatalf("date = %d, want sentinel %d", online.Date, SendWhenOnlineTimestamp)
	}
}
