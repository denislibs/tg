package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func TestSecretHandshake(t *testing.T) {
	in, _ := newSecretTestInteractor(t)
	ctx := context.Background()

	sc, err := in.CreateSecretChat(ctx, 1, 2, []byte("pubA"))
	if err != nil {
		t.Fatal(err)
	}
	if sc.State != domain.SecretRequested {
		t.Fatalf("state=%s", sc.State)
	}

	sc2, err := in.AcceptSecretChat(ctx, sc.ChatID, 2, []byte("pubB"))
	if err != nil {
		t.Fatal(err)
	}
	if sc2.State != domain.SecretAccepted {
		t.Fatalf("state=%s", sc2.State)
	}

	// не-получатель не может принять
	if _, err := in.AcceptSecretChat(ctx, sc.ChatID, 999, []byte("x")); err == nil {
		t.Fatal("expected error for non-responder accept")
	}
	// self-chat запрещён
	if _, err := in.CreateSecretChat(ctx, 5, 5, []byte("p")); err != domain.ErrInvalid {
		t.Fatalf("expected ErrInvalid, got %v", err)
	}
}
