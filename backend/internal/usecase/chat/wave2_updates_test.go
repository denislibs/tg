package chat

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// newLoggedGroupInteractor wires a group-backed interactor WITH an update log and
// a publisher, so Wave-2 stateful updates (dialog_*/theme/poll/checklist/
// chat_update) both append to the per-user log and fan out live. Chats/membership
// are backed by the fake group repo (like TestGroupLifecycle); messages/updates by
// the in-memory store.
func newLoggedGroupInteractor() (*Interactor, *store, *fakeGroupRepo, *fakePublisher) {
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	return in, s, fg, pub
}

// assertLoggedRow checks the LAST update row for userID is of type typ with a
// non-zero pts, and returns that pts.
func assertLoggedRow(t *testing.T, s *store, userID int64, typ string) int64 {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	ups := s.updates[userID]
	if len(ups) == 0 {
		t.Fatalf("no update rows for user %d (want a %q row)", userID, typ)
	}
	last := ups[len(ups)-1]
	if last.Type != typ {
		t.Fatalf("last row type for %d = %q; want %q", userID, last.Type, typ)
	}
	if last.Pts == 0 {
		t.Fatalf("%q row for %d has zero pts", typ, userID)
	}
	return last.Pts
}

// assertInDifference verifies GetDifference(userID, 0) replays a row of type typ at
// exactly wantPts — i.e. a catch-up client sees the same logged update.
func assertInDifference(t *testing.T, in *Interactor, userID int64, typ string, wantPts int64) {
	t.Helper()
	diff, err := in.GetDifference(context.Background(), userID, 0)
	if err != nil {
		t.Fatalf("GetDifference: %v", err)
	}
	for _, u := range append(append([]SyncUpdate{}, diff.OtherUpdates...), diff.NewMessages...) {
		if u.Type == typ && u.Pts == wantPts {
			return
		}
	}
	t.Fatalf("GetDifference for %d has no %q row at pts %d (other=%v)", userID, typ, wantPts, diff.OtherUpdates)
}

// assertLiveFramePts checks the last live frame published to userID is of type typ
// and carries pts == wantPts (so the live cursor matches the /sync row).
func assertLiveFramePts(t *testing.T, pub *fakePublisher, userID int64, typ string, wantPts int64) {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	for i := len(pub.frames) - 1; i >= 0; i-- {
		if pub.frames[i].userID != userID {
			continue
		}
		var env struct {
			T   string         `json:"t"`
			D   map[string]any `json:"d"`
			Pts *float64       `json:"pts"`
		}
		if err := json.Unmarshal(pub.frames[i].frame, &env); err != nil {
			continue
		}
		if env.T != typ {
			continue
		}
		// Курсор лежит в теле либо в конверте — выбирает СХЕМА кадра
		// (TestFramePts_LivesWhereSchemaSaysIt). Здесь важно лишь, что он есть
		// и совпадает со строкой журнала.
		pts, ok := env.D["pts"].(float64)
		if !ok && env.Pts != nil {
			pts, ok = *env.Pts, true
		}
		if !ok {
			t.Fatalf("%q frame for %d missing pts: %v", typ, userID, env.D)
		}
		if int64(pts) != wantPts {
			t.Fatalf("%q frame pts for %d = %d; want %d", typ, userID, int64(pts), wantPts)
		}
		return
	}
	t.Fatalf("no %q frame published to %d", typ, userID)
}

// Own-device stateful flags (pin/archive/mute) and chat theme are logged with a
// dense pts, fan out live carrying that pts, and replay via /sync.
func TestDialogFlagsAndTheme_LoggedAndDiff(t *testing.T) {
	in, s, _, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	const owner int64 = 7
	chatID, err := in.CreateGroup(ctx, owner, "Team", "", "", false, nil)
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	steps := []struct {
		name string
		typ  string
		run  func() error
	}{
		{"pin", "dialog_pin", func() error { return in.PinDialog(ctx, chatID, owner, true) }},
		{"archive", "dialog_archive", func() error { return in.ArchiveDialog(ctx, chatID, owner, true) }},
		{"mute", "dialog_mute", func() error { return in.SetMute(ctx, chatID, owner, true, nil) }},
		{"theme", "chat_theme_update", func() error { return in.SetChatTheme(ctx, chatID, owner, "dark") }},
	}
	for _, st := range steps {
		pub.reset()
		if err := st.run(); err != nil {
			t.Fatalf("%s: %v", st.name, err)
		}
		pts := assertLoggedRow(t, s, owner, st.typ)
		assertLiveFramePts(t, pub, owner, st.typ, pts)
		assertInDifference(t, in, owner, st.typ, pts)
	}
}

