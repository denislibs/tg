package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Глобальный поиск листается курсором next_rate сквозь юзкейс: курсор ответа
// доезжает до вызывающего как есть; лимит больше потолка зажимается до
// потолка (100), а не сбрасывается в 20 — клиент считает выдачу исчерпанной по
// короткой странице (tweb appSearchSuper.ts:2311), и его loadCount бывает и 50,
// и больше (:2561); пустой запрос без фильтра ничего не ищет и курсора не
// несёт — иначе клиент решил бы, что есть продолжение.
func TestGlobalSearchMessages_NextRateThroughUsecase(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	for i := 0; i < 105; i++ {
		if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "text", Text: "кот"}); err != nil {
			t.Fatalf("send: %v", err)
		}
	}

	page1, err := in.GlobalSearchMessages(ctx, a, GlobalSearchQuery{Q: "кот", Limit: 500})
	if err != nil {
		t.Fatalf("page1: %v", err)
	}
	if len(page1.Messages) != 100 || page1.Count != 105 {
		t.Fatalf("page1: %d сообщений из %d, want 100 из 105 (лимит зажат до потолка)", len(page1.Messages), page1.Count)
	}
	if last := page1.Messages[len(page1.Messages)-1]; page1.NextRate != last.ID {
		t.Fatalf("next_rate = %d, want id последнего отданного %d", page1.NextRate, last.ID)
	}

	page2, err := in.GlobalSearchMessages(ctx, a, GlobalSearchQuery{Q: "кот", Limit: 60, OffsetRate: page1.NextRate})
	if err != nil {
		t.Fatalf("page2: %v", err)
	}
	if len(page2.Messages) != 5 || page2.NextRate != 0 {
		t.Fatalf("page2: %d сообщений, next_rate=%d; want 5 без next_rate", len(page2.Messages), page2.NextRate)
	}

	// loadCount клиента 60 (высокое окно) — ровно 60, а не умолчание 20.
	big, err := in.GlobalSearchMessages(ctx, a, GlobalSearchQuery{Q: "кот", Limit: 60})
	if err != nil || len(big.Messages) != 60 {
		t.Fatalf("limit=60: %d сообщений err=%v; want 60", len(big.Messages), err)
	}

	empty, err := in.GlobalSearchMessages(ctx, a, GlobalSearchQuery{Limit: 20})
	if err != nil || len(empty.Messages) != 0 || empty.NextRate != 0 {
		t.Fatalf("пустой запрос: %+v err=%v; want пусто без курсора", empty, err)
	}
}

// Неизвестный chat_type — ошибка (400 на ручке), а не молча «все чаты»:
// расширенная выдача выглядела бы как сработавший фильтр ChatTypeMenu.
func TestGlobalSearchMessages_UnknownChatTypeIsInvalid(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	for _, ct := range []string{"", SearchChatTypeUsers, SearchChatTypeGroups, SearchChatTypeChannels} {
		if _, err := in.GlobalSearchMessages(ctx, 1, GlobalSearchQuery{Q: "кот", ChatType: ct}); err != nil {
			t.Fatalf("chat_type=%q: %v", ct, err)
		}
	}
	for _, ct := range []string{"bots", "broadcasts", "USERS"} {
		if _, err := in.GlobalSearchMessages(ctx, 1, GlobalSearchQuery{Q: "кот", ChatType: ct}); !errors.Is(err, domain.ErrInvalid) {
			t.Fatalf("chat_type=%q: err=%v, want ErrInvalid", ct, err)
		}
	}
}

// Чип даты без текста — это запрос, а не «искать нечего»: класс шлёт его при
// query ИЛИ peerId ИЛИ minDate (tweb appSearchSuper.ts:2233-2236).
func TestGlobalSearchMessages_DateChipWithoutQuery(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "text", Text: "что угодно"}); err != nil {
		t.Fatalf("send: %v", err)
	}
	res, err := in.GlobalSearchMessages(ctx, a, GlobalSearchQuery{MinDate: 1, MaxDate: 4102444800})
	if err != nil || len(res.Messages) != 1 {
		t.Fatalf("чип даты без текста: %d сообщений err=%v, want 1", len(res.Messages), err)
	}
}

// Поиск в одном чате листается курсором по номеру (как /media) сквозь юзкейс,
// а лимит больше потолка зажимается до потолка, а не сбрасывается в 20: у
// класса с чипом пира loadCount бывает больше 50 (tweb appSearchSuper.ts:2561).
func TestSearchMessages_CursorAndLimitThroughUsecase(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	for i := 0; i < 70; i++ {
		if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Type: "text", Text: "кот"}); err != nil {
			t.Fatalf("send: %v", err)
		}
	}
	page1, err := in.SearchMessages(ctx, chatID, a, "кот", SearchFilter{}, MediaPage{Limit: 60})
	if err != nil || len(page1.Messages) != 60 || page1.Count != 70 {
		t.Fatalf("page1: %d из %d err=%v, want 60 из 70", len(page1.Messages), page1.Count, err)
	}
	last := page1.Messages[len(page1.Messages)-1].Seq
	page2, err := in.SearchMessages(ctx, chatID, a, "кот", SearchFilter{}, MediaPage{OffsetID: last, Limit: 60})
	if err != nil || len(page2.Messages) != 10 {
		t.Fatalf("page2: %d err=%v, want 10", len(page2.Messages), err)
	}
	for _, m := range page2.Messages {
		if m.Seq >= last {
			t.Fatalf("page2 несёт seq=%d не ниже курсора %d", m.Seq, last)
		}
	}
}
