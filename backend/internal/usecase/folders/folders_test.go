package folders

import (
	"context"
	"errors"
	"sort"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// --- фейки ---

type fakeRepo struct {
	folders map[int64]domain.DialogFilter // by id
	owner   map[int64]int64               // folder id → owner id
	nextID  int64
	invites map[string]domain.FolderInvite // by slug
	created []domain.DialogFilter          // папки, созданные JoinInvite
	allPos  map[int64]int                  // owner id → место «Все чаты»
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{folders: map[int64]domain.DialogFilter{}, owner: map[int64]int64{}, invites: map[string]domain.FolderInvite{}, allPos: map[int64]int{}, nextID: 1}
}

func (r *fakeRepo) List(_ context.Context, ownerID int64) ([]domain.DialogFilter, error) {
	out := []domain.DialogFilter{}
	for id, f := range r.folders {
		if r.owner[id] == ownerID {
			out = append(out, f)
		}
	}
	return out, nil
}
func (r *fakeRepo) Create(_ context.Context, ownerID int64, f domain.DialogFilter) (domain.DialogFilter, error) {
	f.ID = r.nextID
	r.nextID++
	r.folders[f.ID] = f
	r.owner[f.ID] = ownerID
	r.created = append(r.created, f)
	return f, nil
}
func (r *fakeRepo) Update(_ context.Context, _ int64, f domain.DialogFilter) (domain.DialogFilter, error) {
	return f, nil
}
func (r *fakeRepo) Delete(_ context.Context, _, _ int64) error { return nil }
func (r *fakeRepo) Reorder(_ context.Context, ownerID int64, order []int64) (bool, error) {
	owned := []domain.DialogFilter{}
	for id, f := range r.folders {
		if r.owner[id] == ownerID {
			owned = append(owned, f)
		}
	}
	sort.Slice(owned, func(a, b int) bool {
		return owned[a].Pos < owned[b].Pos || owned[a].Pos == owned[b].Pos && owned[a].ID < owned[b].ID
	})
	seen := map[int64]bool{}
	seq := []int64{}
	for _, id := range order {
		if r.owner[id] != ownerID || r.folders[id].ID == 0 || seen[id] {
			return false, domain.ErrInvalid
		}
		seen[id] = true
		seq = append(seq, id)
	}
	for _, f := range owned {
		if !seen[f.ID] {
			seq = append(seq, f.ID)
		}
	}
	changed := false
	for pos, id := range seq {
		f := r.folders[id]
		if f.Pos != pos {
			changed = true
		}
		f.Pos = pos
		r.folders[id] = f
	}
	return changed, nil
}
func (r *fakeRepo) LockOrder(context.Context, int64) error { return nil }
func (r *fakeRepo) SetAllChatsPos(_ context.Context, ownerID int64, pos int) (bool, error) {
	changed := r.allPos[ownerID] != pos
	r.allPos[ownerID] = pos
	return changed, nil
}
func (r *fakeRepo) AllChatsPos(_ context.Context, ownerID int64) (int, error) {
	return r.allPos[ownerID], nil
}
func (r *fakeRepo) Count(_ context.Context, ownerID int64) (int, error) {
	n := 0
	for id := range r.folders {
		if r.owner[id] == ownerID {
			n++
		}
	}
	return n, nil
}
func (r *fakeRepo) CreateFolderInvite(_ context.Context, inv domain.FolderInvite) (string, error) {
	inv.Slug = "slug1"
	r.invites[inv.Slug] = inv
	return inv.Slug, nil
}
func (r *fakeRepo) ListFolderInvites(_ context.Context, folderID, ownerID int64) ([]domain.FolderInvite, error) {
	out := []domain.FolderInvite{}
	for _, inv := range r.invites {
		if inv.FolderID == folderID && inv.OwnerID == ownerID {
			out = append(out, inv)
		}
	}
	return out, nil
}
func (r *fakeRepo) GetFolderInviteBySlug(_ context.Context, slug string) (domain.FolderInvite, error) {
	inv, ok := r.invites[slug]
	if !ok {
		return domain.FolderInvite{}, domain.ErrNotFound
	}
	return inv, nil
}
func (r *fakeRepo) DeleteFolderInvite(_ context.Context, slug string, ownerID int64) error {
	if inv, ok := r.invites[slug]; !ok || inv.OwnerID != ownerID {
		return domain.ErrNotFound
	}
	delete(r.invites, slug)
	return nil
}

type fakeChat struct {
	typ      string
	isPublic bool
	title    string
	members  int
}

type fakeChats struct {
	chats  map[int64]fakeChat
	member map[[2]int64]bool // (chatID,userID) → member
	banned map[[2]int64]bool // (chatID,userID) → бан: Join отвечает ErrForbidden
	// inviters — (chatID,userID), у которых есть право приглашать (создатель
	// или админ с invite_users).
	inviters    map[[2]int64]bool
	infoCalls   int // вызовов Info
	inviteCalls int // вызовов CanInvite
	joined      [][2]int64
	// announced — Joined (после коммита) по вступившим именно сейчас.
	announced [][2]int64
}

func (c *fakeChats) Info(_ context.Context, chatID int64) (string, bool, error) {
	c.infoCalls++
	ch, ok := c.chats[chatID]
	if !ok {
		return "", false, domain.ErrNotFound
	}
	return ch.typ, ch.isPublic, nil
}
func (c *fakeChats) CanInvite(_ context.Context, chatID, userID int64) (bool, error) {
	c.inviteCalls++
	return c.inviters[[2]int64{chatID, userID}], nil
}
func (c *fakeChats) Preview(_ context.Context, chatID int64) (domain.FolderInviteChat, error) {
	ch, ok := c.chats[chatID]
	if !ok {
		return domain.FolderInviteChat{}, domain.ErrNotFound
	}
	return domain.FolderInviteChat{ID: chatID, Title: ch.title, Type: ch.typ, MemberCount: ch.members}, nil
}
func (c *fakeChats) IsMember(_ context.Context, chatID, userID int64) (bool, error) {
	return c.member[[2]int64{chatID, userID}], nil
}
func (c *fakeChats) Join(_ context.Context, chatID, userID int64) error {
	if c.banned[[2]int64{chatID, userID}] {
		return domain.ErrForbidden
	}
	c.member[[2]int64{chatID, userID}] = true
	c.joined = append(c.joined, [2]int64{chatID, userID})
	return nil
}
func (c *fakeChats) Joined(_ context.Context, chatID, userID int64) {
	c.announced = append(c.announced, [2]int64{chatID, userID})
}

// noopTx запускает fn без реальной транзакции.
type noopTx struct{}

func (noopTx) WithinTx(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }

func setup() (*Interactor, *fakeRepo, *fakeChats) {
	repo := newFakeRepo()
	chats := &fakeChats{
		chats: map[int64]fakeChat{
			10: {typ: "group", isPublic: true, title: "Public Group", members: 5},
			11: {typ: "channel", isPublic: true, title: "Public Channel", members: 100},
			12: {typ: "group", isPublic: false, title: "Private Group", members: 3}, // не шарится
			13: {typ: "private", isPublic: false, title: "DM", members: 2},          // не шарится
		},
		member: map[[2]int64]bool{},
	}
	return New(repo, chats, noopTx{}), repo, chats
}

func TestCreateInvite_FiltersShareable(t *testing.T) {
	uc, repo, _ := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.DialogFilter{Title: "Mix", IncludeChats: []int64{10, 11, 12, 13}})

	inv, err := uc.CreateInvite(ctx, 1, f.ID, "")
	if err != nil {
		t.Fatalf("CreateInvite: %v", err)
	}
	// только публичные группа/канал
	if len(inv.ChatIDs) != 2 || inv.ChatIDs[0] != 10 || inv.ChatIDs[1] != 11 {
		t.Fatalf("shareable = %v, want [10 11]", inv.ChatIDs)
	}
	if inv.Title != "Mix" {
		t.Fatalf("title = %q, want copied folder title", inv.Title)
	}
}

