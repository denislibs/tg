package ws

import (
	"bytes"
	"context"
	"encoding/json"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Векторы `users`/`chats` живого кадра (A4-05).
//
// У оригинала апдейт приходит контейнером `updates` с карточками всех, на кого
// он ссылается, и клиент сохраняет их ДО применения
// (apiUpdatesManager.processUpdateMessage :259-262); кадр с неизвестным пиром
// без карточек клиент не применяет и идёт в getDifference (:675-686). У нас кадр
// публикуется ОДИН на всех получателей (через Redis), а карточка — глазами
// конкретного получателя (имя из его книги, фото по правилу приватности),
// поэтому доклеивает их соединение на выходе, в своей горилле записи.
//
// Пакетно и один раз: соединение помнит, чьи карточки уже отдало (knownPeers),
// и спрашивает только новых — первое сообщение нового собеседника везёт его
// карточку, следующие — нет. Смену имени/фото несут свои кадры (user_update,
// chat_update), поэтому «уже отдано» не устаревает молча.

// peerVectorSource — сборщик карточек по ссылкам (usecase/chat).
type peerVectorSource interface {
	PeerVectorsForRefs(ctx context.Context, viewerID int64, refs domain.PeerRefs) ([]domain.UserReal, []domain.Chat)
}

// knownPeersLimit — потолок памяти «уже отданных» карточек соединения: при
// переполнении множество сбрасывается (худшее — карточка уедет повторно).
const knownPeersLimit = 20000

// knownPeers — пиры, чьи карточки соединение уже отдало (ключ — PeerID).
type knownPeers map[domain.PeerID]bool

// unknown — ссылки, карточек которых соединение ещё не отдавало.
func (k knownPeers) unknown(refs domain.PeerRefs) domain.PeerRefs {
	var out domain.PeerRefs
	for _, id := range refs.Users {
		if !k[domain.PeerID(id)] {
			out.Users = append(out.Users, id)
		}
	}
	for _, id := range refs.Chats {
		if !k[domain.ToPeerID(id, true)] {
			out.Chats = append(out.Chats, id)
		}
	}
	return out
}

// peerVectorsTimeout — сколько горилла записи ждёт карточки: при тайм-ауте
// кадр уходит без векторов (клиент доберёт карточку сам), а запись и пинги
// соединения не встают за медленной базой.
const peerVectorsTimeout = 1500 * time.Millisecond

// withVectors — кадр {t, d, pts?, _refs?} с векторами users/chats карточек
// пиров, на которых ссылается тело и которых соединение ещё не отдавало.
// Ссылки посчитал отправитель (domain.FrameRefsKey): тело здесь не
// разбирается. Кадр без ссылок и кадр без новых ссылок уходят как были.
func withVectors(ctx context.Context, src peerVectorSource, viewerID int64, known knownPeers, frame []byte) []byte {
	if src == nil || !bytes.Contains(frame, []byte(`"`+domain.FrameRefsKey+`"`)) {
		return frame
	}
	var head struct {
		Refs domain.PeerRefs `json:"_refs"`
	}
	if err := json.Unmarshal(frame, &head); err != nil {
		return frame
	}
	refs := known.unknown(head.Refs)
	if refs.Empty() {
		return frame
	}
	vctx, cancel := context.WithTimeout(ctx, peerVectorsTimeout)
	users, chats := src.PeerVectorsForRefs(vctx, viewerID, refs)
	cancel()
	if len(users) == 0 && len(chats) == 0 {
		return frame
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal(frame, &env); err != nil {
		return frame
	}
	if len(known)+len(users)+len(chats) > knownPeersLimit {
		clear(known)
	}
	for _, u := range users {
		known[u.PeerID()] = true
	}
	for _, c := range chats {
		known[c.PeerID()] = true
	}
	delete(env, domain.FrameRefsKey)
	if len(users) > 0 {
		if b, err := json.Marshal(users); err == nil {
			env["users"] = b
		}
	}
	if len(chats) > 0 {
		if b, err := json.Marshal(chats); err == nil {
			env["chats"] = b
		}
	}
	out, err := json.Marshal(env)
	if err != nil {
		return frame
	}
	return out
}
