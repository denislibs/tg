package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// lastFrameFor decodes the payload (d) of the most recent frame published to
// userID. Fails if no frame was captured for that user.
func lastFrameFor(t *testing.T, pub *fakePublisher, userID int64) map[string]any {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	for i := len(pub.frames) - 1; i >= 0; i-- {
		if pub.frames[i].userID != userID {
			continue
		}
		var env struct {
			T string          `json:"t"`
			D json.RawMessage `json:"d"`
		}
		if err := json.Unmarshal(pub.frames[i].frame, &env); err != nil {
			t.Fatalf("unmarshal frame: %v", err)
		}
		var d map[string]any
		if err := json.Unmarshal(env.D, &d); err != nil {
			t.Fatalf("unmarshal d: %v", err)
		}
		return d
	}
	t.Fatalf("no frame captured for user %d", userID)
	return nil
}

// rowPts returns the pts of the last update row appended for userID (the dense
// per-user cursor). Reads the fake update log directly.
func rowPts(t *testing.T, s *store, userID int64) int64 {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	ups := s.updates[userID]
	if len(ups) == 0 {
		t.Fatalf("no update rows for user %d", userID)
	}
	return ups[len(ups)-1].Pts
}

func asInt64(t *testing.T, v any) int64 {
	t.Helper()
	f, ok := v.(float64) // JSON numbers decode to float64
	if !ok {
		t.Fatalf("value %#v is not a number", v)
	}
	return int64(f)
}

// (a) Every logged live frame carries the recipient's per-user pts, and it
// equals the pts of the matching updates row for that recipient.
func TestFramePts_MatchesUpdateRow(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	// new_message: both sender and recipient get a frame carrying their own pts.
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	for _, uid := range []int64{a, b} {
		d := lastFrameFor(t, pub, uid)
		if got, want := asInt64(t, d["pts"]), rowPts(t, s, uid); got != want {
			t.Fatalf("new_message pts for %d = %d; want row pts %d", uid, got, want)
		}
	}

	// reaction: same invariant on a different update type.
	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React: %v", err)
	}
	for _, uid := range []int64{a, b} {
		d := lastFrameFor(t, pub, uid)
		if d["pts"] == nil {
			t.Fatalf("reaction frame for %d missing pts", uid)
		}
		if got, want := asInt64(t, d["pts"]), rowPts(t, s, uid); got != want {
			t.Fatalf("reaction pts for %d = %d; want row pts %d", uid, got, want)
		}
	}

	// read/edit/pin/delete also carry pts (spot-check read).
	pub.reset()
	if err := in.MarkRead(ctx, chatID, b, msg.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	d := lastFrameFor(t, pub, b)
	if got, want := asInt64(t, d["pts"]), rowPts(t, s, b); got != want {
		t.Fatalf("read pts for b = %d; want row pts %d", got, want)
	}
}

