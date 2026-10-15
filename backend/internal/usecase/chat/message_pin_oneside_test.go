package chat

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// f6-pin: флаги silent / pm_oneside, «Открепить все», ответы Updates и
// affectedHistory, закреп по видимости (Р-3).

// pinRows — строки pin_message журнала пользователя (тела).
func pinRows(t *testing.T, s *store, userID int64) []map[string]any {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []map[string]any
	for _, u := range s.updates[userID] {
		if u.Type != "pin_message" {
			continue
		}
		var d map[string]any
		if err := json.Unmarshal(u.Payload, &d); err != nil {
			t.Fatalf("тело строки: %v", err)
		}
		out = append(out, d)
	}
	return out
}

func pinSeqs(t *testing.T, row map[string]any) []int64 {
	t.Helper()
	raw, _ := row["messages"].([]any)
	out := make([]int64, 0, len(raw))
	for _, v := range raw {
		out = append(out, int64(v.(float64)))
	}
	return out
}

func countMsgs(s *store, chatID int64) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.messages[chatID])
}

// privatePinEnv — личка 1↔2 с фейковым пушем и сообщением от 1.
func privatePinEnv(t *testing.T) (*Interactor, *store, *fakeNotifier, int64, domain.Message) {
	t.Helper()
	in, s := newInteractor()
	notif := &fakeNotifier{}
	in.SetNotifier(notif)
	ctx := context.Background()
	chatID, err := in.CreatePrivateChat(ctx, 1, 2)
	if err != nil {
		t.Fatalf("CreatePrivateChat: %v", err)
	}
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "важное"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	return in, s, notif, chatID, msg
}

// pm_oneside в личке: строка pin_message только актору, служебки нет, у
// собеседника закрепа нет, у актора есть.
func TestSetPin_OneSide_PrivateOnlyActor(t *testing.T) {
	in, s, _, chatID, msg := privatePinEnv(t)
	ctx := context.Background()
	before := countMsgs(s, chatID)
	upd, err := in.SetPin(ctx, chatID, msg.ID, 2, true, PinOpts{OneSide: true})
	if err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	if got := countMsgs(s, chatID); got != before {
		t.Fatalf("закреп «только у себя» оставил служебку: %d сообщений, было %d", got, before)
	}
	if rows := pinRows(t, s, 1); len(rows) != 0 {
		t.Fatalf("у собеседника строка закрепа: %v", rows)
	}
	rows := pinRows(t, s, 2)
	if len(rows) != 1 || !slices.Equal(pinSeqs(t, rows[0]), []int64{msg.Seq}) {
		t.Fatalf("у актора строки закрепа = %v", rows)
	}
	if pins, _ := in.ListPins(ctx, chatID, 1, nil); len(pins) != 0 {
		t.Fatalf("ListPins собеседника = %d, want 0", len(pins))
	}
	if pins, _ := in.ListPins(ctx, chatID, 2, nil); len(pins) != 1 {
		t.Fatalf("ListPins актора = %d, want 1", len(pins))
	}
	// Ответ — Updates с updatePinnedMessages, pts актора.
	if len(upd.Updates) != 1 {
		t.Fatalf("ответ: %d апдейтов", len(upd.Updates))
	}
	u, ok := upd.Updates[0].(domain.UpdatePinnedMessages)
	if !ok || !u.Pinned() || !slices.Equal(u.Messages, []int64{msg.Seq}) || u.Peer != domain.NewPeer(domain.PeerID(1)) {
		t.Fatalf("ответ = %#v", upd.Updates[0])
	}
	if u.Pts != s.pts[2] || u.PtsCount != 1 {
		t.Fatalf("pts ответа = %d/%d, want %d/1", u.Pts, u.PtsCount, s.pts[2])
	}
	// Флаг pinned в истории — только у актора.
	wire := func(viewer int64) bool {
		out, err := in.MessagesWire(ctx, viewer, []domain.Message{msg})
		if err != nil {
			t.Fatalf("MessagesWire: %v", err)
		}
		return out[0].(domain.MessageReal).PFlags["pinned"]
	}
	if !wire(2) || wire(1) {
		t.Fatalf("pinned в истории: актор=%v собеседник=%v", wire(2), wire(1))
	}
}

