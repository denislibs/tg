package chat

// Регрессии ревью #403: копия сообщения переносит содержимое, но не права на
// него — платное медиа продаётся исходником, опрос и чек-лист принадлежат
// автору оригинала, живая геопозиция копии — снимок, цитата не выдаёт скрытое,
// пересланный пост канала не раскрывает админа.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// [S1] Пересылка платного медиа: копия продаётся тем же предложением —
// пересылающий не видит её даром, выручку получает автор оригинала.
func TestForward_PaidMediaSoldByOriginal(t *testing.T) {
	in, s, fs, pm := newPaidInteractor()
	ctx := context.Background()
	msgID, mediaID := sendPaidPhoto(t, in, s, 20) // Алиса(1) → Боб(2), 20⭐
	src, _ := in.msgs.GetByID(ctx, msgID)
	dst, _ := in.CreatePrivateChat(ctx, 2, 3)

	out, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src.ChatID, ToChatID: dst, MsgIDs: []int64{msgID}, SenderID: 2})
	if err != nil {
		t.Fatalf("ForwardMessages: %v", err)
	}
	if !out[0].PaidMediaLocked || out[0].MediaID != nil {
		t.Fatalf("копия у пересылающего открыта: locked=%v media=%v", out[0].PaidMediaLocked, out[0].MediaID)
	}
	if locked, _ := pm.LockedMedia(ctx, 2, mediaID); !locked {
		t.Fatal("байты медиа открыты пересылающему, который его не покупал")
	}
	cp, _ := in.msgs.GetByID(ctx, out[0].ID)
	view := []domain.Message{cp}
	in.hydratePaidMedia(ctx, 2, view)
	if !view[0].PaidMediaLocked {
		t.Fatal("история: копия открыта пересылающему")
	}

	// Покупка копии третьим: платит Алисе, не Бобу; открывает и копию.
	if _, err := in.TopUpStars(ctx, 3, 50); err != nil {
		t.Fatal(err)
	}
	if _, _, err := in.UnlockPaidMedia(ctx, out[0].ID, 3); err != nil {
		t.Fatalf("UnlockPaidMedia: %v", err)
	}
	if bal, _ := fs.Balance(ctx, 1); bal != 20 {
		t.Fatalf("выручка автора оригинала %d, want 20", bal)
	}
	if bal, _ := fs.Balance(ctx, 2); bal != 0 {
		t.Fatalf("выручка пересылающего %d, want 0", bal)
	}
	view = []domain.Message{cp}
	in.hydratePaidMedia(ctx, 3, view)
	if view[0].PaidMediaLocked {
		t.Fatal("купивший видит копию закрытой")
	}
}

// Зеркало платного поста в группе обсуждения продаётся постом и выходит закрытым.
func TestMirror_PaidMediaLocked(t *testing.T) {
	s := newStore()
	fg := newFakeGroupRepo()
	in := New(fakeTx{}, groupMembershipChats{fg, s}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, nil, newFakeChannelRepo(), newFakeSearchRepo(), nil)
	in.SetChannelPublisher(&fakeChannelPublisher{})
	pm := newFakePaidMedia(s)
	in.SetPaidMedia(pm)
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	fg.onSetDiscussion = s.seedDiscussion
	s.seedMedia(42, 7)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := in.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	mid, price := int64(42), int64(10)
	post, err := in.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", MediaID: &mid, PaidMediaPrice: &price})
	if err != nil {
		t.Fatal(err)
	}
	id, err := in.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil || id == 0 {
		t.Fatalf("зеркала нет: %v", err)
	}
	mirror, _ := in.msgs.GetByID(ctx, id)
	view := []domain.Message{mirror}
	in.hydratePaidMedia(ctx, 8, view)
	if view[0].PaidMediaPrice == nil || !view[0].PaidMediaLocked || view[0].MediaID != nil {
		t.Fatalf("зеркало платного поста открыто даром: price=%v locked=%v", view[0].PaidMediaPrice, view[0].PaidMediaLocked)
	}
	if locked, _ := pm.LockedMedia(ctx, 8, 42); !locked {
		t.Fatal("байты зеркала открыты участнику группы")
	}
}

// pollGroups — Алиса(7) и Боб(8) в группе-источнике, Боб и Кэрол(9) — в группе-приёмнике.
func pollGroups(t *testing.T) (*Interactor, *fakePublisher, int64, int64) {
	t.Helper()
	in, fg, _, src := gateGroup(t)
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	fg.users[9] = domain.UserReal{ID: 9, FirstName: "Кэрол"}
	dst, _, err := in.CreateGroup(context.Background(), 8, "Bob's", "", "", false, []int64{9})
	if err != nil {
		t.Fatal(err)
	}
	return in, pub, src, dst
}

