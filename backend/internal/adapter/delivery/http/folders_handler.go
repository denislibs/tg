package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecasefolders "github.com/messenger-denis/backend/internal/usecase/folders"
)

// FoldersHandler — CRUD папок чатов: /me/folders.
type FoldersHandler struct{ uc *usecasefolders.Interactor }

func NewFoldersHandler(uc *usecasefolders.Interactor) *FoldersHandler {
	return &FoldersHandler{uc: uc}
}

type folderBody struct {
	Title        string  `json:"title"`
	Contacts     bool    `json:"contacts"`
	NonContacts  bool    `json:"non_contacts"`
	Groups       bool    `json:"groups"`
	Broadcasts   bool    `json:"broadcasts"`
	Bots         bool    `json:"bots"`
	ExcludeMuted bool    `json:"exclude_muted"`
	ExcludeRead  bool    `json:"exclude_read"`
	IncludeChats []int64 `json:"include_chats"`
	ExcludeChats []int64 `json:"exclude_chats"`
}

func (b folderBody) toDomain(id int64) domain.Folder {
	return domain.Folder{
		ID: id, Title: b.Title,
		Contacts: b.Contacts, NonContacts: b.NonContacts, Groups: b.Groups,
		Broadcasts: b.Broadcasts, Bots: b.Bots,
		ExcludeMuted: b.ExcludeMuted, ExcludeRead: b.ExcludeRead,
		IncludeChats: b.IncludeChats, ExcludeChats: b.ExcludeChats,
	}
}

func folderJSON(f domain.Folder) map[string]any {
	inc := f.IncludeChats
	if inc == nil {
		inc = []int64{}
	}
	exc := f.ExcludeChats
	if exc == nil {
		exc = []int64{}
	}
	return map[string]any{
		"id": f.ID, "title": f.Title, "pos": f.Pos,
		"contacts": f.Contacts, "non_contacts": f.NonContacts, "groups": f.Groups,
		"broadcasts": f.Broadcasts, "bots": f.Bots,
		"exclude_muted": f.ExcludeMuted, "exclude_read": f.ExcludeRead,
		"include_chats": inc, "exclude_chats": exc,
	}
}

func (h *FoldersHandler) mapErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, usecasefolders.ErrBadTitle),
		errors.Is(err, usecasefolders.ErrNoIncludes),
		errors.Is(err, usecasefolders.ErrTooMany):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal")
	}
}

func (h *FoldersHandler) List(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	list, err := h.uc.List(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, f := range list {
		out = append(out, folderJSON(f))
	}
	writeJSON(w, http.StatusOK, map[string]any{"folders": out})
}

func (h *FoldersHandler) Create(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b folderBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	f, err := h.uc.Create(r.Context(), user.ID, b.toDomain(0))
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, folderJSON(f))
}

func (h *FoldersHandler) Update(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	folderID, ok := pathInt(w, r, "folderID")
	if !ok {
		return
	}
	var b folderBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "bad body")
		return
	}
	f, err := h.uc.Update(r.Context(), user.ID, b.toDomain(folderID))
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, folderJSON(f))
}

func (h *FoldersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	folderID, ok := pathInt(w, r, "folderID")
	if !ok {
		return
	}
	if err := h.uc.Delete(r.Context(), user.ID, folderID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