func TestCreateInvite_ForeignFolder(t *testing.T) {
	uc, repo, _ := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.DialogFilter{Title: "Mine", IncludeChats: []int64{10}})
	if _, err := uc.CreateInvite(ctx, 2, f.ID, ""); err != domain.ErrNotFound {
		t.Fatalf("foreign CreateInvite = %v, want ErrNotFound", err)
	}
}

func TestCreateInvite_NoShareable(t *testing.T) {
	uc, repo, _ := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.DialogFilter{Title: "Priv", IncludeChats: []int64{12, 13}})
	if _, err := uc.CreateInvite(ctx, 1, f.ID, ""); err != ErrNoShareable {
		t.Fatalf("CreateInvite = %v, want ErrNoShareable", err)
	}
}

func TestJoinInvite_JoinsAndCreatesFolder(t *testing.T) {
	uc, repo, chats := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.DialogFilter{Title: "Team", IncludeChats: []int64{10, 11}})
	inv, _ := uc.CreateInvite(ctx, 1, f.ID, "")

	// пользователь 2 уже в чате 10
	chats.member[[2]int64{10, 2}] = true

	if err := uc.JoinInvite(ctx, 2, inv.Slug, []int64{10, 11}); err != nil {
		t.Fatalf("JoinInvite: %v", err)
	}
	// вступил только в 11 (в 10 уже был)
	if len(chats.joined) != 1 || chats.joined[0] != [2]int64{11, 2} {
		t.Fatalf("joined = %v, want only (11,2)", chats.joined)
	}
	// Ф-2: живые последствия вступления (updateChannel и подписка топика) —
	// после коммита и только по вступившим сейчас.
	if len(chats.announced) != 1 || chats.announced[0] != [2]int64{11, 2} {
		t.Fatalf("announced = %v, want only (11,2)", chats.announced)
	}
	// создана папка с обоими чатами (title из инвайта)
	if len(repo.created) == 0 {
		t.Fatalf("no folder created")
	}
	last := repo.created[len(repo.created)-1]
	if last.Title != "Team" || len(last.IncludeChats) != 2 {
		t.Fatalf("created folder = %+v", last)
	}
}

