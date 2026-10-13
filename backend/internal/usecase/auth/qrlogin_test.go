package auth

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeQRStore — QRStore в памяти: запись по хешу ключа входа и указатель
// «хеш кода → хеш ключа». Все методы под мьютексом: гонки Accept проверяются
// под -race, и атомарность ClaimToken (GETDEL) здесь — свойство самого фейка.
type fakeQRStore struct {
	mu      sync.Mutex
	byKey   map[string]domain.QRLogin
	tok     map[string]string
	failPut bool // PutByKey падает (сбой Redis после выпуска сессии)
}

func newFakeQRStore() *fakeQRStore {
	return &fakeQRStore{byKey: map[string]domain.QRLogin{}, tok: map[string]string{}}
}

func (s *fakeQRStore) GetByKey(_ context.Context, keyHash string) (domain.QRLogin, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.byKey[keyHash]
	if !ok {
		return domain.QRLogin{}, domain.ErrNotFound
	}
	return r, nil
}

func (s *fakeQRStore) Create(_ context.Context, keyHash, tokenHash string, rec domain.QRLogin, _ time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.byKey[keyHash]; ok {
		return false, nil
	}
	s.byKey[keyHash] = rec
	s.tok[tokenHash] = keyHash
	return true, nil
}

func (s *fakeQRStore) PeekToken(_ context.Context, tokenHash string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.tok[tokenHash]
	if !ok {
		return "", domain.ErrNotFound
	}
	return k, nil
}

func (s *fakeQRStore) ClaimToken(_ context.Context, tokenHash string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.tok[tokenHash]
	if !ok {
		return "", domain.ErrNotFound
	}
	delete(s.tok, tokenHash)
	return k, nil
}

func (s *fakeQRStore) PutByKey(_ context.Context, keyHash string, rec domain.QRLogin, _ time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failPut {
		return errors.New("redis down")
	}
	s.byKey[keyHash] = rec
	return nil
}

func (s *fakeQRStore) DeleteByKey(_ context.Context, keyHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.byKey, keyHash)
	return nil
}

// errPasswordRepo — репозиторий пароля, у которого чтение падает (сбой БД).
type errPasswordRepo struct{ *fakePasswordRepo }

func (errPasswordRepo) Password(context.Context, int64) (*string, string, string, error) {
	return nil, "", "", errors.New("db down")
}

func qrInteractor(t *testing.T) (*Interactor, *fakeDeviceRepo, *fakeQRStore, *fakeCodeRepo) {
	t.Helper()
	i, _, devices, codes := newInteractor()
	store := newFakeQRStore()
	i.SetQRStore(store)
	return i, devices, store, codes
}

func qrUser(t *testing.T, i *Interactor, phone string) domain.UserRecord {
	t.Helper()
	return registerUser(t, i, phone, "Имя", "", "dev", "test").User
}

func devicesOf(t *testing.T, d *fakeDeviceRepo, userID int64) int {
	t.Helper()
	list, _ := d.ListByUser(context.Background(), userID)
	return len(list)
}

func mustPending(t *testing.T, r ExportResult, err error) *QRPendingCode {
	t.Helper()
	if err != nil || r.Pending == nil || r.Session != nil || r.Password != nil {
		t.Fatalf("ожидался Pending, получено %+v, err=%v", r, err)
	}
	return r.Pending
}

// Код привязан к ключу входа: повторный опрос тем же ключом — тот же код и тот же
// срок, другим ключом — другой код.
func TestQR_ExportIsBoundToLoginKey(t *testing.T) {
	i, _, _, _ := qrInteractor(t)
	ctx := context.Background()

	r1, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	a1 := mustPending(t, r1, err)
	r2, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	a2 := mustPending(t, r2, err)
	if a1.Token != a2.Token || !a1.ExpiresAt.Equal(a2.ExpiresAt) || len(a1.Token) != 64 {
		t.Fatalf("повторный опрос того же ключа: %+v / %+v", a1, a2)
	}
	r3, err := i.ExportLoginToken(ctx, "keyB", nil, "web")
	b := mustPending(t, r3, err)
	if b.Token == a1.Token {
		t.Fatal("другой ключ получил тот же код")
	}
}

