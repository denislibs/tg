package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestEnableDiscussion_NonAdminForbidden(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_ = fg.AddMember(context.Background(), ch, 8, domain.RoleSubscriber, 0)

	if _, err := i.EnableDiscussion(context.Background(), ch, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-admin EnableDiscussion = %v, want ErrForbidden", err)
	}
}

func TestEnableDiscussion_CreatorAndIdempotent(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)

	gid, err := i.EnableDiscussion(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	if gid == 0 {
		t.Fatal("expected a non-zero discussion group id")
	}
	// creator is a member of the new discussion group
	if m, err := fg.GetMember(context.Background(), gid, 7); err != nil || m.Role != domain.RoleCreator {
		t.Fatalf("creator membership in discussion group = %+v err=%v", m, err)
	}
	// second call is idempotent -> same id
	gid2, err := i.EnableDiscussion(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("second EnableDiscussion: %v", err)
	}
	if gid2 != gid {
		t.Fatalf("idempotent EnableDiscussion = %d, want %d", gid2, gid)
	}
}

func TestLinkDiscussion_LinksExistingGroup(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	// actor 7 owns a plain group.
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 7)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleCreator, domain.AllRights)

	got, err := i.LinkDiscussion(ctx, ch, gid, 7)
	if err != nil || got != gid {
		t.Fatalf("LinkDiscussion = %d, %v; want %d", got, err, gid)
	}
	if cur, _ := fg.GetDiscussion(ctx, ch); cur != gid {
		t.Fatalf("discussion not set: %d", cur)
	}
}

func TestLinkDiscussion_ForumRejected(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 7)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleCreator, domain.AllRights)
	_ = fg.SetForum(ctx, gid, true)

	if _, err := i.LinkDiscussion(ctx, ch, gid, 7); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("forum group link = %v, want ErrForbidden", err)
	}
}

func TestLinkDiscussion_NotGroupAdminRejected(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 99)
	_ = fg.AddMember(ctx, gid, 99, domain.RoleCreator, domain.AllRights)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleMember, 0) // actor is a plain member

	if _, err := i.LinkDiscussion(ctx, ch, gid, 7); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-admin group link = %v, want ErrForbidden", err)
	}
}

func TestUnlinkDiscussion(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	gid, _ := fg.CreateMultiMember(ctx, "group", "Chat", "", "", false, 7)
	_ = fg.AddMember(ctx, gid, 7, domain.RoleCreator, domain.AllRights)
	if _, err := i.LinkDiscussion(ctx, ch, gid, 7); err != nil {
		t.Fatal(err)
	}
	if err := i.UnlinkDiscussion(ctx, ch, 7); err != nil {
		t.Fatalf("UnlinkDiscussion: %v", err)
	}
	if cur, _ := fg.GetDiscussion(ctx, ch); cur != 0 {
		t.Fatalf("discussion still set: %d", cur)
	}
}

func TestDiscussionCandidates(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	// eligible: plain group where 7 is creator
	g1, _ := fg.CreateMultiMember(ctx, "group", "Eligible", "", "", false, 7)
	_ = fg.AddMember(ctx, g1, 7, domain.RoleCreator, domain.AllRights)
	// ineligible: forum group
	g2, _ := fg.CreateMultiMember(ctx, "group", "Forum", "", "", false, 7)
	_ = fg.AddMember(ctx, g2, 7, domain.RoleCreator, domain.AllRights)
	_ = fg.SetForum(ctx, g2, true)
	// ineligible: 7 is only a member
	g3, _ := fg.CreateMultiMember(ctx, "group", "Member", "", "", false, 99)
	_ = fg.AddMember(ctx, g3, 7, domain.RoleMember, 0)

	cands, err := i.DiscussionCandidates(ctx, 7)
	if err != nil {
		t.Fatalf("DiscussionCandidates: %v", err)
	}
	if len(cands) != 1 || cands[0].ID != g1 {
		t.Fatalf("candidates = %+v, want only %d", cands, g1)
	}
}

