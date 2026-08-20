package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// frame encodes a WS envelope {t, d}. Errors are impossible for the maps we pass,
// so it returns just the bytes (empty on the unreachable error path).
func frame(t string, d any) []byte {
	b, err := json.Marshal(map[string]any{"t": t, "d": d})
	if err != nil {
		return nil
	}
	return b
}

// frameFields encodes {t, d} with extra fields merged into a COPY of base. base
// is shared across recipients (marshalled once for the pts log), so it must never
// be mutated — every recipient gets its own d with its own per-user fields.
func frameFields(t string, base map[string]any, extra map[string]any) []byte {
	d := make(map[string]any, len(base)+len(extra))
	for k, v := range base {
		d[k] = v
	}
	for k, v := range extra {
		d[k] = v
	}
	return frame(t, d)
}

// framePts encodes {t, d} with the recipient's per-user pts (dense monotonic
// cursor) injected into d, so a live frame advances the client's cursor exactly
// like the matching /sync update row does.
func framePts(t string, base map[string]any, pts int64) []byte {
	return frameFields(t, base, map[string]any{"pts": pts})
}

// frameChannelPts encodes {t, d} with the channel's pts injected into d as
// channel_pts (a per-channel dense cursor, distinct from the per-user pts). The
// client routes any frame carrying channel_pts + peer_id through its per-channel
// funnel and gates it against the channel cursor — the same envelope the typed
// GET /channels/{id}/difference replays for catch-up.
func frameChannelPts(t string, base map[string]any, pts int64) []byte {
	return frameFields(t, base, map[string]any{"channel_pts": pts})
}

// withPeer — копия базового payload с ключом пира ПОЛУЧАТЕЛЯ. base общий для
// всех получателей (он же маршалится в журнал) и никогда не мутируется: у
// приватного диалога peer_id у двух сторон РАЗНЫЙ, см. peeraddr.go.
//
// Кадр с сообщением несёт его ВНУТРИ ключа `message` (тело — конструктор
// схемы), и peer_id там ПАРАМЕТР САМОГО СООБЩЕНИЯ, а не поле конверта. Поэтому
// у такого кадра ключ пира кладётся внутрь сообщения: положить его рядом
// значило бы завести на конструкторе поле, которого в схеме нет.
func withPeer(base map[string]any, peer domain.PeerID, out bool) map[string]any {
	d := make(map[string]any, len(base)+1)
	for k, v := range base {
		d[k] = v
	}
	if msg, ok := d[frameMessageKey].(map[string]any); ok {
		withinMsg := make(map[string]any, len(msg)+1)
		for k, v := range msg {
			withinMsg[k] = v
		}
		if peer != domain.NullPeerID {
			withinMsg["peer_id"] = domain.NewPeer(peer)
		}
		// `out` — тоже пер-зритель, как и ключ пира, и по той же причине
		// дописывается ЗДЕСЬ, а не в общем теле: тело одно на всех получателей.
		// «Выключено» — отсутствие ключа в pFlags, а не false; пустой pFlags при
		// этом не появляется вовсе — иначе кадр разошёлся бы с витриной, где у
		// поля стоит omitempty.
		if flags := pFlagsWithOut(msg["pFlags"], out); len(flags) > 0 {
			withinMsg["pFlags"] = flags
		}
		d[frameMessageKey] = withinMsg
		return d
	}
	if peer != domain.NullPeerID {
		d["peer_id"] = peer
	}
	return d
}

// pFlagsWithOut — копия pFlags сообщения с добавленным (или НЕ добавленным)
// флагом out. Копия, а не правка на месте: общее тело кадра делится между
// получателями, и правка испортила бы его следующему.
func pFlagsWithOut(base any, out bool) map[string]bool {
	src, _ := base.(map[string]bool)
	flags := make(map[string]bool, len(src)+1)
	for k, v := range src {
		flags[k] = v
	}
	if out {
		flags["out"] = true
	}
	return flags
}

// frameMessageKey — ключ, под которым кадр несёт САМО СООБЩЕНИЕ. Форма взята у
// схемы: там кадр с сообщением это updateNewMessage{message, pts, pts_count},
// то есть сообщение вложено, а pts лежит рядом. Прежде поля сообщения лежали
// вперемешку с полями конверта, и pts оказывался «ещё одним полем сообщения».
const frameMessageKey = "message"

// Payload-строители НЕ кладут ключ чата: он зависит от получателя и
// приклеивается на выходе (withPeer / peerPayloads в updates_log.go).

// messageUpdatePayload — тело кадра с сообщением: ОДИН конструктор схемы под
// ключом `message` (решение Р5). Витрина HTTP отдаёт ровно его же —
// Message.ToWire, второго сериализатора у сообщения больше нет.
//
// Прежде здесь жила ВТОРАЯ форма, и расходилась она с витриной в обе стороны:
// тут были sender_name, client_msg_id и reply_quote_*, там — views, forwards,
// deleted, edited_at, reactions, star_reaction, web_page и reply_to.
func (i *Interactor) messageUpdatePayload(ctx context.Context, m domain.Message) map[string]any {
	i.hydrateMessagePeers(ctx, &m)
	// Корень треда наружу — НОМЕР в том же пире (ЕДИНАЯ точка перевода, см.
	// ExternalizeThreadRoots). Прежде каждый вызывающий дописывал ключ
	// thread_root_id в готовый payload сам, и забыть его было нечем не
	// прикрыто.
	m.ThreadRootID = i.externalThreadRoot(ctx, m)
	return map[string]any{frameMessageKey: m.ToWireMap(i.messageContext(ctx, m, domain.NullPeerID))}
}