// Подтверждённую сессию забирает ТОЛЬКО экспортёр с тем же ключом, и один раз;
// посторонний с тем же кодом (кто увидел QR) ничего не получает.
func TestQR_AcceptThenExportOnce(t *testing.T) {
	i, devices, _, _ := qrInteractor(t)
	ctx := context.Background()
	user := qrUser(t, i, "+79990030001")
	before := devicesOf(t, devices, user.ID)

	r, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	code := mustPending(t, r, err)

	authz, err := i.AcceptLoginToken(ctx, code.Token, user)
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if devicesOf(t, devices, user.ID) != before+1 {
		t.Fatal("строка сессии не создана")
	}
	if authz.Hash == 0 || authz.PFlags["password_pending"] {
		t.Fatalf("authorization = %+v, ожидалась новая сессия с hash=id", authz)
	}

	// Посторонний ключ — по-прежнему ждущий код, сессии нет.
	rb, err := i.ExportLoginToken(ctx, "keyB", nil, "web")
	b := mustPending(t, rb, err)
	if b.Token == code.Token {
		t.Fatal("посторонний ключ получил чужой код")
	}

	// Владелец ключа — сессия.
	ra, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	if err != nil || ra.Session == nil || ra.Session.Token == "" || ra.Session.User.ID != user.ID {
		t.Fatalf("Export(keyA) после Accept = %+v, err=%v", ra, err)
	}
	if _, _, err := i.Authenticate(ctx, ra.Session.Token); err != nil {
		t.Fatalf("выданный токен не аутентифицирует: %v", err)
	}

	// Второй опрос — уже новый код, а не вторая выдача.
	rn, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	n := mustPending(t, rn, err)
	if n.Token == code.Token {
		t.Fatal("после выдачи ключ получил старый код")
	}
}

// Облачный пароль: Accept не выпускает сессию, ответ — authorization с
// password_pending и hash 0; экспортёр получает passwordNeeded, а токен шага
// пароля выпускает сессию.
func TestQR_PasswordStepNoSession(t *testing.T) {
	i, devices, _, codes := qrInteractor(t)
	ctx := context.Background()
	uid, _ := twoFactorLogin(t, i, codes, "+79990030002", "")
	user, _ := i.users.GetByID(ctx, uid)
	before := devicesOf(t, devices, uid)

	r, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	code := mustPending(t, r, err)

	authz, err := i.AcceptLoginToken(ctx, code.Token, user)
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if authz.Hash != 0 || !authz.PFlags["password_pending"] || authz.PFlags["current"] {
		t.Fatalf("authorization = %+v, ожидался password_pending и hash 0", authz)
	}
	if devicesOf(t, devices, uid) != before {
		t.Fatal("сессия выпущена до ввода пароля")
	}

	re, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	if err != nil || re.Password == nil || !re.Password.PasswordNeeded || re.Password.PasswordToken == "" {
		t.Fatalf("Export(keyA) = %+v, err=%v; ожидался шаг пароля", re, err)
	}
	if devicesOf(t, devices, uid) != before {
		t.Fatal("сессия выпущена на шаге пароля")
	}
	res, err := i.CheckPassword(ctx, re.Password.PasswordToken, "s3cret", "dev", "test")
	if err != nil || res.Token == "" {
		t.Fatalf("CheckPassword = %+v, err=%v", res, err)
	}
}

func TestQR_AcceptUnknownExpiredRepeated(t *testing.T) {
	i, _, _, _ := qrInteractor(t)
	ctx := context.Background()
	user := qrUser(t, i, "+79990030003")

	if _, err := i.AcceptLoginToken(ctx, "deadbeef", user); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("неизвестный код = %v, want ErrNotFound", err)
	}
	r, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	code := mustPending(t, r, err)
	if _, err := i.AcceptLoginToken(ctx, code.Token, user); err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if _, err := i.AcceptLoginToken(ctx, code.Token, user); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("повторный Accept = %v, want ErrNotFound", err)
	}
}