func TestSetSignatures(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	if err := i.SetSignatures(ctx, ch, 7, true, true); err != nil {
		t.Fatalf("SetSignatures on: %v", err)
	}
	if c, _ := fg.Card(ctx, ch, 7); !c.Signatures || !c.SignatureProfiles {
		t.Fatalf("signatures not set: %+v", c)
	}
	// profiles forced off when signatures off.
	if err := i.SetSignatures(ctx, ch, 7, false, true); err != nil {
		t.Fatalf("SetSignatures off: %v", err)
	}
	if c, _ := fg.Card(ctx, ch, 7); c.Signatures || c.SignatureProfiles {
		t.Fatalf("signatures should be off: %+v", c)
	}
	// non-admin forbidden.
	if err := i.SetSignatures(ctx, ch, 8, true, false); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-admin SetSignatures = %v, want ErrForbidden", err)
	}
}

func TestPostComment_DiscussionsOff_NotFound(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)

	if _, err := i.PostComment(context.Background(), ch, 100, 8, "hi", ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("PostComment with discussions off = %v, want ErrNotFound", err)
	}
}

func TestPostComment_ThreadsAndAutoJoins(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	gid, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	// комментарий тредится не на самом посте, а на его зеркале в группе
	// обсуждения — нужен реальный пост (мимо PostToChannel), чтобы зеркало
	// действительно появилось.
	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	mirrorID, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil || mirrorID == 0 {
		t.Fatalf("MirrorByPost: id=%d err=%v", mirrorID, err)
	}

	msg, err := i.PostComment(ctx, ch, post.ID, 8, "first comment", "c1")
	if err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	// the inserted message lands in the discussion group with ThreadRootID set
	if msg.ChatID != gid {
		t.Fatalf("comment ChatID=%d, want discussion group %d", msg.ChatID, gid)
	}
	if msg.ThreadRootID == nil || *msg.ThreadRootID != mirrorID {
		t.Fatalf("comment ThreadRootID=%v, want mirror %d", msg.ThreadRootID, mirrorID)
	}
	// commenter auto-joined the discussion group
	if _, err := fg.GetMember(ctx, gid, 8); err != nil {
		t.Fatalf("commenter not auto-joined: %v", err)
	}
}

func TestListComments_ReturnsThreadAndCount(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	// карточки комментаторов нужны CommentCounts: он отдаёт их клиенту под стек
	// аватаров в футере «N комментариев»
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}
	fg.users[9] = domain.UserReal{ID: 9, FirstName: "Алиса"}
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}

	post1, err := i.PostToChannel(ctx, ch, 7, "post1", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel post1: %v", err)
	}
	post2, err := i.PostToChannel(ctx, ch, 7, "post2", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel post2: %v", err)
	}

	if _, err := i.PostComment(ctx, ch, post1.ID, 8, "c1", "k1"); err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	if _, err := i.PostComment(ctx, ch, post1.ID, 9, "c2", "k2"); err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	// a comment on a different post must not leak into this thread
	if _, err := i.PostComment(ctx, ch, post2.ID, 9, "other", "k3"); err != nil {
		t.Fatalf("PostComment: %v", err)
	}

	msgs, cnt, err := i.ListComments(ctx, ch, post1.ID, 7, 0, 50)
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if cnt != 2 || len(msgs) != 2 {
		t.Fatalf("ListComments count=%d len=%d, want 2/2", cnt, len(msgs))
	}
	if msgs[0].Text != "c1" || msgs[1].Text != "c2" {
		t.Fatalf("thread order = %q,%q, want c1,c2", msgs[0].Text, msgs[1].Text)
	}

	// 300 — заведомо несуществующий пост (без зеркала): счёт обязан остаться
	// нулевым, а не упасть ошибкой резолва.
	replies, users, err := i.CommentCounts(ctx, ch, []int64{post1.ID, post2.ID, 300})
	if err != nil {
		t.Fatalf("CommentCounts: %v", err)
	}
	if replies[post1.ID].Replies != 2 || replies[post2.ID].Replies != 1 {
		t.Fatalf("CommentCounts = %v", replies)
	}
	if _, ok := replies[300]; ok {
		t.Fatalf("пост без зеркала получил тред: %v", replies[300])
	}
	// Группа обсуждения — channel_id конструктора, и делит бит с pFlags.comments.
	if replies[post1.ID].ChannelID != disc || !replies[post1.ID].PFlags["comments"] {
		t.Fatalf("messageReplies = %+v, ждали ссылку на группу обсуждения", replies[post1.ID])
	}
	// Авторы последних комментариев — ССЫЛКИ на пиров внутри треда, а карточки
	// едут ОДНИМ вектором users на весь ответ (прежде карточка дублировалась в
	// каждом посте).
	if len(replies[post1.ID].RecentRepliers) == 0 {
		t.Fatalf("recent repliers for post = %v, want non-empty", replies[post1.ID].RecentRepliers)
	}
	seen := map[int64]bool{}
	for _, u := range users {
		if seen[u.ID] {
			t.Fatalf("карточка пира продублирована в векторе users: %v", users)
		}
		seen[u.ID] = true
	}
	for _, p := range replies[post1.ID].RecentRepliers {
		if !seen[p.PeerID().ToUserID()] {
			t.Fatalf("ссылка на пира %v не подкреплена карточкой в users", p)
		}
	}
}

