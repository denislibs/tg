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
	giveawayMaxPeriod  = 7 * 24 * time.Hour
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

// CreateGiveaway валидирует и публикует розыгрыш сообщением типа 'giveaway'
// (создать может только админ канала с правом постинга).
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
		in.Stars = 0
	case "stars":
		if in.Stars <= 0 {
			return domain.Message{}, domain.ErrInvalid
		}
		in.Months = 0
	default:
		return domain.Message{}, domain.ErrInvalid
	}
	now := time.Now()
	if in.UntilDate.Before(now) || in.UntilDate.After(now.Add(giveawayMaxPeriod)) {
		return domain.Message{}, domain.ErrInvalid
	}
	g, err := i.giveaways.Create(ctx, domain.Giveaway{
		ChatID: in.ChatID, CreatorID: in.CreatorID, PrizeKind: in.PrizeKind,
		Months: in.Months, Stars: in.Stars, WinnersCount: in.WinnersCount,
		UntilDate: in.UntilDate, Status: "active",
	})
	if err != nil {
		return domain.Message{}, err
	}
	msg, err := i.Send(ctx, SendInput{
		ChatID: in.ChatID, SenderID: in.CreatorID, Type: "giveaway",
		ClientMsgID: in.ClientMsgID, GiveawayID: &g.ID,
	})
	if err != nil {
		return domain.Message{}, err
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
	if err := i.giveaways.Finish(ctx, g.ID, winners); err != nil {
		return g
	}
	// Выдаём призы победителям.
	for _, w := range winners {
		switch g.PrizeKind {
		case "premium":
			if i.premium != nil {
				_ = i.premium.GrantPremium(ctx, w)
			}
		case "stars":
			if i.stars != nil {
				_, _ = i.stars.AddBalance(ctx, w, g.Stars)
			}
		}
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
		ID: g.ID, ChatID: g.ChatID, PrizeKind: g.PrizeKind,
		Months: g.Months, Stars: g.Stars, WinnersCount: g.WinnersCount,
		UntilDate: g.UntilDate.UnixMilli(), Status: g.Status,
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

// publishGiveawayUpdate рассылает участникам чата состояние розыгрыша
// (без per-viewer полей — их каждый клиент знает сам).
func (i *Interactor) publishGiveawayUpdate(ctx context.Context, chatID, giveawayID int64) {
	if i.publisher == nil {
		return
	}
	info, err := i.giveawayInfoFor(ctx, giveawayID, 0)
	if err != nil {
		return
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	f := frame("giveaway_update", map[string]any{"chat_id": chatID, "giveaway": info})
	for _, uid := range members {
		_ = i.publisher.PublishToUser(ctx, uid, f)
	}
}