// Вне лички pm_oneside игнорируется: общий закреп со служебкой.
func TestSetPin_OneSide_IgnoredInGroup(t *testing.T) {
	in, s, chatID := pinTestSetup(t)
	ctx := context.Background()
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 7, Text: "общее"})
	before := countMsgs(s, chatID)
	if _, err := in.SetPin(ctx, chatID, msg.ID, 7, true, PinOpts{OneSide: true}); err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	if got := countMsgs(s, chatID); got != before+1 {
		t.Fatalf("в группе нет служебки: %d сообщений, было %d", got, before)
	}
	if _, ok := lastServicePill(t, s, chatID).Action.(domain.MessageActionPinMessage); !ok {
		t.Fatal("последнее сообщение не messageActionPinMessage")
	}
}

// silent: служебка «закрепил» не даёт пуша; без silent — даёт собеседнику.
func TestSetPin_SilentSuppressesPush(t *testing.T) {
	in, _, notif, chatID, msg := privatePinEnv(t)
	ctx := context.Background()
	before := len(notif.recipients)
	if _, err := in.SetPin(ctx, chatID, msg.ID, 2, true, PinOpts{Silent: true}); err != nil {
		t.Fatalf("SetPin silent: %v", err)
	}
	if len(notif.recipients) != before {
		t.Fatal("тихий закреп дал пуш")
	}
	if _, err := in.SetPin(ctx, chatID, msg.ID, 2, false, PinOpts{}); err != nil {
		t.Fatalf("Unpin: %v", err)
	}
	msg2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "второе", Silent: true})
	before = len(notif.recipients)
	if _, err := in.SetPin(ctx, chatID, msg2.ID, 2, true, PinOpts{}); err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	if len(notif.recipients) != before+1 || notif.recipients[len(notif.recipients)-1] != 1 {
		t.Fatalf("громкий закреп не дал пуш собеседнику: %v", notif.recipients)
	}
}

// DELETE закрепа в личке снимает и общий, и свой «только у себя»; без общего
// кадр уходит только актору.
func TestUnpin_PrivateRemovesSharedAndOwnOneSide(t *testing.T) {
	in, s, _, chatID, msg := privatePinEnv(t)
	ctx := context.Background()
	// Только свой «только у себя»: снятие — кадр только актору.
	if _, err := in.SetPin(ctx, chatID, msg.ID, 2, true, PinOpts{OneSide: true}); err != nil {
		t.Fatalf("SetPin oneside: %v", err)
	}
	upd, err := in.SetPin(ctx, chatID, msg.ID, 2, false, PinOpts{})
	if err != nil {
		t.Fatalf("Unpin: %v", err)
	}
	if rows := pinRows(t, s, 1); len(rows) != 0 {
		t.Fatalf("собеседнику ушла строка снятия чужого закрепа: %v", rows)
	}
	if rows := pinRows(t, s, 2); len(rows) != 2 || rows[1]["pFlags"] != nil {
		t.Fatalf("у актора строки = %v", rows)
	}
	if u := upd.Updates[0].(domain.UpdatePinnedMessages); u.Pinned() {
		t.Fatal("ответ снятия несёт pinned")
	}
	if pins, _ := in.ListPins(ctx, chatID, 2, nil); len(pins) != 0 {
		t.Fatalf("после снятия у актора закреп: %d", len(pins))
	}

	// Общий + свой: снимаются оба, кадр обоим.
	if _, err := in.SetPin(ctx, chatID, msg.ID, 2, true, PinOpts{}); err != nil {
		t.Fatalf("SetPin shared: %v", err)
	}
	if _, err := in.SetPin(ctx, chatID, msg.ID, 2, true, PinOpts{OneSide: true}); err != nil {
		t.Fatalf("SetPin oneside: %v", err)
	}
	rows1 := len(pinRows(t, s, 1))
	if _, err := in.SetPin(ctx, chatID, msg.ID, 2, false, PinOpts{}); err != nil {
		t.Fatalf("Unpin: %v", err)
	}
	if len(pinRows(t, s, 1)) != rows1+1 {
		t.Fatal("снятие общего закрепа не дошло до собеседника")
	}
	for _, uid := range []int64{1, 2} {
		if pins, _ := in.ListPins(ctx, chatID, uid, nil); len(pins) != 0 {
			t.Fatalf("после снятия у %d остался закреп", uid)
		}
	}
}

