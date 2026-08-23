package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
	usecaseauth "github.com/messenger-denis/backend/internal/usecase/auth"
)

// ProfileHandler serves the current user's profile read/edit endpoints.
type ProfileHandler struct{ uc *usecaseauth.Interactor }

func NewProfileHandler(uc *usecaseauth.Interactor) *ProfileHandler { return &ProfileHandler{uc: uc} }

// userJSON — собственный профиль на проводе: ТА ЖЕ пара конструкторов, что и у
// чужого (users.userFull{full_user, users}), а не третья форма. Третья форма и
// была тем, из-за чего bio с днём рождения жили в «своей» витрине, а
// verified/premium — в «полной чужой»: границу проводили мы, а не схема.
//
// Правила приватности здесь не спрашиваются вовсе — зритель и владелец один и
// тот же человек, и Check для такой пары всегда пропускает. Форма ответа при
// этом совпадает с чужим профилем (privacy.Profile) буква в букву: клиенту
// нечего разбирать двумя путями.
func userJSON(u domain.UserRecord) map[string]any {
	full := domain.NewUserFull(u.ID, domain.UserFullFlags{
		PhoneCallsAvailable: true,
		VideoCallsAvailable: true,
	})
	full.About = u.Bio
	// ttl_period своей карточки — глобальный период автоудаления
	// (messages.setDefaultHistoryTTL): им заводятся новые чаты.
	full.TTLPeriod = u.AutoDeletePeriod
	if u.Birthday != nil {
		b := domain.NewBirthday(*u.Birthday)
		full.Birthday = &b
	}
	brief := u.ToUser(domain.UserFlags{Self: true}, nil, true)
	brief.Phone = u.Phone
	// can_message — наше поле РЯДОМ с конструктором, а не внутри: схемного
	// места у него нет (см. privacy.ProfileResult). Себе написать можно всегда
	// — это «Избранное».
	return map[string]any{"user_full": domain.NewUsersUserFull(full, brief), "can_message": true}
}

type birthdayBody struct {
	Day   int  `json:"day"`
	Month int  `json:"month"`
	Year  *int `json:"year"`
}

// parseBirthday converts the optional JSON birthday into a *time.Time. A nil raw
// (key absent) or an explicit null both yield (nil, nil): the key being absent is
// handled by the caller (it keeps the current value); an explicit null clears it.
func parseBirthday(raw json.RawMessage) (*time.Time, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var b birthdayBody
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, errors.New("invalid birthday")
	}
	if b.Day < 1 || b.Day > 31 || b.Month < 1 || b.Month > 12 {
		return nil, errors.New("invalid birthday")
	}
	year := domain.BirthdayNoYear
	if b.Year != nil {
		if *b.Year < 1900 || *b.Year > time.Now().Year() {
			return nil, errors.New("invalid birthday year")
		}
		year = *b.Year
	}
	t := time.Date(year, time.Month(b.Month), b.Day, 0, 0, 0, 0, time.UTC)
	// Reject overflow (e.g. 31 Feb rolled into March).
	if t.Day() != b.Day || int(t.Month()) != b.Month {
		return nil, errors.New("invalid birthday")
	}
	return &t, nil
}

// Me returns the current user's full, fresh profile.
func (h *ProfileHandler) Me(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	fresh, err := h.uc.GetUser(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "load profile failed")
		return
	}
	writeJSON(w, http.StatusOK, userJSON(fresh))
}

type updateProfileBody struct {
	FirstName *string         `json:"first_name"`
	LastName  *string         `json:"last_name"`
	Bio       *string         `json:"bio"`
	Birthday  json.RawMessage `json:"birthday"`
}

