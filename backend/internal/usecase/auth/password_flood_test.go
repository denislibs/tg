package auth

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// passwordLockFor — блокировка после f-й попытки подряд (0 — без неё): формула
// В-S2 из констант, по ней считает фейк-стор (Lua Redis-стора проверяет
// pwattempts_test.go на тех же числах).
func passwordLockFor(f int) time.Duration {
	if f < PasswordFreeFails {
		return 0
	}
	// 2^11 минут уже больше суток; больший сдвиг переполнил бы time.Duration.
	return min(PasswordLockBase<<min(f-PasswordFreeFails, 11), PasswordLockMax)
}

type attemptKey struct {
	userID, deviceID int64
	version          string
}

// fakeAttempts — стор попыток облачного пароля с ручными часами, повторяет
// семантику Redis-стора: Acquire атомарно проверяет блокировку и засчитывает
// попытку.
type fakeAttempts struct {
	mu      sync.Mutex
	now     func() time.Time
	fails   map[attemptKey]int
	expires map[attemptKey]time.Time
	until   map[attemptKey]time.Time
	// acquired — сколько попыток пропущено к сверке.
	acquired int
	resets   int
	err      error // ошибка стора для всех методов
}

func newFakeAttempts(now func() time.Time) *fakeAttempts {
	return &fakeAttempts{now: now, fails: map[attemptKey]int{}, expires: map[attemptKey]time.Time{}, until: map[attemptKey]time.Time{}}
}

func (f *fakeAttempts) Acquire(_ context.Context, userID, deviceID int64, version string) (time.Duration, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return 0, f.err
	}
	k := attemptKey{userID, deviceID, version}
	now := f.now()
	if left := f.until[k].Sub(now); left > 0 {
		return left, nil
	}
	if !f.expires[k].After(now) {
		f.fails[k] = 0
	}
	f.fails[k]++
	lock := passwordLockFor(f.fails[k])
	if lock > 0 {
		f.until[k] = now.Add(lock)
	}
	f.expires[k] = now.Add(lock + PasswordFailWindow)
	f.acquired++
	return 0, nil
}

func (f *fakeAttempts) Reset(_ context.Context, userID, deviceID int64, version string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resets++
	if f.err != nil {
		return f.err
	}
	k := attemptKey{userID, deviceID, version}
	delete(f.fails, k)
	delete(f.expires, k)
	delete(f.until, k)
	return nil
}

// left — остаток блокировки пары (по любой версии пароля).
func (f *fakeAttempts) left(userID, deviceID int64) time.Duration {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out time.Duration
	for k, t := range f.until {
		if k.userID == userID && k.deviceID == deviceID {
			out = max(out, t.Sub(f.now()))
		}
	}
	return out
}

