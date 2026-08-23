// Package privacy — настройки конфиденциальности (tweb Privacy and Security):
// правила «кто видит/может» по ключам + глобальный чёрный список. Центральная
// проверка Check используется чатом (писать/звонить/приглашать), presence
// (last seen), контактами (номер) и read-model'ями (фото профиля).
package privacy

import (
	"context"
	"errors"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Repo — хранилище правил, блокировок и справок о контактах/пользователях.
type Repo interface {
	Rules(ctx context.Context, userID int64) ([]domain.PrivacyRuleRecord, error) // только сохранённые
	Upsert(ctx context.Context, userID int64, r domain.PrivacyRuleRecord) error
	Get(ctx context.Context, userID int64, key domain.PrivacyKey) (domain.PrivacyRuleRecord, error) // domain.ErrNotFound → дефолт

	Block(ctx context.Context, blockerID, blockedID int64) error
	Unblock(ctx context.Context, blockerID, blockedID int64) (bool, error)
	IsBlocked(ctx context.Context, blockerID, blockedID int64) (bool, error)
	BlockedList(ctx context.Context, userID int64, offset, limit int) ([]domain.BlockedUser, int, error)

	IsContact(ctx context.Context, ownerID, userID int64) (bool, error)
	// VisibleMap — батч-проверка одним запросом: для каждого owner из ownerIDs
	// решает, видит ли viewer его аспект key (правило + контактность + блок).
	VisibleMap(ctx context.Context, viewerID int64, ownerIDs []int64, key domain.PrivacyKey) (map[int64]bool, error)

	GetUser(ctx context.Context, id int64) (domain.UserRecord, error)
	// TTLPeriod — период автоудаления переписки ЗРИТЕЛЯ с этим пиром в
	// секундах (схемное userFull.ttl_period): auto_delete_period приватного
	// чата, а пока чата нет — глобальный дефолт зрителя, которым такой чат
	// заведётся. 0 — выключено.
	TTLPeriod(ctx context.Context, viewerID, targetID int64) (int, error)
	// ChatTheme — тема оформления переписки ЗРИТЕЛЯ с этим пиром
	// (userFull.theme_emoticon, решение Р7); "" — тема не задана. Прежде она
	// ехала полем КАЖДОЙ строки списка диалогов, хотя в схеме её место — полная
	// карточка.
	ChatTheme(ctx context.Context, viewerID, targetID int64) (string, error)
}

type Interactor struct {
	repo     Repo
	presence PresenceSnapshot // optional: присутствие для user.status
}

func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

// ErrBadRule — неизвестный ключ или недопустимое значение.
var ErrBadRule = errors.New("invalid privacy rule")

// ErrSelfBlock — попытка заблокировать себя.
var ErrSelfBlock = errors.New("cannot block yourself")

// Rules возвращает полный набор правил пользователя (несохранённые — дефолты).
func (i *Interactor) Rules(ctx context.Context, userID int64) ([]domain.PrivacyRuleRecord, error) {
	stored, err := i.repo.Rules(ctx, userID)
	if err != nil {
		return nil, err
	}
	byKey := make(map[domain.PrivacyKey]domain.PrivacyRuleRecord, len(stored))
	for _, r := range stored {
		byKey[r.Key] = r
	}
	out := make([]domain.PrivacyRuleRecord, 0, len(domain.PrivacyKeys))
	for _, k := range domain.PrivacyKeys {
		if r, ok := byKey[k]; ok {
			out = append(out, r)
		} else {
			out = append(out, domain.DefaultPrivacyRule(k))
		}
	}
	return out, nil
}

// Rule возвращает правило ОДНОГО ключа (несохранённое — дефолт).
//
// Спрашивают по одному ключу, как у оригинала (`account.getPrivacy`): ручки
// «все разом» на проводе больше нет, потому что у ответа `account.privacyRules`
// нет параметра ключа — его знает спросивший.
func (i *Interactor) Rule(ctx context.Context, userID int64, key domain.PrivacyKey) (domain.PrivacyRuleRecord, error) {
	rules, err := i.Rules(ctx, userID)
	if err != nil {
		return domain.PrivacyRuleRecord{}, err
	}
	for _, r := range rules {
		if r.Key == key {
			return r, nil
		}
	}
	return domain.DefaultPrivacyRule(key), nil
}

// SetRule валидирует и сохраняет правило одного ключа целиком.
func (i *Interactor) SetRule(ctx context.Context, userID int64, r domain.PrivacyRuleRecord) (domain.PrivacyRuleRecord, error) {
	if !domain.ValidPrivacyKey(r.Key) || !domain.ValidPrivacyValue(r.Key, r.Value) {
		return domain.PrivacyRuleRecord{}, ErrBadRule
	}
	// Сам себе пользователь всегда «виден» — себя в списках не храним.
	r.AllowUserIDs = dropID(r.AllowUserIDs, userID)
	r.DenyUserIDs = dropID(r.DenyUserIDs, userID)
	if err := i.repo.Upsert(ctx, userID, r); err != nil {
		return domain.PrivacyRuleRecord{}, err
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

// Profile собирает профиль пира для viewer в форме ОРИГИНАЛА: пара
// `userFull` + `user` внутри users.userFull. Скрытые правилами приватности
// поля просто не кладутся — «нельзя показать» это ОТСУТСТВИЕ ключа, а не
// пустая строка и не отдельный флаг видимости.
//
// Здесь исчезает третья форма пользователя. Было три витрины (краткая в
// батче, полная чужая, своя в /me) с границей не по той линии: bio и день
// рождения жили в «своей», а verified/premium — в «полной чужой». Стало две,
// как в схеме: verified/premium/bot/emoji_status — краткая карточка,
// bio/birthday/blocked/звонки/ttl — полная.
//
// Флаги `self`/`contact`/`mutual_contact` кладёт вызывающий: чтобы посчитать
// их, нужны обе стороны адресной книги, а Profile отвечает за приватность.
func (i *Interactor) Profile(ctx context.Context, viewerID, targetID int64) (ProfileResult, error) {
	u, err := i.repo.GetUser(ctx, targetID)
	if err != nil {
		return ProfileResult{}, err
	}
	check := func(key domain.PrivacyKey) bool {
		ok, err := i.Check(ctx, targetID, viewerID, key)
		return err == nil && ok
	}

	blocked, _ := i.repo.IsBlocked(ctx, viewerID, targetID)
	calls := check(domain.PrivacyCalls)
	full := domain.NewUserFull(u.ID, domain.UserFullFlags{
		Blocked: blocked,
		// Звонок у нас один — правило PrivacyCalls решает и голосовой, и
		// видео: отдельного правила под видео нет, поэтому оба флага схемы
		// выставляются вместе, а не выдумывается разница.
		PhoneCallsAvailable: calls,
		VideoCallsAvailable: calls,
	})
	full.TTLPeriod, _ = i.repo.TTLPeriod(ctx, viewerID, targetID)
	full.ThemeEmoticon, _ = i.repo.ChatTheme(ctx, viewerID, targetID)
	if check(domain.PrivacyAbout) {
		full.About = u.Bio
	}
	if u.Birthday != nil && check(domain.PrivacyBirthday) {
		// Одна форма дня рождения на весь провод — конструктор birthday. Прежде
		// он ехал объектом в /me и строкой "DD.MM.YYYY" в /users/{id}.
		b := domain.NewBirthday(*u.Birthday)
		full.Birthday = &b
	}

	// Краткая форма того же пользователя. Телефон — по правилу приватности, а
	// не по снятому с пира phone_visibility: механизм на этот вопрос один.
	brief := u.ToUser(domain.UserFlags{Self: viewerID == targetID}, i.status(ctx, u, check(domain.PrivacyLastSeen)), check(domain.PrivacyProfilePhoto))
	if check(domain.PrivacyPhoneNumber) {
		brief.Phone = u.Phone
	}
	return ProfileResult{
		Full:       domain.NewUsersUserFull(full, brief),
		CanMessage: check(domain.PrivacyMessages),
	}, nil
}

// ProfileResult — ответ профиля: КОНСТРУКТОР схемы плюс наши поля РЯДОМ с ним,
// а не внутри.
//
// CanMessage («пройдёт ли отправка сообщения этому пиру») предмет у нас имеет —
// правило приватности PrivacyMessages, — но схемного поля под него нет вовсе:
// в оригинале «нельзя писать» выражается другими механизмами
// (contact_require_premium, settings:PeerSettings), которых у нас не
// существует. Класть своё поле ВНУТРЬ userFull означало бы подделать чужой
// конструктор; штатный механизм для клиентских параметров
// (schema/schema_additional_params.json) требует перегенерации типов на
// фронте, а фронт — шаг D. Поэтому поле живёт на уровне ответа, как muted и
// creator_id у карточки чата.
type ProfileResult struct {
	Full       domain.UsersUserFull
	CanMessage bool
}

// PresenceSnapshot — присутствие пользователя: онлайн ли он и до какого
// момента (дедлайн TTL ключа присутствия), плюс время последнего захода.
// Реализуется presence-менеджером; optional — без него статус не производится.
type PresenceSnapshot interface {
	Status(ctx context.Context, userID int64) (online bool, expires, lastSeen time.Time)
}

// SetPresence подключает источник присутствия (usecase/presence).
func (i *Interactor) SetPresence(p PresenceSnapshot) { i.presence = p }

// status — UserStatus пира глазами зрителя. Правило last_seen не пускает —
// точного времени НЕТ ВОВСЕ: это userStatusRecently, то есть сама приватность
// выражена ВЫБОРОМ КОНСТРУКТОРА, а не отдельным флагом last_seen_visible
// рядом с обнулённым временем.
func (i *Interactor) status(ctx context.Context, u domain.UserRecord, lastSeenVisible bool) domain.UserStatus {
	if u.Deleted {
		return domain.NewUserStatusEmpty()
	}
	if !lastSeenVisible {
		return domain.NewUserStatusRecently(false)
	}
	if i.presence == nil {
		return domain.NewUserStatusEmpty()
	}
	return domain.PresenceStatus(i.presence.Status(ctx, u.ID))
}
