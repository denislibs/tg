package contacts

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/usecase/ownsync"
	"github.com/messenger-denis/backend/internal/usecase/privacy"
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
func (b *fakeBook) List(_ context.Context, owner int64) ([]domain.ContactRecord, error) {
	var out []domain.ContactRecord
	for k, r := range b.rows {
		if k[0] == owner {
			r.User = b.seen(owner, k[1]) // как scanContact: номер прочитан, но не показан
			out = append(out, r)
		}
	}
	return out, nil
}
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

// fakePrivacy — правила: allow[ключ] — пускает ли оно зрителя; rulesErr — сбой
// запроса правил (privacy.ViewRules тогда гасит то, что правила охраняют);
// status — присутствие контактов (нет записи — userStatusEmpty).
type fakePrivacy struct {
	allow    map[domain.PrivacyKey]bool
	rulesErr error
	status   map[int64]domain.UserStatus
}

func (p fakePrivacy) ViewRules(_ context.Context, viewer int64, ids []int64) domain.UserViewRules {
	rules := domain.UserViewRules{ViewerID: viewer, Status: func(id int64) domain.UserStatus {
		if st, ok := p.status[id]; ok {
			return st
		}
		return domain.NewUserStatusEmpty()
	}}
	if p.rulesErr != nil {
		return rules
	}
	rules.Photo, rules.Phone, rules.LastSeen = map[int64]bool{}, map[int64]bool{}, map[int64]bool{}
	for _, id := range ids {
		rules.Photo[id] = p.allow[domain.PrivacyProfilePhoto]
		rules.Phone[id] = p.allow[domain.PrivacyPhoneNumber]
		rules.LastSeen[id] = p.allow[domain.PrivacyLastSeen]
	}
	return rules
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

// Ответ ручки и строка журнала — ОДНА карточка: устройство-инициатор получает и
// кадр, и ответ. Сырая карточка репозитория отдавала номер мимо правила
// phone_number и без close_friend/личного фото.
func TestAdd_ResponseMatchesJournalCard(t *testing.T) {
	i, book, log := newBookInteractor(t)
	ctx := context.Background()
	book.phones[cBob] = "+79990000002"
	i.SetCloseFriends(fakeClose{ids: []int64{cBob}})
	i.SetPrivacy(fakePrivacy{}) // phone_number и profile_photo закрыты

	c, err := i.Add(ctx, cOwner, AddInput{UserID: cBob, FirstName: "Б"})
	if err != nil {
		t.Fatal(err)
	}
	if c.User.Phone != "" {
		t.Fatalf("номер в ответе мимо правила: %q", c.User.Phone)
	}
	row, _ := rowCard(t, log, cOwner)
	got, _ := json.Marshal(c.User)
	want, _ := json.Marshal(row)
	if string(got) != string(want) || !c.User.PFlags["close_friend"] {
		t.Fatalf("ответ %s != журнал %s", got, want)
	}
}

// Личное фото владелец поставил сам — правило profile_photo контакта его не гасит.
func TestSnapshot_PersonalPhotoSurvivesClosedPhotoRule(t *testing.T) {
	i, _, log := newBookInteractor(t)
	i.SetPrivacy(fakePrivacy{})
	i.SetCustomPhotos(&fakeCustomPhotos{set: map[int64]int64{cBob: 6}})
	i.SetMediaReader(&fakeMediaReader{m: map[int64]domain.Media{6: {ID: 6, OwnerID: cOwner, Mime: "image/jpeg"}}})
	if err := i.SetCustomPhoto(context.Background(), cOwner, cBob, 6); err != nil {
		t.Fatal(err)
	}
	u, _ := rowCard(t, log, cOwner)
	if p, ok := u.Photo.(domain.UserProfilePhotoReal); !ok || !p.Personal() {
		t.Fatalf("личное фото погашено правилом: %+v", u.Photo)
	}
}

// Отказ по added_by_phone — ни записи, ни строки.
func TestAddByPhone_PrivacyRefusalWritesNothing(t *testing.T) {
	i, book, log := newBookInteractor(t)
	book.phones[cBob] = "+79990000002"
	i.SetPrivacy(fakePrivacy{})
	_, err := i.AddByPhone(context.Background(), cOwner, AddByPhoneInput{Phone: "+79990000002", FirstName: "Б"})
	if !errors.Is(err, domain.ErrPrivacy) {
		t.Fatalf("err=%v; want ErrPrivacy", err)
	}
	if len(log.rows[cOwner]) != 0 || len(book.rows) != 0 {
		t.Fatalf("после отказа: журнал %v, книга %v", log.rows, book.rows)
	}
}

type failingEmitter struct{}

func (failingEmitter) EmitSnapshot(context.Context, int64, string, func(context.Context) (map[string]any, error)) error {
	return errors.New("журнал недоступен")
}

// Сбой журнала ответ не ломает: мутация закоммичена.
func TestAdd_EmitterFailureKeepsResponse(t *testing.T) {
	book := newFakeBook()
	i := New(book)
	i.SetEmitter(failingEmitter{})
	c, err := i.Add(context.Background(), cOwner, AddInput{UserID: cBob, FirstName: "Б"})
	if err != nil || !c.User.ContactRecord() {
		t.Fatalf("Add: c=%+v err=%v", c.User, err)
	}
	if _, found, err := i.Delete(context.Background(), cOwner, cBob); err != nil || !found {
		t.Fatalf("Delete: found=%v err=%v", found, err)
	}
}

// Сбой правил приватности гасит то, что они охраняют (фото, номер), но строка
// журнала об удалении пишется и ответ не 500.
func TestDelete_PrivacyRulesFailureStillJournals(t *testing.T) {
	i, book, log := newBookInteractor(t)
	ctx := context.Background()
	book.phones[cBob] = "+79990000002"
	i.SetPrivacy(fakePrivacy{allow: map[domain.PrivacyKey]bool{domain.PrivacyPhoneNumber: true}, rulesErr: errors.New("бд недоступна")})
	if _, err := i.Add(ctx, cOwner, AddInput{UserID: cBob, FirstName: "Б"}); err != nil {
		t.Fatal(err)
	}
	card, found, err := i.Delete(ctx, cOwner, cBob)
	if err != nil || !found {
		t.Fatalf("Delete: found=%v err=%v", found, err)
	}
	if card.Phone != "" || card.ContactRecord() {
		t.Fatalf("ответ = %+v", card)
	}
	if u, n := rowCard(t, log, cOwner); n != 2 || u.ContactRecord() || u.Phone != "" {
		t.Fatalf("строка (n=%d) = %+v", n, u)
	}
}

// GET /contacts и ответ добавления — одна и та же карточка: правило profile_photo
// гасит аватарку на обоих путях (иначе она мигает при каждой мутации).
func TestList_MatchesAddResponse(t *testing.T) {
	i, book, _ := newBookInteractor(t)
	ctx := context.Background()
	pr := book.profile[cBob]
	pr.Photo = domain.NewUserProfilePhoto(900, nil, false, false)
	book.profile[cBob] = pr
	book.phones[cBob] = "+79990000002"
	i.SetPrivacy(fakePrivacy{allow: map[domain.PrivacyKey]bool{domain.PrivacyPhoneNumber: true}}) // фото закрыто

	added, err := i.Add(ctx, cOwner, AddInput{UserID: cBob, FirstName: "Б"})
	if err != nil {
		t.Fatal(err)
	}
	list, err := i.List(ctx, cOwner)
	if err != nil || len(list) != 1 {
		t.Fatalf("List: %v %v", list, err)
	}
	a, _ := json.Marshal(added.User)
	l, _ := json.Marshal(list[0].User)
	if string(a) != string(l) {
		t.Fatalf("Add: %s\nList: %s", a, l)
	}
	if _, ok := list[0].User.Photo.(domain.UserProfilePhotoReal); ok {
		t.Fatalf("закрытая аватарка в книге: %+v", list[0].User.Photo)
	}
}

// Правила читаются ПОСЛЕ взятия замка курсора владельца: блок, случившийся между
// чтением правил и записью строки, иначе дал бы снимок с большим pts и
// устаревшим статусом поверх более свежей строки пересчёта блока.
type orderLog struct {
	*fakeLog
	events *[]string
}

func (l orderLog) LockState(ctx context.Context, uid int64) error {
	*l.events = append(*l.events, "lock")
	return l.fakeLog.LockState(ctx, uid)
}

type orderPrivacy struct {
	fakePrivacy
	events *[]string
}

func (p orderPrivacy) ViewRules(ctx context.Context, v int64, ids []int64) domain.UserViewRules {
	*p.events = append(*p.events, "rules")
	return p.fakePrivacy.ViewRules(ctx, v, ids)
}

func TestPublishContactCard_ReadsPrivacyUnderCursorLock(t *testing.T) {
	i, _, log := newBookInteractor(t)
	var events []string
	i.SetEmitter(ownsync.New(orderLog{log, &events}, nil, directTx{}))
	i.SetPrivacy(orderPrivacy{events: &events})
	if _, err := i.Add(context.Background(), cOwner, AddInput{UserID: cBob, FirstName: "Б"}); err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0] != "lock" || events[1] != "rules" {
		t.Fatalf("порядок = %v; want правила после замка курсора", events)
	}
}

