package http

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
)

// Адресация HTTP: сообщение адресуется парой «пир + НОМЕР В ЧАТЕ». В URL это
// два сегмента — /chats/{peerID}/messages/{msgSeq}, — и второй из них теперь
// приходит из того же пространства, в котором сообщение живёт у клиента и в
// схеме (message.id по-пирный). Внутренний messages.id достаётся слоем
// разрешения (usecase/chat/msgaddr.go) и наружу не выходит.
//
// Точный аналог peerparam.go: там {peerID} → chatID, здесь {msgSeq} → msgID.

// MessageResolver — слой разрешения адреса сообщения, как он нужен HTTP-слою.
type MessageResolver interface {
	MessageIDBySeq(ctx context.Context, chatID, seq int64) (int64, error)
	MessageIDsBySeqs(ctx context.Context, chatID int64, seqs []int64) (map[int64]int64, error)
}

// pathMsgSeq читает номер сообщения из сегмента пути.
func pathMsgSeq(w http.ResponseWriter, r *http.Request, key string) (int64, bool) {
	v, err := strconv.ParseInt(chi.URLParam(r, key), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid "+key)
		return 0, false
	}
	return v, true
}

// msgSeqID — {msgSeq} из URL во внутренний ключ строки в пределах chatID.
// Номера в чате нет — 404: сообщение либо не существовало, либо удалено
// физически, и ни одна ручка не должна работать с таким адресом дальше.
func msgSeqID(w http.ResponseWriter, r *http.Request, res MessageResolver, chatID int64) (int64, bool) {
	return msgSeqIDParam(w, r, res, chatID, "msgSeq")
}

// msgSeqIDParam — то же для сегмента с другим именем (пост канала: {postSeq}).
func msgSeqIDParam(w http.ResponseWriter, r *http.Request, res MessageResolver, chatID int64, key string) (int64, bool) {
	seq, ok := pathMsgSeq(w, r, key)
	if !ok {
		return 0, false
	}
	return resolveMsgSeq(w, r, res, chatID, seq)
}

// resolveMsgSeq — номер сообщения (из пути или тела) во внутренний ключ.
func resolveMsgSeq(w http.ResponseWriter, r *http.Request, res MessageResolver, chatID, seq int64) (int64, bool) {
	msgID, err := res.MessageIDBySeq(r.Context(), chatID, seq)
	switch {
	case err == nil:
		return msgID, true
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "message not found")
	default:
		writeError(w, http.StatusInternalServerError, "message lookup failed")
	}
	return 0, false
}

// replyPeerChatID — reply_to_peer_id из тела запроса (ключ пира ЧУЖОГО чата)
// во внутренний chatID. nil/0 — ответ в том же чате: в схеме отсутствие
// reply_to_peer_id значит «тот же пир», и без него один reply_to_msg_id
// адресовать сообщение не может.
func replyPeerChatID(w http.ResponseWriter, r *http.Request, res PeerResolver, peer *domain.PeerID) (*int64, bool) {
	if peer == nil || *peer == domain.NullPeerID {
		return nil, true
	}
	chatID, ok := resolvePeer(w, r, res, *peer, false)
	if !ok {
		return nil, false
	}
	return &chatID, true
}

// msgSeqIDs — батч того же перевода для списков постов (счётчики комментариев
// и просмотров). Номера, которых в чате нет, молча выпадают: это запрос
// «сколько у этих постов», а не адресация одного объекта.
func msgSeqIDs(ctx context.Context, res MessageResolver, chatID int64, seqs []int64) (ids []int64, bySeq map[int64]int64, err error) {
	bySeq, err = res.MessageIDsBySeqs(ctx, chatID, seqs)
	if err != nil {
		return nil, nil, err
	}
	ids = make([]int64, 0, len(bySeq))
	for _, seq := range seqs {
		if id, ok := bySeq[seq]; ok {
			ids = append(ids, id)
		}
	}
	return ids, bySeq, nil
}
