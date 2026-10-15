package auth

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// seedUser регистрирует пользователя (новый номер → шаг sign_up) и отдаёт его id.
func seedUser(t *testing.T, i *Interactor, phone string) int64 {
	t.Helper()
	return registerUser(t, i, phone, "Профиль", "", "web", "browser").User.ID
}

func TestUpdateProfile(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	id := seedUser(t, i, "+79990000001")

	bday := time.Date(2000, 3, 15, 0, 0, 0, 0, time.UTC)
	u, err := i.UpdateProfile(ctx, id, ProfileInput{FirstName: "  Denis ", LastName: "M", Bio: "hi", Birthday: &bday})
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	if u.FirstName != "Denis" || u.LastName != "M" {
		t.Fatalf("names not trimmed/stored: %+v", u)
	}
	if u.Bio != "hi" || u.Birthday == nil || !u.Birthday.Equal(bday) {
		t.Fatalf("bio/birthday not stored: %+v", u)
	}

	if _, err := i.UpdateProfile(ctx, id, ProfileInput{FirstName: "   "}); err == nil {
		t.Fatal("expected error for blank first name")
	}
}

// fakePreviewer — AvatarPreviewer, отдающий фиксированное stripped-превью и
// запоминающий, за каким media_id пришли.
type fakePreviewer struct {
	preview []byte
	gotID   int64
}

func (p *fakePreviewer) StrippedPreview(_ context.Context, mediaID int64) ([]byte, error) {
	p.gotID = mediaID
	return p.preview, nil
}

// fakeMediaReader — MediaReader: строки медиа в памяти (владелец, mime).
type fakeMediaReader struct{ m map[int64]domain.Media }

func (f *fakeMediaReader) GetByID(_ context.Context, id int64) (domain.Media, error) {
	if m, ok := f.m[id]; ok {
		return m, nil
	}
	return domain.Media{}, domain.ErrNotFound
}

// ownImages подключает MediaReader с image/jpeg-файлами owner под указанными id.
func ownImages(i *Interactor, owner int64, ids ...int64) {
	m := map[int64]domain.Media{}
	for _, id := range ids {
		m[id] = domain.Media{ID: id, OwnerID: owner, Mime: "image/jpeg"}
	}
	i.SetMediaReader(&fakeMediaReader{m: m})
}

// AddProfilePhoto с подключённым превьюером кладёт stripped-превью аватарки в
// профиль; без превьюера аватарка ставится без превью — мягкая деградация.
func TestAddProfilePhotoStrippedPreview(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	id := seedUser(t, i, "+79990000031")
	ownImages(i, id, 42)

	stripped := []byte{0xff, 0xd8, 0xff, 0xe0, 5}
	pv := &fakePreviewer{preview: stripped}
	i.SetAvatarPreviewer(pv)

	if _, err := i.AddProfilePhoto(ctx, id, 42, nil); err != nil {
		t.Fatalf("AddProfilePhoto: %v", err)
	}
	u, _ := i.GetUser(ctx, id)
	if pv.gotID != 42 {
		t.Fatalf("previewer got media id %d, want 42", pv.gotID)
	}
	if !bytes.Equal(u.PhotoPreview, stripped) {
		t.Fatalf("PhotoPreview = %v, want %v", u.PhotoPreview, stripped)
	}

	// Без превьюера аватарка ставится, превью пустое (старое поведение не ломается).
	i2, _, _, _ := newInteractor()
	id2 := seedUser(t, i2, "+79990000032")
	ownImages(i2, id2, 43)
	if _, err := i2.AddProfilePhoto(ctx, id2, 43, nil); err != nil {
		t.Fatalf("AddProfilePhoto without previewer: %v", err)
	}
	u2, _ := i2.GetUser(ctx, id2)
	if u2.PhotoID == nil || *u2.PhotoID != 43 || u2.PhotoPreview != nil {
		t.Fatalf("without previewer: photo=%v preview=%v", u2.PhotoID, u2.PhotoPreview)
	}
}

// fakeSquarer — AvatarSquarer: квадрат для неквадратного медиа лежит под
// другим id (map), остальные id — как есть; err — отказ кропа.
type fakeSquarer struct {
	to        map[int64]int64
	err       error
	calls     int
	lastOwner int64
}

func (f *fakeSquarer) SquareAvatar(_ context.Context, ownerID, mediaID int64) (int64, error) {
	f.calls++
	f.lastOwner = ownerID
	if f.err != nil {
		return mediaID, f.err
	}
	if id, ok := f.to[mediaID]; ok {
		return id, nil
	}
	return mediaID, nil
}