// «Открепить все»: каждому одна строка со всеми номерами; «только у себя» —
// только актору; ответ — affectedHistory с pts и числом строк актора.
func TestUnpinAll_PrivateRowsAndAffectedHistory(t *testing.T) {
	in, s, _, chatID, m1 := privatePinEnv(t)
	ctx := context.Background()
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "второе"})
	m3, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "третье"})
	for _, m := range []domain.Message{m1, m2} {
		if _, err := in.SetPin(ctx, chatID, m.ID, 2, true, PinOpts{}); err != nil {
			t.Fatalf("SetPin: %v", err)
		}
	}
	if _, err := in.SetPin(ctx, chatID, m3.ID, 2, true, PinOpts{OneSide: true}); err != nil {
		t.Fatalf("SetPin oneside: %v", err)
	}
	rows1, rows2 := len(pinRows(t, s, 1)), len(pinRows(t, s, 2))

	res, err := in.UnpinAll(ctx, chatID, 2, nil)
	if err != nil {
		t.Fatalf("UnpinAll: %v", err)
	}
	if res.Underscore != domain.MessagesAffectedHistoryTag || res.Pts != s.pts[2] || res.PtsCount != 1 || res.Offset != 0 {
		t.Fatalf("ответ = %+v, pts актора %d", res, s.pts[2])
	}
	got1, got2 := pinRows(t, s, 1), pinRows(t, s, 2)
	if len(got1) != rows1+1 || len(got2) != rows2+1 {
		t.Fatalf("строк: собеседник %d (было %d), актор %d (было %d)", len(got1), rows1, len(got2), rows2)
	}
	if last := got1[len(got1)-1]; !slices.Equal(pinSeqs(t, last), []int64{m1.Seq, m2.Seq}) || last["pFlags"] != nil {
		t.Fatalf("строка собеседника = %v", last)
	}
	if last := got2[len(got2)-1]; !slices.Equal(pinSeqs(t, last), []int64{m1.Seq, m2.Seq, m3.Seq}) || last["pFlags"] != nil {
		t.Fatalf("строка актора = %v", last)
	}
	for _, uid := range []int64{1, 2} {
		if pins, _ := in.ListPins(ctx, chatID, uid, nil); len(pins) != 0 {
			t.Fatalf("у %d остались закрепы: %d", uid, len(pins))
		}
	}

	// Нечего снимать — тот же ответ с pts_count 0 и без строк.
	rows1, rows2 = len(pinRows(t, s, 1)), len(pinRows(t, s, 2))
	res, err = in.UnpinAll(ctx, chatID, 2, nil)
	if err != nil {
		t.Fatalf("UnpinAll(пусто): %v", err)
	}
	if res.PtsCount != 0 || res.Pts != s.pts[2] {
		t.Fatalf("пустой ответ = %+v, pts актора %d", res, s.pts[2])
	}
	if len(pinRows(t, s, 1)) != rows1 || len(pinRows(t, s, 2)) != rows2 {
		t.Fatal("пустое «открепить все» записало строки")
	}
}

