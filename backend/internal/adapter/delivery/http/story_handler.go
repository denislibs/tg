package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/messenger-denis/backend/internal/domain"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
)

// StoryHandler serves the stories endpoints (post / feed / view / viewers /
// delete). It delegates all logic to the story service; privacy and
// author-gating live there.
type StoryHandler struct {
	svc *storyusecase.Service
}

func NewStoryHandler(svc *storyusecase.Service) *StoryHandler {
	return &StoryHandler{svc: svc}
}

func (h *StoryHandler) mapErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrBadReaction):
		writeError(w, http.StatusBadRequest, "invalid reaction")
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "too long")
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid request")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrConflict):
		writeError(w, http.StatusConflict, "cooldown")
	case errors.Is(err, domain.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "unavailable")
	default:
		writeError(w, http.StatusInternalServerError, "server error")
	}
}

// reactionsJSON serializes a per-emoji reaction breakdown (emoji/count/mine).
func reactionsJSON(rcs []domain.ReactionCount) []map[string]any {
	out := make([]map[string]any, 0, len(rcs))
	for _, rc := range rcs {
		out = append(out, map[string]any{"emoji": rc.Emoji, "count": rc.Count, "mine": rc.Mine})
	}
	return out
}

// storyJSON is one story item in the feed, including its reaction aggregate.
// my_reaction is null when the viewer hasn't reacted.
func storyJSON(s domain.StoryItem) map[string]any {
	var my any
	if s.MyReaction != "" {
		my = s.MyReaction
	}
	out := map[string]any{
		"id": s.ID, "media_id": s.MediaID, "caption": s.Caption,
		"privacy": s.Privacy, "pinned": s.Pinned, "edited": s.Edited,
		"created_at": s.CreatedAt, "expires_at": s.ExpiresAt, "viewed": s.Viewed,
		"reactions_count": s.ReactionsCount,
		"my_reaction":     my,
		"reactions":       reactionsJSON(s.Reactions),
	}
	// allow_user_ids отдаётся только для своих selected-историй (usecase заполняет
	// AllowIDs лишь тогда), чтобы автор мог редактировать аудиторию; чужие — nil.
	if s.Privacy == "selected" && s.AllowIDs != nil {
		out["allow_user_ids"] = s.AllowIDs
	}
	return out
}

