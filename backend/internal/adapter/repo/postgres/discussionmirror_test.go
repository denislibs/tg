package postgres

import (
	"context"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Зеркало поста канала — ровно одно на пост: уникальный индекс закрывает гонку
// параллельных публикаций и ретраев. Обычную пересылку он задевать не должен.
func TestMessages_DiscussionMirror_UniquePerPost(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7900")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "Chan", "", "", true, u)
	_ = groups.AddMember(ctx, ch, u, domain.RoleCreator, domain.AllRights)
	disc, _ := groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, u)
	_ = groups.AddMember(ctx, disc, u, domain.RoleCreator, domain.AllRights)
	if err := groups.SetDiscussion(ctx, ch, disc); err != nil {
		t.Fatal(err)
	}

	postSeq, _ := msgs.NextSeq(ctx, ch)
	post, err := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: postSeq, SenderID: u, Type: "text", Text: "post"})
	if err != nil {
		t.Fatal(err)
	}

	mirror := func() domain.Message {
		seq, _ := msgs.NextSeq(ctx, disc)
		return domain.Message{
			ChatID: disc, Seq: seq, SenderID: u, Type: "text", Text: "post",
			SendAsChatID: &ch, FwdFromChatID: &ch, FwdFromMsgID: &post.ID,
			IsDiscussionMirror: true,
		}
	}

	if _, err := msgs.Insert(ctx, mirror()); err != nil {
		t.Fatalf("первое зеркало: %v", err)
	}
	if _, err := msgs.Insert(ctx, mirror()); err == nil {
		t.Fatal("второе зеркало вставилось — уникального индекса нет")
	} else if !strings.Contains(strings.ToLower(err.Error()), "unique") &&
		!strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		t.Fatalf("ожидалось нарушение уникальности, получено: %v", err)
	}

	// Обычная пересылка того же поста в ту же группу — легальна, и дважды тоже.
	fwd := func() domain.Message {
		seq, _ := msgs.NextSeq(ctx, disc)
		return domain.Message{
			ChatID: disc, Seq: seq, SenderID: u, Type: "text", Text: "post",
			FwdFromChatID: &ch, FwdFromMsgID: &post.ID,
		}
	}
	for n := 1; n <= 2; n++ {
		if _, err := msgs.Insert(ctx, fwd()); err != nil {
			t.Fatalf("пересылка №%d сломана индексом: %v", n, err)
		}
	}
}

// Флаг должен переживать запись/чтение: если его не читать в scanMessage,
// резолв зеркала не отличит его от пересылки.
func TestMessages_DiscussionMirror_FlagRoundTrip(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7901")
	disc, _ := groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, u)
	_ = groups.AddMember(ctx, disc, u, domain.RoleCreator, domain.AllRights)

	seq, _ := msgs.NextSeq(ctx, disc)
	m, err := msgs.Insert(ctx, domain.Message{ChatID: disc, Seq: seq, SenderID: u, Type: "text", Text: "m", IsDiscussionMirror: true})
	if err != nil {
		t.Fatal(err)
	}
	got, err := msgs.GetByID(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IsDiscussionMirror {
		t.Fatal("флаг is_discussion_mirror не дожил до чтения")
	}
}

func TestMessages_MirrorByPost(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7902")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "Chan", "", "", true, u)
	_ = groups.AddMember(ctx, ch, u, domain.RoleCreator, domain.AllRights)
	disc, _ := groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, u)
	_ = groups.AddMember(ctx, disc, u, domain.RoleCreator, domain.AllRights)
	_ = groups.SetDiscussion(ctx, ch, disc)

	seq, _ := msgs.NextSeq(ctx, ch)
	post, _ := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: seq, SenderID: u, Type: "text", Text: "p1"})
	seq2, _ := msgs.NextSeq(ctx, ch)
	post2, _ := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: seq2, SenderID: u, Type: "text", Text: "p2"})

	mseq, _ := msgs.NextSeq(ctx, disc)
	mirror, err := msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: mseq, SenderID: u, Type: "text", Text: "p1",
		SendAsChatID: &ch, FwdFromChatID: &ch, FwdFromMsgID: &post.ID, IsDiscussionMirror: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	// у post2 зеркала нет, но есть ПОЛЬЗОВАТЕЛЬСКАЯ пересылка в ту же группу
	fseq, _ := msgs.NextSeq(ctx, disc)
	_, _ = msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: fseq, SenderID: u, Type: "text", Text: "p2",
		FwdFromChatID: &ch, FwdFromMsgID: &post2.ID,
	})

	got, err := msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil || got != mirror.ID {
		t.Fatalf("MirrorByPost(post1) = %d, %v; want %d", got, err, mirror.ID)
	}
	got2, err := msgs.MirrorByPost(ctx, ch, post2.ID)
	if err != nil {
		t.Fatalf("MirrorByPost(post2): %v", err)
	}
	if got2 != 0 {
		t.Fatalf("пересылка принята за зеркало: MirrorByPost(post2) = %d, want 0", got2)
	}

	m, err := msgs.MirrorsByPosts(ctx, ch, []int64{post.ID, post2.ID})
	if err != nil {
		t.Fatal(err)
	}
	if m[post.ID] != mirror.ID {
		t.Fatalf("MirrorsByPosts[post1] = %d, want %d", m[post.ID], mirror.ID)
	}
	if _, ok := m[post2.ID]; ok {
		t.Fatal("MirrorsByPosts вернул запись для поста без зеркала")
	}
}

