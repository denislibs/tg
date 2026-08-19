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

// SetAvatar с подключённым превьюером кладёт stripped-превью аватарки в
// профиль; без превьюера (или для не-медийного url) аватарка ставится без
// превью — мягкая деградация.
func TestSetAvatarStrippedPreview(t *testing.T) {
	ctx := context.Background()
	i, _, _, _ := newInteractor()
	id := seedUser(t, i, "+79990000031")

	stripped := []byte{0xff, 0xd8, 0xff, 0xe0, 5}
	pv := &fakePreviewer{preview: stripped}
	i.SetAvatarPreviewer(pv)

	u, err := i.SetAvatar(ctx, id, 42)
	if err != nil {
		t.Fatalf("SetAvatar: %v", err)
	}
	if pv.gotID != 42 {
		t.Fatalf("previewer got media id %d, want 42", pv.gotID)
	}
	if !bytes.Equal(u.PhotoPreview, stripped) {
		t.Fatalf("PhotoPreview = %v, want %v", u.PhotoPreview, stripped)
	}

	// Без превьюера аватарка ставится, превью пустое (старое поведение не ломается).
	i2, _, _, _ := newInteractor()
	id2 := seedUser(t, i2, "+79990000032")
	u2, err := i2.SetAvatar(ctx, id2, 43)
	if err != nil {
		t.Fatalf("SetAvatar without previewer: %v", err)
	}
	if u2.PhotoID == nil || *u2.PhotoID != 43 || u2.PhotoPreview != nil {
		t.Fatalf("without previewer: photo=%v preview=%v", u2.PhotoID, u2.PhotoPreview)
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
