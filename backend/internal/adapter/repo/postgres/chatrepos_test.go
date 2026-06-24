package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// seedUser inserts a user and returns its id.
func seedUser(t *testing.T, pool *pgxpool.Pool, phone string) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (phone, display_name) VALUES ($1,$1) RETURNING id`, phone).Scan(&id)
	if err != nil {
		t.Fatalf("seedUser(%s): %v", phone, err)
	}
	return id
}

// seedMedia inserts a media row owned by ownerID and returns its id.
func seedMedia(t *testing.T, pool *pgxpool.Pool, ownerID int64, key string) int64 {
	t.Helper()
	var id int64
	err := pool.QueryRow(context.Background(),
		`INSERT INTO media (owner_id, bucket, object_key, mime) VALUES ($1,'media',$2,'image/jpeg') RETURNING id`,
		ownerID, key).Scan(&id)
	if err != nil {
		t.Fatalf("seedMedia: %v", err)
	}
	return id
}

// createPrivate runs CreatePrivate inside a TxManager (it needs the tx-scoped
// advisory lock) and returns the chat id.
func createPrivate(t *testing.T, pool *pgxpool.Pool, a, b int64) int64 {
	t.Helper()
	repo := NewChatsRepo(pool)
	tx := NewTxManager(pool)
	var chatID int64
	err := tx.WithinTx(context.Background(), func(ctx context.Context) error {
		id, e := repo.CreatePrivate(ctx, a, b)
		chatID = id
		return e
	})
	if err != nil {
		t.Fatalf("createPrivate: %v", err)
	}
	return chatID
}

func TestChatsRepo_CreateAndFindPrivate(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewChatsRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+700")
	b := seedUser(t, pool, "+701")

	if _, err := repo.FindPrivate(ctx, a, b); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound before create, got %v", err)
	}
	chatID := createPrivate(t, pool, a, b)

	found, err := repo.FindPrivate(ctx, b, a) // order-independent
	if err != nil || found != chatID {
		t.Fatalf("FindPrivate = %d, %v; want %d", found, err, chatID)
	}

	ids, err := repo.MemberIDs(ctx, chatID)
	if err != nil || len(ids) != 2 {
		t.Fatalf("MemberIDs = %v, %v", ids, err)
	}
	if ok, _ := repo.IsMember(ctx, chatID, a); !ok {
		t.Fatal("expected a to be a member")
	}
	notMember := seedUser(t, pool, "+702")
	if ok, _ := repo.IsMember(ctx, chatID, notMember); ok {
		t.Fatal("expected non-member to not be a member")
	}
}

func TestChatsRepo_ListDialogs(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewChatsRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+710")
	b := seedUser(t, pool, "+711")
	chatID := createPrivate(t, pool, a, b)

	dialogs, err := repo.ListDialogs(ctx, a)
	if err != nil {
		t.Fatalf("ListDialogs: %v", err)
	}
	if len(dialogs) != 1 || dialogs[0].ChatID != chatID {
		t.Fatalf("unexpected dialogs: %+v", dialogs)
	}
	if dialogs[0].HasLast {
		t.Fatal("expected no last message in empty chat")
	}
	// A's dialog should carry the peer (B) for a private chat.
	if dialogs[0].Peer == nil {
		t.Fatalf("expected peer set for private chat, got nil")
	}
	if dialogs[0].Peer.ID != b {
		t.Fatalf("peer id = %d; want %d", dialogs[0].Peer.ID, b)
	}
	if dialogs[0].Peer.DisplayName != "+711" {
		t.Fatalf("peer display_name = %q; want %q", dialogs[0].Peer.DisplayName, "+711")
	}
	// And symmetrically, B's dialog should carry A as the peer.
	bDialogs, err := repo.ListDialogs(ctx, b)
	if err != nil {
		t.Fatalf("ListDialogs(b): %v", err)
	}
	if len(bDialogs) != 1 || bDialogs[0].Peer == nil || bDialogs[0].Peer.ID != a {
		t.Fatalf("b's peer = %+v; want id %d", bDialogs[0].Peer, a)
	}
}

func TestChatsRepo_ChatPartners(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewChatsRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+770")
	b := seedUser(t, pool, "+771")
	c := seedUser(t, pool, "+772")
	_ = createPrivate(t, pool, a, b)
	_ = createPrivate(t, pool, a, c)

	partners, err := repo.ChatPartners(ctx, a)
	if err != nil {
		t.Fatalf("ChatPartners: %v", err)
	}
	if len(partners) != 2 {
		t.Fatalf("expected 2 partners, got %v", partners)
	}
	bp, _ := repo.ChatPartners(ctx, b)
	if len(bp) != 1 || bp[0] != a {
		t.Fatalf("b partners = %v; want [%d]", bp, a)
	}
}

func TestChatsRepo_ReadState(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+780")
	b := seedUser(t, pool, "+781")
	chatID := createPrivate(t, pool, a, b)

	// One message from a, then b's unread is bumped.
	seq, _ := msgs.NextSeq(ctx, chatID)
	_, _ = msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "m"})
	if err := repo.IncUnread(ctx, chatID, b); err != nil {
		t.Fatalf("IncUnread: %v", err)
	}

	cur, err := repo.CurrentReadSeq(ctx, chatID, b)
	if err != nil || cur != 0 {
		t.Fatalf("CurrentReadSeq = %d, %v; want 0", cur, err)
	}
	if err := repo.SetRead(ctx, chatID, b, 1, 0); err != nil {
		t.Fatalf("SetRead: %v", err)
	}
	cur, _ = repo.CurrentReadSeq(ctx, chatID, b)
	if cur != 1 {
		t.Fatalf("CurrentReadSeq after SetRead = %d, want 1", cur)
	}
	d, _ := repo.ListDialogs(ctx, b)
	if d[0].LastReadSeq != 1 || d[0].UnreadCount != 0 {
		t.Fatalf("dialog after read = %+v; want lastRead=1 unread=0", d[0])
	}
}

func TestMessagesRepo_SeqAndInsertAndHistory(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+720")
	b := seedUser(t, pool, "+721")
	chatID := createPrivate(t, pool, a, b)

	for i := 1; i <= 3; i++ {
		seq, err := msgs.NextSeq(ctx, chatID)
		if err != nil {
			t.Fatalf("NextSeq: %v", err)
		}
		if int(seq) != i {
			t.Fatalf("seq = %d, want %d", seq, i)
		}
		if _, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "m"}); err != nil {
			t.Fatalf("Insert: %v", err)
		}
	}

	n, _ := msgs.CountMessages(ctx, chatID)
	if n != 3 {
		t.Fatalf("CountMessages = %d, want 3", n)
	}

	hist, err := msgs.GetHistory(ctx, chatID, 0, 0, 10)
	if err != nil || len(hist) != 3 || hist[0].Seq != 3 {
		t.Fatalf("history from end: %+v err=%v", hist, err)
	}

	older, _ := msgs.GetHistory(ctx, chatID, 3, 1, 2)
	if len(older) != 2 || older[0].Seq != 3 || older[1].Seq != 2 {
		t.Fatalf("older window: %+v", older)
	}

	newer, _ := msgs.GetHistory(ctx, chatID, 1, -1, 10)
	if len(newer) != 2 || newer[0].Seq != 2 {
		t.Fatalf("newer window: %+v", newer)
	}
}

func TestMessagesRepo_FindByClientMsgID(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+730")
	b := seedUser(t, pool, "+731")
	chatID := createPrivate(t, pool, a, b)

	cmid := "client-1"
	seq, _ := msgs.NextSeq(ctx, chatID)
	if _, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "hi", ClientMsgID: &cmid}); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	got, err := msgs.FindByClientMsgID(ctx, chatID, a, cmid)
	if err != nil || got.Text != "hi" {
		t.Fatalf("FindByClientMsgID = %+v, %v", got, err)
	}
	if _, err := msgs.FindByClientMsgID(ctx, chatID, a, "missing"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound, got %v", err)
	}
}

func TestMessagesRepo_InsertWithMediaAndMessageChatID(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+740")
	b := seedUser(t, pool, "+741")
	chatID := createPrivate(t, pool, a, b)
	mediaID := seedMedia(t, pool, a, "k1")

	seq, _ := msgs.NextSeq(ctx, chatID)
	m, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "photo", Text: "x", MediaID: &mediaID})
	if err != nil {
		t.Fatalf("Insert with media: %v", err)
	}
	if m.MediaID == nil || *m.MediaID != mediaID {
		t.Fatalf("media_id = %v; want %d", m.MediaID, mediaID)
	}

	got, err := msgs.MessageChatID(ctx, m.ID)
	if err != nil || got != chatID {
		t.Fatalf("MessageChatID = %d, %v; want %d", got, err, chatID)
	}
	if _, err := msgs.MessageChatID(ctx, 999999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound, got %v", err)
	}
}

func TestUpdatesRepo_AppendAndSince(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewUpdatesRepo(pool)
	ctx := context.Background()
	u := seedUser(t, pool, "+740")

	s, _ := repo.GetUserState(ctx, u)
	if s.Pts != 0 {
		t.Fatalf("initial pts = %d, want 0", s.Pts)
	}

	p1, err := repo.AppendUpdate(ctx, u, 1, 100, "new_message", json.RawMessage(`{"a":1}`))
	if err != nil || p1 != 1 {
		t.Fatalf("AppendUpdate 1 = %d, %v", p1, err)
	}
	p2, _ := repo.AppendUpdate(ctx, u, 1, 101, "read", json.RawMessage(`{"b":2}`))
	if p2 != 2 {
		t.Fatalf("AppendUpdate 2 = %d, want 2", p2)
	}

	state, _ := repo.GetUserState(ctx, u)
	if state.Pts != 2 || state.Date != 101 {
		t.Fatalf("state = %+v, want pts=2 date=101", state)
	}

	ups, err := repo.UpdatesSince(ctx, u, 0, 10)
	if err != nil || len(ups) != 2 || ups[0].Pts != 1 || ups[1].Type != "read" {
		t.Fatalf("UpdatesSince = %+v, %v", ups, err)
	}
	tail, _ := repo.UpdatesSince(ctx, u, 1, 10)
	if len(tail) != 1 || tail[0].Pts != 2 {
		t.Fatalf("tail = %+v", tail)
	}
}

func TestReactionsRepo_AddRemoveAggregate(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	reacts := NewReactionsRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+760")
	b := seedUser(t, pool, "+761")
	chatID := createPrivate(t, pool, a, b)
	seq, _ := msgs.NextSeq(ctx, chatID)
	m, _ := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "x"})

	if err := reacts.Add(ctx, m.ID, a, "🔥"); err != nil {
		t.Fatalf("add a fire: %v", err)
	}
	_ = reacts.Add(ctx, m.ID, b, "🔥")
	_ = reacts.Add(ctx, m.ID, b, "❤️")
	_ = reacts.Add(ctx, m.ID, a, "🔥") // duplicate no-op

	counts, err := reacts.ReactionsFor(ctx, m.ID)
	if err != nil {
		t.Fatalf("ReactionsFor: %v", err)
	}
	if len(counts) != 2 || counts[0].Emoji != "🔥" || counts[0].Count != 2 {
		t.Fatalf("counts = %+v; want 🔥:2 first", counts)
	}

	if err := reacts.Remove(ctx, m.ID, a, "🔥"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	counts, _ = reacts.ReactionsFor(ctx, m.ID)
	for _, c := range counts {
		if c.Emoji == "🔥" && c.Count != 1 {
			t.Fatalf("🔥 count = %d after remove; want 1", c.Count)
		}
	}
}

func TestMediaAccessRepo_OwnerAndCanAccess(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewMediaAccessRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+790")
	b := seedUser(t, pool, "+791")
	c := seedUser(t, pool, "+792")
	chatID := createPrivate(t, pool, a, b)
	mediaID := seedMedia(t, pool, a, "mk")

	owner, err := repo.OwnerID(ctx, mediaID)
	if err != nil || owner != a {
		t.Fatalf("OwnerID = %d, %v; want %d", owner, err, a)
	}
	if _, err := repo.OwnerID(ctx, 999999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound for absent media, got %v", err)
	}

	// Owner can access before it's referenced anywhere.
	if ok, _ := repo.CanAccess(ctx, a, mediaID); !ok {
		t.Fatal("owner should access media")
	}
	// b is not yet allowed (no message references it).
	if ok, _ := repo.CanAccess(ctx, b, mediaID); ok {
		t.Fatal("b should not access media before any message references it")
	}
	// Reference it in the chat a/b share.
	seq, _ := msgs.NextSeq(ctx, chatID)
	_, _ = msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "photo", MediaID: &mediaID})
	if ok, _ := repo.CanAccess(ctx, b, mediaID); !ok {
		t.Fatal("b should access media via shared chat")
	}
	// c (stranger) still cannot.
	if ok, _ := repo.CanAccess(ctx, c, mediaID); ok {
		t.Fatal("stranger should not access media")
	}
}

func TestTxManager_RollbackOnError(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+800")
	b := seedUser(t, pool, "+801")
	tx := NewTxManager(pool)

	wantErr := errors.New("boom")
	err := tx.WithinTx(ctx, func(ctx context.Context) error {
		if _, e := chats.CreatePrivate(ctx, a, b); e != nil {
			return e
		}
		return wantErr // force rollback
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("WithinTx err = %v, want %v", err, wantErr)
	}
	// The chat must not exist after rollback.
	if _, err := chats.FindPrivate(ctx, a, b); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected no chat after rollback, got %v", err)
	}
}