// except_ids: аккаунт, уже вошедший на экспортирующем устройстве, получает отказ и
// не сжигает код; другой аккаунт тем же кодом входит.
func TestQR_AcceptExceptID(t *testing.T) {
	i, devices, store, _ := qrInteractor(t)
	ctx := context.Background()
	u7 := qrUser(t, i, "+79990030004")
	u9 := qrUser(t, i, "+79990030005")

	r, err := i.ExportLoginToken(ctx, "keyA", []int64{u7.ID}, "web")
	code := mustPending(t, r, err)

	if _, err := i.AcceptLoginToken(ctx, code.Token, u7); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("except-аккаунт = %v, want ErrNotFound", err)
	}
	if devicesOf(t, devices, u7.ID) != 1 { // только вход при регистрации
		t.Fatal("сессия выпущена аккаунту из except_ids")
	}
	rec, err := store.GetByKey(ctx, "keyA")
	if err != nil || rec.Status != domain.QRPending {
		t.Fatalf("запись изменилась: %+v, err=%v", rec, err)
	}
	if _, err := store.PeekToken(ctx, domain.HashToken(code.Token)); err != nil {
		t.Fatalf("указатель кода снят отказом: %v", err)
	}
	if _, err := i.AcceptLoginToken(ctx, code.Token, u9); err != nil {
		t.Fatalf("другой аккаунт тем же кодом: %v", err)
	}
}

// Пароль сняли, пока экспортёр не опросил: сессия выпускается пользователю
// записи (а не нулевому).
func TestQR_PasswordRemovedWhileWaiting(t *testing.T) {
	i, devices, _, codes := qrInteractor(t)
	ctx := context.Background()
	uid, _ := twoFactorLogin(t, i, codes, "+79990030006", "")
	user, _ := i.users.GetByID(ctx, uid)

	r, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	code := mustPending(t, r, err)
	if _, err := i.AcceptLoginToken(ctx, code.Token, user); err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if err := i.pw.SetPassword(ctx, uid, nil, "", ""); err != nil {
		t.Fatal(err)
	}
	before := devicesOf(t, devices, uid)
	re, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	if err != nil || re.Session == nil || re.Session.User.ID != uid || re.Session.Token == "" {
		t.Fatalf("Export = %+v, err=%v; ожидалась сессия пользователя записи", re, err)
	}
	if devicesOf(t, devices, uid) != before+1 {
		t.Fatal("строка сессии не создана")
	}
	if re.Session.Device.ID == 0 {
		t.Fatal("SignInResult.Device не заполнен mintSession")
	}
}

// Сбой записи после выпуска сессии: сессия отзывается, а не висит с токеном,
// который никому не дошёл.
func TestQR_PutAfterMintFailsRevokes(t *testing.T) {
	i, devices, store, _ := qrInteractor(t)
	ctx := context.Background()
	user := qrUser(t, i, "+79990030007")
	before := devicesOf(t, devices, user.ID)

	r, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	code := mustPending(t, r, err)
	store.failPut = true
	if _, err := i.AcceptLoginToken(ctx, code.Token, user); err == nil {
		t.Fatal("ожидалась ошибка")
	}
	if devicesOf(t, devices, user.ID) != before {
		t.Fatal("висячая сессия после сбоя записи")
	}
	// Карточка следующим опросом получает новый код.
	store.failPut = false
	rn, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	n := mustPending(t, rn, err)
	if n.Token == code.Token {
		t.Fatal("после сбоя остался старый код")
	}
}

func TestQR_ConcurrentFirstExport(t *testing.T) {
	i, _, _, _ := qrInteractor(t)
	ctx := context.Background()
	const n = 8
	tokens := make([]string, n)
	var wg sync.WaitGroup
	for k := 0; k < n; k++ {
		wg.Add(1)
		go func(k int) {
			defer wg.Done()
			r, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
			if err == nil && r.Pending != nil {
				tokens[k] = r.Pending.Token
			}
		}(k)
	}
	wg.Wait()
	for k := 1; k < n; k++ {
		if tokens[k] == "" || tokens[k] != tokens[0] {
			t.Fatalf("токены %v: ожидался один и тот же", tokens)
		}
	}
}

