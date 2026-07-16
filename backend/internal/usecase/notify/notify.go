// Package notify — глобальные настройки уведомлений пользователя
// (private/groups/channels: включены ли уведомления, показывать ли превью).
package notify

import (
	"context"
	"errors"

	"github.com/messenger-denis/backend/internal/domain"
)

// Repo хранит настройки; Get возвращает domain.ErrNotFound, если пользователь
// ещё ничего не менял (тогда действуют дефолты).
type Repo interface {
	Get(ctx context.Context, userID int64) (domain.NotifySettings, error)
	Upsert(ctx context.Context, userID int64, s domain.NotifySettings) error
}

type Interactor struct{ repo Repo }

func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

// TypePatch — частичное обновление настроек одного типа чатов.
type TypePatch struct {
	Muted   *bool
	Preview *bool
}

// Patch — частичное обновление: nil-поля не меняются.
type Patch struct {
	Private  TypePatch
	Groups   TypePatch
	Channels TypePatch
}

// Get возвращает настройки пользователя (дефолты, если не сохранялись).
func (i *Interactor) Get(ctx context.Context, userID int64) (domain.NotifySettings, error) {
	s, err := i.repo.Get(ctx, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.DefaultNotifySettings(), nil
	}
	return s, err
}

// Update применяет частичный патч поверх текущих настроек и сохраняет.
func (i *Interactor) Update(ctx context.Context, userID int64, p Patch) (domain.NotifySettings, error) {
	s, err := i.Get(ctx, userID)
	if err != nil {
		return domain.NotifySettings{}, err
	}
	applyType(&s.Private, p.Private)
	applyType(&s.Groups, p.Groups)
	applyType(&s.Channels, p.Channels)
	if err := i.repo.Upsert(ctx, userID, s); err != nil {
		return domain.NotifySettings{}, err
	}
	return s, nil
}

func applyType(dst *domain.NotifyTypeSettings, p TypePatch) {
	if p.Muted != nil {
		dst.Muted = *p.Muted
	}
	if p.Preview != nil {
		dst.Preview = *p.Preview
	}
}
