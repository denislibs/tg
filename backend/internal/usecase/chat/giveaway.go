package chat

import (
	"context"
	"errors"
	"log"
	"math/rand"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Розыгрыши (Telegram giveaways): CreateGiveaway создаёт розыгрыш + сообщение
// типа 'giveaway'; участие/статус рассылаются участникам фреймом
// giveaway_update. По наступлении until_date победители разыгрываются лениво
// (при GET/участии) — отдельного планировщика нет.

const (
	maxGiveawayWinners = 100
	// giveawayMaxPeriod — appConfig giveaway_period_max = 604800 с (tweb
	// popups/boostsViaGifts.tsx:173, дефолт 7 суток).
	giveawayMaxPeriod = 7 * 24 * time.Hour
	// maxGiveawayStars — потолок приза одному победителю; тот же, что у
	// dev-пополнения (TopUpStars). Сумма вклада maxGiveawayStars × maxGiveawayWinners
	// укладывается в int64 с огромным запасом.
	maxGiveawayStars = 1_000_000
)

type CreateGiveawayInput struct {
	ChatID, CreatorID int64
	PrizeKind         string // "premium" | "stars"
	Months            int
	Stars             int64
	WinnersCount      int
	UntilDate         time.Time
	ClientMsgID       string
}

// SetPremiumGiveaways разрешает розыгрыши Premium. В tweb такой приз покупается
// платёжной формой (boostsViaGifts.tsx), у нас оплаты нет, поэтому без флага
// (DEV_PURCHASES) Premium-розыгрыш раздавал бы подписку бесплатно: создание
// отказывает ErrForbidden. Розыгрыш звёзд оплачивается вкладом создателя.
func (i *Interactor) SetPremiumGiveaways(enabled bool) { i.premiumGiveaways = enabled }

// CreateGiveaway валидирует и публикует розыгрыш сообщением типа 'giveaway'
// (создать может только админ канала с правом постинга). Розыгрыш звёзд —
// условное депонирование: вклад stars × winners_count списывается с создателя в
// той же транзакции, что и сам розыгрыш с сообщением (нехватка —
// ErrBalanceTooLow, откат без следа). Победителям уходит приз, остаток при
// нехватке участников возвращается создателю (maybeFinishGiveaway).
func (i *Interactor) CreateGiveaway(ctx context.Context, in CreateGiveawayInput) (domain.Message, error) {
	if i.giveaways == nil {
		return domain.Message{}, domain.ErrNotFound
	}
	if err := i.requireChannel(ctx, in.ChatID); err != nil {
		return domain.Message{}, err
	}
	if err := i.requireRight(ctx, in.ChatID, in.CreatorID, domain.RightPostMessages); err != nil {
		return domain.Message{}, err
	}
	if in.WinnersCount < 1 || in.WinnersCount > maxGiveawayWinners {
		return domain.Message{}, domain.ErrInvalid
	}
	switch in.PrizeKind {
	case "premium":
		if in.Months <= 0 {
			return domain.Message{}, domain.ErrInvalid
		}
		if !i.premiumGiveaways {
			return domain.Message{}, domain.ErrForbidden
		}
		in.Stars = 0
	case "stars":
		if in.Stars <= 0 || in.Stars > maxGiveawayStars {
			return domain.Message{}, domain.ErrInvalid
		}
		if i.stars == nil {
			return domain.Message{}, domain.ErrNotFound
		}
		in.Months = 0
	default:
		return domain.Message{}, domain.ErrInvalid
	}
	now := time.Now()
	if in.UntilDate.Before(now) || in.UntilDate.After(now.Add(giveawayMaxPeriod)) {
		return domain.Message{}, domain.ErrInvalid
	}
	// Розыгрыш, вклад и сообщение — одна транзакция Send (prepare): отказ на
	// любом шаге не оставляет ни списанных звёзд, ни розыгрыша без сообщения.
	var g domain.Giveaway
	var bal int64
	var prepared bool
	msg, err := i.Send(ctx, SendInput{
		ChatID: in.ChatID, SenderID: in.CreatorID, Type: "giveaway",
		ClientMsgID:            in.ClientMsgID,
		paidConsentNotRequired: true, // у messages.* розыгрыша нет allow_paid_stars
		prepare: func(ctx context.Context, send *SendInput) error {
			var deposit int64
			if in.PrizeKind == "stars" {
				deposit = in.Stars * int64(in.WinnersCount)
				b, _, e := i.moveStars(ctx, in.CreatorID, 0, deposit)
				if e != nil {
					return e
				}
				bal = b
				if e := i.stars.RecordTx(ctx, in.CreatorID, -deposit, "giveaway_created", "Розыгрыш звёзд", nil); e != nil {
					return e
				}
			}
			created, e := i.giveaways.Create(ctx, domain.Giveaway{
				ChatID: in.ChatID, CreatorID: in.CreatorID, PrizeKind: in.PrizeKind,
				Months: in.Months, Stars: in.Stars, WinnersCount: in.WinnersCount,
				UntilDate: in.UntilDate, Status: "active", Deposit: deposit,
			})
			if e != nil {
				return e
			}
			g = created
			send.GiveawayID = &g.ID
			prepared = true
			return nil
		},
	})
	if err != nil {
		// Параллельный повтор с тем же client_msg_id: проигравший упирается в
		// уникальный индекс сообщения, его транзакция (вклад и розыгрыш) откатилась,
		// а выигравший уже создал розыгрыш - отдаём принятое, как делает дедупликация Send.
		if in.ClientMsgID != "" {
			if prev, e := i.msgs.FindByClientMsgID(ctx, in.ChatID, in.CreatorID, in.ClientMsgID); e == nil && prev.GiveawayID != nil {
				if info, e := i.giveawayInfoFor(ctx, *prev.GiveawayID, in.CreatorID); e == nil {
					prev.Giveaway = &info
				}
				return prev, nil
			}
		}
		return domain.Message{}, err
	}
	if prepared && in.PrizeKind == "stars" {
		i.publishBalance(ctx, in.CreatorID, bal)
	}
	// Повтор после потерянного ответа: Send вернул принятое сообщение без prepare.
	if msg.GiveawayID != nil {
		if info, e := i.giveawayInfoFor(ctx, *msg.GiveawayID, in.CreatorID); e == nil {
			msg.Giveaway = &info
		}
	}
	return msg, nil
}

// ParticipateGiveaway регистрирует зрителя-подписканта в розыгрыше.
func (i *Interactor) ParticipateGiveaway(ctx context.Context, giveawayID, userID int64) (domain.GiveawayInfo, error) {
	if i.giveaways == nil {
		return domain.GiveawayInfo{}, domain.ErrNotFound
	}
	g, err := i.giveaways.ByID(ctx, giveawayID)
	if err != nil {
		return domain.GiveawayInfo{}, err
	}
	g, claimed := i.maybeFinishGiveaway(ctx, g)
	if claimed {
		i.publishGiveawayUpdate(ctx, g.ChatID, g.ID)
	}
	if g.Status != "active" {
		return domain.GiveawayInfo{}, domain.ErrForbidden // розыгрыш завершён
	}
	// Участвовать можно только будучи подписчиком канала.
	ok, err := i.chats.IsMember(ctx, g.ChatID, userID)
	if err != nil {
		return domain.GiveawayInfo{}, err
	}
	if !ok {
		return domain.GiveawayInfo{}, domain.ErrForbidden
	}
	if err := i.giveaways.Participate(ctx, giveawayID, userID); err != nil {
		return domain.GiveawayInfo{}, err
	}
	i.publishGiveawayUpdate(ctx, g.ChatID, giveawayID)
	return i.giveawayInfoFor(ctx, giveawayID, userID)
}

// GetGiveaway — статус розыгрыша для зрителя (лениво завершает просроченный).
func (i *Interactor) GetGiveaway(ctx context.Context, giveawayID, viewerID int64) (domain.GiveawayInfo, error) {
	if i.giveaways == nil {
		return domain.GiveawayInfo{}, domain.ErrNotFound
	}
	g, err := i.giveaways.ByID(ctx, giveawayID)
	if err != nil {
		return domain.GiveawayInfo{}, err
	}
	g, claimed := i.maybeFinishGiveaway(ctx, g)
	if claimed {
		i.publishGiveawayUpdate(ctx, g.ChatID, giveawayID)
	}
	return i.giveawayInfoFor(ctx, giveawayID, viewerID)
}

// maybeFinishGiveaway разыгрывает победителей, если срок вышел. claimed=true -
// розыгрыш закрыл именно этот вызов (только он публикует итоги); из параллельных
// читателей закрывает ровно один (условный UPDATE в Finish).
//
// Призы и возврат считаются из внесённого вклада (Deposit), а не из параметров
// розыгрыша: выплата не превышает внесённое. Розыгрыш без вклада (до введения
// вклада) выплат не делает. Завершение и выплаты - одна транзакция.
func (i *Interactor) maybeFinishGiveaway(ctx context.Context, g domain.Giveaway) (domain.Giveaway, bool) {
	if g.Status != "active" || time.Now().Before(g.UntilDate) {
		return g, false
	}
	ids, err := i.giveaways.ParticipantIDs(ctx, g.ID)
	if err != nil {
		return g, false
	}
	winners := pickWinners(ids, g.WinnersCount)
	if g.PrizeKind == "premium" && !i.premiumGiveaways {
		winners = nil // приз не выдаётся - победителей нет (иначе «вы выиграли» без приза)
	}
	balances := map[int64]int64{}
	var claimed bool
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		var e error
		if claimed, e = i.giveaways.Finish(ctx, g.ID, winners); e != nil || !claimed {
			return e
		}
		switch g.PrizeKind {
		case "premium":
			// Без оплаты Premium выдаётся только под DEV_PURCHASES (как и создание).
			if i.premium != nil && i.premiumGiveaways {
				for _, w := range winners {
					if e := i.premium.GrantPremium(ctx, w); e != nil {
						return e
					}
				}
			}
		case "stars":
			return i.payOutGiveawayStars(ctx, g, winners, balances)
		}
		return nil
	})
	if err != nil {
		log.Printf("giveaway %d: finish: %v", g.ID, err)
		return g, false
	}
	if !claimed {
		// Розыгрыш закрыл параллельный читатель - отдаём актуальную строку.
		if cur, e := i.giveaways.ByID(ctx, g.ID); e == nil {
			return cur, false
		}
		return g, false
	}
	for uid, b := range balances {
		i.publishBalance(ctx, uid, b)
	}
	g.Status = "finished"
	g.WinnerIDs = winners
	return g, true
}

