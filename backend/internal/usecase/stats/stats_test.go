package stats

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeRepo struct {
	typ           string
	role          string
	summary       domain.ChannelStatsSummary
	members       []domain.StatPoint
	postExists    bool
	postViews     int64
	postForwards  int64
	postReactions []domain.ReactionCount
	postViewsDay  []domain.StatPoint
}

func (f *fakeRepo) ChatType(context.Context, int64) (string, error) { return f.typ, nil }
func (f *fakeRepo) MemberRole(context.Context, int64, int64) (string, domain.Rights, error) {
	if f.role == "" {
		return "", 0, domain.ErrNotFound
	}
	return f.role, 0, nil
}
func (f *fakeRepo) Summary(context.Context, int64) (domain.ChannelStatsSummary, error) {
	return f.summary, nil
}
func (f *fakeRepo) MembersByDay(context.Context, int64) ([]domain.StatPoint, error) {
	return f.members, nil
}
func (f *fakeRepo) ViewsByDay(context.Context, int64) ([]domain.StatPoint, error)  { return nil, nil }
func (f *fakeRepo) PostsByDay(context.Context, int64) ([]domain.StatPoint, error)  { return nil, nil }
func (f *fakeRepo) TopPosts(context.Context, int64, int) ([]domain.TopPost, error) { return nil, nil }
func (f *fakeRepo) PostExists(context.Context, int64, int64) (bool, error) {
	return f.postExists, nil
}
func (f *fakeRepo) PostOverview(context.Context, int64, int64) (int64, int64, error) {
	return f.postViews, f.postForwards, nil
}
func (f *fakeRepo) PostReactions(context.Context, int64) ([]domain.ReactionCount, error) {
	return f.postReactions, nil
}
func (f *fakeRepo) PostViewsByDay(context.Context, int64) ([]domain.StatPoint, error) {
	return f.postViewsDay, nil
}

func day(s string) time.Time { t, _ := time.Parse("2006-01-02", s); return t }

func TestChannelStatsForbiddenForNonAdmin(t *testing.T) {
	for _, role := range []string{"", domain.RoleMember, domain.RoleSubscriber} {
		uc := New(&fakeRepo{typ: "channel", role: role})
		if _, err := uc.ChannelStats(context.Background(), 1, 7); err != domain.ErrForbidden {
			t.Fatalf("role %q: want ErrForbidden, got %v", role, err)
		}
	}
}

func TestChannelStatsForbiddenForPrivateChat(t *testing.T) {
	uc := New(&fakeRepo{typ: "private", role: domain.RoleCreator})
	if _, err := uc.ChannelStats(context.Background(), 1, 7); err != domain.ErrForbidden {
		t.Fatalf("want ErrForbidden for private chat, got %v", err)
	}
}

func TestChannelStatsCumulativeAndAvgReach(t *testing.T) {
	uc := New(&fakeRepo{
		typ:  "channel",
		role: domain.RoleAdmin,
		summary: domain.ChannelStatsSummary{
			Members: 3, TotalViews: 100, PostsCount: 4, NotificationsOn: 2,
		},
		members: []domain.StatPoint{
			{Day: day("2024-01-01"), Value: 2},
			{Day: day("2024-01-02"), Value: 1},
			{Day: day("2024-01-03"), Value: 3},
		},
	})
	st, err := uc.ChannelStats(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// AvgReach = 100/4 = 25.
	if st.Summary.AvgReach != 25 {
		t.Fatalf("AvgReach: want 25, got %d", st.Summary.AvgReach)
	}
	// Кумулятив: 2, 3, 6.
	want := []int64{2, 3, 6}
	if len(st.MembersGrowth) != len(want) {
		t.Fatalf("MembersGrowth len: want %d, got %d", len(want), len(st.MembersGrowth))
	}
	for i, w := range want {
		if st.MembersGrowth[i].Value != w {
			t.Fatalf("MembersGrowth[%d]: want %d, got %d", i, w, st.MembersGrowth[i].Value)
		}
	}
}

func TestPostStatsForbiddenForNonAdmin(t *testing.T) {
	uc := New(&fakeRepo{typ: "channel", role: domain.RoleMember, postExists: true})
	if _, err := uc.PostStats(context.Background(), 1, 2, 7); err != domain.ErrForbidden {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

func TestPostStatsNotFoundForMissingPost(t *testing.T) {
	uc := New(&fakeRepo{typ: "channel", role: domain.RoleAdmin, postExists: false})
	if _, err := uc.PostStats(context.Background(), 1, 2, 7); err != domain.ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestPostStatsReactionsTotal(t *testing.T) {
	uc := New(&fakeRepo{
		typ: "channel", role: domain.RoleCreator, postExists: true,
		postViews: 120, postForwards: 4,
		postReactions: []domain.ReactionCount{{Emoji: "❤️", Count: 5}, {Emoji: "👍", Count: 3}},
	})
	st, err := uc.PostStats(context.Background(), 1, 2, 7)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if st.Views != 120 || st.Forwards != 4 {
		t.Fatalf("overview mismatch: views=%d forwards=%d", st.Views, st.Forwards)
	}
	// Итог реакций = сумма разбивки: 5 + 3 = 8.
	if st.ReactionsTotal != 8 {
		t.Fatalf("ReactionsTotal: want 8, got %d", st.ReactionsTotal)
	}
}
