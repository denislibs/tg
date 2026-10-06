package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Регрессии пачки Ф-1а «Доступ и видимость» (аудит 2026-10-05).
// Алиса (7) — владелец, Боб (8) — посторонний или подписчик.

// newAccessTestInteractor — каналы и группы на fakeGroupRepo, плюс журнал
// обновлений: служебные сообщения состава (postGroupService) без него не
// пишутся вовсе.
func newAccessTestInteractor(t *testing.T) (*Interactor, *fakeGroupRepo, *store) {
	t.Helper()
	s := newStore()
	fg := newFakeGroupRepo()
	in := New(fakeTx{}, groupMembershipChats{fg, s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, fg, nil, newFakeChannelRepo(), newFakeSearchRepo(), nil)
	in.SetChannelPublisher(&fakeChannelPublisher{})
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	fg.onSetDiscussion = s.seedDiscussion
	return in, fg, s
}

// A5-01: WS subscribe_channel — только тому, кто канал читает.
func TestCanSubscribeChannel_PrivateNeedsMembership(t *testing.T) {
	in, fg, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	priv, _ := in.CreateChannel(ctx, 7, "Секрет", "", "", false)
	pub, _ := in.CreateChannel(ctx, 7, "Новости", "", "news", true)
	peer := func(id int64) domain.PeerID { return domain.ToPeerID(id, true) }

	if in.CanSubscribeChannel(ctx, 8, peer(priv)) {
		t.Fatal("посторонний подписался на топик приватного канала")
	}
	if !in.CanSubscribeChannel(ctx, 7, peer(priv)) {
		t.Fatal("владелец не может подписаться на свой канал")
	}
	if !in.CanSubscribeChannel(ctx, 8, peer(pub)) {
		t.Fatal("публичный канал не читается без вступления")
	}
	_ = fg.Ban(ctx, pub, 8, 7)
	if in.CanSubscribeChannel(ctx, 8, peer(pub)) {
		t.Fatal("забаненный подписался на топик публичного канала")
	}
}

// A5-03: карточка чужого приватного чата закрыта, публичного — открыта.
func TestChatCard_PrivateClosedToStranger(t *testing.T) {
	in, _, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	priv, _ := in.CreateChannel(ctx, 7, "Секрет", "о чём", "", false)
	pub, _ := in.CreateChannel(ctx, 7, "Новости", "", "news", true)

	if _, err := in.ChatCard(ctx, priv, 8); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("карточка приватного канала постороннему: %v, want ErrNotFound", err)
	}
	if c, err := in.ChatCard(ctx, priv, 7); err != nil || c.ID != priv {
		t.Fatalf("карточка владельцу: %+v %v", c, err)
	}
	if _, err := in.ChatCard(ctx, pub, 8); err != nil {
		t.Fatalf("карточка публичного канала: %v", err)
	}
}

// A5-23: публичный чат читается без вступления, приватный — нет.
func TestGetHistory_PublicReadableWithoutJoin(t *testing.T) {
	in, _, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	pub, _ := in.CreateChannel(ctx, 7, "Новости", "", "news", true)
	priv, _ := in.CreateChannel(ctx, 7, "Секрет", "", "", false)
	for _, ch := range []int64{pub, priv} {
		if _, err := in.PostToChannel(ctx, ch, 7, "пост", nil, ""); err != nil {
			t.Fatal(err)
		}
	}

	res, err := in.GetHistory(ctx, pub, 8, 0, 0, 20, nil, "")
	if err != nil || len(res.Messages) != 1 {
		t.Fatalf("история публичного канала постороннему: %d %v", len(res.Messages), err)
	}
	if _, err := in.GetHistory(ctx, priv, 8, 0, 0, 20, nil, ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("история приватного канала постороннему: %v", err)
	}
}

