package contacts

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
)

type fakeMediaReader struct{ m map[int64]domain.Media }

func (f *fakeMediaReader) GetByID(_ context.Context, id int64) (domain.Media, error) {
	if m, ok := f.m[id]; ok {
		return m, nil
	}
	return domain.Media{}, domain.ErrNotFound
}

type fakeCustomPhotos struct{ set map[int64]int64 } // contactUserID -> mediaID

func (f *fakeCustomPhotos) SetCustomPhoto(_ context.Context, _, contactUserID, mediaID int64) error {
	if f.set == nil {
		f.set = map[int64]int64{}
	}
	f.set[contactUserID] = mediaID
	return nil
}

func (f *fakeCustomPhotos) ClearCustomPhoto(_ context.Context, _, contactUserID int64) error {
	delete(f.set, contactUserID)
	return nil
}

func (f *fakeCustomPhotos) CustomPhotoMap(_ context.Context, _ int64, ids []int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	for _, id := range ids {
		if m, ok := f.set[id]; ok {
			out[id] = m
		}
	}
	return out, nil
}

// F7-A (MC-16): личное фото контакта ставится только своей картинкой —
// photos.uploadContactProfilePhoto{file} (tweb appProfileManager.ts:1085-1114).
func TestSetCustomPhoto_RejectsForeignMedia(t *testing.T) {
	ctx := context.Background()
	const owner, contact = int64(1), int64(2)
	photos := &fakeCustomPhotos{}
	i := New(nil)
	i.SetCustomPhotos(photos)
	i.SetMediaReader(&fakeMediaReader{m: map[int64]domain.Media{
		5: {ID: 5, OwnerID: 3, Mime: "image/jpeg"},
		6: {ID: 6, OwnerID: owner, Mime: "image/jpeg"},
		7: {ID: 7, OwnerID: owner, Mime: "video/mp4"},
	}})

	if err := i.SetCustomPhoto(ctx, owner, contact, 5); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("чужое: err=%v; want ErrNotFound", err)
	}
	if err := i.SetCustomPhoto(ctx, owner, contact, 7); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не картинка: err=%v; want ErrNotFound", err)
	}
	if err := i.SetCustomPhoto(ctx, owner, contact, 999); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("нет файла: err=%v; want ErrNotFound", err)
	}
	if len(photos.set) != 0 {
		t.Fatalf("после отказов записано %v", photos.set)
	}
	if err := i.SetCustomPhoto(ctx, owner, contact, 6); err != nil {
		t.Fatalf("своё фото: %v", err)
	}
	if photos.set[contact] != 6 {
		t.Fatalf("записано %v; want 6", photos.set)
	}
}

// Не подключённый MediaReader — ошибка проводки, не тихий 404.
func TestSetCustomPhoto_UnwiredMediaReader(t *testing.T) {
	i := New(nil)
	i.SetCustomPhotos(&fakeCustomPhotos{})
	err := i.SetCustomPhoto(context.Background(), 1, 2, 6)
	if err == nil || errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err=%v; want ошибку проводки, не ErrNotFound", err)
	}
}

// ---- f6-contacts: мутации книги пишут владельцу строку журнала user_update ----

// fakeBook — книга контактов в памяти. SeenUser собирает карточку так же, как
// postgres-репозиторий: профиль пользователя + линза книги зрителя (SeenBy).
type fakeBook struct {
	rows    map[[2]int64]domain.ContactRecord // (owner, user)
	profile map[int64]domain.UserReal         // настоящая карточка пользователя
	phones  map[int64]string
	bots    map[int64]bool
}

func newFakeBook() *fakeBook {
	return &fakeBook{
		rows:    map[[2]int64]domain.ContactRecord{},
		profile: map[int64]domain.UserReal{},
		phones:  map[int64]string{},
		bots:    map[int64]bool{},
	}
}

