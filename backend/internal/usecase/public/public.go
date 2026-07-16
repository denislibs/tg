// Package public — публичная страница-превью по username (аналог t.me):
// резолв пользователя/группы/канала без авторизации.
package public

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// Repo возвращает domain.ErrNotFound, если username не занят.
type Repo interface {
	Resolve(ctx context.Context, username string) (domain.PublicProfile, error)
}

type Interactor struct{ repo Repo }

func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

func (i *Interactor) Resolve(ctx context.Context, username string) (domain.PublicProfile, error) {
	return i.repo.Resolve(ctx, username)
}