// Update applies a partial edit to the current user's profile (PATCH /me): only
// the provided keys change; the rest keep their current values.
func (h *ProfileHandler) Update(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	var body updateProfileBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	cur, err := h.uc.GetUser(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "load profile failed")
		return
	}
	in := usecaseauth.ProfileInput{
		FirstName: cur.FirstName,
		LastName:  cur.LastName,
		Bio:       cur.Bio,
		Birthday:  cur.Birthday,
	}
	if body.FirstName != nil {
		in.FirstName = *body.FirstName
	}
	if body.LastName != nil {
		in.LastName = *body.LastName
	}
	if body.Bio != nil {
		in.Bio = *body.Bio
	}
	if body.Birthday != nil { // key present (object or explicit null)
		bday, err := parseBirthday(body.Birthday)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		in.Birthday = bday
	}
	user, err := h.uc.UpdateProfile(r.Context(), u.ID, in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, userJSON(user))
}

// DeleteAccount soft-deletes (anonymizes) the current user's account and revokes
// every session (DELETE /me). The client should drop its token and return to the
// login screen, as with a normal logout.
func (h *ProfileHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	if err := h.uc.DeleteAccount(r.Context(), u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "delete account failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

type usernameBody struct {
	Username string `json:"username"`
}

// SetUsername sets or clears the current user's username (PUT /me/username).
func (h *ProfileHandler) SetUsername(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	var body usernameBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	user, err := h.uc.SetUsername(r.Context(), u.ID, body.Username)
	if errors.Is(err, domain.ErrConflict) {
		writeError(w, http.StatusConflict, "username_taken")
		return
	}
	if errors.Is(err, domain.ErrUsernameFormat) {
		writeError(w, http.StatusBadRequest, "username_format")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "set username failed")
		return
	}
	writeJSON(w, http.StatusOK, userJSON(user))
}

// CheckUsername reports whether a username is valid and free for the current
// user (GET /username/available?u=...).
func (h *ProfileHandler) CheckUsername(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	raw := r.URL.Query().Get("u")
	available, err := h.uc.CheckUsername(r.Context(), raw, u.ID)
	if errors.Is(err, domain.ErrUsernameFormat) {
		writeJSON(w, http.StatusOK, map[string]any{"available": false, "reason": "format"})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "check failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": available})
}

type avatarBody struct {
	MediaID int64 `json:"media_id"`
}

// SetAvatar points the user's avatar at an uploaded media object (PUT /me/avatar).
// It also appends the photo to the gallery (the usecase keeps the denormalized
// avatar and the gallery consistent), so old clients on this route stay in sync.
func (h *ProfileHandler) SetAvatar(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	var body avatarBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.MediaID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	user, err := h.uc.SetAvatar(r.Context(), u.ID, body.MediaID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "set avatar failed")
		return
	}
	writeJSON(w, http.StatusOK, userJSON(user))
}

type emojiStatusBody struct {
	Emoji string `json:"emoji"`
}

// SetEmojiStatus sets or clears the current user's emoji status
// (PUT /me/emoji_status). Empty emoji clears it.
func (h *ProfileHandler) SetEmojiStatus(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	var body emojiStatusBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	user, err := h.uc.SetEmojiStatus(r.Context(), u.ID, body.Emoji)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, userJSON(user))
}

// ActivatePremium turns on the current user's Telegram Premium flag
// (POST /me/premium). A clone: the purchase is faked, this just grants the badge.
func (h *ProfileHandler) ActivatePremium(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	user, err := h.uc.ActivatePremium(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "activate premium failed")
		return
	}
	writeJSON(w, http.StatusOK, userJSON(user))
}

// subscriptionJSON is the wire shape for a Premium subscription.
func subscriptionJSON(s domain.PremiumSubscription) map[string]any {
	return map[string]any{
		"plan":        s.Plan,
		"price_cents": s.PriceCents,
		"started_at":  s.StartedAt.UTC().Format(time.RFC3339),
		"expires_at":  s.ExpiresAt.UTC().Format(time.RFC3339),
		"auto_renew":  s.AutoRenew,
	}
}