// payOutGiveawayStars платит призы победителям из вклада и возвращает остаток
// (неразданные места) создателю. Внутри транзакции завершения; строки балансов
// берутся по возрастанию user_id (общий порядок блокировок).
func (i *Interactor) payOutGiveawayStars(ctx context.Context, g domain.Giveaway, winners []int64, balances map[int64]int64) error {
	if i.stars == nil || g.Deposit <= 0 {
		return nil
	}
	paid := int64(len(winners)) * g.Stars
	if paid > g.Deposit {
		return domain.ErrInvalid // вклад меньше призов: строка не из этого кода
	}
	if e := i.lockBalances(ctx, append([]int64{g.CreatorID}, winners...)...); e != nil {
		return e
	}
	for _, w := range winners {
		b, e := i.stars.AddBalance(ctx, w, g.Stars)
		if e != nil {
			return e
		}
		if e := i.stars.RecordTx(ctx, w, g.Stars, "giveaway_prize", "Приз розыгрыша", nil); e != nil {
			return e
		}
		balances[w] = b
	}
	// Победителей меньше, чем мест: неразданный вклад возвращается создателю.
	if unspent := g.Deposit - paid; unspent > 0 {
		b, e := i.stars.AddBalance(ctx, g.CreatorID, unspent)
		if e != nil {
			return e
		}
		if e := i.stars.RecordTx(ctx, g.CreatorID, unspent, "giveaway_refund", "Возврат неразданных звёзд розыгрыша", nil); e != nil {
			return e
		}
		balances[g.CreatorID] = b
	}
	return nil
}

