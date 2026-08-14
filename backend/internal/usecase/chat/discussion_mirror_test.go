package chat

import (
	"context"
	"testing"
)

// Публикация поста в канал с обсуждением кладёт зеркало в группу: автор бабла —
// канал (send_as), атрибуция пересылки указывает на пост, тред живёт на зеркале.
func TestPostToChannel_CreatesMirror(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	_ = fg

	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatal(err)
	}

	mirrorID, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mirrorID == 0 {
		t.Fatal("зеркало не создано")
	}
	m, err := i.msgs.GetByID(ctx, mirrorID)
	if err != nil {
		t.Fatal(err)
	}
	if m.ChatID != disc {
		t.Fatalf("зеркало в чате %d, ожидалась группа обсуждения %d", m.ChatID, disc)
	}
	if m.SendAsChatID == nil || *m.SendAsChatID != ch {
		t.Fatalf("send_as_chat_id = %v, ожидался канал %d", m.SendAsChatID, ch)
	}
	if m.FwdFromChatID == nil || *m.FwdFromChatID != ch || m.FwdFromMsgID == nil || *m.FwdFromMsgID != post.ID {
		t.Fatalf("атрибуция пересылки неверна: %v/%v", m.FwdFromChatID, m.FwdFromMsgID)
	}
	if m.ThreadRootID != nil {
		t.Fatalf("зеркало само корень треда, thread_root_id должен быть nil, got %v", m.ThreadRootID)
	}
	if !m.IsDiscussionMirror {
		t.Fatal("флаг is_discussion_mirror не выставлен")
	}
	if m.Text != post.Text {
		t.Fatalf("текст зеркала %q, ожидался %q", m.Text, post.Text)
	}
}

// Канал без обсуждения: зеркала нет, публикация не падает.
func TestPostToChannel_NoDiscussion_NoMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatalf("публикация в канал без обсуждения упала: %v", err)
	}
	id, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id != 0 {
		t.Fatalf("зеркало создано без группы обсуждения: %d", id)
	}
}

// Повторный вызов хелпера на том же посте не плодит зеркал (ретрай/гонка).
func TestMirrorChannelPost_Idempotent(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	post, _ := i.PostToChannel(ctx, ch, 7, "hello", nil, "")

	first, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err := i.mirrorChannelPost(ctx, post); err != nil {
		t.Fatalf("повторное зеркалирование вернуло ошибку: %v", err)
	}
	second, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if second != first {
		t.Fatalf("повторный вызов создал новое зеркало: было %d, стало %d", first, second)
	}
}
