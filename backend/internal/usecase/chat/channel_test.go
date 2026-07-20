package chat

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// ---- fakes for the channel usecase ----

// fakeChannelRepo is an in-memory per-channel pts + updates log.
type fakeChannelRepo struct {
	mu      sync.Mutex
	pts     map[int64]int64
	updates map[int64][]domain.ChannelUpdate
}

func newFakeChannelRepo() *fakeChannelRepo {
	return &fakeChannelRepo{pts: map[int64]int64{}, updates: map[int64][]domain.ChannelUpdate{}}
}

func (r *fakeChannelRepo) AppendUpdate(_ context.Context, channelID int64, payload json.RawMessage) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pts[channelID]++
	p := r.pts[channelID]
	r.updates[channelID] = append(r.updates[channelID], domain.ChannelUpdate{
		Pts: p, PtsCount: 1, Payload: append([]byte(nil), payload...),
	})
	return p, nil
}

func (r *fakeChannelRepo) UpdatesSince(_ context.Context, channelID, sincePts int64, limit int) ([]domain.ChannelUpdate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.ChannelUpdate
	for _, u := range r.updates[channelID] {
		if u.Pts > sincePts {
			out = append(out, u)
			if len(out) == limit {
				break
			}
		}
	}
	return out, nil
}

func (r *fakeChannelRepo) CurrentPts(_ context.Context, channelID int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.pts[channelID], nil
}

// fakeSearchRepo resolves usernames and returns canned cards.
type fakeSearchRepo struct {
	mu        sync.Mutex
	usernames map[string]int64
}

func newFakeSearchRepo() *fakeSearchRepo {
	return &fakeSearchRepo{usernames: map[string]int64{}}
}

func (r *fakeSearchRepo) SearchChats(_ context.Context, _ string, _ int) ([]domain.ChatCard, error) {
	return nil, nil
}

func (r *fakeSearchRepo) SearchUsers(_ context.Context, _ string, _ int) ([]domain.UserCard, error) {
	return nil, nil
}

func (r *fakeSearchRepo) PublicChatByUsername(_ context.Context, username string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id, ok := r.usernames[username]; ok {
		return id, nil
	}
	return 0, domain.ErrNotFound
}

// fakeChannelPublisher records how many times PublishToChannel was called.
type fakeChannelPublisher struct {
	mu    sync.Mutex
	count int
}

func (p *fakeChannelPublisher) PublishToChannel(_ context.Context, _ int64, _ []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.count++
	return nil
}

// groupMembershipChats adapts a fakeGroupRepo as a ChatRepo for IsMember checks
// (the only ChatRepo method the channel usecase needs).
type groupMembershipChats struct{ fg *fakeGroupRepo }

func (c groupMembershipChats) FindPrivate(context.Context, int64, int64) (int64, error) {
	return 0, domain.ErrNotFound
}
func (c groupMembershipChats) CreatePrivate(context.Context, int64, int64) (int64, error) {
	return 0, nil
}
func (c groupMembershipChats) CreateSecret(context.Context, int64, int64) (int64, error) {
	return 0, nil
}
func (c groupMembershipChats) FindSaved(context.Context, int64) (int64, error) {
	return 0, domain.ErrNotFound
}
func (c groupMembershipChats) CreateSaved(context.Context, int64) (int64, error) { return 0, nil }
func (c groupMembershipChats) MemberIDs(context.Context, int64) ([]int64, error) { return nil, nil }
func (c groupMembershipChats) IsMember(_ context.Context, chatID, userID int64) (bool, error) {
	c.fg.mu.Lock()
	defer c.fg.mu.Unlock()
	_, ok := c.fg.members[chatID][userID]
	return ok, nil
}
func (c groupMembershipChats) ListDialogs(context.Context, int64) ([]domain.Dialog, error) {
	return nil, nil
}
func (c groupMembershipChats) ChatPartners(context.Context, int64) ([]int64, error) { return nil, nil }
func (c groupMembershipChats) SetAutoDelete(context.Context, int64, int) error      { return nil }
func (c groupMembershipChats) UserAutoDelete(context.Context, int64) (int, error)   { return 0, nil }
func (c groupMembershipChats) SetUserAutoDelete(context.Context, int64, int) error  { return nil }
func (c groupMembershipChats) IncUnread(context.Context, int64, int64) error        { return nil }
func (c groupMembershipChats) CurrentReadSeq(context.Context, int64, int64) (int64, error) {
	return 0, nil
}
func (c groupMembershipChats) SetRead(context.Context, int64, int64, int64, int) error  { return nil }
func (c groupMembershipChats) MaxSeq(context.Context, int64) (int64, error)             { return 0, nil }
func (c groupMembershipChats) ClearedSeq(context.Context, int64, int64) (int64, error)  { return 0, nil }
func (c groupMembershipChats) SetClearedSeq(context.Context, int64, int64, int64) error { return nil }
func (c groupMembershipChats) ChatType(context.Context, int64) (string, error)          { return "group", nil }
func (c groupMembershipChats) PinMessage(context.Context, int64, int64, int64) error    { return nil }
func (c groupMembershipChats) UnpinMessage(context.Context, int64, int64) error         { return nil }
func (c groupMembershipChats) ListPins(context.Context, int64) ([]domain.Message, error) {
	return nil, nil
}
func (c groupMembershipChats) Viewers(context.Context, int64, int64, int64) ([]int64, error) {
	return nil, nil
}