// [S2] Пересланный опрос — тот же опрос (Telegram): голосуют и в чате копии,
// а закрывает только автор оригинала — пересылающий автором не становится.
func TestPoll_ForwardedCopy(t *testing.T) {
	in, pub, src, dst := pollGroups(t)
	fp := newFakePolls()
	in.SetPolls(fp)
	ctx := context.Background()
	poll, _ := fp.Create(ctx, domain.Poll{ChatID: src, Question: "q", Options: []string{"a", "b"}})
	orig, err := in.Send(ctx, SendInput{ChatID: src, SenderID: 7, Type: "poll", PollID: &poll.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{orig.ID}, SenderID: 8}); err != nil {
		t.Fatal(err)
	}
	if err := in.ClosePoll(ctx, poll.ID, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("пересылающий закрыл чужой опрос: %v", err)
	}
	pub.reset()
	if _, err := in.VotePoll(ctx, poll.ID, 9, []int{0}); err != nil {
		t.Fatalf("голос в чате копии: %v", err)
	}
	if framesOfType(pub, 9, "poll_update") == 0 || framesOfType(pub, 7, "poll_update") == 0 {
		t.Fatal("итоги не дошли в оба чата")
	}
	if err := in.ClosePoll(ctx, poll.ID, 7); err != nil {
		t.Fatalf("автор оригинала закрывает: %v", err)
	}
}

// [S2] Пересланный чек-лист — снимок только для чтения: пересылающий в нём не
// хозяин, а пункты, добавленные потом в оригинал, в копию не попадают.
func TestChecklist_ForwardedSnapshotReadOnly(t *testing.T) {
	in, _, src, dst := pollGroups(t)
	fc := newFakeChecklists()
	in.SetChecklists(fc)
	ctx := context.Background()
	orig, err := in.SendChecklist(ctx, SendChecklistInput{ChatID: src, SenderID: 7, Title: "todo", Items: []string{"a"}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{orig.ID}, SenderID: 8})
	if err != nil {
		t.Fatal(err)
	}
	cp := out[0]
	if cp.ChecklistID == nil || *cp.ChecklistID == *orig.ChecklistID {
		t.Fatalf("копия делит чек-лист с оригиналом: %v", cp.ChecklistID)
	}
	if _, err := in.ToggleChecklistItem(ctx, *cp.ChecklistID, 1, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("отметка в пересланном чек-листе: %v, want ErrForbidden", err)
	}
	if _, err := in.ToggleChecklistItem(ctx, *orig.ChecklistID, 1, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("пересылающий отметил чужой чек-лист: %v", err)
	}
	if _, err := in.AddChecklistItems(ctx, *orig.ChecklistID, 7, []string{"секретный пункт"}); err != nil {
		t.Fatalf("автор добавляет: %v", err)
	}
	info, _ := fc.Info(ctx, *cp.ChecklistID)
	if len(info.Items) != 1 {
		t.Fatalf("в копию утёк пункт из оригинала: %+v", info.Items)
	}
}

// [S2] Пересланная живая геопозиция — снимок: копию не двигает ни
// пересылающий, ни кто-либо ещё.
func TestForward_LiveLocationIsSnapshot(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	src, _ := in.CreatePrivateChat(ctx, 1, 2)
	dst, _ := in.CreatePrivateChat(ctx, 2, 3)
	period := 900
	live, err := in.Send(ctx, SendInput{ChatID: src, SenderID: 1, Type: "geo", GeoLat: f64(1), GeoLng: f64(2), GeoLivePeriod: &period})
	if err != nil {
		t.Fatal(err)
	}
	out, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{live.ID}, SenderID: 2})
	if err != nil {
		t.Fatal(err)
	}
	if out[0].GeoLivePeriod != nil {
		t.Fatal("пересланная live-точка осталась живой")
	}
	if _, err := in.UpdateLiveLocation(ctx, dst, out[0].ID, 2, 50, 50, nil, false); err == nil {
		t.Fatal("пересылающий двигает «Переслано от Алисы»")
	}
}

// [S2] Цитата невидимого оригинала (очищенное у себя, скрытая предыстория)
// сбрасывается молча: 400/200 по сверке выдавали бы текст чужого сообщения.
func TestReplyQuote_InvisibleOriginalNoOracle(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	chat, _ := in.CreatePrivateChat(ctx, 1, 2)
	secret, _ := in.Send(ctx, SendInput{ChatID: chat, SenderID: 1, Text: "пароль: abc"})
	if err := in.ClearHistory(ctx, chat, 2); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"пароль: a", "пароль: z"} {
		q := q
		m, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: 2, Text: "?", ReplyToID: &secret.Seq, ReplyQuoteText: &q})
		if err != nil {
			t.Fatalf("цитата %q невидимого: %v (оракул)", q, err)
		}
		if m.ReplyQuoteText != nil {
			t.Fatalf("цитата невидимого сохранена: %q", *m.ReplyQuoteText)
		}
	}
}

