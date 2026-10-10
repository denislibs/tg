package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф-5, БЭК-1: адресация тем номером, General = 1, служебка TopicEdit, кадры
// закрепа и мьюта темы, кадр включения форума, форма reply_to тем (A1-16).

// forumGroup — форум из gateGroup: владелец 7, участник 8, своя тема.
func forumGroup(t *testing.T) (*Interactor, *fakeTopicRepo, *fakePublisher, int64, domain.Message) {
	t.Helper()
	in, _, _, id := gateGroup(t)
	ft := newFakeTopicRepo()
	in.SetTopics(ft)
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	if err := in.SetForum(ctx, id, 7, true); err != nil {
		t.Fatalf("SetForum: %v", err)
	}
	_, root, err := in.CreateTopic(ctx, id, 7, "Тема", "🔥", 2)
	if err != nil {
		t.Fatalf("CreateTopic: %v", err)
	}
	pub.reset()
	return in, ft, pub, id, root
}

func TestSetForum_ChatUpdateToMembers(t *testing.T) {
	in, _, _, id := gateGroup(t)
	in.SetTopics(newFakeTopicRepo())
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	if err := in.SetForum(context.Background(), id, 7, true); err != nil {
		t.Fatal(err)
	}
	for _, uid := range []int64{7, 8} {
		if framesOfType(pub, uid, "chat_update") != 1 {
			t.Errorf("участник %d не узнал о включении форума", uid)
		}
	}
}

func TestCreateTopic_NumberIsServiceSeq(t *testing.T) {
	in, ft, _, id, root := forumGroup(t)
	ctx := context.Background()
	a, ok := root.Action.(domain.MessageActionTopicCreate)
	if !ok || a.Title != "Тема" || a.IconEmojiEmoticon != "🔥" {
		t.Fatalf("служебка создания = %#v", root.Action)
	}
	topic, err := ft.ByNumber(ctx, id, root.Seq)
	if err != nil || topic.Number() != root.Seq {
		t.Fatalf("тема по номеру служебки: %+v, %v", topic, err)
	}
	if g, err := in.topicByNumber(ctx, id, domain.GeneralTopicID); err != nil || !g.IsGeneral {
		t.Fatalf("номер 1 — не General: %+v, %v", g, err)
	}
}

func TestEditTopic_ServiceMessageInTopic(t *testing.T) {
	in, ft, pub, id, root := forumGroup(t)
	ctx := context.Background()
	title, closed := "Новое", true
	m, err := in.EditTopic(ctx, id, root.Seq, 7, TopicEdit{Title: &title, Closed: &closed})
	if err != nil || m == nil {
		t.Fatalf("EditTopic: %v, %v", m, err)
	}
	a, ok := m.Action.(domain.MessageActionTopicEdit)
	if !ok || a.Title == nil || *a.Title != title || a.Closed == nil || !*a.Closed || a.Hidden != nil || a.IconEmojiEmoticon != nil {
		t.Fatalf("служебка правки = %#v", m.Action)
	}
	if m.ThreadRootID == nil || *m.ThreadRootID != root.ID {
		t.Fatalf("служебка правки не в теме: root=%v", m.ThreadRootID)
	}
	topic, _ := ft.ByNumber(ctx, id, root.Seq)
	if topic.Title != title || !topic.Closed {
		t.Fatalf("строка темы не изменилась: %+v", topic)
	}
	for _, uid := range []int64{7, 8} {
		if framesOfType(pub, uid, "new_message") != 1 {
			t.Errorf("участник %d не получил служебку правки", uid)
		}
	}

	// На проводе служебка правки — сообщение темы: forum_topic и номер темы.
	wire, err := in.MessagesWire(ctx, 8, []domain.Message{*m})
	if err != nil {
		t.Fatal(err)
	}
	svc, ok := wire[0].(domain.MessageService)
	if !ok || svc.ReplyTo == nil || svc.ReplyTo.ReplyToMsgID != root.Seq || svc.ReplyTo.ReplyToTopID != 0 ||
		!svc.ReplyTo.PFlags["forum_topic"] {
		t.Fatalf("reply_to служебки правки = %+v", wire[0])
	}

	// Ничего не изменилось — служебки нет.
	pub.reset()
	if m, err := in.EditTopic(ctx, id, root.Seq, 7, TopicEdit{Title: &title}); err != nil || m != nil {
		t.Fatalf("пустая правка: %v, %v", m, err)
	}
	if framesOfType(pub, 8, "new_message") != 0 {
		t.Fatal("пустая правка разослала служебку")
	}
}

