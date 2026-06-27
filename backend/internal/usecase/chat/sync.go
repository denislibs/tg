package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// GetHistory returns a window of messages plus the chat's total count.
func (i *Interactor) GetHistory(ctx context.Context, chatID, userID, offsetSeq int64, addOffset, limit int) (HistoryResult, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	if !ok {
		return HistoryResult{}, domain.ErrNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	msgs, err := i.msgs.GetHistory(ctx, chatID, userID, offsetSeq, addOffset, limit)
	if err != nil {
		return HistoryResult{}, err
	}
	if e := i.hydrateReplies(ctx, msgs); e != nil {
		return HistoryResult{}, e
	}
	count, err := i.msgs.CountMessages(ctx, chatID)
	if err != nil {
		return HistoryResult{}, err
	}
	return HistoryResult{Messages: msgs, Count: count}, nil
}

// hydrateReplies fills ReplyTo on each message that replies to another, batch-
// fetching the targets by id (one query). Deleted/missing targets are skipped.
func (i *Interactor) hydrateReplies(ctx context.Context, msgs []domain.Message) error {
	ids := make([]int64, 0)
	seen := map[int64]bool{}
	for _, m := range msgs {
		if m.ReplyToID != nil && !seen[*m.ReplyToID] {
			seen[*m.ReplyToID] = true
			ids = append(ids, *m.ReplyToID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	targets, err := i.msgs.GetByIDs(ctx, ids)
	if err != nil {
		return err
	}
	byID := make(map[int64]domain.Message, len(targets))
	for _, t := range targets {
		byID[t.ID] = t
	}
	for idx := range msgs {
		rid := msgs[idx].ReplyToID
		if rid == nil {
			continue
		}
		t, ok := byID[*rid]
		if !ok || t.Deleted {
			continue
		}
		text := t.Text
		if len([]rune(text)) > 120 {
			text = string([]rune(text)[:120])
		}
		msgs[idx].ReplyTo = &domain.ReplyPreview{MsgID: t.ID, SenderID: t.SenderID, Text: text, Type: t.Type}
	}
	return nil
}

// GetDifference returns updates with pts>sincePts, split by kind. If the client is
// too far behind, TooLong is set so it can do a full resync (snapshot via ListDialogs).
func (i *Interactor) GetDifference(ctx context.Context, userID, sincePts int64) (Difference, error) {
	if sincePts < 0 {
		sincePts = 0
	}
	state, err := i.updates.GetUserState(ctx, userID)
	if err != nil {
		return Difference{}, err
	}
	if state.Pts-sincePts > tooLongThreshold {
		return Difference{TooLong: true, State: state}, nil
	}
	ups, err := i.updates.UpdatesSince(ctx, userID, sincePts, syncLimit)
	if err != nil {
		return Difference{}, err
	}
	d := Difference{State: state, NewMessages: []json.RawMessage{}, OtherUpdates: []json.RawMessage{}}
	for _, u := range ups {
		if u.Type == "new_message" {
			d.NewMessages = append(d.NewMessages, u.Payload)
		} else {
			d.OtherUpdates = append(d.OtherUpdates, u.Payload)
		}
	}
	if len(ups) == syncLimit {
		d.Slice = true
		d.State = domain.UserState{Pts: ups[len(ups)-1].Pts, Date: state.Date}
	}
	return d, nil
}
