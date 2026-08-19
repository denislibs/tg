package http

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
)

// Адресация HTTP: в URL едет ЗНАКОВЫЙ ключ пира (пользователь ≥ 0, чат < 0), а
// не id строки в chats. Внутренний chatID достаётся из него слоем разрешения
// (usecase/chat/peeraddr.go) — единственным местом, где живёт это соответствие.
//
// Для приватного диалога ключ — id СОБЕСЕДНИКА, и он разный у двух сторон
// одного разговора: разрешение поэтому всегда идёт от ЗРИТЕЛЯ (meID запроса).

// PeerResolver — слой разрешения из usecase/chat, как он нужен HTTP-слою.
type PeerResolver interface {
	PeerToChatID(ctx context.Context, viewerID int64, peer domain.PeerID) (int64, error)
	PeerToChatIDOrCreate(ctx context.Context, viewerID int64, peer domain.PeerID) (int64, error)
	ChatIDToPeer(ctx context.Context, viewerID, chatID int64) (domain.PeerID, error)
}

// pathPeer читает знаковый ключ пира из сегмента {peerID}.
func pathPeer(w http.ResponseWriter, r *http.Request) (domain.PeerID, bool) {
	v, err := strconv.ParseInt(chi.URLParam(r, "peerID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid peerID")
		return 0, false
	}
	return domain.PeerID(v), true
}

// queryPeer читает ключ пира из query-параметра (def — когда параметра нет).
func queryPeer(r *http.Request, key string, def domain.PeerID) domain.PeerID {
	if s := r.URL.Query().Get(key); s != "" {
		if v, err := strconv.ParseInt(s, 10, 64); err == nil {
			return domain.PeerID(v)
		}
	}
	return def
}

// peerChatID — {peerID} из URL во внутренний chatID глазами автора запроса.
// Диалога ещё нет (первое открытие приватного чата) — 404: читающим путям
// нечего показывать, а заводить строку на GET нельзя.
func peerChatID(w http.ResponseWriter, r *http.Request, res PeerResolver) (int64, bool) {
	peer, ok := pathPeer(w, r)
	if !ok {
		return 0, false
	}
	return resolvePeer(w, r, res, peer, false)
}

// peerChatIDOrCreate — то же для ПИШУЩИХ путей: первое сообщение (черновик,
// опрос) собеседнику заводит приватный диалог, как в оригинале, где отдельного
// «создать чат» нет вовсе.
func peerChatIDOrCreate(w http.ResponseWriter, r *http.Request, res PeerResolver) (int64, bool) {
	peer, ok := pathPeer(w, r)
	if !ok {
		return 0, false
	}
	return resolvePeer(w, r, res, peer, true)
}

// resolveBodyPeer — ключ пира из ТЕЛА запроса (пересылка «куда», отчёт, репост).
func resolveBodyPeer(w http.ResponseWriter, r *http.Request, res PeerResolver, peer domain.PeerID, create bool) (int64, bool) {
	return resolvePeer(w, r, res, peer, create)
}

func resolvePeer(w http.ResponseWriter, r *http.Request, res PeerResolver, peer domain.PeerID, create bool) (int64, bool) {
	me, _ := UserFromContext(r.Context())
	var (
		chatID int64
		err    error
	)
	if create {
		chatID, err = res.PeerToChatIDOrCreate(r.Context(), me.ID, peer)
	} else {
		chatID, err = res.PeerToChatID(r.Context(), me.ID, peer)
	}
	switch {
	case err == nil:
		return chatID, true
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "peer not found")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "not allowed")
	default:
		writeError(w, http.StatusInternalServerError, "peer lookup failed")
	}
	return 0, false
}

// discussionPeer — ключ группы обсуждения канала; 0 («не привязана») остаётся
// NullPeerID, а не -0.
func discussionPeer(chatID int64) domain.PeerID {
	if chatID == 0 {
		return domain.NullPeerID
	}
	return domain.ToPeerID(chatID, true)
}

// peerOf — ключ пира чата глазами автора запроса, для витрин. Ошибка разрешения
// даёт NullPeerID: витрина не должна падать из-за ключа, но и внутренний id
// вместо него не подставляется НИКОГДА.
func peerOf(r *http.Request, res PeerResolver, chatID int64) domain.PeerID {
	me, _ := UserFromContext(r.Context())
	peer, err := res.ChatIDToPeer(r.Context(), me.ID, chatID)
	if err != nil {
		return domain.NullPeerID
	}
	return peer
}