// A5-02: обсуждение приватного канала постороннему закрыто целиком — копия
// поста, комментарии, счётчики, тред группы, участники группы.
func TestDiscussion_PrivateChannelClosedToStranger(t *testing.T) {
	in, fg, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "Секрет", "", "", false)
	disc, err := in.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	post, err := in.PostToChannel(ctx, ch, 7, "секретный пост", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.PostComment(ctx, ch, post.ID, 7, "внутренний комментарий", "c1"); err != nil {
		t.Fatal(err)
	}
	mirror, _ := in.msgs.MirrorByPost(ctx, ch, post.ID)
	root, _ := in.msgs.SeqsByIDs(ctx, []int64{mirror})
	rootSeq := root[mirror]

	if _, err := in.GetDiscussionMessage(ctx, ch, post.ID, 8); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("GetDiscussionMessage постороннему: %v", err)
	}
	if _, _, err := in.ListComments(ctx, ch, post.ID, 8, 0, 50); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("ListComments постороннему: %v", err)
	}
	if _, _, err := in.CommentCounts(ctx, 8, ch, []int64{post.ID}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("CommentCounts постороннему: %v", err)
	}
	if _, err := in.GetHistory(ctx, disc, 8, 0, 0, 20, &rootSeq, ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("тред группы обсуждения постороннему: %v", err)
	}
	if _, err := listRecent(in, ctx, disc, 8, 50); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("участники группы обсуждения постороннему: %v", err)
	}

	// Подписчик канала читает комментарии без вступления в группу.
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)
	if _, _, err := in.ListComments(ctx, ch, post.ID, 8, 0, 50); err != nil {
		t.Fatalf("ListComments подписчику: %v", err)
	}
	if _, err := in.GetHistory(ctx, disc, 8, 0, 0, 20, &rootSeq, ""); err != nil {
		t.Fatalf("тред подписчику: %v", err)
	}
	// …но не забаненный в группе.
	_ = fg.Ban(ctx, disc, 8, 7)
	if _, _, err := in.ListComments(ctx, ch, post.ID, 8, 0, 50); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("ListComments забаненному в группе: %v", err)
	}
}

// A5-35: просмотры и бусты приватного канала постороннему не читаются и не накручиваются.
func TestViewsAndBoosts_PrivateChannelClosedToStranger(t *testing.T) {
	in, _, _ := newAccessTestInteractor(t)
	in.boosts = &fakeBoostRepo{}
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "Секрет", "", "", false)
	post, _ := in.PostToChannel(ctx, ch, 7, "пост", nil, "")

	if _, err := in.RegisterViews(ctx, ch, 8, []int64{post.ID}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("RegisterViews постороннему: %v", err)
	}
	if counts, _ := in.ViewCounts(ctx, ch, 7, []int64{post.ID}); counts[post.ID] != 0 {
		t.Fatalf("посторонний накрутил просмотр: %v", counts)
	}
	if _, err := in.ViewCounts(ctx, ch, 8, []int64{post.ID}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("ViewCounts постороннему: %v", err)
	}
	if _, err := in.BoostStatus(ctx, ch, 8); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("BoostStatus постороннему: %v", err)
	}
}

// A5-14: участников вещательного канала видят только владелец и админы.
func TestListMembers_BroadcastAdminsOnly(t *testing.T) {
	in, fg, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "Новости", "", "news", true)
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)
	_ = fg.AddMember(ctx, ch, 9, domain.RoleAdmin, domain.RightPostMessages)

	if _, err := listRecent(in, ctx, ch, 8, 50); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("подписчик получил состав канала: %v", err)
	}
	for _, admin := range []int64{7, 9} {
		if ms, err := listRecent(in, ctx, ch, admin, 50); err != nil || len(ms) != 3 {
			t.Fatalf("состав канала админу %d: %d %v", admin, len(ms), err)
		}
	}
}

// A2-01 / A3-25: состав вещательного канала служебками в ленту не пишется;
// в группе — пишется.
func TestPostGroupService_NoMembershipServiceInBroadcast(t *testing.T) {
	in, fg, s := newAccessTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "Новости", "", "", false)
	fg.users[8] = domain.UserReal{ID: 8}
	if err := in.AddMember(ctx, ch, 7, 8); err != nil {
		t.Fatalf("AddMember в канал: %v", err)
	}
	if err := in.RemoveMember(ctx, ch, 8, 8); err != nil {
		t.Fatalf("выход из канала: %v", err)
	}
	for _, m := range s.messages[ch] {
		if isMembershipAction(m.Action) {
			t.Fatalf("в ленте канала служебка состава: %#v", m.Action)
		}
	}

	grp, _, err := in.CreateGroup(ctx, 7, "Группа", "", "", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := in.AddMember(ctx, grp, 7, 8); err != nil {
		t.Fatalf("AddMember в группу: %v", err)
	}
	found := false
	for _, m := range s.messages[grp] {
		if _, ok := m.Action.(domain.MessageActionChatAddUser); ok {
			found = true
		}
	}
	if !found {
		t.Fatal("в группе пропала служебка «добавил»")
	}
}

