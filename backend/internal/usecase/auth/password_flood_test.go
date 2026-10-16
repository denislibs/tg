package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeAttempts — стор неудач облачного пароля с ручными часами: блокировка
// считается по passwordLockFor, как Lua-скрипт Redis-стора (совпадение формул
// проверяет pwattempts_test.go).
type fakeAttempts struct {
	now   func() time.Time
	fails map[[2]int64]int
	until map[[2]int64]time.Time
	// failCalls — сколько раз засчитана неудача (сверка пароля была и не прошла).
	failCalls int
	resets    int
	err       error // ошибка стора для всех методов
}

func newFakeAttempts(now func() time.Time) *fakeAttempts {
	return &fakeAttempts{now: now, fails: map[[2]int64]int{}, until: map[[2]int64]time.Time{}}
}

func (f *fakeAttempts) Locked(_ context.Context, userID, deviceID int64) (time.Duration, error) {
	if f.err != nil {
		return 0, f.err
	}
	left := f.until[[2]int64{userID, deviceID}].Sub(f.now())
	return max(left, 0), nil
}

func (f *fakeAttempts) Fail(_ context.Context, userID, deviceID int64) (int, error) {
	f.failCalls++
	if f.err != nil {
		return 0, f.err
	}
	k := [2]int64{userID, deviceID}
	f.fails[k]++
	if lock := passwordLockFor(f.fails[k]); lock > 0 {
		f.until[k] = f.now().Add(lock)
	}
	return f.fails[k], nil
}

func (f *fakeAttempts) Reset(_ context.Context, userID, deviceID int64) error {
	f.resets++
	if f.err != nil {
		return f.err
	}
	k := [2]int64{userID, deviceID}
	delete(f.fails, k)
	delete(f.until, k)
	return nil
}

type floodFixture struct {
	i      *Interactor
	store  *fakeAttempts
	clock  time.Time
	userID int64
	codes  *fakeCodeRepo
	phone  string
}

func (f *floodFixture) advance(d time.Duration) { f.clock = f.clock.Add(d) }

// newFloodFixture — пользователь с облачным паролем «s3cret» и подключённым
// стором неудач (часы стора — f.clock).
func newFloodFixture(t *testing.T, phone string) *floodFixture {
	t.Helper()
	i, _, _, codes := newInteractor()
	f := &floodFixture{i: i, clock: time.Unix(1_800_000_000, 0), codes: codes, phone: phone}
	f.store = newFakeAttempts(func() time.Time { return f.clock })
	f.userID = registerUser(t, i, phone, "Пароль", "", "dev", "test").User.ID
	if err := i.SetPassword(context.Background(), f.userID, 10, "", "s3cret", "", ""); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	i.SetPasswordAttempts(f.store)
	return f
}

func wantPasswordFlood(t *testing.T, err error, seconds int, what string) {
	t.Helper()
	var flood domain.ErrPasswordFlood
	if !errors.As(err, &flood) || flood.Seconds != seconds {
		t.Fatalf("%s = %v; want ErrPasswordFlood{%d}", what, err, seconds)
	}
}

func TestPasswordLockFor(t *testing.T) {
	for _, c := range []struct {
		f    int
		want time.Duration
	}{
		{0, 0}, {4, 0}, {5, time.Minute}, {6, 2 * time.Minute}, {7, 4 * time.Minute},
		{15, 1024 * time.Minute}, {16, 24 * time.Hour}, {40, 24 * time.Hour}, {1 << 20, 24 * time.Hour},
	} {
		if got := passwordLockFor(c.f); got != c.want {
			t.Errorf("passwordLockFor(%d) = %v, want %v", c.f, got, c.want)
		}
	}
}

