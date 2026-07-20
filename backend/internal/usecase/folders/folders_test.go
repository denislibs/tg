package folders

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// --- фейки ---

type fakeRepo struct {
	folders map[int64]domain.Folder // by id
	owner   map[int64]int64         // folder id → owner id
	nextID  int64
	invites map[string]domain.FolderInvite // by slug
	created []domain.Folder                // папки, созданные JoinInvite
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{folders: map[int64]domain.Folder{}, owner: map[int64]int64{}, invites: map[string]domain.FolderInvite{}, nextID: 1}
}

func (r *fakeRepo) List(_ context.Context, ownerID int64) ([]domain.Folder, error) {
	out := []domain.Folder{}
	for id, f := range r.folders {
		if r.owner[id] == ownerID {
			out = append(out, f)
		}
	}
	return out, nil
}
func (r *fakeRepo) Create(_ context.Context, ownerID int64, f domain.Folder) (domain.Folder, error) {
	f.ID = r.nextID
	r.nextID++
	r.folders[f.ID] = f
	r.owner[f.ID] = ownerID
	r.created = append(r.created, f)
	return f, nil
}
func (r *fakeRepo) Update(_ context.Context, _ int64, f domain.Folder) (domain.Folder, error) {
	return f, nil
}
func (r *fakeRepo) Delete(_ context.Context, _, _ int64) error { return nil }
func (r *fakeRepo) Count(_ context.Context, _ int64) (int, error) {
	return len(r.folders), nil
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
	joined [][2]int64
}

func (c *fakeChats) Info(_ context.Context, chatID int64) (string, bool, error) {
	ch, ok := c.chats[chatID]
	if !ok {
		return "", false, domain.ErrNotFound
	}
	return ch.typ, ch.isPublic, nil
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
	c.member[[2]int64{chatID, userID}] = true
	c.joined = append(c.joined, [2]int64{chatID, userID})
	return nil
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
	f, _ := repo.Create(ctx, 1, domain.Folder{Title: "Mix", IncludeChats: []int64{10, 11, 12, 13}})

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
	f, _ := repo.Create(ctx, 1, domain.Folder{Title: "Mine", IncludeChats: []int64{10}})
	if _, err := uc.CreateInvite(ctx, 2, f.ID, ""); err != domain.ErrNotFound {
		t.Fatalf("foreign CreateInvite = %v, want ErrNotFound", err)
	}
}

func TestCreateInvite_NoShareable(t *testing.T) {
	uc, repo, _ := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.Folder{Title: "Priv", IncludeChats: []int64{12, 13}})
	if _, err := uc.CreateInvite(ctx, 1, f.ID, ""); err != ErrNoShareable {
		t.Fatalf("CreateInvite = %v, want ErrNoShareable", err)
	}
}

func TestJoinInvite_JoinsAndCreatesFolder(t *testing.T) {
	uc, repo, chats := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.Folder{Title: "Team", IncludeChats: []int64{10, 11}})
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
	// создана папка с обоими чатами (title из инвайта)
	if len(repo.created) == 0 {
		t.Fatalf("no folder created")
	}
	last := repo.created[len(repo.created)-1]
	if last.Title != "Team" || len(last.IncludeChats) != 2 {
		t.Fatalf("created folder = %+v", last)
	}
}

func TestJoinInvite_IgnoresChatsNotInInvite(t *testing.T) {
	uc, repo, chats := setup()
	ctx := context.Background()
	f, _ := repo.Create(ctx, 1, domain.Folder{Title: "Team", IncludeChats: []int64{10}})
	inv, _ := uc.CreateInvite(ctx, 1, f.ID, "")

	// пытаемся вступить в 11, которого нет в ссылке
	if err := uc.JoinInvite(ctx, 2, inv.Slug, []int64{11}); err != nil {
		t.Fatalf("JoinInvite: %v", err)
	}
	if len(chats.joined) != 0 {
		t.Fatalf("joined = %v, want none (11 not in invite)", chats.joined)
	}
}
