package chat

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// ---- in-memory fake repos for the groups usecase ----

type fakeGroupRepo struct {
	mu         sync.Mutex
	nextID     int64
	cards      map[int64]domain.ChatCard         // chatID -> card (title/about/etc)
	members    map[int64]map[int64]domain.Member // chatID -> userID -> member
	users      map[int64]domain.UserCard
	discussion map[int64]int64          // channelID -> discussion groupID
	bans       map[int64]map[int64]bool // chatID -> userID -> banned
	pinned     map[int64]map[int64]bool // userID -> chatID -> pinned
	archived   map[int64]map[int64]bool // userID -> chatID -> archived
	forum      map[int64]bool           // chatID -> темы включены
	onCreate   func(id int64)           // optional hook fired after a chat is created
}

func newFakeGroupRepo() *fakeGroupRepo {
	return &fakeGroupRepo{
		cards:      map[int64]domain.ChatCard{},
		members:    map[int64]map[int64]domain.Member{},
		users:      map[int64]domain.UserCard{},
		discussion: map[int64]int64{},
		bans:       map[int64]map[int64]bool{},
	}
}

func (r *fakeGroupRepo) Settings(_ context.Context, chatID int64) (domain.ChatSettings, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.cards[chatID]
	if !ok {
		return domain.ChatSettings{}, domain.ErrNotFound
	}
	return c.Settings, nil
}

func (r *fakeGroupRepo) SetType(_ context.Context, chatID int64, isPublic bool, username string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, c := range r.cards {
		if id != chatID && isPublic && c.Username == username {
			return domain.ErrConflict
		}
	}
	c, ok := r.cards[chatID]
	if !ok {
		return domain.ErrNotFound
	}
	c.IsPublic = isPublic
	if isPublic {
		c.Username = username
	} else {
		c.Username = ""
	}
	r.cards[chatID] = c
	return nil
}

func (r *fakeGroupRepo) SetPermissions(_ context.Context, chatID int64, perms domain.MemberPerms, slow int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.cards[chatID]
	c.Settings.DefaultPerms = perms
	c.Settings.SlowmodeSeconds = slow
	r.cards[chatID] = c
	return nil
}

func (r *fakeGroupRepo) SetReactions(_ context.Context, chatID int64, mode string, allowed []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.cards[chatID]
	c.Settings.ReactionsMode = mode
	c.Settings.ReactionsAllowed = allowed
	r.cards[chatID] = c
	return nil
}

func (r *fakeGroupRepo) SetHistoryForNew(_ context.Context, chatID int64, visible bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.cards[chatID]
	c.Settings.HistoryForNew = visible
	r.cards[chatID] = c
	return nil
}

func (r *fakeGroupRepo) Ban(_ context.Context, chatID, userID, _ int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.bans[chatID] == nil {
		r.bans[chatID] = map[int64]bool{}
	}
	r.bans[chatID][userID] = true
	return nil
}

func (r *fakeGroupRepo) Unban(_ context.Context, chatID, userID int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.bans[chatID], userID)
	return nil
}

func (r *fakeGroupRepo) IsBanned(_ context.Context, chatID, userID int64) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.bans[chatID][userID], nil
}

func (r *fakeGroupRepo) ListBans(_ context.Context, chatID int64) ([]domain.BannedUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []domain.BannedUser{}
	for uid := range r.bans[chatID] {
		out = append(out, domain.BannedUser{UserID: uid})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UserID < out[j].UserID })
	return out, nil
}

func (r *fakeGroupRepo) DeleteChat(_ context.Context, chatID int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.cards, chatID)
	delete(r.members, chatID)
	delete(r.bans, chatID)
	return nil
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

func (r *fakeGroupRepo) IsDiscussionGroup(_ context.Context, chatID int64) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, gid := range r.discussion {
		if gid == chatID {
			return true, nil
		}
	}
	return false, nil
}

