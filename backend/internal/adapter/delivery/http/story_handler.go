package http

import (
	"encoding/json"
	"errors"
	"net/http"

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
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
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
	return map[string]any{
		"id": s.ID, "media_id": s.MediaID, "caption": s.Caption,
		"created_at": s.CreatedAt, "viewed": s.Viewed,
		"reactions_count": s.ReactionsCount,
		"my_reaction":     my,
		"reactions":       reactionsJSON(s.Reactions),
	}
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