// ---- GET /contacts и карточка мутации несут `status` (P0 №2) ----
//
// Клиент заменяет карточку в кэше целиком: ответ без `status` стирал живой
// статус контакта, и «Добавить участников» показывало «был(а) давно» у того, кто
// в сети. Карточки собираются настоящим privacy.Interactor — тем же сборщиком,
// что у остальных витрин.

// statusRepo — правила приватности: last_seen закрыт у hiddenBy, hiddenBy ∩
// blockedBy — заблокировали зрителя; остальные правила открыты.
type statusRepo struct {
	privacy.Repo
	hiddenBy  map[int64]bool
	blockedBy map[int64]bool
}

func (r statusRepo) VisibleMaps(_ context.Context, _ int64, ids []int64, keys ...domain.PrivacyKey) (map[domain.PrivacyKey]map[int64]bool, error) {
	out := map[domain.PrivacyKey]map[int64]bool{}
	for _, k := range keys {
		out[k] = map[int64]bool{}
		for _, id := range ids {
			out[k][id] = !(k == domain.PrivacyLastSeen && r.hiddenBy[id])
		}
	}
	return out, nil
}

func (r statusRepo) BlockedBy(_ context.Context, _ int64, ids []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range ids {
		if r.blockedBy[id] {
			out[id] = true
		}
	}
	return out, nil
}

