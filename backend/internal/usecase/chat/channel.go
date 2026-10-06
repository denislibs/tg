package chat

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// CreateChannel creates a channel and adds the creator as RoleCreator with all rights.
func (i *Interactor) CreateChannel(ctx context.Context, creatorID int64, title, about, username string, isPublic bool) (int64, error) {
	var chatID int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.groups.CreateMultiMember(ctx, domain.ChatTypeChannel, title, about, username, isPublic, creatorID)
		if e != nil {
			return e
		}
		chatID = id
		return i.groups.AddMember(ctx, id, creatorID, domain.RoleCreator, domain.AllRights)
	})
	if err != nil {
		return chatID, err
	}
	// Создатель — первый участник: его сокеты подписываются на топик канала
	// (updateChannel), иначе посты других админов, просмотры и карточка
	// канала не доходили бы до него до реконнекта.
	i.announceChannelJoin(ctx, chatID, creatorID)
	// A2-07: новый канал — снимок создателю в журнал (его прочие устройства
	// узнают о диалоге; клиент перечитывает список, не найдя чата).
	i.publishViewerChat(ctx, chatID, creatorID)
	return chatID, nil
}

// PostToChannel публикует ТЕКСТОВЫЙ пост в канал.
//
// Своей реализации у неё больше нет: доставка постом канала (channel_pts +
// запись журнала + одна публикация в топик, без веера по подписчикам) — это
// ветка обычной отправки, выбранная по виду ПИРА, как в оригинале, где метод
// отправки один на все виды получателей. Пока веток было две, ручка постинга
// принимала только текст, и всё, что несёт вложение — пост с картинкой,
// опрос, чек-лист, розыгрыш, — уходило второй веткой: мимо журнала канала (то
// есть мимо догона разрыва) и мимо гейта прав.
//
// Ручка остаётся как имя действия «опубликовать в канал» — у неё своя проверка
// на границе HTTP и своя форма ответа.
func (i *Interactor) PostToChannel(ctx context.Context, channelID, actorID int64, text string, entities domain.MessageEntities, clientMsgID string) (domain.Message, error) {
	return i.Send(ctx, SendInput{
		ChatID: channelID, SenderID: actorID, Text: text, Entities: entities, ClientMsgID: clientMsgID,
	})
}

// channelPostPayload — тело кадра поста канала для channel-лога и живого кадра
// (единый источник, чтобы difference-реплей и live совпадали побайтно, кроме
// channel_pts).
//
// Собственной формы у него больше нет: это ТОТ ЖЕ messageUpdatePayload, что у
// личного чата и группы. Прежде здесь была отдельная, ДЕВЯТАЯ проводная форма
// сообщения, и она зашивала `"type": "text"` и `"media_id": nil` ЛИТЕРАЛАМИ —
// медиа-пост этой формой передать было нельзя вовсе.
//
// Ключ пира здесь ставится сразу, а не приклеивается на выходе: у канала он
// один на всех подписчиков (peerChannel), от зрителя не зависит.
func (i *Interactor) channelPostPayload(ctx context.Context, m domain.Message) map[string]any {
	// out здесь НЕ ставится, и это осознанно: тело поста канала одно на всех
	// подписчиков (в канале с миллионом их разворачивать по зрителям
	// расточительно), а `out` — пер-зритель. Автор получает верный флаг из
	// ответа на свою же публикацию и из истории.
	return withPeer(i.channelMessagePayload(ctx, m), domain.ToPeerID(m.ChatID, true), viewerFlags{})
}

// SetSignatures toggles channel post signatures (Telegram
// channels.toggleSignatures). Requires RightChangeInfo. profiles is only
// meaningful when signatures is on (the repo forces it off otherwise).
func (i *Interactor) SetSignatures(ctx context.Context, channelID, actorID int64, signatures, profiles bool) error {
	if err := i.requireRight(ctx, channelID, actorID, domain.RightChangeInfo); err != nil {
		return err
	}
	if !signatures {
		profiles = false
	}
	if err := i.groups.SetSignatures(ctx, channelID, signatures, profiles); err != nil {
		return err
	}
	i.publishChatUpdate(ctx, channelID) // подписи постов канала изменились
	return nil
}

