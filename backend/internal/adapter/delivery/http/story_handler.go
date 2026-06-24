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
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeError(w, http.StatusInternalServerError, "server error")
	}
}

func (h *StoryHandler) Post(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		MediaID      int64   `json:"media_id"`
		Caption      string  `json:"caption"`
		Privacy      string  `json:"privacy"`
		AllowUserIDs []int64 `json:"allow_user_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.MediaID == 0 {
		writeError(w, http.StatusBadRequest, "media_id required")
		return
	}
	id, err := h.svc.Post(r.Context(), user.ID, b.MediaID, b.Caption, b.Privacy, b.AllowUserIDs)
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
			stories = append(stories, map[string]any{
				"id": s.ID, "media_id": s.MediaID, "caption": s.Caption,
				"created_at": s.CreatedAt, "viewed": s.Viewed,
			})
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