// Канал можно перепривязать на другую группу обсуждения (LinkDiscussion/
// UnlinkDiscussion). Уникальный индекс из Task 1 стоит на (chat_id,
// fwd_from_chat_id, fwd_from_msg_id) и НЕ запрещает зеркала одного и того же
// поста в разных группах — старая группа сохраняет своё зеркало. Резолв
// обязан отвечать про ТЕКУЩУЮ группу обсуждения, а не про произвольную из
// имеющихся.
func TestMessages_MirrorByPost_FollowsCurrentDiscussionGroup(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7905")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "Chan", "", "", true, u)
	_ = groups.AddMember(ctx, ch, u, domain.RoleCreator, domain.AllRights)
	groupA, _ := groups.CreateMultiMember(ctx, "group", "DiscussionA", "", "", false, u)
	_ = groups.AddMember(ctx, groupA, u, domain.RoleCreator, domain.AllRights)
	groupB, _ := groups.CreateMultiMember(ctx, "group", "DiscussionB", "", "", false, u)
	_ = groups.AddMember(ctx, groupB, u, domain.RoleCreator, domain.AllRights)

	if err := groups.SetDiscussion(ctx, ch, groupA); err != nil {
		t.Fatal(err)
	}

	seq, _ := msgs.NextSeq(ctx, ch)
	post, _ := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: seq, SenderID: u, Type: "text", Text: "p"})

	aSeq, _ := msgs.NextSeq(ctx, groupA)
	mirrorA, err := msgs.Insert(ctx, domain.Message{
		ChatID: groupA, Seq: aSeq, SenderID: u, Type: "text", Text: "p",
		SendAsChatID: &ch, FwdFromChatID: &ch, FwdFromMsgID: &post.ID, IsDiscussionMirror: true,
	})
	if err != nil {
		t.Fatalf("зеркало в группе A: %v", err)
	}

	// Перепривязка: старое зеркало остаётся висеть в A, новое создаётся в B.
	if err := groups.SetDiscussion(ctx, ch, groupB); err != nil {
		t.Fatal(err)
	}
	bSeq, _ := msgs.NextSeq(ctx, groupB)
	mirrorB, err := msgs.Insert(ctx, domain.Message{
		ChatID: groupB, Seq: bSeq, SenderID: u, Type: "text", Text: "p",
		SendAsChatID: &ch, FwdFromChatID: &ch, FwdFromMsgID: &post.ID, IsDiscussionMirror: true,
	})
	if err != nil {
		t.Fatalf("зеркало в группе B: %v", err)
	}

	got, err := msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != mirrorB.ID {
		t.Fatalf("MirrorByPost вернул зеркало из отвязанной группы A: got=%d (mirrorA=%d), want mirrorB=%d", got, mirrorA.ID, mirrorB.ID)
	}

	m, err := msgs.MirrorsByPosts(ctx, ch, []int64{post.ID})
	if err != nil {
		t.Fatal(err)
	}
	if m[post.ID] != mirrorB.ID {
		t.Fatalf("MirrorsByPosts вернул зеркало из отвязанной группы A: got=%d, want mirrorB=%d", m[post.ID], mirrorB.ID)
	}
}

