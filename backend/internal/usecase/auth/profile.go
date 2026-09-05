package auth

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

const maxBioLen = 70

// emitUserUpdate logs and broadcasts a user_update after a profile change so
// clients re-render the peer everywhere it's shown (name/username, and avatar on
// refetch). Fan-out = the user's own sessions + users sharing a chat (partners).
// Each recipient's row is appended to their per-user update log, so /sync catch-up
// replays the change and the pts cursor stays dense (Wave 2); the live frame
// carries that same per-recipient pts. Optional deps degrade: without an update
// log nothing is logged (still published, pts-less for back-compat); without a
// publisher nothing is pushed (still logged); without partners the fan-out is the
// user's own devices only.
//
// Кадр несёт КОНСТРУКТОР `user` целиком, а не выборку плоских полей: получатель
// кладёт его в свой кэш пиров ровно так же, как объект из любого списка. Прежний
// payload вместо этого сообщал `display_name` (имя собирает клиент — его на
// проводе больше нет) и флажок `avatar_changed`, по которому карточку надо было
// перезапрашивать отдельной ручкой.
//
// Аватарка при этом гасится ПОКАЖДОМУ получателю: photo живёт внутри `user`, и
// без проверки правила profile_photo кадр раздал бы фото тем, кому владелец его
// закрыл. Проверяющий необязателен — без него фото в кадре нет вовсе.
func (i *Interactor) emitUserUpdate(ctx context.Context, u domain.UserRecord) {
	if i.pub == nil && i.updates == nil {
		return
	}
	// Строка журнала одна на всех — в ней фото нет: журнал переигрывается при
	// /sync, а к тому моменту правило приватности может стать другим.
	logged := domain.NewUpdateUserSnapshot(u.ToUser(domain.UserFlags{}, nil, false))
	payload, err := json.Marshal(logged)
	if err != nil {
		return
	}
	// Recipients: own devices first, then shared-chat peers (dedup not needed —
	// partners excludes self).
	recipients := []int64{u.ID}
	if i.partners != nil {
		partners, err := i.partners(ctx, u.ID)
		if err != nil {
			i.logf("[user_update] partners for %d: %v", u.ID, err)
		}
		recipients = append(recipients, partners...)
	}
	date := time.Now().UnixMilli()
	for _, uid := range recipients {
		live := domain.NewUpdateUserSnapshot(u.ToUser(domain.UserFlags{Self: uid == u.ID}, nil, i.photoVisible(ctx, u.ID, uid)))
		env := map[string]any{"t": "user_update", "d": live}
		if i.updates != nil {
			if pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, "user_update", payload); e == nil {
				// Курсор едет в КОНВЕРТЕ: своего параметра pts у этого
				// конструктора нет (см. domain.UpdateDeclaresPts), а дописать
				// его в тело значило бы завести поле, которого в схеме нет.
				env["pts"] = pts
			} else {
				i.logf("[user_update] append for %d: %v", uid, e)
			}
		}
		if i.pub == nil {
			continue
		}
		b, e := json.Marshal(env)
		if e != nil {
			continue
		}
		_ = i.pub.PublishToUser(ctx, uid, b)
	}
}

// photoVisible — пускает ли правило profile_photo владельца зрителя к аватарке.
// Себе — всегда; проверяющего нет — не пускаем (фото просто не едет в кадре).
func (i *Interactor) photoVisible(ctx context.Context, ownerID, viewerID int64) bool {
	if ownerID == viewerID {
		return true
	}
	if i.privacy == nil {
		return false
	}
	ok, err := i.privacy.Check(ctx, ownerID, viewerID, domain.PrivacyProfilePhoto)
	return err == nil && ok
}

// ProfileInput carries the editable profile fields for UpdateProfile.
//
// PhoneVisibility здесь больше нет: видимость номера — это ПРАВИЛО
// ПРИВАТНОСТИ (PrivacyPhoneNumber, ручка /me/privacy/phone_number), а не поле
// профиля. Два независимых механизма на один вопрос, не синхронизированные
// между собой, — это и был дефект 2 разбора.
type ProfileInput struct {
	FirstName string
	LastName  string
	Bio       string
	Birthday  *time.Time
}

