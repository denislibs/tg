// Package folders — папки чатов пользователя (tweb Chat Folders): CRUD
// определений; сопоставление диалогов папке выполняет клиент. Плюс
// ссылки-приглашения в папку (Telegram chatlist invites).
package folders

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

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

// EventPublisher pushes a realtime WS frame to a user's connected sessions.
// Optional (wired to the Redis publisher when available); mirrors the chat/auth
// usecases. Used to fan out folder_update to the owner's own devices.
type EventPublisher interface {
	PublishToUser(ctx context.Context, userID int64, frame []byte) error
}

// UpdateLog appends one row to a user's per-user update log and returns the new
// dense pts (same contract as the chat usecase's UpdateRepo.AppendUpdate). Folder
// mutations are logged here so a client's /sync catch-up replays them and the pts
// cursor stays dense. Optional — no-op when unwired (tests / no-DB setups).
type UpdateLog interface {
	AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error)
}

// Peers — слой разрешения peerId ↔ внутренний chatID (реализуется
// usecase/chat, см. peeraddr.go). Списки include/exclude папки едут наружу
// ключами пиров: id строки в chats приватного диалога наружу не выходит.
// Optional — без него списки уезжают пустыми, а не с внутренними id.
type Peers interface {
	PeerToChatID(ctx context.Context, viewerID int64, peer domain.PeerID) (int64, error)
	ChatIDToPeer(ctx context.Context, viewerID, chatID int64) (domain.PeerID, error)
}

type Interactor struct {
	repo    Repo
	chats   Chats
	tx      TxManager
	pub     EventPublisher // optional
	updates UpdateLog      // optional
	peers   Peers          // optional
}

func New(repo Repo, chats Chats, tx TxManager) *Interactor {
	return &Interactor{repo: repo, chats: chats, tx: tx}
}

// SetPublisher attaches a realtime publisher (optional).
func (i *Interactor) SetPublisher(p EventPublisher) { i.pub = p }

// SetUpdateLog attaches the per-user update log (optional).
func (i *Interactor) SetUpdateLog(u UpdateLog) { i.updates = u }

// SetPeers подключает слой разрешения peerId ↔ chatID (optional).
func (i *Interactor) SetPeers(p Peers) { i.peers = p }

// PeersToChatIDs — входящий список ключей пиров во внутренние chatID глазами
// владельца папки. Нерешаемые ключи (диалога ещё нет) отбрасываются: правило
// папки на несуществующий чат бессмысленно.
func (i *Interactor) PeersToChatIDs(ctx context.Context, ownerID int64, peers []domain.PeerID) []int64 {
	if i.peers == nil || len(peers) == 0 {
		return nil
	}
	out := make([]int64, 0, len(peers))
	for _, p := range peers {
		if id, err := i.peers.PeerToChatID(ctx, ownerID, p); err == nil {
			out = append(out, id)
		}
	}
	return out
}

// ChatIDsToPeers — обратное направление для витрин и кадров.
func (i *Interactor) ChatIDsToPeers(ctx context.Context, ownerID int64, ids []int64) []domain.PeerID {
	out := make([]domain.PeerID, 0, len(ids))
	if i.peers == nil {
		return out
	}
	for _, id := range ids {
		if p, err := i.peers.ChatIDToPeer(ctx, ownerID, id); err == nil {
			out = append(out, p)
		}
	}
	return out
}

// folderJSON — абсолютный снимок папки для folder_update (клиент заменяет
// определение целиком, порядок доставки апдейтов не важен — идемпотентно).
func (i *Interactor) folderJSON(ctx context.Context, ownerID int64, f domain.Folder) map[string]any {
	return map[string]any{
		"id": f.ID, "title": f.Title, "pos": f.Pos,
		"contacts": f.Contacts, "non_contacts": f.NonContacts,
		"groups": f.Groups, "broadcasts": f.Broadcasts, "bots": f.Bots,
		"exclude_muted": f.ExcludeMuted, "exclude_read": f.ExcludeRead,
		"include_peers": i.ChatIDsToPeers(ctx, ownerID, f.IncludeChats),
		"exclude_peers": i.ChatIDsToPeers(ctx, ownerID, f.ExcludeChats),
	}
}

// emitFolderUpdate логирует folder_update в апдейт-лог владельца (плотный pts) и
// шлёт живой кадр на его устройства. base — общий payload (снимок папки либо
// {folder_id, deleted:true}); pts инжектится в КОПИЮ d, base не мутируется.
// Best-effort и no-op без апдейт-лога/публишера (тесты / без БД).
func (i *Interactor) emitFolderUpdate(ctx context.Context, ownerID int64, base map[string]any) {
	if i.updates == nil {
		return
	}
	payload, err := json.Marshal(base)
	if err != nil {
		return
	}
	pts, err := i.updates.AppendUpdate(ctx, ownerID, 1, time.Now().UnixMilli(), "folder_update", payload)
	if err != nil {
		return
	}
	if i.pub == nil {
		return
	}
	d := make(map[string]any, len(base)+1)
	for k, v := range base {
		d[k] = v
	}
	d["pts"] = pts
	frame, err := json.Marshal(map[string]any{"t": "folder_update", "d": d})
	if err != nil {
		return
	}
	_ = i.pub.PublishToUser(ctx, ownerID, frame)
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
	created, err := i.repo.Create(ctx, ownerID, f)
	if err != nil {
		return domain.Folder{}, err
	}
	i.emitFolderUpdate(ctx, ownerID, map[string]any{"folder": i.folderJSON(ctx, ownerID, created)})
	return created, nil
}

func (i *Interactor) Update(ctx context.Context, ownerID int64, f domain.Folder) (domain.Folder, error) {
	if err := validate(&f); err != nil {
		return domain.Folder{}, err
	}
	updated, err := i.repo.Update(ctx, ownerID, f)
	if err != nil {
		return domain.Folder{}, err
	}
	i.emitFolderUpdate(ctx, ownerID, map[string]any{"folder": i.folderJSON(ctx, ownerID, updated)})
	return updated, nil
}

func (i *Interactor) Delete(ctx context.Context, ownerID, folderID int64) error {
	if err := i.repo.Delete(ctx, ownerID, folderID); err != nil {
		return err
	}
	i.emitFolderUpdate(ctx, ownerID, map[string]any{"folder_id": folderID, "deleted": true})
	return nil
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
	var created domain.Folder
	var haveFolder bool
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
		f, e := i.repo.Create(ctx, userID, domain.Folder{Title: title, IncludeChats: joined})
		if e != nil {
			return e
		}
		created, haveFolder = f, true
		return nil
	})
	if err != nil {
		return err
	}
	// Новая папка появилась на устройствах вступившего — шлём folder_update.
	if haveFolder {
		i.emitFolderUpdate(ctx, userID, map[string]any{"folder": i.folderJSON(ctx, userID, created)})
	}
	return nil
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