// A group metadata mutation logs + fans out chat_update (absolute snapshot) to
// every member, each with their own dense pts, and replays via /sync.
func TestChatUpdate_LoggedAndLiveToMembers(t *testing.T) {
	in, s, _, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	const owner, member int64 = 7, 8
	chatID, err := in.CreateGroup(ctx, owner, "Team", "", "", false, nil)
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	if err := in.AddMember(ctx, chatID, owner, member); err != nil {
		t.Fatalf("AddMember: %v", err)
	}

	pub.reset()
	if err := in.EditInfo(ctx, chatID, owner, "Renamed", "about", ""); err != nil {
		t.Fatalf("EditInfo: %v", err)
	}
	for _, uid := range []int64{owner, member} {
		pts := assertLoggedRow(t, s, uid, "chat_update")
		assertLiveFramePts(t, pub, uid, "chat_update", pts)
		assertInDifference(t, in, uid, "chat_update", pts)
	}
	// Снимок абсолютный: кадр несёт messages.chatFull с новым заголовком
	// внутри краткой формы чата — ту же пару конструкторов, что и ручка карточки.
	d := lastFrameFor(t, pub, member)
	cf, _ := d["chat_full"].(map[string]any)
	if cf == nil || cf["_"] != "messages.chatFull" {
		t.Fatalf("chat_update без messages.chatFull: %v", d)
	}
	chats, _ := cf["chats"].([]any)
	if len(chats) != 1 {
		t.Fatalf("chat_update chats = %v", cf["chats"])
	}
	chat, _ := chats[0].(map[string]any)
	if chat["_"] != "channel" || chat["title"] != "Renamed" {
		t.Fatalf("chat_update chat = %v; want channel «Renamed»", chat)
	}
}

// Voting on a poll logs + fans out poll_update to members, dense pts, /sync replay.
func TestPollUpdate_LoggedAndDiff(t *testing.T) {
	in, s, fg, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	const owner, voter int64 = 7, 8
	chatID, _ := in.CreateGroup(ctx, owner, "Team", "", "", false, nil)
	_ = fg.AddMember(ctx, chatID, voter, domain.RoleMember, 0)
	fp := newFakePolls()
	in.SetPolls(fp)
	poll, _ := fp.Create(ctx, domain.Poll{ChatID: chatID, Question: "q", Options: []string{"a", "b"}})

	pub.reset()
	if _, err := in.VotePoll(ctx, poll.ID, voter, []int{0}); err != nil {
		t.Fatalf("VotePoll: %v", err)
	}
	for _, uid := range []int64{owner, voter} {
		pts := assertLoggedRow(t, s, uid, "poll_update")
		assertLiveFramePts(t, pub, uid, "poll_update", pts)
		assertInDifference(t, in, uid, "poll_update", pts)
	}

	// Итоги кадра собраны для «зрителя 0»: тело одно на всех получателей, а
	// chosen/correct — пер-зрительские. В схеме это pollResults.pFlags.min, и
	// именно по нему клиент СОХРАНЯЕТ свой выбор вместо того, чтобы затереть
	// его отсутствием chosen. Голосовавший в кадре не отмечен — без флага его
	// выбор пропал бы при первом же кадре.
	var env struct {
		D struct {
			Media domain.MessageMediaPoll `json:"media"`
		} `json:"d"`
	}
	if err := json.Unmarshal(mustFrame(t, pub, voter, "poll_update"), &env); err != nil {
		t.Fatalf("кадр poll_update не разбирается: %v", err)
	}
	if !env.D.Media.Results.PFlags["min"] {
		t.Errorf("итоги кадра без pFlags.min: %+v", env.D.Media.Results)
	}
	for _, r := range env.D.Media.Results.Results {
		if r.PFlags["chosen"] {
			t.Errorf("кадр несёт пер-зрительский chosen: %+v", r)
		}
	}
}

// Toggling a checklist item logs + fans out checklist_update, dense pts, replay.
func TestChecklistUpdate_LoggedAndDiff(t *testing.T) {
	in, s, fg, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	const owner int64 = 7
	chatID, _ := in.CreateGroup(ctx, owner, "Team", "", "", false, nil)
	_ = fg.AddMember(ctx, chatID, owner, domain.RoleCreator, domain.AllRights)
	fc := newFakeChecklists()
	in.SetChecklists(fc)
	cl, _ := fc.Create(ctx, domain.Checklist{
		ChatID: chatID, Title: "todo", Items: []domain.ChecklistItem{{ID: 1, Text: "a"}},
	})
	clID := cl.ID
	s.mu.Lock()
	s.messages[chatID] = append(s.messages[chatID], domain.Message{ID: 1, ChatID: chatID, SenderID: owner, Type: "checklist", ChecklistID: &clID})
	s.mu.Unlock()

	pub.reset()
	if _, err := in.ToggleChecklistItem(ctx, clID, 1, owner); err != nil {
		t.Fatalf("ToggleChecklistItem: %v", err)
	}
	pts := assertLoggedRow(t, s, owner, "checklist_update")
	assertLiveFramePts(t, pub, owner, "checklist_update", pts)
	assertInDifference(t, in, owner, "checklist_update", pts)
}