// MirrorsByPosts с пустым postIDs обязан вернуть пустую, но не nil, карту и
// не ходить в БД вообще — проверяем отменённым контекстом: если бы код всё
// же выполнил запрос, pgx вернул бы context.Canceled.
func TestMessages_MirrorsByPosts_EmptyInput(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	m, err := msgs.MirrorsByPosts(ctx, 1, nil)
	if err != nil {
		t.Fatalf("MirrorsByPosts(nil) с отменённым контекстом вернул ошибку %v — запрос всё же пошёл в БД", err)
	}
	if m == nil {
		t.Fatal("MirrorsByPosts(nil) вернул nil-карту вместо пустой")
	}
	if len(m) != 0 {
		t.Fatalf("MirrorsByPosts(nil) вернул непустую карту: %v", m)
	}
}

// Резолв с чужим channelID не должен находить зеркало другого канала, даже
// если id поста случайно совпал (в другом чате свои id последовательности).
func TestMessages_MirrorByPost_OtherChannelNotFound(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7906")
	ch1, _ := groups.CreateMultiMember(ctx, "channel", "Chan1", "", "", true, u)
	_ = groups.AddMember(ctx, ch1, u, domain.RoleCreator, domain.AllRights)
	ch2, _ := groups.CreateMultiMember(ctx, "channel", "Chan2", "", "", true, u)
	_ = groups.AddMember(ctx, ch2, u, domain.RoleCreator, domain.AllRights)
	disc, _ := groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, u)
	_ = groups.AddMember(ctx, disc, u, domain.RoleCreator, domain.AllRights)
	if err := groups.SetDiscussion(ctx, ch1, disc); err != nil {
		t.Fatal(err)
	}

	seq, _ := msgs.NextSeq(ctx, ch1)
	post, _ := msgs.Insert(ctx, domain.Message{ChatID: ch1, Seq: seq, SenderID: u, Type: "text", Text: "p"})

	mseq, _ := msgs.NextSeq(ctx, disc)
	if _, err := msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: mseq, SenderID: u, Type: "text", Text: "p",
		SendAsChatID: &ch1, FwdFromChatID: &ch1, FwdFromMsgID: &post.ID, IsDiscussionMirror: true,
	}); err != nil {
		t.Fatal(err)
	}

	got, err := msgs.MirrorByPost(ctx, ch2, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("MirrorByPost нашёл зеркало чужого канала: got=%d, want 0", got)
	}
}

// PostsByMirrors — обратный резолв: по id сообщений отдаёт id постов для тех,
// что реально зеркала (перебор по PK, без привязки к текущей группе
// обсуждения — резолвит и «отвязанное» зеркало старой группы). Обычные
// сообщения и id, которых нет в наборе, в карту не попадают.
func TestMessages_PostsByMirrors(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7907")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "Chan", "", "", true, u)
	_ = groups.AddMember(ctx, ch, u, domain.RoleCreator, domain.AllRights)
	disc, _ := groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, u)
	_ = groups.AddMember(ctx, disc, u, domain.RoleCreator, domain.AllRights)
	_ = groups.SetDiscussion(ctx, ch, disc)

	seq, _ := msgs.NextSeq(ctx, ch)
	post, _ := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: seq, SenderID: u, Type: "text", Text: "p1"})

	mseq, _ := msgs.NextSeq(ctx, disc)
	mirror, err := msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: mseq, SenderID: u, Type: "text", Text: "p1",
		SendAsChatID: &ch, FwdFromChatID: &ch, FwdFromMsgID: &post.ID, IsDiscussionMirror: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	// обычный комментарий (не зеркало) в той же группе — не должен попасть в карту
	cseq, _ := msgs.NextSeq(ctx, disc)
	root := mirror.ID
	comment, err := msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: cseq, SenderID: u, Type: "text", Text: "c1", ThreadRootID: &root,
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := msgs.PostsByMirrors(ctx, []int64{mirror.ID, comment.ID, 999999})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("PostsByMirrors = %v, want ровно одну запись", got)
	}
	if got[mirror.ID] != post.ID {
		t.Fatalf("PostsByMirrors[зеркало] = %d, want id поста %d", got[mirror.ID], post.ID)
	}
	if _, ok := got[comment.ID]; ok {
		t.Fatal("PostsByMirrors принял обычный комментарий за зеркало")
	}
}

