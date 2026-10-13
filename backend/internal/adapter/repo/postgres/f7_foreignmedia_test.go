package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
	usecasestickers "github.com/messenger-denis/backend/internal/usecase/stickers"
)

// F7-A (MC-01), настоящая БД: чужой файл, поданный в фото профиля или свой
// набор стикеров, не становится ни аватаркой, ни стикерным медиа — то есть
// третий пользователь по-прежнему не получает к нему доступ: публичную часть
// chat.CanAccessMedia, которую затрагивают эти два пути, составляют AvatarOwners
// и IsStickerMedia.
func TestF7_ForeignMediaNeverBecomesPublic(t *testing.T) {
	pool := postgres.NewTestDB(t)
	ctx := context.Background()
	a := seedUser(t, pool, "+79990000071")
	b := seedUser(t, pool, "+79990000072")
	foreign := seedMedia(t, pool, b, "f7/b-private") // image/jpeg, владелец B

	ar := NewAuthRepo(pool)
	authUC := usecaseauth.New(ar, ar, ar, ar, ar, "12345", func(string, ...any) {})
	authUC.SetMediaReader(NewMediaRepo(pool))
	if _, err := authUC.AddProfilePhoto(ctx, a, foreign, nil); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("AddProfilePhoto(чужой файл): %v; want ErrNotFound", err)
	}

	sr := NewStickersRepo(pool)
	stUC := usecasestickers.New(sr)
	stUC.SetMediaReader(NewMediaRepo(pool))
	set, err := stUC.CreateSet(ctx, a, "f7_foreign", "F7", "sticker")
	if err != nil {
		t.Fatalf("CreateSet: %v", err)
	}
	if _, err := stUC.AddSticker(ctx, a, set.ID, foreign, "🙂"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("AddSticker(чужой файл): %v; want ErrNotFound", err)
	}

	owners, err := NewMediaAccessRepo(pool).AvatarOwners(ctx, foreign)
	if err != nil || len(owners) != 0 {
		t.Fatalf("AvatarOwners = %v, %v; want пусто", owners, err)
	}
	if ok, err := sr.IsStickerMedia(ctx, foreign); err != nil || ok {
		t.Fatalf("IsStickerMedia = %v, %v; want false", ok, err)
	}

	// Свой файл проходит (контроль, что тест не красный от неверной проводки).
	own := seedMedia(t, pool, a, "f7/a-own")
	if _, err := authUC.AddProfilePhoto(ctx, a, own, nil); err != nil {
		t.Fatalf("AddProfilePhoto(свой): %v", err)
	}
	if _, err := stUC.AddSticker(ctx, a, set.ID, seedMedia(t, pool, a, "f7/a-sticker"), "🙂"); err != nil {
		t.Fatalf("AddSticker(свой): %v", err)
	}
}