// newChannelTestInteractor wires the interactor with fake group/channel/search
// repos plus a recording channel publisher, sharing membership state so
// requireRight, IsMember and AddMember all observe the same chat.
func newChannelTestInteractor(t *testing.T) (*Interactor, *fakeGroupRepo, *fakeSearchRepo, *fakeChannelPublisher) {
	t.Helper()
	s := newStore()
	fg := newFakeGroupRepo()
	fch := newFakeChannelRepo()
	fs := newFakeSearchRepo()
	fpub := &fakeChannelPublisher{}
	in := New(fakeTx{}, groupMembershipChats{fg}, fakeMsgs{s}, nil, nil, nil, fg, nil, fch, fs, nil)
	in.SetChannelPublisher(fpub)
	// fakeMsgs.NextSeq requires the chat to exist in the store's chatType map;
	// register channels there as fg.CreateMultiMember creates them.
	fg.onCreate = func(id int64) {
		s.mu.Lock()
		s.chatType[id] = "channel"
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	return in, fg, fs, fpub
}

func TestCreateChannel_CreatorIsCreator(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	id, err := i.CreateChannel(context.Background(), 7, "News", "", "news", true)
	if err != nil {
		t.Fatal(err)
	}
	m, _ := fg.GetMember(context.Background(), id, 7)
	if m.Role != domain.RoleCreator {
		t.Fatalf("role=%q", m.Role)
	}
}

func TestPostToChannel_RequiresPostRight_AndPublishes(t *testing.T) {
	i, fg, _, fpub := newChannelTestInteractor(t)
	id, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleSubscriber, 0)
	// subscriber cannot post
	if _, err := i.PostToChannel(context.Background(), id, 8, "hi", ""); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("subscriber post = %v", err)
	}
	// creator posts → published once to the channel topic
	msg, err := i.PostToChannel(context.Background(), id, 7, "hello world", "c1")
	if err != nil {
		t.Fatal(err)
	}
	if msg.Seq == 0 {
		t.Fatal("no seq")
	}
	if fpub.count != 1 {
		t.Fatalf("publishes=%d, want 1", fpub.count)
	}
}

func TestGetChannelDifference(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	id, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_, _ = i.PostToChannel(context.Background(), id, 7, "a", "")
	_, _ = i.PostToChannel(context.Background(), id, 7, "b", "")
	ups, err := i.GetChannelDifference(context.Background(), id, 7, 1, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(ups) != 1 {
		t.Fatalf("diff since 1 = %d", len(ups))
	}
}

func TestJoinPublicChannel(t *testing.T) {
	i, fg, fs, _ := newChannelTestInteractor(t)
	id, _ := i.CreateChannel(context.Background(), 7, "News", "", "news", true)
	fs.usernames["news"] = id
	if err := i.JoinPublic(context.Background(), "news", 9); err != nil {
		t.Fatal(err)
	}
	if _, err := fg.GetMember(context.Background(), id, 9); err != nil {
		t.Fatal("joiner not subscriber")
	}
}