// A3-03 / A5-05 / A3-14: сообщения по номерам — только видимые зрителю:
// очищенное у себя и скрытое у себя — messageEmpty (в выдаче их нет).
func TestMessagesBySeqs_OnlyVisible(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	s.seedChat(50, "group", 1, 2)
	var seqs []int64
	var ids []int64
	for _, txt := range []string{"старое", "скрытое", "живое"} {
		m, err := in.Send(ctx, SendInput{ChatID: 50, SenderID: 1, Text: txt})
		if err != nil {
			t.Fatal(err)
		}
		seqs, ids = append(seqs, m.Seq), append(ids, m.ID)
	}
	_ = in.chats.SetClearedSeq(ctx, 50, 2, seqs[0]) // Боб очистил историю до «старого»
	_ = in.msgs.HideForUser(ctx, 2, ids[1])         // и удалил у себя «скрытое»

	got, err := in.MessagesBySeqs(ctx, 50, 2, seqs)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Seq != seqs[2] {
		t.Fatalf("по номерам Бобу отдано %v; ждали только «живое»", msgSeqList(got))
	}
	if got, _ := in.MessagesBySeqs(ctx, 50, 1, seqs); len(got) != 3 {
		t.Fatalf("Алисе отдано %d из 3", len(got))
	}
}

// VA3-01: пересылка по номеру не берёт невидимое зрителю.
func TestForward_InvisibleSourceRejected(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	s.seedChat(50, "group", 1, 2)
	s.seedChat(51, "saved", 2)
	old, _ := in.Send(ctx, SendInput{ChatID: 50, SenderID: 1, Text: "старое"})
	live, _ := in.Send(ctx, SendInput{ChatID: 50, SenderID: 1, Text: "живое"})
	_ = in.chats.SetClearedSeq(ctx, 50, 2, old.Seq)

	if _, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: 50, ToChatID: 51, MsgIDs: []int64{old.ID}, SenderID: 2}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("пересылка очищенного: %v, want ErrNotFound", err)
	}
	if _, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: 50, ToChatID: 51, MsgIDs: []int64{live.ID}, SenderID: 2}); err != nil {
		t.Fatalf("пересылка видимого: %v", err)
	}
}

// Ответ на невидимое сообщение не раскрывает его текст в превью.
func TestHydrateReplies_InvisibleTargetNotPreviewed(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	s.seedChat(50, "group", 1, 2)
	old, _ := in.Send(ctx, SendInput{ChatID: 50, SenderID: 1, Text: "тайна"})
	seq := old.Seq
	_, _ = in.Send(ctx, SendInput{ChatID: 50, SenderID: 1, Text: "ответ", ReplyToID: &seq})
	_ = in.chats.SetClearedSeq(ctx, 50, 2, old.Seq)

	res, err := in.GetHistory(ctx, 50, 2, 0, 0, 20, nil, "")
	if err != nil || len(res.Messages) != 1 {
		t.Fatalf("история Боба: %d %v", len(res.Messages), err)
	}
	if res.Messages[0].ReplyTo != nil {
		t.Fatalf("превью очищенного оригинала: %+v", res.Messages[0].ReplyTo)
	}
}

// A5-17: «кто прочитал» — только автору, не в канале, в окне по сроку и размеру.
func TestMessageViewers_AuthorOnlyWithinLimits(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	s.seedChat(50, "group", 1, 2)
	m, _ := in.Send(ctx, SendInput{ChatID: 50, SenderID: 1, Text: "привет"})

	if _, err := in.MessageViewers(ctx, 50, m.ID, 2); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("чужое «кто прочитал»: %v, want ErrForbidden", err)
	}
	if _, err := in.MessageViewers(ctx, 50, m.ID, 1); err != nil {
		t.Fatalf("автору: %v", err)
	}

	s.mu.Lock()
	s.messages[50][0].CreatedAt = time.Now().Add(-chatReadMarkExpirePeriod - time.Hour)
	s.mu.Unlock()
	if _, err := in.MessageViewers(ctx, 50, m.ID, 1); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("за сроком: %v, want ErrForbidden", err)
	}

	members := []int64{1}
	for u := int64(100); u < 100+chatReadMarkSizeThreshold; u++ {
		members = append(members, u)
	}
	s.seedChat(52, "group", members...)
	big, _ := in.Send(ctx, SendInput{ChatID: 52, SenderID: 1, Text: "всем"})
	if _, err := in.MessageViewers(ctx, 52, big.ID, 1); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("большая группа: %v, want ErrForbidden", err)
	}

	s.seedChat(53, domain.ChatTypeChannel, 1, 2)
	post, err := in.msgs.Insert(ctx, domain.Message{ChatID: 53, Seq: 1, SenderID: 1, Type: "text", Text: "пост", CreatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.MessageViewers(ctx, 53, post.ID, 1); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("канал: %v, want ErrForbidden", err)
	}
}

// avatarPrivacy — правило profile_photo: deny — кому фото скрыто.
type avatarPrivacy struct{ deny map[int64]bool }

func (p avatarPrivacy) Check(_ context.Context, _, viewerID int64, key domain.PrivacyKey) (bool, error) {
	return key != domain.PrivacyProfilePhoto || !p.deny[viewerID], nil
}

func (p avatarPrivacy) VisibleMap(_ context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range ownerIDs {
		out[id], _ = p.Check(context.Background(), id, viewerID, key)
	}
	return out, nil
}

