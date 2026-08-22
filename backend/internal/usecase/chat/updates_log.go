package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// logAndPublish records `typ`(base) in every recipient's per-user update log —
// capturing each recipient's dense pts — and, after the log tx commits, publishes
// a live frame carrying that pts (framePts) to each. It is the Wave-2 counterpart
// of the inline log+publish blocks in message.go / reaction.go, for the stateful
// updates whose mutation has already committed by the time they fan out: the
// append is its own short transaction, so a /sync catch-up replays exactly what
// the live path delivered and the client's cursor stays dense.
//
// base is the shared payload; it is never mutated — the recipient's peer_id and
// pts are injected into a COPY (withPeer / frameFields). Recipients are used as
// given (the caller dedups); own-device events pass a single id.
//
// chatID — внутренний чат события (0 у кадров без чата: баланс, папки). Наружу
// он не выходит: каждому получателю уезжает ЕГО peer_id, а у приватного диалога
// он у двух сторон разный (см. peeraddr.go), поэтому payload журнала маршалится
// по одному на каждый различный ключ, а не один на всех.
//
// No-op without an update log (some unit-test setups wire updates=nil, mirroring
// postGroupService); publishing is skipped without a publisher.
func (i *Interactor) logAndPublish(ctx context.Context, chatID int64, recipients []int64, typ string, base map[string]any) error {
	if i.updates == nil || len(recipients) == 0 {
		return nil
	}
	pp, err := i.newPeerPayloads(ctx, chatID, base)
	if err != nil {
		return err
	}
	ptsByUser := make(map[int64]int64, len(recipients))
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		date := nowMillis()
		for _, uid := range recipients {
			payload, e := pp.payload(uid)
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, typ, payload)
			if e != nil {
				return e
			}
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		for _, uid := range recipients {
			_ = i.publisher.PublishToUser(ctx, uid, pp.framePts(typ, uid, ptsByUser[uid]))
		}
	}
	return nil
}

// logAndPublishPerPeer — то же, что logAndPublish, но тело кадра СТРОИТСЯ по
// ключу пира, а не дополняется им снаружи.
//
// Разница не косметическая. logAndPublish дописывает ключ пира отдельным полем
// `peer_id` в готовый словарь — это форма ДО порта. У конструктора схемы место
// пира своё и у каждого кадра разное: updateDialogPinned требует dialogPeer,
// updateNotifySettings — notifyPeer, а updateFolderPeers пира наверху не несёт
// вовсе, потому что тот лежит внутри вектора рядом с номером папки. Приклеить
// такое одной общей функцией нельзя — его знает только сам строитель тела.
//
// Тело мемоизируется по ключу пира: у приватного диалога ключей ровно два, в
// группе и канале — один на всех.
func (i *Interactor) logAndPublishPerPeer(ctx context.Context, chatID int64, recipients []int64,
	typ string, build func(peer domain.PeerID) map[string]any) error {
	if i.updates == nil || len(recipients) == 0 {
		return nil
	}
	addr, err := i.peerAddress(ctx, chatID)
	if err != nil {
		return err
	}
	bodies := map[domain.PeerID]map[string]any{}
	bodyFor := func(uid int64) map[string]any {
		peer := addr.forViewer(uid)
		if b, ok := bodies[peer]; ok {
			return b
		}
		b := build(peer)
		bodies[peer] = b
		return b
	}

	ptsByUser := make(map[int64]int64, len(recipients))
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		date := nowMillis()
		for _, uid := range recipients {
			payload, e := json.Marshal(bodyFor(uid))
			if e != nil {
				return e
			}
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, typ, payload)
			if e != nil {
				return e
			}
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		for _, uid := range recipients {
			_ = i.publisher.PublishToUser(ctx, uid, framePts(typ, bodyFor(uid), ptsByUser[uid]))
		}
	}
	return nil
}

// peerPayloads — общий payload кадра, развёрнутый по КЛЮЧАМ ПИРА получателей.
//
// Это рабочее место асимметрии приватного диалога: в группе и канале ключ один
// на всех (значит один marshal, как было), в приватном чате их ровно два — по
// одному на сторону. Разворачивать по получателям, а не по ключам, было бы
// расточительно: в канале с тысячей подписчиков payload один и тот же.
type peerPayloads struct {
	addr chatAddress
	base map[string]any
	// Ключ развёртки — ПАРА «ключ пира + свой ли это отправитель». Одного
	// ключа пира мало: `pFlags.out` зависит от ЗРИТЕЛЯ, а не от чата, и в
	// группе ключ у всех общий — мемоизация по одному пиру раздала бы всем
	// участникам флаг того, кого обслужили первым.
	byPeer map[payloadKey]json.RawMessage
	// sender — автор строки сообщения; с ним сравнивается получатель. 0 — кадр
	// не несёт сообщения (реакции, чтение, папки), тогда `out` не при чём.
	sender int64
}

type payloadKey struct {
	peer domain.PeerID
	out  bool
}

// newPeerPayloads готовит развёртку. chatID == 0 — кадр без чата (баланс звёзд,
// папки): ключа пира у него нет, payload один на всех.
func (i *Interactor) newPeerPayloads(ctx context.Context, chatID int64, base map[string]any) (*peerPayloads, error) {
	pp := &peerPayloads{base: base, byPeer: map[payloadKey]json.RawMessage{}}
	if chatID == 0 {
		return pp, nil
	}
	addr, err := i.peerAddress(ctx, chatID)
	if err != nil {
		return nil, err
	}
	pp.addr = addr
	return pp, nil
}

