package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// maxPaidMediaPrice ограничивает цену платного медиа (как и TopUpStars — верхняя
// граница на разумный диапазон звёзд).
const maxPaidMediaPrice = 1_000_000

// isPaidMediaType — типы сообщений, которым можно назначить платное медиа.
func isPaidMediaType(t string) bool { return t == "photo" || t == "video" }

// hydratePaidMedia наполняет платное медиа сообщений для зрителя viewerID: цену
// (paid_media) и per-viewer состояние блокировки. У заблокированных сообщений
// (зритель не автор и не оплатил) стирает ссылки на контент (media_id/mime/имя/
// длительность/thumb), оставляя только размеры + blur + цену — байты медиа
// клиенту не отдаются до разблокировки.
func (i *Interactor) hydratePaidMedia(ctx context.Context, viewerID int64, msgs []domain.Message) {
	if i.paidMedia == nil {
		return
	}
	ids := make([]int64, 0)
	for _, m := range msgs {
		if m.MediaID != nil {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	prices, err := i.paidMedia.PricesByIDs(ctx, ids)
	if err != nil || len(prices) == 0 {
		return
	}
	priced := make([]int64, 0, len(prices))
	for id := range prices {
		priced = append(priced, id)
	}
	unlocked, err := i.paidMedia.UnlockedByIDs(ctx, viewerID, priced)
	if err != nil {
		return
	}
	for idx := range msgs {
		price, ok := prices[msgs[idx].ID]
		if !ok {
			continue
		}
		p := price
		msgs[idx].PaidMediaPrice = &p
		locked := msgs[idx].SenderID != viewerID && !unlocked[msgs[idx].ID]
		msgs[idx].PaidMediaLocked = locked
		if locked {
			stripLockedMedia(&msgs[idx])
		}
	}
}

// stripLockedMedia убирает из сообщения всё, по чему клиент мог бы получить байты
// медиа (media_id и метаданные контента), оставляя плейсхолдер: размеры + blur.
func stripLockedMedia(m *domain.Message) {
	m.MediaID = nil
	m.MediaMime = ""
	m.MediaName = ""
	m.MediaHasThumb = false
	m.MediaDuration = 0
}

// lockedPaidCopy — копия сообщения в заблокированном виде (для рассылки платного
// медиа получателям, которые ещё не оплатили).
func lockedPaidCopy(m domain.Message) domain.Message {
	m.PaidMediaLocked = true
	stripLockedMedia(&m)
	return m
}

// UnlockPaidMedia разблокирует платное медиа сообщения для пользователя: списывает
// цену в звёздах у покупателя, начисляет автору, записывает разблокировку —
// транзакционно. Возвращает разблокированное сообщение и новый баланс покупателя.
// Автор и уже оплатившие получают доступ без повторного списания.
func (i *Interactor) UnlockPaidMedia(ctx context.Context, msgID, userID int64) (domain.Message, int64, error) {
	if i.paidMedia == nil || i.stars == nil {
		return domain.Message{}, 0, domain.ErrNotFound
	}
	msg, err := i.msgs.GetByID(ctx, msgID)
	if err != nil {
		return domain.Message{}, 0, err
	}
	prices, err := i.paidMedia.PricesByIDs(ctx, []int64{msgID})
	if err != nil {
		return domain.Message{}, 0, err
	}
	price, ok := prices[msgID]
	if !ok {
		return domain.Message{}, 0, domain.ErrNotFound // не платное медиа
	}
	member, err := i.chats.IsMember(ctx, msg.ChatID, userID)
	if err != nil {
		return domain.Message{}, 0, err
	}
	if !member {
		return domain.Message{}, 0, domain.ErrNotFound
	}

	bal, err := i.stars.Balance(ctx, userID)
	if err != nil {
		return domain.Message{}, 0, err
	}
	// Списываем только если это не автор и он ещё не оплатил.
	if userID != msg.SenderID {
		unlocked, err := i.paidMedia.UnlockedByIDs(ctx, userID, []int64{msgID})
		if err != nil {
			return domain.Message{}, 0, err
		}
		if !unlocked[msgID] {
			var authorBal int64
			var authorCredited bool
			err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
				b, e := i.stars.AddBalance(ctx, userID, -price)
				if e == domain.ErrForbidden {
					return domain.ErrPaidRequired // недостаточно звёзд
				}
				if e != nil {
					return e
				}
				bal = b
				if msg.SenderID != 0 && msg.SenderID != userID {
					ab, e := i.stars.AddBalance(ctx, msg.SenderID, price)
					if e != nil {
						return e
					}
					authorBal, authorCredited = ab, true
				}
				if _, e := i.paidMedia.Unlock(ctx, msgID, userID); e != nil {
					return e
				}
				return nil
			})
			if err != nil {
				return domain.Message{}, 0, err
			}
			i.publishBalance(ctx, userID, bal)
			if authorCredited {
				i.publishBalance(ctx, msg.SenderID, authorBal)
			}
		}
	}

	// Собираем разблокированное сообщение для ответа/рассылки: реальное медиа + цена.
	one := []domain.Message{msg}
	_ = i.hydrateMedia(ctx, one)
	msg = one[0]
	msg.PaidMediaPrice = &price
	msg.PaidMediaLocked = false
	// Realtime: раскрываем баббл только на устройствах покупателя (медиа не должно
	// утечь другим участникам) — кадром paid_media_unlock с полным медиа.
	if i.publisher != nil {
		_ = i.publisher.PublishToUser(ctx, userID, frame("paid_media_unlock", messageUpdatePayload(msg)))
	}
	return msg, bal, nil
}
