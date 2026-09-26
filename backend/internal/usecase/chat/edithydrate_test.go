package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Правка подписи у фото: и ответ, и кадр edit_message несут то же сообщение,
// что история, — с собранным вложением и агрегатом реакций. Кадр правки
// заменяет сообщение на клиенте целиком (tweb onUpdateEditMessage), поэтому
// вложение без гидрации пропадает из бабла, а отсутствие `reactions` гасит
// реакции (клиентский mergeReactions(prev, undefined) → undefined). Своё
// сообщение у автора — pFlags.out, как в истории.
func TestEditMessage_CaptionOnPhotoHydratedLikeHistory(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	const mediaID int64 = 91
	s.seedMedia(mediaID, a)
	s.seedMediaDims(mediaID, domain.MediaSource{Mime: "image/jpeg", Width: 1280, Height: 720, Size: 26941})
	id := mediaID
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "photo", MediaID: &id, Text: "было"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React: %v", err)
	}

	pub.reset()
	got, err := in.EditMessage(ctx, chatID, msg.ID, a, "стало", nil)
	if err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if _, ok := got.Media.(*domain.MessageMediaPhoto); !ok {
		t.Fatalf("ответ правки без вложения: Media = %#v", got.Media)
	}
	if len(got.Reactions) != 1 {
		t.Fatalf("ответ правки без реакций: %#v", got.Reactions)
	}

	for _, uid := range []int64{a, b} {
		body := frameOfType(t, pub, uid, "edit_message")
		inner, ok := body["message"].(map[string]any)
		if !ok {
			t.Fatalf("кадр %d без сообщения: %#v", uid, body)
		}
		media, _ := inner["media"].(map[string]any)
		if media["_"] != "messageMediaPhoto" {
			t.Fatalf("кадр правки у %d: вложение = %#v, ждали messageMediaPhoto", uid, inner["media"])
		}
		if _, ok := inner["reactions"].(map[string]any); !ok {
			t.Fatalf("кадр правки у %d без reactions: %#v", uid, inner)
		}
		flags, _ := inner["pFlags"].(map[string]any)
		if out := flags["out"] == true; out != (uid == a) {
			t.Fatalf("pFlags.out у %d = %v, ждали %v", uid, out, uid == a)
		}
	}
}

// Правка подписи у платного фото: автору (ответ и его кадр) — открытое
// вложение, остальным — заблокированная копия, как у живого new_message.
// Гидрация правки не должна раздать байты неоплаченного медиа.
func TestEditMessage_PaidPhotoLockedForOthers(t *testing.T) {
	in, s, _, _ := newPaidInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	msgID, _ := sendPaidPhoto(t, in, s, 20)
	cur, err := in.msgs.GetByID(ctx, msgID)
	if err != nil {
		t.Fatal(err)
	}

	pub.reset()
	got, err := in.EditMessage(ctx, cur.ChatID, msgID, 1, "подпись", nil)
	if err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if got.PaidMediaLocked || got.MediaID == nil || got.PaidMediaPrice == nil {
		t.Fatalf("автору ответ должен быть открытым с ценой: locked=%v media=%v price=%v",
			got.PaidMediaLocked, got.MediaID, got.PaidMediaPrice)
	}
	mediaOf := func(uid int64) string {
		inner, _ := frameOfType(t, pub, uid, "edit_message")["message"].(map[string]any)
		media, _ := inner["media"].(map[string]any)
		ext, _ := media["extended_media"].([]any)
		if len(ext) == 1 {
			e, _ := ext[0].(map[string]any)
			return e["_"].(string)
		}
		s, _ := media["_"].(string)
		return s
	}
	if m := mediaOf(2); m != "messageExtendedMediaPreview" {
		t.Fatalf("получателю ушло %q, ждали заблокированный messageExtendedMediaPreview", m)
	}
	if m := mediaOf(1); m == "messageExtendedMediaPreview" || m == "" {
		t.Fatalf("автору ушло %q, ждали открытое вложение", m)
	}
}
