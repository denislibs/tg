package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

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

// SetAvatar points the user's avatar at an uploaded media object (PUT /me/avatar).
// The stored URL is the /media/{id}/content path; the media GET endpoint enforces
// access when the bytes are actually served.
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
	url := fmt.Sprintf("/media/%d/content", body.MediaID)
	user, err := h.uc.SetAvatar(r.Context(), u.ID, url)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "set avatar failed")
		return
	}
	writeJSON(w, http.StatusOK, userJSON(user))
}
