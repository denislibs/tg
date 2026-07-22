package chat

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/messenger-denis/backend/internal/domain"
)

// Telegram Stars + Star Gifts. Реального провайдера нет: TopUpStars —
// dev-операция (мгновенно зачисляет звёзды). Подарок за звёзды выдаётся
// получателю и отправляется ему в ЛС сообщением типа 'gift'.

const maxGiftMessage = 255

// StarsBalance — текущий баланс звёзд пользователя.
func (i *Interactor) StarsBalance(ctx context.Context, userID int64) (int64, error) {
	if i.stars == nil {
		return 0, domain.ErrNotFound
	}
	return i.stars.Balance(ctx, userID)
}

// TopUpStars зачисляет звёзды пользователю (dev-пополнение — без реальной
// оплаты) и рассылает ему новый баланс. Возвращает новый баланс.
func (i *Interactor) TopUpStars(ctx context.Context, userID, amount int64) (int64, error) {
	if i.stars == nil {
		return 0, domain.ErrNotFound
	}
	if amount <= 0 || amount > 1_000_000 {
		return 0, domain.ErrForbidden
	}
	bal, err := i.stars.AddBalance(ctx, userID, amount)
	if err != nil {
		return 0, err
	}
	i.publishBalance(ctx, userID, bal)
	return bal, nil
}

// GiftCatalog — доступные для покупки подарки.
func (i *Interactor) GiftCatalog(ctx context.Context) ([]domain.StarGift, error) {
	if i.stars == nil {
		return nil, domain.ErrNotFound
	}
	return i.stars.Catalog(ctx)
}

// SendGift дарит подарок пользователю: списывает звёзды у отправителя, выдаёт
// подарок получателю и отправляет ему в ЛС сообщение типа 'gift'. Возвращает
// сообщение и новый баланс отправителя.
func (i *Interactor) SendGift(ctx context.Context, fromID, toID, giftID int64, message string, anonymous bool) (domain.Message, int64, error) {
	if i.stars == nil {
		return domain.Message{}, 0, domain.ErrNotFound
	}
	message = strings.TrimSpace(message)
	if utf8.RuneCountInString(message) > maxGiftMessage {
		return domain.Message{}, 0, domain.ErrTooLong
	}
	gift, err := i.stars.GiftByID(ctx, giftID)
	if err != nil {
		return domain.Message{}, 0, err
	}
	if gift.SoldOut {
		return domain.Message{}, 0, domain.ErrForbidden
	}
	// Списываем звёзды атомарно (ErrForbidden при нехватке средств).
	bal, err := i.stars.AddBalance(ctx, fromID, -gift.PriceStars)
	if err != nil {
		return domain.Message{}, 0, err
	}
	_ = i.stars.DecRemains(ctx, giftID)
	// from при анонимном подарке всё равно хранится (для «Разблокировать»
	// отправителя владельцем), но раскрытие имени контролирует read-модель.
	from := fromID
	savedID, err := i.stars.SaveGift(ctx, toID, &from, giftID, message, anonymous)
	if err != nil {
		return domain.Message{}, 0, err
	}
	chatID, err := i.CreatePrivateChat(ctx, fromID, toID)
	if err != nil {
		return domain.Message{}, 0, err
	}
	msg, err := i.Send(ctx, SendInput{
		ChatID: chatID, SenderID: fromID, Type: "gift", GiftID: &savedID,
	})
	if err != nil {
		return domain.Message{}, 0, err
	}
	i.publishBalance(ctx, fromID, bal)
	if info, e := i.stars.GiftInfo(ctx, savedID, fromID); e == nil {
		msg.Gift = &info
	}
	return msg, bal, nil
}

// ProfileGifts — подарки в профиле пользователя (видимые зрителю).
func (i *Interactor) ProfileGifts(ctx context.Context, ownerID, viewerID int64) ([]domain.GiftInfo, error) {
	if i.stars == nil {
		return nil, domain.ErrNotFound
	}
	return i.stars.ProfileGifts(ctx, ownerID, viewerID)
}