// Фото профиля у Telegram квадратное: аватаркой становится КВАДРАТ исходника
// (media usecase кладёт его отдельным медиа), и именно его id уходит в профиль,
// галерею и stripped-превью — иначе строка чата и шапка рисуют сплющенный
// неквадратный исходник (tweb `.avatar-photo` без object-fit).
func TestAvatarIsSquared(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	id := seedUser(t, i, "+79990000033")
	ownImages(i, id, 42, 44, 45)
	pv := &fakePreviewer{preview: []byte{1}}
	i.SetAvatarPreviewer(pv)
	sq := &fakeSquarer{to: map[int64]int64{42: 99, 44: 101}}
	i.SetAvatarSquarer(sq)

	ph, err := i.AddProfilePhoto(ctx, id, 42, nil)
	if err != nil {
		t.Fatalf("AddProfilePhoto: %v", err)
	}
	if ph.MediaID != 99 || pv.gotID != 99 || sq.lastOwner != id {
		t.Fatalf("AddProfilePhoto: media=%d preview for %d owner=%d; want квадрат 99 владельца %d", ph.MediaID, pv.gotID, sq.lastOwner, id)
	}

	ph, err = i.AddProfilePhoto(ctx, id, 44, nil)
	if err != nil {
		t.Fatalf("AddProfilePhoto: %v", err)
	}
	if ph.MediaID != 101 || pv.gotID != 101 {
		t.Fatalf("AddProfilePhoto: media=%d preview for %d; want квадрат 101", ph.MediaID, pv.gotID)
	}
	if u, _ := i.GetUser(ctx, id); u.PhotoID == nil || *u.PhotoID != 101 {
		t.Fatalf("аватарка после AddProfilePhoto = %v; want 101", u.PhotoID)
	}

	// Отказ кропа — не повод не поставить фото: ставится исходник.
	i.SetAvatarSquarer(&fakeSquarer{err: errors.New("minio down")})
	if _, err := i.AddProfilePhoto(ctx, id, 45, nil); err != nil {
		t.Fatalf("отказ кропа: %v", err)
	}
	if u, _ := i.GetUser(ctx, id); u.PhotoID == nil || *u.PhotoID != 45 {
		t.Fatalf("отказ кропа: photo=%v; want исходник 45", u.PhotoID)
	}
}

// F7-A (MC-01): фото профиля ставится только своим файлом — иначе чужой
// media_id открывался бы всем по правилу приватности подложившего.
func TestAddProfilePhoto_RejectsForeignMedia(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	me := seedUser(t, i, "+79990000051")
	other := seedUser(t, i, "+79990000052")
	sq := &fakeSquarer{}
	i.SetAvatarSquarer(sq)
	i.SetMediaReader(&fakeMediaReader{m: map[int64]domain.Media{
		10: {ID: 10, OwnerID: other, Mime: "image/jpeg"},
		11: {ID: 11, OwnerID: me, Mime: "image/jpeg"},
		12: {ID: 12, OwnerID: me, Mime: "application/pdf"},
		13: {ID: 13, OwnerID: other, Mime: "video/mp4"},
		14: {ID: 14, OwnerID: me, Mime: "video/mp4"},
	}})

	if _, err := i.AddProfilePhoto(ctx, me, 10, nil); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("чужое фото: err=%v; want ErrNotFound", err)
	}
	if sq.calls != 0 {
		t.Fatalf("кроп звался %d раз для чужого фото", sq.calls)
	}
	if _, err := i.AddProfilePhoto(ctx, me, 12, nil); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не картинка: err=%v; want ErrNotFound", err)
	}
	v := int64(13)
	if _, err := i.AddProfilePhoto(ctx, me, 11, &v); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("чужое видео: err=%v; want ErrNotFound", err)
	}
	if _, err := i.AddProfilePhoto(ctx, me, 999, nil); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("нет файла: err=%v; want ErrNotFound", err)
	}
	if u, _ := i.GetUser(ctx, me); u.PhotoID != nil {
		t.Fatalf("после отказов аватарка = %v; want nil", *u.PhotoID)
	}
	v = 14
	if _, err := i.AddProfilePhoto(ctx, me, 11, &v); err != nil {
		t.Fatalf("своё фото+видео: %v", err)
	}
}

// Не подключённый MediaReader — не тихий 404, а ошибка проводки (500 в ручке).
func TestAddProfilePhoto_UnwiredMediaReader(t *testing.T) {
	i, _, _, _ := newInteractor()
	me := seedUser(t, i, "+79990000053")
	_, err := i.AddProfilePhoto(context.Background(), me, 1, nil)
	if err == nil || errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err=%v; want ошибку проводки, не ErrNotFound", err)
	}
}

func TestSetUsername(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	a := seedUser(t, i, "+79990000001")
	b := seedUser(t, i, "+79990000002")

	if _, err := i.SetUsername(ctx, a, "Denis_M"); err != nil {
		t.Fatalf("SetUsername a: %v", err)
	}
	ua, _ := i.GetUser(ctx, a)
	if ua.Username == nil || *ua.Username != "denis_m" {
		t.Fatalf("username not normalized/stored: %+v", ua.Username)
	}

	// Taken (case-insensitive).
	if _, err := i.SetUsername(ctx, b, "DENIS_M"); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
	// Bad format.
	if _, err := i.SetUsername(ctx, b, "ab"); !errors.Is(err, domain.ErrUsernameFormat) {
		t.Fatalf("expected ErrUsernameFormat, got %v", err)
	}
	// Clear.
	if u, err := i.SetUsername(ctx, a, ""); err != nil || u.Username != nil {
		t.Fatalf("clear username: err=%v username=%v", err, u.Username)
	}
}

func TestCheckUsername(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	a := seedUser(t, i, "+79990000001")
	b := seedUser(t, i, "+79990000002")
	if _, err := i.SetUsername(ctx, a, "taken_one"); err != nil {
		t.Fatalf("seed username: %v", err)
	}

	if ok, _ := i.CheckUsername(ctx, "free_one", b); !ok {
		t.Fatal("free_one should be available")
	}
	if ok, _ := i.CheckUsername(ctx, "taken_one", b); ok {
		t.Fatal("taken_one should be unavailable")
	}
	// Own username counts as available.
	if ok, _ := i.CheckUsername(ctx, "taken_one", a); !ok {
		t.Fatal("own username should be available to self")
	}
	if _, err := i.CheckUsername(ctx, "no", b); !errors.Is(err, domain.ErrUsernameFormat) {
		t.Fatalf("expected format error, got %v", err)
	}
}
