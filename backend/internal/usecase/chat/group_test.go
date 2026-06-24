package chat

import (
	"context"
	"errors"
	"sort"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// ---- in-memory fake repos for the groups usecase ----

type fakeGroupRepo struct {
	mu       sync.Mutex
	nextID   int64
	cards    map[int64]domain.ChatCard         // chatID -> card (title/about/etc)
	members  map[int64]map[int64]domain.Member // chatID -> userID -> member
	users      map[int64]domain.UserCard
	discussion map[int64]int64 // channelID -> discussion groupID
	onCreate   func(id int64)  // optional hook fired after a chat is created
}

func newFakeGroupRepo() *fakeGroupRepo {
	return &fakeGroupRepo{
		cards:      map[int64]domain.ChatCard{},
		members:    map[int64]map[int64]domain.Member{},
		users:      map[int64]domain.UserCard{},
		discussion: map[int64]int64{},
	}
}

func (r *fakeGroupRepo) SetDiscussion(_ context.Context, channelID, groupID int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.discussion[channelID] = groupID
	return nil
}

func (r *fakeGroupRepo) GetDiscussion(_ context.Context, channelID int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.discussion[channelID], nil
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

func (r *fakeGroupRepo) ListMembers(_ context.Context, chatID int64, offset, limit int) ([]domain.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	var out []domain.Member
	for _, m := range r.members[chatID] {
		out = append(out, m)
	}
	// role DESC, user_id ASC — matches the SQL ordering.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Role != out[j].Role {
			return out[i].Role > out[j].Role
		}
		return out[i].UserID < out[j].UserID
	})
	if offset >= len(out) {
		return []domain.Member{}, nil
	}
	out = out[offset:]
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
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

func (r *fakeInviteRepo) Create(_ context.Context, chatID, createdBy int64, token string, usageLimit *int, requiresApproval bool) (domain.InviteLink, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	l := domain.InviteLink{ID: r.nextID, ChatID: chatID, Token: token, CreatedBy: createdBy, UsageLimit: usageLimit, RequiresApproval: requiresApproval}
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

// fakeJoinRequestRepo is an in-memory JoinRequestRepo keyed by (chatID,userID),
// idempotent on Create like the real ON CONFLICT DO NOTHING.
type fakeJoinRequestRepo struct {
	mu   sync.Mutex
	reqs map[int64]map[int64]domain.JoinRequest // chatID -> userID -> request
}

func newFakeJoinRequestRepo() *fakeJoinRequestRepo {
	return &fakeJoinRequestRepo{reqs: map[int64]map[int64]domain.JoinRequest{}}
}

func (r *fakeJoinRequestRepo) Create(_ context.Context, chatID, userID int64, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.reqs[chatID] == nil {
		r.reqs[chatID] = map[int64]domain.JoinRequest{}
	}
	if _, ok := r.reqs[chatID][userID]; ok {
		return nil // dedup
	}
	r.reqs[chatID][userID] = domain.JoinRequest{ChatID: chatID, UserID: userID}
	return nil
}

func (r *fakeJoinRequestRepo) List(_ context.Context, chatID int64) ([]domain.JoinRequest, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.JoinRequest
	for _, jr := range r.reqs[chatID] {
		out = append(out, jr)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UserID < out[j].UserID })
	return out, nil
}

func (r *fakeJoinRequestRepo) Delete(_ context.Context, chatID, userID int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.reqs[chatID], userID)
	return nil
}

// groupChats is a tiny ChatRepo whose membership view is backed by a
// fakeGroupRepo, so the groups usecase's membership gating (ListMembers) can be
// exercised without the full in-memory store.
type groupChats struct{ fg *fakeGroupRepo }