func (r *fakeGroupRepo) CreateMultiMember(_ context.Context, typ, title, about, username string, isPublic bool, creatorID int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	id := r.nextID
	r.cards[id] = domain.ChatCard{
		ID: id, Type: typ, Title: title, About: about, Username: username,
		IsPublic: isPublic, CreatorID: creatorID,
		Settings: domain.ChatSettings{DefaultPerms: domain.AllMemberPerms, ReactionsMode: "all", HistoryForNew: true},
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

func (r *fakeGroupRepo) SetMuted(_ context.Context, chatID, userID int64, muted bool, _ *time.Time) error {
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

func (r *fakeGroupRepo) SetNotify(_ context.Context, _, _ int64, _ *bool, _ *string) error {
	return nil
}

func (r *fakeGroupRepo) SetForum(_ context.Context, chatID int64, enabled bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.forum == nil {
		r.forum = map[int64]bool{}
	}
	r.forum[chatID] = enabled
	return nil
}

func (r *fakeGroupRepo) SetPinned(_ context.Context, chatID, userID int64, pinned bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pinned == nil {
		r.pinned = map[int64]map[int64]bool{}
	}
	if r.pinned[userID] == nil {
		r.pinned[userID] = map[int64]bool{}
	}
	if pinned {
		r.pinned[userID][chatID] = true
	} else {
		delete(r.pinned[userID], chatID)
	}
	return nil
}

func (r *fakeGroupRepo) CountPinned(_ context.Context, userID int64) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pinned[userID]), nil
}

func (r *fakeGroupRepo) SetArchived(_ context.Context, chatID, userID int64, archived bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.archived == nil {
		r.archived = map[int64]map[int64]bool{}
	}
	if r.archived[userID] == nil {
		r.archived[userID] = map[int64]bool{}
	}
	r.archived[userID][chatID] = archived
	delete(r.pinned[userID], chatID)
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

func (r *fakeGroupRepo) SetPhoto(_ context.Context, chatID, mediaID int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.cards[chatID]
	if !ok {
		return domain.ErrNotFound
	}
	c.PhotoMediaID = &mediaID
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

func (r *fakeInviteRepo) Create(_ context.Context, chatID, createdBy int64, token string, usageLimit *int, requiresApproval bool, expiresAt *time.Time) (domain.InviteLink, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextID++
	l := domain.InviteLink{ID: r.nextID, ChatID: chatID, Token: token, CreatedBy: createdBy, UsageLimit: usageLimit, RequiresApproval: requiresApproval, ExpiresAt: expiresAt}
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
func (c groupChats) CreatePrivate(context.Context, int64, int64) (int64, error) { return 0, nil }
func (c groupChats) CreateSecret(context.Context, int64, int64) (int64, error)  { return 0, nil }
func (c groupChats) FindSaved(context.Context, int64) (int64, error)            { return 0, domain.ErrNotFound }
func (c groupChats) CreateSaved(context.Context, int64) (int64, error)          { return 0, nil }
func (c groupChats) MemberIDs(_ context.Context, chatID int64) ([]int64, error) {
	c.fg.mu.Lock()
	defer c.fg.mu.Unlock()
	var ids []int64
	for uid := range c.fg.members[chatID] {
		ids = append(ids, uid)
	}
	return ids, nil
}
func (c groupChats) ListDialogs(context.Context, int64) ([]domain.Dialog, error) { return nil, nil }
func (c groupChats) ChatPartners(context.Context, int64) ([]int64, error)        { return nil, nil }
func (c groupChats) SetAutoDelete(context.Context, int64, int) error             { return nil }
func (c groupChats) UserAutoDelete(context.Context, int64) (int, error)          { return 0, nil }
func (c groupChats) SetUserAutoDelete(context.Context, int64, int) error         { return nil }
func (c groupChats) IncUnread(context.Context, int64, int64) error               { return nil }
func (c groupChats) CurrentReadSeq(context.Context, int64, int64) (int64, error) { return 0, nil }
func (c groupChats) SetRead(context.Context, int64, int64, int64, int) error     { return nil }
func (c groupChats) ChatType(context.Context, int64) (string, error)             { return "group", nil }
func (c groupChats) PinMessage(context.Context, int64, int64, int64) error       { return nil }
func (c groupChats) UnpinMessage(context.Context, int64, int64) error            { return nil }
func (c groupChats) ListPins(context.Context, int64) ([]domain.Message, error)   { return nil, nil }
func (c groupChats) Viewers(context.Context, int64, int64, int64) ([]int64, error) {
	return nil, nil
}
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
	n := 0
	tokenGen = func() string { n++; return fmt.Sprintf("test-token-%d", n) }
	t.Cleanup(func() { tokenGen = prev })
	in := New(fakeTx{}, groupChats{fg}, nil, nil, nil, nil, fg, fi, nil, nil, fjr)
	return in, fg, fjr
}

func TestListMembers_RequiresMembership(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false, nil)
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
	id, err := i.CreateGroup(context.Background(), 7, "Team", "", "", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	m, _ := fg.GetMember(context.Background(), id, 7)
	if m.Role != domain.RoleCreator {
		t.Fatalf("creator role = %q", m.Role)
	}
}

// Group lifecycle with the message pipeline wired: creation with member_ids
// posts a group_create service message to every member (the live "chat
// appeared" signal), add/leave/kick post their service messages, and a removed
// member gets a chat_removed frame.
func TestGroupLifecycle_ServiceMessagesAndChatRemoved(t *testing.T) {
	fg := newFakeGroupRepo()
	s := newStore()
	// fakeMsgs.NextSeq знает только чаты из store — регистрируем созданные группы.
	fg.onCreate = func(id int64) {
		s.mu.Lock()
		s.chatType[id] = "group"
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	fg.users[7] = domain.UserCard{ID: 7, DisplayName: "Алиса Иванова", FirstName: "Алиса"}
	fg.users[8] = domain.UserCard{ID: 8, DisplayName: "Боб"}
	fg.users[9] = domain.UserCard{ID: 9, DisplayName: "Чарли"}

	// Дубликаты и сам создатель в member_ids не задваиваются.
	id, err := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8, 9, 7, 8})
	if err != nil {
		t.Fatal(err)
	}
	if ms, _ := in.ListMembers(ctx, id, 7, 0, 100); len(ms) != 3 {
		t.Fatalf("members = %d; want 3", len(ms))
	}
	for _, uid := range []int64{7, 8, 9} {
		if pub.countFor(uid) != 1 {
			t.Fatalf("group_create frame for %d = %d; want 1", uid, pub.countFor(uid))
		}
	}
	if msgs := s.messages[id]; len(msgs) != 1 || msgs[0].Type != "service" ||
		!strings.Contains(msgs[0].Text, `"action":"group_create"`) ||
		!strings.Contains(msgs[0].Text, "Алиса Иванова") {
		t.Fatalf("group_create service msg: %+v", s.messages[id])
	}

	// Добавление: сервисное сообщение add_user доходит и новому участнику.
	fg.users[10] = domain.UserCard{ID: 10, DisplayName: "Дарья"}
	if err := in.AddMember(ctx, id, 7, 10); err != nil {
		t.Fatal(err)
	}
	if pub.countFor(10) != 1 {
		t.Fatalf("add_user frame for new member = %d; want 1", pub.countFor(10))
	}
	if msgs := s.messages[id]; !strings.Contains(msgs[len(msgs)-1].Text, `"action":"add_user"`) ||
		!strings.Contains(msgs[len(msgs)-1].Text, "Дарья") {
		t.Fatalf("add_user service msg: %s", msgs[len(msgs)-1].Text)
	}

	// Фото группы: владелец медиа с CHANGE_INFO ставит фото + сервисное edit_photo;
	// чужое медиа → not found; обычный участник без права → forbidden.
	s.seedMedia(55, 7)
	if err := in.SetChatPhoto(ctx, id, 7, 55); err != nil {
		t.Fatalf("SetChatPhoto: %v", err)
	}
	if card, _ := in.ChatCard(ctx, id, 7); card.PhotoMediaID == nil || *card.PhotoMediaID != 55 {
		t.Fatalf("photo_media_id = %v; want 55", card.PhotoMediaID)
	}
	if msgs := s.messages[id]; !strings.Contains(msgs[len(msgs)-1].Text, `"action":"edit_photo"`) {
		t.Fatalf("edit_photo service msg: %s", msgs[len(msgs)-1].Text)
	}
	s.seedMedia(56, 10)
	if err := in.SetChatPhoto(ctx, id, 7, 56); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("foreign media: err = %v; want ErrNotFound", err)
	}
	// Участник с дефолтным CHANGE_INFO проходит проверку права, но чужое медиа → not found.
	if err := in.SetChatPhoto(ctx, id, 10, 55); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("member with foreign media: err = %v; want ErrNotFound", err)
	}
	// После выключения «Изменение профиля группы» — forbidden.
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms&^domain.PermChangeInfo, 0); err != nil {
		t.Fatalf("SetChatPermissions: %v", err)
	}
	if err := in.SetChatPhoto(ctx, id, 10, 55); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("member without CHANGE_INFO: err = %v; want ErrForbidden", err)
	}
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 0); err != nil {
		t.Fatalf("restore perms: %v", err)
	}

	// Выход: leave-сообщение уходит до удаления (вышедший его получает),
	// затем — chat_removed только ему.
	before9 := pub.countFor(9)
	if err := in.RemoveMember(ctx, id, 9, 9); err != nil {
		t.Fatal(err)
	}
	if pub.countFor(9) != before9+2 {
		t.Fatalf("frames for leaver = %d; want +2 (leave + chat_removed)", pub.countFor(9)-before9)
	}
	last := pub.frames[len(pub.frames)-1]
	if last.userID != 9 || !strings.Contains(string(last.frame), `"t":"chat_removed"`) {
		t.Fatalf("last frame = to %d: %s", last.userID, last.frame)
	}

	// Кик: kick_user + chat_removed кикнутому; не-участника кикнуть нельзя.
	if err := in.RemoveMember(ctx, id, 7, 8); err != nil {
		t.Fatal(err)
	}
	if msgs := s.messages[id]; !strings.Contains(msgs[len(msgs)-1].Text, `"action":"kick_user"`) {
		t.Fatalf("kick_user service msg: %s", msgs[len(msgs)-1].Text)
	}
	svcCount := len(s.messages[id])
	if err := in.RemoveMember(ctx, id, 7, 8); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("kick non-member: err = %v; want ErrNotFound", err)
	}
	if len(s.messages[id]) != svcCount {
		t.Fatal("kick of non-member posted a service message")
	}
	if ms, _ := in.ListMembers(ctx, id, 7, 0, 100); len(ms) != 2 {
		t.Fatalf("members after leave+kick = %d; want 2", len(ms))
	}
}

