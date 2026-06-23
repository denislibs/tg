package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/media"
)

type MediaHandler struct{ svc *media.Service }

func NewMediaHandler(svc *media.Service) *MediaHandler { return &MediaHandler{svc: svc} }

type uploadBody struct {
	Mime        string `json:"mime"`
	Size        int64  `json:"size"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Duration    int    `json:"duration"`
	BlurPreview []byte `json:"blur_preview"` // base64 in JSON
}

func (h *MediaHandler) CreateUpload(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var body uploadBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	m, uploadURL, err := h.svc.CreateUpload(r.Context(), media.UploadInput{
		OwnerID: user.ID, Mime: body.Mime, Size: body.Size,
		Width: body.Width, Height: body.Height, Duration: body.Duration, BlurPreview: body.BlurPreview,
	})
	if errors.Is(err, media.ErrTooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "file too large")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create upload")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"media_id": m.ID, "object_key": m.ObjectKey, "upload_url": uploadURL,
	})
}

func (h *MediaHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathInt(w, r, "mediaID")
	if !ok {
		return
	}
	m, downloadURL, err := h.svc.GetMedia(r.Context(), id)
	if errors.Is(err, media.ErrNotFound) {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load media")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": m.ID, "mime": m.Mime, "size": m.Size,
		"width": m.Width, "height": m.Height, "duration": m.Duration,
		"download_url": downloadURL,
	})
}
