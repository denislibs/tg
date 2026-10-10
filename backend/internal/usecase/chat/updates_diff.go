package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// Догонка апдейтов — порт серверной стороны того, что клиент tweb вызывает в
// apiUpdatesManager: updates.getState (attach, :895), updates.getDifference
// (:316-392) и updates.getChannelDifference (:418-488). Формы ответов —
// конструкторы схемы (domain/mtupdatesdiff.go).

// Пределы догонки.
const (
	// channelDifferenceLimitMax — потолок limit у getChannelDifference: tweb
	// просит 1000 (apiUpdatesManager.ts:440).
	channelDifferenceLimitMax = 1000
	// channelTooLongThreshold — отставание курсора канала, после которого
	// отдаётся channelDifferenceTooLong: клиент перечитывает канал целиком
	// (tweb updateChannelReload), а не листает журнал.
	channelTooLongThreshold = 10000
	// channelTooLongMessages — сколько последних постов кладётся в TooLong.
	channelTooLongMessages = 20
)

// UpdatesState — updates.getState: текущее состояние ящика пользователя.
// date — текущее время сервера: от него клиент спросит следующую разницу, и
// каналы, сдвинувшиеся после неё, придут маркером updateChannelTooLong.
func (i *Interactor) UpdatesState(ctx context.Context, userID int64) (domain.UpdatesState, error) {
	st, err := i.updates.GetUserState(ctx, userID)
	if err != nil {
		return domain.UpdatesState{}, err
	}
	unread, _ := i.chats.UnreadTotal(ctx, userID)
	return domain.NewUpdatesState(st.Pts, nowUnix(), unread), nil
}

