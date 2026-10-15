package auth

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

// «Новый вход» (М1-3): вход, который не одобрила уже вошедшая сессия, при
// наличии других сессий рождает строку unconfirmed и updateNewAuthorization;
// tweb appAccountManager.ts:41-59, :277-294.

// ownRow — строка журнала, записанная через ownsync.
type ownRow struct {
	typ  string
	body map[string]any
}

// fakeOwnLog — ownsync.Log в памяти: строки по пользователям.
type fakeOwnLog struct {
	mu   sync.Mutex
	rows map[int64][]ownRow
	pts  map[int64]int64
}

func newFakeOwnLog() *fakeOwnLog {
	return &fakeOwnLog{rows: map[int64][]ownRow{}, pts: map[int64]int64{}}
}

func (l *fakeOwnLog) AppendUpdate(_ context.Context, userID int64, _ int, _ int64, typ string, payload json.RawMessage) (int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var body map[string]any
	_ = json.Unmarshal(payload, &body)
	l.rows[userID] = append(l.rows[userID], ownRow{typ, body})
	l.pts[userID]++
	return l.pts[userID], nil
}

func (l *fakeOwnLog) AppendUpdateBulk(ctx context.Context, userIDs []int64, ptsCount int, date int64, typ string, payload json.RawMessage) (map[int64]int64, error) {
	out := map[int64]int64{}
	for _, u := range userIDs {
		p, _ := l.AppendUpdate(ctx, u, ptsCount, date, typ, payload)
		out[u] = p
	}
	return out, nil
}

func (l *fakeOwnLog) LockState(context.Context, int64) error { return nil }

func (l *fakeOwnLog) of(userID int64) []ownRow {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]ownRow(nil), l.rows[userID]...)
}

// loginFixture — интерактор с журналом и аккаунтом, у которого уже есть одна
// (подтверждённая) сессия.
type loginFixture struct {
	i       *Interactor
	devices *fakeDeviceRepo
	codes   *fakeCodeRepo
	log     *fakeOwnLog
	qr      *fakeQRStore
	user    domain.UserRecord
	phone   string
	first   domain.Device
}

func newLoginFixture(t *testing.T, phone string) *loginFixture {
	t.Helper()
	i, _, devices, codes := newInteractor()
	log := newFakeOwnLog()
	i.SetEmitter(ownsync.New(log, nil, nil))
	qr := newFakeQRStore()
	i.SetQRStore(qr)
	reg := registerUser(t, i, phone, "Владелец", "", "Chrome", "web")
	return &loginFixture{i: i, devices: devices, codes: codes, log: log, qr: qr,
		user: reg.User, phone: phone, first: reg.Device}
}

// signIn — вход тем же номером (кодом), возвращает результат.
func (f *loginFixture) signIn(t *testing.T) SignInResult {
	t.Helper()
	ctx := context.Background()
	if err := f.i.RequestCode(ctx, f.phone); err != nil {
		t.Fatalf("RequestCode: %v", err)
	}
	res, err := f.i.SignIn(ctx, f.phone, "12345", "Firefox", "web")
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	return res
}

