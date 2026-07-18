package chat

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakePolls — in-memory PollRepo.
type fakePolls struct {
	mu    sync.Mutex
	next  int64
	polls map[int64]domain.Poll
	votes map[int64]map[int64][]int // pollID -> userID -> idxs
}

func newFakePolls() *fakePolls {
	return &fakePolls{polls: map[int64]domain.Poll{}, votes: map[int64]map[int64][]int{}}
}

func (f *fakePolls) Create(_ context.Context, p domain.Poll) (domain.Poll, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.next++
	p.ID = f.next
	f.polls[p.ID] = p
	return p, nil
}

func (f *fakePolls) ByID(_ context.Context, id int64) (domain.Poll, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.polls[id]
	if !ok {
		return domain.Poll{}, domain.ErrNotFound
	}
	return p, nil
}

func (f *fakePolls) SetVotes(_ context.Context, pollID, userID int64, idxs []int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.votes[pollID] == nil {
		f.votes[pollID] = map[int64][]int{}
	}
	if len(idxs) == 0 {
		delete(f.votes[pollID], userID)
	} else {
		f.votes[pollID][userID] = idxs
	}
	return nil
}

func (f *fakePolls) HasVoted(_ context.Context, pollID, userID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.votes[pollID][userID]
	return ok, nil
}

func (f *fakePolls) Close(_ context.Context, pollID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	p := f.polls[pollID]
	p.Closed = true
	f.polls[pollID] = p
	return nil
}

func (f *fakePolls) Info(_ context.Context, pollID, viewerID int64) (domain.PollInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.polls[pollID]
	if !ok {
		return domain.PollInfo{}, domain.ErrNotFound
	}
	info := domain.PollInfo{
		ID: p.ID, Question: p.Question, Options: p.Options,
		Anonymous: p.Anonymous, Multiple: p.Multiple, Quiz: p.Quiz, Closed: p.Closed,
		CorrectOption: p.CorrectOption, Counts: make([]int, len(p.Options)), MyVotes: []int{},
	}
	for uid, idxs := range f.votes[pollID] {
		for _, idx := range idxs {
			info.Counts[idx]++
			if uid == viewerID {
				info.MyVotes = append(info.MyVotes, idx)
			}
		}
		info.TotalVoters++
	}
	return info, nil
}

func TestVotePoll_Rules(t *testing.T) {
	fg := newFakeGroupRepo()
	fg.members[1] = map[int64]domain.Member{
		10: {ChatID: 1, UserID: 10, Role: "creator"},
		11: {ChatID: 1, UserID: 11, Role: "member"},
	}
	fp := newFakePolls()
	in := New(fakeTx{}, groupChats{fg}, nil, nil, nil, nil, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	in.SetPolls(fp)
	ctx := context.Background()

	single, _ := fp.Create(ctx, domain.Poll{ChatID: 1, Question: "q", Options: []string{"a", "b"}, Anonymous: true})
	c := 1
	quiz, _ := fp.Create(ctx, domain.Poll{ChatID: 1, Question: "q2", Options: []string{"a", "b"}, Quiz: true, CorrectOption: &c})

	// одиночный опрос: два индекса нельзя
	if _, err := in.VotePoll(ctx, single.ID, 11, []int{0, 1}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("multi vote on single: want ErrForbidden, got %v", err)
	}
	// нормальный голос + смена голоса
	if _, err := in.VotePoll(ctx, single.ID, 11, []int{0}); err != nil {
		t.Fatalf("vote: %v", err)
	}
	info, err := in.VotePoll(ctx, single.ID, 11, []int{1})
	if err != nil || info.Counts[1] != 1 || info.Counts[0] != 0 || len(info.MyVotes) != 1 {
		t.Fatalf("revote: %v %+v", err, info)
	}
	// отзыв голоса
	if info, err = in.VotePoll(ctx, single.ID, 11, nil); err != nil || info.TotalVoters != 0 {
		t.Fatalf("retract: %v %+v", err, info)
	}
	// викторина: ответ финален, отзыв запрещён; правильный ответ раскрывается после голоса
	if info, err = in.VotePoll(ctx, quiz.ID, 11, []int{0}); err != nil {
		t.Fatalf("quiz vote: %v", err)
	}
	if info.CorrectOption == nil || *info.CorrectOption != 1 {
		t.Fatalf("quiz should reveal correct after vote: %+v", info)
	}
	if _, err = in.VotePoll(ctx, quiz.ID, 11, []int{1}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("quiz revote: want ErrForbidden, got %v", err)
	}
	if _, err = in.VotePoll(ctx, quiz.ID, 11, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("quiz retract: want ErrForbidden, got %v", err)
	}
	// не участник
	if _, err = in.VotePoll(ctx, single.ID, 99, []int{0}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("non-member: want ErrNotFound, got %v", err)
	}
	// закрытие админом → голосовать нельзя
	if err = in.ClosePoll(ctx, single.ID, 10); err != nil {
		t.Fatalf("close by creator: %v", err)
	}
	if _, err = in.VotePoll(ctx, single.ID, 11, []int{0}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("vote on closed: want ErrForbidden, got %v", err)
	}
}