type checkoutBody struct {
	Plan string `json:"plan"`
	// Card is the mock payment detail. It is validated on the client and ignored
	// by the server (clone: no real billing).
	Card json.RawMessage `json:"card"`
}

// Checkout runs the mock card checkout (POST /me/premium/checkout): it validates
// the plan, creates or extends the subscription, flips Premium on, and returns
// the fresh user together with the subscription. Card data is ignored.
func (h *ProfileHandler) Checkout(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	var body checkoutBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	user, sub, err := h.uc.CheckoutPremium(r.Context(), u.ID, body.Plan)
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid plan")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "checkout failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":         userJSON(user),
		"subscription": subscriptionJSON(sub),
	})
}

// PremiumSubscription returns the current subscription (GET
// /me/premium/subscription), or {"subscription": null} when there is none.
func (h *ProfileHandler) PremiumSubscription(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	sub, err := h.uc.PremiumSubscription(r.Context(), u.ID)
	if errors.Is(err, domain.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"subscription": nil})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "load subscription failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscription": subscriptionJSON(sub)})
}

// CancelPremium disables auto-renew (POST /me/premium/cancel): the subscription
// stays active until it expires. Returns the updated subscription.
func (h *ProfileHandler) CancelPremium(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	sub, err := h.uc.CancelPremiumAutoRenew(r.Context(), u.ID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no subscription")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cancel failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscription": subscriptionJSON(sub)})
}

// profilePhotoJSON is the wire shape for one gallery photo. Фото адресуется id
// медиа — тем же числом, которого ждёт клиентский downloadMediaURL; строку
// «/media/N/content» больше никто не строит и не разбирает обратно.
func profilePhotoJSON(p domain.ProfilePhoto) map[string]any {
	var video any
	if p.VideoMediaID != nil {
		video = *p.VideoMediaID
	}
	return map[string]any{
		"id":             p.ID,
		"media_id":       p.MediaID,
		"video_media_id": video, // null when absent
		"created_at":     p.CreatedAt.Format(time.RFC3339),
	}
}

type addPhotoBody struct {
	MediaID      int64 `json:"media_id"`
	VideoMediaID int64 `json:"video_media_id"`
}

// AddPhoto adds a photo to the current user's gallery and promotes it to the
// current avatar (POST /me/photos). Body: {media_id, video_media_id?}.
func (h *ProfileHandler) AddPhoto(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	var body addPhotoBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.MediaID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	var videoMediaID *int64
	if body.VideoMediaID > 0 {
		videoMediaID = &body.VideoMediaID
	}
	photo, err := h.uc.AddProfilePhoto(r.Context(), u.ID, body.MediaID, videoMediaID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "add photo failed")
		return
	}
	writeJSON(w, http.StatusOK, profilePhotoJSON(photo))
}

// ListPhotos returns a user's profile-photo gallery, newest first
// (GET /users/{userID}/photos). MVP: no per-photo privacy filtering yet — the
// media GET endpoint still enforces access when bytes are served.
func (h *ProfileHandler) ListPhotos(w http.ResponseWriter, r *http.Request) {
	if _, ok := UserFromContext(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	userID, err := strconv.ParseInt(chi.URLParam(r, "userID"), 10, 64)
	if err != nil || userID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	photos, err := h.uc.ListProfilePhotos(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list photos failed")
		return
	}
	out := make([]map[string]any, 0, len(photos))
	for _, p := range photos {
		out = append(out, profilePhotoJSON(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": out})
}

// DeletePhoto removes a photo from the current user's gallery
// (DELETE /me/photos/{photoID}).
func (h *ProfileHandler) DeletePhoto(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	photoID, err := strconv.ParseInt(chi.URLParam(r, "photoID"), 10, 64)
	if err != nil || photoID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid photo id")
		return
	}
	if err := h.uc.DeleteProfilePhoto(r.Context(), u.ID, photoID); err != nil {
		writeError(w, http.StatusInternalServerError, "delete photo failed")
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
