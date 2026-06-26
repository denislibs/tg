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
	count, err := i.msgs.CountMessages(ctx, chatID)
	if err != nil {
		return HistoryResult{}, err
	}
	return HistoryResult{Messages: msgs, Count: count}, nil
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