// Только «только у себя» актора: собеседнику строки нет.
func TestUnpinAll_OnlyOwnOneSide(t *testing.T) {
	in, s, _, chatID, msg := privatePinEnv(t)
	ctx := context.Background()
	_, _ = in.SetPin(ctx, chatID, msg.ID, 2, true, PinOpts{OneSide: true})
	rows1 := len(pinRows(t, s, 1))
	res, err := in.UnpinAll(ctx, chatID, 2, nil)
	if err != nil || res.PtsCount != 1 {
		t.Fatalf("UnpinAll = %+v, %v", res, err)
	}
	if len(pinRows(t, s, 1)) != rows1 {
		t.Fatal("собеседнику ушла строка снятия чужого закрепа")
	}
}

// С top_msg_id снимаются только закрепы треда (включая корень).
func TestUnpinAll_ThreadOnly(t *testing.T) {
	in, s, _, chatID, root := privatePinEnv(t)
	ctx := context.Background()
	inThread, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "в треде", ThreadRootID: &root.ID})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	outside, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "вне"})
	for _, m := range []domain.Message{inThread, outside} {
		if _, err := in.SetPin(ctx, chatID, m.ID, 2, true, PinOpts{}); err != nil {
			t.Fatalf("SetPin: %v", err)
		}
	}
	res, err := in.UnpinAll(ctx, chatID, 2, &root.Seq)
	if err != nil || res.PtsCount != 1 {
		t.Fatalf("UnpinAll(тред) = %+v, %v", res, err)
	}
	rows := pinRows(t, s, 2)
	if last := rows[len(rows)-1]; !slices.Equal(pinSeqs(t, last), []int64{inThread.Seq}) {
		t.Fatalf("снято %v, want только закреп треда %d", pinSeqs(t, last), inThread.Seq)
	}
	pins, _ := in.ListPins(ctx, chatID, 2, nil)
	if len(pins) != 1 || pins[0].ID != outside.ID {
		t.Fatalf("после «открепить все» в треде закрепы = %v", pins)
	}
}

// Не участник — 404, без права закреплять — 403.
func TestUnpinAll_Gates(t *testing.T) {
	in, _, _, chatID, _ := privatePinEnv(t)
	if _, err := in.UnpinAll(context.Background(), chatID, 99, nil); err != domain.ErrNotFound {
		t.Fatalf("не участник: %v, want ErrNotFound", err)
	}
}

// Broadcast: одна запись журнала канала, пер-юзерных строк нет; ответ — pts
// актора без сдвига (pts_count 0).
func TestUnpinAll_BroadcastChannelJournal(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	p1, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "один"})
	p2, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "два"})
	for _, p := range []domain.Message{p1, p2} {
		if _, err := e.i.SetPin(ctx, e.ch, p.ID, 7, true, PinOpts{}); err != nil {
			t.Fatalf("SetPin: %v", err)
		}
	}
	e.s.mu.Lock()
	ptsBefore := e.s.pts[7]
	e.s.mu.Unlock()
	chBefore := len(e.channelLog())

	res, err := e.i.UnpinAll(ctx, e.ch, 7, nil)
	if err != nil {
		t.Fatalf("UnpinAll: %v", err)
	}
	if res.PtsCount != 0 || res.Offset != 0 || res.Pts != ptsBefore {
		t.Fatalf("ответ = %+v, want pts %d, pts_count 0", res, ptsBefore)
	}
	log := e.channelLog()
	if len(log) != chBefore+1 {
		t.Fatalf("записей канала %d, want %d", len(log), chBefore+1)
	}
	last := log[len(log)-1]
	d := bodyTag(t, last.Payload)
	if last.Type != "pin_message" || d["_"] != domain.UpdatePinnedChannelMessagesTag || d["pFlags"] != nil {
		t.Fatalf("запись = %s %v", last.Type, d)
	}
	if raw, _ := d["messages"].([]any); len(raw) != 2 {
		t.Fatalf("messages = %v, want оба закрепа", d["messages"])
	}
	for _, uid := range []int64{8, 9} {
		if slices.Contains(e.userLog(uid), "pin_message") {
			t.Fatalf("в личный журнал подписчика %d лёг pin_message", uid)
		}
	}
	// Повтор — нечего снимать, новой записи канала нет.
	if _, err := e.i.UnpinAll(ctx, e.ch, 7, nil); err != nil {
		t.Fatalf("UnpinAll(пусто): %v", err)
	}
	if len(e.channelLog()) != chBefore+1 {
		t.Fatal("пустое «открепить все» канала записало строку журнала")
	}
}