// Комментарий приземляется в тред ЗЕРКАЛА, а чтение по (канал, пост) его находит.
func TestComments_ThreadOnMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	post, _ := i.PostToChannel(ctx, ch, 7, "hello", nil, "")

	if _, err := i.PostComment(ctx, ch, post.ID, 8, "первый", "c1"); err != nil {
		t.Fatal(err)
	}

	mirrorID, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	msgs, count, err := i.ListComments(ctx, ch, post.ID, 8, 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || len(msgs) != 1 {
		t.Fatalf("ListComments = %d сообщений, count=%d; want 1/1", len(msgs), count)
	}
	if msgs[0].ThreadRootID == nil || *msgs[0].ThreadRootID != mirrorID {
		t.Fatalf("комментарий висит на %v, а корень треда — зеркало %d", msgs[0].ThreadRootID, mirrorID)
	}

	replies, users, err := i.CommentCounts(ctx, ch, []int64{post.ID})
	if err != nil {
		t.Fatal(err)
	}
	if replies[post.ID].Replies != 1 {
		t.Fatalf("CommentCounts[post] = %d, want 1", replies[post.ID].Replies)
	}
	rec := replies[post.ID].RecentRepliers
	if len(rec) != 1 || rec[0].PeerID() != domain.PeerID(8) {
		t.Fatalf("recent repliers = %+v, want ссылку на автора 8", rec)
	}
	if len(users) != 1 || users[0].ID != 8 {
		t.Fatalf("вектор users = %+v, want карточку автора 8", users)
	}
}

// Гонка за ленивое создание зеркала: пост опубликован ДО EnableDiscussion, у
// него ещё нет зеркала. Первый комментарий должен его завести — но что если
// параллельно к тому же посту пришёл ещё один первый комментарий и выиграл
// гонку? Insert проигравшего падает на уникальном индексе
// uq_messages_discussion_mirror (см. миграцию 0093), хотя зеркало к этому
// моменту уже есть. PostComment обязан не пробрасывать эту ошибку наружу
// 500-й, а тихо взять уже созданное зеркало и приземлить комментарий в него.
func TestPostComment_RaceLazyMirror_UsesWinnersMirror(t *testing.T) {
	failNext := false
	i, _, _, _ := newChannelTestInteractorMsgs(t, func(s *store) MessageRepo {
		return racyMirrorMsgs{fakeMsgs: fakeMsgs{s}, failNextMirrorInsert: &failNext}
	})
	ctx := context.Background()

	// Пост опубликован БЕЗ обсуждения (зеркала не будет), обсуждение включаем
	// уже потом — ровно сценарий, для которого существует ленивая дозаводка.
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	if root, _ := i.msgs.MirrorByPost(ctx, ch, post.ID); root != 0 {
		t.Fatalf("зеркало уже есть до первого комментария: %d", root)
	}

	failNext = true // следующая вставка зеркала «проиграет» гонку
	comment, err := i.PostComment(ctx, ch, post.ID, 8, "первый", "c1")
	if err != nil {
		t.Fatalf("PostComment вернул ошибку вместо приземления в чужое зеркало: %v", err)
	}
	if failNext {
		t.Fatal("racyMirrorMsgs.Insert для зеркала ни разу не звали — гонка не смоделирована")
	}

	root, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil || root == 0 {
		t.Fatalf("MirrorByPost после гонки = %d, %v; зеркало обязано существовать", root, err)
	}
	if comment.ThreadRootID == nil || *comment.ThreadRootID != root {
		t.Fatalf("комментарий висит на %v, а зеркало-«победитель» — %d", comment.ThreadRootID, root)
	}
}