func (f *loginFixture) setPassword(t *testing.T) {
	t.Helper()
	if err := f.i.SetPassword(context.Background(), f.user.ID, "", "s3cret", "hint", "a@b.co"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
}

func (f *loginFixture) unconfirmed(deviceID int64) bool { return f.devices.byID[deviceID].Unconfirmed }

func (f *loginFixture) noRows(t *testing.T) {
	t.Helper()
	if rows := f.log.of(f.user.ID); len(rows) != 0 {
		t.Fatalf("в журнале лишние строки: %+v", rows)
	}
}

// qrLogin проходит вход QR: экспортёр (ключ keyHash) показывает код, вошедшая
// сессия подтверждает. Возвращает результат экспорта.
func (f *loginFixture) qrLogin(t *testing.T, keyHash string) ExportResult {
	t.Helper()
	ctx := context.Background()
	r, err := f.i.ExportLoginToken(ctx, keyHash, nil, "web")
	code := mustPending(t, r, err)
	if _, err := f.i.AcceptLoginToken(ctx, code.Token, f.user); err != nil {
		t.Fatalf("AcceptLoginToken: %v", err)
	}
	out, err := f.i.ExportLoginToken(ctx, keyHash, nil, "web")
	if err != nil {
		t.Fatalf("ExportLoginToken: %v", err)
	}
	return out
}

func TestMintSession_FirstSession_NotUnconfirmed(t *testing.T) {
	f := newLoginFixture(t, "+79990050001")
	if f.unconfirmed(f.first.ID) {
		t.Fatal("первая сессия аккаунта помечена unconfirmed: спрашивать некого")
	}
	f.noRows(t)
}

func TestMintSession_SecondSession_UnconfirmedAndEvent(t *testing.T) {
	f := newLoginFixture(t, "+79990050002")
	res := f.signIn(t)
	if !res.Device.Unconfirmed || !f.unconfirmed(res.Device.ID) {
		t.Fatalf("вторая сессия не unconfirmed: %+v", res.Device)
	}
	rows := f.log.of(f.user.ID)
	if len(rows) != 1 || rows[0].typ != "new_authorization" {
		t.Fatalf("строки журнала = %+v, want одна new_authorization", rows)
	}
	b := rows[0].body
	flags, _ := b["pFlags"].(map[string]any)
	if b["_"] != "updateNewAuthorization" || flags["unconfirmed"] != true ||
		b["hash"] != float64(res.Device.ID) || b["device"] != "Firefox, web" ||
		b["date"] != float64(res.Device.CreatedAt.Unix()) {
		t.Fatalf("тело = %#v", b)
	}
}

// Вход, одобренный уже вошедшей сессией, не спрашивается: QR (оба места
// выпуска) и веб-токен. CountByUser на этом пути не зовётся.
func TestMintSession_ApprovedPaths_NotUnconfirmed(t *testing.T) {
	f := newLoginFixture(t, "+79990050003")
	ctx := context.Background()
	before := f.devices.counts

	// QR: AcceptLoginToken выпускает сессию экспортёру.
	out := f.qrLogin(t, "keyQR")
	if out.Session == nil {
		t.Fatalf("QR не выдал сессию: %+v", out)
	}
	// Веб-токен: выпускает живая сессия, обменивает новый клиент.
	token, _, err := f.i.NewWebAuthToken(ctx, f.user.ID)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := f.i.SignImport(ctx, token, "Safari", "web")
	if err != nil {
		t.Fatal(err)
	}
	for id, d := range f.devices.byID {
		if d.Unconfirmed {
			t.Fatalf("сессия %d помечена unconfirmed на одобренном пути", id)
		}
	}
	if imported.Device.Unconfirmed {
		t.Fatal("веб-токен: сессия unconfirmed")
	}
	f.noRows(t)
	if f.devices.counts != before {
		t.Fatalf("CountByUser вызван %d раз на одобренных путях", f.devices.counts-before)
	}
}

// QR, ветка «пароль сняли, пока экспортёр не опросил» (exportFromRecord).
func TestMintSession_QRPasswordRemovedWhileWaiting_NotUnconfirmed(t *testing.T) {
	f := newLoginFixture(t, "+79990050004")
	ctx := context.Background()
	f.setPassword(t)
	r, err := f.i.ExportLoginToken(ctx, "keyW", nil, "web")
	code := mustPending(t, r, err)
	if _, err := f.i.AcceptLoginToken(ctx, code.Token, f.user); err != nil {
		t.Fatal(err)
	}
	if err := f.i.pw.SetPassword(ctx, f.user.ID, nil, "", ""); err != nil {
		t.Fatal(err)
	}
	out, err := f.i.ExportLoginToken(ctx, "keyW", nil, "web")
	if err != nil || out.Session == nil {
		t.Fatalf("export = %+v, %v", out, err)
	}
	if out.Session.Device.Unconfirmed || f.unconfirmed(out.Session.Device.ID) {
		t.Fatal("QR с отозванным паролем: сессия unconfirmed")
	}
	f.noRows(t)
}

// Остальные пути входа спрашивают: код, пароль после кода, ключ доступа,
// восстановление пароля по почте.
func TestMintSession_UnapprovedPaths_Unconfirmed(t *testing.T) {
	ctx := context.Background()

	t.Run("пароль после кода", func(t *testing.T) {
		f := newLoginFixture(t, "+79990050005")
		f.setPassword(t)
		step := f.signIn(t)
		if !step.PasswordNeeded {
			t.Fatalf("ожидался шаг пароля: %+v", step)
		}
		res, err := f.i.CheckPassword(ctx, step.PasswordToken, "s3cret", "Firefox", "web")
		if err != nil || !res.Device.Unconfirmed || !f.unconfirmed(res.Device.ID) {
			t.Fatalf("CheckPassword = %+v, %v; want unconfirmed", res.Device, err)
		}
		if rows := f.log.of(f.user.ID); len(rows) != 1 {
			t.Fatalf("строк журнала = %d, want 1", len(rows))
		}
	})
	t.Run("ключ доступа без пароля", func(t *testing.T) {
		f := newLoginFixture(t, "+79990050006")
		res, err := f.i.PasskeySignIn(ctx, f.user.ID, "Firefox", "web")
		if err != nil || !res.Device.Unconfirmed {
			t.Fatalf("PasskeySignIn = %+v, %v; want unconfirmed", res.Device, err)
		}
	})
	t.Run("ключ доступа и пароль", func(t *testing.T) {
		f := newLoginFixture(t, "+79990050007")
		f.setPassword(t)
		step, err := f.i.PasskeySignIn(ctx, f.user.ID, "Firefox", "web")
		if err != nil || !step.PasswordNeeded {
			t.Fatalf("PasskeySignIn = %+v, %v", step, err)
		}
		res, err := f.i.CheckPassword(ctx, step.PasswordToken, "s3cret", "Firefox", "web")
		if err != nil || !res.Device.Unconfirmed {
			t.Fatalf("CheckPassword = %+v, %v; want unconfirmed", res.Device, err)
		}
	})
	t.Run("восстановление пароля по почте", func(t *testing.T) {
		f := newLoginFixture(t, "+79990050008")
		f.setPassword(t)
		mail := &fakeMailer{}
		f.i.SetMailer(mail)
		step := f.signIn(t)
		if _, err := f.i.RequestPasswordRecovery(ctx, step.PasswordToken); err != nil {
			t.Fatal(err)
		}
		res, err := f.i.ConfirmPasswordRecovery(ctx, step.PasswordToken, mail.code, "Firefox", "web")
		if err != nil || !res.Device.Unconfirmed {
			t.Fatalf("ConfirmPasswordRecovery = %+v, %v; want unconfirmed", res.Device, err)
		}
	})
}

// Признак «одобрено» переживает шаг облачного пароля: QR и веб-токен при
// включённом пароле выдают password_token с approved, а CheckPassword передаёт
// его в mintSession.
func TestMintSession_ApprovedThroughPasswordStep(t *testing.T) {
	ctx := context.Background()

	t.Run("QR", func(t *testing.T) {
		f := newLoginFixture(t, "+79990050009")
		f.setPassword(t)
		out := f.qrLogin(t, "keyP")
		if out.Password == nil {
			t.Fatalf("ожидался шаг пароля: %+v", out)
		}
		res, err := f.i.CheckPassword(ctx, out.Password.PasswordToken, "s3cret", "Chrome", "web")
		if err != nil {
			t.Fatal(err)
		}
		if res.Device.Unconfirmed || f.unconfirmed(res.Device.ID) {
			t.Fatal("QR + пароль: одобренный вход помечен unconfirmed")
		}
		f.noRows(t)
	})
	t.Run("веб-токен", func(t *testing.T) {
		f := newLoginFixture(t, "+79990050010")
		f.setPassword(t)
		token, _, err := f.i.NewWebAuthToken(ctx, f.user.ID)
		if err != nil {
			t.Fatal(err)
		}
		step, err := f.i.SignImport(ctx, token, "Safari", "web")
		if err != nil || !step.PasswordNeeded {
			t.Fatalf("SignImport = %+v, %v", step, err)
		}
		res, err := f.i.CheckPassword(ctx, step.PasswordToken, "s3cret", "Safari", "web")
		if err != nil || res.Device.Unconfirmed {
			t.Fatalf("CheckPassword = %+v, %v; want confirmed", res.Device, err)
		}
		f.noRows(t)
	})
	t.Run("продление токена восстановлением не теряет признак", func(t *testing.T) {
		f := newLoginFixture(t, "+79990050011")
		f.setPassword(t)
		f.i.SetMailer(&fakeMailer{})
		token, _, err := f.i.NewWebAuthToken(ctx, f.user.ID)
		if err != nil {
			t.Fatal(err)
		}
		step, err := f.i.SignImport(ctx, token, "Safari", "web")
		if err != nil || !step.PasswordNeeded {
			t.Fatalf("SignImport = %+v, %v", step, err)
		}
		if _, err := f.i.RequestPasswordRecovery(ctx, step.PasswordToken); err != nil {
			t.Fatal(err)
		}
		_, approved, err := f.i.pw.PasswordTokenUser(ctx, domain.HashToken(step.PasswordToken))
		if err != nil || !approved {
			t.Fatalf("после продления approved = %v, err = %v; want true", approved, err)
		}
	})
}

// Вход и обычный путь без Emitter (тесты и сборки без журнала) не падает.
func TestMintSession_NoEmitter_StillMarksUnconfirmed(t *testing.T) {
	i, _, devices, codes := newInteractor()
	reg := registerUser(t, i, "+79990050012", "Без журнала", "", "Chrome", "web")
	_ = codes.SaveCode(context.Background(), "+79990050012", "12345", time.Now().Add(time.Hour))
	res, err := i.SignIn(context.Background(), "+79990050012", "12345", "Firefox", "web")
	if err != nil || !res.Device.Unconfirmed || !devices.byID[res.Device.ID].Unconfirmed {
		t.Fatalf("res = %+v, err = %v", res.Device, err)
	}
	_ = reg
}

// Удаление аккаунта сносит все сессии разом: показывать «убрать» некому.
func TestDeleteAccount_NoRemovalRows(t *testing.T) {
	f := newLoginFixture(t, "+79990050013")
	_ = f.signIn(t)
	before := len(f.log.of(f.user.ID))
	if err := f.i.DeleteAccount(context.Background(), f.user.ID); err != nil {
		t.Fatal(err)
	}
	if after := len(f.log.of(f.user.ID)); after != before {
		t.Fatalf("после удаления аккаунта появились строки журнала: %d → %d", before, after)
	}
}

// ── Подтверждение и завершение ──────────────────────────────────────────────

// confirmFixture: текущая сессия старая (подтверждать можно), цель — неподтверждённая
// двухдневная. Часы интерактора заморожены.
func confirmFixture(t *testing.T) (f *loginFixture, cur, target int64) {
	t.Helper()
	f = newLoginFixture(t, "+79990050020")
	f.i.now = func() time.Time { return sessionsNow }
	tgt := f.signIn(t) // Unconfirmed = true, строка new_authorization уже в журнале
	set := func(id int64, created time.Time) {
		d := f.devices.byID[id]
		d.CreatedAt = created
		f.devices.byID[id] = d
	}
	set(f.first.ID, sessionsNow.Add(-30*24*time.Hour))
	set(tgt.Device.ID, sessionsNow.Add(-48*time.Hour))
	f.log.rows[f.user.ID] = nil // начинаем с чистого журнала
	return f, f.first.ID, tgt.Device.ID
}

func removalRows(t *testing.T, rows []ownRow, wantHash int64) {
	t.Helper()
	if len(rows) != 1 || rows[0].typ != "new_authorization" {
		t.Fatalf("строки журнала = %+v, want одна new_authorization", rows)
	}
	b := rows[0].body
	if b["_"] != "updateNewAuthorization" || b["hash"] != float64(wantHash) {
		t.Fatalf("тело = %#v", b)
	}
	if _, has := b["pFlags"]; has {
		t.Fatalf("у строки «убрать» есть pFlags: %#v", b)
	}
	for _, k := range []string{"date", "device", "location"} {
		if _, has := b[k]; has {
			t.Fatalf("у строки «убрать» есть %s: %#v", k, b)
		}
	}
}

func TestConfirmSession_RemovesFlagAndEmitsRemoval(t *testing.T) {
	f, cur, target := confirmFixture(t)
	if err := f.i.ConfirmSession(context.Background(), f.user.ID, cur, target); err != nil {
		t.Fatal(err)
	}
	if f.unconfirmed(target) {
		t.Fatal("флаг не снят")
	}
	removalRows(t, f.log.of(f.user.ID), target)
}

func TestConfirmSession_UnknownTarget_NotFound(t *testing.T) {
	f, cur, _ := confirmFixture(t)
	err := f.i.ConfirmSession(context.Background(), f.user.ID, cur, 99999)
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	f.noRows(t)
}

func TestConfirmSession_ForeignTarget_NotFound(t *testing.T) {
	f, cur, _ := confirmFixture(t)
	other := newLoginFixture(t, "+79990050021")
	_ = other
	// Сессия другого пользователя в том же хранилище.
	foreign, err := f.devices.Create(context.Background(), domain.Device{UserID: f.user.ID + 1000, Name: "x", TokenHash: "h-foreign", Unconfirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.i.ConfirmSession(context.Background(), f.user.ID, cur, foreign.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound (чужая сессия)", err)
	}
	if !f.devices.byID[foreign.ID].Unconfirmed {
		t.Fatal("флаг чужой сессии снят")
	}
}

func TestConfirmSession_FreshCurrent(t *testing.T) {
	f, cur, target := confirmFixture(t)
	d := f.devices.byID[cur]
	d.CreatedAt = sessionsNow.Add(-time.Hour)
	f.devices.byID[cur] = d
	if err := f.i.ConfirmSession(context.Background(), f.user.ID, cur, target); !errors.Is(err, domain.ErrFreshAuthorization) {
		t.Fatalf("err = %v, want ErrFreshAuthorization", err)
	}
	if !f.unconfirmed(target) {
		t.Fatal("флаг снят свежей сессией")
	}
	f.noRows(t)
}

func TestConfirmSession_Self(t *testing.T) {
	f, cur, _ := confirmFixture(t)
	ctx := context.Background()
	if err := f.i.ConfirmSession(ctx, f.user.ID, cur, cur); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("цель=текущая: err = %v, want ErrInvalid", err)
	}
	if err := f.i.ConfirmSession(ctx, f.user.ID, cur, 0); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("цель=0: err = %v, want ErrInvalid", err)
	}
}

func TestConfirmSession_MissingCurrent(t *testing.T) {
	f, _, target := confirmFixture(t)
	if err := f.i.ConfirmSession(context.Background(), f.user.ID, 99999, target); !errors.Is(err, domain.ErrNoCurrentSession) {
		t.Fatalf("err = %v, want ErrNoCurrentSession", err)
	}
}

func TestConfirmSession_AlreadyConfirmed_NoEvent(t *testing.T) {
	f, cur, target := confirmFixture(t)
	ctx := context.Background()
	if err := f.i.ConfirmSession(ctx, f.user.ID, cur, target); err != nil {
		t.Fatal(err)
	}
	f.log.rows[f.user.ID] = nil
	if err := f.i.ConfirmSession(ctx, f.user.ID, cur, target); err != nil {
		t.Fatalf("повторное подтверждение: %v, want nil", err)
	}
	f.noRows(t)
}

// «Нет, не я» — завершение неподтверждённой сессии снимает запрос у остальных.
func TestTerminateSession_UnconfirmedEmitsRemoval(t *testing.T) {
	f, cur, target := confirmFixture(t)
	ok, err := f.i.TerminateSession(context.Background(), f.user.ID, cur, target)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	removalRows(t, f.log.of(f.user.ID), target)
}

func TestTerminateSession_ConfirmedEmitsNothing(t *testing.T) {
	f, cur, target := confirmFixture(t)
	d := f.devices.byID[target]
	d.Unconfirmed = false
	f.devices.byID[target] = d
	if ok, err := f.i.TerminateSession(context.Background(), f.user.ID, cur, target); err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	f.noRows(t)
}

// Флаг погас по сроку (7 суток): клиент запрос уже отбросил, строка не нужна.
func TestTerminateSession_ExpiredUnconfirmedEmitsNothing(t *testing.T) {
	f, cur, target := confirmFixture(t)
	d := f.devices.byID[target]
	d.CreatedAt = sessionsNow.Add(-8 * 24 * time.Hour)
	f.devices.byID[target] = d
	if ok, err := f.i.TerminateSession(context.Background(), f.user.ID, cur, target); err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	f.noRows(t)
}

// «Завершить все прочие»: по строке на каждую неподтверждённую.
func TestTerminateOtherSessions_UnconfirmedEmitsRemovalPerSession(t *testing.T) {
	f, cur, target := confirmFixture(t)
	ctx := context.Background()
	// Вторая неподтверждённая и одна подтверждённая.
	second, err := f.devices.Create(ctx, domain.Device{UserID: f.user.ID, Name: "B", Platform: "web", TokenHash: "h-2", Unconfirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	d := f.devices.byID[second.ID]
	d.CreatedAt = sessionsNow.Add(-time.Hour)
	f.devices.byID[second.ID] = d
	plain, err := f.devices.Create(ctx, domain.Device{UserID: f.user.ID, Name: "C", Platform: "web", TokenHash: "h-3"})
	if err != nil {
		t.Fatal(err)
	}
	d = f.devices.byID[plain.ID]
	d.CreatedAt = sessionsNow.Add(-time.Hour)
	f.devices.byID[plain.ID] = d

	n, err := f.i.TerminateOtherSessions(ctx, f.user.ID, cur)
	if err != nil || n != 3 {
		t.Fatalf("n=%d err=%v, want 3", n, err)
	}
	rows := f.log.of(f.user.ID)
	if len(rows) != 2 {
		t.Fatalf("строк = %d, want 2 (по одной на неподтверждённую): %+v", len(rows), rows)
	}
	got := map[float64]bool{}
	for _, r := range rows {
		got[r.body["hash"].(float64)] = true
	}
	if !got[float64(target)] || !got[float64(second.ID)] {
		t.Fatalf("hash в строках = %v, want %d и %d", got, target, second.ID)
	}
}

// Выход самой неподтверждённой сессии (POST /auth/logout) — тоже снимает запрос.
func TestRevokeSession_LogoutOfUnconfirmedEmitsRemoval(t *testing.T) {
	f, _, target := confirmFixture(t)
	if ok, err := f.i.RevokeSession(context.Background(), f.user.ID, target); err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	removalRows(t, f.log.of(f.user.ID), target)
}