func (b *fakeBook) seen(viewer, userID int64) domain.UserReal {
	u := b.profile[userID]
	if u.Underscore == "" {
		u = domain.NewUser(userID, domain.UserFlags{})
	}
	view := domain.ContactView{}
	if r, ok := b.rows[[2]int64{viewer, userID}]; ok {
		view.Contact, view.FirstName, view.LastName = true, r.FirstName, r.LastName
	}
	_, view.Mutual = b.rows[[2]int64{userID, viewer}]
	return u.SeenBy(view).WithHiddenPhone(b.phones[userID])
}

func (b *fakeBook) Add(_ context.Context, c domain.ContactRecord) (domain.ContactRecord, error) {
	b.rows[[2]int64{c.OwnerID, c.UserID}] = c
	c.User = b.seen(c.OwnerID, c.UserID)
	c.IsBot = b.bots[c.UserID]
	return c, nil
}
func (b *fakeBook) List(context.Context, int64) ([]domain.ContactRecord, error) { return nil, nil }
func (b *fakeBook) Delete(_ context.Context, owner, user int64) (bool, error) {
	_, ok := b.rows[[2]int64{owner, user}]
	delete(b.rows, [2]int64{owner, user})
	return ok, nil
}
func (b *fakeBook) SeenUser(_ context.Context, viewer, user int64) (domain.UserReal, error) {
	return b.seen(viewer, user), nil
}
func (b *fakeBook) UpdateNote(_ context.Context, owner, user int64, _ domain.TextWithEntities) (bool, error) {
	_, ok := b.rows[[2]int64{owner, user}]
	return ok, nil
}
func (b *fakeBook) ResolveByPhone(_ context.Context, phone string) (int64, error) {
	for id, p := range b.phones {
		if p == phone {
			return id, nil
		}
	}
	return 0, domain.ErrNotFound
}

// fakeLog — журнал ownsync: строки по владельцам.
type fakeLog struct {
	rows  map[int64][]logRow
	locks []int64
}
type logRow struct {
	typ  string
	body map[string]any
}

func (l *fakeLog) AppendUpdate(_ context.Context, uid int64, _ int, _ int64, typ string, payload json.RawMessage) (int64, error) {
	if l.rows == nil {
		l.rows = map[int64][]logRow{}
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return 0, err
	}
	l.rows[uid] = append(l.rows[uid], logRow{typ, body})
	return int64(len(l.rows[uid])), nil
}
func (l *fakeLog) AppendUpdateBulk(context.Context, []int64, int, int64, string, json.RawMessage) (map[int64]int64, error) {
	return nil, errors.New("не используется")
}
func (l *fakeLog) LockState(_ context.Context, uid int64) error {
	l.locks = append(l.locks, uid)
	return nil
}

type directTx struct{}

func (directTx) WithinTx(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }

type fakeClose struct{ ids []int64 }

func (f fakeClose) CloseFriends(context.Context, int64) ([]int64, error) { return f.ids, nil }

// denyPrivacy — правило запрещает показ указанных ключей пользователям из deny.
type fakePrivacy struct{ allow map[domain.PrivacyKey]bool }

func (p fakePrivacy) VisibleMap(_ context.Context, _ int64, ids []int64, key domain.PrivacyKey) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range ids {
		out[id] = p.allow[key]
	}
	return out, nil
}
func (p fakePrivacy) Check(_ context.Context, _, _ int64, key domain.PrivacyKey) (bool, error) {
	return p.allow[key], nil
}

const (
	cOwner int64 = 1
	cBob   int64 = 2
)

func newBookInteractor(t *testing.T) (*Interactor, *fakeBook, *fakeLog) {
	t.Helper()
	book := newFakeBook()
	book.profile[cBob] = func() domain.UserReal {
		u := domain.NewUser(cBob, domain.UserFlags{})
		u.FirstName, u.LastName = "Боб", "Петров"
		return u
	}()
	log := &fakeLog{}
	i := New(book)
	i.SetEmitter(ownsync.New(log, nil, directTx{}))
	return i, book, log
}

