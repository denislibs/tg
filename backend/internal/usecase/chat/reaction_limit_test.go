package chat

import (
	"context"
	"sort"
	"testing"
)

// Лимит «сколько реакций ставит ОДИН пользователь на одном сообщении» и его
// вытеснение (tweb src/lib/appManagers/appReactionsManager.ts:733-751, лимит —
// apiManagerMethods.ts:369-395). Проверяется РЕЗУЛЬТАТ: что осталось на
// сообщении после серии кликов, — а не то, какие методы репозитория позвались.
//
// Сервер держит правило сам, а не доверяет клиенту: прямой POST мимо интерфейса
// обходил бы любую проверку фронта.

// fakePremium — premium-статус по списку id (аналог users.is_premium).
type fakePremium struct{ premium map[int64]bool }

func (f *fakePremium) IsPremium(_ context.Context, userID int64) (bool, error) {
	return f.premium[userID], nil
}

func (f *fakePremium) GrantPremium(_ context.Context, userID int64) error {
	if f.premium == nil {
		f.premium = map[int64]bool{}
	}
	f.premium[userID] = true
	return nil
}

// myReactions — эмодзи, которые на сообщении числятся ЗА ЭТИМ зрителем, по
// read-модели истории (та самая, из которой рисуются чипы). Отсортированы,
// потому что вопрос теста — состав, а не порядок вывода.
func myReactions(t *testing.T, in *Interactor, messageID, userID int64) []string {
	t.Helper()
	byMsg, err := in.reactions.ReactionsFor(context.Background(), []int64{messageID}, userID)
	if err != nil {
		t.Fatalf("ReactionsFor: %v", err)
	}
	var out []string
	for _, rc := range byMsg[messageID] {
		if rc.Mine {
			out = append(out, rc.Emoji)
		}
	}
	sort.Strings(out)
	return out
}

// allReactions — все чипы сообщения (чьи угодно), эмодзи по алфавиту.
func allReactions(t *testing.T, in *Interactor, messageID int64) []string {
	t.Helper()
	byMsg, err := in.reactions.ReactionsFor(context.Background(), []int64{messageID}, 0)
	if err != nil {
		t.Fatalf("ReactionsFor: %v", err)
	}
	var out []string
	for _, rc := range byMsg[messageID] {
		out = append(out, rc.Emoji)
	}
	sort.Strings(out)
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Без премиума лимит — ОДНА реакция: вторая вытесняет первую, а не добавляется.
func TestReact_UserLimitDefault_EvictsPrevious(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	for _, e := range []string{"❤", "🔥", "🥰"} {
		if err := in.React(ctx, chatID, msg.ID, b, e, true); err != nil {
			t.Fatalf("React(%s): %v", e, err)
		}
	}

	if got := myReactions(t, in, msg.ID, b); !equalStrings(got, []string{"🥰"}) {
		t.Fatalf("свои реакции = %v; ждали только последнюю [🥰]", got)
	}
	if got := allReactions(t, in, msg.ID); !equalStrings(got, []string{"🥰"}) {
		t.Fatalf("чипы сообщения = %v; вытесненные должны исчезнуть совсем", got)
	}
}

// С премиумом лимит — ТРИ: три реакции уживаются, а ЧЕТВЁРТАЯ вытесняет
// САМУЮ СТАРУЮ (а не произвольную и не саму себя).
func TestReact_UserLimitPremium_EvictsOldest(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	in.SetPremiumRepo(&fakePremium{premium: map[int64]bool{b: true}})
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	for _, e := range []string{"❤", "🔥", "🥰"} {
		if err := in.React(ctx, chatID, msg.ID, b, e, true); err != nil {
			t.Fatalf("React(%s): %v", e, err)
		}
	}
	if got := myReactions(t, in, msg.ID, b); !equalStrings(got, []string{"❤", "🔥", "🥰"}) {
		t.Fatalf("до лимита свои реакции = %v; ждали все три", got)
	}

	if err := in.React(ctx, chatID, msg.ID, b, "👏", true); err != nil {
		t.Fatalf("React(👏): %v", err)
	}
	if got := myReactions(t, in, msg.ID, b); !equalStrings(got, []string{"👏", "🔥", "🥰"}) {
		t.Fatalf("после четвёртой свои реакции = %v; ждали вытеснение старейшей ❤", got)
	}
}

// Повторный POST по УЖЕ поставленной реакции ничего не вытесняет и не
// дублирует: набор своих реакций не растёт, значит места освобождать не из чего.
func TestReact_SameEmojiTwice_KeepsOthers(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	in.SetPremiumRepo(&fakePremium{premium: map[int64]bool{b: true}})
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	for _, e := range []string{"❤", "🔥", "❤", "❤"} {
		if err := in.React(ctx, chatID, msg.ID, b, e, true); err != nil {
			t.Fatalf("React(%s): %v", e, err)
		}
	}
	if got := myReactions(t, in, msg.ID, b); !equalStrings(got, []string{"❤", "🔥"}) {
		t.Fatalf("свои реакции = %v; ждали [❤ 🔥] без вытеснения и без дублей", got)
	}
}

// Лимит персональный: вытесняются ТОЛЬКО свои реакции, чужие чипы на месте.
func TestReact_UserLimit_DoesNotTouchOthers(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)
	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	if err := in.React(ctx, chatID, msg.ID, a, "❤", true); err != nil {
		t.Fatalf("React(a,❤): %v", err)
	}
	if err := in.React(ctx, chatID, msg.ID, b, "❤", true); err != nil {
		t.Fatalf("React(b,❤): %v", err)
	}
	if err := in.React(ctx, chatID, msg.ID, b, "🔥", true); err != nil {
		t.Fatalf("React(b,🔥): %v", err)
	}

	if got := myReactions(t, in, msg.ID, a); !equalStrings(got, []string{"❤"}) {
		t.Fatalf("реакция другого пользователя = %v; её вытеснять нечем", got)
	}
	if got := myReactions(t, in, msg.ID, b); !equalStrings(got, []string{"🔥"}) {
		t.Fatalf("свои реакции = %v; ждали только последнюю", got)
	}
	if got := allReactions(t, in, msg.ID); !equalStrings(got, []string{"❤", "🔥"}) {
		t.Fatalf("чипы сообщения = %v; ждали чужое ❤ и своё 🔥", got)
	}
}