func TestAddMember_DefaultPermissionGates(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false, nil)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleMember, 0) // plain member
	// По умолчанию (как в Telegram) обычный участник может добавлять людей.
	if err := i.AddMember(context.Background(), id, 8, 9); err != nil {
		t.Fatalf("member add with default perms: %v", err)
	}
	// Админ выключает «Добавление участников» → участнику запрещено, создателю можно.
	if err := i.SetChatPermissions(context.Background(), id, 7, domain.AllMemberPerms&^domain.PermAddMembers, 0); err != nil {
		t.Fatalf("SetChatPermissions: %v", err)
	}
	if err := i.AddMember(context.Background(), id, 8, 10); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if err := i.AddMember(context.Background(), id, 7, 10); err != nil {
		t.Fatalf("creator add: %v", err)
	}
}

func TestPromoteAdmin_RequiresManageAdmins(t *testing.T) {
	i, fg, _ := newGroupTestInteractor(t)
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false, nil)
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
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false, nil)
	link, _ := i.CreateInvite(context.Background(), id, 7, nil, false, nil)

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
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false, nil)
	link, _ := i.CreateInvite(context.Background(), id, 7, nil, true, nil)

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
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false, nil)
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
	id, _ := i.CreateGroup(context.Background(), 7, "Team", "", "", false, nil)
	link, _ := i.CreateInvite(context.Background(), id, 7, nil, true, nil)
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

