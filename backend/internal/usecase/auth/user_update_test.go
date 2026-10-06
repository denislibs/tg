package auth

import (
	"context"
	"encoding/json"
	"github.com/messenger-denis/backend/internal/domain"
	"testing"
)

// fakeUpdateLog — in-memory per-user update log (dense pts).
type fakeUpdateLog struct {
	pts      map[int64]int64
	rows     map[int64][]string          // userID -> types appended
	payloads map[int64][]json.RawMessage // userID -> logged bodies
}

func newFakeUpdateLog() *fakeUpdateLog {
	return &fakeUpdateLog{pts: map[int64]int64{}, rows: map[int64][]string{}, payloads: map[int64][]json.RawMessage{}}
}

func (l *fakeUpdateLog) AppendUpdate(_ context.Context, userID int64, ptsCount int, _ int64, typ string, payload json.RawMessage) (int64, error) {
	l.pts[userID] += int64(ptsCount)
	l.rows[userID] = append(l.rows[userID], typ)
	l.payloads[userID] = append(l.payloads[userID], payload)
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

// fakeContactViewer — книги зрителей: viewerID → как он видит пользователя.
type fakeContactViewer map[int64]domain.ContactView

func (f fakeContactViewer) ContactViews(_ context.Context, _ int64, viewerIDs []int64) (map[int64]domain.ContactView, error) {
	out := map[int64]domain.ContactView{}
	for _, id := range viewerIDs {
		if v, ok := f[id]; ok {
			out[id] = v
		}
	}
	return out, nil
}

// Кадр user_update и его строка журнала (её переигрывает /sync) — карточка
// ГЛАЗАМИ ПОЛУЧАТЕЛЯ: тот, у кого автор в книге, получает имя из книги и
// pFlags.contact, остальные — профильное имя. Иначе смена профиля затирала
// бы у клиента имя контакта (у оригинала сервер отдаёт user с именем из
// книги смотрящего в любом ответе и апдейте).
func TestUserUpdate_SeenByEachRecipient(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000003", "Боб", "Петров")

	log := newFakeUpdateLog()
	pub := newFakeAuthPub()
	i.SetUpdateLog(log)
	i.SetPublisher(pub)
	const friend, stranger int64 = 999, 998
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return []int64{friend, stranger}, nil })
	i.SetContactViewer(fakeContactViewer{friend: {Contact: true, FirstName: "Бобби"}})

	if _, err := i.UpdateProfile(ctx, u.ID, ProfileInput{FirstName: "Борис", LastName: "Петров"}); err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}

	card := func(raw []byte, inEnvelope bool) domain.UserReal {
		t.Helper()
		var body struct {
			User domain.UserReal `json:"user"`
		}
		if inEnvelope {
			var env struct {
				D json.RawMessage `json:"d"`
			}
			if err := json.Unmarshal(raw, &env); err != nil {
				t.Fatalf("unmarshal frame: %v", err)
			}
			raw = env.D
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatalf("unmarshal body: %v", err)
		}
		return body.User
	}
	for _, c := range []struct {
		uid     int64
		first   string
		last    string
		contact bool
		self    bool
	}{
		{friend, "Бобби", "", true, false},
		{stranger, "Борис", "Петров", false, false},
		{u.ID, "Борис", "Петров", false, true},
	} {
		for name, got := range map[string]domain.UserReal{
			"кадр":   card(pub.frames[c.uid][0], true),
			"журнал": card(log.payloads[c.uid][0], false),
		} {
			if got.FirstName != c.first || got.LastName != c.last || got.ContactRecord() != c.contact || got.Self() != c.self {
				t.Errorf("%s для %d: %q %q %v, want %q %q contact=%v self=%v",
					name, c.uid, got.FirstName, got.LastName, got.PFlags, c.first, c.last, c.contact, c.self)
			}
		}
	}
}

// A2-04: строка журнала user_update — та же карточка, что живой кадр, с фото
// по правилу на момент записи. Прежде журнал писал «фото нет», клиент
// заменял карточку целиком, и после /sync аватарка стиралась — в том числе
// своя на втором устройстве.
func TestUserUpdate_JournalKeepsPhoto(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000004", "Аня", "")
	log := newFakeUpdateLog()
	i.SetUpdateLog(log)
	i.SetPublisher(newFakeAuthPub())
	if _, err := i.SetAvatar(ctx, u.ID, 555); err != nil {
		t.Fatalf("SetAvatar: %v", err)
	}
	rows := log.payloads[u.ID]
	if len(rows) == 0 {
		t.Fatal("журнал владельца пуст")
	}
	var body struct {
		User struct {
			Photo map[string]any `json:"photo"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rows[len(rows)-1], &body); err != nil {
		t.Fatal(err)
	}
	if body.User.Photo["_"] != domain.UserProfilePhotoTag {
		t.Fatalf("фото в строке журнала = %v, want userProfilePhoto", body.User.Photo)
	}
}
