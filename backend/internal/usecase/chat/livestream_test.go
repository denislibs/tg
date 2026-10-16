package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeLivestreamRepo — in-memory LivestreamRepo для тестов.
type fakeLivestreamRepo struct {
	rows map[int64]domain.Livestream
}

func newFakeLivestreamRepo() *fakeLivestreamRepo {
	return &fakeLivestreamRepo{rows: map[int64]domain.Livestream{}}
}

func (r *fakeLivestreamRepo) Get(_ context.Context, chatID int64) (domain.Livestream, error) {
	ls, ok := r.rows[chatID]
	if !ok {
		return domain.Livestream{}, domain.ErrNotFound
	}
	return ls, nil
}

func (r *fakeLivestreamRepo) Upsert(_ context.Context, ls domain.Livestream) error {
	r.rows[ls.ChatID] = ls
	return nil
}

func (r *fakeLivestreamRepo) ActiveAmong(_ context.Context, chatIDs []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range chatIDs {
		if r.rows[id].Active {
			out[id] = true
		}
	}
	return out, nil
}

func newLivestreamTestInteractor(t *testing.T) (*Interactor, *fakeGroupRepo, *fakeLivestreamRepo) {
	t.Helper()
	i, fg, _, _ := newChannelTestInteractor(t)
	fls := newFakeLivestreamRepo()
	i.SetLivestreams(fls, "rtmp://test/live")
	return i, fg, fls
}

func TestStartLivestream_NonAdminForbidden(t *testing.T) {
	i, fg, _ := newLivestreamTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_ = fg.AddMember(context.Background(), ch, 8, domain.RoleSubscriber, 0)

	if _, err := i.StartLivestream(context.Background(), ch, 8); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("subscriber StartLivestream = %v, want ErrForbidden", err)
	}
}

func TestStartLivestream_CreatorGetsCreds(t *testing.T) {
	i, _, _ := newLivestreamTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)

	st, err := i.StartLivestream(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("StartLivestream: %v", err)
	}
	if !st.Active || !st.IsAdmin {
		t.Fatalf("state = %+v, want active admin", st)
	}
	if st.RTMPURL != "rtmp://test/live" || st.StreamKey == "" {
		t.Fatalf("creds = %q / %q, want url+key", st.RTMPURL, st.StreamKey)
	}
	if st.StartedAt == nil {
		t.Fatal("StartedAt is nil after start")
	}
}

func TestLivestreamStatus_HidesKeyFromViewer(t *testing.T) {
	i, fg, _ := newLivestreamTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_ = fg.AddMember(context.Background(), ch, 8, domain.RoleSubscriber, 0)
	if _, err := i.StartLivestream(context.Background(), ch, 7); err != nil {
		t.Fatalf("StartLivestream: %v", err)
	}

	// зритель видит активность, но не креды
	st, err := i.LivestreamStatus(context.Background(), ch, 8)
	if err != nil {
		t.Fatalf("LivestreamStatus(viewer): %v", err)
	}
	if !st.Active {
		t.Fatal("viewer sees inactive stream")
	}
	if st.IsAdmin || st.StreamKey != "" || st.RTMPURL != "" {
		t.Fatalf("viewer leaked creds: %+v", st)
	}

	// админ видит креды
	st, err = i.LivestreamStatus(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("LivestreamStatus(admin): %v", err)
	}
	if !st.IsAdmin || st.StreamKey == "" {
		t.Fatalf("admin missing creds: %+v", st)
	}
}

func TestStopLivestream_Deactivates(t *testing.T) {
	i, _, _ := newLivestreamTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	if _, err := i.StartLivestream(context.Background(), ch, 7); err != nil {
		t.Fatalf("StartLivestream: %v", err)
	}
	if err := i.StopLivestream(context.Background(), ch, 7); err != nil {
		t.Fatalf("StopLivestream: %v", err)
	}
	st, err := i.LivestreamStatus(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if st.Active || st.StartedAt != nil {
		t.Fatalf("still active after stop: %+v", st)
	}
}

func TestRevokeStreamKey_ChangesKeyKeepsActive(t *testing.T) {
	i, _, _ := newLivestreamTestInteractor(t)
	ch, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	start, err := i.StartLivestream(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("StartLivestream: %v", err)
	}
	rev, err := i.RevokeStreamKey(context.Background(), ch, 7)
	if err != nil {
		t.Fatalf("RevokeStreamKey: %v", err)
	}
	if rev.StreamKey == "" || rev.StreamKey == start.StreamKey {
		t.Fatalf("key not rotated: %q -> %q", start.StreamKey, rev.StreamKey)
	}
	if !rev.Active {
		t.Fatal("revoke should not stop the stream")
	}
}

// Счётчик «смотрят» (статус эфира и group_call_update.size) считает и зрителей: Participants — только mesh.
func TestLivestream_ViewerCountIncludesViewers(t *testing.T) {
	i, fg, _ := newLivestreamTestInteractor(t)
	i.SetGroupCalls(newFakeCallStore(newFakeClock()))
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	for uid := int64(8); uid <= 10; uid++ {
		_ = fg.AddMember(ctx, ch, uid, domain.RoleSubscriber, 0)
	}
	if _, err := i.StartLivestream(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	for uid := int64(8); uid <= 10; uid++ {
		if err := i.JoinGroupCallAsViewer(ctx, ch, uid); err != nil {
			t.Fatal(err)
		}
	}
	st, err := i.LivestreamStatus(ctx, ch, 7)
	if err != nil || st.Viewers != 3 {
		t.Fatalf("статус эфира: Viewers=%d err=%v, want 3", st.Viewers, err)
	}
}
