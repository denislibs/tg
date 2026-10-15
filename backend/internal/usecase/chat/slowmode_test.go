package chat

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф7-И1 (MC-08): отказ медленного режима несёт остаток ожидания —
// SLOWMODE_WAIT_<N> (tweb appImManager.ts:551-565 берёт N из error.type).
func TestSlowmodeWait_Seconds(t *testing.T) {
	in, _, _, id := gateGroup(t)
	ctx := context.Background()
	a, _ := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "раз"})
	b, _ := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "два"})
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 60); err != nil {
		t.Fatal(err)
	}
	fwd := func(ids ...int64) error {
		_, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: id, ToChatID: id, MsgIDs: ids, SenderID: 8})
		return err
	}

	// Пачка из двух единиц: окно ещё не началось — N равно полному периоду.
	var wait domain.ErrSlowmodeWait
	if err := fwd(a.ID, b.ID); !errors.As(err, &wait) || wait.Seconds != 60 {
		t.Fatalf("пачка: %v, want ErrSlowmodeWait{60}", err)
	}
	if err := fwd(a.ID); err != nil {
		t.Fatalf("одна единица: %v", err)
	}
	// Вторая пересылка в окне: остаток ≤ периода и ≥ 1; sentinel жив.
	err := fwd(b.ID)
	if !errors.As(err, &wait) || wait.Seconds < 59 || wait.Seconds > 60 {
		t.Fatalf("окно: %v, want ErrSlowmodeWait{59..60}", err)
	}
	if !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("errors.Is(err, ErrSlowmode) должно оставаться истинным: %v", err)
	}
	if got := wait.Error(); got != fmt.Sprintf("SLOWMODE_WAIT_%d", wait.Seconds) {
		t.Fatalf("текст: %q", got)
	}
}
