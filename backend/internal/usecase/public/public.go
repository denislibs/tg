// Package public — публичные страницы-превью (аналог t.me) без авторизации:
// пользователь/бот/группа/канал по username, ссылка-приглашение, набор
// стикеров и пост публичного канала.
package public

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Repo — чтение для анонимных страниц. Каждый метод возвращает
// domain.ErrNotFound, если адресата нет.
type Repo interface {
	Resolve(ctx context.Context, username string) (domain.PublicProfile, error)
	// Invite — ссылка вместе с карточкой её чата.
	Invite(ctx context.Context, token string) (domain.InviteLink, domain.PublicInvite, error)
	StickerSet(ctx context.Context, shortName string) (domain.PublicStickerSet, error)
	// Post — неудалённое сообщение seq публичного канала username.
	Post(ctx context.Context, username string, seq int64) (domain.PublicPost, error)
}

type Interactor struct {
	repo Repo
	now  func() time.Time
}

func New(repo Repo) *Interactor { return &Interactor{repo: repo, now: time.Now} }

func (i *Interactor) Resolve(ctx context.Context, username string) (domain.PublicProfile, error) {
	return i.repo.Resolve(ctx, username)
}

// Invite — чат за ссылкой. Отозванная, просроченная или исчерпанная ссылка
// для анонима неотличима от несуществующей (как у t.me: одна и та же
// «пустая» страница приглашения).
func (i *Interactor) Invite(ctx context.Context, token string) (domain.PublicInvite, error) {
	link, inv, err := i.repo.Invite(ctx, token)
	if err != nil {
		return domain.PublicInvite{}, err
	}
	if link.Revoked ||
		(link.ExpiresAt != nil && !link.ExpiresAt.After(i.now())) ||
		(link.UsageLimit != nil && link.Uses >= *link.UsageLimit) {
		return domain.PublicInvite{}, domain.ErrNotFound
	}
	return inv, nil
}

func (i *Interactor) StickerSet(ctx context.Context, shortName string) (domain.PublicStickerSet, error) {
	return i.repo.StickerSet(ctx, shortName)
}

func (i *Interactor) Post(ctx context.Context, username string, seq int64) (domain.PublicPost, error) {
	if seq <= 0 {
		return domain.PublicPost{}, domain.ErrNotFound
	}
	return i.repo.Post(ctx, username, seq)
}
