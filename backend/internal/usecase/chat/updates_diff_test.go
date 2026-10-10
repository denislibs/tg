package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Разница сворачивает правку в новое сообщение: в new_messages оно уже
// правленое (текущий вид глазами зрителя), а updateEditMessage того же
// сообщения в other_updates не едет. Правка без своего сообщения в той же
// разнице — обычный апдейт с pts.
func TestUpdatesDifference_FoldsEditIntoNewMessage(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "orig"})
	if _, err := in.EditMessage(ctx, chatID, msg.ID, a, "edited", nil); err != nil {
		t.Fatal(err)
	}
	d := diffReal(t, in, b, 0)
	if len(d.NewMessages) != 1 {
		t.Fatalf("new_messages = %d, want 1", len(d.NewMessages))
	}
	var m map[string]any
	_ = json.Unmarshal(d.NewMessages[0], &m)
	if m["message"] != "edited" {
		t.Fatalf("new_messages[0].message = %v, want правленый текст", m["message"])
	}
	for _, u := range d.OtherUpdates {
		var body map[string]any
		_ = json.Unmarshal(u, &body)
		if body["_"] == domain.UpdateEditMessageTag {
			t.Fatalf("правка свёрнутого сообщения осталась в other_updates: %s", u)
		}
	}
	// Правка без нового сообщения в той же разнице — едет апдейтом, с pts.
	tail := diffReal(t, in, b, 1)
	if len(tail.NewMessages) != 0 || len(tail.OtherUpdates) != 1 {
		t.Fatalf("хвост: %d new, %d other", len(tail.NewMessages), len(tail.OtherUpdates))
	}
	var edit map[string]any
	_ = json.Unmarshal(tail.OtherUpdates[0], &edit)
	if edit["_"] != domain.UpdateEditMessageTag || edit["pts"] != float64(2) {
		t.Fatalf("хвост = %v, want updateEditMessage с pts 2", edit)
	}
}

// Удалённое до догонки сообщение в new_messages не едет; удаление — едет.
func TestUpdatesDifference_DeletedNotResurrected(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, _ := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "x"})
	if err := in.DeleteMessage(ctx, chatID, msg.ID, a, true); err != nil {
		t.Fatal(err)
	}
	d := diffReal(t, in, b, 0)
	if len(d.NewMessages) != 0 || len(d.OtherUpdates) == 0 {
		t.Fatalf("diff = %d new, %d other; want 0 new и удаление", len(d.NewMessages), len(d.OtherUpdates))
	}
}

// Канал, сдвинувшийся после date клиента, приходит в other_updates маркером
// updateChannelTooLong{channel_id} (tweb apiUpdatesManager.ts:354): пер-
// юзерный журнал постов канала не несёт.
func TestUpdatesDifference_ChannelTooLongMarker(t *testing.T) {
	in, fg, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "Новости", "", "news", true)
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)
	if _, err := in.PostToChannel(ctx, ch, 7, "пост", nil, ""); err != nil {
		t.Fatal(err)
	}
	st, err := in.UpdatesState(ctx, 8)
	if err != nil {
		t.Fatal(err)
	}
	d, err := in.UpdatesDifference(ctx, 8, st.Pts, 0)
	if err != nil {
		t.Fatal(err)
	}
	real, ok := d.(domain.UpdatesDifferenceReal)
	if !ok {
		t.Fatalf("diff = %T, want updates.difference с маркером канала", d)
	}
	found := false
	for _, u := range real.OtherUpdates {
		var body map[string]any
		_ = json.Unmarshal(u, &body)
		found = found || (body["_"] == domain.UpdateChannelTooLongTag && body["channel_id"] == float64(ch))
	}
	if !found {
		t.Fatalf("other_updates = %s, want updateChannelTooLong{channel_id:%d}", real.OtherUpdates, ch)
	}
	if real.State == nil || real.State.Pts != st.Pts {
		t.Fatalf("state = %+v, want pts %d", real.State, st.Pts)
	}
}

