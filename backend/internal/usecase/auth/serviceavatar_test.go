package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Служебный аккаунт получает фото профиля один раз: у оригинала 777000 —
// обычный пир с фотографией от сервера, а не клиентский глиф.
func TestEnsureServiceAvatar(t *testing.T) {
	ctx := context.Background()
	i, users, _, _ := newInteractor()
	users.byPhone["+42777"] = domain.UserRecord{ID: domain.ServiceUserID, FirstName: "Telegram", IsVerified: true, IsService: true}

	calls := 0
	upload := func(context.Context) (int64, error) { calls++; return 900, nil }

	if err := i.EnsureServiceAvatar(ctx, upload); err != nil {
		t.Fatalf("EnsureServiceAvatar: %v", err)
	}
	u, _ := users.GetByID(ctx, domain.ServiceUserID)
	if u.PhotoID == nil || *u.PhotoID != 900 {
		t.Fatalf("фото 777000 = %v; want 900", u.PhotoID)
	}
	if len(users.photos[domain.ServiceUserID]) != 1 {
		t.Fatalf("галерея 777000 = %v; want одна запись", users.photos[domain.ServiceUserID])
	}

	// Повторный старт: фото уже стоит — ничего не заливается.
	if err := i.EnsureServiceAvatar(ctx, upload); err != nil {
		t.Fatalf("EnsureServiceAvatar (повтор): %v", err)
	}
	if calls != 1 {
		t.Fatalf("upload вызван %d раз; want 1", calls)
	}
}

func TestEnsureServiceAvatar_UploadErrorKeepsProfile(t *testing.T) {
	ctx := context.Background()
	i, users, _, _ := newInteractor()
	users.byPhone["+42777"] = domain.UserRecord{ID: domain.ServiceUserID}
	boom := errors.New("minio down")
	if err := i.EnsureServiceAvatar(ctx, func(context.Context) (int64, error) { return 0, boom }); !errors.Is(err, boom) {
		t.Fatalf("err = %v; want %v", err, boom)
	}
	if u, _ := users.GetByID(ctx, domain.ServiceUserID); u.PhotoID != nil {
		t.Fatalf("фото выставлено несмотря на отказ загрузки: %v", *u.PhotoID)
	}
}
