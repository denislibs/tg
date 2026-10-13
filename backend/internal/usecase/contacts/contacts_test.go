package contacts

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
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

func (f *fakeCustomPhotos) ClearCustomPhoto(context.Context, int64, int64) error { return nil }

func (f *fakeCustomPhotos) CustomPhotoMap(context.Context, int64, []int64) (map[int64]int64, error) {
	return nil, nil
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
