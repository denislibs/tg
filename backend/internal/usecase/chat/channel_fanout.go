package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// Доставка broadcast-канала.
//
// Пост канала пишется ОДНОЙ строкой журнала канала (O(1) на пост), а не веером
// по личным журналам подписчиков. Всё, что у обычного чата делает веер, у
// канала делается здесь, после коммита, и тоже без записей на подписчика:
//
//   - живой кадр — одной публикацией в топик канала; на топик подписано каждое
//     соединение каждого подписчика (ws: Register + updateChannel), а не только
//     открывшее канал, — как у оригинала, где сервер шлёт updateNewChannelMessage
//     всем онлайн-сессиям участников;
//   - непрочитанное — на чтении (postgres dialogUnreadCount), поэтому писать
//     нечего, сбрасывается только снимок списка чатов подписчиков;
//   - пуш — батчем по подписчикам (PushNotifier.NotifyChannelPost);
//   - черновик автора и превью ссылки — как у обычной отправки.

// channelPostOpts — чем пост отличается от других путей публикации.
type channelPostOpts struct {
	// silent — без звука (messages.sendMessage silent): пуша нет.
	silent bool
	// clearDraft — отправка снимает черновик автора (Telegram-семантика); у
	// пересылки и служебки черновик не трогается.
	clearDraft bool
	// preview — строить превью первой ссылки (обычный текстовый пост).
	preview bool
}

// appendChannelUpdate — запись в журнал канала внутри транзакции вызывающего
// (ctx несёт её). Возвращает пер-канальный pts записи.
func (i *Interactor) appendChannelUpdate(ctx context.Context, channelID int64, typ string, body map[string]any) (int64, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, err
	}
	return i.channels.AppendUpdate(ctx, channelID, typ, raw)
}

// publishChannelUpdate — живой кадр записи журнала канала. Звать СТРОГО после
// коммита записи.
//
// author — автор сообщения в теле кадра (0 — кадр без сообщения). Тело одно на
// всех подписчиков и `out` не несёт (пер-зрительский флаг), поэтому автору —
// всем его устройствам — раньше топика уходит СВОЯ копия с pFlags.out и тем же
// pts: у оригинала сервер рисует `out` каждому получателю сам. Порядок
// публикаций сохраняется до сокета (один pub/sub-поток хаба), и топиковая копия
// у автора отсекается канальной воронкой клиента как дубль по pts.
func (i *Interactor) publishChannelUpdate(ctx context.Context, channelID int64, typ string, body map[string]any, pts int64, author int64) {
	if author != 0 && i.publisher != nil {
		if _, ok := body[frameMessageKey]; ok {
			own := withPeer(body, domain.ToPeerID(channelID, true), viewerFlags{out: true})
			_ = i.publisher.PublishToUser(ctx, author, framePts(typ, own, pts))
		}
	}
	if i.chPub != nil {
		_ = i.chPub.PublishToChannel(ctx, channelID, framePts(typ, body, pts))
	}
}

// deliverChannelPost — пост-коммитная половина публикации поста канала: общая
// для отправки (Send), пересылки и одобренной предложки — до неё каждый путь
// публиковал в топик сам и ничего больше не делал.
func (i *Interactor) deliverChannelPost(ctx context.Context, msg domain.Message, body map[string]any, pts int64, opt channelPostOpts) {
	i.publishChannelUpdate(ctx, msg.ChatID, "new_message", body, pts, msg.SenderID)
	if members, err := i.chats.MemberIDs(ctx, msg.ChatID); err == nil {
		// Пост поднял канал и добавил непрочитанное (оно считается на чтении) —
		// снимок списка чатов подписчиков устарел.
		if i.dialogsCache != nil {
			i.dialogsCache.Invalidate(ctx, members...)
		}
		if !opt.silent {
			i.notifyChannelPost(ctx, msg, members)
		}
	}
	if opt.clearDraft {
		i.clearDraftAfterSend(ctx, msg.SenderID, msg.ChatID)
	}
	if opt.preview && i.preview != nil && msg.Type == "text" {
		if u := firstURL(msg.Text, msg.Entities); u != "" {
			go i.attachWebPreview(msg, u, nil)
		}
	}
}

