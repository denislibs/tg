package http

import (
	"encoding/json"
	"errors"
	"fmt"
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

// userJSON is the canonical wire shape for a full user (own profile). It is
// shared by GET /me, the profile-edit endpoints and the sign-in response.
func userJSON(u domain.User) map[string]any {
	var username any
	if u.Username != nil {
		username = *u.Username
	}
	return map[string]any{
		"id":               u.ID,
		"phone":            u.Phone,
		"username":         username, // null when unset
		"first_name":       u.FirstName,
		"last_name":        u.LastName,
		"display_name":     u.DisplayName,
		"bio":              u.Bio,
		"birthday":         birthdayJSON(u.Birthday),
		"avatar_url":       u.AvatarURL,
		"phone_visibility": u.PhoneVisibility,
		"premium":          u.IsPremium,
		"emoji_status":     u.EmojiStatus,
	}
}

// birthdayJSON renders a birthday as {day, month, year?} (year omitted when the
// no-year sentinel is stored), or null.
func birthdayJSON(b *time.Time) any {
	if b == nil {
		return nil
	}
	out := map[string]any{"day": b.Day(), "month": int(b.Month())}
	if b.Year() != domain.BirthdayNoYear {
		out["year"] = b.Year()
	}
	return out
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
	FirstName       *string         `json:"first_name"`
	LastName        *string         `json:"last_name"`
	Bio             *string         `json:"bio"`
	Birthday        json.RawMessage `json:"birthday"`
	PhoneVisibility *string         `json:"phone_visibility"`
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
		FirstName:       cur.FirstName,
		LastName:        cur.LastName,
		Bio:             cur.Bio,
		Birthday:        cur.Birthday,
		PhoneVisibility: cur.PhoneVisibility,
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
	if body.PhoneVisibility != nil {
		in.PhoneVisibility = *body.PhoneVisibility
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

type changePhoneBody struct {
	NewPhone string `json:"new_phone"`
}

// ChangePhone starts a phone-number change (POST /me/change-phone): it validates
// the new number, ensures it is free, and sends a verification code to it. The
// change is applied only after ConfirmChangePhone.
func (h *ProfileHandler) ChangePhone(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	var body changePhoneBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := h.uc.ChangePhone(r.Context(), u.ID, body.NewPhone)
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid phone")
		return
	}
	if errors.Is(err, domain.ErrConflict) {
		writeError(w, http.StatusConflict, "phone_taken")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "change phone failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type confirmChangePhoneBody struct {
	NewPhone string `json:"new_phone"`
	Code     string `json:"code"`
}

// ConfirmChangePhone verifies the code sent to the new number and applies the
// change (POST /me/change-phone/confirm). Returns the fresh user on success.
func (h *ProfileHandler) ConfirmChangePhone(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	var body confirmChangePhoneBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	user, err := h.uc.ConfirmChangePhone(r.Context(), u.ID, body.NewPhone, body.Code)
	if errors.Is(err, domain.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid phone")
		return
	}
	if errors.Is(err, domain.ErrInvalidCode) {
		writeError(w, http.StatusUnauthorized, "invalid code")
		return
	}
	if errors.Is(err, domain.ErrConflict) {
		writeError(w, http.StatusConflict, "phone_taken")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "confirm change phone failed")
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
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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

// mediaContentURL is the canonical stored path for an uploaded media object. The
// media GET endpoint enforces access when the bytes are actually served.
func mediaContentURL(mediaID int64) string {
	return fmt.Sprintf("/media/%d/content", mediaID)
}

// SetAvatar points the user's avatar at an uploaded media object (PUT /me/avatar).
// It also appends the photo to the gallery (the usecase keeps avatar_url and the
// gallery consistent), so old clients on this route stay in sync with the gallery.
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
	user, err := h.uc.SetAvatar(r.Context(), u.ID, mediaContentURL(body.MediaID))
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

// profilePhotoJSON is the wire shape for one gallery photo.
func profilePhotoJSON(p domain.ProfilePhoto) map[string]any {
	var video any
	if p.VideoURL != "" {
		video = p.VideoURL
	}
	return map[string]any{
		"id":         p.ID,
		"url":        p.URL,
		"video_url":  video, // null when absent
		"created_at": p.CreatedAt.Format(time.RFC3339),
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
	var videoURL string
	if body.VideoMediaID > 0 {
		videoURL = mediaContentURL(body.VideoMediaID)
	}
	photo, err := h.uc.AddProfilePhoto(r.Context(), u.ID, mediaContentURL(body.MediaID), videoURL)
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
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
