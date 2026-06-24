package chat

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// ---- in-memory fake repos for the groups usecase ----

type fakeGroupRepo struct {
	mu        sync.Mutex
	nextID    int64
	cards     map[int64]domain.ChatCard       // chatID -> card (title/about/etc)
	members   map[int64]map[int64]domain.Member // chatID -> userID -> member
	users     map[int64]domain.UserCard
	onCreate  func(id int64) // optional hook fired after a chat is created
}

func newFakeGroupRepo() *fakeGroupRepo {
	return &fakeGroupRepo{
		cards:   map[int64]domain.ChatCard{},
		members: map[int64]map[int64]domain.Member{},
		users:   map[int64]domain.UserCard{},
	}
}

func (r *fakeGroupRepo) CreateMultiMember(_ context.Context, typ, title, about, username string, isPublic bool, creatorID int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	id := r.nextID
	r.cards[id] = domain.ChatCard{
		ID: id, Type: typ, Title: title, About: about, Username: username,
		IsPublic: isPublic, CreatorID: creatorID,
	}
	r.members[id] = map[int64]domain.Member{}
	if r.onCreate != nil {
		r.onCreate(id)
	}
	return id, nil
}

func (r *fakeGroupRepo) AddMember(_ context.Context, chatID, userID int64, role string, rights domain.Rights) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.members[chatID] == nil {
		r.members[chatID] = map[int64]domain.Member{}
	}
	if _, ok := r.members[chatID][userID]; ok {
		return nil // ON CONFLICT DO NOTHING
	}
	r.members[chatID][userID] = domain.Member{ChatID: chatID, UserID: userID, Role: role, Rights: rights}
	c := r.cards[chatID]
	c.MemberCount++
	r.cards[chatID] = c
	return nil
}

func (r *fakeGroupRepo) RemoveMember(_ context.Context, chatID, userID int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.members[chatID][userID]; ok {
		delete(r.members[chatID], userID)
		c := r.cards[chatID]
		if c.MemberCount > 0 {
			c.MemberCount--
		}
		r.cards[chatID] = c
	}
	return nil
}

func (r *fakeGroupRepo) GetMember(_ context.Context, chatID, userID int64) (domain.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.members[chatID][userID]
	if !ok {
		return domain.Member{}, domain.ErrNotFound
	}
	return m, nil
}

func (r *fakeGroupRepo) SetRole(_ context.Context, chatID, userID int64, role string, rights domain.Rights) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.members[chatID][userID]
	if !ok {
		return domain.ErrNotFound
	}
	m.Role = role
	m.Rights = rights
	r.members[chatID][userID] = m
	return nil
}

func (r *fakeGroupRepo) SetMuted(_ context.Context, chatID, userID int64, muted bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.members[chatID][userID]
	if !ok {
		return domain.ErrNotFound
	}
	m.Muted = muted
	r.members[chatID][userID] = m
	return nil
}

func (r *fakeGroupRepo) Card(_ context.Context, chatID, viewerID int64) (domain.ChatCard, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.cards[chatID]
	if !ok {
		return domain.ChatCard{}, domain.ErrNotFound
	}
	if m, ok := r.members[chatID][viewerID]; ok {
		c.MyRole = m.Role
		c.MyRights = m.Rights
		c.Muted = m.Muted
	}
	return c, nil
}

func (r *fakeGroupRepo) EditInfo(_ context.Context, chatID int64, title, about, username string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.cards[chatID]
	if !ok {
		return domain.ErrNotFound
	}
	c.Title = title
	c.About = about
	c.Username = username
	r.cards[chatID] = c
	return nil
}

func (r *fakeGroupRepo) UsersByIDs(_ context.Context, ids []int64) ([]domain.UserCard, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.UserCard, 0, len(ids))
	for _, id := range ids {
		if u, ok := r.users[id]; ok {
			out = append(out, u)
		}
	}
	return out, nil
}

type fakeInviteRepo struct {
	mu     sync.Mutex
	nextID int64
	links  map[int64]domain.InviteLink // id -> link
}

