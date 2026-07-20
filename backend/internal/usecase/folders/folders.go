// Package folders — папки чатов пользователя (tweb Chat Folders): CRUD
// определений; сопоставление диалогов папке выполняет клиент. Плюс
// ссылки-приглашения в папку (Telegram chatlist invites).
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
	// ErrNoShareable — в папке нет чатов, которыми можно поделиться по ссылке
	// (публичных групп/каналов среди include_chats).
	ErrNoShareable = errors.New("folder has no shareable public group/channel chats")
)

type Repo interface {
	List(ctx context.Context, ownerID int64) ([]domain.Folder, error)
	Create(ctx context.Context, ownerID int64, f domain.Folder) (domain.Folder, error)
	Update(ctx context.Context, ownerID int64, f domain.Folder) (domain.Folder, error) // domain.ErrNotFound если не своя/нет
	Delete(ctx context.Context, ownerID, folderID int64) error
	Count(ctx context.Context, ownerID int64) (int, error)

	// Ссылки-приглашения в папку.
	CreateFolderInvite(ctx context.Context, inv domain.FolderInvite) (slug string, err error)
	ListFolderInvites(ctx context.Context, folderID, ownerID int64) ([]domain.FolderInvite, error)
	GetFolderInviteBySlug(ctx context.Context, slug string) (domain.FolderInvite, error) // domain.ErrNotFound
	DeleteFolderInvite(ctx context.Context, slug string, ownerID int64) error            // domain.ErrNotFound
}

// Chats — доступ к чатам для шаринга/вступления по ссылке. Реализуется
// адаптером поверх существующих репозиториев групп/чатов (переиспользование
// логики членства из usecase/chat: те же таблицы chat_members/chats).
type Chats interface {
	// Info — тип чата ('private'|'group'|'channel'|...) и публичность (joinable по ссылке).
	Info(ctx context.Context, chatID int64) (typ string, isPublic bool, err error)
	// Preview — карточка расшаренного чата для экрана вступления.
	Preview(ctx context.Context, chatID int64) (domain.FolderInviteChat, error)
	IsMember(ctx context.Context, chatID, userID int64) (bool, error)
	// Join добавляет userID участником чата (роль зависит от типа: группа —
	// member, канал — subscriber). Идемпотентно.
	Join(ctx context.Context, chatID, userID int64) error
}

// TxManager запускает fn в транзакции (JoinInvite вступает в чаты и создаёт
// папку атомарно). tx пробрасывается через ctx в адаптеры.
type TxManager interface {
	WithinTx(ctx context.Context, fn func(ctx context.Context) error) error
}

type Interactor struct {
	repo  Repo
	chats Chats
	tx    TxManager
}

func New(repo Repo, chats Chats, tx TxManager) *Interactor {
	return &Interactor{repo: repo, chats: chats, tx: tx}
}

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

// CreateInvite создаёт ссылку-приглашение в папку. Расшариваются только те
// include_chats папки, что являются публичными группами/каналами (joinable по
// ссылке); приватные 1-1 чаты пропускаются.
func (i *Interactor) CreateInvite(ctx context.Context, ownerID, folderID int64, title string) (domain.FolderInvite, error) {
	f, err := i.ownedFolder(ctx, ownerID, folderID)
	if err != nil {
		return domain.FolderInvite{}, err
	}
	shareable, err := i.shareableChats(ctx, f.IncludeChats)
	if err != nil {
		return domain.FolderInvite{}, err
	}
	if len(shareable) == 0 {
		return domain.FolderInvite{}, ErrNoShareable
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = f.Title
	}
	inv := domain.FolderInvite{FolderID: folderID, OwnerID: ownerID, Title: title, ChatIDs: shareable}
	slug, err := i.repo.CreateFolderInvite(ctx, inv)
	if err != nil {
		return domain.FolderInvite{}, err
	}
	inv.Slug = slug
	return inv, nil
}