// Чат папки, где пользователь забанен, пропускается: вступление в остальные и
// папка — без него, а не отказ на всю папку.
func TestJoinInvite_SkipsBannedChat(t *testing.T) {
	uc, repo, chats := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.DialogFilter{Title: "Team", IncludeChats: []int64{10, 11}})
	inv, _ := uc.CreateInvite(ctx, 1, f.ID, "")
	chats.banned = map[[2]int64]bool{{10, 2}: true}

	if err := uc.JoinInvite(ctx, 2, inv.Slug, nil); err != nil {
		t.Fatalf("JoinInvite с забаненным чатом: %v", err)
	}
	if len(chats.joined) != 1 || chats.joined[0] != [2]int64{11, 2} {
		t.Fatalf("joined = %v, ждали только (11,2)", chats.joined)
	}
	last := repo.created[len(repo.created)-1]
	if len(last.IncludeChats) != 1 || last.IncludeChats[0] != 11 {
		t.Fatalf("папка = %+v, ждали только чат 11", last)
	}
}

func TestJoinInvite_IgnoresChatsNotInInvite(t *testing.T) {
	uc, repo, chats := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.DialogFilter{Title: "Team", IncludeChats: []int64{10}})
	inv, _ := uc.CreateInvite(ctx, 1, f.ID, "")

	// пытаемся вступить в 11, которого нет в ссылке
	if err := uc.JoinInvite(ctx, 2, inv.Slug, []int64{11}); err != nil {
		t.Fatalf("JoinInvite: %v", err)
	}
	if len(chats.joined) != 0 {
		t.Fatalf("joined = %v, want none (11 not in invite)", chats.joined)
	}
}

// Б-7. Ссылка, созданная на публичный чат, не впускает в чат, ставший
// приватным (tweb sharedFolder.tsx:48-58: чат берётся, если есть публичное имя
// или у автора ссылки право invite_links).

// linkOnPublicChats — Боб (1) делает ссылку на публичные 10 и 11.
func linkOnPublicChats(t *testing.T) (*Interactor, *fakeRepo, *fakeChats, string) {
	t.Helper()
	uc, repo, chats := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.DialogFilter{Title: "Team", IncludeChats: []int64{10, 11}})
	inv, err := uc.CreateInvite(ctx, 1, f.ID, "")
	if err != nil {
		t.Fatalf("CreateInvite: %v", err)
	}
	return uc, repo, chats, inv.Slug
}