// rowCard достаёт карточку из последней строки user_update владельца.
func rowCard(t *testing.T, l *fakeLog, owner int64) (domain.UserReal, int) {
	t.Helper()
	rows := l.rows[owner]
	if len(rows) == 0 {
		t.Fatalf("у владельца %d нет строк журнала", owner)
	}
	last := rows[len(rows)-1]
	if last.typ != "user_update" {
		t.Fatalf("тип строки = %q; want user_update", last.typ)
	}
	if last.body["_"] != domain.UpdateUserSnapshotTag {
		t.Fatalf("конструктор = %v; want %s", last.body["_"], domain.UpdateUserSnapshotTag)
	}
	raw, _ := json.Marshal(last.body["user"])
	var u domain.UserReal
	if err := json.Unmarshal(raw, &u); err != nil {
		t.Fatalf("карточка: %v", err)
	}
	return u, len(rows)
}

// Добавил в контакты → своё второе устройство получает карточку с pFlags.contact
// и именем из книги (tweb saveApiUser → onContactUpdated). Контакту строки нет.
func TestAdd_EmitsContactCardToOwner(t *testing.T) {
	i, _, log := newBookInteractor(t)
	if _, err := i.Add(context.Background(), cOwner, AddInput{UserID: cBob, FirstName: "Бобби"}); err != nil {
		t.Fatal(err)
	}
	u, _ := rowCard(t, log, cOwner)
	if !u.ContactRecord() || u.FirstName != "Бобби" || u.ID != cBob {
		t.Fatalf("карточка = %+v; want contact, имя из книги", u)
	}
	if len(log.rows[cBob]) != 0 {
		t.Fatalf("контакту записана строка: %v", log.rows[cBob])
	}
	if len(log.locks) != 1 || log.locks[0] != cOwner {
		t.Fatalf("замок курсора = %v; want [владелец]", log.locks)
	}
}

func TestAddByPhone_EmitsContactCardToOwner(t *testing.T) {
	i, book, log := newBookInteractor(t)
	book.phones[cBob] = "+79990000002"
	if _, err := i.AddByPhone(context.Background(), cOwner, AddByPhoneInput{Phone: "+7 999 000-00-02", FirstName: "Бобби"}); err != nil {
		t.Fatal(err)
	}
	if u, _ := rowCard(t, log, cOwner); !u.ContactRecord() || u.FirstName != "Бобби" {
		t.Fatalf("карточка = %+v", u)
	}
}

// Бот в книге недопустим: запись откатывается, кадра нет.
func TestAdd_BotRolledBackWithoutRow(t *testing.T) {
	i, book, log := newBookInteractor(t)
	book.bots[cBob] = true
	if _, err := i.Add(context.Background(), cOwner, AddInput{UserID: cBob, FirstName: "Бот"}); !errors.Is(err, ErrCannotAddBot) {
		t.Fatalf("err=%v", err)
	}
	if len(log.rows[cOwner]) != 0 {
		t.Fatalf("строки журнала для отвергнутого бота: %v", log.rows[cOwner])
	}
}

// Удалил из контактов → карточка без pFlags.contact и с профильным именем.
func TestDelete_EmitsCardWithoutContactFlag(t *testing.T) {
	i, _, log := newBookInteractor(t)
	ctx := context.Background()
	if _, err := i.Add(ctx, cOwner, AddInput{UserID: cBob, FirstName: "Бобби"}); err != nil {
		t.Fatal(err)
	}
	card, found, err := i.Delete(ctx, cOwner, cBob)
	if err != nil || !found {
		t.Fatalf("Delete: found=%v err=%v", found, err)
	}
	if card.ContactRecord() || card.FirstName != "Боб" {
		t.Fatalf("ответ = %+v", card)
	}
	u, n := rowCard(t, log, cOwner)
	if n != 2 || u.ContactRecord() || u.FirstName != "Боб" || u.LastName != "Петров" {
		t.Fatalf("строка (n=%d) = %+v; want без contact, профильное имя", n, u)
	}
	// Повторное удаление: записи нет — строки нет.
	if _, found, _ := i.Delete(ctx, cOwner, cBob); found {
		t.Fatal("повторное удаление нашло запись")
	}
	if len(log.rows[cOwner]) != 2 {
		t.Fatalf("повтор записал строку: %d", len(log.rows[cOwner]))
	}
}