// Растущее ожидание (Б-4, В-S2): 4 неудачи — без блокировки, 5-я — 60 с, в
// блокировке сверка не выполняется, после неё 6-я неудача — 120 с, верный
// пароль обнуляет.
func TestPasswordFlood_VerifyGrowsAndResets(t *testing.T) {
	ctx := context.Background()
	f := newFloodFixture(t, "+79990180001")

	for n := 1; n <= 4; n++ {
		if err := f.i.VerifyPassword(ctx, f.userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
			t.Fatalf("неудача %d = %v, want ErrBadPassword", n, err)
		}
		if left, _ := f.store.Locked(ctx, f.userID, 10); left != 0 {
			t.Fatalf("после %d неудач блокировка %v, want 0", n, left)
		}
	}
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("5-я неудача = %v, want ErrBadPassword", err)
	}
	if left, _ := f.store.Locked(ctx, f.userID, 10); left != time.Minute {
		t.Fatalf("после 5-й блокировка %v, want 60s", left)
	}

	// В блокировке — отказ до сверки: и верный пароль не проходит, и счётчик
	// неудач не растёт.
	calls := f.store.failCalls
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "nope"), 60, "в блокировке")
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "s3cret"), 60, "верный в блокировке")
	f.advance(500 * time.Millisecond)
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "nope"), 60, "остаток вверх до целых секунд")
	f.advance(59 * time.Second) // остаток 0,5 с — округляется до 1, не до 0
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "nope"), 1, "последние полсекунды")
	if f.store.failCalls != calls {
		t.Fatalf("в блокировке засчитано неудач: %d", f.store.failCalls-calls)
	}

	f.advance(time.Second)
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("6-я неудача = %v, want ErrBadPassword", err)
	}
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "s3cret"), 120, "после 6-й")

	f.advance(121 * time.Second)
	resets := f.store.resets
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "s3cret"); err != nil {
		t.Fatalf("верный после блокировки = %v", err)
	}
	if f.store.resets != resets+1 || f.store.fails[[2]int64{f.userID, 10}] != 0 {
		t.Fatalf("верный пароль не обнулил счётчик: resets %d→%d, fails %v", resets, f.store.resets, f.store.fails)
	}
	// Счётчик с нуля: новая неудача снова без блокировки.
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("неудача после сброса = %v", err)
	}
	if left, _ := f.store.Locked(ctx, f.userID, 10); left != 0 {
		t.Fatalf("после сброса и одной неудачи блокировка %v", left)
	}
}

// Счётчик общий для трёх ручек; смена и снятие пароля в блокировке — отказ без
// изменения пароля.
func TestPasswordFlood_SharedBySetAndRemove(t *testing.T) {
	ctx := context.Background()
	f := newFloodFixture(t, "+79990180002")

	_ = f.i.VerifyPassword(ctx, f.userID, 10, "nope")
	_ = f.i.VerifyPassword(ctx, f.userID, 10, "nope")
	if err := f.i.SetPassword(ctx, f.userID, 10, "nope", "new", "", ""); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("SetPassword неверный = %v", err)
	}
	if err := f.i.RemovePassword(ctx, f.userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("RemovePassword неверный = %v", err)
	}
	if err := f.i.SetPassword(ctx, f.userID, 10, "nope", "new", "", ""); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("5-я неудача через SetPassword = %v", err)
	}
	wantPasswordFlood(t, f.i.RemovePassword(ctx, f.userID, 10, "s3cret"), 60, "RemovePassword в блокировке")
	wantPasswordFlood(t, f.i.SetPassword(ctx, f.userID, 10, "s3cret", "new", "", ""), 60, "SetPassword в блокировке")
	// Пароль не тронут.
	f.advance(time.Minute)
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "s3cret"); err != nil {
		t.Fatalf("пароль изменился в блокировке: %v", err)
	}
}

// Включение пароля (его ещё нет) — сверять нечего, стор не трогается.
func TestPasswordFlood_SetWithoutPasswordSkipsStore(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	store := newFakeAttempts(time.Now)
	i.SetPasswordAttempts(store)
	userID := registerUser(t, i, "+79990180003", "Пароль", "", "dev", "test").User.ID
	if err := i.SetPassword(ctx, userID, 10, "", "s3cret", "", ""); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	if store.failCalls != 0 || store.resets != 0 {
		t.Fatalf("стор тронут при включении пароля: fail %d reset %d", store.failCalls, store.resets)
	}
}

// Ключ — пара (пользователь, сессия): укравший сессию 10 не запирает владельцу
// проверку пароля из сессии 11.
func TestPasswordFlood_OtherSessionNotLocked(t *testing.T) {
	ctx := context.Background()
	f := newFloodFixture(t, "+79990180004")
	for n := 0; n < 5; n++ {
		_ = f.i.VerifyPassword(ctx, f.userID, 10, "nope")
	}
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "s3cret"), 60, "сессия 10")
	if err := f.i.VerifyPassword(ctx, f.userID, 11, "s3cret"); err != nil {
		t.Fatalf("сессия 11 заперта: %v", err)
	}
	if err := f.i.RemovePassword(ctx, f.userID, 11, "s3cret"); err != nil {
		t.Fatalf("снятие пароля из сессии 11: %v", err)
	}
}

