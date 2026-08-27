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

// framePts — живой кадр с плотным курсором ПОЛУЧАТЕЛЯ: кадр двигает курсор
// клиента ровно так же, как соответствующая строка /sync.
//
// Куда именно ложится курсор, решает СХЕМА, а не вкус. У updateNewMessage `pts`
// — обычный параметр конструктора, и он едет ВНУТРИ тела. У
// updateMessageReactions (как и у кадров диалогов) параметра pts нет вовсе: у
// оригинала такие кадры едут в контейнере updates, и порядок им задаёт seq
// контейнера. Дописать pts в такое тело значило бы завести на конструкторе
// поле, которого в схеме нет, — поэтому курсор едет в КОНВЕРТЕ, нашем аналоге
// контейнера.
func framePts(t string, base map[string]any, pts int64) []byte {
	if tag, ok := base["_"].(string); ok && !domain.UpdateDeclaresPts(tag) {
		return frameEnvelopePts(t, base, pts)
	}
	return frameFields(t, base, map[string]any{"pts": pts})
}

// frameEnvelopePts — {t, d, pts}: курсор рядом с телом, а не в нём.
func frameEnvelopePts(t string, d map[string]any, pts int64) []byte {
	b, err := json.Marshal(map[string]any{"t": t, "d": d, "pts": pts})
	if err != nil {
		return nil
	}
	return b
}

