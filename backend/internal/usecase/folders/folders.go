// Package folders — папки чатов пользователя (tweb Chat Folders): CRUD
// определений; сопоставление диалогов папке выполняет клиент.
package folders

import (
	"context"
	"errors"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

var (
	ErrBadTitle   = errors.New("folder title required (max 12 chars)")
	ErrNoIncludes = errors.New("folder needs at least one included chat or chat type")
	ErrTooMany    = errors.New("folders limit reached")
)

type Repo interface {
	List(ctx context.Context, ownerID int64) ([]domain.Folder, error)
	Create(ctx context.Context, ownerID int64, f domain.Folder) (domain.Folder, error)
	Update(ctx context.Context, ownerID int64, f domain.Folder) (domain.Folder, error) // domain.ErrNotFound если не своя/нет
	Delete(ctx context.Context, ownerID, folderID int64) error
	Count(ctx context.Context, ownerID int64) (int, error)
}

type Interactor struct{ repo Repo }

func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

func (i *Interactor) List(ctx context.Context, ownerID int64) ([]domain.Folder, error) {
	return i.repo.List(ctx, ownerID)
}

func (i *Interactor) Create(ctx context.Context, ownerID int64, f domain.Folder) (domain.Folder, error) {
	if err := validate(&f); err != nil {
		return domain.Folder{}, err
	}
	n, err := i.repo.Count(ctx, ownerID)
	if err != nil {
		return domain.Folder{}, err
	}
	if n >= domain.MaxFoldersPerUser {
		return domain.Folder{}, ErrTooMany
	}
	return i.repo.Create(ctx, ownerID, f)
}

func (i *Interactor) Update(ctx context.Context, ownerID int64, f domain.Folder) (domain.Folder, error) {
	if err := validate(&f); err != nil {
		return domain.Folder{}, err
	}
	return i.repo.Update(ctx, ownerID, f)
}

func (i *Interactor) Delete(ctx context.Context, ownerID, folderID int64) error {
	return i.repo.Delete(ctx, ownerID, folderID)
}

func validate(f *domain.Folder) error {
	f.Title = strings.TrimSpace(f.Title)
	if !domain.ValidFolderTitle(f.Title) {
		return ErrBadTitle
	}
	if !f.HasIncludes() {
		return ErrNoIncludes
	}
	return nil
}
