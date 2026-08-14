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