type fixedPresence map[int64]domain.UserStatus

func (fixedPresence) Status(context.Context, int64) (bool, time.Time, time.Time) {
	return false, time.Time{}, time.Time{}
}

func (p fixedPresence) Statuses(_ context.Context, ids []int64) map[int64]domain.UserStatus {
	out := map[int64]domain.UserStatus{}
	for _, id := range ids {
		if st, ok := p[id]; ok {
			out[id] = st
		}
	}
	return out
}

const (
	cDarya int64 = 3
	cEgor  int64 = 4
)

// newStatusInteractor — книга владельца из Боба, Дарьи и Егора с настоящим
// сборщиком приватности. Боб в сети, Дарья скрыла last_seen, Егор скрыл и
// заблокировал зрителя.
func newStatusInteractor(t *testing.T) (*Interactor, *fakeLog) {
	t.Helper()
	i, book, log := newBookInteractor(t)
	for _, id := range []int64{cDarya, cEgor} {
		u := domain.NewUser(id, domain.UserFlags{})
		u.FirstName = "Контакт"
		book.profile[id] = u
	}
	for _, id := range []int64{cBob, cDarya, cEgor} {
		book.rows[[2]int64{cOwner, id}] = domain.ContactRecord{OwnerID: cOwner, UserID: id, FirstName: "К"}
	}
	pr := privacy.New(statusRepo{hiddenBy: map[int64]bool{cDarya: true, cEgor: true}, blockedBy: map[int64]bool{cEgor: true}})
	pr.SetPresence(fixedPresence{cBob: domain.NewUserStatusOnline(time.Now().Add(time.Minute)), cDarya: domain.NewUserStatusOnline(time.Now().Add(time.Minute))})
	i.SetPrivacy(pr)
	return i, log
}

func statusTag(u domain.UserReal) string {
	if u.Status == nil {
		return "<нет поля>"
	}
	return u.Status.Tag()
}

// GET /contacts: статус по правилам — в сети, скрыто правилом («недавно»),
// скрыто блоком («давно»).
func TestList_CardsCarryStatus(t *testing.T) {
	i, _ := newStatusInteractor(t)
	list, err := i.List(context.Background(), cOwner)
	if err != nil {
		t.Fatal(err)
	}
	got := map[int64]string{}
	for _, c := range list {
		got[c.UserID] = statusTag(c.User)
	}
	want := map[int64]string{
		cBob:   domain.UserStatusOnlineTag,
		cDarya: domain.UserStatusRecentlyTag,
		cEgor:  domain.UserStatusEmptyTag,
	}
	for id, tag := range want {
		if got[id] != tag {
			t.Errorf("контакт %d: статус %q; want %q", id, got[id], tag)
		}
	}
}

