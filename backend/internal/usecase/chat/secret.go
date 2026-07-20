package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// CreateSecretChat заводит чат type='secret' между userID и peerID и сохраняет
// публичный ключ инициатора. Возвращает SecretChat в состоянии requested.
func (i *Interactor) CreateSecretChat(ctx context.Context, userID, peerID int64, initiatorPub []byte) (domain.SecretChat, error) {
	if i.secret == nil {
		return domain.SecretChat{}, domain.ErrUnavailable
	}
	if userID == peerID || len(initiatorPub) == 0 {
		return domain.SecretChat{}, domain.ErrInvalid
	}
	chatID, err := i.chats.CreateSecret(ctx, userID, peerID)
	if err != nil {
		return domain.SecretChat{}, err
	}
	sc := domain.SecretChat{ChatID: chatID, InitiatorID: userID, ResponderID: peerID, InitiatorPub: initiatorPub, State: domain.SecretRequested}
	if err := i.secret.Create(ctx, sc); err != nil {
		return domain.SecretChat{}, err
	}
	i.publishSecretFrame(ctx, sc, "secret_chat_request")
	return sc, nil
}

func (i *Interactor) AcceptSecretChat(ctx context.Context, chatID, userID int64, responderPub []byte) (domain.SecretChat, error) {
	if i.secret == nil {
		return domain.SecretChat{}, domain.ErrUnavailable
	}
	if len(responderPub) == 0 {
		return domain.SecretChat{}, domain.ErrInvalid
	}
	sc, err := i.secret.Get(ctx, chatID)
	if err != nil {
		return domain.SecretChat{}, err
	}
	if sc.ResponderID != userID || sc.State != domain.SecretRequested {
		return domain.SecretChat{}, domain.ErrForbidden
	}
	if err := i.secret.Accept(ctx, chatID, responderPub); err != nil {
		return domain.SecretChat{}, err
	}
	sc.ResponderPub = responderPub
	sc.State = domain.SecretAccepted
	i.publishSecretFrame(ctx, sc, "secret_chat_accept")
	return sc, nil
}

func (i *Interactor) RejectSecretChat(ctx context.Context, chatID, userID int64) error {
	if i.secret == nil {
		return domain.ErrUnavailable
	}
	sc, err := i.secret.Get(ctx, chatID)
	if err != nil {
		return err
	}
	if sc.InitiatorID != userID && sc.ResponderID != userID {
		return domain.ErrForbidden
	}
	if err := i.secret.SetState(ctx, chatID, domain.SecretRejected); err != nil {
		return err
	}
	sc.State = domain.SecretRejected
	i.publishSecretFrame(ctx, sc, "secret_chat_reject")
	return nil
}

// publishSecretFrame — no-op при nil publisher; тело (рассылка кадра обоим
// участникам) добавляется в следующей задаче (Task 11).
func (i *Interactor) publishSecretFrame(ctx context.Context, sc domain.SecretChat, t string) {
	if i.publisher == nil {
		return
	}
	// TODO(Task 11): рассылка кадра t обоим участникам через i.publisher.
	_ = ctx
	_ = sc
	_ = t
}