// frameChannelMessage — кадр ПОСТА КАНАЛА: пер-канальный курсор кладётся в
// `pts` самого конструктора.
//
// Своего имени у канального курсора в схеме нет: `updateNewChannelMessage.pts`
// — обычный pts, а «канальный» он потому, что таков КОНСТРУКТОР. Наш ключ
// `channel_pts` был вторым именем того же поля, и клиенту приходилось решать
// вид кадра по имени ключа вместо дискриминатора. Второго имени больше нет
// нигде: метаданные канала (chat_update, boost_update) тоже несут курсор
// параметром своего конструктора.
func frameChannelMessage(t string, base map[string]any, pts int64) []byte {
	return frameFields(t, base, map[string]any{"pts": pts})
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

// messageUpdatePayload — тело кадра с сообщением: КОНСТРУКТОР
// `updateNewMessage{message, pts, pts_count}`, а не словарь под ключом
// `message`. Само сообщение внутри — тот же конструктор, что отдаёт витрина
// HTTP (Message.ToWire), второго сериализатора у сообщения нет.
//
// Прежде здесь жила ВТОРАЯ форма, и расходилась она с витриной в обе стороны:
// тут были sender_name, client_msg_id и reply_quote_*, там — views, forwards,
// deleted, edited_at, reactions, star_reaction, web_page и reply_to.
//
// `pts` тела здесь НЕТ: он пер-получательский (у каждого свой плотный курсор) и
// дописывается на выходе — framePts живому кадру, колонка журнала записи. Это
// не отступление от схемы, а её же деление: тело кадра одно на всех, курсор —
// у каждого свой.
func (i *Interactor) messageUpdatePayload(ctx context.Context, m domain.Message) map[string]any {
	return i.newMessagePayload(ctx, m, domain.UpdateNewMessageTag)
}

// channelMessagePayload — то же тело, но конструктором ПОСТА КАНАЛА.
//
// Разные конструкторы, а не флаг: у канала свой курсор, и различает их схема
// именно конструктором (updateNewChannelMessage), а не именем ключа. Развилка
// стоит там же, где она уже стоит у самой доставки, — по типу пира.
func (i *Interactor) channelMessagePayload(ctx context.Context, m domain.Message) map[string]any {
	return i.newMessagePayload(ctx, m, domain.UpdateNewChannelMessageTag)
}

func (i *Interactor) newMessagePayload(ctx context.Context, m domain.Message, tag string) map[string]any {
	i.hydrateMessagePeers(ctx, &m)
	// Корень треда наружу — НОМЕР в том же пире (ЕДИНАЯ точка перевода, см.
	// ExternalizeThreadRoots). Прежде каждый вызывающий дописывал ключ
	// thread_root_id в готовый payload сам, и забыть его было нечем не
	// прикрыто.
	m.ThreadRootID = i.externalThreadRoot(ctx, m)
	return map[string]any{
		"_":             tag,
		frameMessageKey: m.ToWireMap(i.messageContext(ctx, m, domain.NullPeerID)),
		// Курсор двигается на единицу: он у нас плотный, и прежде клиент
		// подразумевал этот шаг молча.
		"pts_count": domain.PtsCountOne,
	}
}

// readPayload — тело кадра прочтения ГЛАЗАМИ получателя.
//
// Конструкторов два, и выбор между ними — не украшение. «Прочитал я» и
// «прочитали меня» в схеме разные кадры: у первого есть счётчик оставшегося
// непрочитанного (он мой), у второго его нет вовсе — чужой непрочитанный меня
// не касается. У нас же ехал ОДИН кадр с `user_id` внутри, и каждый получатель
// выводил «чьё это» сам, сравнивая с собой; тот же вывод повторялся на клиенте
// в трёх местах разбора.
//
// Тот же класс, что pFlags.out у сообщения: тело кадра одно на всех
// получателей, а ответ на вопрос «чьё» — разный, и разводится он здесь, на
// рассылке.
func readPayload(peer domain.PeerID, maxID int64, unread int, inbox bool) map[string]any {
	if !inbox {
		return map[string]any{
			"_":         domain.UpdateReadHistoryOutboxTag,
			"peer":      domain.NewPeer(peer),
			"max_id":    maxID,
			"pts_count": domain.PtsCountOne,
		}
	}
	return map[string]any{
		"_":                  domain.UpdateReadHistoryInboxTag,
		"peer":               domain.NewPeer(peer),
		"max_id":             maxID,
		"still_unread_count": unread,
		"pts_count":          domain.PtsCountOne,
	}
}

// pinPayload — тело кадра закрепления.
//
// «Открепили» — ТОТ ЖЕ конструктор с опущенным битом, а не поле `pinned: false`
// и не второй тип кадра. Номера едут ВЕКТОРОМ: у оригинала одно действие
// закрепляет сразу пачку, и форма кадра это допускает, даже когда у нас пока
// всегда один номер.
func pinPayload(peer domain.PeerID, seq int64, pinned bool) map[string]any {
	p := map[string]any{
		"_":         domain.UpdatePinnedMessagesTag,
		"peer":      domain.NewPeer(peer),
		"messages":  []int64{seq},
		"pts_count": domain.PtsCountOne,
	}
	if pinned {
		p["pFlags"] = map[string]bool{"pinned": true}
	}
	return p
}

// messageContext — то, чего строка messages не знает о себе сама. Ключ пира у
// кадра приклеивается позже (withPeer), поэтому здесь допустим NullPeerID.
//
// Post берётся из ВИДА ЧАТА: «это пост канала» — свойство чата, и прежде тот же
// факт выражала целая отдельная проводная форма (channelPostPayload). Вид чата
// решает и второе — есть ли у сообщения ТРЕД, — поэтому читается он один раз на
// обоих потребителей.
func (i *Interactor) messageContext(ctx context.Context, m domain.Message, peer domain.PeerID) domain.MessageContext {
	out := domain.MessageContext{}
	if peer != domain.NullPeerID {
		out.Peer = domain.NewPeer(peer)
	}
	if i.chats != nil {
		if typ, err := i.chats.ChatType(ctx, m.ChatID); err == nil {
			out.Post = typ == domain.ChatTypeChannel
			out.Replies = i.messageThread(ctx, m, typ)
			out.CanSeeReactionsList = domain.CanSeeReactionsList(typ)
		}
	}
	return out
}

// messageThread — тред ОДНОГО сообщения для живого кадра.
//
// Второго ответа на «откуда берётся replies» здесь нет: спрашивается тот же
// threadReplies, которым доводится пачка истории (messagescontainer.go).
// Прежде кадр не спрашивал вовсе — Message.toReal параметр не ставил, и у
// поста, приехавшего кадром `new_message`, тред был пуст: футер «N
// комментариев» появлялся только после перезагрузки истории, а гейт футера на
// клиенте пришлось держать на факте привязанного чата обсуждения вместо
// `replies.pFlags.comments`, как у оригинала (tweb appMessagesManager.ts:9241,
// getMessageWithCommentReplies).
//
// Карточки последних комментаторов здесь отбрасываются: вектора `users` рядом с
// кадром у нас пока нет вовсе (см. mtupdates.go — именно из-за этого у нас
// появились конструкторы-снимки). Тред при этом ссылается на них по-прежнему —
// ССЫЛКАМИ, как в схеме.
func (i *Interactor) messageThread(ctx context.Context, m domain.Message, kind string) *domain.MessageReplies {
	threads, _ := i.threadReplies(ctx, []domain.Message{m}, map[int64]string{m.ChatID: kind})
	return repliesOf(threads, m.ID)
}

// geoLiveUpdatePayload — тело фрейма geo_live_update (обновление координат
// трансляции): клиент правит вложение открытого бабла без перезагрузки истории.
//
// Координаты едут ТЕМ ЖЕ конструктором, что и в самом сообщении
// (messageMediaGeoLive под ключом media): собственный ключ `geo` с плоской
// точкой внутри был второй формой гео на проводе.
//
// Время обновления едет ОТДЕЛЬНЫМ ключом edit_date, а не внутри вложения: одно
// и то же edited_at прежде значило и «время правки» на верхнем уровне, и «время
// обновления координат» внутри гео — два смысла на одну колонку. Оно же решает,
// каким уедет period остановленной трансляции, поэтому едут они парой.
func geoLiveUpdatePayload(m domain.Message) map[string]any {
	p := map[string]any{"id": m.Seq, "media": m.ToWire(domain.MessageContext{}).(domain.MessageReal).Media}
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
func factCheckUpdatePayload(peer domain.PeerID, m domain.Message) map[string]any {
	body := map[string]any{
		"_":      domain.UpdateMessageFactCheckTag,
		"peer":   domain.NewPeer(peer),
		"msg_id": m.Seq,
	}
	// «Проверку сняли» — ОТСУТСТВИЕ параметра, а не null под тем же ключом.
	if fc := factCheckJSON(m.FactCheck); fc != nil {
		body["factcheck"] = fc
	}
	return body
}

// editMessagePayload — тело кадра правки: КОНСТРУКТОР updateEditMessage,
// несущий сообщение ЦЕЛИКОМ.
//
// Прежде здесь ехал ПАТЧ (id + текст + сущности + дата правки + разметка +
// иногда действие) — вторая проводная форма сообщения, долг, названный ещё
// портом самого сообщения. Теперь форма одна: то же тело, что у new_message,
// отличается только конструктор.
//
// Канальная правка едет ТЕМ ЖЕ конструктором, а не updateEditChannelMessage, и
// это не упрощение: у канального конструктора `pts` — ПЕР-КАНАЛЬНЫЙ, а правка
// у нас доставляется пер-юзерным веером со своим курсором. Приклеить канальный
// конструктор к пер-юзерному курсору значило бы соврать о том, какой курсор
// двигать. Перевод правки на журнал канала — долг ДОСТАВКИ, назван в разборе.
func (i *Interactor) editMessagePayload(ctx context.Context, m domain.Message) map[string]any {
	return i.newMessagePayload(ctx, m, domain.UpdateEditMessageTag)
}

// deletePayload — тело кадра удаления.
//
// Конструктор НАШ (updateDeletePeerMessages), и причина названа в его докблоке:
// схемный updateDeleteMessages пира не несёт вовсе — у оригинала номер
// сообщения уникален в «ящике» получателя, а у нас он пер-чатный.
//
// Признака `for_me` («удалить у себя») здесь больше нет: в схеме его нет, и
// предмета у него не было — «удалено у меня» это тот же кадр, просто
// разосланный ОДНОМУ получателю. Потребителей у поля не нашлось ни одного.
func deletePayload(peer domain.PeerID, seq int64) map[string]any {
	return map[string]any{
		"_":         domain.UpdateDeletePeerMessagesTag,
		"peer":      domain.NewPeer(peer),
		"messages":  []int64{seq},
		"pts_count": domain.PtsCountOne,
	}
}

// mediaReadPayload — тело кадра «вложение прослушано» (голосовое, кружок).
func mediaReadPayload(peer domain.PeerID, seq int64) map[string]any {
	return map[string]any{
		"_":         domain.UpdateReadPeerMessagesContentsTag,
		"peer":      domain.NewPeer(peer),
		"messages":  []int64{seq},
		"pts_count": domain.PtsCountOne,
	}
}

// typingPayload — тело кадра «печатает».
//
// Конструктора два, и выбирает между ними ТИП ЧАТА, а не флаг: в личном чате
// пир — это сам печатающий (updateUserTyping ключа пира не несёт вовсе), а в
// группе адрес чата и автор — разные параметры, потому что это разные вопросы.
//
// Отсюда и упрощение рассылки: тело одно на всех получателей, потому что
// пер-зрительского в нём ничего нет. Прежде ключ пира приклеивался снаружи
// каждому — как у кадров, где он и правда зависит от зрителя.
func typingPayload(addr chatAddress, userID int64, act domain.SendMessageAction) map[string]any {
	// members != nil — личный чат или «Избранное»: у них пир это человек.
	if addr.members != nil {
		return map[string]any{
			"_":       domain.UpdateUserTypingTag,
			"user_id": userID,
			"action":  act,
		}
	}
	return map[string]any{
		"_":          domain.UpdateChannelUserTypingTag,
		"channel_id": addr.chatID,
		"from_id":    domain.NewPeerUser(userID),
		"action":     act,
	}
}

// draftPayload — тело кадра черновика.
//
// «Черновик снят» — КОНСТРУКТОР draftMessageEmpty, а не `draft: null`. Прежде
// отсутствие выражалось значением, и каждый читатель заводил свою ветку
// `if (draft)`; выбор конструктора делает это ветвление тем же, что у любого
// другого объединения схемы.
func draftPayload(peer domain.PeerID, d *domain.Draft) map[string]any {
	var draft domain.DraftMessage = domain.NewDraftMessageEmpty()
	if d != nil {
		draft = d.Wire()
	}
	return map[string]any{
		"_":     domain.UpdateDraftMessageTag,
		"peer":  domain.NewPeer(peer),
		"draft": draft,
	}
}

// dialogPinPayload — тело кадра закрепления ДИАЛОГА.
//
// Конструктор один на оба действия: «открепили» — это опущенный бит
// `pFlags.pinned`, а не поле `pinned: false` и не второй кадр. То же правило,
// что у закрепления сообщения, и та же причина: у оригинала «выключено» это
// отсутствие, а кодек TL держит `false` ошибкой.
//
// Ключ пира здесь обёрнут в dialogPeer: список диалогов адресуется своим
// пространством, а не голым пиром.
func dialogPinPayload(peer domain.PeerID, pinned bool) map[string]any {
	body := map[string]any{
		"_":    domain.UpdateDialogPinnedTag,
		"peer": domain.NewDialogPeer(domain.NewPeer(peer)),
	}
	if pinned {
		body["pFlags"] = map[string]bool{"pinned": true}
	}
	return body
}

// dialogFolderPayload — тело кадра ПЕРЕЕЗДА диалога между папками.
//
// АРХИВ — ЭТО ПАПКА. У нас кадр вёз `archived: bool`, то есть значение (номер
// папки) было подделано признаком — тот же дефект, что у мьюта булевым. В схеме
// пир едет ВМЕСТЕ с номером папки, и «вернуть из архива» это folder_id = 0, тем
// же кадром. Появись третья папка — кадр не изменится вовсе.
//
// Вектор, а не один пир: у оригинала одно действие переносит сразу пачку. Мы
// переносим по одному, и это видно по длине — но форма остаётся вектором,
// потому что на проводе TL у него есть шапка со счётчиком.
//
// Курсор здесь ВНУТРИ тела: у updateFolderPeers параметр pts есть (в отличие от
// соседних кадров диалогов), и дописывает его framePts на выходе.
func dialogFolderPayload(peer domain.PeerID, folder domain.FolderID) map[string]any {
	return map[string]any{
		"_":            domain.UpdateFolderPeersTag,
		"folder_peers": []domain.FolderPeer{domain.NewFolderPeer(domain.NewPeer(peer), folder)},
		"pts_count":    domain.PtsCountOne,
	}
}

// notifySettingsPayload — тело кадра настроек уведомлений чата.
//
// Настройки едут ЦЕЛИКОМ и абсолютно — тем же конструктором, что внутри
// диалога: второй формы у них нет. Мьют внутри — СРОК, а не признак.
func notifySettingsPayload(peer domain.PeerID, settings domain.PeerNotifySettings) map[string]any {
	return map[string]any{
		"_":               domain.UpdateNotifySettingsTag,
		"peer":            domain.NewNotifyPeer(domain.NewPeer(peer)),
		"notify_settings": settings,
	}
}

// reactionsPayload — тело кадра реакций: конструктор updateMessageReactions с
// АБСОЛЮТНЫМ агрегатом сообщения.
//
// Диффа (кто, какой эмодзи, добавил или снял) здесь больше нет. Кадр вёз ДВЕ
// формы одного факта сразу: авторитетный агрегат и дифф «для анимации», и при
// гонке двух реакций клиент верил разным полям по-разному. У оригинала дифф
// выводит КЛИЕНТ — из разницы с тем состоянием, которое у него уже есть.
//
// Агрегат помечен `min`: тело кадра одно на всех получателей, значит
// пер-зрительской части (мой chosen_order) в нём нет и быть не может. Без флага
// клиент не отличил бы «я не ставил» от «сервер этого не сообщил» и стёр бы
// собственный выбор при первом же чужом клике — ровно тот дефект, который порт
// опроса уже закрыл флагом pollResults.min.
func reactionsPayload(peer domain.PeerID, seq int64, reactions domain.MessageReactions) map[string]any {
	reactions.MarkMin()
	return map[string]any{
		"_":         domain.UpdateMessageReactionsTag,
		"peer":      domain.NewPeer(peer),
		"msg_id":    seq,
		"reactions": reactions,
		"pts_count": domain.PtsCountOne,
	}
}