// GetUser returns the full, fresh user record from the store. The user in the
// request context is a (possibly cached) session copy that can be stale right
// after an edit, so profile reads/writes go through here.
func (i *Interactor) GetUser(ctx context.Context, id int64) (domain.UserRecord, error) {
	return i.users.GetByID(ctx, id)
}

// UpdateProfile validates and persists the editable profile fields.
func (i *Interactor) UpdateProfile(ctx context.Context, id int64, in ProfileInput) (domain.UserRecord, error) {
	first := strings.TrimSpace(in.FirstName)
	if first == "" {
		return domain.UserRecord{}, errors.New("first name required")
	}
	if utf8.RuneCountInString(in.Bio) > maxBioLen {
		return domain.UserRecord{}, errors.New("bio too long")
	}
	u, err := i.users.UpdateProfile(ctx, id, first, strings.TrimSpace(in.LastName), in.Bio, in.Birthday)
	if err == nil {
		i.emitUserUpdate(ctx, u) // имя/фамилия могли измениться
	}
	return u, err
}

// SetEmojiStatus validates and persists the user's emoji status. An empty string
// clears it; otherwise it must be a short unicode emoji (≤ MaxEmojiStatusRunes
// runes), not free text.
func (i *Interactor) SetEmojiStatus(ctx context.Context, id int64, emoji string) (domain.UserRecord, error) {
	emoji = strings.TrimSpace(emoji)
	if utf8.RuneCountInString(emoji) > domain.MaxEmojiStatusRunes {
		return domain.UserRecord{}, errors.New("emoji status too long")
	}
	return i.users.SetEmojiStatus(ctx, id, emoji)
}

// ActivatePremium flips the user's Telegram Premium flag on. This is a clone: the
// "purchase" is faked, there's no billing — activating simply grants the badge.
func (i *Interactor) ActivatePremium(ctx context.Context, id int64) (domain.UserRecord, error) {
	return i.users.SetPremium(ctx, id, true)
}

// CheckoutPremium runs the mock card checkout for a plan: it validates the plan,
// creates or extends the subscription (a still-active subscription is stacked so
// the paid months add to whatever is left) and flips the Premium badge on. Card
// details are validated on the client and ignored here — any well-formed card is
// a "success". It returns the fresh user and the resulting subscription.
func (i *Interactor) CheckoutPremium(ctx context.Context, id int64, planID string) (domain.UserRecord, domain.PremiumSubscription, error) {
	plan, ok := domain.PremiumPlanByID(planID)
	if !ok {
		return domain.UserRecord{}, domain.PremiumSubscription{}, domain.ErrInvalid
	}
	now := time.Now().UTC()
	// Stack onto remaining time when the current subscription is still active.
	base := now
	if cur, err := i.premium.GetPremiumSubscription(ctx, id); err == nil && cur.ExpiresAt.After(now) {
		base = cur.ExpiresAt
	}
	sub, err := i.premium.UpsertPremiumSubscription(ctx, domain.PremiumSubscription{
		UserID:     id,
		Plan:       plan.ID,
		PriceCents: plan.PriceCents,
		StartedAt:  now,
		ExpiresAt:  base.AddDate(0, plan.Months, 0),
		AutoRenew:  true,
	})
	if err != nil {
		return domain.UserRecord{}, domain.PremiumSubscription{}, err
	}
	user, err := i.users.SetPremium(ctx, id, true)
	if err != nil {
		return domain.UserRecord{}, domain.PremiumSubscription{}, err
	}
	return user, sub, nil
}

// PremiumSubscription returns the user's current subscription, or
// domain.ErrNotFound when they never subscribed.
func (i *Interactor) PremiumSubscription(ctx context.Context, id int64) (domain.PremiumSubscription, error) {
	return i.premium.GetPremiumSubscription(ctx, id)
}

// CancelPremiumAutoRenew disables auto-renew: the subscription stays active until
// its expiry, then lapses. Returns domain.ErrNotFound when there is none.
func (i *Interactor) CancelPremiumAutoRenew(ctx context.Context, id int64) (domain.PremiumSubscription, error) {
	return i.premium.SetPremiumAutoRenew(ctx, id, false)
}