func (c groupChats) FindPrivate(context.Context, int64, int64) (int64, error) {
	return 0, domain.ErrNotFound
}
func (c groupChats) CreatePrivate(context.Context, int64, int64) (int64, error)  { return 0, nil }
func (c groupChats) MemberIDs(context.Context, int64) ([]int64, error)           { return nil, nil }
func (c groupChats) ListDialogs(context.Context, int64) ([]domain.Dialog, error) { return nil, nil }
func (c groupChats) ChatPartners(context.Context, int64) ([]int64, error)        { return nil, nil }
func (c groupChats) IncUnread(context.Context, int64, int64) error               { return nil }
func (c groupChats) CurrentReadSeq(context.Context, int64, int64) (int64, error) { return 0, nil }
func (c groupChats) SetRead(context.Context, int64, int64, int64, int) error     { return nil }
func (c groupChats) IsMember(ctx context.Context, chatID, userID int64) (bool, error) {
	_, err := c.fg.GetMember(ctx, chatID, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

// newGroupTestInteractor wires the interactor with fake group/invite repos and a
// deterministic tokenGen so JoinByToken/CreateInvite are predictable in tests.
func newGroupTestInteractor(t *testing.T) (*Interactor, *fakeGroupRepo, *fakeJoinRequestRepo) {
	t.Helper()
	fg := newFakeGroupRepo()
	fi := newFakeInviteRepo()
	fjr := newFakeJoinRequestRepo()
	prev := tokenGen
	tokenGen = func() string { return "test-token" }
	t.Cleanup(func() { tokenGen = prev })
	in := New(fakeTx{}, groupChats{fg}, nil, nil, nil, nil, fg, fi, nil, nil, fjr)
	return in, fg, fjr
}

func TestListMembers_RequiresMembership(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleMember, 0)

	// Non-member 99 → forbidden.
	if _, err := i.ListMembers(context.Background(), id, 99, 0, 200); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-member want ErrForbidden, got %v", err)
	}

	// Member 8 sees the full list (creator 7 + member 8).
	ms, err := i.ListMembers(context.Background(), id, 8, 0, 200)
	if err != nil {
		t.Fatalf("member list: %v", err)
	}
	if len(ms) != 2 {
		t.Fatalf("members = %d; want 2 (%+v)", len(ms), ms)
	}
	roles := map[int64]string{}
	for _, m := range ms {
		roles[m.UserID] = m.Role
	}
	if roles[7] != domain.RoleCreator {
		t.Fatalf("user 7 role = %q; want creator", roles[7])
	}
	if roles[8] != domain.RoleMember {
		t.Fatalf("user 8 role = %q; want member", roles[8])
	}
}

func TestCreateGroup_AddsCreator(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
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
	i, fg, _ := newGroupTestInteractor(t)
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
	i, fg, _ := newGroupTestInteractor(t)
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

func TestJoinByToken_NoApproval(t *testing.T) {
	i, fg, fjr := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	link, _ := i.CreateInvite(context.Background(), id, 7, nil, false)

	requested, err := i.JoinByToken(context.Background(), link.Token, 9)
	if err != nil {
		t.Fatal(err)
	}
	if requested {
		t.Fatal("want requested=false for a non-approval link")
	}
	if _, err := fg.GetMember(context.Background(), id, 9); err != nil {
		t.Fatal("joiner not a member")
	}
	if reqs, _ := fjr.List(context.Background(), id); len(reqs) != 0 {
		t.Fatalf("want no pending requests, got %+v", reqs)
	}
}

func TestJoinByToken_RequiresApproval(t *testing.T) {
	i, fg, fjr := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	link, _ := i.CreateInvite(context.Background(), id, 7, nil, true)

	requested, err := i.JoinByToken(context.Background(), link.Token, 9)
	if err != nil {
		t.Fatal(err)
	}
	if !requested {
		t.Fatal("want requested=true for an approval-required link")
	}
	// Not yet a member.
	if _, err := fg.GetMember(context.Background(), id, 9); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("user must not be a member yet, got %v", err)
	}
	// A pending request exists.
	reqs, _ := fjr.List(context.Background(), id)
	if len(reqs) != 1 || reqs[0].UserID != 9 {
		t.Fatalf("want one pending request for user 9, got %+v", reqs)
	}
}

func TestListJoinRequests_NonAdminForbidden(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleMember, 0) // plain member

	if _, err := i.ListJoinRequests(context.Background(), id, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-admin want ErrForbidden, got %v", err)
	}
	if _, err := i.ListJoinRequests(context.Background(), id, 99); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("non-member want ErrForbidden, got %v", err)
	}
}

func TestApproveJoinRequest(t *testing.T) {
	i, fg, fjr := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false)
	link, _ := i.CreateInvite(context.Background(), id, 7, nil, true)
	if _, err := i.JoinByToken(context.Background(), link.Token, 9); err != nil {
		t.Fatal(err)
	}

	if err := i.ApproveJoinRequest(context.Background(), id, 7, 9); err != nil {
		t.Fatalf("creator approve: %v", err)
	}
	// Now a member.
	if _, err := fg.GetMember(context.Background(), id, 9); err != nil {
		t.Fatalf("approved user not a member: %v", err)
	}
	// Request cleared.
	if reqs, _ := fjr.List(context.Background(), id); len(reqs) != 0 {
		t.Fatalf("want request gone after approval, got %+v", reqs)
	}
}
