package contacts

import (
	"context"
	"errors"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// ErrNameRequired is returned when adding a contact without a first name (the
// only required field, mirroring Telegram's "Имя (обязательно)").
var ErrNameRequired = errors.New("first name is required")

// ErrSelfContact is returned when a user tries to add themselves.
var ErrSelfContact = errors.New("cannot add yourself as a contact")

// ErrPhoneRequired — при добавлении по номеру не передан телефон.
var ErrPhoneRequired = errors.New("phone is required")

// Interactor is the contacts application service.
type Interactor struct {
	repo    ContactsRepo
	privacy PrivacyChecker
	photos  CustomPhotoRepo
}

func New(repo ContactsRepo) *Interactor { return &Interactor{repo: repo} }

// SetPrivacy подключает фильтр видимости телефонов (optional).
func (i *Interactor) SetPrivacy(p PrivacyChecker) { i.privacy = p }

// SetCustomPhotos подключает хранилище личных фото контактов (optional).
func (i *Interactor) SetCustomPhotos(p CustomPhotoRepo) { i.photos = p }

// SetCustomPhoto задаёт личное фото контакта: url подменяет настоящий аватар
// contactUserID в глазах ownerID (список диалогов/контактов/шапка чата). Требует
// подключённого CustomPhotoRepo.
func (i *Interactor) SetCustomPhoto(ctx context.Context, ownerID, contactUserID int64, url string) error {
	if i.photos == nil {
		return domain.ErrNotFound
	}
	if contactUserID == ownerID {
		return ErrSelfContact
	}
	return i.photos.SetCustomPhoto(ctx, ownerID, contactUserID, url)
}

// ClearCustomPhoto сбрасывает личное фото контакта — владелец снова видит его
// настоящий аватар.
func (i *Interactor) ClearCustomPhoto(ctx context.Context, ownerID, contactUserID int64) error {
	if i.photos == nil {
		return domain.ErrNotFound
	}
	return i.photos.ClearCustomPhoto(ctx, ownerID, contactUserID)
}

// AddInput is the payload for saving (or editing) a contact.
type AddInput struct {
	UserID     int64
	FirstName  string
	LastName   string
	Note       string
	SharePhone bool
}

// Add saves a contact in ownerID's address book. Re-adding the same user edits the
// existing entry (upsert). Returns the stored contact enriched with the peer's
// profile fields.
func (i *Interactor) Add(ctx context.Context, ownerID int64, in AddInput) (domain.Contact, error) {
	if in.UserID == ownerID {
		return domain.Contact{}, ErrSelfContact
	}
	first := strings.TrimSpace(in.FirstName)
	if first == "" {
		return domain.Contact{}, ErrNameRequired
	}
	return i.repo.Add(ctx, domain.Contact{
		OwnerID:    ownerID,
		UserID:     in.UserID,
		FirstName:  first,
		LastName:   strings.TrimSpace(in.LastName),
		Note:       strings.TrimSpace(in.Note),
		SharePhone: in.SharePhone,
	})
}

// AddByPhoneInput — добавление контакта по номеру телефона (как tweb
// importContact): сервер резолвит номер в пользователя.
type AddByPhoneInput struct {
	Phone      string
	FirstName  string
	LastName   string
	Note       string
	SharePhone bool
}

// AddByPhone резолвит номер в зарегистрированного пользователя и сохраняет его в
// адресную книгу ownerID. domain.ErrNotFound — номер не зарегистрирован (как
// tweb NO_USER); domain.ErrPrivacy — цель запрещает добавление по номеру
// (правило added_by_phone). first_name обязателен.
func (i *Interactor) AddByPhone(ctx context.Context, ownerID int64, in AddByPhoneInput) (domain.Contact, error) {
	phone := domain.NormalizePhone(in.Phone)
	if phone == "" {
		return domain.Contact{}, ErrPhoneRequired
	}
	first := strings.TrimSpace(in.FirstName)
	if first == "" {
		return domain.Contact{}, ErrNameRequired
	}
	userID, err := i.repo.ResolveByPhone(ctx, phone)
	if err != nil {
		return domain.Contact{}, err // domain.ErrNotFound → «номер не зарегистрирован»
	}
	if userID == ownerID {
		return domain.Contact{}, ErrSelfContact
	}
	// Enforcement added_by_phone: цель может ограничить, кто добавляет её по номеру.
	if i.privacy != nil {
		ok, err := i.privacy.Check(ctx, userID, ownerID, domain.PrivacyAddedByPhone)
		if err != nil {
			return domain.Contact{}, err
		}
		if !ok {
			return domain.Contact{}, domain.ErrPrivacy
		}
	}
	return i.repo.Add(ctx, domain.Contact{
		OwnerID:    ownerID,
		UserID:     userID,
		FirstName:  first,
		LastName:   strings.TrimSpace(in.LastName),
		Note:       strings.TrimSpace(in.Note),
		SharePhone: in.SharePhone,
	})
}

// List returns ownerID's address book, ordered by saved name. Телефон контакта
// скрывается, когда его правило «кто видит мой номер» не разрешает показ.
func (i *Interactor) List(ctx context.Context, ownerID int64) ([]domain.Contact, error) {
	list, err := i.repo.List(ctx, ownerID)
	if err != nil || len(list) == 0 {
		return list, err
	}
	ids := make([]int64, 0, len(list))
	for _, c := range list {
		ids = append(ids, c.UserID)
	}
	if i.privacy != nil {
		vis, err := i.privacy.VisibleMap(ctx, ownerID, ids, domain.PrivacyPhoneNumber)
		if err != nil {
			return nil, err
		}
		for idx := range list {
			if !vis[list[idx].UserID] {
				list[idx].Phone = ""
			}
		}
	}
	// Личное фото: подменяем настоящий аватар контакта тем, что владелец задал сам.
	if i.photos != nil {
		custom, err := i.photos.CustomPhotoMap(ctx, ownerID, ids)
		if err != nil {
			return nil, err
		}
		for idx := range list {
			if url, ok := custom[list[idx].UserID]; ok {
				list[idx].AvatarURL = url
				list[idx].HasCustomPhoto = true
			}
		}
	}
	return list, nil
}

// Delete removes a contact from ownerID's address book; found is false when there
// was no such entry.
func (i *Interactor) Delete(ctx context.Context, ownerID, userID int64) (bool, error) {
	return i.repo.Delete(ctx, ownerID, userID)
}
