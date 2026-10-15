package postgres

import (
	"context"
	"slices"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// f6-pin (миграция 0175): закреп «только у себя», выборки по зрителю и
// видимость закрепа (Р-3 сверки Ф-4).

func pinIDs(t *testing.T, chats *ChatsRepo, chatID, viewer int64) []int64 {
	t.Helper()
	ms, err := chats.ListPins(context.Background(), chatID, viewer)
	if err != nil {
		t.Fatalf("ListPins(viewer %d): %v", viewer, err)
	}
	return msgIDs(ms)
}

// ListPins / PinnedIDs / pinned_msg_id лички — объединение общих закрепов и
// «только у себя» зрителя; удалённое у всех, скрытое «у себя» зрителем и
// очищенное его горизонтом в них не попадает ни по одной из выборок.
func TestPins_OneSideViewerAndVisibility(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	groups := NewGroupRepo(pool)
	privacy := NewPrivacyRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7810")
	b := seedUser(t, pool, "+7811")
	chatID := createPrivate(t, pool, a, b)
	m1 := insertMsg(t, msgs, chatID, a, "text", "общий закреп")
	m2 := insertMsg(t, msgs, chatID, a, "text", "только у Б")
	m3 := insertMsg(t, msgs, chatID, a, "text", "без закрепа")

	if err := chats.PinMessage(ctx, chatID, m1.ID, a); err != nil {
		t.Fatalf("PinMessage: %v", err)
	}
	if err := chats.PinMessageOneSide(ctx, chatID, m2.ID, b); err != nil {
		t.Fatalf("PinMessageOneSide: %v", err)
	}
	// Повтор безопасен.
	if err := chats.PinMessageOneSide(ctx, chatID, m2.ID, b); err != nil {
		t.Fatalf("PinMessageOneSide(повтор): %v", err)
	}

	if got := pinIDs(t, chats, chatID, a); !slices.Equal(got, []int64{m1.ID}) {
		t.Fatalf("ListPins(A) = %v, want [%d]", got, m1.ID)
	}
	// Новый закреп первым.
	if got := pinIDs(t, chats, chatID, b); !slices.Equal(got, []int64{m2.ID, m1.ID}) {
		t.Fatalf("ListPins(B) = %v, want [%d %d]", got, m2.ID, m1.ID)
	}
	all := []int64{m1.ID, m2.ID, m3.ID}
	pa, _ := chats.PinnedIDs(ctx, a, all)
	pb, _ := chats.PinnedIDs(ctx, b, all)
	if !pa[m1.ID] || pa[m2.ID] || pa[m3.ID] {
		t.Fatalf("PinnedIDs(A) = %v", pa)
	}
	if !pb[m1.ID] || !pb[m2.ID] || pb[m3.ID] {
		t.Fatalf("PinnedIDs(B) = %v", pb)
	}
	// pinned_msg_id лички: новейший закреп зрителя.
	if st, err := privacy.PeerFullState(ctx, b, a); err != nil || st.PinnedMsgID != m2.Seq {
		t.Fatalf("pinned_msg_id(B) = %d, %v; want %d", st.PinnedMsgID, err, m2.Seq)
	}
	if st, err := privacy.PeerFullState(ctx, a, b); err != nil || st.PinnedMsgID != m1.Seq {
		t.Fatalf("pinned_msg_id(A) = %d, %v; want %d", st.PinnedMsgID, err, m1.Seq)
	}
	// Карточка чата (chatFull.pinned_msg_id) — та же раскладка.
	if card, err := groups.Card(ctx, chatID, b); err != nil || card.PinnedMsgID != m2.Seq {
		t.Fatalf("Card(B).pinned_msg_id = %d, %v; want %d", card.PinnedMsgID, err, m2.Seq)
	}
	if card, err := groups.Card(ctx, chatID, a); err != nil || card.PinnedMsgID != m1.Seq {
		t.Fatalf("Card(A).pinned_msg_id = %d, %v; want %d", card.PinnedMsgID, err, m1.Seq)
	}

	// Мягкое удаление: закреп «только у себя» удалённого не виден нигде.
	if _, err := msgs.SoftDelete(ctx, m2.ID); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}
	if got := pinIDs(t, chats, chatID, b); !slices.Equal(got, []int64{m1.ID}) {
		t.Fatalf("после удаления ListPins(B) = %v, want [%d]", got, m1.ID)
	}
	if pb, _ = chats.PinnedIDs(ctx, b, all); pb[m2.ID] {
		t.Fatalf("после удаления PinnedIDs(B) = %v", pb)
	}
	if st, _ := privacy.PeerFullState(ctx, b, a); st.PinnedMsgID != m1.Seq {
		t.Fatalf("после удаления pinned_msg_id(B) = %d, want %d", st.PinnedMsgID, m1.Seq)
	}
	if card, _ := groups.Card(ctx, chatID, b); card.PinnedMsgID != m1.Seq {
		t.Fatalf("после удаления Card(B).pinned_msg_id = %d, want %d", card.PinnedMsgID, m1.Seq)
	}

	// Р-3: удалённый зрителем «у себя» общий закреп в его списке не виден, у
	// собеседника остаётся.
	if _, err := msgs.HideForUser(ctx, b, m1.ID); err != nil {
		t.Fatalf("HideForUser: %v", err)
	}
	if got := pinIDs(t, chats, chatID, b); len(got) != 0 {
		t.Fatalf("скрытый у себя закреп в ListPins(B): %v", got)
	}
	if st, _ := privacy.PeerFullState(ctx, b, a); st.PinnedMsgID != 0 {
		t.Fatalf("скрытый у себя закреп в pinned_msg_id лички: %d", st.PinnedMsgID)
	}
	if got := pinIDs(t, chats, chatID, a); !slices.Equal(got, []int64{m1.ID}) {
		t.Fatalf("ListPins(A) после чужого hide = %v", got)
	}

	// Р-3: горизонт «очистить историю» — закреп ниже горизонта не виден.
	if err := chats.SetClearedSeq(ctx, chatID, a, m1.Seq); err != nil {
		t.Fatalf("SetClearedSeq: %v", err)
	}
	if got := pinIDs(t, chats, chatID, a); len(got) != 0 {
		t.Fatalf("закреп ниже горизонта очистки в ListPins(A): %v", got)
	}
	if st, _ := privacy.PeerFullState(ctx, a, b); st.PinnedMsgID != 0 {
		t.Fatalf("закреп ниже горизонта в pinned_msg_id лички: %d", st.PinnedMsgID)
	}
}