// notifyChannelPost — пуш подписчикам (кроме автора) одним батчем: кто онлайн и
// у кого канал или каналы вообще замьючены, решает нотификатор пачкой, а не
// запросом на подписчика. Заголовок — название канала: автор поста без подписей
// скрыт (Message.wireFromID), и его имя в пуше раскрыло бы его.
func (i *Interactor) notifyChannelPost(ctx context.Context, msg domain.Message, members []int64) {
	if i.notifier == nil {
		return
	}
	recipients := make([]int64, 0, len(members))
	for _, uid := range members {
		if uid != msg.SenderID {
			recipients = append(recipients, uid)
		}
	}
	if len(recipients) == 0 {
		return
	}
	title := ""
	if i.groups != nil {
		if card, err := i.groups.Card(ctx, msg.ChatID, 0); err == nil {
			title = card.Title
		}
	}
	i.notifier.NotifyChannelPost(ctx, msg.ChatID, recipients, msg.Seq, title, msg.Text,
		domain.ToPeerID(msg.ChatID, true))
}

// channelEditPayload — тело правки поста канала: сообщение целиком под
// конструктором updateEditChannelMessage (курсор — пер-канальный).
func (i *Interactor) channelEditPayload(ctx context.Context, m domain.Message) map[string]any {
	return withPeer(i.newMessagePayload(ctx, m, domain.UpdateEditChannelMessageTag),
		domain.ToPeerID(m.ChatID, true), viewerFlags{})
}

// channelDeletePayload — тело удаления постов канала (updateDeleteChannelMessages).
func channelDeletePayload(channelID int64, seqs []int64) map[string]any {
	return map[string]any{
		"_":          domain.UpdateDeleteChannelMessagesTag,
		"channel_id": channelID,
		"messages":   seqs,
		"pts_count":  domain.PtsCountOne,
	}
}

// channelPinPayload — тело закрепления в канале (updatePinnedChannelMessages);
// «открепили» — отсутствие бита.
func channelPinPayload(channelID, seq int64, pinned bool) map[string]any {
	p := map[string]any{
		"_":          domain.UpdatePinnedChannelMessagesTag,
		"channel_id": channelID,
		"messages":   []int64{seq},
		"pts_count":  domain.PtsCountOne,
	}
	if pinned {
		p["pFlags"] = map[string]bool{"pinned": true}
	}
	return p
}

// publishChannelEdit — правка поста канала (и догоняющее превью ссылки) одной
// записью журнала канала с живым кадром в топик. Своя транзакция: зовётся
// после того, как сама правка уже записана.
func (i *Interactor) publishChannelEdit(ctx context.Context, m domain.Message) error {
	if i.channels == nil {
		return nil
	}
	body := i.channelEditPayload(ctx, m)
	var pts int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		p, e := i.appendChannelUpdate(ctx, m.ChatID, "edit_message", body)
		pts = p
		return e
	})
	if err != nil {
		return err
	}
	i.publishChannelUpdate(ctx, m.ChatID, "edit_message", body, pts, m.SenderID)
	return nil
}

// isBroadcast — чат это broadcast-канал (доставка — журналом канала).
func (i *Interactor) isBroadcast(ctx context.Context, chatID int64) bool {
	return i.chatKind(ctx, chatID) == domain.ChatTypeChannel
}

// announceChannelJoin — пользователь вступил в broadcast-канал: ему (всем его
// устройствам, с журналом — офлайн-устройство догонит /sync) уходит
// updateChannel. По нему хаб подписывает его сокеты на топик канала, а клиент
// заводит диалог (tweb onUpdateChannel → reloadConversation). Звать после
// коммита вступления; у не-канала — ничего.
func (i *Interactor) announceChannelJoin(ctx context.Context, chatID, userID int64) {
	if !i.isBroadcast(ctx, chatID) {
		return
	}
	_ = i.logAndPublishPerPeer(ctx, chatID, []int64{userID}, "channel",
		func(domain.PeerID) map[string]any {
			return map[string]any{"_": domain.UpdateChannelTag, "channel_id": chatID}
		})
}

// channelSubscriptionsLimit — потолок топиков на соединение: столько каналов
// держит аккаунт у оригинала с запасом (500 обычному, 1000 премиуму).
const channelSubscriptionsLimit = 1000

// ChannelSubscriptions — топики каналов, на которые подписать новое соединение
// пользователя: его broadcast-каналы, каждый — через тот же гейт, что кадр
// subscribe_channel (CanSubscribeChannel), чтобы правило «кто читает топик»
// было одно.
func (i *Interactor) ChannelSubscriptions(ctx context.Context, userID int64) []domain.PeerID {
	ids, err := i.chats.BroadcastChannelIDs(ctx, userID, channelSubscriptionsLimit)
	if err != nil {
		return nil
	}
	out := make([]domain.PeerID, 0, len(ids))
	for _, id := range ids {
		peer := domain.ToPeerID(id, true)
		if i.CanSubscribeChannel(ctx, userID, peer) {
			out = append(out, peer)
		}
	}
	return out
}
