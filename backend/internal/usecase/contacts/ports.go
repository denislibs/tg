// Package contacts is the address-book application logic (interactor + ports).
package contacts

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// ContactsRepo is the persistence the interactor needs. Add is an upsert keyed on
// (owner, user); List/Delete are scoped to the owner so a user only ever touches
// their own address book.
type ContactsRepo interface {
	Add(ctx context.Context, c domain.ContactRecord) (domain.ContactRecord, error)
	List(ctx context.Context, ownerID int64) ([]domain.ContactRecord, error)
	Delete(ctx context.Context, ownerID, userID int64) (found bool, err error)
	// ResolveByPhone ищет зарегистрированного пользователя по нормализованному
	// номеру; domain.ErrNotFound, если номер не зарегистрирован.
	ResolveByPhone(ctx context.Context, phone string) (int64, error)
}

// CustomPhotoRepo хранит личные фото контактов (Telegram personal_photo): фото,
// которое владелец видит вместо настоящего аватара конкретного контакта. Set —
// upsert по паре (owner, contact); Clear — сброс к настоящему аватару; Map —
// батч-выборка для наложения на список контактов. Опционален: без него личные
// фото просто не поддерживаются.
type CustomPhotoRepo interface {
	SetCustomPhoto(ctx context.Context, ownerID, contactUserID, mediaID int64) error
	ClearCustomPhoto(ctx context.Context, ownerID, contactUserID int64) error
	CustomPhotoMap(ctx context.Context, ownerID int64, contactIDs []int64) (map[int64]int64, error)
}

// PrivacyChecker решает вопросы конфиденциальности (usecase/privacy): батчем —
// видимость аспекта key (телефоны в списке), точечно — может ли viewer добавить
// owner по номеру. Опционален: без него фильтры/ограничения не применяются.
type PrivacyChecker interface {
	VisibleMap(ctx context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error)
	Check(ctx context.Context, ownerID, viewerID int64, key domain.PrivacyKey) (bool, error)
}