// A cloud-draft save logs + fans out draft_update to the owner's own devices only.
func TestDraftUpdate_LoggedAndDiff(t *testing.T) {
	in, s := newInteractor()
	in.SetDrafts(newFakeDrafts())
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if _, err := in.SaveDraft(ctx, a, chatID, "hi", nil, nil); err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}
	pts := assertLoggedRow(t, s, a, "draft_update")
	assertLiveFramePts(t, pub, a, "draft_update", pts)
	assertInDifference(t, in, a, "draft_update", pts)
	// The peer must not receive a draft_update row.
	s.mu.Lock()
	for _, u := range s.updates[b] {
		if u.Type == "draft_update" {
			t.Fatalf("peer %d wrongly got a draft_update row", b)
		}
	}
	s.mu.Unlock()
}

// balance_update is logged to the affected user's own devices with a dense pts.
func TestBalanceUpdate_Logged(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const uid int64 = 5

	in.publishBalance(ctx, uid, 42)
	pts := assertLoggedRow(t, s, uid, "balance_update")
	assertLiveFramePts(t, pub, uid, "balance_update", pts)
	assertInDifference(t, in, uid, "balance_update", pts)
	if d := lastFrameFor(t, pub, uid); asInt64(t, d["balance"]) != 42 {
		t.Fatalf("balance_update balance = %v; want 42", d["balance"])
	}
}

// The shared logAndPublish helper is a no-op without an update log (some unit-test
// setups wire updates=nil) — it must not panic and must publish nothing.
func TestLogAndPublish_NoUpdateLogNoOp(t *testing.T) {
	fg := newFakeGroupRepo()
	// updates=nil, publisher=nil (as newGroupTestInteractor does).
	in := New(fakeTx{}, groupChats{fg}, nil, nil, nil, nil, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	if err := in.logAndPublish(context.Background(), 0, []int64{1, 2}, "draft_update", map[string]any{"x": 1}); err != nil {
		t.Fatalf("logAndPublish with nil update log: %v", err)
	}
}

// Кадр dialog_mute несёт notify_settings ЦЕЛИКОМ, а не пару {muted, muted_until}
// (решение Р4). Дефект, который это чинит, был сквозным: UI предлагал «на час»,
// клиент слал срок, база его хранила — а кадр отдавал булево, и «на час»
// работало как «навсегда».
func TestDialogMuteFrameCarriesNotifySettings(t *testing.T) {
	in, _, _, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	const owner int64 = 7
	chatID, err := in.CreateGroup(ctx, owner, "Team", "", "", false, nil)
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	settingsOf := func(t *testing.T) map[string]any {
		t.Helper()
		d := lastFrameFor(t, pub, owner)
		ns, _ := d["notify_settings"].(map[string]any)
		if ns == nil || ns["_"] != domain.PeerNotifySettingsTag {
			t.Fatalf("кадр без конструктора notify_settings: %v", d)
		}
		if _, ok := d["muted"]; ok {
			t.Errorf("булев мьют остался в кадре: %v", d)
		}
		return ns
	}

	// Временный мьют: срок обязан доехать своим числом.
	until := time.Now().Add(time.Hour).Truncate(time.Second)
	pub.reset()
	if err := in.SetMute(ctx, chatID, owner, true, &until); err != nil {
		t.Fatalf("SetMute(на час): %v", err)
	}
	if got := settingsOf(t)["mute_until"]; got == nil || int64(got.(float64)) != until.Unix() {
		t.Fatalf("mute_until = %v; want %d", got, until.Unix())
	}

	// «Навсегда» — это тот же срок, только далёкий (порт MUTE_UNTIL tweb).
	pub.reset()
	if err := in.SetMute(ctx, chatID, owner, true, nil); err != nil {
		t.Fatalf("SetMute(навсегда): %v", err)
	}
	if got := settingsOf(t)["mute_until"]; got == nil || int64(got.(float64)) != domain.MuteUntilForever {
		t.Fatalf("«навсегда» = %v; want %d", got, domain.MuteUntilForever)
	}

	// Снятие — отсутствие переопределения, а не срок в прошлом.
	pub.reset()
	if err := in.SetMute(ctx, chatID, owner, false, &until); err != nil {
		t.Fatalf("SetMute(снять): %v", err)
	}
	if got, ok := settingsOf(t)["mute_until"]; ok {
		t.Fatalf("после снятия mute_until = %v; want отсутствие ключа", got)
	}
}