// updates.getChannelDifference: Empty у догнанного, Difference с постами после
// pts (final, pts — текущий), TooLong без состояния; читать может не участник
// публичного канала, но не приватного; не канал — CHANNEL_INVALID.
func TestUpdatesChannelDifference(t *testing.T) {
	in, _, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	pub, _ := in.CreateChannel(ctx, 7, "Новости", "", "news", true)
	priv, _ := in.CreateChannel(ctx, 7, "Секрет", "", "", false)
	_, _ = in.PostToChannel(ctx, pub, 7, "старый", nil, "")
	base, _ := in.channels.CurrentPts(ctx, pub)
	for _, text := range []string{"a", "b"} {
		if _, err := in.PostToChannel(ctx, pub, 7, text, nil, ""); err != nil {
			t.Fatal(err)
		}
	}
	cur, _ := in.channels.CurrentPts(ctx, pub)

	// Не участник публичного канала — читает (лента открыта без вступления).
	d, err := in.UpdatesChannelDifference(ctx, 9, pub, base, 0)
	if err != nil {
		t.Fatalf("не участник публичного: %v", err)
	}
	real, ok := d.(domain.UpdatesChannelDifferenceReal)
	if !ok || !real.PFlags["final"] || real.Pts != cur || len(real.NewMessages) != 2 {
		t.Fatalf("difference = %+v, want final, pts %d и 2 поста", d, cur)
	}

	if d, _ := in.UpdatesChannelDifference(ctx, 9, pub, cur, 0); d.Tag() != domain.UpdatesChannelDifferenceEmptyTag {
		t.Fatalf("догнанный: %s, want channelDifferenceEmpty", d.Tag())
	}
	tooLong, err := in.UpdatesChannelDifference(ctx, 9, pub, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	tl, ok := tooLong.(domain.UpdatesChannelDifferenceTooLong)
	if !ok || tl.Dialog == nil || len(tl.Messages) == 0 {
		t.Fatalf("без состояния: %+v, want channelDifferenceTooLong с диалогом и постами", tooLong)
	}
	if rd, ok := tl.Dialog.(domain.DialogReal); !ok || rd.Pts != cur {
		t.Fatalf("dialog = %+v, want pts %d", tl.Dialog, cur)
	}

	if _, err := in.UpdatesChannelDifference(ctx, 9, priv, 1, 0); !errors.Is(err, domain.ErrForbidden) && !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("приватный канал постороннему: %v, want отказ", err)
	}
	grp, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{9})
	if _, err := in.UpdatesChannelDifference(ctx, 9, grp, 1, 0); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("группа: %v, want ErrInvalid", err)
	}
}

// История канала — messages.channelMessages{pts}: из него клиент заводит
// состояние канала без диалога (tweb appMessagesManager.ts:13503-13505).
func TestChannelPtsOf(t *testing.T) {
	in, _, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "Новости", "", "news", true)
	_, _ = in.PostToChannel(ctx, ch, 7, "a", nil, "")
	cur, _ := in.channels.CurrentPts(ctx, ch)
	if pts, ok, err := in.ChannelPtsOf(ctx, ch); err != nil || !ok || pts != cur || cur == 0 {
		t.Fatalf("ChannelPtsOf = %d %v %v, want %d", pts, ok, err, cur)
	}
	grp, _, _ := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{9})
	if _, ok, _ := in.ChannelPtsOf(ctx, grp); ok {
		t.Fatal("у группы нет журнала канала")
	}
}

// Ревью #410, №1: разница отдана срезом (журнал > syncLimit). Маркер
// updateChannelTooLong приходит и на срезе (страницы применяются одинаково,
// tweb :344-357), а дата среза — дата его последней строки, а не «сейчас»:
// иначе следующая страница спрашивала маркеры каналов от момента первой
// страницы и теряла все каналы, сдвинувшиеся за офлайн.
func TestUpdatesDifference_SliceKeepsChannelMarkers(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const user, channel int64 = 2, 77
	s.seedChat(channel, domain.ChatTypeChannel, user)
	body := json.RawMessage(`{"_":"updateReadHistoryOutbox","peer":{"_":"peerUser","user_id":1},"max_id":1}`)
	for k := 0; k <= syncLimit; k++ {
		if _, err := in.updates.AppendUpdate(ctx, user, 1, 1000+int64(k), "read", body); err != nil {
			t.Fatal(err)
		}
	}
	d, err := in.UpdatesDifference(ctx, user, 0, 900)
	if err != nil {
		t.Fatal(err)
	}
	real, ok := d.(domain.UpdatesDifferenceReal)
	if !ok || real.Underscore != domain.UpdatesDifferenceSliceTag || real.IntermediateState == nil {
		t.Fatalf("ответ = %T %+v, want updates.differenceSlice", d, d)
	}
	if got := real.IntermediateState.Date; got != 1000+int64(syncLimit-1) {
		t.Fatalf("intermediate_state.date = %d, want дату последней строки среза %d", got, 1000+syncLimit-1)
	}
	marker := false
	for _, u := range real.OtherUpdates {
		var b map[string]any
		_ = json.Unmarshal(u, &b)
		marker = marker || (b["_"] == domain.UpdateChannelTooLongTag && b["channel_id"] == float64(channel))
	}
	if !marker {
		t.Fatal("на срезе нет updateChannelTooLong сдвинувшегося канала")
	}
}