func TestEditTopic_General(t *testing.T) {
	in, ft, _, id, _ := forumGroup(t)
	ctx := context.Background()
	hidden := true
	m, err := in.EditTopic(ctx, id, domain.GeneralTopicID, 7, TopicEdit{Hidden: &hidden})
	if err != nil || m == nil {
		t.Fatalf("скрыть General: %v, %v", m, err)
	}
	if m.ThreadRootID != nil {
		t.Fatalf("служебка General легла в тред %v; у General треда нет", *m.ThreadRootID)
	}
	if g, _ := ft.ByNumber(ctx, id, domain.GeneralTopicID); !g.Hidden {
		t.Fatal("General не скрыта")
	}
	closed := true
	if _, err := in.EditTopic(ctx, id, domain.GeneralTopicID, 7, TopicEdit{Closed: &closed}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("закрыть General = %v, ждали ErrForbidden", err)
	}
	if _, err := in.SetTopicPinned(ctx, id, domain.GeneralTopicID, 7, true); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("закрепить General = %v, ждали ErrForbidden", err)
	}
	wire, err := in.MessagesWire(ctx, 8, []domain.Message{*m})
	if err != nil {
		t.Fatal(err)
	}
	if svc := wire[0].(domain.MessageService); svc.ReplyTo != nil {
		t.Fatalf("служебка General с reply_to: %+v", svc.ReplyTo)
	}
}

func TestSetTopicPinned_FrameToAllMembers(t *testing.T) {
	in, ft, pub, id, root := forumGroup(t)
	ctx := context.Background()
	update, err := in.SetTopicPinned(ctx, id, root.Seq, 7, true)
	if err != nil || update.TopicID != root.Seq || !update.PFlags["pinned"] {
		t.Fatalf("SetTopicPinned: %+v, %v", update, err)
	}
	if topic, _ := ft.ByNumber(ctx, id, root.Seq); !topic.Pinned {
		t.Fatal("тема не закреплена")
	}
	for _, uid := range []int64{7, 8} {
		d := lastFrameOfType(t, pub, uid, "topic_pin")
		flags, _ := d["pFlags"].(map[string]any)
		if d["_"] != domain.UpdatePinnedForumTopicTag || d["topic_id"] != float64(root.Seq) || flags["pinned"] != true {
			t.Errorf("кадр закрепа участнику %d = %v", uid, d)
		}
	}
	if _, err := in.SetTopicPinned(ctx, id, root.Seq, 7, false); err != nil {
		t.Fatal(err)
	}
	if d := lastFrameOfType(t, pub, 8, "topic_pin"); d["pFlags"] != nil {
		t.Fatalf("открепление несёт pFlags: %v", d)
	}
}

func TestSetTopicMuteUntil_DeadlineToOwnDevices(t *testing.T) {
	in, ft, pub, id, root := forumGroup(t)
	ctx := context.Background()
	until := time.Now().Add(time.Hour).Unix()
	if err := in.SetTopicMuteUntil(ctx, id, root.Seq, 8, until); err != nil {
		t.Fatal(err)
	}
	if got := ft.muteUntil[[3]int64{id, root.ID, 8}]; got == nil || got.Unix() != until {
		t.Fatalf("срок мьюта = %v, ждали %d", got, until)
	}
	d := lastFrameOfType(t, pub, 8, "topic_mute")
	peer, _ := d["peer"].(map[string]any)
	settings, _ := d["notify_settings"].(map[string]any)
	if d["_"] != domain.UpdateNotifySettingsTag || peer["_"] != domain.NotifyForumTopicTag ||
		peer["top_msg_id"] != float64(root.Seq) || settings["mute_until"] != float64(until) {
		t.Fatalf("кадр мьюта темы = %v", d)
	}
	if framesOfType(pub, 7, "topic_mute") != 0 {
		t.Fatal("мьют темы — личный, а кадр ушёл другому участнику")
	}
	// Снять: 0 — срока нет, в кадре явный MuteUntilNever.
	if err := in.SetTopicMuteUntil(ctx, id, root.Seq, 8, domain.MuteUntilNever); err != nil {
		t.Fatal(err)
	}
	if got := ft.muteUntil[[3]int64{id, root.ID, 8}]; got != nil {
		t.Fatalf("мьют не снят: %v", got)
	}
	if s, _ := lastFrameOfType(t, pub, 8, "topic_mute")["notify_settings"].(map[string]any); s["mute_until"] != float64(0) {
		t.Fatalf("снятие мьюта: %v", s)
	}
	// General — номером 1, ключ состояния — корень 0.
	if err := in.SetTopicMuteUntil(ctx, id, domain.GeneralTopicID, 8, domain.MuteUntilForever); err != nil {
		t.Fatal(err)
	}
	if got := ft.muteUntil[[3]int64{id, 0, 8}]; got == nil || got.Unix() != domain.MuteUntilForever {
		t.Fatalf("мьют General = %v", got)
	}
}