func (h *StoryHandler) Post(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		MediaID      int64   `json:"media_id"`
		Caption      string  `json:"caption"`
		Privacy      string  `json:"privacy"`
		AllowUserIDs []int64 `json:"allow_user_ids"`
		// Period — срок жизни истории в секундах (6h/12h/24h/48h; 24h по умолчанию).
		Period int64 `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.MediaID == 0 {
		writeError(w, http.StatusBadRequest, "media_id required")
		return
	}
	id, err := h.svc.Post(r.Context(), user.ID, b.MediaID, b.Caption, b.Privacy, b.AllowUserIDs, b.Period)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (h *StoryHandler) Feed(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	groups, err := h.svc.Feed(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(groups))
	for _, g := range groups {
		stories := make([]map[string]any, 0, len(g.Stories))
		for _, s := range g.Stories {
			stories = append(stories, storyJSON(s))
		}
		out = append(out, map[string]any{
			"author": map[string]any{
				"id": g.Author.ID, "display_name": g.Author.DisplayName, "avatar_url": g.Author.AvatarURL,
			},
			"stories": stories,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": out})
}

func (h *StoryHandler) View(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	storyID, ok := pathInt(w, r, "storyID")
	if !ok {
		return
	}
	if err := h.svc.View(r.Context(), storyID, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *StoryHandler) Viewers(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	storyID, ok := pathInt(w, r, "storyID")
	if !ok {
		return
	}
	viewers, err := h.svc.Viewers(r.Context(), storyID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(viewers))
	for _, v := range viewers {
		out = append(out, map[string]any{"id": v.ID, "display_name": v.DisplayName, "avatar_url": v.AvatarURL})
	}
	writeJSON(w, http.StatusOK, map[string]any{"viewers": out, "count": len(out)})
}

// Stats serves GET /stories/{storyID}/stats — view statistics for the author's
// own story (tweb stats.getStoryStats): total views + a per-day views series.
func (h *StoryHandler) Stats(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	storyID, ok := pathInt(w, r, "storyID")
	if !ok {
		return
	}
	st, err := h.svc.Stats(r.Context(), storyID, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"views":           st.Views,
		"views_by_day":    seriesJSON(st.ViewsByDay),
		"reactions_total": st.ReactionsTotal,
		"reactions":       reactionsJSON(st.Reactions),
	})
}

// SetReaction serves POST /stories/{storyID}/reaction — set/replace the
// caller's reaction on a story they can see (tweb stories.sendReaction).
func (h *StoryHandler) SetReaction(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	storyID, ok := pathInt(w, r, "storyID")
	if !ok {
		return
	}
	var b struct {
		Reaction string `json:"reaction"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.Reaction == "" {
		writeError(w, http.StatusBadRequest, "reaction required")
		return
	}
	if err := h.svc.SetReaction(r.Context(), storyID, user.ID, b.Reaction); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// RemoveReaction serves DELETE /stories/{storyID}/reaction — clear the caller's
// reaction on a story they can see.
func (h *StoryHandler) RemoveReaction(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	storyID, ok := pathInt(w, r, "storyID")
	if !ok {
		return
	}
	if err := h.svc.RemoveReaction(r.Context(), storyID, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *StoryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	storyID, ok := pathInt(w, r, "storyID")
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), storyID, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// CloseFriends serves GET /me/close_friends → {user_ids:[...]}.
func (h *StoryHandler) CloseFriends(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	ids, err := h.svc.CloseFriends(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user_ids": ids})
}

// SetCloseFriends serves PUT /me/close_friends body {user_ids:[...]} — full
// replacement of the caller's close-friends list.
func (h *StoryHandler) SetCloseFriends(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		UserIDs []int64 `json:"user_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.SetCloseFriends(r.Context(), user.ID, b.UserIDs); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// stealthJSON serializes a stealth-mode window; timestamps are null when unset.
func stealthJSON(m domain.StealthMode) map[string]any {
	var active, cooldown any
	if !m.ActiveUntil.IsZero() {
		active = m.ActiveUntil
	}
	if !m.CooldownUntil.IsZero() {
		cooldown = m.CooldownUntil
	}
	return map[string]any{"active_until": active, "cooldown_until": cooldown}
}

// StealthState serves GET /stories/stealth → current stealth window.
func (h *StoryHandler) StealthState(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	m, err := h.svc.StealthState(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stealthJSON(m))
}

// ActivateStealth serves POST /stories/stealth/activate → the new window, or
// 409 while a cooldown is still in effect.
func (h *StoryHandler) ActivateStealth(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	m, err := h.svc.ActivateStealth(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stealthJSON(m))
}

// Archive serves GET /stories/archive?limit&offset_id → the caller's own expired
// stories, newest first.
func (h *StoryHandler) Archive(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	limit, _ := strconv.ParseInt(r.URL.Query().Get("limit"), 10, 64)
	offsetID, _ := strconv.ParseInt(r.URL.Query().Get("offset_id"), 10, 64)
	items, err := h.svc.Archive(r.Context(), user.ID, limit, offsetID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stories": storyItemsJSON(items)})
}

// Pinned serves GET /stories/pinned?peer={userID} → a peer's pinned stories
// (defaults to the caller when peer is omitted).
func (h *StoryHandler) Pinned(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	peer, _ := strconv.ParseInt(r.URL.Query().Get("peer"), 10, 64)
	if peer == 0 {
		peer = user.ID
	}
	items, err := h.svc.PinnedStories(r.Context(), peer, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stories": storyItemsJSON(items)})
}

// Pin serves POST /stories/{storyID}/pin body {pinned} — owner toggles the
// profile-pin of a story.
func (h *StoryHandler) Pin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	storyID, ok := pathInt(w, r, "storyID")
	if !ok {
		return
	}
	var b struct {
		Pinned bool `json:"pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.SetPinned(r.Context(), storyID, user.ID, b.Pinned); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Edit serves PATCH /stories/{storyID} body {caption?, privacy?, allow_user_ids?}
// — owner edits a story; caption/privacy are optional and omitted fields are
// left unchanged.
func (h *StoryHandler) Edit(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	storyID, ok := pathInt(w, r, "storyID")
	if !ok {
		return
	}
	var b struct {
		Caption      *string `json:"caption"`
		Privacy      *string `json:"privacy"`
		AllowUserIDs []int64 `json:"allow_user_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.EditStory(r.Context(), storyID, user.ID, b.Caption, b.Privacy, b.AllowUserIDs); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// storyItemsJSON serializes a flat story-item list (archive/pinned).
func storyItemsJSON(items []domain.StoryItem) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, storyJSON(it))
	}
	return out
}
