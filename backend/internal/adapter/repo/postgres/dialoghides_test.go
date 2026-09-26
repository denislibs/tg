package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// «Удалить только у себя» (message_hides) обязано доходить до строки списка
// чатов так же, как до истории: история скрытое сообщение не показывает, и
// top_message диалога не может на него ссылаться — иначе список чатов
// показывает последним сообщение, которого в открытом чате нет. У собеседника
// скрытие зрителя ничего не меняет.
func TestChatsRepo_ListDialogs_TopMessageSkipsHiddenForViewer(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7500")
	b := seedUser(t, pool, "+7501")
	chatID := createPrivate(t, pool, a, b)

	first := insertMsg(t, msgs, chatID, b, "text", "видимое")
	second := insertMsg(t, msgs, chatID, b, "text", "скрыто у a")
	third := insertMsg(t, msgs, chatID, a, "text", "тоже скрыто у a")
	for _, m := range []int64{second.ID, third.ID} {
		if err := msgs.HideForUser(ctx, a, m); err != nil {
			t.Fatalf("hide: %v", err)
		}
	}

	da, err := repo.ListDialogs(ctx, a)
	if err != nil {
		t.Fatalf("ListDialogs(a): %v", err)
	}
	if len(da) != 1 || da[0].TopMessageID != first.ID || da[0].TopMessageSeq != first.Seq {
		t.Fatalf("top_message у a = id %d seq %d; ждали последнее ВИДИМОЕ id %d seq %d",
			da[0].TopMessageID, da[0].TopMessageSeq, first.ID, first.Seq)
	}
	db, err := repo.ListDialogs(ctx, b)
	if err != nil {
		t.Fatalf("ListDialogs(b): %v", err)
	}
	if len(db) != 1 || db[0].TopMessageID != third.ID {
		t.Fatalf("top_message у b = %d; скрытие a не должно его трогать, ждали %d", db[0].TopMessageID, third.ID)
	}
}

// Порядок списка идёт по дате последнего ВИДИМОГО сообщения: чат, чьё свежее
// сообщение зритель удалил у себя, не должен всплывать выше чата, где
// последнее видимое сообщение новее.
func TestChatsRepo_ListDialogs_OrderByLastVisible(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	me := seedUser(t, pool, "+7510")
	x := seedUser(t, pool, "+7511")
	y := seedUser(t, pool, "+7512")
	chatX := createPrivate(t, pool, me, x)
	chatY := createPrivate(t, pool, me, y)

	insertMsg(t, msgs, chatY, y, "text", "старое видимое в Y")
	insertMsg(t, msgs, chatX, x, "text", "среднее в X")
	hidden := insertMsg(t, msgs, chatY, y, "text", "свежее в Y, скрыто у меня")
	if err := msgs.HideForUser(ctx, me, hidden.ID); err != nil {
		t.Fatalf("hide: %v", err)
	}

	ds, err := repo.ListDialogs(ctx, me)
	if err != nil {
		t.Fatalf("ListDialogs: %v", err)
	}
	if len(ds) != 2 || ds[0].ChatID != chatX || ds[1].ChatID != chatY {
		got := make([]int64, len(ds))
		for i, d := range ds {
			got[i] = d.ChatID
		}
		t.Fatalf("порядок = %v; ждали [X=%d, Y=%d] — по последнему видимому сообщению", got, chatX, chatY)
	}
}