// Групповые настройки: slowmode тормозит обычного участника (но не ретрай и не
// админа), режим реакций «none/some», бан не пускает по ссылке и при добавлении
// обычным участником, DeleteGroup шлёт chat_removed всем и убивает чат.
func TestGroupSettings_Enforcement(t *testing.T) {
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64) {
		s.mu.Lock()
		s.chatType[id] = "group"
		s.mu.Unlock()
	}
	fi := newFakeInviteRepo()
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, fg, fi, nil, nil, newFakeJoinRequestRepo())
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	fg.users[7] = domain.UserCard{ID: 7, DisplayName: "Алиса"}
	fg.users[8] = domain.UserCard{ID: 8, DisplayName: "Боб"}

	id, err := in.CreateGroup(ctx, 7, "Team", "", "", false, []int64{8})
	if err != nil {
		t.Fatal(err)
	}

	// Slowmode 60с: первое сообщение участника проходит, второе — ErrSlowmode,
	// ретрай первого (тот же client_msg_id) — нет; создателю можно всегда.
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 60); err != nil {
		t.Fatal(err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "раз", ClientMsgID: "s1"}); err != nil {
		t.Fatalf("first send: %v", err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "два", ClientMsgID: "s2"}); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("second send: err = %v; want ErrSlowmode", err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "раз", ClientMsgID: "s1"}); err != nil {
		t.Fatalf("retry of accepted send: %v", err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "админу можно", ClientMsgID: "s3"}); err != nil {
		t.Fatalf("creator send under slowmode: %v", err)
	}
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 0); err != nil {
		t.Fatal(err)
	}

	// Запрет отправки сообщений участникам.
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms&^domain.PermSendMessages, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "нельзя", ClientMsgID: "s4"}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("send without perm: err = %v; want ErrForbidden", err)
	}
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 0); err != nil {
		t.Fatal(err)
	}

	// Реакции: none — запрещены; some — только из списка.
	msg, _ := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "реагируй", ClientMsgID: "s5"})
	if err := in.SetChatReactions(ctx, id, 7, "none", nil); err != nil {
		t.Fatal(err)
	}
	if err := in.React(ctx, id, msg.ID, 8, "👍", true); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("react in none mode: err = %v; want ErrForbidden", err)
	}
	if err := in.SetChatReactions(ctx, id, 7, "some", []string{"❤"}); err != nil {
		t.Fatal(err)
	}
	if err := in.React(ctx, id, msg.ID, 8, "👍", true); !errors.Is(err, domain.ErrBadReaction) {
		t.Fatalf("react not in list: err = %v; want ErrBadReaction", err)
	}
	if err := in.React(ctx, id, msg.ID, 8, "❤", true); err != nil {
		t.Fatalf("allowed react: %v", err)
	}

	// Бан: кикнут + не вернётся по ссылке и через добавление участником; разбан лечит.
	link, _ := in.CreateInvite(ctx, id, 7, nil, false, nil)
	if err := in.BanMember(ctx, id, 7, 8); err != nil {
		t.Fatalf("BanMember: %v", err)
	}
	if _, err := fg.GetMember(ctx, id, 8); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("banned user still a member")
	}
	if bans, _ := in.ListBanned(ctx, id, 7); len(bans) != 1 || bans[0].UserID != 8 {
		t.Fatalf("bans = %+v; want [8]", bans)
	}
	if _, err := in.JoinByToken(ctx, link.Token, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("banned join by link: err = %v; want ErrForbidden", err)
	}
	if err := in.UnbanMember(ctx, id, 7, 8); err != nil {
		t.Fatal(err)
	}
	if _, err := in.JoinByToken(ctx, link.Token, 8); err != nil {
		t.Fatalf("join after unban: %v", err)
	}

	// Тип группы: публичная с занятым username → conflict.
	if err := in.SetChatType(ctx, id, 7, true, "team"); err != nil {
		t.Fatal(err)
	}
	id2, _ := in.CreateGroup(ctx, 7, "Other", "", "", false, nil)
	if err := in.SetChatType(ctx, id2, 7, true, "team"); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("taken username: err = %v; want ErrConflict", err)
	}

	// DeleteGroup: только создатель; все получают chat_removed, чат исчезает.
	if err := in.DeleteGroup(ctx, id, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("member delete: err = %v; want ErrForbidden", err)
	}
	pub.reset()
	if err := in.DeleteGroup(ctx, id, 7); err != nil {
		t.Fatalf("DeleteGroup: %v", err)
	}
	if pub.countFor(7) == 0 || pub.countFor(8) == 0 {
		t.Fatalf("chat_removed frames: 7=%d 8=%d; want >0 both", pub.countFor(7), pub.countFor(8))
	}
	if _, err := fg.Card(ctx, id, 7); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("chat still exists after DeleteGroup")
	}
}
