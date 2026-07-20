package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// UpdateLiveLocation обновляет координаты live-локации сообщения (автор шлёт их
// периодически по watchPosition) или останавливает трансляцию (stopped=true).
// Правит координаты + edited_at и рассылает фрейм geo_live_update участникам —
// без записи в updates-лог (эфемерно; при переоткрытии история даёт актуальные
// координаты). Только автор своего live-сообщения.
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
	if cur.SenderID != userID {
		return domain.Message{}, domain.ErrForbidden
	}
	if heading != nil && (*heading < 0 || *heading > 359) {
		heading = nil
	}
	msg, err := i.msgs.UpdateGeoLive(ctx, msgID, lat, lng, heading, stopped)
	if err != nil {
		return domain.Message{}, err
	}
	if i.publisher != nil {
		members, err := i.chats.MemberIDs(ctx, chatID)
		if err != nil {
			return domain.Message{}, err
		}
		f := frame("geo_live_update", geoLiveUpdatePayload(msg))
		for _, uid := range members {
			_ = i.publisher.PublishToUser(ctx, uid, f)
		}
	}
	return msg, nil
}