// GetChannelDifference returns channel updates newer than sincePts. Membership-gated.
func (i *Interactor) GetChannelDifference(ctx context.Context, channelID, userID, sincePts int64, limit int) ([]domain.ChannelUpdate, error) {
	ok, err := i.chats.IsMember(ctx, channelID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.ErrForbidden
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	ups, err := i.channels.UpdatesSince(ctx, channelID, sincePts, limit)
	if err != nil {
		return nil, err
	}
	return i.markOwnPosts(ctx, channelID, userID, ups), nil
}

// markOwnPosts — запись журнала канала одна на всех подписчиков и `out` не
// несёт; запрашивающему догон его собственные посты (и их правки) отдаются с
// pFlags.out — у оригинала `out` рисует сервер каждому получателю, в том числе
// в getChannelDifference. Без этого автор, догоняющий канал с другого
// устройства, видел свой пост входящим и получал +1 непрочитанного.
func (i *Interactor) markOwnPosts(ctx context.Context, channelID, viewerID int64, ups []domain.ChannelUpdate) []domain.ChannelUpdate {
	type msgRow struct {
		idx  int
		body map[string]any
		msg  map[string]any
	}
	var rows []msgRow
	var seqs []int64
	for k, u := range ups {
		var body map[string]any
		if json.Unmarshal(u.Payload, &body) != nil {
			continue
		}
		if tag, _ := body["_"].(string); tag != domain.UpdateNewChannelMessageTag && tag != domain.UpdateEditChannelMessageTag {
			continue
		}
		msg, _ := body[frameMessageKey].(map[string]any)
		seq, ok := msg["id"].(float64)
		if !ok {
			continue
		}
		rows = append(rows, msgRow{idx: k, body: body, msg: msg})
		seqs = append(seqs, int64(seq))
	}
	if len(rows) == 0 {
		return ups
	}
	msgs, err := i.msgs.GetBySeqs(ctx, channelID, seqs)
	if err != nil {
		return ups
	}
	own := map[int64]bool{}
	for _, m := range msgs {
		if m.SenderID == viewerID {
			own[m.Seq] = true
		}
	}
	for _, r := range rows {
		if !own[int64(r.msg["id"].(float64))] {
			continue
		}
		flags, _ := r.msg["pFlags"].(map[string]any)
		if flags == nil {
			flags = map[string]any{}
		}
		flags["out"] = true
		r.msg["pFlags"] = flags
		if raw, err := json.Marshal(r.body); err == nil {
			ups[r.idx].Payload = raw
		}
	}
	return ups
}

// JoinPublic вступает в публичный чат по @имени (channels.joinChannel): в
// канал — подписчиком, в группу — участником; забаненного не пускает.
func (i *Interactor) JoinPublic(ctx context.Context, username string, userID int64) error {
	id, err := i.search.PublicChatByUsername(ctx, username)
	if err != nil {
		return err
	}
	joined, err := i.admit(ctx, id, userID, userID, admitSelf)
	if err != nil || !joined {
		return err
	}
	// Вступившему в канал — updateChannel: диалог и подписка сокетов на
	// топик (Ф-2); остальные кадры вступления — ниже.
	i.announceChannelJoin(ctx, id, userID)
	// A2-07/A6-05: вступление по @имени живьём. Группа — служебка «вступил(а)»
	// (у оригинала messageActionChatAddUser с самим собой); канал — без неё:
	// состав broadcast-канала служебками не пишется (postGroupService).
	i.postGroupService(ctx, id, userID, domain.NewMessageActionChatAddUser([]int64{userID}))
	i.publishChatUpdate(ctx, id)
	i.publishViewerChat(ctx, id, userID)
	i.emitParticipant(ctx, id, userID, userID, nil, participantWire(i.participantNow(ctx, id, userID)), nil)
	return nil
}

// PeerSearchResult — выдача поиска пиров (contacts.search): «свои»
// попадания (my_results) и глобальные (results).
type PeerSearchResult struct {
	MyChats []domain.ChatRecord
	MyUsers []domain.UserReal
	Chats   []domain.ChatRecord
	Users   []domain.UserReal
}

// peerSearchLimitMax — потолок выдачи поиска пиров: вкладка Channels
// просит 200 (tweb appSearchSuper.ts:1977, «will get filtered anyway»).
const peerSearchLimitMax = 200

// SearchPeers — поиск пиров для глобального поиска (аналог contacts.search):
// публичные чаты по @username/названию и пользователи, каждый вид — до limit
// (нет — 20, больше потолка — потолок). Попадания делятся на «свои» — чат,
// где зритель участник, пользователь из контактов или с общим личным чатом —
// и глобальные: класс рисует my_results в группе «Chats», results — в
// «Global search» (tweb appSearchSuper.ts:1427-1428), и свой диалог в
// «Global search» был бы дублем. Принадлежность спрашивается одним вызовом
// на всю выдачу. Пустой q — пусто: префикс «» совпал бы со всей базой.
func (i *Interactor) SearchPeers(ctx context.Context, viewerID int64, q string, limit int) (PeerSearchResult, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return PeerSearchResult{}, nil
	}
	switch {
	case limit <= 0:
		limit = 20
	case limit > peerSearchLimitMax:
		limit = peerSearchLimitMax
	}
	chats, err := i.search.SearchChats(ctx, q, limit)
	if err != nil {
		return PeerSearchResult{}, err
	}
	users, err := i.search.SearchUsers(ctx, viewerID, q, limit)
	if err != nil {
		return PeerSearchResult{}, err
	}
	chatIDs := make([]int64, len(chats))
	for k, c := range chats {
		chatIDs[k] = c.ID
	}
	userIDs := make([]int64, len(users))
	for k, u := range users {
		userIDs[k] = u.ID
	}
	ownChats, ownUsers, err := i.search.OwnPeers(ctx, viewerID, chatIDs, userIDs)
	if err != nil {
		return PeerSearchResult{}, err
	}
	var res PeerSearchResult
	for _, c := range chats {
		if ownChats[c.ID] {
			res.MyChats = append(res.MyChats, c)
		} else {
			// Чужой публичный чат — глазами зрителя, который в нём НЕ состоит:
			// карточка уходит с pFlags.left, и клиент рисует превью с кнопкой
			// «Вступить»/«Подписаться» (tweb input.ts:2650-2672), а не вступает
			// сам. Без зрителя (ViewerID 0) left тождественно ложен.
			c.ViewerID = viewerID
			res.Chats = append(res.Chats, c)
		}
	}
	for _, u := range users {
		if ownUsers[u.ID] {
			res.MyUsers = append(res.MyUsers, u)
		} else {
			res.Users = append(res.Users, u)
		}
	}
	return res, nil
}

// SimilarChannels рекомендует публичные каналы, похожие на chatID по аудитории.
func (i *Interactor) SimilarChannels(ctx context.Context, chatID, viewerID int64, limit int) ([]domain.ChatRecord, int, error) {
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	return i.search.SimilarChannels(ctx, chatID, viewerID, limit)
}
