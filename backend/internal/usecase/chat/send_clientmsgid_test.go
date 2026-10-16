package chat

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ключ идемпотентности лежит под btree-индексом; слишком длинный даёт SQLSTATE
// 54000 → детерминированный 500, который клиент повторял бы вечно (план Ф-7,
// Task 9, Step 11). Отказ — ErrInvalid до всякой записи.
func TestSend_ClientMsgIDTooLong(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	_, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Text: "x", ClientMsgID: strings.Repeat("a", maxClientMsgIDLen+1)})
	if !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("длинный client_msg_id: err = %v, want ErrInvalid", err)
	}
	if _, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Text: "x", ClientMsgID: strings.Repeat("a", maxClientMsgIDLen)}); err != nil {
		t.Fatalf("ключ предельной длины: %v", err)
	}
}

// Значения за пределом колонки INT драйвер не кодирует: не PgError, а 500, который
// клиент повторял бы вечно (Step 11). Для темы корень к тому моменту уже закоммичен.
func TestCreateTopic_IconColorOutOfRange(t *testing.T) {
	in, _, _, id := gateGroup(t)
	in.SetTopics(newFakeTopicRepo())
	ctx := context.Background()
	if err := in.SetForum(ctx, id, 7, true); err != nil {
		t.Fatal(err)
	}
	if _, _, err := in.CreateTopic(ctx, id, 7, "Т", "", 3_000_000_000); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("icon_color за пределом: err = %v, want ErrInvalid", err)
	}
	if _, _, err := in.CreateTopic(ctx, id, 7, "Т", "", maxTopicIconColor); err != nil {
		t.Fatalf("icon_color на границе: %v", err)
	}
}

func TestInviteUsageLimit_OutOfRange(t *testing.T) {
	in, _, _, id := gateGroup(t)
	ctx := context.Background()
	big := maxInviteUsageLimit + 1
	if _, err := in.CreateInvite(ctx, id, 7, "", &big, false, nil); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("CreateInvite: err = %v, want ErrInvalid", err)
	}
	link, err := in.CreateInvite(ctx, id, 7, "", nil, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.EditInvite(ctx, id, 7, link.Token, domain.InviteEdit{SetUsageLimit: true, UsageLimit: &big}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("EditInvite: err = %v, want ErrInvalid", err)
	}
}
