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