func TestCustomPhoto_EmitsCardWithPersonalPhoto(t *testing.T) {
	i, _, log := newBookInteractor(t)
	ctx := context.Background()
	photos := &fakeCustomPhotos{}
	i.SetCustomPhotos(photos)
	i.SetMediaReader(&fakeMediaReader{m: map[int64]domain.Media{6: {ID: 6, OwnerID: cOwner, Mime: "image/jpeg"}}})

	if err := i.SetCustomPhoto(ctx, cOwner, cBob, 6); err != nil {
		t.Fatal(err)
	}
	u, _ := rowCard(t, log, cOwner)
	p, ok := u.Photo.(domain.UserProfilePhotoReal)
	if !ok || p.PhotoID != 6 || !p.Personal() {
		t.Fatalf("фото = %+v; want личное 6", u.Photo)
	}

	if err := i.ClearCustomPhoto(ctx, cOwner, cBob); err != nil {
		t.Fatal(err)
	}
	u, n := rowCard(t, log, cOwner)
	if n != 2 {
		t.Fatalf("строк = %d; want 2", n)
	}
	if p, ok := u.Photo.(domain.UserProfilePhotoReal); ok && p.Personal() {
		t.Fatalf("после сброса фото осталось личным: %+v", u.Photo)
	}
}

// Карточка глазами владельца: close_friend, номер и фото — по его правам.
func TestSnapshot_CloseFriendPhoneAndPrivacy(t *testing.T) {
	i, book, log := newBookInteractor(t)
	ctx := context.Background()
	book.phones[cBob] = "+79990000002"
	pr := domain.NewUser(cBob, domain.UserFlags{})
	pr.FirstName = "Боб"
	pr.Photo = domain.NewUserProfilePhoto(900, nil, false, false)
	book.profile[cBob] = pr
	i.SetCloseFriends(fakeClose{ids: []int64{cBob}})

	// Правила разрешают всё.
	i.SetPrivacy(fakePrivacy{allow: map[domain.PrivacyKey]bool{domain.PrivacyPhoneNumber: true, domain.PrivacyProfilePhoto: true}})
	if _, err := i.Add(ctx, cOwner, AddInput{UserID: cBob, FirstName: "Б"}); err != nil {
		t.Fatal(err)
	}
	u, _ := rowCard(t, log, cOwner)
	if !u.PFlags["close_friend"] || u.Phone != "+79990000002" {
		t.Fatalf("close_friend/phone = %v / %q", u.PFlags, u.Phone)
	}
	if p, ok := u.Photo.(domain.UserProfilePhotoReal); !ok || p.PhotoID != 900 {
		t.Fatalf("фото = %+v", u.Photo)
	}

	// Правила закрыты: ни номера, ни чужой аватарки в строке журнала.
	i.SetPrivacy(fakePrivacy{})
	if _, err := i.Add(ctx, cOwner, AddInput{UserID: cBob, FirstName: "Б"}); err != nil {
		t.Fatal(err)
	}
	u, _ = rowCard(t, log, cOwner)
	if u.Phone != "" {
		t.Fatalf("номер утёк в снимок: %q", u.Phone)
	}
	if _, ok := u.Photo.(domain.UserProfilePhotoReal); ok {
		t.Fatalf("закрытая аватарка утекла в снимок: %+v", u.Photo)
	}
}

// Без подключённого эмиттера мутации работают как прежде.
func TestMutations_WithoutEmitter(t *testing.T) {
	book := newFakeBook()
	i := New(book)
	if _, err := i.Add(context.Background(), cOwner, AddInput{UserID: cBob, FirstName: "Б"}); err != nil {
		t.Fatal(err)
	}
	if _, found, err := i.Delete(context.Background(), cOwner, cBob); err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
}