// racyUpdates дописывает строку журнала между чтением состояния и журнала —
// ровно та гонка, при которой state.pts отставал от отданных строк.
type racyUpdates struct {
	fakeUpdates
	once *bool
}

func (r racyUpdates) UpdatesSince(ctx context.Context, userID, sincePts int64, limit int) ([]domain.UpdateRecord, error) {
	if !*r.once {
		*r.once = true
		_, _ = r.fakeUpdates.AppendUpdate(ctx, userID, 1, 5, "read",
			json.RawMessage(`{"_":"updateReadHistoryOutbox","peer":{"_":"peerUser","user_id":1},"max_id":2}`))
	}
	return r.fakeUpdates.UpdatesSince(ctx, userID, sincePts, limit)
}

// Ревью #410, №2: строка, закоммиченная между чтением состояния и журнала,
// отдана — значит state.pts не меньше её pts; иначе следующая разница от
// старого pts отдала бы её второй раз.
func TestUpdatesDifference_StateCoversReturnedRows(t *testing.T) {
	s := newStore()
	once := false
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, racyUpdates{fakeUpdates{s}, &once}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	ctx := context.Background()
	body := json.RawMessage(`{"_":"updateReadHistoryOutbox","peer":{"_":"peerUser","user_id":1},"max_id":1}`)
	if _, err := in.updates.AppendUpdate(ctx, 2, 1, 1, "read", body); err != nil {
		t.Fatal(err)
	}
	real := diffReal(t, in, 2, 0)
	if len(real.OtherUpdates) != 2 || real.State.Pts != 2 {
		t.Fatalf("other=%d state.pts=%d, want 2 строки и pts 2", len(real.OtherUpdates), real.State.Pts)
	}
}

// racyChannel дописывает пост в журнал канала между чтением pts и журнала.
type racyChannel struct {
	ChannelRepo
	channelID int64
	once      *bool
}

func (r racyChannel) UpdatesSince(ctx context.Context, channelID, sincePts int64, limit int) ([]domain.ChannelUpdate, error) {
	if !*r.once {
		*r.once = true
		_, _ = r.ChannelRepo.AppendUpdate(ctx, channelID, "chat_update",
			json.RawMessage(`{"_":"updateChannelBoostStatus","peer":{"_":"peerChannel","channel_id":1}}`))
	}
	return r.ChannelRepo.UpdatesSince(ctx, channelID, sincePts, limit)
}

// Ревью #410, №2 для канала: pts ответа покрывает отданные строки.
func TestUpdatesChannelDifference_PtsCoversReturnedRows(t *testing.T) {
	in, _, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "Новости", "", "news", true)
	_, _ = in.PostToChannel(ctx, ch, 7, "a", nil, "")
	base, _ := in.channels.CurrentPts(ctx, ch)
	_, _ = in.PostToChannel(ctx, ch, 7, "b", nil, "")
	once := false
	in.channels = racyChannel{in.channels, ch, &once}
	d, err := in.UpdatesChannelDifference(ctx, 9, ch, base, 0)
	if err != nil {
		t.Fatal(err)
	}
	real, ok := d.(domain.UpdatesChannelDifferenceReal)
	cur, _ := in.channels.CurrentPts(ctx, ch)
	if !ok || real.Pts != cur || len(real.OtherUpdates)+len(real.NewMessages) != 2 {
		t.Fatalf("difference = %+v, want pts %d и обе строки", d, cur)
	}
}

// Ревью #410, №6: сообщение чата, которого у зрителя больше нет, в разницу
// не идёт — other_updates применяются раньше new_messages, и после удаления
// чата оно воскресло бы.
func TestUpdatesDifference_GoneChatNotResurrected(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "x"}); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	delete(s.members[chatID], b) // чата у зрителя больше нет
	delete(s.chatType, chatID)
	s.mu.Unlock()
	if d := diffReal(t, in, b, 0); len(d.NewMessages) != 0 {
		t.Fatalf("сообщение исчезнувшего чата воскресло: %s", d.NewMessages[0])
	}
}