// Ответ закрепа в канале — updatePinnedChannelMessages с pts канала.
func TestSetPin_BroadcastResponse(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	post, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "пост"})
	upd, err := e.i.SetPin(ctx, e.ch, post.ID, 7, true, PinOpts{})
	if err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	u, ok := upd.Updates[0].(domain.UpdatePinnedChannelMessages)
	if !ok || u.ChannelID != e.ch || !slices.Equal(u.Messages, []int64{post.Seq}) || u.PFlags["pinned"] != true {
		t.Fatalf("ответ = %#v", upd.Updates[0])
	}
	var pinPts int64
	for _, row := range e.channelLog() {
		if row.Type == "pin_message" {
			pinPts = row.Pts
		}
	}
	if u.Pts == 0 || u.Pts != pinPts || u.PtsCount != 1 {
		t.Fatalf("pts канала в ответе = %d/%d, want %d/1", u.Pts, u.PtsCount, pinPts)
	}
}

// Группа: «открепить все» — одна строка с общим телом каждому участнику (одним
// запросом в журнал), курсор каждого свой; ответ — pts актора.
func TestUnpinAll_GroupFansOutToAllMembers(t *testing.T) {
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupMembershipChatsFanout{groupMembershipChats{fg, s}}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	ctx := context.Background()
	for _, id := range []int64{7, 8, 9} {
		fg.users[id] = domain.UserReal{ID: id, FirstName: "U"}
	}
	chatID, _, err := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8, 9})
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	m1, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 7, Text: "один"})
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 7, Text: "два"})
	for _, m := range []domain.Message{m1, m2} {
		if _, err := in.SetPin(ctx, chatID, m.ID, 7, true, PinOpts{}); err != nil {
			t.Fatalf("SetPin: %v", err)
		}
	}
	before := map[int64]int{}
	for _, uid := range []int64{7, 8, 9} {
		before[uid] = len(pinRows(t, s, uid))
	}
	res, err := in.UnpinAll(ctx, chatID, 7, nil)
	if err != nil {
		t.Fatalf("UnpinAll: %v", err)
	}
	if res.PtsCount != 1 || res.Pts != s.pts[7] {
		t.Fatalf("ответ = %+v, pts актора %d", res, s.pts[7])
	}
	for _, uid := range []int64{7, 8, 9} {
		rows := pinRows(t, s, uid)
		if len(rows) != before[uid]+1 {
			t.Fatalf("у %d строк %d, want %d", uid, len(rows), before[uid]+1)
		}
		if last := rows[len(rows)-1]; !slices.Equal(pinSeqs(t, last), []int64{m1.Seq, m2.Seq}) || last["pFlags"] != nil {
			t.Fatalf("строка %d = %v", uid, last)
		}
	}
	if pins, _ := in.ListPins(ctx, chatID, 8, nil); len(pins) != 0 {
		t.Fatalf("у участника остались закрепы: %d", len(pins))
	}
}

// Сообщение закреплено и общим, и «только у себя» собеседника: снятие общего его
// закрепа не касается — ему кадр «открепили» не уходит (иначе его окно снимает бит).
func TestUnpin_KeepsOneSidePinOfOtherUser(t *testing.T) {
	in, s, _, chatID, msg := privatePinEnv(t)
	ctx := context.Background()
	_, _ = in.SetPin(ctx, chatID, msg.ID, 2, true, PinOpts{OneSide: true}) // Боб у себя
	_, _ = in.SetPin(ctx, chatID, msg.ID, 1, true, PinOpts{})              // Алиса для всех
	rowsB := len(pinRows(t, s, 2))
	if _, err := in.SetPin(ctx, chatID, msg.ID, 1, false, PinOpts{}); err != nil {
		t.Fatalf("Unpin: %v", err)
	}
	if got := len(pinRows(t, s, 2)); got != rowsB {
		t.Fatalf("Бобу ушла строка снятия общего закрепа, хотя у него свой: %d строк, было %d", got, rowsB)
	}
	if pins, _ := in.ListPins(ctx, chatID, 2, nil); len(pins) != 1 {
		t.Fatalf("у Боба свой закреп пропал: %d", len(pins))
	}
	if pins, _ := in.ListPins(ctx, chatID, 1, nil); len(pins) != 0 {
		t.Fatalf("у Алисы закреп остался: %d", len(pins))
	}
}

