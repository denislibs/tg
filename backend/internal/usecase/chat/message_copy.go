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
		// Живая геопозиция переезжает СНИМКОМ: двигать её может только автор
		// оригинала, а копия обновлений оригинала не получает (как TDLib copy).
		GeoLat: src.GeoLat, GeoLng: src.GeoLng,
		GeoTitle: src.GeoTitle, GeoAddress: src.GeoAddress,
		ContactUserID: src.ContactUserID, ContactName: src.ContactName, ContactPhone: src.ContactPhone,
		ReplyMarkup: copyableMarkup(src.ReplyMarkup),
		WebPage:     src.WebPage,
	}
}

// copyableMarkup — какая клавиатура переживает копию: только inline-кнопки
// (у Telegram их несёт пересланное сообщение бота). Reply-клавиатура,
// ForceReply и Hide — команды полю ввода ЧАТА от бота (tweb берёт их из
// последнего сообщения клавиатурой чата): в чужом чате от имени пересылающего
// они подменяли бы ввод всем участникам.
func copyableMarkup(m domain.ReplyMarkup) domain.ReplyMarkup {
	if _, ok := m.(domain.ReplyInlineMarkup); ok {
		return m
	}
	if p, ok := m.(*domain.ReplyInlineMarkup); ok && p != nil {
		return m
	}
	return nil
}

// isCopy — сообщение-копия чужого (пересылка, зеркало поста): оно не своё у
// автора строки, и права автора на содержимое (правка, геопозиция, опрос,
// чек-лист) у него нет.
func isCopy(m domain.Message) bool {
	return m.FwdFromUserID != nil || m.FwdFromChatID != nil || m.FwdFromName != nil || m.IsDiscussionMirror
}

// originMessage — сообщение, которым содержимое (опрос, чек-лист) было
// ОПУБЛИКОВАНО: в его чате, не копия, самое раннее. Копии ссылаются на тот же
// опрос, но автором не делают; порядок строк выборки ни на что не влияет.
func originMessage(msgs []domain.Message, chatID int64) (domain.Message, bool) {
	var best domain.Message
	found := false
	for _, m := range msgs {
		if m.ChatID != chatID || isCopy(m) {
			continue
		}
		if !found || m.ID < best.ID {
			best, found = m, true
		}
	}
	return best, found
}

// snapshotChecklist — чек-лист копии: НОВЫЙ, с пунктами исходника на момент
// копирования и без отметок, в чате копии. Общий с исходником чек-лист делал
// бы пересылающего его «автором» и показывал бы читателям копии пункты,
// добавленные потом в исходном чате. Копия только для чтения (tweb:
// ChecklistReadonlyForwarded).
func (i *Interactor) snapshotChecklist(ctx context.Context, checklistID *int64, chatID int64) (*int64, error) {
	if checklistID == nil || i.checklists == nil {
		return checklistID, nil
	}
	src, err := i.checklists.ByID(ctx, *checklistID)
	if err != nil {
		return nil, err
	}
	c, err := i.checklists.Create(ctx, domain.Checklist{
		ChatID: chatID, Title: src.Title, Items: src.Items,
		OthersCanAdd: src.OthersCanAdd, OthersCanMark: src.OthersCanMark,
	})
	if err != nil {
		return nil, err
	}
	return &c.ID, nil
}

// maxSafeGroupedID — верхняя граница нового ключа альбома (Number.MAX_SAFE_INTEGER).
const maxSafeGroupedID = 1<<53 - 1

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
			// Ключ в пределах точного целого JS (2^53): клиент держит
			// grouped_id числом, и больший ключ терял бы младшие разряды.
			n = rand.Int64N(maxSafeGroupedID) + 1
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
		MediaID: m.MediaID, PollID: m.PollID, ChecklistID: m.ChecklistID, GiveawayID: m.GiveawayID,
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
