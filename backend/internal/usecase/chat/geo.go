package chat

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// UpdateLiveLocation обновляет координаты live-локации сообщения (автор шлёт их
// периодически по watchPosition) или останавливает трансляцию (stopped=true).
//
// Движение точки — ПРАВКА сообщения, как у оригинала (tweb: updateEditMessage
// → bubbles.ts updateGeo, отдельного кадра у него нет): правит координаты и
// edited_at, затем идёт общим путём правки с журналом — личка, группа и
// «Избранное» раскладывают edit_message по журналам участников (fanOutEdit),
// broadcast-канал пишет одну запись журнала канала (updateEditChannelMessage),
// как EditMessage. Офлайн-участник получает новые координаты в getDifference.
// Только автор своего live-сообщения.
func (i *Interactor) UpdateLiveLocation(ctx context.Context, chatID, msgID, userID int64, lat, lng float64, heading *int, stopped bool) (domain.Message, error) {
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return domain.Message{}, domain.ErrForbidden
	}
	cur, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return domain.Message{}, err
	}
	if cur.ChatID != chatID || cur.Deleted || cur.Type != "geo" || cur.GeoLivePeriod == nil {
		return domain.Message{}, domain.ErrNotFound // не live-локация
	}
	// Двигает точку только её автор, и только у СВОЕГО сообщения: копия
	// (пересылка, зеркало поста) несёт «Переслано от …», и чужие координаты
	// под этой подписью — подделка (как правка пересланного, A5-13).
	if cur.SenderID != userID || isCopy(cur) {
		return domain.Message{}, domain.ErrForbidden
	}
	// Правит тот, кто ещё вправе писать в этот чат: вышедшему, кикнутому и
	// разжалованному админу устройство, которое продолжает слать точки,
	// двигать чужой чат нельзя (CHAT_WRITE_FORBIDDEN, как у EditMessage).
	if err := i.requireGeoWriter(ctx, chatID, userID); err != nil {
		return domain.Message{}, err
	}
	// Остановленная и истёкшая трансляция не меняется: в схеме конец — это
	// истечение срока (tweb geo.ts:178 isLiveExpired), а запоздавший тик не
	// должен её «воскрешать»; сервер Telegram отвечает MESSAGE_NOT_MODIFIED.
	if cur.GeoLiveStopped || !time.Now().Before(cur.CreatedAt.Add(time.Duration(*cur.GeoLivePeriod)*time.Second)) {
		return domain.Message{}, domain.ErrMessageNotModified
	}
	if heading != nil && (*heading < 0 || *heading > 359) {
		heading = nil
	}
	// Та же точка — не правка (MESSAGE_NOT_MODIFIED у оригинала): не пишем
	// строку журнала каждому участнику ради того, что не изменилось.
	if !stopped && cur.GeoLat != nil && cur.GeoLng != nil && *cur.GeoLat == lat && *cur.GeoLng == lng &&
		(heading == nil || (cur.GeoHeading != nil && *cur.GeoHeading == *heading)) {
		return cur, nil
	}
	broadcast := i.isBroadcast(ctx, chatID)
	var msg domain.Message
	var channelBody map[string]any
	var channelPts int64
	var edit *editDelivery
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		m, e := i.msgs.UpdateGeoLive(ctx, msgID, lat, lng, heading, stopped)
		if e != nil {
			return e
		}
		// Правка заменяет сообщение на клиенте целиком (updateEditMessage):
		// без гидрации она погасила бы реакции и ответы.
		if msg, e = i.hydrateBroadcastMessage(ctx, m); e != nil {
			return e
		}
		if broadcast {
			channelBody = i.channelEditPayload(ctx, msg)
			channelPts, e = i.appendChannelUpdate(ctx, chatID, "edit_message", channelBody)
			return e
		}
		edit, e = i.fanOutEdit(ctx, msg, msg.SenderID, msg.SenderID, nil)
		return e
	})
	if err != nil {
		return domain.Message{}, err
	}
	if broadcast {
		i.publishChannelUpdate(ctx, chatID, "edit_message", channelBody, channelPts, msg.SenderID)
		return msg, nil
	}
	i.publishEdit(ctx, edit)
	return msg, nil
}

// requireGeoWriter — вправе ли userID сейчас писать в чат с live-локацией:
// участник; в группе — с правом писать (как canEditMessage), в канале — с
// правом публикации. Личка и «Избранное» — достаточно членства.
func (i *Interactor) requireGeoWriter(ctx context.Context, chatID, userID int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrForbidden
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return err
	}
	switch typ {
	case domain.ChatTypeChannel:
		return i.requireRight(ctx, chatID, userID, domain.RightPostMessages)
	case domain.ChatTypeGroup:
		if !i.canSendInGroup(ctx, chatID, userID) {
			return domain.ErrForbidden
		}
	}
	return nil
}