// peer — ключ пира ГЛАЗАМИ получателя (NullPeerID у кадров без чата).
func (p *peerPayloads) peer(viewerID int64) domain.PeerID {
	if p.addr.chatID == 0 {
		return domain.NullPeerID
	}
	return p.addr.forViewer(viewerID)
}

// payload — журнальное тело кадра для получателя; мемоизировано по ключу пира.
func (p *peerPayloads) payload(viewerID int64) (json.RawMessage, error) {
	key := payloadKey{peer: p.peer(viewerID), out: p.outFor(viewerID)}
	if raw, ok := p.byPeer[key]; ok {
		return raw, nil
	}
	d := p.base
	if key.peer != domain.NullPeerID || key.out {
		d = withPeer(p.base, key.peer, key.out)
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}
	p.byPeer[key] = raw
	return raw, nil
}

// outFor — отправил ли кадр сам получатель (message.pFlags.out).
func (p *peerPayloads) outFor(viewerID int64) bool {
	return p.sender != 0 && p.sender == viewerID
}

// frame — живой кадр получателю: тело журнала плюс его пер-юзерные поля (pts,
// unread). Форма кадра и записи журнала совпадают по построению.
func (p *peerPayloads) frame(t string, viewerID int64, extra map[string]any) []byte {
	return frameFields(t, p.bodyFor(viewerID), extra)
}

// framePts — то же, но с одним лишь курсором, и кладёт его туда, куда велит
// схема кадра (внутрь конструктора либо в конверт) — см. framePts в frame.go.
func (p *peerPayloads) framePts(t string, viewerID int64, pts int64) []byte {
	return framePts(t, p.bodyFor(viewerID), pts)
}

// bodyFor — тело кадра ГЛАЗАМИ получателя (ключ пира и `out` — пер-зрительские).
func (p *peerPayloads) bodyFor(viewerID int64) map[string]any {
	peer := p.peer(viewerID)
	out := p.outFor(viewerID)
	if peer != domain.NullPeerID || out {
		return withPeer(p.base, peer, out)
	}
	return p.base
}

// appendByPeer пишет кадр в персональные журналы получателей БАТЧАМИ.
//
// Ключ батча — ПАРА «ключ пира + свой ли отправитель», а не один ключ пира.
// Ключа пира мало: `pFlags.out` зависит от зрителя, а в группе ключ у всех
// общий — батч взял бы тело первого получателя и раздал его всем, то есть
// своё сообщение выглядело бы чужим у автора (или чужое своим у остальных).
// Автор при этом ровно один, поэтому батчей становится максимум на один
// больше, а не по батчу на человека.
func (i *Interactor) appendByPeer(ctx context.Context, pp *peerPayloads, users []int64, date int64, ptsByUser map[int64]int64) error {
	byPeer := make(map[payloadKey][]int64, 3)
	for _, uid := range users {
		key := payloadKey{peer: pp.peer(uid), out: pp.outFor(uid)}
		byPeer[key] = append(byPeer[key], uid)
	}
	for _, group := range byPeer {
		payload, err := pp.payload(group[0])
		if err != nil {
			return err
		}
		m, err := i.updates.AppendUpdateBulk(ctx, group, 1, date, "new_message", payload)
		if err != nil {
			return err
		}
		for u, p := range m {
			ptsByUser[u] = p
		}
	}
	return nil
}

// publishPeerFrame рассылает ЭФЕМЕРНЫЙ кадр (без журнала: печатает, звонки,
// рукопожатие секретного чата) участникам чата — каждому с ЕГО ключом пира.
// exclude пропускается (0 — никого). Молча ничего не делает без publisher или
// когда адрес чата не читается: эфемерный кадр не стоит ошибки запроса.
func (i *Interactor) publishPeerFrame(ctx context.Context, chatID int64, recipients []int64, exclude int64, t string, base map[string]any) {
	if i.publisher == nil || len(recipients) == 0 {
		return
	}
	pp, err := i.newPeerPayloads(ctx, chatID, base)
	if err != nil {
		return
	}
	for _, uid := range recipients {
		if uid == exclude {
			continue
		}
		_ = i.publisher.PublishToUser(ctx, uid, pp.frame(t, uid, nil))
	}
}

// logAndPublishChannel is the O(1) channel-broadcast counterpart of logAndPublish
// for stateful channel updates (chat_update/boost_update): instead of fanning the
// payload into every subscriber's per-user log (N rows + N publishes), it appends
// ONE typed row to the channel_updates log (dense channel_pts) and PUBLISHes ONCE
// to channel:{id}. Subscribers receive it live; the rest catch up on open via the
// typed GET /channels/{id}/difference. base is an absolute snapshot, so replay is
// idempotent. No-op without a channel log; publish skipped without a publisher.
//
// Ключ пира здесь один на всех подписчиков (-channelID) — асимметрии, как у
// приватного диалога, у канала нет, поэтому payload по-прежнему маршалится один.
func (i *Interactor) logAndPublishChannel(ctx context.Context, channelID int64, typ string, base map[string]any) error {
	if i.channels == nil {
		return nil
	}
	d := withPeer(base, domain.ToPeerID(channelID, true), false)
	payload, err := json.Marshal(d)
	if err != nil {
		return err
	}
	var pts int64
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		p, e := i.channels.AppendUpdate(ctx, channelID, typ, payload)
		pts = p
		return e
	})
	if err != nil {
		return err
	}
	if i.chPub != nil {
		_ = i.chPub.PublishToChannel(ctx, channelID, framePts(typ, d, pts))
	}
	return nil
}
