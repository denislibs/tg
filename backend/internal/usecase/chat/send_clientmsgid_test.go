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
