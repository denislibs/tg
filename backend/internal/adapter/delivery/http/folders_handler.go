package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/messenger-denis/backend/internal/domain"
	usecasefolders "github.com/messenger-denis/backend/internal/usecase/folders"
)

// FoldersHandler — CRUD папок чатов: /me/folders.
type FoldersHandler struct{ uc *usecasefolders.Interactor }

func NewFoldersHandler(uc *usecasefolders.Interactor) *FoldersHandler {
	return &FoldersHandler{uc: uc}
}

type folderBody struct {
	Title        string          `json:"title"`
	Contacts     bool            `json:"contacts"`
	NonContacts  bool            `json:"non_contacts"`
	Groups       bool            `json:"groups"`
	Broadcasts   bool            `json:"broadcasts"`
	Bots         bool            `json:"bots"`
	ExcludeMuted bool            `json:"exclude_muted"`
	ExcludeRead  bool            `json:"exclude_read"`
	IncludePeers []domain.PeerID `json:"include_peers"`
	ExcludePeers []domain.PeerID `json:"exclude_peers"`
}

// toDomain — правила папки приезжают ключами пиров; внутрь домена они идут
// внутренними chatID (слой разрешения, usecase/chat/peeraddr.go).
func (b folderBody) toDomain(ctx context.Context, uc *usecasefolders.Interactor, ownerID, id int64) domain.DialogFilter {
	return domain.DialogFilter{
		ID: id, Title: b.Title,
		Contacts: b.Contacts, NonContacts: b.NonContacts, Groups: b.Groups,
		Broadcasts: b.Broadcasts, Bots: b.Bots,
		ExcludeMuted: b.ExcludeMuted, ExcludeRead: b.ExcludeRead,
		IncludeChats: uc.PeersToChatIDs(ctx, ownerID, b.IncludePeers),
		ExcludeChats: uc.PeersToChatIDs(ctx, ownerID, b.ExcludePeers),
	}
}

func folderJSON(ctx context.Context, uc *usecasefolders.Interactor, ownerID int64, f domain.DialogFilter) map[string]any {
	return map[string]any{
		"id": f.ID, "title": f.Title, "pos": f.Pos,
		"contacts": f.Contacts, "non_contacts": f.NonContacts, "groups": f.Groups,
		"broadcasts": f.Broadcasts, "bots": f.Bots,
		"exclude_muted": f.ExcludeMuted, "exclude_read": f.ExcludeRead,
		"include_peers": uc.ChatIDsToPeers(ctx, ownerID, f.IncludeChats),
		"exclude_peers": uc.ChatIDsToPeers(ctx, ownerID, f.ExcludeChats),
	}
}

func (h *FoldersHandler) mapErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, usecasefolders.ErrBadTitle),
		errors.Is(err, usecasefolders.ErrNoIncludes),
		errors.Is(err, usecasefolders.ErrTooMany),
		errors.Is(err, usecasefolders.ErrNoShareable):
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
		out = append(out, folderJSON(r.Context(), h.uc, user.ID, f))
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
	f, err := h.uc.Create(r.Context(), user.ID, b.toDomain(r.Context(), h.uc, user.ID, 0))
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, folderJSON(r.Context(), h.uc, user.ID, f))
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
	f, err := h.uc.Update(r.Context(), user.ID, b.toDomain(r.Context(), h.uc, user.ID, folderID))
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, folderJSON(r.Context(), h.uc, user.ID, f))
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
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// --- Ссылки-приглашения в папку (chatlist invites) ---

// inviteJSON — приглашение в папку. Расшариваются только публичные группы и
// каналы, поэтому ключ пира здесь чистая арифметика: -chatID.
func inviteJSON(inv domain.FolderInvite) map[string]any {
	peers := make([]domain.PeerID, 0, len(inv.ChatIDs))
	for _, id := range inv.ChatIDs {
		peers = append(peers, domain.ToPeerID(id, true))
	}
	return map[string]any{
		"slug": inv.Slug, "url": "/addlist/" + inv.Slug,
		"title": inv.Title, "peer_ids": peers,
	}
}

// CreateInvite: POST /me/folders/{folderID}/invites {title?} → {slug, url}.
func (h *FoldersHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	folderID, ok := pathInt(w, r, "folderID")
	if !ok {
		return
	}
	var b struct {
		Title string `json:"title"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	inv, err := h.uc.CreateInvite(r.Context(), user.ID, folderID, b.Title)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, inviteJSON(inv))
}

// ListInvites: GET /me/folders/{folderID}/invites → {invites:[...]}.
func (h *FoldersHandler) ListInvites(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	folderID, ok := pathInt(w, r, "folderID")
	if !ok {
		return
	}
	list, err := h.uc.ListInvites(r.Context(), user.ID, folderID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, inv := range list {
		out = append(out, inviteJSON(inv))
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": out})
}

// RevokeInvite: DELETE /me/folder_invites/{slug}.
func (h *FoldersHandler) RevokeInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	slug := chi.URLParam(r, "slug")
	if err := h.uc.RevokeInvite(r.Context(), user.ID, slug); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// PreviewInvite: GET /folder_invites/{slug} → {title, chats:[{id,title,type,members}]}.
func (h *FoldersHandler) PreviewInvite(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	title, chats, err := h.uc.PreviewInvite(r.Context(), slug)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(chats))
	for _, c := range chats {
		out = append(out, map[string]any{
			"peer_id": domain.ToPeerID(c.ID, true), "title": c.Title, "type": c.Type, "members": c.MemberCount,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"title": title, "chats": out})
}

// JoinInvite: POST /folder_invites/{slug}/join {peer_ids:[...]}.
func (h *FoldersHandler) JoinInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	slug := chi.URLParam(r, "slug")
	var b struct {
		PeerIDs []domain.PeerID `json:"peer_ids"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	// Вступают только в группы/каналы — обратная арифметика inviteJSON.
	ids := make([]int64, 0, len(b.PeerIDs))
	for _, p := range b.PeerIDs {
		if p.IsAnyChat() {
			ids = append(ids, p.ToChatID())
		}
	}
	if err := h.uc.JoinInvite(r.Context(), user.ID, slug, ids); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