// Комментарий к удалённому посту не должен лениво заводить зеркало и
// проходить — GetByID видит Deleted и обязан вернуть domain.ErrNotFound, как
// и для несуществующего/чужого поста.
func TestPostComment_DeletedPost_NotFound(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	if err := i.msgs.SoftDelete(ctx, post.ID); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}

	if _, err := i.PostComment(ctx, ch, post.ID, 8, "первый", "c1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("PostComment на удалённый пост = %v, want ErrNotFound", err)
	}
	if root, _ := i.msgs.MirrorByPost(ctx, ch, post.ID); root != 0 {
		t.Fatalf("зеркало заведено для удалённого поста: %d", root)
	}
}

// HTTP и WS обязаны отдавать один и тот же thread_root_id для одного и того
// же комментария. HTTP-хендлер комментариев (channel_handler.go) уже
// перезаписывает thread_root_id на id ПОСТА в JSON-ответе (контракт покрыт
// TestChannelDiscussion_HTTP, http-пакет). Здесь проверяем вторую половину:
// live-кадр WS того же Send() несёт тот же id поста, а не id зеркала, на
// котором тред физически висит внутри (см. externalThreadRootID,
// discussion_mirror.go) — иначе клиент ключевал бы одно и то же окно треда
// по-разному в истории (HTTP) и в реальном времени (WS).
func TestPostComment_WSFrame_ThreadRootMatchesPost(t *testing.T) {
	s := newStore()
	fg := newFakeGroupRepo()
	fch := newFakeChannelRepo()
	fs := newFakeSearchRepo()
	// groupMembershipChatsFanout + fakeUpdates — единственная комбинация в
	// пакете, где Send() реально фанаутит live-кадры per-member (обычный
	// стаб groupMembershipChats.MemberIDs всегда nil, см. его комментарий).
	i := New(fakeTx{}, groupMembershipChatsFanout{groupMembershipChats{fg, s}}, fakeMsgs{s},
		fakeUpdates{s}, nil, fakeMedia{s}, fg, nil, fch, fs, nil)
	i.SetChannelPublisher(&fakeChannelPublisher{})
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	fg.onSetDiscussion = s.seedDiscussion
	pub := &fakePublisher{}
	i.SetPublisher(pub)

	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}

	comment, err := i.PostComment(ctx, ch, post.ID, 8, "первый", "c1")
	if err != nil {
		t.Fatalf("PostComment: %v", err)
	}
	mirrorID, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	// Внутреннее представление (в БД и в возвращённом domain.Message) остаётся
	// зеркалом — это то, чем тред физически держится, а не то, что видит клиент.
	if comment.ThreadRootID == nil || *comment.ThreadRootID != mirrorID {
		t.Fatalf("внутренний ThreadRootID = %v, want зеркало %d", comment.ThreadRootID, mirrorID)
	}

	var env struct {
		T string `json:"t"`
		D struct {
			Message struct {
				ID      int64 `json:"id"`
				ReplyTo *struct {
					ReplyToTopID *int64 `json:"reply_to_top_id"`
				} `json:"reply_to"`
			} `json:"message"`
		} `json:"d"`
	}
	found := false
	for _, f := range pub.frames {
		if f.userID != 8 {
			continue
		}
		if err := json.Unmarshal(f.frame, &env); err != nil {
			t.Fatalf("frame decode: %v", err)
		}
		if env.T == "new_message" && env.D.Message.ID == comment.Seq {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("не нашли new_message WS-кадр для комментария %d автору 8", comment.Seq)
	}
	// Корень треда — reply_to.reply_to_top_id, и он ВСЕГДА в том же пире: у
	// комментария это номер ЗЕРКАЛА поста в группе обсуждения, где комментарий
	// и живёт. Прежде наружу ехал номер поста В КАНАЛЕ — пара «пир + номер»
	// была неполна, пир корня ехал неявно.
	mirror, err := i.msgs.GetByID(ctx, mirrorID)
	if err != nil {
		t.Fatalf("зеркало не читается: %v", err)
	}
	if env.D.Message.ReplyTo == nil || env.D.Message.ReplyTo.ReplyToTopID == nil ||
		*env.D.Message.ReplyTo.ReplyToTopID != mirror.Seq {
		t.Fatalf("reply_to_top_id = %+v, want номер зеркала %d в группе обсуждения",
			env.D.Message.ReplyTo, mirror.Seq)
	}
}
