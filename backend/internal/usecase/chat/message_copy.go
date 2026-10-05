package chat

import (
	"context"
	"math/rand/v2"

	"github.com/messenger-denis/backend/internal/domain"
)

// copyContent — СОДЕРЖИМОЕ сообщения для новой строки: всё, что пользователь
// видит в бабле, и только это. Один копировщик на все пути, которыми
// существующее сообщение рождает новое (пересылка, зеркало поста канала в
// группе обсуждения): у оригинала сервер копирует `media` целиком, а не
// перечисленные поштучно поля, и именно поштучные литералы теряли гео,
// контакт, опрос, чек-лист, розыгрыш, превью ссылки и альбом.
//
// Не копируется то, что принадлежит самой строке, а не содержимому: адрес
// (чат, номер, автор, тред, ответ), атрибуция пересылки, время, правка,
// счётчики, реакции, эффект отправки, самоуничтожение. grouped_id копируется
// как есть — новый общий ключ пачке выдаёт вызывающий (regroup).
//
// Платная цена медиа живёт в отдельной таблице (paid_media) и в строку не
// входит: её переносит вызывающий, которому она нужна.
func copyContent(src domain.Message) domain.Message {
	return domain.Message{
		Type: src.Type, Text: src.Text, Entities: src.Entities,
		MediaID: src.MediaID, MediaSpoiler: src.MediaSpoiler,
		// Голосовое и кружок у получателя копии ещё не прослушаны.
		MediaUnread: src.Type == "voice" || src.Type == "roundVideo",
		GroupedID:   src.GroupedID,
		PollID:      src.PollID, ChecklistID: src.ChecklistID,
		GiveawayID: src.GiveawayID, GiftID: src.GiftID,
		GeoLat: src.GeoLat, GeoLng: src.GeoLng,
		GeoTitle: src.GeoTitle, GeoAddress: src.GeoAddress,
		GeoLivePeriod: src.GeoLivePeriod, GeoHeading: src.GeoHeading, GeoLiveStopped: src.GeoLiveStopped,
		ContactUserID: src.ContactUserID, ContactName: src.ContactName, ContactPhone: src.ContactPhone,
		ReplyMarkup: src.ReplyMarkup,
		WebPage:     src.WebPage,
	}
}

// regroup выдаёт копиям пачки НОВЫЕ ключи альбомов: элементы одного исходного
// альбома получают общий новый grouped_id (Telegram: пересланный альбом — снова
// альбом, со своим grouped_id), одиночные сообщения остаются одиночными.
// Возвращает число единиц отправки в пачке (альбом — одна).
func regroup(copies []domain.Message) int {
	fresh := map[int64]int64{}
	units := 0
	for idx := range copies {
		g := copies[idx].GroupedID
		if g == nil {
			units++
			continue
		}
		n, ok := fresh[*g]
		if !ok {
			n = rand.Int64N(1<<62) + 1
			fresh[*g] = n
			units++
		}
		copies[idx].GroupedID = &n
	}
	return units
}

// forwardable — можно ли переслать сообщение (tweb canForward: только
// `message`, не messageService; не медиа с самоуничтожением). Подарок у
// оригинала — служебное действие (messageActionStarGift), лог звонка — тоже;
// секретное сообщение сервер не читает и переслать его нельзя.
func forwardable(m domain.Message) bool {
	if m.Deleted || m.Action != nil || len(m.EncBody) > 0 || m.TTLSeconds != nil {
		return false
	}
	switch m.Type {
	case "service", "call", "encrypted", "gift":
		return false
	}
	return true
}

// sendProbe — отправка, которой для гейтов Send эквивалентна копия m в chatID
// от senderID: те же права (медиа-бит по содержимому копии), приватность
// получателя (голосовое — своё правило) и плата.
func sendProbe(chatID, senderID int64, m domain.Message) SendInput {
	return SendInput{
		ChatID: chatID, SenderID: senderID, Type: m.Type,
		MediaID: m.MediaID, PollID: m.PollID, ChecklistID: m.ChecklistID,
		GeoLat: m.GeoLat, ContactUserID: m.ContactUserID, GroupedID: deref(m.GroupedID),
		ThreadRootID: m.ThreadRootID,
	}
}

func deref(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

// insertCopy вставляет копию вместе с превью ссылки: web_page в строку пишет
// отдельный UPDATE (как у серверного превью после отправки), а у копии оно уже
// есть — второй раз строить его незачем.
func (i *Interactor) insertCopy(ctx context.Context, m domain.Message) (domain.Message, error) {
	wp := m.WebPage
	msg, err := i.msgs.Insert(ctx, m)
	if err != nil {
		return domain.Message{}, err
	}
	if wp != nil {
		if err := i.msgs.SetWebPage(ctx, msg.ID, wp); err != nil {
			return domain.Message{}, err
		}
		msg.WebPage = wp
	}
	return msg, nil
}
