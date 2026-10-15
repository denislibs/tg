package chat

import (
	"context"
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
	msg, err := i.Send(ctx, SendInput{
		ChatID: in.ChatID, SenderID: in.CreatorID, Type: "giveaway",
		ClientMsgID:            in.ClientMsgID,
		paidConsentNotRequired: true, // у messages.* розыгрыша нет allow_paid_stars
		prepare: func(ctx context.Context, send *SendInput) error {
			if in.PrizeKind == "stars" {
				deposit := in.Stars * int64(in.WinnersCount)
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
				UntilDate: in.UntilDate, Status: "active",
			})
			if e != nil {
				return e
			}
			g = created
			send.GiveawayID = &g.ID
			return nil
		},
	})
	if err != nil {
		return domain.Message{}, err
	}
	if in.PrizeKind == "stars" {
		i.publishBalance(ctx, in.CreatorID, bal)
	}
	if info, e := i.giveawayInfoFor(ctx, g.ID, in.CreatorID); e == nil {
		msg.Giveaway = &info
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
	g = i.maybeFinishGiveaway(ctx, g)
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
	before := g.Status
	g = i.maybeFinishGiveaway(ctx, g)
	if before == "active" && g.Status == "finished" {
		i.publishGiveawayUpdate(ctx, g.ChatID, giveawayID)
	}
	return i.giveawayInfoFor(ctx, giveawayID, viewerID)
}

// maybeFinishGiveaway разыгрывает победителей, если срок вышел (идемпотентно).
func (i *Interactor) maybeFinishGiveaway(ctx context.Context, g domain.Giveaway) domain.Giveaway {
	if g.Status != "active" || time.Now().Before(g.UntilDate) {
		return g
	}
	ids, err := i.giveaways.ParticipantIDs(ctx, g.ID)
	if err != nil {
		return g
	}
	winners := pickWinners(ids, g.WinnersCount)
	// Завершение и выдача призов — одна транзакция: розыгрыш закрывает ровно
	// один из параллельных читателей (условный UPDATE в Finish), выдача призов
	// не теряется при сбое и не повторяется.
	balances := map[int64]int64{}
	var claimed bool
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		var e error
		if claimed, e = i.giveaways.Finish(ctx, g.ID, winners); e != nil || !claimed {
			return e
		}
		switch g.PrizeKind {
		case "premium":
			if i.premium != nil {
				for _, w := range winners {
					if e := i.premium.GrantPremium(ctx, w); e != nil {
						return e
					}
				}
			}
		case "stars":
			if i.stars == nil {
				return nil
			}
			// Строки балансов — по возрастанию user_id (общий порядок блокировок).
			payees := append([]int64{g.CreatorID}, winners...)
			if e := i.lockBalances(ctx, payees...); e != nil {
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
			if unspent := int64(g.WinnersCount-len(winners)) * g.Stars; unspent > 0 {
				b, e := i.stars.AddBalance(ctx, g.CreatorID, unspent)
				if e != nil {
					return e
				}
				if e := i.stars.RecordTx(ctx, g.CreatorID, unspent, "giveaway_refund", "Возврат неразданных звёзд розыгрыша", nil); e != nil {
					return e
				}
				balances[g.CreatorID] = b
			}
		}
		return nil
	})
	if err != nil {
		return g
	}
	if !claimed {
		// Розыгрыш закрыл параллельный читатель — отдаём актуальную строку.
		if cur, e := i.giveaways.ByID(ctx, g.ID); e == nil {
			return cur
		}
		return g
	}
	for uid, b := range balances {
		i.publishBalance(ctx, uid, b)
	}
	g.Status = "finished"
	g.WinnerIDs = winners
	return g
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
