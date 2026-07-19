// Package privacy — настройки конфиденциальности (tweb Privacy and Security):
// правила «кто видит/может» по ключам + глобальный чёрный список. Центральная
// проверка Check используется чатом (писать/звонить/приглашать), presence
// (last seen), контактами (номер) и read-model'ями (фото профиля).
package privacy

import (
	"context"
	"errors"
	"github.com/messenger-denis/backend/internal/domain"
)

// Repo — хранилище правил, блокировок и справок о контактах/пользователях.
type Repo interface {
	Rules(ctx context.Context, userID int64) ([]domain.PrivacyRule, error) // только сохранённые
	Upsert(ctx context.Context, userID int64, r domain.PrivacyRule) error
	Get(ctx context.Context, userID int64, key domain.PrivacyKey) (domain.PrivacyRule, error) // domain.ErrNotFound → дефолт

	Block(ctx context.Context, blockerID, blockedID int64) error
	Unblock(ctx context.Context, blockerID, blockedID int64) (bool, error)
	IsBlocked(ctx context.Context, blockerID, blockedID int64) (bool, error)
	BlockedList(ctx context.Context, userID int64, offset, limit int) ([]domain.BlockedUser, int, error)

	IsContact(ctx context.Context, ownerID, userID int64) (bool, error)
	// VisibleMap — батч-проверка одним запросом: для каждого owner из ownerIDs
	// решает, видит ли viewer его аспект key (правило + контактность + блок).
	VisibleMap(ctx context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error)

	GetUser(ctx context.Context, id int64) (domain.User, error)
	IsVerified(ctx context.Context, id int64) (bool, error)
	IsBot(ctx context.Context, id int64) (bool, error)
}

type Interactor struct{ repo Repo }

func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

// ErrBadRule — неизвестный ключ или недопустимое значение.
var ErrBadRule = errors.New("invalid privacy rule")

// ErrSelfBlock — попытка заблокировать себя.
var ErrSelfBlock = errors.New("cannot block yourself")

// Rules возвращает полный набор правил пользователя (несохранённые — дефолты).
func (i *Interactor) Rules(ctx context.Context, userID int64) ([]domain.PrivacyRule, error) {
	stored, err := i.repo.Rules(ctx, userID)
	if err != nil {
		return nil, err
	}
	byKey := make(map[domain.PrivacyKey]domain.PrivacyRule, len(stored))
	for _, r := range stored {
		byKey[r.Key] = r
	}
	out := make([]domain.PrivacyRule, 0, len(domain.PrivacyKeys))
	for _, k := range domain.PrivacyKeys {
		if r, ok := byKey[k]; ok {
			out = append(out, r)
		} else {
			out = append(out, domain.DefaultPrivacyRule(k))
		}
	}
	return out, nil
}

// SetRule валидирует и сохраняет правило одного ключа целиком.
func (i *Interactor) SetRule(ctx context.Context, userID int64, r domain.PrivacyRule) (domain.PrivacyRule, error) {
	if !domain.ValidPrivacyKey(r.Key) || !domain.ValidPrivacyValue(r.Key, r.Value) {
		return domain.PrivacyRule{}, ErrBadRule
	}
	// Сам себе пользователь всегда «виден» — себя в списках не храним.
	r.AllowUserIDs = dropID(r.AllowUserIDs, userID)
	r.DenyUserIDs = dropID(r.DenyUserIDs, userID)
	if err := i.repo.Upsert(ctx, userID, r); err != nil {
		return domain.PrivacyRule{}, err
	}
	return r, nil
}

func dropID(ids []int64, id int64) []int64 {
	out := ids[:0]
	for _, v := range ids {
		if v != id {
			out = append(out, v)
		}
	}
	return out
}

// Check — центральный вопрос «viewer может видеть/делать key по отношению к
// owner?». Сам себе и служебному аккаунту — всегда можно; блокировка (owner
// заблокировал viewer) закрывает всё.
func (i *Interactor) Check(ctx context.Context, ownerID, viewerID int64, key domain.PrivacyKey) (bool, error) {
	if ownerID == viewerID || viewerID == domain.ServiceUserID || ownerID == domain.ServiceUserID {
		return true, nil
	}
	if blocked, err := i.repo.IsBlocked(ctx, ownerID, viewerID); err != nil {
		return false, err
	} else if blocked {
		return false, nil
	}
	rule, err := i.repo.Get(ctx, ownerID, key)
	if errors.Is(err, domain.ErrNotFound) {
		rule = domain.DefaultPrivacyRule(key)
	} else if err != nil {
		return false, err
	}
	isContact, err := i.repo.IsContact(ctx, ownerID, viewerID)
	if err != nil {
		return false, err
	}
	return rule.Allows(viewerID, isContact), nil
}

// VisibleMap — батч-версия Check для read-model'ей (аватарки списка чатов,
// онлайн участников): один SQL-запрос на пачку владельцев.
func (i *Interactor) VisibleMap(ctx context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error) {
	if len(ownerIDs) == 0 {
		return map[int64]bool{}, nil
	}
	return i.repo.VisibleMap(ctx, viewerID, ownerIDs, key)
}

// Block добавляет пользователя в чёрный список.
func (i *Interactor) Block(ctx context.Context, userID, targetID int64) error {
	if userID == targetID {
		return ErrSelfBlock
	}
	return i.repo.Block(ctx, userID, targetID)
}

// Unblock убирает пользователя из чёрного списка.
func (i *Interactor) Unblock(ctx context.Context, userID, targetID int64) error {
	_, err := i.repo.Unblock(ctx, userID, targetID)
	return err
}

// Blocked возвращает страницу чёрного списка и общее число записей.
func (i *Interactor) Blocked(ctx context.Context, userID int64, offset, limit int) ([]domain.BlockedUser, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return i.repo.BlockedList(ctx, userID, offset, limit)
}

// Profile собирает карточку чужого профиля для viewer: скрытые privacy-поля
// вычищены, добавлены вычисленные can_message/calls_available (tweb UserFull).
func (i *Interactor) Profile(ctx context.Context, viewerID, targetID int64) (domain.UserProfile, error) {
	u, err := i.repo.GetUser(ctx, targetID)
	if err != nil {
		return domain.UserProfile{}, err
	}
	p := domain.UserProfile{
		ID: u.ID, Username: u.Username,
		FirstName: u.FirstName, LastName: u.LastName, DisplayName: u.DisplayName,
	}
	p.Verified, _ = i.repo.IsVerified(ctx, targetID)
	p.IsBot, _ = i.repo.IsBot(ctx, targetID)
	p.IsBlocked, _ = i.repo.IsBlocked(ctx, viewerID, targetID)

	check := func(key domain.PrivacyKey) bool {
		ok, err := i.Check(ctx, targetID, viewerID, key)
		return err == nil && ok
	}
	if check(domain.PrivacyProfilePhoto) {
		p.AvatarURL = u.AvatarURL
	}
	if check(domain.PrivacyAbout) {
		p.Bio = u.Bio
	}
	if check(domain.PrivacyPhoneNumber) {
		p.Phone = u.Phone
	}
	if u.Birthday != nil && check(domain.PrivacyBirthday) {
		s := u.Birthday.Format("02.01")
		if u.Birthday.Year() != domain.BirthdayNoYear {
			s = u.Birthday.Format("02.01.2006")
		}
		p.Birthday = &s
	}
	p.LastSeenOK = check(domain.PrivacyLastSeen)
	p.CallsAvailable = check(domain.PrivacyCalls)
	p.CanMessage = check(domain.PrivacyMessages)
	return p, nil
}