// A1-16 + General: перевод номера треда на входе и форма reply_to на выходе.
func TestForumThreadAddressing(t *testing.T) {
	in, _, _, id, root := forumGroup(t)
	ctx := context.Background()
	general := domain.GeneralTopicID

	if got, err := in.ResolveThreadRootForSend(ctx, id, &general); err != nil || got != nil {
		t.Fatalf("отправка в General: root=%v, %v; ждали «без треда»", got, err)
	}
	if got := in.resolveThreadRootForQuery(ctx, id, &general); got == nil || *got != domain.GeneralThreadRoot {
		t.Fatalf("выборка General: %v", got)
	}
	n := root.Seq
	if got, err := in.ResolveThreadRootForSend(ctx, id, &n); err != nil || got == nil || *got != root.ID {
		t.Fatalf("отправка в тему: %v, %v", got, err)
	}
	// TL-форма inputReplyToMessage{reply_to_msg_id: тред, top_msg_id: тред}.
	x := int64(42)
	for name, c := range map[string]struct{ thread, reply, want *int64 }{
		"тред без ответа":       {&n, &n, nil},
		"General без ответа":    {&general, &general, nil},
		"General без top":       {nil, &general, nil},
		"ответ внутри темы":     {&n, &x, &x},
		"ответ вне треда":       {nil, &x, &x},
		"без ответа и без тред": {nil, nil, nil},
	} {
		got := in.ThreadReplyTo(ctx, id, c.thread, c.reply)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("%s: ThreadReplyTo = %v, ждали %v", name, got, c.want)
		}
	}

	// Сообщение темы и сообщение General на проводе.
	inTopic, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "в теме", ThreadRootID: &root.ID})
	if err != nil {
		t.Fatal(err)
	}
	inGeneral, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "в General"})
	if err != nil {
		t.Fatal(err)
	}
	wire, err := in.MessagesWire(ctx, 7, []domain.Message{inTopic, inGeneral})
	if err != nil {
		t.Fatal(err)
	}
	topicMsg := wire[0].(domain.MessageReal)
	if topicMsg.ReplyTo == nil || topicMsg.ReplyTo.ReplyToMsgID != root.Seq || topicMsg.ReplyTo.ReplyToTopID != 0 ||
		!topicMsg.ReplyTo.PFlags["forum_topic"] {
		t.Fatalf("reply_to сообщения темы = %+v", topicMsg.ReplyTo)
	}
	if generalMsg := wire[1].(domain.MessageReal); generalMsg.ReplyTo != nil {
		t.Fatalf("сообщение General с reply_to: %+v", generalMsg.ReplyTo)
	}
}

// В не-форуме номер 1 — обычный тред сообщения №1, а не General.
func TestThreadNumberOne_NotForum(t *testing.T) {
	in, _, _, id := gateGroup(t)
	in.SetTopics(newFakeTopicRepo())
	ctx := context.Background()
	one := domain.GeneralTopicID
	if got := in.resolveThreadRootForQuery(ctx, id, &one); got != nil && *got == domain.GeneralThreadRoot {
		t.Fatal("не-форум перевёл номер 1 в General")
	}
	if got := in.ThreadReplyTo(ctx, id, nil, &one); got == nil || *got != one {
		t.Fatalf("ответ на сообщение 1 в не-форуме снят: %v", got)
	}
}