// Сбой чтения пароля — отказ, а не «пароля нет». Ни QR, ни обычный вход
// не выдают сессию без второго фактора по сбою БД.
func TestQR_PasswordReadErrorFailsClosed(t *testing.T) {
	i, devices, store, codes := qrInteractor(t)
	ctx := context.Background()
	uid, _ := twoFactorLogin(t, i, codes, "+79990030008", "")
	user, _ := i.users.GetByID(ctx, uid)
	i.pw = errPasswordRepo{newFakePasswordRepo()}
	before := devicesOf(t, devices, uid)

	r, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	code := mustPending(t, r, err)
	if _, err := i.AcceptLoginToken(ctx, code.Token, user); err == nil {
		t.Fatal("Accept при сбое чтения пароля прошёл")
	}
	if devicesOf(t, devices, uid) != before {
		t.Fatal("сессия выпущена при сбое чтения пароля")
	}
	if rec, err := store.GetByKey(ctx, "keyA"); err != nil || rec.Status != domain.QRPending {
		t.Fatalf("запись изменилась: %+v, err=%v", rec, err)
	}

	_ = codes.SaveCode(ctx, "+79990030008", "12345", time.Now().Add(time.Hour))
	if res, err := i.SignIn(ctx, "+79990030008", "12345", "dev", "test"); err == nil || res.Token != "" {
		t.Fatalf("SignIn при сбое чтения пароля = %+v, err=%v; ожидалась ошибка без сессии", res, err)
	}
}

func TestQR_ConcurrentAcceptOneSession(t *testing.T) {
	i, devices, _, _ := qrInteractor(t)
	ctx := context.Background()
	user := qrUser(t, i, "+79990030009")
	before := devicesOf(t, devices, user.ID)

	r, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	code := mustPending(t, r, err)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for k := range errs {
		wg.Add(1)
		go func(k int) {
			defer wg.Done()
			_, errs[k] = i.AcceptLoginToken(ctx, code.Token, user)
		}(k)
	}
	wg.Wait()
	ok := 0
	for _, e := range errs {
		if e == nil {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("успешных Accept = %d (%v), want 1", ok, errs)
	}
	if devicesOf(t, devices, user.ID) != before+1 {
		t.Fatal("выпущено не ровно одна сессия")
	}
}

// Токен записи сверяется: ключ мог получить новый код, а старый указатель
// остаться — старый код не должен подтверждать новую запись.
func TestQR_AcceptStaleTokenAfterRecordReplaced(t *testing.T) {
	i, _, store, _ := qrInteractor(t)
	ctx := context.Background()
	user := qrUser(t, i, "+79990030010")

	r, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	old := mustPending(t, r, err)
	// Запись ключа пересоздана (протухла и выпущена заново), старый указатель жив.
	_ = store.DeleteByKey(ctx, "keyA")
	r2, err := i.ExportLoginToken(ctx, "keyA", nil, "web")
	fresh := mustPending(t, r2, err)
	if fresh.Token == old.Token {
		t.Fatal("тот же код после пересоздания")
	}
	if _, err := i.AcceptLoginToken(ctx, old.Token, user); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("старый код подтвердил новую запись: %v", err)
	}
}

func TestQR_UnavailableWithoutStore(t *testing.T) {
	i, _, _, _ := newInteractor()
	if _, err := i.ExportLoginToken(context.Background(), "k", nil, "web"); !errors.Is(err, ErrQRUnavailable) {
		t.Fatalf("Export без стора = %v", err)
	}
	if _, err := i.AcceptLoginToken(context.Background(), "t", domain.UserRecord{ID: 1}); !errors.Is(err, ErrQRUnavailable) {
		t.Fatalf("Accept без стора = %v", err)
	}
}
