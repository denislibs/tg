// Package passkeys — ключи доступа (WebAuthn): хранение discoverable
// credentials пользователя. Протокольная механика (challenge/attestation)
// живёт в HTTP-адаптере; здесь — только персистентность и инварианты.
package passkeys

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

type Repo interface {
	Save(ctx context.Context, pk domain.Passkey) (domain.Passkey, error)
	List(ctx context.Context, userID int64) ([]domain.Passkey, error)
	Delete(ctx context.Context, userID, id int64) (bool, error)
	ByCredID(ctx context.Context, credID string) (domain.Passkey, error) // domain.ErrNotFound
	// UpdateCredential обновляет сериализованный credential (счётчик подписи)
	// и штампует last_used_at.
	UpdateCredential(ctx context.Context, id int64, credential []byte) error
}

type Interactor struct{ repo Repo }

func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

// maxPasskeys — лимит ключей на аккаунт (tweb passkeys_account_passkeys_max).
const maxPasskeys = 10

func (i *Interactor) Add(ctx context.Context, pk domain.Passkey) (domain.Passkey, error) {
	existing, err := i.repo.List(ctx, pk.UserID)
	if err != nil {
		return domain.Passkey{}, err
	}
	if len(existing) >= maxPasskeys {
		return domain.Passkey{}, domain.ErrForbidden
	}
	return i.repo.Save(ctx, pk)
}

func (i *Interactor) List(ctx context.Context, userID int64) ([]domain.Passkey, error) {
	return i.repo.List(ctx, userID)
}

func (i *Interactor) Delete(ctx context.Context, userID, id int64) error {
	found, err := i.repo.Delete(ctx, userID, id)
	if err != nil {
		return err
	}
	if !found {
		return domain.ErrNotFound
	}
	return nil
}

func (i *Interactor) ByCredID(ctx context.Context, credID string) (domain.Passkey, error) {
	return i.repo.ByCredID(ctx, credID)
}

func (i *Interactor) TouchCredential(ctx context.Context, id int64, credential []byte) error {
	return i.repo.UpdateCredential(ctx, id, credential)
}
