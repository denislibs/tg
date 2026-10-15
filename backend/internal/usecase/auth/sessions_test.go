package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

var sessionsNow = time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)

// sessionsFixture — пользователь с двумя сессиями: текущая (cur) создана ago
// назад, цель (other) — 30 суток назад. Часы интерактора заморожены.
func sessionsFixture(t *testing.T, ago time.Duration) (i *Interactor, devices *fakeDeviceRepo, userID, cur, other int64) {
	t.Helper()
	i, _, devices, _ = newInteractor()
	i.now = func() time.Time { return sessionsNow }
	ctx := context.Background()
	a := registerUser(t, i, "+70000000101", "Сессии", "", "web", "browser")
	b, err := devices.Create(ctx, domain.Device{UserID: a.User.ID, Name: "old", Platform: "web", TokenHash: "h-other"})
	if err != nil {
		t.Fatal(err)
	}
	set := func(id int64, created time.Time) {
		d := devices.byID[id]
		d.CreatedAt = created
		devices.byID[id] = d
	}
	set(a.Device.ID, sessionsNow.Add(-ago))
	set(b.ID, sessionsNow.Add(-30*24*time.Hour))
	return i, devices, a.User.ID, a.Device.ID, b.ID
}

func TestTerminateSession_FreshCurrent_Forbidden(t *testing.T) {
	i, devices, u, cur, other := sessionsFixture(t, time.Hour)
	_, err := i.TerminateSession(context.Background(), u, cur, other)
	if !errors.Is(err, domain.ErrFreshAuthorization) {
		t.Fatalf("err = %v, want ErrFreshAuthorization", err)
	}
	if _, ok := devices.byID[other]; !ok {
		t.Fatal("цель удалена несмотря на отказ")
	}
}

func TestTerminateSession_ExactlyDay_Allowed(t *testing.T) {
	i, devices, u, cur, other := sessionsFixture(t, domain.FreshAuthorizationPeriod)
	ok, err := i.TerminateSession(context.Background(), u, cur, other)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v, want true,nil (ровно 24 ч — уже можно)", ok, err)
	}
	if _, still := devices.byID[other]; still {
		t.Fatal("цель не удалена")
	}
}

func TestTerminateSession_JustUnderDay_Forbidden(t *testing.T) {
	i, _, u, cur, other := sessionsFixture(t, domain.FreshAuthorizationPeriod-time.Second)
	if _, err := i.TerminateSession(context.Background(), u, cur, other); !errors.Is(err, domain.ErrFreshAuthorization) {
		t.Fatalf("err = %v, want ErrFreshAuthorization", err)
	}
}

func TestTerminateSession_FreshnessCheckedBeforeOwnSession(t *testing.T) {
	ctx := context.Background()
	i, devices, u, cur, _ := sessionsFixture(t, time.Hour)
	if _, err := i.TerminateSession(ctx, u, cur, cur); !errors.Is(err, domain.ErrFreshAuthorization) {
		t.Fatalf("свежая, цель=текущая: err = %v, want ErrFreshAuthorization", err)
	}
	if _, err := i.TerminateSession(ctx, u, cur, 0); !errors.Is(err, domain.ErrFreshAuthorization) {
		t.Fatalf("свежая, цель=0: err = %v, want ErrFreshAuthorization", err)
	}
	d := devices.byID[cur]
	d.CreatedAt = sessionsNow.Add(-48 * time.Hour)
	devices.byID[cur] = d
	if _, err := i.TerminateSession(ctx, u, cur, cur); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("старая, цель=текущая: err = %v, want ErrInvalid", err)
	}
	if _, err := i.TerminateSession(ctx, u, cur, 0); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("старая, цель=0: err = %v, want ErrInvalid", err)
	}
	if _, ok := devices.byID[cur]; !ok {
		t.Fatal("текущая сессия удалена")
	}
}

func TestTerminateSession_MissingTarget_NotRevoked(t *testing.T) {
	i, _, u, cur, _ := sessionsFixture(t, 48*time.Hour)
	ok, err := i.TerminateSession(context.Background(), u, cur, 99999)
	if err != nil || ok {
		t.Fatalf("ok=%v err=%v, want false,nil", ok, err)
	}
}

func TestTerminateSession_MissingCurrent_NotFound(t *testing.T) {
	i, _, u, _, other := sessionsFixture(t, 48*time.Hour)
	_, err := i.TerminateSession(context.Background(), u, 99999, other)
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound (нет строки текущей сессии)", err)
	}
}

func TestTerminateOtherSessions_FreshCurrent_Forbidden(t *testing.T) {
	i, devices, u, cur, other := sessionsFixture(t, 23*time.Hour+59*time.Minute)
	_, err := i.TerminateOtherSessions(context.Background(), u, cur)
	if !errors.Is(err, domain.ErrFreshAuthorization) {
		t.Fatalf("err = %v, want ErrFreshAuthorization", err)
	}
	if _, ok := devices.byID[other]; !ok {
		t.Fatal("прочие сессии удалены несмотря на отказ")
	}
}

func TestTerminateOtherSessions_FreshCurrent_NoOthers_StillForbidden(t *testing.T) {
	i, devices, u, cur, other := sessionsFixture(t, time.Hour)
	delete(devices.byID, other)
	if _, err := i.TerminateOtherSessions(context.Background(), u, cur); !errors.Is(err, domain.ErrFreshAuthorization) {
		t.Fatalf("err = %v, want ErrFreshAuthorization (правило без особых случаев)", err)
	}
}

func TestTerminateOtherSessions_OldCurrent_Allowed(t *testing.T) {
	i, devices, u, cur, other := sessionsFixture(t, 25*time.Hour)
	n, err := i.TerminateOtherSessions(context.Background(), u, cur)
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v, want 1,nil", n, err)
	}
	if _, ok := devices.byID[other]; ok {
		t.Fatal("прочая сессия не удалена")
	}
	if _, ok := devices.byID[cur]; !ok {
		t.Fatal("текущая сессия удалена")
	}
}

func TestTerminateOtherSessions_MissingCurrent_NotFound(t *testing.T) {
	i, _, u, _, _ := sessionsFixture(t, 48*time.Hour)
	if _, err := i.TerminateOtherSessions(context.Background(), u, 99999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

// Выход из своей сессии (POST /auth/logout) правилом не ограничен.
func TestRevokeSession_LogoutIgnoresFreshness(t *testing.T) {
	i, devices, u, cur, _ := sessionsFixture(t, time.Minute)
	ok, err := i.RevokeSession(context.Background(), u, cur)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v, want true,nil", ok, err)
	}
	if _, still := devices.byID[cur]; still {
		t.Fatal("свежая сессия не вышла")
	}
}

func TestIsFreshSession(t *testing.T) {
	i, _, u, cur, other := sessionsFixture(t, time.Hour)
	ctx := context.Background()
	if fresh, err := i.IsFreshSession(ctx, u, cur); err != nil || !fresh {
		t.Fatalf("cur: fresh=%v err=%v, want true,nil", fresh, err)
	}
	if fresh, err := i.IsFreshSession(ctx, u, other); err != nil || fresh {
		t.Fatalf("other: fresh=%v err=%v, want false,nil", fresh, err)
	}
	if _, err := i.IsFreshSession(ctx, u, 99999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("missing: err = %v, want ErrNotFound", err)
	}
}
