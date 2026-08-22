package chat

import (
	"context"

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
	return chatID, err
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
	return withPeer(i.channelMessagePayload(ctx, m), domain.ToPeerID(m.ChatID, true), false)
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
	return i.channels.UpdatesSince(ctx, channelID, sincePts, limit)
}

// JoinPublic subscribes userID to a public chat resolved by username.
func (i *Interactor) JoinPublic(ctx context.Context, username string, userID int64) error {
	id, err := i.search.PublicChatByUsername(ctx, username)
	if err != nil {
		return err
	}
	return i.groups.AddMember(ctx, id, userID, domain.RoleSubscriber, 0)
}

// SearchChats returns public chats matching q.
func (i *Interactor) SearchChats(ctx context.Context, q string, limit int) ([]domain.ChatRecord, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return i.search.SearchChats(ctx, q, limit)
}

// SimilarChannels рекомендует публичные каналы, похожие на chatID по аудитории.
func (i *Interactor) SimilarChannels(ctx context.Context, chatID, viewerID int64, limit int) ([]domain.ChatRecord, int, error) {
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	return i.search.SimilarChannels(ctx, chatID, viewerID, limit)
}

// SearchUsers returns users matching q.
func (i *Interactor) SearchUsers(ctx context.Context, q string, limit int) ([]domain.UserReal, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return i.search.SearchUsers(ctx, q, limit)
}
