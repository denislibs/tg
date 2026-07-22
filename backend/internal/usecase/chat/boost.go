package chat

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Бусты каналов (Telegram channel boosts). Premium-пользователь тратит слот на
// буст канала (boostDuration), уровень канала растёт от суммы активных бустов.
// Счётчик бустов рассылается участникам канала фреймом boost_update.

const boostDuration = 30 * 24 * time.Hour

// BoostStatus — состояние бустов канала для зрителя viewerID (0 — «никто»).
func (i *Interactor) BoostStatus(ctx context.Context, chatID, viewerID int64) (domain.BoostStatus, error) {
	if i.boosts == nil {
		return domain.BoostStatus{}, domain.ErrNotFound
	}
	if err := i.requireChannel(ctx, chatID); err != nil {
		return domain.BoostStatus{}, err
	}
	total, err := i.boosts.ActiveBoosts(ctx, chatID)
	if err != nil {
		return domain.BoostStatus{}, err
	}
	level, current, next := domain.BoostLevelFor(total)
	st := domain.BoostStatus{
		Level: level, BoostsCount: total,
		CurrentLevelBoosts: current, NextLevelBoosts: next,
	}
	if viewerID != 0 {
		if me, e := i.boosts.BoostedByMe(ctx, chatID, viewerID); e == nil {
			st.BoostedByMe = me
		}
		st.Slots = i.freeBoostSlots(ctx, viewerID)
	}
	return st, nil
}

// BoostChannel тратит свободный слот зрителя на буст канала. Требует premium.
func (i *Interactor) BoostChannel(ctx context.Context, chatID, userID int64) (domain.BoostStatus, error) {
	if i.boosts == nil || i.premium == nil {
		return domain.BoostStatus{}, domain.ErrNotFound
	}
	if err := i.requireChannel(ctx, chatID); err != nil {
		return domain.BoostStatus{}, err
	}
	prem, err := i.premium.IsPremium(ctx, userID)
	if err != nil {
		return domain.BoostStatus{}, err
	}
	if !prem {
		return domain.BoostStatus{}, domain.ErrForbidden // буст доступен только premium
	}
	// Повторный буст того же канала не наращивает слоты — просто продлевает срок.
	already, err := i.boosts.BoostedByMe(ctx, chatID, userID)
	if err != nil {
		return domain.BoostStatus{}, err
	}
	if !already && i.freeBoostSlots(ctx, userID) <= 0 {
		return domain.BoostStatus{}, domain.ErrForbidden // нет свободных слотов
	}
	if err := i.boosts.Boost(ctx, chatID, userID, 1, time.Now().Add(boostDuration)); err != nil {
		return domain.BoostStatus{}, err
	}
	i.publishBoostUpdate(ctx, chatID)
	return i.BoostStatus(ctx, chatID, userID)
}

// freeBoostSlots — свободные слоты бустов пользователя (0, если не premium).
func (i *Interactor) freeBoostSlots(ctx context.Context, userID int64) int {
	if i.premium == nil {
		return 0
	}
	prem, err := i.premium.IsPremium(ctx, userID)
	if err != nil || !prem {
		return 0
	}
	used, err := i.boosts.UserActiveSlots(ctx, userID)
	if err != nil {
		return 0
	}
	free := domain.PremiumBoostSlots - used
	if free < 0 {
		free = 0
	}
	return free
}

// requireChannel проверяет, что чат — канал.
func (i *Interactor) requireChannel(ctx context.Context, chatID int64) error {
	typ, err := i.chats.ChatType(ctx, chatID)
	if err != nil {
		return err
	}
	if typ != "channel" {
		return domain.ErrNotFound
	}
	return nil
}

// publishBoostUpdate рассылает участникам канала счётчик бустов/уровень
// (без per-viewer полей — их каждый клиент знает сам).
func (i *Interactor) publishBoostUpdate(ctx context.Context, chatID int64) {
	if i.publisher == nil {
		return
	}
	st, err := i.BoostStatus(ctx, chatID, 0)
	if err != nil {
		return
	}
	members, err := i.chats.MemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	f := frame("boost_update", map[string]any{"chat_id": chatID, "status": st})
	for _, uid := range members {
		_ = i.publisher.PublishToUser(ctx, uid, f)
	}
}