// [S2] Пересылка поста канала и зеркала не раскрывает админа-автора:
// fwd_from — канал.
func TestForward_ChannelPostAttributedToChannel(t *testing.T) {
	in, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := in.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	post, err := in.PostToChannel(ctx, ch, 7, "без подписи", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	mirrorID, _ := in.msgs.MirrorByPost(ctx, ch, post.ID)
	dst, _ := in.CreateChannel(ctx, 7, "Dst", "", "", true)
	for name, from := range map[string]struct{ chat, msg int64 }{"пост": {ch, post.ID}, "зеркало": {disc, mirrorID}} {
		out, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: from.chat, ToChatID: dst, MsgIDs: []int64{from.msg}, SenderID: 7})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		c := out[0]
		if c.FwdFromUserID != nil || c.FwdFromName != nil || c.FwdFromChatID == nil || *c.FwdFromChatID != ch {
			t.Fatalf("%s: fwd_from user=%v name=%v chat=%v, want канал %d", name, c.FwdFromUserID, c.FwdFromName, c.FwdFromChatID, ch)
		}
	}
}

// [S3] Копия несёт только inline-кнопки: reply-клавиатура бота — команда полю
// ввода чата, в чужом чате её быть не должно.
func TestCopyContent_InlineMarkupOnly(t *testing.T) {
	inline := domain.ReplyInlineMarkup{Underscore: "replyInlineMarkup"}
	if c := copyContent(domain.Message{ReplyMarkup: inline}); c.ReplyMarkup == nil {
		t.Fatal("inline-кнопки потеряны")
	}
	kb := domain.ReplyKeyboardMarkup{Underscore: "replyKeyboardMarkup"}
	if c := copyContent(domain.Message{ReplyMarkup: kb}); c.ReplyMarkup != nil {
		t.Fatal("reply-клавиатура переехала в копию")
	}
}

// [S3] Ключ альбома не обходит медленный режим: он бывает только у медиа и
// только пока альбом догружается.
func TestSlowmode_AlbumKeyNoBypass(t *testing.T) {
	in, _, s, id := gateGroup(t)
	ctx := context.Background()
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 60); err != nil {
		t.Fatal(err)
	}
	s.seedMedia(301, 8)
	m := int64(301)
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Type: "photo", MediaID: &m, GroupedID: 55}); err != nil {
		t.Fatal(err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "текст с ключом альбома", GroupedID: 55}); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("текст с ключом альбома: %v, want ErrSlowmode", err)
	}
	// Альбом, начатый давно, новым элементом не продолжить.
	s.mu.Lock()
	for idx := range s.messages[id] {
		s.messages[id][idx].CreatedAt = time.Now().Add(-50 * time.Second)
	}
	s.mu.Unlock()
	s.seedMedia(302, 8)
	m2 := int64(302)
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Type: "photo", MediaID: &m2, GroupedID: 55}); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("элемент давнего альбома: %v, want ErrSlowmode", err)
	}
}

// [S3] Розыгрыш — медиа для запрета send_media.
func TestForward_GiveawayIsMedia(t *testing.T) {
	in, _, s, id := gateGroup(t)
	ctx := context.Background()
	gid := int64(5)
	g, err := (fakeMsgs{s}).Insert(ctx, domain.Message{ChatID: id, Seq: 100, SenderID: 7, Type: "giveaway", GiveawayID: &gid})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms&^domain.PermSendMedia, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: id, ToChatID: id, MsgIDs: []int64{g.ID}, SenderID: 8}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("розыгрыш при запрете медиа: %v, want ErrForbidden", err)
	}
}

// staleCalls — хранилище, у которого Get не видит чужой свежий ответ (окно
// гонки двух устройств между Get и Accept).
type staleCalls struct{ *fakePhoneCalls }

func (s staleCalls) Get(ctx context.Context, id string) (domain.PhoneCall, error) {
	c, err := s.fakePhoneCalls.Get(ctx, id)
	c.AcceptedAt = time.Time{}
	return c, err
}

// [S3] Два устройства вызываемого приняли одновременно: звонящему уходит один
// call_accept (иначе два offer/answer — glare).
func TestPhoneCall_ConcurrentAcceptOneWinner(t *testing.T) {
	in, _, calls, pub := newCallInteractor()
	in.SetPhoneCalls(staleCalls{calls})
	relay(t, in, "call_request", callerID, calleeID, `{"call_id":"c1"}`)
	relay(t, in, "call_accept", calleeID, callerID, `{"call_id":"c1"}`)
	relay(t, in, "call_accept", calleeID, callerID, `{"call_id":"c1"}`)
	if n := framesOfType(pub, callerID, "call_accept"); n != 1 {
		t.Fatalf("звонящему ушло %d call_accept, want 1", n)
	}
}

// [S2] Живую точку двигает только её автор у СВОЕГО сообщения: копия с живым
// периодом (записанная до снимка) пересылающим не двигается.
func TestLiveLocation_CopyNotMovable(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	chat, _ := in.CreatePrivateChat(ctx, 2, 3)
	period, alice := 900, int64(1)
	cp, err := (fakeMsgs{s}).Insert(ctx, domain.Message{ChatID: chat, Seq: 1, SenderID: 2, Type: "geo",
		GeoLat: f64(1), GeoLng: f64(2), GeoLivePeriod: &period, FwdFromUserID: &alice})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.UpdateLiveLocation(ctx, chat, cp.ID, 2, 50, 50, nil, false); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("пересылающий двигает копию: %v, want ErrForbidden", err)
	}
}
