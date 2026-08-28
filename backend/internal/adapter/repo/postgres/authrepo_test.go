package postgres

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

func TestAuthRepo_CodeLifecycle(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()

	if err := repo.SaveCode(ctx, "+700", "12345", time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("SaveCode: %v", err)
	}
	got, err := repo.GetCode(ctx, "+700")
	if err != nil || got != "12345" {
		t.Fatalf("GetCode = %q, %v", got, err)
	}
	if err := repo.DeleteCode(ctx, "+700"); err != nil {
		t.Fatalf("DeleteCode: %v", err)
	}
	if _, err := repo.GetCode(ctx, "+700"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound after delete, got %v", err)
	}
}

func TestAuthRepo_ExpiredCode(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()
	_ = repo.SaveCode(ctx, "+701", "12345", time.Now().Add(-time.Minute))
	if _, err := repo.GetCode(ctx, "+701"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound for expired, got %v", err)
	}
}

func TestAuthRepo_UserAndDeviceAndToken(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()

	u1, err := repo.CreateWithName(ctx, "+702", "Денис", "У")
	if err != nil {
		t.Fatalf("CreateWithName: %v", err)
	}
	if u1.FirstName != "Денис" || u1.LastName != "У" {
		t.Fatalf("имя не сохранено: %+v", u1)
	}
	// Номер уникален: повтор — ErrConflict, а найти существующего можно по номеру.
	if _, err := repo.CreateWithName(ctx, "+702", "Кто-то", ""); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("CreateWithName duplicate = %v, want ErrConflict", err)
	}
	u2, err := repo.ByPhone(ctx, "+702")
	if err != nil || u1.ID != u2.ID {
		t.Fatalf("ByPhone = %+v, %v", u2, err)
	}
	if _, err := repo.ByPhone(ctx, "+70299999"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("ByPhone unknown = %v, want ErrNotFound", err)
	}

	_, err = repo.Create(ctx, u1.ID, "web", "browser", "hash-abc", "", "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, _, err := repo.SessionByTokenHash(ctx, "hash-abc")
	if err != nil {
		t.Fatalf("SessionByTokenHash: %v", err)
	}
	if got.ID != u1.ID {
		t.Fatalf("resolved wrong user: %d != %d", got.ID, u1.ID)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "missing"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound for missing token, got %v", err)
	}
}

func TestAuthRepo_ProfilePhotoGallery(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()

	u, _ := repo.CreateWithName(ctx, "+7100", "Галерея", "")

	// Adding photos promotes each to the current avatar and lists newest-first.
	// Фото адресуется id медиа — content-путь больше нигде не собирается.
	p1, err := repo.AddProfilePhoto(ctx, u.ID, 1, nil, []byte{0xff, 0xd8, 1})
	if err != nil || p1.ID == 0 {
		t.Fatalf("AddProfilePhoto p1: %v", err)
	}
	video := int64(22)
	p2, err := repo.AddProfilePhoto(ctx, u.ID, 2, &video, []byte{0xff, 0xd8, 2})
	if err != nil {
		t.Fatalf("AddProfilePhoto p2: %v", err)
	}
	got, _ := repo.GetByID(ctx, u.ID)
	if got.PhotoID == nil || *got.PhotoID != 2 {
		t.Fatalf("avatar media id after add = %v, want 2", got.PhotoID)
	}
	// stripped-превью текущей аватарки денормализовано в users.avatar_preview.
	if !bytes.Equal(got.PhotoPreview, []byte{0xff, 0xd8, 2}) {
		t.Fatalf("avatar_preview after add = %v, want превью p2", got.PhotoPreview)
	}
	list, err := repo.ListProfilePhotos(ctx, u.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("ListProfilePhotos = %v (len %d), %v", list, len(list), err)
	}
	if list[0].ID != p2.ID || list[1].ID != p1.ID {
		t.Fatalf("expected newest-first order, got %d then %d", list[0].ID, list[1].ID)
	}
	if list[0].VideoMediaID == nil || *list[0].VideoMediaID != 22 {
		t.Fatalf("video media id = %v, want 22", list[0].VideoMediaID)
	}

	// Deleting the current avatar (p2) falls back to the next most-recent (p1).
	newID, err := repo.DeleteProfilePhoto(ctx, u.ID, p2.ID)
	if err != nil || newID == nil || *newID != 1 {
		t.Fatalf("DeleteProfilePhoto(current) = %v, %v", newID, err)
	}
	got, _ = repo.GetByID(ctx, u.ID)
	if got.PhotoID == nil || *got.PhotoID != 1 {
		t.Fatalf("avatar after delete = %v, want 1", got.PhotoID)
	}
	// Превью откатилось вместе с фото — к превью p1.
	if !bytes.Equal(got.PhotoPreview, []byte{0xff, 0xd8, 1}) {
		t.Fatalf("avatar_preview after delete = %v, want превью p1", got.PhotoPreview)
	}

	// Deleting the last photo clears the avatar.
	newID, err = repo.DeleteProfilePhoto(ctx, u.ID, p1.ID)
	if err != nil || newID != nil {
		t.Fatalf("DeleteProfilePhoto(last) = %v, %v", newID, err)
	}
	got, _ = repo.GetByID(ctx, u.ID)
	if got.PhotoPreview != nil || got.PhotoID != nil {
		t.Fatalf("аватарка не снята: photo=%v preview=%v", got.PhotoID, got.PhotoPreview)
	}

	// Deleting another user's / unknown photo is a no-op returning the unchanged avatar.
	other, _ := repo.CreateWithName(ctx, "+7101", "Другой", "")
	op, _ := repo.AddProfilePhoto(ctx, other.ID, 9, nil, nil)
	newID, err = repo.DeleteProfilePhoto(ctx, u.ID, op.ID)
	if err != nil || newID != nil {
		t.Fatalf("DeleteProfilePhoto(other) = %v, %v (should be no-op)", newID, err)
	}
	otherList, _ := repo.ListProfilePhotos(ctx, other.ID)
	if len(otherList) != 1 {
		t.Fatalf("other user's photo should survive, got %d", len(otherList))
	}
}

