package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// MediaAccess decides whether a user may download a media object.
type MediaAccess interface {
	CanAccessMedia(ctx context.Context, userID, mediaID int64) (bool, error)
}

type MediaHandler struct {
	svc    *usecasemedia.Interactor
	access MediaAccess
}

func NewMediaHandler(svc *usecasemedia.Interactor, access MediaAccess) *MediaHandler {
	return &MediaHandler{svc: svc, access: access}
}

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
	m, uploadURL, err := h.svc.CreateUpload(r.Context(), usecasemedia.UploadInput{
		OwnerID: user.ID, Mime: body.Mime, Size: body.Size,
		Width: body.Width, Height: body.Height, Duration: body.Duration, BlurPreview: body.BlurPreview,
	})
	if errors.Is(err, usecasemedia.ErrBadSize) {
		writeError(w, http.StatusBadRequest, "invalid size")
		return
	}
	if errors.Is(err, usecasemedia.ErrTooLarge) {
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
	user, _ := UserFromContext(r.Context())
	id, ok := pathInt(w, r, "mediaID")
	if !ok {
		return
	}
	// Authorize before issuing a presigned URL: the caller must own the media or
	// share a chat with a message referencing it. A failed check returns 404 so
	// sequential media ids can't be enumerated.
	allowed, err := h.access.CanAccessMedia(r.Context(), user.ID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load media")
		return
	}
	if !allowed {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	m, downloadURL, err := h.svc.GetMedia(r.Context(), id)
	if errors.Is(err, domain.ErrNotFound) {
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
		"blur_preview": m.BlurPreview, "download_url": downloadURL,
	})
}
