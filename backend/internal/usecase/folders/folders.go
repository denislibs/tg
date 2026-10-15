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
	// ErrInviteSlugExpired — ссылки нет (отозвана или не существовала): tweb
	// `INVITE_SLUG_EXPIRED` (internalLinkProcessor.ts:1437).
	ErrInviteSlugExpired = errors.New("folder invite slug expired")
)

type Repo interface {
	List(ctx context.Context, ownerID int64) ([]domain.DialogFilter, error)
	Create(ctx context.Context, ownerID int64, f domain.DialogFilter) (domain.DialogFilter, error)
	Update(ctx context.Context, ownerID int64, f domain.DialogFilter) (domain.DialogFilter, error) // domain.ErrNotFound если не своя/нет
	Delete(ctx context.Context, ownerID, folderID int64) error
	Count(ctx context.Context, ownerID int64) (int, error)

	// Порядок папок (Ф7-З). Reorder: order — id папок БЕЗ 0; чужой/несуществующий
	// id и повтор — domain.ErrInvalid. SetAllChatsPos/AllChatsPos — место «Все
	// чаты» среди папок (число папок перед ней, 0 — первой).
	// Reorder возвращает true, если порядок изменился.
	Reorder(ctx context.Context, ownerID int64, order []int64) (bool, error)
	// LockOrder блокирует строку владельца до конца транзакции (сериализует перестановки).
	LockOrder(ctx context.Context, ownerID int64) error
	// SetAllChatsPos возвращает true, если место изменилось.
	SetAllChatsPos(ctx context.Context, ownerID int64, pos int) (bool, error)
	AllChatsPos(ctx context.Context, ownerID int64) (int, error)

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
	// CanInvite — у userID право приглашать в чат (создатель или админ с
	// invite_users; tweb hasRights(peer, 'invite_links'), sharedFolder.tsx:57).
	// Не участник — false.
	CanInvite(ctx context.Context, chatID, userID int64) (bool, error)
	// Join — вступление в чат общей точкой usecase чатов (роль по типу чата,
	// бан). Идемпотентно.
	Join(ctx context.Context, chatID, userID int64) error
	// Joined — после коммита вступления: живые последствия (вступившему в
	// канал — диалог и подписка сокетов на его топик). До коммита их слать
	// нельзя — вступление ещё не видно.
	Joined(ctx context.Context, chatID, userID int64)
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
// mutations are logged here so a client's getDifference catch-up replays them and the pts
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
func (i *Interactor) folderJSON(ctx context.Context, ownerID int64, f domain.DialogFilter) map[string]any {
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
	pts, err := i.updates.AppendUpdate(ctx, ownerID, 1, time.Now().Unix(), "folder_update", payload)
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

func (i *Interactor) List(ctx context.Context, ownerID int64) ([]domain.DialogFilter, error) {
	return i.repo.List(ctx, ownerID)
}

// AllChatsPos — место «Все чаты» среди папок владельца (0 — первой).
func (i *Interactor) AllChatsPos(ctx context.Context, ownerID int64) (int, error) {
	return i.repo.AllChatsPos(ctx, ownerID)
}

func (i *Interactor) Create(ctx context.Context, ownerID int64, f domain.DialogFilter) (domain.DialogFilter, error) {
	if err := validate(&f); err != nil {
		return domain.DialogFilter{}, err
	}
	n, err := i.repo.Count(ctx, ownerID)
	if err != nil {
		return domain.DialogFilter{}, err
	}
	if n >= domain.MaxFoldersPerUser {
		return domain.DialogFilter{}, ErrTooMany
	}
	created, err := i.repo.Create(ctx, ownerID, f)
	if err != nil {
		return domain.DialogFilter{}, err
	}
	i.emitFolderUpdate(ctx, ownerID, map[string]any{"folder": i.folderJSON(ctx, ownerID, created)})
	return created, nil
}

func (i *Interactor) Update(ctx context.Context, ownerID int64, f domain.DialogFilter) (domain.DialogFilter, error) {
	if err := validate(&f); err != nil {
		return domain.DialogFilter{}, err
	}
	updated, err := i.repo.Update(ctx, ownerID, f)
	if err != nil {
		return domain.DialogFilter{}, err
	}
	i.emitFolderUpdate(ctx, ownerID, map[string]any{"folder": i.folderJSON(ctx, ownerID, updated)})
	return updated, nil
}

// Reorder — messages.updateDialogFiltersOrder: order — id папок в новом порядке;
// 0 — «Все чаты» (присутствует, только если клиент его переставлял — у
// не-премиум tweb вырезает 0, chatFolders.tsx:365-367). Место «Все чаты» —
// индекс 0 в order; без 0 оно не меняется. Неперечисленные папки идут в хвост в
// прежнем порядке. Чужой/несуществующий id, повтор, второй 0 — domain.ErrInvalid.
//
// Перестановка и строка журнала — одна транзакция: журнал без перестановки (и
// наоборот) разводит устройства навсегда. Кадр — после коммита. Журналируется
// order как пришёл: клиент применяет его теми же правилами, что и сервер.
func (i *Interactor) Reorder(ctx context.Context, ownerID int64, order []int64) error {
	// Длину не ограничиваем: папок у пользователя бывает больше лимита создания
	// (вступление по ссылке лимит не проверяет), а чужие id и повторы отсекает
	// репозиторий. Пустой order — нечего переставлять.
	if len(order) == 0 {
		return nil
	}
	folderIDs := make([]int64, 0, len(order))
	allIdx := -1
	for idx, id := range order {
		if id != 0 {
			folderIDs = append(folderIDs, id)
			continue
		}
		if allIdx >= 0 {
			return domain.ErrInvalid
		}
		allIdx = idx
	}
	var pts int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		if err := i.repo.LockOrder(ctx, ownerID); err != nil {
			return err
		}
		changed := false
		if allIdx >= 0 {
			moved, err := i.repo.SetAllChatsPos(ctx, ownerID, allIdx)
			if err != nil {
				return err
			}
			changed = moved
		}
		reordered, err := i.repo.Reorder(ctx, ownerID, folderIDs)
		if err != nil {
			return err
		}
		// Перестановка в тот же порядок (повтор запроса, перетаскивание на то же
		// место) ничего не меняет: журнал и кадры не раздуваем.
		if !changed && !reordered {
			return nil
		}
		if i.updates == nil {
			return nil
		}
		payload, err := json.Marshal(domain.NewUpdateDialogFilterOrder(order))
		if err != nil {
			return err
		}
		pts, err = i.updates.AppendUpdate(ctx, ownerID, 1, time.Now().Unix(), domain.UpdateDialogFilterOrderTag, payload)
		return err
	})
	if err != nil {
		return err
	}
	if pts == 0 || i.pub == nil {
		return nil
	}
	// Конструктор без параметра pts: курсор в конверте, рядом с телом (тот же
	// вид, что у общего пути конструкторов — usecase/chat/frame.go).
	frame, err := json.Marshal(map[string]any{
		"t": domain.UpdateDialogFilterOrderTag, "pts": pts,
		"d": domain.NewUpdateDialogFilterOrder(order),
	})
	if err == nil {
		// Мутация закоммичена: сбой публикации не ломает ответ, устройство
		// догонит строку журнала через getDifference.
		_ = i.pub.PublishToUser(ctx, ownerID, frame)
	}
	return nil
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
// расшаренных чатов. Чат, ставший приватным, не показывается (см. admissible).
func (i *Interactor) PreviewInvite(ctx context.Context, slug string) (title string, chats []domain.FolderInviteChat, err error) {
	inv, err := i.inviteBySlug(ctx, slug)
	if err != nil {
		return "", nil, err
	}
	chats = make([]domain.FolderInviteChat, 0, len(inv.ChatIDs))
	for _, id := range inv.ChatIDs {
		ok, e := i.admissible(ctx, id, inv.OwnerID)
		if e != nil {
			return "", nil, e
		}
		if !ok {
			continue // удалён, перестал быть группой/каналом или стал приватным
		}
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
// ссылки (нельзя вступить в произвольный чат по чужому slug). Чат, ставший
// приватным, пропускается до вступления (см. admissible).
func (i *Interactor) JoinInvite(ctx context.Context, userID int64, slug string, chatIDs []int64) error {
	inv, err := i.inviteBySlug(ctx, slug)
	if err != nil {
		return err
	}
	// Вступление создаёт папку: при полном списке отказ приходит до вступления
	// в чаты (tweb DIALOG_FILTERS_TOO_MUCH, sharedFolderInvite.tsx:212).
	n, err := i.repo.Count(ctx, userID)
	if err != nil {
		return err
	}
	if n >= domain.MaxFoldersPerUser {
		return ErrTooMany
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
	// Только чаты ссылки и по разу: повторы в теле запроса иначе множили бы
	// запросы admissible/IsMember внутри одной транзакции и дубли в папке.
	seen := make(map[int64]bool, len(inv.ChatIDs))
	picked := make([]int64, 0, len(inv.ChatIDs))
	for _, id := range want {
		if allowed[id] && !seen[id] {
			seen[id] = true
			picked = append(picked, id)
		}
	}
	want = picked
	joined := make([]int64, 0, len(want))
	var fresh []int64 // вступил именно сейчас (а не был участником)
	var created domain.DialogFilter
	var haveFolder bool
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		for _, id := range want {
			ok, e := i.admissible(ctx, id, inv.OwnerID)
			if e != nil {
				return e
			}
			if !ok {
				continue
			}
			member, e := i.chats.IsMember(ctx, id, userID)
			if e != nil {
				return e
			}
			if !member {
				// Чат, куда пользователю нельзя (бан), пропускается, а не
				// валит вход во всю папку: остальные чаты ссылки вступаются,
				// а этот в его копию папки не попадает. Отказ приходит до
				// записи (точка вступления проверяет бан первой), транзакцию
				// он не портит.
				e := i.chats.Join(ctx, id, userID)
				if errors.Is(e, domain.ErrForbidden) {
					continue
				}
				if e != nil {
					return e
				}
				fresh = append(fresh, id)
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
		f, e := i.repo.Create(ctx, userID, domain.DialogFilter{Title: title, IncludeChats: joined})
		if e != nil {
			return e
		}
		created, haveFolder = f, true
		return nil
	})
	if err != nil {
		return err
	}
	for _, id := range fresh {
		i.chats.Joined(ctx, id, userID)
	}
	// Новая папка появилась на устройствах вступившего — шлём folder_update.
	if haveFolder {
		i.emitFolderUpdate(ctx, userID, map[string]any{"folder": i.folderJSON(ctx, userID, created)})
	}
	return nil
}

// inviteBySlug — приглашение по slug; нет такого — ErrInviteSlugExpired.
func (i *Interactor) inviteBySlug(ctx context.Context, slug string) (domain.FolderInvite, error) {
	inv, err := i.repo.GetFolderInviteBySlug(ctx, slug)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.FolderInvite{}, ErrInviteSlugExpired
	}
	return inv, err
}

// ownedFolder возвращает папку folderID пользователя ownerID; domain.ErrNotFound
// если папки нет или она чужая.
func (i *Interactor) ownedFolder(ctx context.Context, ownerID, folderID int64) (domain.DialogFilter, error) {
	list, err := i.repo.List(ctx, ownerID)
	if err != nil {
		return domain.DialogFilter{}, err
	}
	for _, f := range list {
		if f.ID == folderID {
			return f, nil
		}
	}
	return domain.DialogFilter{}, domain.ErrNotFound
}

// chatKindShareable — группа или канал: единственные виды чатов, на которые
// бывает ссылка на папку (tweb sharedFolder.tsx:49-55 — личные чаты отсекаются).
func chatKindShareable(typ string) bool {
	return typ == domain.ChatTypeGroup || typ == domain.ChatTypeChannel
}

// admissible — чат ссылки всё ещё можно показывать и впускать в него: группа/
// канал, который сейчас публичный или где автор ссылки — создатель/админ с
// invite_users (при создании ссылки берутся только публичные, см. shareableChats). По tweb (sharedFolder.tsx:48-58) в ссылку попадает чат с
// публичным именем или с правом invite_links; сервер обязан держать то же
// условие и при предпросмотре, и при вступлении, иначе ссылка продолжает
// впускать в чат, ставший приватным. Удалённый чат — не admissible.
func (i *Interactor) admissible(ctx context.Context, chatID, ownerID int64) (bool, error) {
	typ, isPublic, err := i.chats.Info(ctx, chatID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !chatKindShareable(typ) {
		return false, nil
	}
	if isPublic {
		return true, nil
	}
	return i.chats.CanInvite(ctx, chatID, ownerID)
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
		if isPublic && chatKindShareable(typ) {
			out = append(out, id)
		}
	}
	return out, nil
}

func validate(f *domain.DialogFilter) error {
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