// Без стора (нет Redis) — прежнее поведение: роста нет.
func TestPasswordFlood_NoStore(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	userID := registerUser(t, i, "+79990180005", "Пароль", "", "dev", "test").User.ID
	if err := i.SetPassword(ctx, userID, 10, "", "s3cret", "", ""); err != nil {
		t.Fatal(err)
	}
	for n := 1; n <= 8; n++ {
		if err := i.VerifyPassword(ctx, userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
			t.Fatalf("неудача %d без стора = %v", n, err)
		}
	}
	if err := i.VerifyPassword(ctx, userID, 10, "s3cret"); err != nil {
		t.Fatalf("верный без стора = %v", err)
	}
}

// Сбой стора не запирает: проверка идёт без роста (иначе сбой Redis запер бы
// пароль всем).
func TestPasswordFlood_StoreErrorFailsOpen(t *testing.T) {
	ctx := context.Background()
	f := newFloodFixture(t, "+79990180006")
	f.store.err = errors.New("redis down")
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("неверный при сбое стора = %v", err)
	}
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "s3cret"); err != nil {
		t.Fatalf("верный при сбое стора = %v", err)
	}
}

// signInToPasswordStep — новый вход по коду до шага облачного пароля.
func (f *floodFixture) signInToPasswordStep(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	_ = f.codes.SaveCode(ctx, f.phone, "12345", time.Now().Add(time.Hour))
	res, err := f.i.SignIn(ctx, f.phone, "12345", "dev", "test")
	if err != nil || !res.PasswordNeeded {
		t.Fatalf("SignIn = %+v, %v", res, err)
	}
	return res.PasswordToken
}

// Остаток М1-1 (#467): потолок попыток пароля на ПОЛЬЗОВАТЕЛЯ при входе по
// check_password. Счётчик на токен (5) сжигает токен, но новый токен давал
// новые 5 попыток; теперь неудачи шага входа копятся по (пользователь, 0).
func TestPasswordFlood_CheckPasswordPerUser(t *testing.T) {
	ctx := context.Background()
	f := newFloodFixture(t, "+79990180007")

	tok1 := f.signInToPasswordStep(t)
	for n := 1; n <= 3; n++ {
		if _, err := f.i.CheckPassword(ctx, tok1, "nope", "dev", "test"); !errors.Is(err, domain.ErrBadPassword) {
			t.Fatalf("неудача %d = %v", n, err)
		}
	}
	tok2 := f.signInToPasswordStep(t)
	if _, err := f.i.CheckPassword(ctx, tok2, "nope", "dev", "test"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("4-я неудача = %v", err)
	}
	if _, err := f.i.CheckPassword(ctx, tok2, "nope", "dev", "test"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("5-я неудача (второй токен) = %v", err)
	}
	// Третий токен, верный пароль — пользователь заперт на шаге входа.
	tok3 := f.signInToPasswordStep(t)
	calls := f.store.failCalls
	_, err := f.i.CheckPassword(ctx, tok3, "s3cret", "dev", "test")
	wantPasswordFlood(t, err, 60, "CheckPassword в блокировке")
	if f.store.failCalls != calls {
		t.Fatal("в блокировке засчитана неудача")
	}
	// Сессии пользователя шаг входа не запирает, и наоборот.
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "s3cret"); err != nil {
		t.Fatalf("сессия заперта блокировкой входа: %v", err)
	}

	// Токен в блокировке не сгорел: после неё он же с верным паролем входит.
	f.advance(time.Minute)
	res, err := f.i.CheckPassword(ctx, tok3, "s3cret", "dev", "test")
	if err != nil || res.Token == "" {
		t.Fatalf("вход после блокировки = %+v, %v", res, err)
	}
	if f.store.fails[[2]int64{f.userID, loginAttemptScope}] != 0 {
		t.Fatalf("верный пароль не обнулил счётчик входа: %v", f.store.fails)
	}
}

// Неудачи в сессии не копятся в счётчик входа.
func TestPasswordFlood_SessionFailsDoNotLockLogin(t *testing.T) {
	ctx := context.Background()
	f := newFloodFixture(t, "+79990180008")
	for n := 0; n < 5; n++ {
		_ = f.i.VerifyPassword(ctx, f.userID, 10, "nope")
	}
	tok := f.signInToPasswordStep(t)
	if res, err := f.i.CheckPassword(ctx, tok, "s3cret", "dev", "test"); err != nil || res.Token == "" {
		t.Fatalf("вход заперт неудачами сессии: %+v, %v", res, err)
	}
}