func TestAuthRepo_SessionListDelete(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()

	u, _ := repo.CreateWithName(ctx, "+790", "Сессии", "")
	d1, _ := repo.Create(ctx, u.ID, "web", "browser", "hash-1", "1.2.3.4", "Almaty, Kazakhstan")
	_, _ = repo.Create(ctx, u.ID, "phone", "ios", "hash-2", "", "")

	// SessionByTokenHash resolves user + device.
	gotUser, gotDevice, err := repo.SessionByTokenHash(ctx, "hash-1")
	if err != nil || gotUser.ID != u.ID || gotDevice != d1.ID {
		t.Fatalf("SessionByTokenHash = %v, %d, %v", gotUser, gotDevice, err)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "missing"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected domain.ErrNotFound, got %v", err)
	}

	// ListByUser returns both.
	devices, err := repo.ListByUser(ctx, u.ID)
	if err != nil || len(devices) != 2 {
		t.Fatalf("ListByUser = %v, %v", devices, err)
	}

	// Delete returns the token hash and removes it.
	th, found, err := repo.Delete(ctx, u.ID, d1.ID)
	if err != nil || !found || th != "hash-1" {
		t.Fatalf("Delete = %q, %v, %v", th, found, err)
	}
	if _, _, err := repo.SessionByTokenHash(ctx, "hash-1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected device gone, got %v", err)
	}
	// Deleting a non-existent / other-user device reports not found.
	if _, found, _ := repo.Delete(ctx, u.ID, 99999); found {
		t.Fatal("expected found=false for unknown device")
	}
}

