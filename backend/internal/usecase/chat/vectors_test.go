package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// chatIDsIn — id чатов вектора `chats`.
func chatIDsIn(chats []domain.Chat) map[int64]domain.Chat {
	out := make(map[int64]domain.Chat, len(chats))
	for _, c := range chats {
		out[c.PeerID().ToChatID()] = c
	}
	return out
}

// A4-03: контейнер сообщений везёт карточки ВСЕХ чатов, на которые
// ссылается: чат самого сообщения и группу обсуждения из replies.channel_id.
// Прежде вектор `chats` не наполнялся никогда.
func TestMessagesContainer_ChatsVector(t *testing.T) {
	in, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := in.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	post, err := in.PostToChannel(ctx, ch, 7, "пост", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	rows, _ := in.msgs.GetByIDs(ctx, []int64{post.ID})
	// Зритель 9 — посторонний читатель публичного канала: в диалогах у него
	// нет ни канала, ни группы обсуждения.
	_, _, chats, err := in.MessagesContainer(ctx, 9, rows)
	if err != nil {
		t.Fatalf("MessagesContainer: %v", err)
	}
	got := chatIDsIn(chats)
	if got[ch] == nil || got[disc] == nil {
		t.Fatalf("chats = %v, want канал %d и группу обсуждения %d", got, ch, disc)
	}
}

// A4-04 + A4-10: корень треда комментариев — messages.discussionMessage с
// карточками группы обсуждения и канала, и группа в нём читаема (не min,
// default_banned_rights группы): без неё композер треда показывал «Отправка
// сообщений запрещена».
func TestDiscussionContainer(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	disc, _ := in.EnableDiscussion(ctx, ch, 7)
	post, _ := in.PostToChannel(ctx, ch, 7, "пост", nil, "")
	c1, err := in.PostComment(ctx, ch, post.ID, 8, "c1", "k1")
	if err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	_ = fg.AddMember(ctx, ch, 9, domain.RoleSubscriber, 0)

	out, err := in.DiscussionContainer(ctx, ch, post.ID, 9)
	if err != nil {
		t.Fatalf("DiscussionContainer: %v", err)
	}
	if out.Underscore != domain.MessagesDiscussionMessageTag || len(out.Messages) != 1 {
		t.Fatalf("ответ = %s с %d сообщениями", out.Underscore, len(out.Messages))
	}
	got := chatIDsIn(out.Chats)
	group, ok := got[disc].(domain.Channel)
	if !ok || got[ch] == nil {
		t.Fatalf("chats = %v, want группу %d и канал %d", got, disc, ch)
	}
	if group.PFlags["min"] || group.DefaultBanned == nil || group.DefaultBanned.Denies("send_messages") {
		t.Fatalf("группа обсуждения подписчику: %+v, want читаемую полную форму", group)
	}
	if out.MaxID == nil || *out.MaxID != c1.Seq {
		t.Fatalf("max_id = %v, want номер последнего комментария %d", out.MaxID, c1.Seq)
	}
	// Подписчик в группе не состоит — горизонта прочтения нет.
	if out.ReadInboxMaxID != nil || out.UnreadCount != 0 {
		t.Fatalf("не участнику: read_inbox_max_id=%v unread=%d, want нет", out.ReadInboxMaxID, out.UnreadCount)
	}

	// Комментатор (вступил в группу) — горизонт группы и непрочитанное.
	mine, err := in.DiscussionContainer(ctx, ch, post.ID, 7)
	if err != nil || mine.ReadInboxMaxID == nil {
		t.Fatalf("участнику: %+v %v, want read_inbox_max_id", mine, err)
	}

	page, err := in.CommentsContainer(ctx, ch, post.ID, 9, 0, 50)
	if err != nil {
		t.Fatalf("CommentsContainer: %v", err)
	}
	if got := chatIDsIn(page.Chats); got[disc] == nil || got[ch] == nil {
		t.Fatalf("комментарии: chats = %v, want группу и канал", got)
	}
}

// A4-12: карточка канала везёт в `chats` связанную группу обсуждения.
func TestChatFullContainer_LinkedChat(t *testing.T) {
	in, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	disc, _ := in.EnableDiscussion(ctx, ch, 7)
	out, err := in.ChatFullContainer(ctx, ch, 7)
	if err != nil {
		t.Fatalf("ChatFullContainer: %v", err)
	}
	if got := chatIDsIn(out.Chats); got[ch] == nil || got[disc] == nil || len(out.Chats) != 2 {
		t.Fatalf("chats = %v, want канал %d и группу %d", got, ch, disc)
	}
}

// A4-15: карточка чата на личку — ошибка запроса, а не channel с внутренним
// id строки лички.
func TestChatCard_PrivateIsInvalid(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	id, _ := fg.CreateMultiMember(ctx, domain.ChatTypePrivate, "", "", "", false, 7)
	_ = fg.AddMember(ctx, id, 7, domain.RoleMember, 0)
	if _, err := in.ChatCard(ctx, id, 7); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("ChatCard(личка) = %v, want ErrInvalid", err)
	}
}

// A4-14: список, ссылающийся на пользователей (удалённые: участник и
// kicked_by), получает их карточки вектором — одним вызовом по самому телу.
func TestPeerVectorsOf_Participants(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Алиса"}
	out := []domain.ChannelParticipant{domain.NewChannelParticipantBanned(8, 7, 0, domain.AllMemberPerms, time.Time{}, true)}
	users, _ := in.PeerVectorsOf(context.Background(), 7, out)
	got := map[int64]bool{}
	for _, u := range users {
		got[u.ID] = true
	}
	if !got[8] || !got[7] {
		t.Fatalf("users = %v, want выгнанного 8 и выгнавшего 7", got)
	}
}