// CheckUsername validates the format and reports whether the username is free
// for the given user (its own current username counts as available).
func (i *Interactor) CheckUsername(ctx context.Context, raw string, forUserID int64) (bool, error) {
	n := domain.NormalizeUsername(raw)
	if err := domain.ValidateUsername(n); err != nil {
		return false, err
	}
	return i.users.UsernameAvailable(ctx, n, forUserID)
}

// SetUsername sets the username (empty clears it), returning domain.ErrConflict
// when already taken or a format error for an invalid value.
func (i *Interactor) SetUsername(ctx context.Context, id int64, raw string) (domain.UserRecord, error) {
	n := domain.NormalizeUsername(raw)
	var up *string
	if n != "" {
		if err := domain.ValidateUsername(n); err != nil {
			return domain.UserRecord{}, err
		}
		up = &n
	}
	u, err := i.users.SetUsername(ctx, id, up)
	if err == nil {
		i.emitUserUpdate(ctx, u)
	}
	return u, err
}

// avatarPreviewFor резолвит stripped-превью аватарки по id медиа. Прежде
// сюда приезжала СТРОКА "/media/{id}/content", которую тут же разбирали
// обратно `Sscanf`-ом ради того же числа: id собирали в delivery, чтобы
// выпарсить в usecase. Аватарка адресуется id медиа на всём пути, и
// выпарсивать больше нечего.
//
// nil — превьюер не подключён или превью сгенерировать не удалось: аватарка
// ставится без превью (мягкая деградация, как у остальных
// optional-зависимостей).
func (i *Interactor) avatarPreviewFor(ctx context.Context, mediaID int64) []byte {
	if i.previews == nil || mediaID <= 0 {
		return nil
	}
	p, err := i.previews.StrippedPreview(ctx, mediaID)
	if err != nil {
		i.logf("[avatar] stripped preview for media %d: %v", mediaID, err)
		return nil
	}
	return p
}

// SetAvatar points the user's avatar at an uploaded media object and appends it
// to the profile-photo gallery so the two stay consistent (Telegram keeps every
// avatar as a gallery photo). Returns the fresh user.
func (i *Interactor) SetAvatar(ctx context.Context, id, mediaID int64) (domain.UserRecord, error) {
	if _, err := i.users.AddProfilePhoto(ctx, id, mediaID, nil, i.avatarPreviewFor(ctx, mediaID)); err != nil {
		return domain.UserRecord{}, err
	}
	u, err := i.users.GetByID(ctx, id)
	if err == nil {
		i.emitUserUpdate(ctx, u)
	}
	return u, err
}

// AddProfilePhoto adds a photo to the user's gallery and promotes it to the
// current avatar. videoMediaID — необязательный видео-вариант аватарки.
func (i *Interactor) AddProfilePhoto(ctx context.Context, userID, mediaID int64, videoMediaID *int64) (domain.ProfilePhoto, error) {
	ph, err := i.users.AddProfilePhoto(ctx, userID, mediaID, videoMediaID, i.avatarPreviewFor(ctx, mediaID))
	if err == nil {
		if u, gerr := i.users.GetByID(ctx, userID); gerr == nil {
			i.emitUserUpdate(ctx, u)
		}
	}
	return ph, err
}

// ListProfilePhotos returns a user's profile-photo gallery, newest first.
func (i *Interactor) ListProfilePhotos(ctx context.Context, userID int64) ([]domain.ProfilePhoto, error) {
	return i.users.ListProfilePhotos(ctx, userID)
}

// DeleteProfilePhoto removes a gallery photo addressed by media id; when it was
// the current avatar the repo falls the avatar back to the next most-recent
// photo (or none). domain.ErrNotFound, если чужого/несуществующего media id не
// нашлось — вызывающий (ручка) обязан ответить честно, не boolTrue.
func (i *Interactor) DeleteProfilePhoto(ctx context.Context, userID, mediaID int64) error {
	_, err := i.users.DeleteProfilePhoto(ctx, userID, mediaID)
	if err == nil {
		if u, gerr := i.users.GetByID(ctx, userID); gerr == nil {
			i.emitUserUpdate(ctx, u) // avatar may have fallen back to another photo
		}
	}
	return err
}
