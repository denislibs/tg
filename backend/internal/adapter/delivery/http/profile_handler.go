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