func (i *Interactor) ListInvites(ctx context.Context, ownerID, folderID int64) ([]domain.FolderInvite, error) {
	if _, err := i.ownedFolder(ctx, ownerID, folderID); err != nil {
		return nil, err
	}
	return i.repo.ListFolderInvites(ctx, folderID, ownerID)
}

func (i *Interactor) RevokeInvite(ctx context.Context, ownerID int64, slug string) error {
	return i.repo.DeleteFolderInvite(ctx, slug, ownerID)
}

// PreviewInvite — экран вступления по ссылке: заголовок папки + карточки
// расшаренных чатов.
func (i *Interactor) PreviewInvite(ctx context.Context, slug string) (title string, chats []domain.FolderInviteChat, err error) {
	inv, err := i.repo.GetFolderInviteBySlug(ctx, slug)
	if err != nil {
		return "", nil, err
	}
	chats = make([]domain.FolderInviteChat, 0, len(inv.ChatIDs))
	for _, id := range inv.ChatIDs {
		c, e := i.chats.Preview(ctx, id)
		if errors.Is(e, domain.ErrNotFound) {
			continue // чат удалён — пропускаем
		}
		if e != nil {
			return "", nil, e
		}
		chats = append(chats, c)
	}
	return inv.Title, chats, nil
}

// JoinInvite вступает в выбранные расшаренные чаты (переиспользует членскую
// логику chat) и создаёт для userID копию папки с include_chats = вступленные
// чаты. Уже вступленные чаты пропускаются. chatIDs ограничивается набором
// ссылки (нельзя вступить в произвольный чат по чужому slug).
func (i *Interactor) JoinInvite(ctx context.Context, userID int64, slug string, chatIDs []int64) error {
	inv, err := i.repo.GetFolderInviteBySlug(ctx, slug)
	if err != nil {
		return err
	}
	allowed := make(map[int64]bool, len(inv.ChatIDs))
	for _, id := range inv.ChatIDs {
		allowed[id] = true
	}
	// если клиент не прислал выбор — берём все чаты ссылки
	want := chatIDs
	if len(want) == 0 {
		want = inv.ChatIDs
	}
	joined := make([]int64, 0, len(want))
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		for _, id := range want {
			if !allowed[id] {
				continue
			}
			member, e := i.chats.IsMember(ctx, id, userID)
			if e != nil {
				return e
			}
			if !member {
				if e := i.chats.Join(ctx, id, userID); e != nil {
					return e
				}
			}
			joined = append(joined, id)
		}
		if len(joined) == 0 {
			return nil
		}
		title := inv.Title
		if !domain.ValidFolderTitle(title) {
			title = truncateTitle(title)
		}
		_, e := i.repo.Create(ctx, userID, domain.Folder{Title: title, IncludeChats: joined})
		return e
	})
	return err
}

// ownedFolder возвращает папку folderID пользователя ownerID; domain.ErrNotFound
// если папки нет или она чужая.
func (i *Interactor) ownedFolder(ctx context.Context, ownerID, folderID int64) (domain.Folder, error) {
	list, err := i.repo.List(ctx, ownerID)
	if err != nil {
		return domain.Folder{}, err
	}
	for _, f := range list {
		if f.ID == folderID {
			return f, nil
		}
	}
	return domain.Folder{}, domain.ErrNotFound
}

// shareableChats оставляет из ids только публичные группы/каналы.
func (i *Interactor) shareableChats(ctx context.Context, ids []int64) ([]int64, error) {
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		typ, isPublic, err := i.chats.Info(ctx, id)
		if errors.Is(err, domain.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if isPublic && (typ == "group" || typ == "channel") {
			out = append(out, id)
		}
	}
	return out, nil
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

// truncateTitle обрезает заголовок до лимита имени папки (на всякий случай, если
// исходная папка была шире — при копировании).
func truncateTitle(title string) string {
	r := []rune(strings.TrimSpace(title))
	if len(r) == 0 {
		return "Folder"
	}
	if len(r) > domain.MaxFolderNameLength {
		r = r[:domain.MaxFolderNameLength]
	}
	return string(r)
}