// SetGiftHidden показывает/скрывает подарок в профиле (только владелец).
func (i *Interactor) SetGiftHidden(ctx context.Context, savedID, ownerID int64, hidden bool) error {
	if i.stars == nil {
		return domain.ErrNotFound
	}
	return i.stars.SetHidden(ctx, savedID, ownerID, hidden)
}

// ConvertGift обменивает подарок на звёзды владельцу, рассылает новый баланс.
func (i *Interactor) ConvertGift(ctx context.Context, savedID, ownerID int64) (int64, error) {
	if i.stars == nil {
		return 0, domain.ErrNotFound
	}
	added, err := i.stars.Convert(ctx, savedID, ownerID)
	if err != nil {
		return 0, err
	}
	bal, err := i.stars.AddBalance(ctx, ownerID, added)
	if err != nil {
		return 0, err
	}
	i.publishBalance(ctx, ownerID, bal)
	return bal, nil
}

// hydrateGifts наполняет Message.Gift для сообщений типа 'gift' (per-viewer:
// анонимность раскрывается только владельцу подарка).
func (i *Interactor) hydrateGifts(ctx context.Context, viewerID int64, msgs []domain.Message) {
	if i.stars == nil {
		return
	}
	for idx := range msgs {
		if msgs[idx].GiftID == nil {
			continue
		}
		info, err := i.stars.GiftInfo(ctx, *msgs[idx].GiftID, viewerID)
		if err != nil {
			continue
		}
		msgs[idx].Gift = &info
	}
}

// paidCharge — результат списания за платное сообщение (Telegram paid messages):
// новый баланс отправителя и владельца для рассылки после коммита транзакции.
type paidCharge struct {
	applied    bool
	senderBal  int64
	creatorID  int64
	creatorBal int64
}

// chargePaidMessage списывает плату за сообщение в платной группе: charge_stars
// звёзд с отправителя (не-админа), начисляет владельцу — атомарно внутри общей
// транзакции Send (querier берёт tx из ctx). Владелец/админ и не-группы бесплатны;
// нехватка средств → domain.ErrPaidRequired (откатывает всю отправку).
func (i *Interactor) chargePaidMessage(ctx context.Context, in SendInput) (paidCharge, error) {
	if i.groups == nil || i.stars == nil || in.Type == "service" {
		return paidCharge{}, nil
	}
	typ, err := i.chats.ChatType(ctx, in.ChatID)
	if err != nil {
		return paidCharge{}, err
	}
	if typ != "group" {
		return paidCharge{}, nil
	}
	s, err := i.groups.Settings(ctx, in.ChatID)
	if err != nil || s.ChargeStars <= 0 {
		return paidCharge{}, nil // нет настроек / плата выключена
	}
	// Владелец и админы пишут бесплатно (как и slowmode/permissions).
	if m, e := i.groups.GetMember(ctx, in.ChatID, in.SenderID); e == nil {
		if m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin {
			return paidCharge{}, nil
		}
	}
	creator, err := i.groups.CreatorID(ctx, in.ChatID)
	if err != nil {
		return paidCharge{}, err
	}
	if creator == in.SenderID {
		return paidCharge{}, nil // страховка: владелец не платит сам себе
	}
	senderBal, err := i.stars.AddBalance(ctx, in.SenderID, -int64(s.ChargeStars))
	if err != nil {
		if err == domain.ErrForbidden {
			return paidCharge{}, domain.ErrPaidRequired
		}
		return paidCharge{}, err
	}
	c := paidCharge{applied: true, senderBal: senderBal, creatorID: creator}
	if creator != 0 {
		creatorBal, e := i.stars.AddBalance(ctx, creator, int64(s.ChargeStars))
		if e != nil {
			return paidCharge{}, e
		}
		c.creatorBal = creatorBal
	}
	return c, nil
}

// publishBalance рассылает пользователю его новый баланс звёзд (все вкладки).
func (i *Interactor) publishBalance(ctx context.Context, userID, balance int64) {
	if i.publisher == nil {
		return
	}
	_ = i.publisher.PublishToUser(ctx, userID, frame("balance_update", map[string]any{"balance": balance}))
}
