package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// TestMessagesRepo_SearchFiltersAndByDate проверяет фильтры поиска в чате
// (автор/тип медиа/реакция) и jump-to-date (MessageSeqByDate).
func TestMessagesRepo_SearchFiltersAndByDate(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+7400")
	b := seedUser(t, pool, "+7401")
	chatID := createPrivate(t, pool, a, b)
	msgs := NewMessagesRepo(pool)
	reacts := NewReactionsRepo(pool)

	insert := func(sender int64, typ, text string) domain.Message {
		seq, _ := msgs.NextSeq(ctx, chatID)
		m, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: sender, Type: typ, Text: text})
		if err != nil {
			t.Fatalf("insert: %v", err)
		}
		return m
	}

	mA := insert(a, "text", "привет от a")
	_ = insert(b, "text", "привет от b")
	_ = insert(a, "photo", "")
	_ = reacts.Add(ctx, mA.ID, b, "👍")

	// фильтр по автору
	got, count, err := msgs.SearchMessages(ctx, chatID, "привет", usecasechat.SearchFilter{SenderID: a}, 0, 20)
	if err != nil {
		t.Fatalf("search sender: %v", err)
	}
	if count != 1 || len(got) != 1 || got[0].SenderID != a {
		t.Fatalf("sender filter: count=%d msgs=%d", count, len(got))
	}

	// фильтр по типу медиа (пустой запрос допустим)
	got, count, err = msgs.SearchMessages(ctx, chatID, "", usecasechat.SearchFilter{MediaType: "photo"}, 0, 20)
	if err != nil {
		t.Fatalf("search media: %v", err)
	}
	if count != 1 || len(got) != 1 || got[0].Type != "photo" {
		t.Fatalf("media filter: count=%d msgs=%d", count, len(got))
	}

	// фильтр по реакции
	got, count, err = msgs.SearchMessages(ctx, chatID, "", usecasechat.SearchFilter{Reaction: "👍"}, 0, 20)
	if err != nil {
		t.Fatalf("search reaction: %v", err)
	}
	if count != 1 || len(got) != 1 || got[0].ID != mA.ID {
		t.Fatalf("reaction filter: count=%d msgs=%d", count, len(got))
	}

	// jump-to-date: дата в прошлом → самое раннее сообщение
	seq, err := msgs.MessageSeqByDate(ctx, chatID, time.Unix(0, 0))
	if err != nil {
		t.Fatalf("byDate past: %v", err)
	}
	if seq != mA.Seq {
		t.Fatalf("byDate past: seq=%d want %d", seq, mA.Seq)
	}
	// дата в будущем → самое новое сообщение
	seq, err = msgs.MessageSeqByDate(ctx, chatID, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("byDate future: %v", err)
	}
	if seq != 3 {
		t.Fatalf("byDate future: seq=%d want 3", seq)
	}
}