// claimGiveawayDeposits закрывает незавершённые звёздные розыгрыши удаляемого
// чата и возвращает их вклады (захват строк: параллельное завершение не
// выплатит тот же вклад второй раз). Внутри транзакции удаления.
func (i *Interactor) claimGiveawayDeposits(ctx context.Context, chatID int64) ([]domain.Giveaway, error) {
	if i.giveaways == nil || i.stars == nil {
		return nil, nil
	}
	return i.giveaways.ClaimActiveStarsByChat(ctx, chatID)
}

// errGiveawayRaced - розыгрыш создан между захватом и блокировкой чата при
// удалении: транзакция откатывается, повтор запроса возвращает и этот вклад.
var errGiveawayRaced = errors.New("giveaway created while the chat was being deleted, retry")

// lockChatForDelete - последний шаг перед удалением чата (после балансов):
// блокирует строку чата и убеждается, что новых звёздных розыгрышей не появилось.
func (i *Interactor) lockChatForDelete(ctx context.Context, chatID int64) error {
	if i.giveaways == nil || i.stars == nil {
		return nil
	}
	if err := i.giveaways.LockChat(ctx, chatID); err != nil {
		return err
	}
	late, err := i.giveaways.ClaimActiveStarsByChat(ctx, chatID)
	if err != nil {
		return err
	}
	if len(late) > 0 {
		return errGiveawayRaced
	}
	return nil
}

