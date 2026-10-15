package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф-6 f6-typing (VA2-05): «печатает» несёт top_msg_id — серверный номер корня
// треда или темы (tweb messages.setTyping{top_msg_id}, appMessagesManager.ts:
// 13917-13921; приём — appProfileManager.ts:1408-1419).

func typingAct() domain.SendMessageAction {
	return domain.SendMessageActionByTag(domain.SendMessageTypingActionTag)
}

func seqPtr(n int64) *int64 { return &n }

func TestTyping_GroupCarriesTopMsgID(t *testing.T) {
	in, _, _, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	const owner, member int64 = 7, 8
	chatID, _, err := in.CreateGroup(ctx, owner, "Team", "", "", false, []int64{member})
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	pub.reset()

	if err := in.Typing(ctx, chatID, owner, seqPtr(5), typingAct()); err != nil {
		t.Fatalf("Typing: %v", err)
	}
	d := lastFrameOfType(t, pub, member, "typing")
	if d["_"] != domain.UpdateChannelUserTypingTag {
		t.Fatalf("кадр = %v", d["_"])
	}
	if asInt64(t, d["top_msg_id"]) != 5 {
		t.Fatalf("top_msg_id = %v; ждали 5", d["top_msg_id"])
	}
	assertEncodesAsTL(t, d)

	// Без треда ключа нет вовсе.
	pub.reset()
	if err := in.Typing(ctx, chatID, owner, nil, typingAct()); err != nil {
		t.Fatalf("Typing: %v", err)
	}
	d = lastFrameOfType(t, pub, member, "typing")
	if _, has := d["top_msg_id"]; has {
		t.Fatalf("у печати вне треда появился top_msg_id: %#v", d)
	}
}

func TestTyping_PrivateCarriesTopMsgID(t *testing.T) {
	in, _ := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	if err := in.Typing(ctx, chatID, a, seqPtr(3), typingAct()); err != nil {
		t.Fatalf("Typing: %v", err)
	}
	d := lastFrameOfType(t, pub, b, "typing")
	if d["_"] != domain.UpdateUserTypingTag || asInt64(t, d["top_msg_id"]) != 3 {
		t.Fatalf("кадр = %#v", d)
	}
	assertEncodesAsTL(t, d)
}

// Нулевой и отрицательный номер — не тред.
func TestTyping_NonPositiveTopMsgIgnored(t *testing.T) {
	in, _, _, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	chatID, _, err := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8})
	if err != nil {
		t.Fatal(err)
	}
	pub.reset()
	if err := in.Typing(ctx, chatID, 7, seqPtr(0), typingAct()); err != nil {
		t.Fatal(err)
	}
	d := lastFrameOfType(t, pub, 8, "typing")
	if _, has := d["top_msg_id"]; has {
		t.Fatalf("top_msg_id=0 попал в кадр: %#v", d)
	}
}

// Гость обсуждения (читает канал, не участник группы) печатает в треде
// комментариев — участники группы это видят; вне треда зеркала — отказ.
func TestTyping_DiscussionGuest(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	f.pub.reset()

	if err := f.i.Typing(ctx, f.disc, 8, seqPtr(f.mirror.Seq), typingAct()); err != nil {
		t.Fatalf("гость в треде зеркала: %v", err)
	}
	d := lastFrameOfType(t, f.pub, 9, "typing")
	if asInt64(t, d["top_msg_id"]) != f.mirror.Seq {
		t.Fatalf("top_msg_id = %v; ждали %d", d["top_msg_id"], f.mirror.Seq)
	}
	if from, _ := d["from_id"].(map[string]any); asInt64(t, from["user_id"]) != 8 {
		t.Fatalf("автор = %#v", d["from_id"])
	}
	if f.pub.countFor(8) != 0 {
		t.Fatal("печать вернулась самому гостю")
	}

	// Без треда и в тред не-зеркала гость не печатает.
	if err := f.i.Typing(ctx, f.disc, 8, nil, typingAct()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("гость вне треда = %v, want ErrForbidden", err)
	}
	plain, err := f.i.Send(ctx, SendInput{ChatID: f.disc, SenderID: 9, Text: "member msg"})
	if err != nil {
		t.Fatal(err)
	}
	f.pub.reset()
	if err := f.i.Typing(ctx, f.disc, 8, seqPtr(plain.Seq), typingAct()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("гость в тред не-зеркала = %v, want ErrForbidden", err)
	}
	// Несуществующий номер.
	if err := f.i.Typing(ctx, f.disc, 8, seqPtr(9999), typingAct()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("гость в несуществующий тред = %v, want ErrForbidden", err)
	}
	if f.pub.countFor(9) != 0 {
		t.Fatal("отказанная печать гостя дошла участнику")
	}
}