func TestSearchRepo(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	u := seedUser(t, pool, "+7200")
	g := NewGroupRepo(pool)
	_, _ = g.CreateMultiMember(ctx, "channel", "Go News Daily", "", "gonews", true, u)
	_, _ = g.CreateMultiMember(ctx, "channel", "Private Thing", "", "", false, u) // not public
	r := NewSearchRepo(pool)

	chats, err := r.SearchChats(ctx, "gonews", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 || chats[0].Username != "gonews" {
		t.Fatalf("by username: %+v", chats)
	}

	byTitle, _ := r.SearchChats(ctx, "Go New", 10)
	if len(byTitle) != 1 {
		t.Fatalf("by title: %+v", byTitle)
	}

	id, err := r.PublicChatByUsername(ctx, "gonews")
	if err != nil || id == 0 {
		t.Fatalf("resolve username: %d %v", id, err)
	}
	if _, err := r.PublicChatByUsername(ctx, "nope"); err == nil {
		t.Fatal("expected not found")
	}
}

func TestSimilarChannels(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7300")
	viewer := seedUser(t, pool, "+7301")
	a1 := seedUser(t, pool, "+7302")
	a2 := seedUser(t, pool, "+7303")
	a3 := seedUser(t, pool, "+7304")

	g := NewGroupRepo(pool)
	aID, _ := g.CreateMultiMember(ctx, "channel", "Source", "", "", true, owner)       // исходный канал
	bID, _ := g.CreateMultiMember(ctx, "channel", "Very Similar", "", "", true, owner) // пересечение больше
	cID, _ := g.CreateMultiMember(ctx, "channel", "Less Similar", "", "", true, owner) // пересечение меньше
	privID, _ := g.CreateMultiMember(ctx, "channel", "Private", "", "", false, owner)  // не публичный → исключён
	joinID, _ := g.CreateMultiMember(ctx, "channel", "Joined", "", "", true, owner)    // зритель уже состоит → исключён

	// Подписчики исходного канала A.
	for _, u := range []int64{a1, a2, a3} {
		_ = g.AddMember(ctx, aID, u, "member", 0)
	}
	// B делит с A двоих (a1,a2); C — одного (a1).
	_ = g.AddMember(ctx, bID, a1, "member", 0)
	_ = g.AddMember(ctx, bID, a2, "member", 0)
	_ = g.AddMember(ctx, cID, a1, "member", 0)
	// Приватный канал делит троих, но не публичный.
	for _, u := range []int64{a1, a2, a3} {
		_ = g.AddMember(ctx, privID, u, "member", 0)
	}
	// joinID делит двоих, но зритель уже подписан.
	_ = g.AddMember(ctx, joinID, a1, "member", 0)
	_ = g.AddMember(ctx, joinID, a2, "member", 0)
	_ = g.AddMember(ctx, joinID, viewer, "member", 0)

	r := NewSearchRepo(pool)
	got, count, err := r.SimilarChannels(ctx, aID, viewer, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 similar (B,C); private & joined excluded; got %d: %+v", len(got), got)
	}
	if got[0].ID != bID {
		t.Fatalf("want B first (bigger overlap), got id=%d", got[0].ID)
	}
	if got[1].ID != cID {
		t.Fatalf("want C second, got id=%d", got[1].ID)
	}
	if count != 2 {
		t.Fatalf("want total count 2, got %d", count)
	}

	// Зритель, уже подписанный на B, больше не должен видеть B среди похожих.
	_ = g.AddMember(ctx, bID, viewer, "member", 0)
	got2, _, _ := r.SimilarChannels(ctx, aID, viewer, 10)
	for _, c := range got2 {
		if c.ID == bID {
			t.Fatal("B must be excluded once viewer joined it")
		}
	}
}

// Похожий канал доезжает до клиента ГОТОВЫМ конструктором `channel`, а не
// плоским снимком: оригинал рисует подписчиков из participants_count и
// аватарку по id (tweb similarChannels.tsx:110, :206). Здесь же проверяется,
// что зритель в этих каналах не состоит — и что это ВИДНО в самой карточке:
// pFlags.left выставлен (по нему клиент решает isInChat,
// tweb appChatsManager.ts:331-344), а обязательный date несёт дату создания,
// а не нуль.
func TestSimilarChannels_AreChannelConstructors(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7350")
	viewer := seedUser(t, pool, "+7351")
	shared := seedUser(t, pool, "+7352")

	g := NewGroupRepo(pool)
	srcID, err := g.CreateMultiMember(ctx, "channel", "Source", "", "src350", true, owner)
	if err != nil {
		t.Fatal(err)
	}
	simID, err := g.CreateMultiMember(ctx, "channel", "Similar", "", "sim350", true, owner)
	if err != nil {
		t.Fatal(err)
	}
	// Общий подписчик — то самое пересечение аудитории, по которому канал и
	// признаётся похожим.
	_ = g.AddMember(ctx, srcID, shared, "member", 0)
	_ = g.AddMember(ctx, simID, shared, "member", 0)

	// Дату создания отодвигаем в прошлое: иначе «дата создания» и «сейчас»
	// неразличимы и проверка не поймала бы подмену.
	created := time.Now().Add(-96 * time.Hour).Truncate(time.Second)
	if _, err := pool.Exec(ctx, `UPDATE chats SET created_at=$2 WHERE id=$1`, simID, created); err != nil {
		t.Fatal(err)
	}

	got, count, err := NewSearchRepo(pool).SimilarChannels(ctx, srcID, viewer, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || count != 1 || got[0].ID != simID {
		t.Fatalf("похожие = %+v (count=%d); want ровно канал %d", got, count, simID)
	}

	ch := got[0].ToChannel()
	if ch.Underscore != domain.ChannelTag {
		t.Fatalf("конструктор = %q; want %q", ch.Underscore, domain.ChannelTag)
	}
	if !ch.Broadcast() || ch.Megagroup() {
		t.Errorf("вид = %v; want broadcast", ch.PFlags)
	}
	// Ноль подписчиков и пустая аватарка — ровно то, что показывал прежний
	// плоский снимок.
	if ch.ParticipantsCount == 0 {
		t.Error("participants_count = 0: число подписчиков не доехало")
	}
	if ch.Title != "Similar" || ch.Username != "sim350" {
		t.Errorf("карточка = %+v; want title/username похожего канала", ch)
	}
	if !ch.Left() {
		t.Error("зритель в похожем канале не состоит — pFlags.left не выставлен")
	}
	if ch.Date != int(created.Unix()) {
		t.Errorf("date = %d; want %d (дата создания: зритель не участник)", ch.Date, created.Unix())
	}
}

// Дата вступления доезжает от строки членства до краткой формы `channel` —
// обоими путями, которыми карточка канала попадает к клиенту: карточкой чата
// (GroupRepo.Card) и строкой списка чатов (ChatsRepo.ListDialogs). Дата
// создания канала отодвинута в прошлое, поэтому подмена одной другой видна.
func TestJoinDate_ReachesChannelConstructor(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7360")
	joiner := seedUser(t, pool, "+7361")
	stranger := seedUser(t, pool, "+7362")

	g := NewGroupRepo(pool)
	chatID, err := g.CreateMultiMember(ctx, "channel", "News", "", "news360", true, owner)
	if err != nil {
		t.Fatal(err)
	}
	created := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
	joined := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	if _, err := pool.Exec(ctx, `UPDATE chats SET created_at=$2 WHERE id=$1`, chatID, created); err != nil {
		t.Fatal(err)
	}
	if err := g.AddMember(ctx, chatID, joiner, "member", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE chat_members SET joined_at=$3 WHERE chat_id=$1 AND user_id=$2`, chatID, joiner, joined); err != nil {
		t.Fatal(err)
	}

	// Карточка глазами УЧАСТНИКА: date — его вступление.
	card, err := g.Card(ctx, chatID, joiner)
	if err != nil {
		t.Fatal(err)
	}
	if !card.MyJoinedAt.Equal(joined) {
		t.Fatalf("Card.MyJoinedAt = %s; want %s", card.MyJoinedAt, joined)
	}
	if got := card.ToChannel().Date; got != int(joined.Unix()) {
		t.Errorf("date участника = %d; want %d (вступление, а не создание %d)",
			got, joined.Unix(), created.Unix())
	}

	// Карточка глазами ЧУЖОГО: даты вступления нет, едет дата создания.
	out, err := g.Card(ctx, chatID, stranger)
	if err != nil {
		t.Fatal(err)
	}
	if !out.MyJoinedAt.IsZero() {
		t.Errorf("не участник несёт дату вступления: %s", out.MyJoinedAt)
	}
	if got := out.ToChannel().Date; got != int(created.Unix()) {
		t.Errorf("date не участника = %d; want %d (создание)", got, created.Unix())
	}

	// Строка списка чатов — тот же ответ, что и карточка.
	dialogs, err := NewChatsRepo(pool).ListDialogs(ctx, joiner)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, d := range dialogs {
		if d.ChatID != chatID {
			continue
		}
		found = true
		if got := d.ToChannel().Date; got != int(joined.Unix()) {
			t.Errorf("date строки диалога = %d; want %d (вступление)", got, joined.Unix())
		}
	}
	if !found {
		t.Fatalf("канал не попал в список чатов зрителя: %+v", dialogs)
	}
}