// Альбом (общий grouped_id): зеркалится КАЖДЫЙ элемент (иначе альбом в
// группе обсуждения приедет обрезанным), но тред — один, на зеркале ПЕРВОГО
// (минимальный id) элемента группы. MirrorByPost/MirrorsByPosts для любого
// элемента альбома обязаны отдавать id зеркала именно первого; собственная
// же строка-зеркало второго элемента при этом должна существовать (её ищет
// MirrorOfExactPost — без коллапса в корень).
func TestMessages_MirrorByPost_Album(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	groups := NewGroupRepo(pool)
	ctx := context.Background()

	u := seedUser(t, pool, "+7908")
	ch, _ := groups.CreateMultiMember(ctx, "channel", "Chan", "", "", true, u)
	_ = groups.AddMember(ctx, ch, u, domain.RoleCreator, domain.AllRights)
	disc, _ := groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, u)
	_ = groups.AddMember(ctx, disc, u, domain.RoleCreator, domain.AllRights)
	_ = groups.SetDiscussion(ctx, ch, disc)

	grouped := "g1"
	seq1, _ := msgs.NextSeq(ctx, ch)
	post1, err := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: seq1, SenderID: u, Type: "photo", Text: "", GroupedID: &grouped})
	if err != nil {
		t.Fatal(err)
	}
	seq2, _ := msgs.NextSeq(ctx, ch)
	post2, err := msgs.Insert(ctx, domain.Message{ChatID: ch, Seq: seq2, SenderID: u, Type: "photo", Text: "", GroupedID: &grouped})
	if err != nil {
		t.Fatal(err)
	}
	if post1.ID >= post2.ID {
		t.Fatalf("ожидался возрастающий id (post1=%d < post2=%d) — тест полагается на порядок вставки", post1.ID, post2.ID)
	}

	mseq1, _ := msgs.NextSeq(ctx, disc)
	mirror1, err := msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: mseq1, SenderID: u, Type: "photo", Text: "", GroupedID: &grouped,
		SendAsChatID: &ch, FwdFromChatID: &ch, FwdFromMsgID: &post1.ID, IsDiscussionMirror: true,
	})
	if err != nil {
		t.Fatalf("зеркало первого элемента: %v", err)
	}
	mseq2, _ := msgs.NextSeq(ctx, disc)
	mirror2, err := msgs.Insert(ctx, domain.Message{
		ChatID: disc, Seq: mseq2, SenderID: u, Type: "photo", Text: "", GroupedID: &grouped,
		SendAsChatID: &ch, FwdFromChatID: &ch, FwdFromMsgID: &post2.ID, IsDiscussionMirror: true,
	})
	if err != nil {
		t.Fatalf("зеркало второго элемента: %v", err)
	}

	// MirrorByPost для ЛЮБОГО элемента альбома отдаёт зеркало ПЕРВОГО.
	r1, err := msgs.MirrorByPost(ctx, ch, post1.ID)
	if err != nil || r1 != mirror1.ID {
		t.Fatalf("MirrorByPost(post1) = %d, %v; want %d", r1, err, mirror1.ID)
	}
	r2, err := msgs.MirrorByPost(ctx, ch, post2.ID)
	if err != nil || r2 != mirror1.ID {
		t.Fatalf("MirrorByPost(post2) = %d, %v; want зеркало первого элемента %d (получен корень своего же зеркала %d — тред не един)", r2, err, mirror1.ID, mirror2.ID)
	}

	// MirrorsByPosts — та же коллапсирующая логика, батчем.
	m, err := msgs.MirrorsByPosts(ctx, ch, []int64{post1.ID, post2.ID})
	if err != nil {
		t.Fatal(err)
	}
	if m[post1.ID] != mirror1.ID {
		t.Fatalf("MirrorsByPosts[post1] = %d, want %d", m[post1.ID], mirror1.ID)
	}
	if m[post2.ID] != mirror1.ID {
		t.Fatalf("MirrorsByPosts[post2] = %d, want зеркало первого элемента %d", m[post2.ID], mirror1.ID)
	}

	// Но своя строка-зеркало у второго элемента реально существует — альбом
	// в группе не обрезан. MirrorOfExactPost её находит без коллапса.
	own1, err := msgs.MirrorOfExactPost(ctx, ch, post1.ID)
	if err != nil || own1 != mirror1.ID {
		t.Fatalf("MirrorOfExactPost(post1) = %d, %v; want %d", own1, err, mirror1.ID)
	}
	own2, err := msgs.MirrorOfExactPost(ctx, ch, post2.ID)
	if err != nil || own2 != mirror2.ID {
		t.Fatalf("MirrorOfExactPost(post2) = %d, %v; want %d (собственное зеркало второго элемента отсутствует — альбом обрезан)", own2, err, mirror2.ID)
	}
}
