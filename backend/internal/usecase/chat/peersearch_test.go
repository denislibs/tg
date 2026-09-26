package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func chatIDsOf(cs []domain.ChatRecord) []int64 {
	out := make([]int64, len(cs))
	for i, c := range cs {
		out[i] = c.ID
	}
	return out
}

func userIDsOf(us []domain.UserReal) []int64 {
	out := make([]int64, len(us))
	for i, u := range us {
		out[i] = u.ID
	}
	return out
}

func eqIDs(got []int64, want ...int64) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// Задача 4: выдача contacts.search делится на «свои» (my_results → группа
// «Chats») и глобальные (results → «Global search»), tweb
// appSearchSuper.ts:1427-1428. Свой пир — чат, где зритель участник, и
// пользователь из его контактов или с общим личным чатом — уезжает в
// my_results, а НЕ в results (иначе класс нарисует его в «Global search»).
// Принадлежность спрашивается ОДНИМ вызовом на всю выдачу, а не по пиру.
// limit уважается (класс просит 20 для «Chats» и 200 для вкладки Channels,
// :1977); без q — пусто, и в базу не ходим.
func TestSearchPeers_MyResultsAndLimit(t *testing.T) {
	fs := newFakeSearchRepo()
	fs.chats = []domain.ChatRecord{{ID: 10, Type: "channel", Title: "Коты"}, {ID: 11, Type: "channel", Title: "Котики"}}
	fs.users = []domain.UserReal{{ID: 42}, {ID: 43}}
	fs.ownChats = map[int64]bool{10: true}
	fs.ownUsers = map[int64]bool{43: true}
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, nil, nil, nil, nil, nil, nil, fs, nil)
	ctx := context.Background()
	const me int64 = 7

	res, err := in.SearchPeers(ctx, me, "кот", 0)
	if err != nil {
		t.Fatalf("SearchPeers: %v", err)
	}
	if !eqIDs(chatIDsOf(res.MyChats), 10) || !eqIDs(chatIDsOf(res.Chats), 11) {
		t.Fatalf("чаты: my=%v results=%v, want my=[10] results=[11]", chatIDsOf(res.MyChats), chatIDsOf(res.Chats))
	}
	if !eqIDs(userIDsOf(res.MyUsers), 43) || !eqIDs(userIDsOf(res.Users), 42) {
		t.Fatalf("люди: my=%v results=%v, want my=[43] results=[42]", userIDsOf(res.MyUsers), userIDsOf(res.Users))
	}
	if fs.ownCalls != 1 || fs.ownViewer != me {
		t.Fatalf("принадлежность спрошена %d раз(а) для %d, want 1 раз для %d", fs.ownCalls, fs.ownViewer, me)
	}
	if fs.lastLimit != 20 {
		t.Fatalf("limit по умолчанию = %d, want 20", fs.lastLimit)
	}

	for _, c := range []struct{ ask, want int }{{200, 200}, {5, 5}, {1000, 200}} {
		if _, err := in.SearchPeers(ctx, me, "кот", c.ask); err != nil {
			t.Fatalf("limit=%d: %v", c.ask, err)
		}
		if fs.lastLimit != c.want {
			t.Fatalf("limit=%d дошёл до базы как %d, want %d", c.ask, fs.lastLimit, c.want)
		}
	}

	calls := fs.searchCalls
	empty, err := in.SearchPeers(ctx, me, "  ", 20)
	if err != nil || len(empty.MyChats)+len(empty.Chats)+len(empty.MyUsers)+len(empty.Users) != 0 {
		t.Fatalf("пустой q: %+v err=%v, want пусто", empty, err)
	}
	if fs.searchCalls != calls {
		t.Fatal("пустой q всё равно сходил в базу")
	}
}
