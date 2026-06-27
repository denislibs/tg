package http

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// MediaAccess decides whether a user may download a media object.
type MediaAccess interface {
	CanAccessMedia(ctx context.Context, userID, mediaID int64) (bool, error)
}

// MediaHandler uses the package Authenticator (see middleware.go) so GetContent
// can auth via a ?token= query — browser <img>/<video> elements can't send an
// Authorization header, mirroring the WS gateway.
type MediaHandler struct {
	svc       *usecasemedia.Interactor
	access    MediaAccess
	auth      Authenticator
	urlSecret []byte
}

func NewMediaHandler(svc *usecasemedia.Interactor, access MediaAccess, auth Authenticator, urlSecret string) *MediaHandler {
	return &MediaHandler{svc: svc, access: access, auth: auth, urlSecret: []byte(urlSecret)}
}

// MediaToken mints a short-lived, media-scoped token for the authenticated user
// (Bearer). The client appends it as ?token= on content URLs instead of the
// session token, so a leaked URL can't be used against the account.
func (h *MediaHandler) MediaToken(w http.ResponseWriter, r *http.Request) {
	user, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no user")
		return
	}
	now := time.Now()
	writeJSON(w, http.StatusOK, map[string]any{
		"token":      signMediaToken(h.urlSecret, user.ID, now),
		"expires_at": now.Add(mediaTokenTTL).UTC().Format(time.RFC3339),
	})
}

type uploadBody struct {
	Mime        string `json:"mime"`
	Size        int64  `json:"size"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Duration    int    `json:"duration"`
	BlurPreview []byte `json:"blur_preview"` // base64 in JSON
	FileName    string `json:"file_name"`
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
		FileName: body.FileName,
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
		"file_name": m.FileName, "has_thumb": m.ThumbKey != "",
	})
}

const maxUpload = 100 << 20 // 100 MiB, mirrors usecase maxSize

func (h *MediaHandler) PutContent(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	id, ok := pathInt(w, r, "mediaID")
	if !ok {
		return
	}
	body := http.MaxBytesReader(w, r.Body, maxUpload)
	defer body.Close()
	err := h.svc.PutContent(r.Context(), id, user.ID, body, r.ContentLength)
	if errors.Is(err, usecasemedia.ErrForbidden) {
		writeError(w, http.StatusForbidden, "not your media")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "upload failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetContent streams the bytes. Browser <img>/<video> can't send headers, so this
// route authenticates via ?token= (like /ws) and is mounted outside the Bearer group.
func (h *MediaHandler) GetContent(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	// Prefer a media-scoped token; fall back to a session token for back-compat.
	userID, ok := parseMediaToken(h.urlSecret, token, time.Now())
	if !ok {
		user, _, err := h.auth.Authenticate(r.Context(), token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		userID = user.ID
	}
	id, ok := pathInt(w, r, "mediaID")
	if !ok {
		return
	}
	allowed, err := h.access.CanAccessMedia(r.Context(), userID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load media")
		return
	}
	if !allowed {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	// ?v=thumb serves the generated thumbnail/poster (jpeg); default = original.
	var (
		rc   io.ReadSeekCloser
		info usecasemedia.ObjectInfo
	)
	if r.URL.Query().Get("v") == "thumb" {
		rc, info, err = h.svc.GetThumbContent(r.Context(), id)
	} else {
		rc, info, _, err = h.svc.GetContent(r.Context(), id)
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load media")
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", info.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", info.ModTime, rc) // handles Range/206
}
