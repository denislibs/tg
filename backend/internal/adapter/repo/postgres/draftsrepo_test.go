package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestDraftsRepo_CRUD(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewDraftsRepo(pool)
	ctx := context.Background()
	user := seedUser(t, pool, "+7911")

	var chat1, chat2 int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chat1); err != nil {
		t.Fatalf("seed chat1: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('private') RETURNING id`).Scan(&chat2); err != nil {
		t.Fatalf("seed chat2: %v", err)
	}

	// Upsert создаёт, повторный — обновляет (та же пара чат+пользователь).
	reply := int64(42)
	d, err := r.Upsert(ctx, user, domain.Draft{
		ChatID: chat1, Text: "*bold* черновик",
		Entities:  domain.MessageEntities{domain.NewMessageEntityBold(0, 4)},
		ReplyToID: &reply,
	})
	if err != nil || d.Text != "*bold* черновик" || d.ReplyToID == nil || *d.ReplyToID != 42 || len(d.Entities) != 1 {
		t.Fatalf("Upsert: %+v, %v", d, err)
	}
	d2, err := r.Upsert(ctx, user, domain.Draft{ChatID: chat1, Text: "обновлённый"})
	if err != nil || d2.Text != "обновлённый" || d2.ReplyToID != nil || d2.Entities != nil {
		t.Fatalf("Upsert update: %+v, %v", d2, err)
	}
	if !d2.UpdatedAt.Before(d.UpdatedAt) && !d2.UpdatedAt.After(d.UpdatedAt) && !d2.UpdatedAt.Equal(d.UpdatedAt) {
		t.Fatalf("UpdatedAt not set")
	}

	// Список пользователя.
	_, _ = r.Upsert(ctx, user, domain.Draft{ChatID: chat2, Text: "второй"})
	list, err := r.ListByUser(ctx, user)
	if err != nil || len(list) != 2 {
		t.Fatalf("ListByUser: %+v, %v", list, err)
	}

	// Delete: true при удалении, false при отсутствии.
	if _, ok, err := r.Delete(ctx, chat1, user, 0); err != nil || !ok {
		t.Fatalf("Delete: %v %v", ok, err)
	}
	if _, ok, _ := r.Delete(ctx, chat1, user, 0); ok {
		t.Fatalf("Delete again must be false")
	}

	// DeleteAllByUser возвращает ключи удалённых.
	_, _ = r.Upsert(ctx, user, domain.Draft{ChatID: chat1, Text: "снова"})
	gone, err := r.DeleteAllByUser(ctx, user)
	if err != nil || len(gone) != 2 {
		t.Fatalf("DeleteAllByUser: %v, %v", gone, err)
	}
	if list, _ := r.ListByUser(ctx, user); len(list) != 0 {
		t.Fatalf("drafts must be empty: %+v", list)
	}
}

// Ф-5 п. 3 (A3-32): черновики одного чата в двух темах и в General живут
// рядом — ключ «пир + тред» (tweb appDraftsManager.ts:88-90). Номер треда
// наружу выводит хранилище: тема — номер её корня, ключ 0 в форуме — General
// (1), вне форума — черновик чата (0).
func TestDraftsRepo_ThreadKeys(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewDraftsRepo(pool)
	ctx := context.Background()
	user := seedUser(t, pool, "+7912")

	var forum, plain int64
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type, is_forum) VALUES ('group', true) RETURNING id`).Scan(&forum); err != nil {
		t.Fatalf("seed forum: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO chats (type) VALUES ('group') RETURNING id`).Scan(&plain); err != nil {
		t.Fatalf("seed group: %v", err)
	}
	rootA := seedMessage(t, pool, forum, user, 5)
	rootB := seedMessage(t, pool, forum, user, 9)

	for _, d := range []domain.Draft{
		{ChatID: forum, ThreadRootID: rootA, Text: "в теме A"},
		{ChatID: forum, ThreadRootID: rootB, Text: "в теме B"},
		{ChatID: forum, Text: "в General"},
		{ChatID: plain, Text: "в чате"},
	} {
		got, err := r.Upsert(ctx, user, d)
		if err != nil || got.ThreadRootID != d.ThreadRootID || got.Text != d.Text {
			t.Fatalf("Upsert %+v: %+v, %v", d, got, err)
		}
	}
	// Повтор в тот же тред — обновление, а не вторая строка.
	if got, err := r.Upsert(ctx, user, domain.Draft{ChatID: forum, ThreadRootID: rootA, Text: "A снова"}); err != nil || got.TopMsgID != 5 {
		t.Fatalf("Upsert again: %+v, %v", got, err)
	}

	want := map[string]int64{"A снова": 5, "в теме B": 9, "в General": domain.GeneralTopicID, "в чате": 0}
	list, err := r.ListByUser(ctx, user)
	if err != nil || len(list) != len(want) {
		t.Fatalf("ListByUser: %+v, %v", list, err)
	}
	for _, d := range list {
		if top, ok := want[d.Text]; !ok || d.TopMsgID != top {
			t.Fatalf("черновик %q: top_msg_id = %d, ждали %d", d.Text, d.TopMsgID, top)
		}
	}
	inForum, err := r.ListByChat(ctx, user, forum)
	if err != nil || len(inForum) != 3 {
		t.Fatalf("ListByChat: %+v, %v", inForum, err)
	}

	// Снятие треда A не трогает B и General; номер снятого — для кадра.
	if top, ok, err := r.Delete(ctx, forum, user, rootA); err != nil || !ok || top != 5 {
		t.Fatalf("Delete A: %d %v %v", top, ok, err)
	}
	if top, ok, err := r.Delete(ctx, forum, user, 0); err != nil || !ok || top != domain.GeneralTopicID {
		t.Fatalf("Delete General: %d %v %v", top, ok, err)
	}
	if left, _ := r.ListByChat(ctx, user, forum); len(left) != 1 || left[0].ThreadRootID != rootB {
		t.Fatalf("после снятия A и General: %+v", left)
	}

	// Сирота: корня треда нет — номер не вывести, черновик не выдаётся, и
	// снимать его на устройствах нечего.
	if _, err := pool.Exec(ctx, `INSERT INTO drafts (chat_id, user_id, thread_root_id, text) VALUES ($1, $2, 987654321, 'сирота')`, forum, user); err != nil {
		t.Fatalf("seed orphan: %v", err)
	}
	if list, _ := r.ListByChat(ctx, user, forum); len(list) != 1 {
		t.Fatalf("сирота в списке: %+v", list)
	}
	if _, ok, err := r.Delete(ctx, forum, user, 987654321); err != nil || ok {
		t.Fatalf("Delete сироты: ok=%v, %v", ok, err)
	}

	gone, err := r.DeleteAllByUser(ctx, user)
	if err != nil || len(gone) != 2 {
		t.Fatalf("DeleteAllByUser: %+v, %v", gone, err)
	}
	for _, d := range gone {
		if (d.ChatID == forum && d.TopMsgID != 9) || (d.ChatID == plain && d.TopMsgID != 0) {
			t.Fatalf("ключ снятого: %+v", d)
		}
	}
}