// Одноразовые артефакты шагов входа: живая запись читается, истёкшая — нет,
// удаление сжигает.
func TestAuthRepo_LoginSteps(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()

	u, err := repo.CreateWithName(ctx, "+7300", "Шаги", "")
	if err != nil {
		t.Fatalf("CreateWithName: %v", err)
	}
	live := time.Now().Add(time.Minute)
	dead := time.Now().Add(-time.Minute)

	// signup_tokens
	if err := repo.SaveSignUpToken(ctx, "su-hash", "+7301", live); err != nil {
		t.Fatalf("SaveSignUpToken: %v", err)
	}
	if phone, err := repo.SignUpTokenPhone(ctx, "su-hash"); err != nil || phone != "+7301" {
		t.Fatalf("SignUpTokenPhone = %q, %v", phone, err)
	}
	_ = repo.SaveSignUpToken(ctx, "su-hash", "+7301", dead)
	if _, err := repo.SignUpTokenPhone(ctx, "su-hash"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("истёкший токен регистрации = %v, want ErrNotFound", err)
	}
	_ = repo.SaveSignUpToken(ctx, "su-hash", "+7301", live)
	if err := repo.DeleteSignUpToken(ctx, "su-hash"); err != nil {
		t.Fatalf("DeleteSignUpToken: %v", err)
	}
	if _, err := repo.SignUpTokenPhone(ctx, "su-hash"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("сожжённый токен регистрации = %v, want ErrNotFound", err)
	}

	// password_recovery_codes
	next := time.Now().Add(30 * time.Second)
	if err := repo.SaveRecoveryCode(ctx, "rc-hash", u.ID, "code-hash", live, next); err != nil {
		t.Fatalf("SaveRecoveryCode: %v", err)
	}
	gotUser, gotCode, gotNext, err := repo.RecoveryCode(ctx, "rc-hash")
	if err != nil || gotUser != u.ID || gotCode != "code-hash" || gotNext.Before(time.Now()) {
		t.Fatalf("RecoveryCode = %d, %q, %v, %v", gotUser, gotCode, gotNext, err)
	}
	_ = repo.SaveRecoveryCode(ctx, "rc-hash", u.ID, "code-hash", dead, next)
	if _, _, _, err := repo.RecoveryCode(ctx, "rc-hash"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("истёкший код = %v, want ErrNotFound", err)
	}
	_ = repo.SaveRecoveryCode(ctx, "rc-hash", u.ID, "code-hash", live, next)
	if err := repo.DeleteRecoveryCode(ctx, "rc-hash"); err != nil {
		t.Fatalf("DeleteRecoveryCode: %v", err)
	}
	if _, _, _, err := repo.RecoveryCode(ctx, "rc-hash"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("сожжённый код = %v, want ErrNotFound", err)
	}

	// web_auth_tokens
	if err := repo.SaveWebAuthToken(ctx, "wt-hash", u.ID, live); err != nil {
		t.Fatalf("SaveWebAuthToken: %v", err)
	}
	if got, err := repo.WebAuthTokenUser(ctx, "wt-hash"); err != nil || got != u.ID {
		t.Fatalf("WebAuthTokenUser = %d, %v", got, err)
	}
	_ = repo.SaveWebAuthToken(ctx, "wt-hash", u.ID, dead)
	if _, err := repo.WebAuthTokenUser(ctx, "wt-hash"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("истёкший веб-токен = %v, want ErrNotFound", err)
	}
	_ = repo.SaveWebAuthToken(ctx, "wt-hash", u.ID, live)
	if err := repo.DeleteWebAuthToken(ctx, "wt-hash"); err != nil {
		t.Fatalf("DeleteWebAuthToken: %v", err)
	}
	if _, err := repo.WebAuthTokenUser(ctx, "wt-hash"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("сожжённый веб-токен = %v, want ErrNotFound", err)
	}
}

// Отложенный сброс аккаунта: одна запись на пользователя, отмена идемпотентна
// (повторные входы не двигают момент отмены, от которого идёт карантин).
func TestAuthRepo_AccountReset(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	repo := NewAuthRepo(pool)
	ctx := context.Background()

	u, err := repo.CreateWithName(ctx, "+7310", "Сброс", "")
	if err != nil {
		t.Fatalf("CreateWithName: %v", err)
	}
	if _, _, err := repo.AccountReset(ctx, u.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("сброса нет = %v, want ErrNotFound", err)
	}

	now := time.Now().Truncate(time.Millisecond)
	deleteAt := now.Add(7 * 24 * time.Hour)
	if err := repo.ScheduleAccountReset(ctx, u.ID, now, deleteAt); err != nil {
		t.Fatalf("ScheduleAccountReset: %v", err)
	}
	gotDelete, gotCancel, err := repo.AccountReset(ctx, u.ID)
	if err != nil || !gotDelete.Equal(deleteAt) || !gotCancel.IsZero() {
		t.Fatalf("AccountReset = %v, %v, %v", gotDelete, gotCancel, err)
	}

	cancelledAt := now.Add(time.Hour)
	if ok, err := repo.CancelAccountReset(ctx, u.ID, cancelledAt); err != nil || !ok {
		t.Fatalf("CancelAccountReset = %v, %v", ok, err)
	}
	// Второй вход отменять уже нечего — отметка остаётся прежней.
	if ok, err := repo.CancelAccountReset(ctx, u.ID, now.Add(2*time.Hour)); err != nil || ok {
		t.Fatalf("повторная отмена = %v, %v, want false", ok, err)
	}
	if _, gotCancel, err = repo.AccountReset(ctx, u.ID); err != nil || !gotCancel.Equal(cancelledAt) {
		t.Fatalf("момент отмены сдвинулся: %v, %v", gotCancel, err)
	}

	// Новый заказ после карантина перезаписывает строку целиком.
	if err := repo.ScheduleAccountReset(ctx, u.ID, now, deleteAt); err != nil {
		t.Fatalf("повторное планирование: %v", err)
	}
	if _, gotCancel, err = repo.AccountReset(ctx, u.ID); err != nil || !gotCancel.IsZero() {
		t.Fatalf("отметка отмены пережила новый заказ: %v, %v", gotCancel, err)
	}

	if err := repo.DeleteAccountReset(ctx, u.ID); err != nil {
		t.Fatalf("DeleteAccountReset: %v", err)
	}
	if _, _, err := repo.AccountReset(ctx, u.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("исполненный сброс = %v, want ErrNotFound", err)
	}
}
