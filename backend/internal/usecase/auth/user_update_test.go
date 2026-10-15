package auth

import (
	"context"
	"encoding/json"
	"github.com/messenger-denis/backend/internal/domain"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeUpdateLog — in-memory per-user update log (dense pts).
type fakeUpdateLog struct {
	onAppend func(userID int64) // хук: что-то происходит между записями
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
	if l.onAppend != nil {
		l.onAppend(userID)
	}
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

// Кадр user_update и его строка журнала (её переигрывает getDifference) — карточка
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
// заменял карточку целиком, и после getDifference аватарка стиралась — в том числе
// своя на втором устройстве.
func TestUserUpdate_JournalKeepsPhoto(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000004", "Аня", "")
	log := newFakeUpdateLog()
	i.SetUpdateLog(log)
	i.SetPublisher(newFakeAuthPub())
	ownImages(i, u.ID, 555)
	if _, err := i.AddProfilePhoto(ctx, u.ID, 555, nil); err != nil {
		t.Fatalf("AddProfilePhoto: %v", err)
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

// userFromFrame — карточка `user` из живого кадра user_update.
func userFromFrame(t *testing.T, raw []byte) domain.UserReal {
	t.Helper()
	var env struct {
		T string `json:"t"`
		D struct {
			User domain.UserReal `json:"user"`
		} `json:"d"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("unmarshal frame: %v", err)
	}
	if env.T != "user_update" {
		t.Fatalf("тип кадра %q, want user_update", env.T)
	}
	return env.D.User
}

// newOwnSyncFixture — владелец и один партнёр по чату, журнал и издатель подключены.
func newOwnSyncFixture(t *testing.T, phone string) (i *Interactor, owner domain.UserRecord, partner int64, log *fakeUpdateLog, pub *fakeAuthPub) {
	t.Helper()
	i, users, _, _ := newInteractor()
	owner, _ = users.CreateWithName(context.Background(), phone, "Боб", "")
	log, pub = newFakeUpdateLog(), newFakeAuthPub()
	i.SetUpdateLog(log)
	i.SetPublisher(pub)
	const peer int64 = 999
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return []int64{peer}, nil })
	return i, owner, peer, log, pub
}

// A2-10: эмодзи-статус меняет карточку у владельца и у партнёров живьём и в журнале.
func TestSetEmojiStatus_EmitsUserUpdate(t *testing.T) {
	i, u, peer, log, pub := newOwnSyncFixture(t, "+70000000010")
	if _, err := i.SetEmojiStatus(context.Background(), u.ID, "🔥"); err != nil {
		t.Fatalf("SetEmojiStatus: %v", err)
	}
	for _, uid := range []int64{u.ID, peer} {
		if len(log.rows[uid]) != 1 || log.rows[uid][0] != "user_update" {
			t.Fatalf("журнал %d = %v; want один user_update", uid, log.rows[uid])
		}
		if len(pub.frames[uid]) != 1 {
			t.Fatalf("кадров у %d: %d, want 1", uid, len(pub.frames[uid]))
		}
		if got := userFromFrame(t, pub.frames[uid][0]).EmojiStatus; got != "🔥" {
			t.Fatalf("emoji_status у %d = %q, want 🔥", uid, got)
		}
	}
}

// A2-10: Premium включает значок у владельца (второе устройство) и у партнёров.
// Себе карточка несёт phone — как у tweb self; партнёру номер не уходит.
func TestPremium_EmitsUserUpdateWithSelfPhone(t *testing.T) {
	cases := map[string]func(i *Interactor, id int64) error{
		"ActivatePremium": func(i *Interactor, id int64) error {
			_, err := i.ActivatePremium(context.Background(), id)
			return err
		},
		"CheckoutPremium": func(i *Interactor, id int64) error {
			_, _, err := i.CheckoutPremium(context.Background(), id, "6m")
			return err
		},
	}
	phones := map[string]string{"ActivatePremium": "+70000000011", "CheckoutPremium": "+70000000012"}
	for name, run := range cases {
		t.Run(name, func(t *testing.T) {
			i, u, peer, log, pub := newOwnSyncFixture(t, phones[name])
			i.SetPremiumRepo(newFakePremiumRepo())
			if err := run(i, u.ID); err != nil {
				t.Fatal(err)
			}
			for _, uid := range []int64{u.ID, peer} {
				if len(log.rows[uid]) != 1 || len(pub.frames[uid]) != 1 {
					t.Fatalf("%d: журнал %v, кадров %d; want по одному", uid, log.rows[uid], len(pub.frames[uid]))
				}
				if !userFromFrame(t, pub.frames[uid][0]).PFlags["premium"] {
					t.Fatalf("у %d нет pFlags.premium", uid)
				}
			}
			if got := userFromFrame(t, pub.frames[u.ID][0]).Phone; got != phones[name] {
				t.Fatalf("phone в своей карточке = %q, want %q", got, phones[name])
			}
			if got := userFromFrame(t, pub.frames[peer][0]).Phone; got != "" {
				t.Fatalf("партнёру уехал номер %q", got)
			}
			var logged struct {
				User domain.UserReal `json:"user"`
			}
			if err := json.Unmarshal(log.payloads[u.ID][0], &logged); err != nil {
				t.Fatal(err)
			}
			if logged.User.Phone != phones[name] {
				t.Fatalf("phone в строке журнала владельца = %q", logged.User.Phone)
			}
		})
	}
}

// orderRecorder — общий порядок вызовов журнала и отзыва устройств.
type orderRecorder struct{ events []string }

type orderedLog struct {
	*fakeUpdateLog
	rec *orderRecorder
}

func (l orderedLog) AppendUpdate(ctx context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error) {
	l.rec.events = append(l.rec.events, "append")
	return l.fakeUpdateLog.AppendUpdate(ctx, userID, ptsCount, date, typ, payload)
}

type orderedRevoker struct{ rec *orderRecorder }

func (r orderedRevoker) NotifyRevoked(context.Context, int64) error {
	r.rec.events = append(r.rec.events, "revoke")
	return nil
}

// VA2-02: удаление аккаунта — партнёры получают карточку с pFlags.deleted. Отзыв
// сессий идёт ДО рассылки (мера безопасности не ждёт P получателей), а свои
// устройства в рассылке не участвуют: их сессии отозваны.
func TestDeleteAccount_RevokesBeforeEmitToPartnersOnly(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	res := registerUser(t, i, "+70000000013", "Удаляемый", "", "web", "browser")
	if _, err := i.ActivatePremium(ctx, res.User.ID); err != nil { // значок до удаления
		t.Fatal(err)
	}
	log, pub := newFakeUpdateLog(), newFakeAuthPub()
	rec := &orderRecorder{}
	i.SetUpdateLog(orderedLog{log, rec})
	i.SetPublisher(pub)
	i.SetRevocationNotifier(orderedRevoker{rec})
	const peer int64 = 999
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return []int64{peer}, nil })

	if err := i.DeleteAccount(ctx, res.User.ID); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}
	if len(pub.frames[peer]) != 1 {
		t.Fatalf("кадров у партнёра: %d, want 1", len(pub.frames[peer]))
	}
	card := userFromFrame(t, pub.frames[peer][0])
	if !card.Deleted() || card.Username != "" || card.PFlags["premium"] {
		t.Fatalf("карточка удалённого: %+v", card)
	}
	if len(log.rows[peer]) != 1 || log.rows[peer][0] != "user_update" {
		t.Fatalf("журнал партнёра = %v", log.rows[peer])
	}
	if len(log.rows[res.User.ID]) != 0 || len(pub.frames[res.User.ID]) != 0 {
		t.Fatalf("удалённому владельцу ушло: журнал %v, кадров %d", log.rows[res.User.ID], len(pub.frames[res.User.ID]))
	}
	if len(rec.events) != 2 || rec.events[0] != "revoke" || rec.events[1] != "append" {
		t.Fatalf("порядок вызовов %v: отзыв должен предшествовать записи в журнал", rec.events)
	}
}

// ctxUserRepo — хранилище, которое, как pgx, отказывает на отменённом контексте.
// SoftDelete отменяет запрос ПОСЛЕ записи: клиент разорвал соединение сразу после
// коммита анонимизации.
type ctxUserRepo struct {
	*fakeUserRepo
	cancel context.CancelFunc
}

func (r ctxUserRepo) SoftDelete(ctx context.Context, id int64) error {
	err := r.fakeUserRepo.SoftDelete(ctx, id)
	r.cancel()
	return err
}

func (r ctxUserRepo) GetByID(ctx context.Context, id int64) (domain.UserRecord, error) {
	if err := ctx.Err(); err != nil {
		return domain.UserRecord{}, err
	}
	return r.fakeUserRepo.GetByID(ctx, id)
}

// ctxDevices отказывает на отменённом контексте, как хранилище.
type ctxDevices struct{ *fakeDeviceRepo }

func (d ctxDevices) DeleteAll(ctx context.Context, userID int64) ([]domain.Device, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return d.fakeDeviceRepo.DeleteAll(ctx, userID)
}

// SoftDelete необратим: разрыв соединения клиентом после него не должен оставить
// анонимизированный аккаунт с живыми сессиями и не должен глушить рассылку.
func TestDeleteAccount_TailSurvivesCancelledRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	base, users, devices, _ := newInteractor()
	res := registerUser(t, base, "+70000000014", "Удаляемый", "", "web", "browser")
	rev := &fakeRevoker{}
	pub := newFakeAuthPub()
	i := New(ctxUserRepo{users, cancel}, ctxDevices{devices}, newFakeCodeRepo(), newFakePasswordRepo(), newFakeStepRepo(), "12345", func(string, ...any) {})
	i.SetRevocationNotifier(rev)
	i.SetPublisher(&ctxCheckPub{fakeAuthPub: pub})
	const peer int64 = 999
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return []int64{peer}, nil })

	if err := i.DeleteAccount(ctx, res.User.ID); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}
	if len(rev.revoked) == 0 {
		t.Fatal("сессии не отозваны после отмены запроса")
	}
	if len(pub.frames[peer]) != 1 {
		t.Fatalf("кадров у партнёра: %d, want 1", len(pub.frames[peer]))
	}
}

// ctxCheckPub отказывает, если контекст рассылки отменён.
type ctxCheckPub struct{ *fakeAuthPub }

func (p *ctxCheckPub) PublishToUser(ctx context.Context, userID int64, frame []byte) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return p.fakeAuthPub.PublishToUser(ctx, userID, frame)
}

// Повтор без изменения (то же эмодзи, Premium уже включён, продление подписки)
// не пишет строк журнала и не шлёт кадров.
func TestOwnProfileMutations_UnchangedValueDoesNotEmit(t *testing.T) {
	ctx := context.Background()
	i, u, peer, log, pub := newOwnSyncFixture(t, "+70000000015")
	i.SetPremiumRepo(newFakePremiumRepo())
	if _, err := i.SetEmojiStatus(ctx, u.ID, "🔥"); err != nil {
		t.Fatal(err)
	}
	if _, err := i.ActivatePremium(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	rows := len(log.rows[u.ID])
	frames := len(pub.frames[peer])
	if rows != 2 || frames != 2 {
		t.Fatalf("первые мутации: строк %d, кадров %d; want по 2", rows, frames)
	}

	if _, err := i.SetEmojiStatus(ctx, u.ID, "🔥"); err != nil {
		t.Fatal(err)
	}
	if _, err := i.ActivatePremium(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := i.CheckoutPremium(ctx, u.ID, "6m"); err != nil {
		t.Fatal(err)
	}
	if len(log.rows[u.ID]) != rows || len(pub.frames[peer]) != frames {
		t.Fatalf("повтор без изменения разослан: строк %d, кадров %d", len(log.rows[u.ID]), len(pub.frames[peer]))
	}
}

// AnnounceUserTo (блок/разблок): карточку пересчитывают ТОЛЬКО названному зрителю
// и только если он партнёр; остальные партнёры и не-партнёр ничего не получают.
// Сам владелец получает свою строку, как при любой смене профиля.
func TestAnnounceUserTo_OnlyNamedPartner(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000011", "Алиса", "")

	log := newFakeUpdateLog()
	pub := newFakeAuthPub()
	i.SetUpdateLog(log)
	i.SetPublisher(pub)
	const friend, other, stranger int64 = 901, 902, 903
	partners := map[int64]bool{friend: true, other: true}
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return []int64{friend, other}, nil })
	i.SetPartnersAmong(func(_ context.Context, _ int64, cand []int64) ([]int64, error) {
		var out []int64
		for _, c := range cand {
			if partners[c] {
				out = append(out, c)
			}
		}
		return out, nil
	})

	if err := i.AnnounceUserTo(ctx, u.ID, []int64{friend, stranger}); err != nil {
		t.Fatalf("AnnounceUserTo: %v", err)
	}
	for _, uid := range []int64{u.ID, friend} {
		if len(log.rows[uid]) != 1 || log.rows[uid][0] != "user_update" {
			t.Fatalf("журнал %d = %v; ждали одну строку user_update", uid, log.rows[uid])
		}
		if len(pub.frames[uid]) != 1 {
			t.Fatalf("кадров у %d = %d; ждали 1", uid, len(pub.frames[uid]))
		}
	}
	for _, uid := range []int64{other, stranger} {
		if len(log.rows[uid]) != 0 || len(pub.frames[uid]) != 0 {
			t.Fatalf("у %d есть строка или кадр: %v / %d", uid, log.rows[uid], len(pub.frames[uid]))
		}
	}
}

// AnnounceUser (смена правила фото): сам и ВСЕ партнёры, как при смене профиля.
func TestAnnounceUser_OwnAndAllPartners(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000012", "Алиса", "")

	log := newFakeUpdateLog()
	pub := newFakeAuthPub()
	i.SetUpdateLog(log)
	i.SetPublisher(pub)
	const a, b int64 = 901, 902
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return []int64{a, b}, nil })

	if err := i.AnnounceUser(ctx, u.ID); err != nil {
		t.Fatalf("AnnounceUser: %v", err)
	}
	for _, uid := range []int64{u.ID, a, b} {
		if len(log.rows[uid]) != 1 {
			t.Fatalf("журнал %d = %v; ждали одну строку", uid, log.rows[uid])
		}
	}
}

// Пересчёт идёт пачками, и запись читается заново на КАЖДОЙ: правка профиля,
// вклинившаяся за время прохода, не должна затираться у партнёров, до которых
// цикл дошёл позже.
func TestAnnounceUser_RereadsRecordPerBatch(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000013", "Старое", "")
	old := announceBatch
	announceBatch = 2
	defer func() { announceBatch = old }()

	log := newFakeUpdateLog()
	i.SetUpdateLog(log)
	i.SetPublisher(newFakeAuthPub())
	partners := []int64{901, 902, 903, 904, 905}
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return partners, nil })
	renamed := false
	log.onAppend = func(uid int64) {
		if uid == 901 && !renamed { // первая пачка прошла — владелец меняет имя
			renamed = true
			_, _ = users.UpdateProfile(ctx, u.ID, "Новое", "", "", nil)
		}
	}

	if err := i.AnnounceUser(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	last := string(log.payloads[905][0])
	if !strings.Contains(last, "Новое") || strings.Contains(last, "Старое") {
		t.Fatalf("партнёр из последней пачки получил устаревшую карточку: %s", last)
	}
	for _, uid := range partners {
		if len(log.payloads[uid]) != 1 {
			t.Fatalf("партнёр %d получил %d строк", uid, len(log.payloads[uid]))
		}
	}
}

// statusPrivacy — PrivacyChecker с присутствием: online у всех, а у hiddenFrom
// last_seen закрыт.
type statusPrivacy struct{ hiddenFrom map[int64]bool }

func (statusPrivacy) Check(context.Context, int64, int64, domain.PrivacyKey) (bool, error) {
	return true, nil
}

func (p statusPrivacy) AccessRules(_ context.Context, viewer int64, ids []int64) (domain.UserViewRules, error) {
	r := domain.UserViewRules{ViewerID: viewer, Photo: map[int64]bool{}, Phone: map[int64]bool{}, LastSeen: map[int64]bool{}}
	for _, id := range ids {
		r.Photo[id], r.LastSeen[id] = true, !p.hiddenFrom[viewer]
	}
	return r, nil
}

func (statusPrivacy) PresenceOf(context.Context, []int64) func(int64) domain.UserStatus {
	return func(int64) domain.UserStatus { return domain.NewUserStatusOnline(time.Now().Add(time.Minute)) }
}

// Смена профиля: кадр и строка журнала несут статус автора глазами получателя.
// Карточка без `status` стирала бы живое присутствие у каждого партнёра.
func TestUserUpdate_CarriesStatusPerRecipient(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000004", "Боб", "")
	log := newFakeUpdateLog()
	pub := newFakeAuthPub()
	i.SetUpdateLog(log)
	i.SetPublisher(pub)
	i.SetPrivacy(statusPrivacy{hiddenFrom: map[int64]bool{998: true}})
	const friend, stranger int64 = 999, 998
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return []int64{friend, stranger}, nil })

	if _, err := i.UpdateProfile(ctx, u.ID, ProfileInput{FirstName: "Боб2"}); err != nil {
		t.Fatal(err)
	}
	want := map[int64]string{friend: domain.UserStatusOnlineTag, stranger: domain.UserStatusRecentlyTag}
	for uid, tag := range want {
		var row struct {
			User struct {
				Status struct {
					T string `json:"_"`
				} `json:"status"`
			} `json:"user"`
		}
		if err := json.Unmarshal(log.payloads[uid][0], &row); err != nil {
			t.Fatal(err)
		}
		if row.User.Status.T != tag {
			t.Fatalf("строка журнала %d: статус %q; want %q", uid, row.User.Status.T, tag)
		}
	}
}

// Строки user_update одного автора пишутся последовательно: правила получателя
// (блок, last_seen) читаются и строка ложится под одним замком автора, поэтому
// пересчёт блока (AnnounceUserTo) и смена профиля не пересекаются.
func TestUserUpdate_SameAuthorSerialized(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000005", "Боб", "")
	log := newFakeUpdateLog()
	inside := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	log.onAppend = func(int64) {
		once.Do(func() { close(inside); <-release })
	}
	i.SetUpdateLog(log)
	i.SetPrivacy(statusPrivacy{})
	i.SetPartners(func(context.Context, int64) ([]int64, error) { return nil, nil })

	done := make(chan struct{}, 2)
	go func() { i.sendUserUpdate(ctx, u, []int64{u.ID}); done <- struct{}{} }()
	<-inside // первая отправка держит замок автора внутри AppendUpdate
	second := make(chan struct{})
	go func() { i.sendUserUpdate(ctx, u, []int64{u.ID}); close(second); done <- struct{}{} }()
	select {
	case <-second:
		t.Fatal("вторая отправка того же автора прошла, пока первая держит замок")
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	<-done
	<-done
}

// photoPrivacy — правила читаются под замком автора (lockHeld отвечает, держит ли
// его кто-то в момент чтения); у closedPhoto профильное фото закрыто.
type photoPrivacy struct {
	statusPrivacy
	closedPhoto map[int64]bool
	i           *Interactor
	heldAtRead  *[]bool
}

func (p photoPrivacy) AccessRules(ctx context.Context, viewer int64, ids []int64) (domain.UserViewRules, error) {
	// Замок автора занят нами: повторный захват с мгновенно отменённым ctx не удаётся.
	c, cancel := context.WithCancel(ctx)
	cancel()
	unlock, err := p.i.authorLocks.lock(c, ids[0])
	if err == nil {
		unlock()
	}
	*p.heldAtRead = append(*p.heldAtRead, err != nil)
	r, e := p.statusPrivacy.AccessRules(ctx, viewer, ids)
	for _, id := range ids {
		if p.closedPhoto[viewer] {
			r.Photo[id] = false
		}
	}
	return r, e
}

// Правила получателя читаются ПОД замком автора, а закрытое profile_photo не
// пускает аватарку в карточку получателя.
func TestUserUpdate_RulesReadUnderAuthorLockAndPhotoRule(t *testing.T) {
	i, users, _, _ := newInteractor()
	ctx := context.Background()
	u, _ := users.CreateWithName(ctx, "+70000000006", "Боб", "")
	photoID := int64(77)
	u.PhotoID = &photoID
	users.byPhone["+70000000006"] = u
	log := newFakeUpdateLog()
	i.SetUpdateLog(log)
	var held []bool
	const friend, stranger int64 = 999, 998
	i.SetPrivacy(photoPrivacy{closedPhoto: map[int64]bool{stranger: true}, i: i, heldAtRead: &held})
	i.sendUserUpdate(ctx, u, []int64{friend, stranger})

	if len(held) != 2 || !held[0] || !held[1] {
		t.Fatalf("замок автора при чтении правил = %v; want занят оба раза", held)
	}
	photoOf := func(uid int64) string {
		var row struct {
			User struct {
				Photo struct {
					T string `json:"_"`
				} `json:"photo"`
			} `json:"user"`
		}
		_ = json.Unmarshal(log.payloads[uid][0], &row)
		return row.User.Photo.T
	}
	if photoOf(friend) != "userProfilePhoto" || photoOf(stranger) == "userProfilePhoto" {
		t.Fatalf("фото: friend=%q stranger=%q; want у друга есть, у закрытого нет", photoOf(friend), photoOf(stranger))
	}
}

// Ожидание замка автора отпускает ctx: заблокированный поток не висит вечно.
func TestKeyedLock_WaitHonoursContext(t *testing.T) {
	var k keyedLock
	unlock, err := k.lock(context.Background(), 5)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := k.lock(ctx, 5); err == nil {
		t.Fatal("занятый ключ взят без ожидания")
	}
	if other, err := k.lock(context.Background(), 6); err != nil {
		t.Fatalf("другой ключ: %v", err)
	} else {
		other()
	}
	unlock()
	again, err := k.lock(context.Background(), 5)
	if err != nil {
		t.Fatal(err)
	}
	again()
	if len(k.m) != 0 {
		t.Fatalf("записи ключей не убраны: %d", len(k.m))
	}
}