// creditGiveawayDeposits возвращает захваченные вклады создателям; строки их
// балансов уже взяты вызывающим (общий проход lockBalances).
func (i *Interactor) creditGiveawayDeposits(ctx context.Context, rows []domain.Giveaway, balances map[int64]int64) error {
	for _, g := range rows {
		b, e := i.stars.AddBalance(ctx, g.CreatorID, g.Deposit)
		if e != nil {
			return e
		}
		if e := i.stars.RecordTx(ctx, g.CreatorID, g.Deposit, "giveaway_refund", "Возврат вклада розыгрыша: канал удалён", nil); e != nil {
			return e
		}
		balances[g.CreatorID] = b
	}
	return nil
}

// pickWinners выбирает не более n случайных победителей из участников.
func pickWinners(ids []int64, n int) []int64 {
	if n >= len(ids) {
		out := append([]int64(nil), ids...)
		return out
	}
	shuffled := append([]int64(nil), ids...)
	rand.Shuffle(len(shuffled), func(a, b int) { shuffled[a], shuffled[b] = shuffled[b], shuffled[a] })
	return shuffled[:n]
}

// giveawayInfoFor — представление розыгрыша для зрителя (0 — «никто»).
func (i *Interactor) giveawayInfoFor(ctx context.Context, giveawayID, viewerID int64) (domain.GiveawayInfo, error) {
	g, err := i.giveaways.ByID(ctx, giveawayID)
	if err != nil {
		return domain.GiveawayInfo{}, err
	}
	cnt, err := i.giveaways.ParticipantCount(ctx, giveawayID)
	if err != nil {
		return domain.GiveawayInfo{}, err
	}
	info := domain.GiveawayInfo{
		ID: g.ID, PeerID: domain.ToPeerID(g.ChatID, true), PrizeKind: g.PrizeKind,
		Months: g.Months, Stars: g.Stars, WinnersCount: g.WinnersCount,
		UntilDate: g.UntilDate.UnixMilli(), StartDate: g.CreatedAt.UnixMilli(),
		Status:       g.Status,
		Participants: cnt, WinnerIDs: g.WinnerIDs,
	}
	if viewerID != 0 {
		if part, e := i.giveaways.IsParticipant(ctx, giveawayID, viewerID); e == nil {
			info.Participating = part
		}
		for _, w := range g.WinnerIDs {
			if w == viewerID {
				info.IWon = true
				break
			}
		}
	}
	return info, nil
}

// hydrateGiveaways наполняет Message.Giveaway для сообщений типа 'giveaway'
// (per-viewer).
func (i *Interactor) hydrateGiveaways(ctx context.Context, viewerID int64, msgs []domain.Message) {
	if i.giveaways == nil {
		return
	}
	for idx := range msgs {
		if msgs[idx].GiveawayID == nil {
			continue
		}
		if info, err := i.giveawayInfoFor(ctx, *msgs[idx].GiveawayID, viewerID); err == nil {
			msgs[idx].Giveaway = &info
		}
	}
}

// publishGiveawayUpdate логирует и рассылает участникам чата состояние розыгрыша
// ТЕМ ЖЕ конструктором, каким оно едет вложением сообщения. Абсолютный снимок +
// плотный pts-курсор делают catch-up через getDifference идемпотентным.
//
// Личного состояния зрителя (участвую ли, выиграл ли) в кадре нет и быть не
// может: тело кадра одно на всех получателей, а ответ на этот вопрос у каждого
// свой — его отдаёт ручка GET /giveaways/{id} конструктором
// payments.giveawayInfo. Та же ловушка, что уже поймана у pFlags.out.
func (i *Interactor) publishGiveawayUpdate(ctx context.Context, chatID, giveawayID int64) {
	info, err := i.giveawayInfoFor(ctx, giveawayID, 0)
	if err != nil {
		return
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	// Номер сообщения-запуска: он обязателен у messageMediaGiveawayResults, и
	// взять его больше неоткуда — розыгрыш живёт ровно в одном сообщении.
	var launchSeq int64
	if msgs, e := i.msgs.ByGiveawayID(ctx, giveawayID); e == nil && len(msgs) > 0 {
		launchSeq = msgs[0].Seq
	}
	media := info.ToMedia(launchSeq)
	_ = i.logAndPublishPerPeer(ctx, chatID, members, "giveaway_update",
		func(peer domain.PeerID) map[string]any {
			return map[string]any{
				"_": domain.UpdateMessageGiveawayTag, "peer": domain.NewPeer(peer), "media": media,
			}
		})
}