// (b) Reactions are absolute: the reaction payload carries the full current
// aggregate (counts), so replaying it from /sync is idempotent by construction.
// The counts in the live frame equal the counts stored in the log payload.
func TestReactionPayload_AbsoluteAndIdempotent(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})

	// countsOf reads the absolute aggregate from the latest reaction frame for a.
	countsOf := func() map[string]int64 {
		d := lastFrameFor(t, pub, a)
		raw, ok := d["counts"].([]any)
		if !ok {
			t.Fatalf("reaction payload missing counts array: %#v", d["counts"])
		}
		out := map[string]int64{}
		for _, e := range raw {
			m := e.(map[string]any)
			out[m["emoji"].(string)] = asInt64(t, m["count"])
		}
		return out
	}

	// b adds 🔥 → counts {🔥:1}.
	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React b add: %v", err)
	}
	if c := countsOf(); c["🔥"] != 1 || len(c) != 1 {
		t.Fatalf("after b🔥 counts = %v; want {🔥:1}", c)
	}

	// a adds 👍 → absolute aggregate now {🔥:1, 👍:1}.
	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, a, "👍", true); err != nil {
		t.Fatalf("React a add: %v", err)
	}
	if c := countsOf(); c["🔥"] != 1 || c["👍"] != 1 || len(c) != 2 {
		t.Fatalf("after +a👍 counts = %v; want {🔥:1,👍:1}", c)
	}

	// b removes 🔥 → absolute aggregate now {👍:1} (🔥 gone entirely).
	pub.reset()
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", false); err != nil {
		t.Fatalf("React b remove: %v", err)
	}
	c := countsOf()
	if _, ok := c["🔥"]; ok || c["👍"] != 1 || len(c) != 1 {
		t.Fatalf("after -b🔥 counts = %v; want {👍:1}", c)
	}

	// The counts in the frame match the aggregate persisted to the log payload,
	// so a /sync replay reconstructs exactly the same state (idempotent).
	s.mu.Lock()
	ups := s.updates[a]
	last := ups[len(ups)-1]
	s.mu.Unlock()
	var logPayload map[string]any
	if err := json.Unmarshal(last.Payload, &logPayload); err != nil {
		t.Fatalf("unmarshal log payload: %v", err)
	}
	logCounts, ok := logPayload["counts"].([]any)
	if !ok || len(logCounts) != 1 {
		t.Fatalf("log payload counts = %#v; want one entry", logPayload["counts"])
	}
	if m := logCounts[0].(map[string]any); m["emoji"].(string) != "👍" || asInt64(t, m["count"]) != 1 {
		t.Fatalf("log payload counts entry = %#v; want 👍:1", m)
	}
}

// (d) new_message and read frames carry the recipient's authoritative unread,
// and it matches the value persisted for that member.
func TestUnread_AuthoritativeInFrames(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	memberUnread := func(uid int64) int64 {
		s.mu.Lock()
		defer s.mu.Unlock()
		return int64(s.members[chatID][uid].unread)
	}

	// Two messages from a → b's unread climbs to 1 then 2; the sender never gets
	// an unread field (they authored the message).
	for want := int64(1); want <= 2; want++ {
		pub.reset()
		if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "m"}); err != nil {
			t.Fatalf("Send: %v", err)
		}
		db := lastFrameFor(t, pub, b)
		if got := asInt64(t, db["unread"]); got != want {
			t.Fatalf("new_message unread for b = %d; want %d", got, want)
		}
		if got := memberUnread(b); got != want {
			t.Fatalf("db unread for b = %d; want %d", got, want)
		}
		da := lastFrameFor(t, pub, a)
		if _, ok := da["unread"]; ok {
			t.Fatalf("sender frame must not carry unread; got %v", da["unread"])
		}
	}

	// b reads everything → read frame carries unread=0, matching the DB.
	pub.reset()
	last := s.chatSeq[chatID]
	if err := in.MarkRead(ctx, chatID, b, last); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	// Читателю уходит updateReadHistoryInbox — единственный из двух
	// конструкторов прочтения, который несёт счётчик: непрочитанное МОЁ.
	db := lastFrameFor(t, pub, b)
	if db["_"] != domain.UpdateReadHistoryInboxTag {
		t.Fatalf("кадр читателю = %v; want %s", db["_"], domain.UpdateReadHistoryInboxTag)
	}
	if got := asInt64(t, db["still_unread_count"]); got != 0 {
		t.Fatalf("read unread for b = %d; want 0", got)
	}
	if got := memberUnread(b); got != 0 {
		t.Fatalf("db unread for b after read = %d; want 0", got)
	}
}

// client_msg_id rides along in the new_message echo so the sender can match the
// echo to its optimistic bubble (same key as the ack).
func TestNewMessageEcho_CarriesClientMsgID(t *testing.T) {
	in, _ := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi", ClientMsgID: "opt-42"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	d := lastFrameFor(t, pub, a)
	msg, _ := d["message"].(map[string]any)
	if got, _ := msg["random_id"].(string); got != "opt-42" {
		t.Fatalf("echo random_id = %q; want opt-42", got)
	}
}