// Р-3 для группы со скрытой предысторией: вступивший позже не видит закреп,
// отправленный до его вступления.
func TestPins_ListPinsHidesPreHistoryForNewMember(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	groups := NewGroupRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7812")
	late := seedUser(t, pool, "+7813")
	chatID := createGroupLike(t, pool, "group", owner)
	old := insertMsg(t, msgs, chatID, owner, "text", "до вступления")
	if _, err := pool.Exec(ctx, `UPDATE chats SET history_for_new=false WHERE id=$1`, chatID); err != nil {
		t.Fatalf("history_for_new: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE messages SET created_at = now() - interval '1 hour' WHERE id=$1`, old.ID); err != nil {
		t.Fatalf("created_at: %v", err)
	}
	if err := groups.AddMember(ctx, chatID, late, domain.RoleMember, 0); err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	fresh := insertMsg(t, msgs, chatID, owner, "text", "после вступления")
	_ = chats.PinMessage(ctx, chatID, old.ID, owner)
	_ = chats.PinMessage(ctx, chatID, fresh.ID, owner)
	if got := pinIDs(t, chats, chatID, late); !slices.Equal(got, []int64{fresh.ID}) {
		t.Fatalf("ListPins(новичок) = %v, want [%d]", got, fresh.ID)
	}
	if got := pinIDs(t, chats, chatID, owner); !slices.Equal(got, []int64{fresh.ID, old.ID}) {
		t.Fatalf("ListPins(владелец) = %v", got)
	}
}

// UnpinMessage снимает общий закреп и закреп «только у себя» ТОЛЬКО зрителя;
// shared сообщает, был ли общий.
func TestPins_UnpinMessageSharedFlag(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7814")
	b := seedUser(t, pool, "+7815")
	chatID := createPrivate(t, pool, a, b)
	m := insertMsg(t, msgs, chatID, a, "text", "x")

	_ = chats.PinMessageOneSide(ctx, chatID, m.ID, a)
	_ = chats.PinMessageOneSide(ctx, chatID, m.ID, b)
	shared, err := chats.UnpinMessage(ctx, chatID, m.ID, b)
	if err != nil || shared {
		t.Fatalf("UnpinMessage(только свой) = %v, %v; want false", shared, err)
	}
	if got := pinIDs(t, chats, chatID, b); len(got) != 0 {
		t.Fatalf("свой закреп B не снят: %v", got)
	}
	if got := pinIDs(t, chats, chatID, a); !slices.Equal(got, []int64{m.ID}) {
		t.Fatalf("чужой «только у себя» A снят: %v", got)
	}
	_ = chats.PinMessage(ctx, chatID, m.ID, a)
	_ = chats.PinMessageOneSide(ctx, chatID, m.ID, b)
	shared, err = chats.UnpinMessage(ctx, chatID, m.ID, b)
	if err != nil || !shared {
		t.Fatalf("UnpinMessage(общий) = %v, %v; want true", shared, err)
	}
	if got := pinIDs(t, chats, chatID, b); len(got) != 0 {
		t.Fatalf("после снятия общего+своего у B остался закреп: %v", got)
	}
	// A: общий снят, его «только у себя» остался.
	if got := pinIDs(t, chats, chatID, a); !slices.Equal(got, []int64{m.ID}) {
		t.Fatalf("ListPins(A) = %v, want свой oneside", got)
	}
}

// UnpinAll: общие закрепы чата и «только у себя» актора, номера по
// возрастанию; с корнем треда — только закрепы треда (и его корень); чужие
// «только у себя» не трогает.
func TestPins_UnpinAll(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	chats := NewChatsRepo(pool)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7816")
	b := seedUser(t, pool, "+7817")
	chatID := createPrivate(t, pool, a, b)
	root := insertMsg(t, msgs, chatID, a, "text", "корень")
	seq, _ := msgs.NextSeq(ctx, chatID)
	inThread, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "в треде", ThreadRootID: &root.ID})
	if err != nil {
		t.Fatalf("insert thread: %v", err)
	}
	outside := insertMsg(t, msgs, chatID, a, "text", "вне треда")
	own := insertMsg(t, msgs, chatID, a, "text", "мой oneside")
	foreign := insertMsg(t, msgs, chatID, a, "text", "oneside собеседника")
	for _, m := range []domain.Message{outside, inThread, root} {
		_ = chats.PinMessage(ctx, chatID, m.ID, a)
	}
	_ = chats.PinMessageOneSide(ctx, chatID, own.ID, b)
	_ = chats.PinMessageOneSide(ctx, chatID, foreign.ID, a)

	// Тред: общие закрепы корня и сообщения треда, без «вне треда» и без oneside вне треда.
	shared, oneSide, err := chats.UnpinAll(ctx, chatID, b, &root.ID)
	if err != nil {
		t.Fatalf("UnpinAll(тред): %v", err)
	}
	if !slices.Equal(shared, []int64{root.Seq, inThread.Seq}) || len(oneSide) != 0 {
		t.Fatalf("UnpinAll(тред) = %v / %v, want [%d %d] / []", shared, oneSide, root.Seq, inThread.Seq)
	}
	if got := pinIDs(t, chats, chatID, b); !slices.Equal(got, []int64{own.ID, outside.ID}) {
		t.Fatalf("после «открепить все» в треде ListPins(B) = %v", got)
	}

	shared, oneSide, err = chats.UnpinAll(ctx, chatID, b, nil)
	if err != nil {
		t.Fatalf("UnpinAll: %v", err)
	}
	if !slices.Equal(shared, []int64{outside.Seq}) || !slices.Equal(oneSide, []int64{own.Seq}) {
		t.Fatalf("UnpinAll = %v / %v, want [%d] / [%d]", shared, oneSide, outside.Seq, own.Seq)
	}
	if got := pinIDs(t, chats, chatID, b); len(got) != 0 {
		t.Fatalf("после «открепить все» у B: %v", got)
	}
	// «Только у себя» собеседника цел.
	if got := pinIDs(t, chats, chatID, a); !slices.Equal(got, []int64{foreign.ID}) {
		t.Fatalf("ListPins(A) = %v, want чужой oneside не тронут", got)
	}
	// Повтор — пусто.
	shared, oneSide, err = chats.UnpinAll(ctx, chatID, b, nil)
	if err != nil || len(shared) != 0 || len(oneSide) != 0 {
		t.Fatalf("UnpinAll(повтор) = %v / %v, %v", shared, oneSide, err)
	}
}