func makePrivate(chats *fakeChats, id int64) {
	ch := chats.chats[id]
	ch.isPublic = false
	chats.chats[id] = ch
}

func TestJoinInvite_SkipsChatThatBecamePrivate(t *testing.T) {
	uc, repo, chats, slug := linkOnPublicChats(t)
	makePrivate(chats, 10) // Боб в нём рядовой участник: права приглашать нет

	if err := uc.JoinInvite(context.Background(), 2, slug, nil); err != nil {
		t.Fatalf("JoinInvite: %v", err)
	}
	if len(chats.joined) != 1 || chats.joined[0] != [2]int64{11, 2} {
		t.Fatalf("joined = %v, ждали только (11,2)", chats.joined)
	}
	last := repo.created[len(repo.created)-1]
	if len(last.IncludeChats) != 1 || last.IncludeChats[0] != 11 {
		t.Fatalf("папка = %+v, ждали только чат 11", last)
	}
}

func TestJoinInvite_PrivateButOwnerAdminWithInvite_Joins(t *testing.T) {
	uc, _, chats, slug := linkOnPublicChats(t)
	makePrivate(chats, 10)
	chats.inviters = map[[2]int64]bool{{10, 1}: true} // Боб — админ с invite_users

	if err := uc.JoinInvite(context.Background(), 2, slug, nil); err != nil {
		t.Fatalf("JoinInvite: %v", err)
	}
	if len(chats.joined) != 2 {
		t.Fatalf("joined = %v, ждали вступление в оба чата", chats.joined)
	}
}

func TestPreviewInvite_HidesPrivateChat(t *testing.T) {
	uc, _, chats, slug := linkOnPublicChats(t)
	makePrivate(chats, 10)

	_, got, err := uc.PreviewInvite(context.Background(), slug)
	if err != nil {
		t.Fatalf("PreviewInvite: %v", err)
	}
	if len(got) != 1 || got[0].ID != 11 {
		t.Fatalf("превью = %+v, ждали только чат 11 (названия приватного нет)", got)
	}
}

func TestPreviewInvite_PrivateButOwnerAdminWithInvite_Shown(t *testing.T) {
	uc, _, chats, slug := linkOnPublicChats(t)
	makePrivate(chats, 10)
	chats.inviters = map[[2]int64]bool{{10, 1}: true}

	_, got, err := uc.PreviewInvite(context.Background(), slug)
	if err != nil || len(got) != 2 {
		t.Fatalf("превью = %+v, %v, ждали оба чата", got, err)
	}
}

func TestJoinInvite_AllSkipped_NoFolder(t *testing.T) {
	uc, repo, chats, slug := linkOnPublicChats(t)
	makePrivate(chats, 10)
	makePrivate(chats, 11)
	created := len(repo.created)

	if err := uc.JoinInvite(context.Background(), 2, slug, nil); err != nil {
		t.Fatalf("JoinInvite: %v", err)
	}
	if len(chats.joined) != 0 || len(repo.created) != created {
		t.Fatalf("joined = %v, создано папок: %d, ждали ни вступлений, ни папки", chats.joined, len(repo.created)-created)
	}
}

// Ссылка на чат, ставший личным/секретным (тип не группа и не канал), тоже не
// впускает, даже если автор «может приглашать».
func TestPreviewInvite_HidesNonGroupKind(t *testing.T) {
	uc, _, chats, slug := linkOnPublicChats(t)
	ch := chats.chats[10]
	ch.typ = "private"
	chats.chats[10] = ch
	chats.inviters = map[[2]int64]bool{{10, 1}: true}

	_, got, err := uc.PreviewInvite(context.Background(), slug)
	if err != nil || len(got) != 1 || got[0].ID != 11 {
		t.Fatalf("превью = %+v, %v, ждали только чат 11", got, err)
	}
}

// Публичный чат не стоит запроса прав автора (цена из плана: GetMember — только
// для приватного).
func TestAdmissible_PublicChatDoesNotAskInviteRight(t *testing.T) {
	uc, _, chats, slug := linkOnPublicChats(t)
	if _, _, err := uc.PreviewInvite(context.Background(), slug); err != nil {
		t.Fatal(err)
	}
	if chats.inviteCalls != 0 {
		t.Fatalf("CanInvite вызван %d раз для публичных чатов, ждали 0", chats.inviteCalls)
	}
}