// То же при «Открепить все»: в кадре собеседника нет номеров, которые у него
// закреплены «только у себя»; если других нет — строки нет вовсе.
func TestUnpinAll_KeepsOneSidePinOfOtherUser(t *testing.T) {
	in, s, _, chatID, m1 := privatePinEnv(t)
	ctx := context.Background()
	m2, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "второе"})
	_, _ = in.SetPin(ctx, chatID, m1.ID, 2, true, PinOpts{OneSide: true})
	for _, m := range []domain.Message{m1, m2} {
		_, _ = in.SetPin(ctx, chatID, m.ID, 1, true, PinOpts{})
	}
	rowsB := len(pinRows(t, s, 2))
	if _, err := in.UnpinAll(ctx, chatID, 1, nil); err != nil {
		t.Fatalf("UnpinAll: %v", err)
	}
	rows := pinRows(t, s, 2)
	if len(rows) != rowsB+1 || !slices.Equal(pinSeqs(t, rows[len(rows)-1]), []int64{m2.Seq}) {
		t.Fatalf("строки Боба = %v, want последняя только с %d", rows, m2.Seq)
	}
	if pins, _ := in.ListPins(ctx, chatID, 2, nil); len(pins) != 1 || pins[0].ID != m1.ID {
		t.Fatalf("у Боба должен остаться свой закреп m1: %v", pins)
	}
}

// Закрепить можно только видимое актору: удалённое им у себя — не найдено.
func TestSetPin_InvisibleMessageNotFound(t *testing.T) {
	in, s, _, chatID, msg := privatePinEnv(t)
	ctx := context.Background()
	s.mu.Lock()
	s.hidden = map[int64]map[int64]bool{2: {msg.ID: true}}
	s.mu.Unlock()
	if _, err := in.SetPin(ctx, chatID, msg.ID, 2, true, PinOpts{}); err != domain.ErrNotFound {
		t.Fatalf("закреп скрытого у себя: %v, want ErrNotFound", err)
	}
	if rows := pinRows(t, s, 1); len(rows) != 0 {
		t.Fatalf("собеседнику ушла строка: %v", rows)
	}
	// Открепить можно и невидимое — чтобы застрявший закреп не нельзя было снять.
	if _, err := in.SetPin(ctx, chatID, msg.ID, 2, false, PinOpts{}); err != nil {
		t.Fatalf("Unpin невидимого: %v", err)
	}
}

// ListPins с номером корня — закрепы одного треда.
func TestListPins_ThreadOnly(t *testing.T) {
	in, _, _, chatID, root := privatePinEnv(t)
	ctx := context.Background()
	inThread, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "в треде", ThreadRootID: &root.ID})
	outside, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "вне"})
	for _, m := range []domain.Message{inThread, outside} {
		_, _ = in.SetPin(ctx, chatID, m.ID, 2, true, PinOpts{})
	}
	pins, err := in.ListPins(ctx, chatID, 2, &root.Seq)
	if err != nil || len(pins) != 1 || pins[0].ID != inThread.ID {
		t.Fatalf("ListPins(тред) = %v, %v", pins, err)
	}
	if all, _ := in.ListPins(ctx, chatID, 2, nil); len(all) != 2 {
		t.Fatalf("ListPins(весь чат) = %d", len(all))
	}
}
