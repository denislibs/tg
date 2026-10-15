package stats

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

type summaryCall struct {
	fromSeq, toSeq int64
	at             time.Time
}

type fakeRepo struct {
	typ          string
	role         string
	seqBefore    func(maxSeq int64, t time.Time) int64
	summaries    []summaryCall
	summary      func(summaryCall) domain.ChannelStatsSummary
	notifyOn     int64
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
func (f *fakeRepo) SeqBefore(_ context.Context, _, maxSeq int64, t time.Time) (int64, error) {
	if f.seqBefore == nil {
		return 0, nil
	}
	return f.seqBefore(maxSeq, t), nil
}
func (f *fakeRepo) Summary(_ context.Context, _, fromSeq, toSeq int64, at time.Time) (domain.ChannelStatsSummary, error) {
	c := summaryCall{fromSeq, toSeq, at}
	f.summaries = append(f.summaries, c)
	if f.summary == nil {
		return domain.ChannelStatsSummary{}, nil
	}
	return f.summary(c), nil
}
func (f *fakeRepo) NotificationsOn(context.Context, int64, time.Time) (int64, error) {
	return f.notifyOn, nil
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

// Обзор — два окна по 7 дней: текущее (seq выше границы now−7d, участники на
// now) и предыдущее (seq между now−14d и now−7d, участники на now−7d).
func TestChannelStatsOverviewTwoWindows(t *testing.T) {
	now := day("2026-10-14").Add(12 * time.Hour)
	week := domain.StatsWindow
	repo := &fakeRepo{
		typ:  "channel",
		role: domain.RoleCreator,
		seqBefore: func(maxSeq int64, tm time.Time) int64 {
			switch {
			case tm.Equal(now.Add(-week)) && maxSeq == math.MaxInt64:
				return 30
			// Вторая граница ищется ниже первой — скан не заходит в текущее окно.
			case tm.Equal(now.Add(-2*week)) && maxSeq == 30:
				return 10
			}
			t.Fatalf("неожиданная граница %v", tm)
			return 0
		},
		summary: func(c summaryCall) domain.ChannelStatsSummary {
			if c.fromSeq == 30 {
				return domain.ChannelStatsSummary{Members: 9, PostsCount: 4}
			}
			return domain.ChannelStatsSummary{Members: 7, PostsCount: 2}
		},
		notifyOn: 5,
	}
	uc := New(repo)
	uc.now = func() time.Time { return now }

	st, err := uc.ChannelStats(context.Background(), 1, 7)
	if err != nil {
		t.Fatal(err)
	}
	want := []summaryCall{
		{fromSeq: 30, toSeq: math.MaxInt64, at: now},
		{fromSeq: 10, toSeq: 30, at: now.Add(-week)},
	}
	if len(repo.summaries) != 2 || repo.summaries[0] != want[0] || repo.summaries[1] != want[1] {
		t.Fatalf("окна: %+v, ожидалось %+v", repo.summaries, want)
	}
	if st.Summary.Members != 9 || st.Previous.Members != 7 || st.Summary.PostsCount != 4 || st.Previous.PostsCount != 2 {
		t.Fatalf("Summary %+v, Previous %+v", st.Summary, st.Previous)
	}
	if !st.At.Equal(now) || st.NotificationsOn != 5 {
		t.Fatalf("At %v, NotificationsOn %d", st.At, st.NotificationsOn)
	}
}