// Явный выбор клиента с приватным чатом: тот не вступается, остальные — да.
func TestJoinInvite_ExplicitSelectionWithPrivateChat(t *testing.T) {
	uc, repo, chats, slug := linkOnPublicChats(t)
	makePrivate(chats, 10)

	if err := uc.JoinInvite(context.Background(), 2, slug, []int64{10, 11}); err != nil {
		t.Fatal(err)
	}
	last := repo.created[len(repo.created)-1]
	if len(chats.joined) != 1 || len(last.IncludeChats) != 1 || last.IncludeChats[0] != 11 {
		t.Fatalf("joined = %v, папка = %+v, ждали только чат 11", chats.joined, last)
	}
}

// Повторы в выборе не множат проверки и не плодят дубли в папке.
func TestJoinInvite_DuplicateSelectionCollapsed(t *testing.T) {
	uc, repo, chats, slug := linkOnPublicChats(t)
	before := chats.infoCalls

	if err := uc.JoinInvite(context.Background(), 2, slug, []int64{10, 10, 10, 10}); err != nil {
		t.Fatal(err)
	}
	if n := chats.infoCalls - before; n != 1 {
		t.Fatalf("Info вызван %d раз, ждали 1", n)
	}
	last := repo.created[len(repo.created)-1]
	if len(last.IncludeChats) != 1 || last.IncludeChats[0] != 10 {
		t.Fatalf("папка = %+v, ждали [10]", last)
	}
}

// Предпросмотр и вступление по неизвестному slug — ErrInviteSlugExpired
// (tweb INVITE_SLUG_EXPIRED, internalLinkProcessor.ts:1437), а не «не найдено».
func TestInvite_UnknownSlug_Expired(t *testing.T) {
	uc, _, _ := setup()
	ctx := context.Background()
	if _, _, err := uc.PreviewInvite(ctx, "nope"); !errors.Is(err, ErrInviteSlugExpired) {
		t.Fatalf("PreviewInvite = %v, want ErrInviteSlugExpired", err)
	}
	if err := uc.JoinInvite(ctx, 2, "nope", nil); !errors.Is(err, ErrInviteSlugExpired) {
		t.Fatalf("JoinInvite = %v, want ErrInviteSlugExpired", err)
	}
}

// Вступление по ссылке создаёт папку — при полном списке папок отказ ErrTooMany
// (tweb DIALOG_FILTERS_TOO_MUCH, sharedFolderInvite.tsx:212), и ни в один чат
// пользователь не вступает.
func TestJoinInvite_FoldersFull_TooMany(t *testing.T) {
	uc, repo, chats, slug := linkOnPublicChats(t)
	ctx := context.Background()
	for k := 0; k < domain.MaxFoldersPerUser; k++ {
		if _, err := repo.Create(ctx, 2, domain.DialogFilter{Title: "f", IncludeChats: []int64{10}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := uc.JoinInvite(ctx, 2, slug, nil); !errors.Is(err, ErrTooMany) {
		t.Fatalf("JoinInvite = %v, want ErrTooMany", err)
	}
	if len(chats.joined) != 0 {
		t.Fatalf("вступил в чаты при отказе: %v", chats.joined)
	}
}

// Граница лимита: на MaxFoldersPerUser-1 папках вступление проходит (>=, не >).
func TestJoinInvite_OneBelowLimit_Joins(t *testing.T) {
	uc, repo, chats, slug := linkOnPublicChats(t)
	ctx := context.Background()
	for k := 0; k < domain.MaxFoldersPerUser-1; k++ {
		if _, err := repo.Create(ctx, 2, domain.DialogFilter{Title: "f", IncludeChats: []int64{10}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := uc.JoinInvite(ctx, 2, slug, nil); err != nil {
		t.Fatalf("JoinInvite = %v, want nil", err)
	}
	if len(chats.joined) != 2 {
		t.Fatalf("joined = %v, ждали оба чата ссылки", chats.joined)
	}
}
