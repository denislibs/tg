package auth

import (
	"context"
	"encoding/json"
	"github.com/messenger-denis/backend/internal/domain"
	"testing"
)

// fakeUpdateLog — in-memory per-user update log (dense pts).
type fakeUpdateLog struct {
	pts  map[int64]int64
	rows map[int64][]string // userID -> types appended
}

func newFakeUpdateLog() *fakeUpdateLog {
	return &fakeUpdateLog{pts: map[int64]int64{}, rows: map[int64][]string{}}
}

func (l *fakeUpdateLog) AppendUpdate(_ context.Context, userID int64, ptsCount int, _ int64, typ string, _ json.RawMessage) (int64, error) {
	l.pts[userID] += int64(ptsCount)
	l.rows[userID] = append(l.rows[userID], typ)
	return l.pts[userID], nil
}

// fakeAuthPub captures user_update frames per user.
type fakeAuthPub struct{ frames map[int64][][]byte }

func newFakeAuthPub() *fakeAuthPub { return &fakeAuthPub{frames: map[int64][][]byte{}} }

func (p *fakeAuthPub) PublishToUser(_ context.Context, userID int64, frame []byte) error {
	p.frames[userID] = append(p.frames[userID], frame)
	return nil
}

// A profile change logs user_update to the owner's own devices AND to shared-chat
// peers, each with a dense pts; the live frame carries that same pts.
func TestUserUpdate_LoggedToOwnAndPeers(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000001", "Пользователь", "")

	log := newFakeUpdateLog()
	pub := newFakeAuthPub()
	i.SetUpdateLog(log)
	i.SetPublisher(pub)
	const peer int64 = 999
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return []int64{peer}, nil })

	if _, err := i.UpdateProfile(ctx, u.ID, ProfileInput{FirstName: "Denis"}); err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}

	for _, uid := range []int64{u.ID, peer} {
		if len(log.rows[uid]) != 1 || log.rows[uid][0] != "user_update" {
			t.Fatalf("log rows for %d = %v; want one user_update", uid, log.rows[uid])
		}
		frames := pub.frames[uid]
		if len(frames) != 1 {
			t.Fatalf("frames for %d = %d; want 1", uid, len(frames))
		}
		var env struct {
			T   string         `json:"t"`
			D   map[string]any `json:"d"`
			Pts *float64       `json:"pts"`
		}
		if err := json.Unmarshal(frames[0], &env); err != nil {
			t.Fatalf("unmarshal frame: %v", err)
		}
		if env.T != "user_update" {
			t.Fatalf("frame type for %d = %q; want user_update", uid, env.T)
		}
		// Тело — КОНСТРУКТОР с карточкой внутри; своего pts у него нет, поэтому
		// курсор едет в КОНВЕРТЕ (см. domain.UpdateDeclaresPts).
		if env.D["_"] != domain.UpdateUserSnapshotTag {
			t.Fatalf("frame body for %d = %v; want %s", uid, env.D["_"], domain.UpdateUserSnapshotTag)
		}
		if _, stray := env.D["pts"]; stray {
			t.Fatalf("курсор попал в тело конструктора без параметра pts: %#v", env.D)
		}
		if env.Pts == nil || int64(*env.Pts) != log.pts[uid] {
			t.Fatalf("frame pts for %d = %v; want logged pts %d", uid, env.Pts, log.pts[uid])
		}
	}
}

// Without an update log the fan-out still publishes (pts-less, back-compat) and
// without a publisher it still logs — neither path panics.
func TestUserUpdate_DegradesWithoutDeps(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000002", "Пользователь", "")

	// publisher only, no update log.
	pub := newFakeAuthPub()
	i.SetPublisher(pub)
	if _, err := i.UpdateProfile(ctx, u.ID, ProfileInput{FirstName: "A"}); err != nil {
		t.Fatalf("UpdateProfile (pub only): %v", err)
	}
	if len(pub.frames[u.ID]) != 1 {
		t.Fatalf("own frame not published without update log")
	}
}
