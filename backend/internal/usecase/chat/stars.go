package chat

import (
	"context"
	"errors"
	"slices"
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
	_ = i.stars.RecordTx(ctx, userID, amount, "topup", "Пополнение баланса", nil)
	i.publishBalance(ctx, userID, bal)
	return bal, nil
}

// StarsTransactions — история движений баланса звёзд (экран «Кошелёк»).
func (i *Interactor) StarsTransactions(ctx context.Context, userID int64, offset, limit int) ([]domain.StarTransaction, error) {
	if i.stars == nil {
		return nil, domain.ErrNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	return i.stars.Transactions(ctx, userID, offset, limit)
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
//
// Порядок — как у payments.sendStarsForm: сначала все проверки получателя
// (блок, приватность, удалённый аккаунт — гейты Send), потом списание. Списание,
// выдача, журнал движения звёзд и само сообщение — одна транзакция (prepare в
// Send): отказ на любом шаге не оставляет ни списанных звёзд, ни подарка в
// профиле того, кто отправителя заблокировал.
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
	chatID, err := i.CreatePrivateChat(ctx, fromID, toID)
	if err != nil {
		return domain.Message{}, 0, err
	}
	var bal int64
	msg, err := i.Send(ctx, SendInput{
		ChatID: chatID, SenderID: fromID, Type: "gift",
		paidConsentNotRequired: true, // подарок — не sendMessage, allow_paid_stars нет
		prepare: func(ctx context.Context, in *SendInput) error {
			// Списываем звёзды атомарно; нехватка — ErrBalanceTooLow (отличить
			// от запретов гейтов отправки).
			b, e := i.stars.AddBalance(ctx, fromID, -gift.PriceStars)
			if errors.Is(e, domain.ErrForbidden) {
				return domain.ErrBalanceTooLow
			}
			if e != nil {
				return e
			}
			bal = b
			if e := i.stars.DecRemains(ctx, giftID); e != nil {
				return e
			}
			// from при анонимном подарке всё равно хранится (для «Разблокировать»
			// отправителя владельцем), но раскрытие имени контролирует read-модель.
			from := fromID
			savedID, e := i.stars.SaveGift(ctx, toID, &from, giftID, message, anonymous)
			if e != nil {
				return e
			}
			in.GiftID = &savedID
			return i.stars.RecordTx(ctx, fromID, -gift.PriceStars, "gift_sent", gift.Title, &toID)
		},
	})
	if err != nil {
		return domain.Message{}, 0, err
	}
	i.publishBalance(ctx, fromID, bal)
	if info, e := i.stars.GiftInfo(ctx, *msg.GiftID, fromID); e == nil {
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
	_ = i.stars.RecordTx(ctx, ownerID, added, "gift_converted", "Подарок обменян на звёзды", nil)
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
	amount     int64 // списано с отправителя
	senderBal  int64
	creatorID  int64
	creatorBal int64
}

// paidPrice — цена ОДНОГО сообщения отправителя в чат в звёздах; 0 — бесплатно.
// Платит не-админ группы с charge_stars > 0: владелец, админы, личные чаты,
// каналы и группы без платы пишут бесплатно.
func (i *Interactor) paidPrice(ctx context.Context, chatID, senderID int64) (int64, error) {
	if i.groups == nil || i.stars == nil {
		return 0, nil
	}
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return 0, err
	}
	if typ != domain.ChatTypeGroup {
		return 0, nil
	}
	s, err := i.groups.Settings(ctx, chatID)
	if err != nil || s.ChargeStars <= 0 {
		return 0, nil // нет настроек / плата выключена
	}
	// Владелец и админы пишут бесплатно (как и slowmode/permissions).
	if m, e := i.groups.GetMember(ctx, chatID, senderID); e == nil {
		if m.Role == domain.RoleCreator || m.Role == domain.RoleAdmin {
			return 0, nil
		}
	}
	return int64(s.ChargeStars), nil
}

// requirePaidAllowance — согласие отправителя на плату запроса из units
// сообщений: allow (allow_paid_stars) — потолок суммы запроса, цена × units
// выше него — ErrAllowPaymentRequired с требуемой суммой (tweb
// appMessagesManager.ts:2702 шлёт цену × число сообщений). Возвращает цену ОДНОГО
// сообщения (0 — бесплатно), по которой и надо списывать (chargePaidMessage), —
// цена читается один раз, смена её админом между проверкой и списанием не
// спишет больше согласованного. Звать внутри транзакции, до первого списания
// и для всей пачки сразу (пересылка, отложенные, альбом).
func (i *Interactor) requirePaidAllowance(ctx context.Context, chatID, senderID int64, units int, allow int64) (int64, error) {
	price, err := i.paidPrice(ctx, chatID, senderID)
	if err != nil || price == 0 {
		return 0, err
	}
	if need := price * int64(units); allow < need {
		return 0, domain.ErrAllowPaymentRequired{Stars: need}
	}
	return price, nil
}

// precheckPaid — ранний отказ платной отправки ДО побочных записей (строки опроса или
// чек-листа создаются раньше самой отправки): нет согласия на плату → ErrAllowPaymentRequired,
// не хватает звёзд → ErrBalanceTooLow. Звёзд не списывает; окончательное решение и списание —
// в транзакции Send (цена там читается заново: гонка с ростом цены даёт отказ уже Send).
func (i *Interactor) precheckPaid(ctx context.Context, chatID, senderID, allow int64) error {
	price, err := i.requirePaidAllowance(ctx, chatID, senderID, 1, allow)
	if err != nil || price == 0 {
		return err
	}
	if bal, e := i.stars.Balance(ctx, senderID); e == nil && bal < price {
		return domain.ErrBalanceTooLow
	}
	return nil
}

// sendAlreadyAccepted — отправка с этим client_msg_id уже принята (сообщение в чате либо
// строка очереди отложенных): повтор запроса при потерянном ответе обязан вернуть принятое, а
// не получить отказ по цене/балансу и не создавать побочные строки (опрос, чек-лист).
func (i *Interactor) sendAlreadyAccepted(ctx context.Context, chatID, senderID int64, clientMsgID string, scheduled bool) bool {
	if clientMsgID == "" {
		return false
	}
	if scheduled && i.scheduled != nil {
		_, err := i.scheduled.ByClientMsgID(ctx, chatID, senderID, clientMsgID)
		return err == nil
	}
	_, err := i.msgs.FindByClientMsgID(ctx, chatID, senderID, clientMsgID)
	return err == nil
}

// paidPriceFor — цена одного сообщения отправки после гейта согласия.
// Служебки бесплатны; публикация отложенного не платит второй раз (звёзды
// списаны при постановке, В-2, tweb allow_paid_stars в запросе с schedule_date,
// appMessagesManager.ts:2748) — кроме сроков повтора после первого. Вход без
// allow_paid_stars в TL (боты, розыгрыш, подарок, повтор до деплоя) помечен
// paidConsentNotRequired и платит без проверки согласия.
func (i *Interactor) paidPriceFor(ctx context.Context, in SendInput, units int) (int64, error) {
	if in.Type == "service" || (in.fromSchedule && !in.repeatOccurrence) {
		return 0, nil
	}
	if in.paidConsentNotRequired {
		return i.paidPrice(ctx, in.ChatID, in.SenderID)
	}
	return i.requirePaidAllowance(ctx, in.ChatID, in.SenderID, units, in.AllowPaidStars)
}

// chargePaidMessage списывает amount звёзд в платной группе с отправителя и
// начисляет владельцу — атомарно внутри общей транзакции (querier берёт tx из
// ctx). amount = цена одного сообщения × число сообщений запроса: пачка
// (пересылка, отложенные) списывается ОДНОЙ парой UPDATE баланса, а не по паре на
// сообщение — строка баланса владельца группы держится под замком один раз.
// Цена получена из requirePaidAllowance/paidPriceFor; 0 — ничего. Нехватка
// средств → domain.ErrBalanceTooLow (откатывает отправку).
func (i *Interactor) chargePaidMessage(ctx context.Context, chatID, senderID, amount int64) (paidCharge, error) {
	if amount <= 0 {
		return paidCharge{}, nil
	}
	creator, err := i.groups.CreatorID(ctx, chatID)
	if err != nil {
		return paidCharge{}, err
	}
	if creator == senderID {
		return paidCharge{}, nil // страховка: владелец не платит сам себе
	}
	fromBal, toBal, err := i.moveStars(ctx, senderID, creator, amount)
	if err != nil {
		return paidCharge{}, err
	}
	c := paidCharge{applied: true, amount: amount, creatorID: creator, senderBal: fromBal, creatorBal: toBal}
	return c, nil
}

// publishBalance логирует и рассылает пользователю его новый баланс звёзд (все
// вкладки). Абсолютное значение баланса + плотный pts-курсор делают catch-up через
// getDifference идемпотентным. Recipient — сам пользователь (свои устройства).
func (i *Interactor) publishBalance(ctx context.Context, userID, balance int64) {
	_ = i.logAndPublish(ctx, 0, []int64{userID}, "balance_update",
		map[string]any{"_": domain.UpdateStarsBalanceTag, "balance": domain.NewStarsAmount(balance)})
}

// moveStars — движение звёзд from → to (to == 0 или to == from — только списание) внутри
// транзакции вызывающего. Строки балансов блокируются в порядке возрастания user_id,
// ОДИНАКОВОМ для всех путей (платное сообщение, ⭐-реакция, платное медиа, возврат
// отложенных): иначе встречные потоки — и однонаправленные разные операции одной пары —
// берут их крест-накрест и взаимоблокируются (40P01). Нехватка у from → ErrBalanceTooLow;
// при начислении «раньше» списания явная предпроверка баланса отказывает до него (откат
// транзакции вернул бы начисление и так, окончательную проверку делает само списание).
func (i *Interactor) moveStars(ctx context.Context, from, to, amount int64) (fromBal, toBal int64, err error) {
	debit := func() error {
		b, e := i.stars.AddBalance(ctx, from, -amount)
		if e != nil {
			if e == domain.ErrForbidden {
				return domain.ErrBalanceTooLow
			}
			return e
		}
		fromBal = b
		return nil
	}
	credit := func() error {
		if to == 0 || to == from {
			return nil
		}
		b, e := i.stars.AddBalance(ctx, to, amount)
		if e != nil {
			return e
		}
		toBal = b
		return nil
	}
	first, second := debit, credit
	if to != 0 && to != from && to < from {
		first, second = credit, debit
		if bal, e := i.stars.Balance(ctx, from); e == nil && bal < amount {
			return 0, 0, domain.ErrBalanceTooLow
		}
	}
	if err = first(); err != nil {
		return 0, 0, err
	}
	if err = second(); err != nil {
		return 0, 0, err
	}
	return fromBal, toBal, nil
}

// lockBalances берёт строки балансов набора пользователей в порядке возрастания user_id
// (AddBalance с нулевым движением — только блокировка до конца транзакции). Нужен циклам, где
// за одну транзакцию движутся балансы многих пар (возврат отложенных): порядок внутри пары
// не спасает, если пары идут в произвольной последовательности.
func (i *Interactor) lockBalances(ctx context.Context, ids ...int64) error {
	if i.stars == nil {
		return nil
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, err := i.stars.AddBalance(ctx, id, 0); err != nil {
			return err
		}
	}
	return nil
}
