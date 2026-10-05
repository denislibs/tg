package stats

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeRepo struct {
	typ          string
	role         string
	summary      domain.ChannelStatsSummary
	members      []domain.StatPoint
	recent       []domain.RecentPost
	postExists   bool
	postViewsDay []domain.StatPoint
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
func (f *fakeRepo) ViewsByDay(context.Context, int64) ([]domain.StatPoint, error) { return nil, nil }
func (f *fakeRepo) PostsByDay(context.Context, int64) ([]domain.StatPoint, error) { return nil, nil }
func (f *fakeRepo) RecentPosts(context.Context, int64, int) ([]domain.RecentPost, error) {
	return f.recent, nil
}
func (f *fakeRepo) PostExists(context.Context, int64, int64) (bool, error) {
	return f.postExists, nil
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

func TestChannelStatsCumulativeAndJoined(t *testing.T) {
	uc := New(&fakeRepo{
		typ:  "channel",
		role: domain.RoleAdmin,
		members: []domain.StatPoint{
			{Day: day("2024-01-01"), Value: 2},
			{Day: day("2024-01-02"), Value: 1},
			{Day: day("2024-01-03"), Value: 3},
		},
		recent: []domain.RecentPost{{Seq: 9, Views: 4}},
	})
	st, err := uc.ChannelStats(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !st.Broadcast {
		t.Fatal("канал должен отвечать stats.broadcastStats")
	}
	// Кумулятив: 2, 3, 6; суточный прирост — как есть.
	want := []int64{2, 3, 6}
	if len(st.MembersGrowth) != len(want) || len(st.JoinedByDay) != len(want) {
		t.Fatalf("длины рядов: рост %d, прирост %d", len(st.MembersGrowth), len(st.JoinedByDay))
	}
	for i, w := range want {
		if st.MembersGrowth[i].Value != w {
			t.Fatalf("MembersGrowth[%d]: want %d, got %d", i, w, st.MembersGrowth[i].Value)
		}
	}
	if st.JoinedByDay[2].Value != 3 {
		t.Fatalf("JoinedByDay[2]: want 3, got %d", st.JoinedByDay[2].Value)
	}
	if len(st.RecentPosts) != 1 || st.RecentPosts[0].Seq != 9 {
		t.Fatalf("RecentPosts: %+v", st.RecentPosts)
	}
}

func TestChannelStatsGroupIsMegagroup(t *testing.T) {
	uc := New(&fakeRepo{typ: "group", role: domain.RoleCreator})
	st, err := uc.ChannelStats(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if st.Broadcast {
		t.Fatal("группа должна отвечать stats.megagroupStats")
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

func TestPostStatsViewsByDay(t *testing.T) {
	uc := New(&fakeRepo{
		typ: "channel", role: domain.RoleCreator, postExists: true,
		postViewsDay: []domain.StatPoint{{Day: day("2024-01-01"), Value: 5}},
	})
	st, err := uc.PostStats(context.Background(), 1, 2, 7)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(st.ViewsByDay) != 1 || st.ViewsByDay[0].Value != 5 {
		t.Fatalf("ViewsByDay: %+v", st.ViewsByDay)
	}
}