// messageContext — то, чего строка messages не знает о себе сама. Ключ пира у
// кадра приклеивается позже (withPeer), поэтому здесь допустим NullPeerID.
//
// Post берётся из ВИДА ЧАТА: «это пост канала» — свойство чата, и прежде тот же
// факт выражала целая отдельная проводная форма (channelPostPayload).
func (i *Interactor) messageContext(ctx context.Context, m domain.Message, peer domain.PeerID) domain.MessageContext {
	out := domain.MessageContext{}
	if peer != domain.NullPeerID {
		out.Peer = domain.NewPeer(peer)
	}
	if i.chats != nil {
		if typ, err := i.chats.ChatType(ctx, m.ChatID); err == nil {
			out.Post = typ == domain.ChatTypeChannel
		}
	}
	return out
}

// geoLiveUpdatePayload — тело фрейма geo_live_update (обновление координат
// трансляции): клиент правит гео открытого бабла без перезагрузки истории.
//
// Время обновления едет ОТДЕЛЬНЫМ ключом edit_date, а не внутри geo: одно и то
// же edited_at прежде значило и «время правки» на верхнем уровне, и «время
// обновления координат» внутри гео — два смысла на одну колонку.
func geoLiveUpdatePayload(m domain.Message) map[string]any {
	p := map[string]any{"id": m.Seq, "geo": m.ToWire(domain.MessageContext{}).(domain.MessageReal).Geo}
	if m.EditedAt != nil {
		p["edit_date"] = m.EditedAt.Unix()
	}
	return p
}

// factCheckJSON — представление «проверки фактов» для клиента (nil → nil).
func factCheckJSON(fc *domain.FactCheck) map[string]any {
	if fc == nil {
		return nil
	}
	m := map[string]any{"text": fc.Text}
	if len(fc.Entities) > 0 {
		m["entities"] = fc.Entities
	}
	if fc.Country != "" {
		m["country"] = fc.Country
	}
	return m
}

// factCheckUpdatePayload — тело фрейма/апдейта factcheck_update: клиент патчит
// блок проверки фактов в уже отрисованном бабле. factcheck==null — проверка снята.
func factCheckUpdatePayload(m domain.Message) map[string]any {
	return map[string]any{
		"id":        m.Seq,
		"factcheck": factCheckJSON(m.FactCheck),
	}
}

// editUpdatePayload — тело кадра edit_message: ПАТЧ уже нарисованного бабла, а
// не сообщение целиком. Имена ключей здесь схемные (message/edit_date), но сам
// кадр конструктором Message не является — в схеме это updateEditMessage,
// несущий сообщение целиком, и приведение кадров-патчей к нему принадлежит
// подсистеме ОБНОВЛЕНИЙ, а не сообщения. Названный остаток шага.
//
// action едет здесь потому, что правка служебного сообщения существует ровно
// одна — принятие предложенного фото, и меняется в ней только действие.
func editUpdatePayload(m domain.Message) map[string]any {
	p := map[string]any{
		"id":      m.Seq,
		"message": m.Text, "entities": m.Entities,
	}
	if m.EditedAt != nil {
		p["edit_date"] = m.EditedAt.Unix()
	}
	p["reply_markup"] = m.ReplyMarkup // may be null → keyboard removed
	if m.Action != nil {
		p["action"] = m.Action
	}
	return p
}

// deleteUpdatePayload is the body of a "delete_message" update/frame. `forMe`
// flags a per-user "delete for me" (only that user's own tabs receive it).
func deleteUpdatePayload(seq int64, forMe bool) map[string]any {
	return map[string]any{
		"id": seq, "for_me": forMe,
	}
}

// reactionPayload — тело фрейма/апдейта reaction. Помимо диффа (user_id + emoji +
// action, нужного для анимации и вычисления mine на клиенте) несёт АБСОЛЮТНЫЙ
// агрегат counts: [{emoji, count}] — полное текущее состояние реакций сообщения,
// посчитанное в той же транзакции после Add/Remove. Абсолютный агрегат делает
// повтор из /sync идемпотентным по построению. counts viewer-agnostic (без mine):
// один и тот же payload уходит всем получателям и в лог.
func reactionPayload(seq, userID, authorID int64, emoji, action string, counts []domain.ReactionCount) map[string]any {
	if counts == nil {
		counts = []domain.ReactionCount{}
	}
	return map[string]any{
		"id": seq, "user_id": userID,
		"author_id": authorID, "emoji": emoji, "action": action,
		"counts": counts,
	}
}

// starReactionPayload — тело фрейма/апдейта star_reaction: новый агрегат звёзд
// сообщения (total) плюс отправитель этой порции (sender_id) с его суммарным
// вкладом (mine). Получатели правят агрегат бабла; тот, чей id == sender_id,
// обновляет ещё и свой личный вклад (mine).
func starReactionPayload(seq, senderID, total, mine int64) map[string]any {
	return map[string]any{
		"id": seq, "sender_id": senderID,
		"total": total, "mine": mine,
	}
}