func newFakeInviteRepo() *fakeInviteRepo {
	return &fakeInviteRepo{links: map[int64]domain.InviteLink{}}
}

func (r *fakeInviteRepo) Create(_ context.Context, chatID, createdBy int64, token string, usageLimit *int) (domain.InviteLink, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	l := domain.InviteLink{ID: r.nextID, ChatID: chatID, Token: token, CreatedBy: createdBy, UsageLimit: usageLimit}
	r.links[l.ID] = l
	return l, nil
}

func (r *fakeInviteRepo) GetByToken(_ context.Context, token string) (domain.InviteLink, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, l := range r.links {
		if l.Token == token && !l.Revoked {
			return l, nil
		}
	}
	return domain.InviteLink{}, domain.ErrNotFound
}

func (r *fakeInviteRepo) List(_ context.Context, chatID int64) ([]domain.InviteLink, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.InviteLink
	for _, l := range r.links {
		if l.ChatID == chatID && !l.Revoked {
			out = append(out, l)
		}
	}
	return out, nil
}

func (r *fakeInviteRepo) IncUses(_ context.Context, id int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, ok := r.links[id]
	if !ok {
		return domain.ErrNotFound
	}
	l.Uses++
	r.links[id] = l
	return nil
}

func (r *fakeInviteRepo) Revoke(_ context.Context, chatID int64, token string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, l := range r.links {
		if l.ChatID == chatID && l.Token == token {
			l.Revoked = true
			r.links[id] = l
		}
	}
	return nil
}

// newGroupTestInteractor wires the interactor with fake group/invite repos and a
// deterministic tokenGen so JoinByToken/CreateInvite are predictable in tests.
func newGroupTestInteractor(t *testing.T) (*Interactor, *fakeGroupRepo) {
	t.Helper()
	fg := newFakeGroupRepo()
	fi := newFakeInviteRepo()
	prev := tokenGen
	tokenGen = func() string { return "test-token" }
	t.Cleanup(func() { tokenGen = prev })
	in := New(fakeTx{}, nil, nil, nil, nil, nil, fg, fi, nil, nil)
	return in, fg
}

func TestCreateGroup_AddsCreator(t *testing.T) {
	i, fg := newGroupTestInteractor(t)
	id, err := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	m, _ := fg.GetMember(context.Background(), id, 7)
	if m.Role != domain.RoleCreator {
		t.Fatalf("creator role = %q", m.Role)
	}
}

func TestAddMember_RequiresInviteRight(t *testing.T) {
	i, fg := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleMember, 0) // plain member
	// member 8 (no INVITE_USERS) tries to add 9 → forbidden
	if err := i.AddMember(context.Background(), id, 8, 9); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	// creator 7 can add 9
	if err := i.AddMember(context.Background(), id, 7, 9); err != nil {
		t.Fatalf("creator add: %v", err)
	}
}

func TestPromoteAdmin_RequiresManageAdmins(t *testing.T) {
	i, fg := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleMember, 0)
	if err := i.PromoteAdmin(context.Background(), id, 8, 8, domain.RightPostMessages); !errors.Is(err, domain.ErrForbidden) {
		t.Fatal("non-manager must not promote")
	}
	if err := i.PromoteAdmin(context.Background(), id, 7, 8, domain.RightPostMessages); err != nil {
		t.Fatalf("creator promote: %v", err)
	}
	m, _ := fg.GetMember(context.Background(), id, 8)
	if m.Role != domain.RoleAdmin || m.Rights != domain.RightPostMessages {
		t.Fatalf("promoted: %+v", m)
	}
}

func TestJoinByToken(t *testing.T) {
	i, fg := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	link, _ := i.CreateInvite(context.Background(), id, 7, nil)
	if err := i.JoinByToken(context.Background(), link.Token, 9); err != nil {
		t.Fatal(err)
	}
	if _, err := fg.GetMember(context.Background(), id, 9); err != nil {
		t.Fatal("joiner not a member")
	}
}