// Без проверяющего приватности присутствие неизвестно: карточка без `status`,
// а не «давно» — иначе клиент принял бы выдумку за статус.
func TestList_WithoutPrivacyLeavesStatusOut(t *testing.T) {
	i, book, _ := newBookInteractor(t)
	book.rows[[2]int64{cOwner, cBob}] = domain.ContactRecord{OwnerID: cOwner, UserID: cBob, FirstName: "Б"}
	list, err := i.List(context.Background(), cOwner)
	if err != nil || len(list) != 1 {
		t.Fatalf("List: %v %v", list, err)
	}
	if list[0].User.Status != nil {
		t.Fatalf("статус = %v; want без поля", list[0].User.Status)
	}
}

// Карточка мутации — тот же статус, что в GET /contacts: ответ Add, ответ
// Delete и строка журнала user_update.
func TestMutationCards_CarryStatus(t *testing.T) {
	i, log := newStatusInteractor(t)
	ctx := context.Background()

	c, err := i.Add(ctx, cOwner, AddInput{UserID: cBob, FirstName: "Бобби"})
	if err != nil {
		t.Fatal(err)
	}
	if got := statusTag(c.User); got != domain.UserStatusOnlineTag {
		t.Fatalf("ответ Add: статус %q; want в сети", got)
	}
	row, _ := rowCard(t, log, cOwner)
	if got := statusTag(row); got != domain.UserStatusOnlineTag {
		t.Fatalf("журнал после Add: статус %q; want в сети", got)
	}

	card, found, err := i.Delete(ctx, cOwner, cBob)
	if err != nil || !found {
		t.Fatalf("Delete: found=%v err=%v", found, err)
	}
	if got := statusTag(card); got != domain.UserStatusOnlineTag {
		t.Fatalf("ответ Delete: статус %q; want в сети", got)
	}
	row, _ = rowCard(t, log, cOwner)
	if got := statusTag(row); got != domain.UserStatusOnlineTag {
		t.Fatalf("журнал после Delete: статус %q; want в сети", got)
	}

	// Скрытый last_seen в карточке мутации — «недавно», а заблокировавший — «давно».
	if c, err = i.Add(ctx, cOwner, AddInput{UserID: cDarya, FirstName: "Д"}); err != nil {
		t.Fatal(err)
	}
	if got := statusTag(c.User); got != domain.UserStatusRecentlyTag {
		t.Fatalf("скрыто правилом: %q; want userStatusRecently", got)
	}
	if c, err = i.Add(ctx, cOwner, AddInput{UserID: cEgor, FirstName: "Е"}); err != nil {
		t.Fatal(err)
	}
	if got := statusTag(c.User); got != domain.UserStatusEmptyTag {
		t.Fatalf("заблокировал: %q; want userStatusEmpty", got)
	}
}

// afterLock выполняет hook сразу после взятия замка курсора: «блок закоммитился,
// пока мы ждали замок».
type afterLock struct {
	*fakeLog
	hook func()
}

func (l afterLock) LockState(ctx context.Context, uid int64) error {
	err := l.fakeLog.LockState(ctx, uid)
	l.hook()
	return err
}

// Гонка блок ↔ снимок: блок, ставший виден к моменту, когда мы взяли замок,
// попадает в строку журнала (userStatusEmpty), а не «в сети», прочитанное раньше.
func TestPublishContactCard_BlockBeforeLockIsInSnapshot(t *testing.T) {
	i, book, log := newBookInteractor(t)
	blocked := map[int64]bool{}
	repo := statusRepo{hiddenBy: map[int64]bool{}, blockedBy: blocked}
	// Правило last_seen закрывает блок (как VisibleMaps в БД): hiddenBy тот же ключ.
	hidden := repo.hiddenBy
	pr := privacy.New(repo)
	pr.SetPresence(fixedPresence{cBob: domain.NewUserStatusOnline(time.Now().Add(time.Minute))})
	i.SetPrivacy(pr)
	i.SetEmitter(ownsync.New(afterLock{log, func() { blocked[cBob], hidden[cBob] = true, true }}, nil, directTx{}))
	_ = book

	if _, err := i.Add(context.Background(), cOwner, AddInput{UserID: cBob, FirstName: "Б"}); err != nil {
		t.Fatal(err)
	}
	row, _ := rowCard(t, log, cOwner)
	if got := statusTag(row); got != domain.UserStatusEmptyTag {
		t.Fatalf("строка журнала: статус %q; want userStatusEmpty (блок до замка)", got)
	}
}