// UpdatesDifference — updates.getDifference{pts, date}.
//
//   - отставание больше tooLongThreshold — differenceTooLong{pts}: клиент
//     сбрасывает всё и перечитывает с нуля (tweb onDifferenceTooLong);
//   - иначе журнал после pts: новые сообщения — вектором new_messages в их
//     ТЕКУЩЕМ виде глазами зрителя (правка, реакции, превью ссылки уже внутри,
//     удалённое и скрытое не отдаётся — так сервер Telegram сворачивает
//     разницу), прочее — other_updates, каждый апдейт со своим pts;
//   - в последнюю страницу — updateChannelTooLong по каналам пользователя,
//     чей журнал сдвинулся после date клиента (их посты в пер-юзерный журнал
//     не пишутся, и иначе клиент о них не узнал бы);
//   - нечего отдавать — differenceEmpty{date, seq}.
func (i *Interactor) UpdatesDifference(ctx context.Context, userID, pts, date int64) (domain.UpdatesDifference, error) {
	if pts < 0 {
		pts = 0
	}
	st, err := i.updates.GetUserState(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := nowUnix()
	if st.Pts-pts > tooLongThreshold {
		return domain.UpdatesDifferenceTooLong{Underscore: domain.UpdatesDifferenceTooLongTag, Pts: st.Pts}, nil
	}
	ups, err := i.updates.UpdatesSince(ctx, userID, pts, syncLimit)
	if err != nil {
		return nil, err
	}
	slice := len(ups) == syncLimit
	rows := make([]journalRow, 0, len(ups))
	for _, u := range ups {
		rows = append(rows, journalRow{Type: u.Type, Pts: u.Pts, Payload: u.Payload})
	}
	msgs, others, users, chats, err := i.foldJournal(ctx, userID, rows)
	if err != nil {
		return nil, err
	}
	if !slice {
		changed, err := i.chats.ChannelsChangedSince(ctx, userID, date)
		if err != nil {
			return nil, err
		}
		for _, c := range changed {
			raw, _ := json.Marshal(domain.NewUpdateChannelTooLong(c.ChatID, c.Pts))
			others = append(others, raw)
		}
	}
	if len(msgs) == 0 && len(others) == 0 {
		return domain.UpdatesDifferenceEmpty{Underscore: domain.UpdatesDifferenceEmptyTag, Date: now}, nil
	}
	unread, _ := i.chats.UnreadTotal(ctx, userID)
	state := domain.NewUpdatesState(st.Pts, now, unread)
	if slice {
		state.Pts = ups[len(ups)-1].Pts
	}
	return domain.NewUpdatesDifference(msgs, others, chats, users, state, slice), nil
}

// UpdatesChannelDifference — updates.getChannelDifference{channel, pts, limit}.
// Читать может тот, кто читает канал (RequireChatRead): участник и — у
// публичного канала — не участник с открытой лентой (tweb
// subscribeToChannelUpdates опрашивает его разницу).
func (i *Interactor) UpdatesChannelDifference(ctx context.Context, userID, channelID, pts int64, limit int) (domain.UpdatesChannelDifference, error) {
	if err := i.RequireChatRead(ctx, channelID, userID); err != nil {
		return nil, err
	}
	if !i.isBroadcast(ctx, channelID) {
		return nil, domain.ErrInvalid // CHANNEL_INVALID: журнал pts есть только у канала
	}
	if limit <= 0 || limit > channelDifferenceLimitMax {
		limit = channelDifferenceLimitMax
	}
	cur, err := i.channels.CurrentPts(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if pts >= cur {
		return domain.NewUpdatesChannelDifferenceEmpty(cur), nil
	}
	if pts <= 0 || cur-pts > channelTooLongThreshold {
		return i.channelDifferenceTooLong(ctx, userID, channelID, cur)
	}
	ups, err := i.channels.UpdatesSince(ctx, channelID, pts, limit)
	if err != nil {
		return nil, err
	}
	ups = i.markOwnPosts(ctx, channelID, userID, ups)
	rows := make([]journalRow, 0, len(ups))
	for _, u := range ups {
		rows = append(rows, journalRow{Type: u.Type, Pts: u.Pts, Payload: u.Payload})
	}
	msgs, others, users, chats, err := i.foldJournal(ctx, userID, rows)
	if err != nil {
		return nil, err
	}
	last := cur
	final := true
	if len(ups) == limit && ups[len(ups)-1].Pts < cur {
		last, final = ups[len(ups)-1].Pts, false
	}
	return domain.NewUpdatesChannelDifference(last, final, msgs, others, chats, users), nil
}

// channelDifferenceTooLong — канал перечитывается целиком: строка диалога
// (у участника — его, у не участника — строка канала без членства) и
// последние посты.
func (i *Interactor) channelDifferenceTooLong(ctx context.Context, userID, channelID, cur int64) (domain.UpdatesChannelDifference, error) {
	peer := domain.ToPeerID(channelID, true)
	var dialog domain.Dialog
	if page, err := i.PeerDialogs(ctx, userID, []domain.PeerID{peer}); err == nil && len(page.Dialogs) > 0 {
		dialog = page.Dialogs[0]
	}
	hist, err := i.GetHistory(ctx, channelID, userID, 0, 0, channelTooLongMessages, nil, "")
	if err != nil {
		return nil, err
	}
	wire, users, chats, err := i.MessagesContainer(ctx, userID, hist.Messages)
	if err != nil {
		return nil, err
	}
	if dialog == nil {
		var top int64
		if len(hist.Messages) > 0 {
			top = hist.Messages[0].Seq
		}
		d := domain.NewDialog(domain.NewPeer(peer), top,
			domain.PeerNotifySettings{Underscore: domain.PeerNotifySettingsTag}, false)
		d.Pts = cur
		dialog = d
	}
	return domain.NewUpdatesChannelDifferenceTooLong(dialog, rawAll(wire), chats, users), nil
}

// ChannelPtsOf — pts журнала чата, если это канал (isChannel=false у прочих):
// история канала едет messages.channelMessages{pts}.
func (i *Interactor) ChannelPtsOf(ctx context.Context, chatID int64) (pts int64, isChannel bool, err error) {
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil || typ != domain.ChatTypeChannel {
		return 0, false, err
	}
	pts, err = i.channels.CurrentPts(ctx, chatID)
	return pts, err == nil, err
}

// journalRow — строка журнала (пер-юзерного или канального) для свёртки.
type journalRow struct {
	Type    string
	Pts     int64
	Payload json.RawMessage
}

// msgKey — сообщение по адресу провода: пир (глазами зрителя) и номер.
type msgKey struct {
	peer domain.PeerID
	seq  int64
}

// foldJournal сворачивает строки журнала в разницу.
//
// Новые сообщения (updateNewMessage/updateNewChannelMessage) отдаются вектором
// new_messages в их ТЕКУЩЕМ виде глазами зрителя: правка, реакции, превью
// ссылки, проверка фактов, раскрытое платное медиа уже внутри; удалённое,
// скрытое у себя и невидимое не отдаётся вовсе. Поэтому апдейты состояния этих
// же сообщений из other_updates снимаются — они уже свёрнуты. Остальные
// строки уходят в other_updates с дописанным pts (у конструкторов, у которых
// он есть в схеме).
func (i *Interactor) foldJournal(ctx context.Context, viewerID int64, rows []journalRow) (
	msgs, others []json.RawMessage, users []domain.UserReal, chats []domain.Chat, err error) {
	type newRow struct {
		key msgKey
		raw json.RawMessage
	}
	var news []newRow
	folded := map[msgKey]bool{}
	bySeq := map[int64][]int64{} // chatID → номера
	chatOf := map[domain.PeerID]int64{}
	for _, r := range rows {
		var body map[string]any
		if json.Unmarshal(r.Payload, &body) != nil {
			continue
		}
		tag, _ := body["_"].(string)
		if tag != domain.UpdateNewMessageTag && tag != domain.UpdateNewChannelMessageTag {
			continue
		}
		key, raw, ok := messageKey(body)
		if !ok {
			continue
		}
		news = append(news, newRow{key: key, raw: raw})
		folded[key] = true
		chatID, known := chatOf[key.peer]
		if !known {
			chatID, _ = i.PeerToChatID(ctx, viewerID, key.peer)
			chatOf[key.peer] = chatID
		}
		if chatID != 0 {
			bySeq[chatID] = append(bySeq[chatID], key.seq)
		}
	}
	// Текущий вид новых сообщений — тем же путём, что история: видимость,
	// гидрация, перевод глазами зрителя.
	current := map[msgKey]json.RawMessage{}
	var all []domain.Message
	for chatID, seqs := range bySeq {
		got, e := i.msgs.GetBySeqs(ctx, chatID, seqs)
		if e != nil {
			return nil, nil, nil, nil, e
		}
		vis, e := i.visibleMessages(ctx, viewerID, got)
		if e != nil {
			return nil, nil, nil, nil, e
		}
		for _, m := range vis {
			if !m.Deleted {
				all = append(all, m)
			}
		}
	}
	resolved := map[msgKey]bool{}
	for _, n := range news {
		if chatOf[n.key.peer] != 0 {
			resolved[n.key] = true
		}
	}
	if len(all) > 0 {
		if e := i.hydrateMessages(ctx, viewerID, all); e != nil {
			return nil, nil, nil, nil, e
		}
		wire, u, c, e := i.MessagesContainer(ctx, viewerID, all)
		if e != nil {
			return nil, nil, nil, nil, e
		}
		users, chats = u, c
		for _, w := range wire {
			raw, e := json.Marshal(w)
			if e != nil {
				continue
			}
			var body map[string]any
			if json.Unmarshal(raw, &body) != nil {
				continue
			}
			if key, _, ok := messageKeyOf(body); ok {
				current[key] = raw
			}
		}
	}
	for _, n := range news {
		switch {
		case !resolved[n.key]:
			// Адрес не разрешился (чата у зрителя больше нет и т. п.) — как
			// легло в журнал.
			msgs = append(msgs, n.raw)
		case current[n.key] != nil:
			msgs = append(msgs, current[n.key])
		}
		// Разрешился, но не видим (удалён, скрыт) — в разницу не идёт.
	}
	var refs domain.PeerRefs
	for _, r := range rows {
		var body map[string]any
		if json.Unmarshal(r.Payload, &body) != nil {
			continue
		}
		tag, _ := body["_"].(string)
		if tag == domain.UpdateNewMessageTag || tag == domain.UpdateNewChannelMessageTag {
			continue
		}
		if key, ok := stateUpdateKey(body); ok && folded[key] {
			continue // состояние уже внутри сообщения из new_messages
		}
		switch {
		case tag == "" && r.Type != "":
			// Непортированный предмет без конструктора (folder_update, #51):
			// дискриминатором едет тип строки журнала, курсор — в теле, как у
			// его живого кадра. Уйдёт вместе с портом updateDialogFilter.
			body["_"] = r.Type
			body["pts"] = r.Pts
		case tag != "" && domain.UpdateDeclaresPts(tag):
			body["pts"] = r.Pts
		}
		raw, e := json.Marshal(body)
		if e != nil {
			continue
		}
		others = append(others, raw)
		more := domain.CollectPeerRefsJSON(raw)
		refs.Users = append(refs.Users, more.Users...)
		refs.Chats = append(refs.Chats, more.Chats...)
	}
	if len(refs.Users) > 0 || len(refs.Chats) > 0 {
		u, c := i.peerVectors(ctx, viewerID, refs, users)
		users = mergeUsers(users, u)
		chats = mergeChats(chats, c)
	}
	return msgs, others, users, chats, nil
}

// messageKey — адрес сообщения в теле кадра с сообщением (message.peer_id +
// message.id) и само сообщение как легло в журнал.
func messageKey(body map[string]any) (msgKey, json.RawMessage, bool) {
	m, _ := body[frameMessageKey].(map[string]any)
	if m == nil {
		return msgKey{}, nil, false
	}
	key, raw, ok := messageKeyOf(m)
	return key, raw, ok
}

// messageKeyOf — адрес самого сообщения (peer_id + id).
func messageKeyOf(m map[string]any) (msgKey, json.RawMessage, bool) {
	seq, ok := m["id"].(float64)
	if !ok {
		return msgKey{}, nil, false
	}
	peerRaw, _ := json.Marshal(m["peer_id"])
	peer, err := domain.UnmarshalPeer(peerRaw)
	if err != nil || peer == nil {
		return msgKey{}, nil, false
	}
	raw, _ := json.Marshal(m)
	return msgKey{peer: domain.GetPeerID(peer), seq: int64(seq)}, raw, true
}

// stateUpdateKey — сообщение, состояние которого несёт апдейт (правка,
// реакции, превью ссылки, проверка фактов, раскрытое платное медиа).
func stateUpdateKey(body map[string]any) (msgKey, bool) {
	switch body["_"] {
	case domain.UpdateEditMessageTag, domain.UpdateEditChannelMessageTag:
		m, _ := body[frameMessageKey].(map[string]any)
		if m == nil {
			return msgKey{}, false
		}
		k, _, ok := messageKeyOf(m)
		return k, ok
	case domain.UpdateMessageReactionsTag, domain.UpdateMessageWebPageTag,
		domain.UpdateMessageFactCheckTag, domain.UpdateMessageExtendedMediaTag:
		seq, ok := body["msg_id"].(float64)
		if !ok {
			return msgKey{}, false
		}
		peerRaw, _ := json.Marshal(body["peer"])
		peer, err := domain.UnmarshalPeer(peerRaw)
		if err != nil || peer == nil {
			return msgKey{}, false
		}
		return msgKey{peer: domain.GetPeerID(peer), seq: int64(seq)}, true
	}
	return msgKey{}, false
}

func rawAll(wire []domain.MTMessage) []json.RawMessage {
	out := make([]json.RawMessage, 0, len(wire))
	for _, w := range wire {
		if raw, err := json.Marshal(w); err == nil {
			out = append(out, raw)
		}
	}
	return out
}

func mergeUsers(a, b []domain.UserReal) []domain.UserReal {
	seen := make(map[int64]bool, len(a))
	for _, u := range a {
		seen[u.ID] = true
	}
	for _, u := range b {
		if !seen[u.ID] {
			seen[u.ID] = true
			a = append(a, u)
		}
	}
	return a
}

func mergeChats(a, b []domain.Chat) []domain.Chat {
	seen := make(map[string]bool, len(a))
	key := func(c domain.Chat) string { raw, _ := json.Marshal(c); return string(raw) }
	for _, c := range a {
		seen[key(c)] = true
	}
	for _, c := range b {
		if k := key(c); !seen[k] {
			seen[k] = true
			a = append(a, c)
		}
	}
	return a
}