// count — счётчик попыток пары (по любой версии пароля).
func (f *fakeAttempts) count(userID, deviceID int64) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for k, c := range f.fails {
		if k.userID == userID && k.deviceID == deviceID {
			n += c
		}
	}
	return n
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
		{15, 1024 * time.Minute}, {16, 24 * time.Hour}, {33, 24 * time.Hour}, {34, 24 * time.Hour},
		{40, 24 * time.Hour}, {1 << 20, 24 * time.Hour},
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
		if left := f.store.left(f.userID, 10); left != 0 {
			t.Fatalf("после %d неудач блокировка %v, want 0", n, left)
		}
	}
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("5-я неудача = %v, want ErrBadPassword", err)
	}
	if left := f.store.left(f.userID, 10); left != time.Minute {
		t.Fatalf("после 5-й блокировка %v, want 60s", left)
	}

	// В блокировке — отказ до сверки: и верный пароль не проходит, и счётчик
	// неудач не растёт.
	calls := f.store.acquired
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "nope"), 60, "в блокировке")
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "s3cret"), 60, "верный в блокировке")
	f.advance(500 * time.Millisecond)
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "nope"), 60, "остаток вверх до целых секунд")
	f.advance(59 * time.Second) // остаток 0,5 с — округляется до 1, не до 0
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "nope"), 1, "последние полсекунды")
	if f.store.acquired != calls {
		t.Fatalf("в блокировке пропущено к сверке: %d", f.store.acquired-calls)
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
	if f.store.resets != resets+1 || f.store.count(f.userID, 10) != 0 {
		t.Fatalf("верный пароль не обнулил счётчик: resets %d→%d, fails %v", resets, f.store.resets, f.store.fails)
	}
	// Счётчик с нуля: новая неудача снова без блокировки.
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("неудача после сброса = %v", err)
	}
	if left := f.store.left(f.userID, 10); left != 0 {
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
	if store.acquired != 0 || store.resets != 0 {
		t.Fatalf("стор тронут при включении пароля: acquire %d reset %d", store.acquired, store.resets)
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
	calls := f.store.acquired
	_, err := f.i.CheckPassword(ctx, tok3, "s3cret", "dev", "test")
	wantPasswordFlood(t, err, 60, "CheckPassword в блокировке")
	if f.store.acquired != calls {
		t.Fatal("в блокировке попытка пропущена к сверке")
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
	if f.store.count(f.userID, loginAttemptScope) != 0 {
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

// Смена пароля начинает счёт заново во всех областях: накопленное против
// старого пароля (в другой сессии и на шаге входа) на новый не переносится.
func TestPasswordFlood_PasswordChangeStartsOver(t *testing.T) {
	ctx := context.Background()
	f := newFloodFixture(t, "+79990180009")
	for n := 0; n < 5; n++ {
		_ = f.i.VerifyPassword(ctx, f.userID, 10, "nope")
	}
	tok := f.signInToPasswordStep(t)
	for n := 0; n < 4; n++ {
		_, _ = f.i.CheckPassword(ctx, tok, "nope", "dev", "test")
	}
	wantPasswordFlood(t, f.i.VerifyPassword(ctx, f.userID, 10, "s3cret"), 60, "сессия 10 до смены")

	if err := f.i.SetPassword(ctx, f.userID, 11, "s3cret", "n3w", "", ""); err != nil {
		t.Fatalf("смена пароля из сессии 11: %v", err)
	}
	// Сессия 10 свободна, неудача против нового пароля — первая, без блокировки.
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "nope"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("сессия 10 после смены = %v", err)
	}
	if err := f.i.VerifyPassword(ctx, f.userID, 10, "n3w"); err != nil {
		t.Fatalf("новый пароль в сессии 10 = %v", err)
	}
	// Шаг входа: четыре старые неудачи не в счёт — одна опечатка не запирает.
	tok2 := f.signInToPasswordStep(t)
	if _, err := f.i.CheckPassword(ctx, tok2, "nope", "dev", "test"); !errors.Is(err, domain.ErrBadPassword) {
		t.Fatalf("опечатка после смены = %v", err)
	}
	if res, err := f.i.CheckPassword(ctx, tok2, "n3w", "dev", "test"); err != nil || res.Token == "" {
		t.Fatalf("вход новым паролем = %+v, %v", res, err)
	}
}

// Вход, одобренный сессией (веб-токен, QR), считается отдельно от входа по
// SMS: укравший сессию, выпуская себе веб-токены, не запирает владельцу вход по
// коду, и наоборот.
func TestPasswordFlood_ApprovedLoginSeparateScope(t *testing.T) {
	ctx := context.Background()
	f := newFloodFixture(t, "+79990180010")
	webStep := func() string {
		t.Helper()
		raw, _, err := f.i.NewWebAuthToken(ctx, f.userID)
		if err != nil {
			t.Fatal(err)
		}
		res, err := f.i.SignImport(ctx, raw, "desktop", "web")
		if err != nil || !res.PasswordNeeded {
			t.Fatalf("SignImport = %+v, %v", res, err)
		}
		return res.PasswordToken
	}
	tok := webStep()
	for n := 0; n < 4; n++ {
		_, _ = f.i.CheckPassword(ctx, tok, "nope", "desktop", "web")
	}
	tok = webStep()
	_, _ = f.i.CheckPassword(ctx, tok, "nope", "desktop", "web")
	_, err := f.i.CheckPassword(ctx, webStep(), "s3cret", "desktop", "web")
	wantPasswordFlood(t, err, 60, "вход по веб-токену заперт")

	// Вход по SMS-коду не заперт.
	if res, err := f.i.CheckPassword(ctx, f.signInToPasswordStep(t), "s3cret", "dev", "test"); err != nil || res.Token == "" {
		t.Fatalf("вход по коду заперт веб-токенами: %+v, %v", res, err)
	}
}
