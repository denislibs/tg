package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func callLogIDs(t *testing.T, msgs *MessagesRepo, userID int64) []int64 {
	t.Helper()
	entries, err := msgs.CallLog(context.Background(), userID, 0, 50)
	if err != nil {
		t.Fatalf("CallLog(%d): %v", userID, err)
	}
	ms := make([]domain.Message, len(entries))
	for i, e := range entries {
		ms[i] = e.Message
	}
	return msgIDs(ms)
}

// Журнал звонков — это messages.search с inputMessagesFilterPhoneCalls
// (tweb строит вкладку «Звонки» из сообщений), а поиск не отдаёт сообщений,
// удалённых зрителем «у себя». Звонок, скрытый у A, пропадает из журнала A и
// остаётся в журнале B.
func TestMessagesRepo_CallLogExcludesHiddenForViewer(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+7530")
	b := seedUser(t, pool, "+7531")
	chatID := createPrivate(t, pool, a, b)
	msgs := NewMessagesRepo(pool)

	kept := insertMsg(t, msgs, chatID, a, "call", "")
	hidden := insertMsg(t, msgs, chatID, b, "call", "")
	if err := msgs.HideForUser(ctx, a, hidden.ID); err != nil {
		t.Fatalf("hide: %v", err)
	}

	if got := callLogIDs(t, msgs, a); !sameIDs(got, kept.ID) {
		t.Fatalf("журнал a = %v; ждали только %d (звонок %d скрыт у a)", got, kept.ID, hidden.ID)
	}
	if got := callLogIDs(t, msgs, b); !sameIDs(got, hidden.ID, kept.ID) {
		t.Fatalf("журнал b = %v; ждали %d, %d — скрытие a его не трогает", got, hidden.ID, kept.ID)
	}
}