// A5-06: аватарка скачивается только тем, кому её открывает правило profile_photo.
func TestCanAccessMedia_AvatarFollowsPrivacy(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	s.seedMedia(500, 1)
	s.mu.Lock()
	s.avatars = map[int64][]int64{500: {1}}
	s.mu.Unlock()
	in.SetPrivacy(avatarPrivacy{deny: map[int64]bool{2: true}})

	if ok, _ := in.CanAccessMedia(ctx, 2, 500); ok {
		t.Fatal("скрытая правилом аватарка скачалась")
	}
	if ok, _ := in.CanAccessMedia(ctx, 3, 500); !ok {
		t.Fatal("открытая правилом аватарка не скачалась")
	}
	if ok, _ := in.CanAccessMedia(ctx, 1, 500); !ok {
		t.Fatal("владелец не качает свою аватарку")
	}
}

// A4-02: у поста вещательного канала без подписей профилями автора нет ни в
// from_id, ни в векторе users; с подписями профилями — есть.
func TestMessagesContainer_BroadcastPostHidesAuthor(t *testing.T) {
	in, fg, _ := newAccessTestInteractor(t)
	ctx := context.Background()
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Админ"}
	ch, _ := in.CreateChannel(ctx, 7, "Новости", "", "news", true)
	post, _ := in.PostToChannel(ctx, ch, 7, "пост", nil, "")
	rows, _ := in.msgs.GetByIDs(ctx, []int64{post.ID})

	wire, users, err := in.MessagesContainer(ctx, 8, rows)
	if err != nil {
		t.Fatal(err)
	}
	if body := wire[0].(domain.MessageReal); body.FromID != nil {
		t.Fatalf("у поста без подписей from_id = %#v", body.FromID)
	}
	if len(users) != 0 {
		t.Fatalf("автор поста в users: %v", users)
	}

	_ = fg.SetSignatures(ctx, ch, true, true)
	wire, users, _ = in.MessagesContainer(ctx, 8, rows)
	if body := wire[0].(domain.MessageReal); body.FromID == nil {
		t.Fatal("с подписями профилями from_id пропал")
	}
	if len(users) != 1 || users[0].ID != 7 {
		t.Fatalf("с подписями профилями автора нет в users: %v", users)
	}
}

// A5-40: /users?ids= отдаёт только известных зрителю.
func TestKnownUsersByIDs_FiltersUnknown(t *testing.T) {
	in, fg, _ := newAccessTestInteractor(t)
	fg.users[7] = domain.UserReal{ID: 7}
	got, err := in.KnownUsersByIDs(context.Background(), 8, []int64{7, 999})
	if err != nil || len(got) != 1 || got[0].ID != 7 {
		t.Fatalf("KnownUsersByIDs = %v %v", got, err)
	}
}

func msgSeqList(ms []domain.Message) []int64 {
	out := make([]int64, 0, len(ms))
	for _, m := range ms {
		out = append(out, m.Seq)
	}
	return out
}

// fakeBoostRepo — пустые бусты: тесту важен только гейт.
type fakeBoostRepo struct{}

func (fakeBoostRepo) ActiveBoosts(context.Context, int64) (int, error)          { return 0, nil }
func (fakeBoostRepo) UserActiveSlots(context.Context, int64) (int, error)       { return 0, nil }
func (fakeBoostRepo) Boost(context.Context, int64, int64, int, time.Time) error { return nil }
func (fakeBoostRepo) BoostedByMe(context.Context, int64, int64) (bool, error)   { return false, nil }

// A5-23 (клиентская половина): чужой публичный чат в поиске уходит с
// pFlags.left — клиент рисует «Вступить», а не вступает сам; свой — без него.
func TestSearchPeers_ForeignChatIsLeft(t *testing.T) {
	in, _, fs, _ := newChannelTestInteractor(t)
	fs.chats = []domain.ChatRecord{{ID: 1, Type: domain.ChatTypeChannel, Title: "чужой"}, {ID: 2, Type: domain.ChatTypeChannel, Title: "свой", MyRole: domain.RoleSubscriber}}
	fs.ownChats = map[int64]bool{2: true}
	res, err := in.SearchPeers(context.Background(), 8, "ка", 20)
	if err != nil || len(res.Chats) != 1 || len(res.MyChats) != 1 {
		t.Fatalf("SearchPeers = %+v %v", res, err)
	}
	if !res.Chats[0].ToChannel().PFlags["left"] {
		t.Fatal("чужой публичный канал в поиске без pFlags.left")
	}
	if res.MyChats[0].ToChannel().PFlags["left"] {
		t.Fatal("свой канал в поиске помечен left")
	}
}