// Гость печатает только там, где может писать: с join_to_send группа требует
// вступления, и «печатает» от него не уходит (tweb: нет права писать — нет
// setTyping, canSendToPeer).
func TestTyping_DiscussionGuest_JoinToSendForbidden(t *testing.T) {
	f := newDiscussionFixture(t)
	ctx := context.Background()
	if err := f.fg.SetJoinToSend(ctx, f.disc, true); err != nil {
		t.Fatal(err)
	}
	f.pub.reset()
	if err := f.i.Typing(ctx, f.disc, 8, seqPtr(f.mirror.Seq), typingAct()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("гость при join_to_send = %v, want ErrForbidden", err)
	}
	if f.pub.countFor(9) != 0 {
		t.Fatal("печать гостя при join_to_send дошла участнику")
	}
}

// Посторонний (не участник и не гость) не печатает ни в тред, ни вне него.
func TestTyping_StrangerForbidden(t *testing.T) {
	in, _, _, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	chatID, _, err := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8})
	if err != nil {
		t.Fatal(err)
	}
	pub.reset()
	if err := in.Typing(ctx, chatID, 99, seqPtr(5), typingAct()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("посторонний в тред = %v, want ErrForbidden", err)
	}
	if err := in.Typing(ctx, chatID, 99, nil, typingAct()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("посторонний = %v, want ErrForbidden", err)
	}
	if pub.countFor(7) != 0 || pub.countFor(8) != 0 {
		t.Fatal("печать постороннего дошла участникам")
	}
}

// Печатает только тот, кому можно писать (tweb setTyping → canSendToPeer,
// appMessagesManager.ts:13900): запрет отправки по умолчанию и личный запрет
// глушат печать участника; админ печатает всегда.
func TestTyping_RequiresSendRights(t *testing.T) {
	in, _, fg, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	const owner, member, other int64 = 7, 8, 9
	chatID, _, err := in.CreateGroup(ctx, owner, "Team", "", "", false, []int64{member, other})
	if err != nil {
		t.Fatal(err)
	}
	// личный запрет писать у member
	if err := fg.SetRestriction(ctx, domain.MemberRestriction{ChatID: chatID, UserID: member, DeniedRights: domain.PermSendMessages}); err != nil {
		t.Fatal(err)
	}
	pub.reset()
	if err := in.Typing(ctx, chatID, member, nil, typingAct()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("ограниченный участник = %v, want ErrForbidden", err)
	}
	if pub.countFor(owner) != 0 || pub.countFor(other) != 0 {
		t.Fatal("печать ограниченного дошла участникам")
	}
	// запрет писать по умолчанию: обычный участник глушится, админ - нет
	if err := fg.SetPermissions(ctx, chatID, domain.AllMemberPerms&^domain.PermSendMessages, 0); err != nil {
		t.Fatal(err)
	}
	if err := in.Typing(ctx, chatID, other, nil, typingAct()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("участник при запрете по умолчанию = %v, want ErrForbidden", err)
	}
	if err := in.Typing(ctx, chatID, owner, nil, typingAct()); err != nil {
		t.Fatalf("создатель: %v", err)
	}
	if pub.countFor(other) != 1 {
		t.Fatalf("печать создателя не дошла участнику: %d", pub.countFor(other))
	}
}
