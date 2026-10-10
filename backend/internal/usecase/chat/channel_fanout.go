package chat

import (
	"context"
	"encoding/json"
	"log"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/pkg/saferun"
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
//
// Синхронно — только живой кадр и черновик автора: они дёшевы и обязаны
// уйти до ответа. Всё, что растёт с числом подписчиков (список участников,
// сброс их снимков списка, пуш), — фоном (goBG): ответ админу и message_ack не
// ждут веера по каналу на сто тысяч человек.
func (i *Interactor) deliverChannelPost(ctx context.Context, msg domain.Message, body map[string]any, pts int64, opt channelPostOpts) {
	i.publishChannelUpdate(ctx, msg.ChatID, "new_message", body, pts, msg.SenderID)
	if opt.clearDraft {
		i.clearDraftAfterSend(ctx, msg.SenderID, msg.ChatID)
	}
	i.goBG("chat.channelPostFanout", func(ctx context.Context) {
		members, err := i.chats.MemberIDs(ctx, msg.ChatID)
		if err != nil {
			return
		}
		// Пост поднял канал и добавил непрочитанное (оно считается на
		// чтении) — снимок списка чатов подписчиков устарел.
		i.invalidateDialogs(ctx, members...)
		// Незаглушённый канал из архива возвращается в общий список, как у
		// любого чата (Ф-4 unarchiveOnMessage, keep_archived_unmuted).
		i.unarchiveOnMessage(ctx, msg.ChatID, msg.SenderID, members)
		if !opt.silent {
			i.notifyChannelPost(ctx, msg, members)
		}
	})
	if opt.preview && i.preview != nil && msg.Type == "text" {
		if u := firstURL(msg.Text, msg.Entities); u != "" {
			go i.attachWebPreview(msg, u, nil)
		}
	}
}

// goBG — фоновый хвост запроса: свой контекст (запрос к этому моменту может
// быть отменён), паника не роняет процесс, тесты дожидаются через i.bg.
func (i *Interactor) goBG(name string, fn func(ctx context.Context)) {
	i.bg.Add(1)
	go func() {
		defer i.bg.Done()
		defer saferun.Recover(name)
		fn(context.Background())
	}()
}

// notifyChannelPost — пуш подписчикам (кроме автора) одним батчем: кто онлайн и
// у кого канал или каналы вообще замьючены, решает нотификатор пачкой, а не
// запросом на подписчика. Заголовок — название канала (лёгким запросом, без
// карточки): автор поста без подписей скрыт (Message.wireFromID), и его имя в
// пуше раскрыло бы его.
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
	title, _ := i.chats.ChatTitle(ctx, msg.ChatID)
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

// publishChannelReactions — агрегат реакций поста канала (эмодзи и ⭐) одним
// кадром в топик, без журнала: у updateMessageReactions в схеме pts нет, а
// пропустивший кадр получает абсолютный агрегат с историей поста.
func (i *Interactor) publishChannelReactions(ctx context.Context, chatID, seq int64, agg domain.MessageReactions) {
	if i.chPub == nil {
		return
	}
	_ = i.chPub.PublishToChannel(ctx, chatID,
		frame("reaction", reactionsPayload(domain.ToPeerID(chatID, true), seq, agg)))
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

// AnnounceChannelJoin — то же для вступления, совершённого чужой транзакцией
// (вход по ссылке на папку: usecase папок зовёт его после коммита).
func (i *Interactor) AnnounceChannelJoin(ctx context.Context, chatID, userID int64) {
	i.announceChannelJoin(ctx, chatID, userID)
}

// channelSubscriptionsLimit — потолок топиков на соединение: столько каналов
// держит аккаунт у оригинала с запасом (500 обычному, 1000 премиуму).
const channelSubscriptionsLimit = 1000

// ChannelSubscriptions — каналы, на топики которых подписать новое соединение
// пользователя, с pts их журналов. Правило доступа то же, что у кадра
// subscribe_channel (CanSubscribeChannel = chatReadableBy), но одним запросом
// на всё подключение, а не по запросу на канал.
func (i *Interactor) ChannelSubscriptions(ctx context.Context, userID int64) []domain.ChannelCursor {
	cs, err := i.chats.ChannelCursors(ctx, userID, channelSubscriptionsLimit)
	if err != nil {
		return nil
	}
	if len(cs) == channelSubscriptionsLimit {
		log.Printf("chat: user %d: каналов больше %d — живые кадры старших не подписаны", userID, channelSubscriptionsLimit)
	}
	return cs
}
