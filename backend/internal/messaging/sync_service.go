package messaging

import (
	"context"
	"encoding/json"
)

// syncLimit caps updates returned per /sync call (slice beyond this).
const syncLimit = 500

// tooLongThreshold: if the client is further behind than this, force a full resync.
const tooLongThreshold = 2000

// HistoryResult is one window of chat history.
type HistoryResult struct {
	Messages []Message
	Count    int
}

// GetHistory returns a window of messages plus the chat's total count.
func (s *Service) GetHistory(ctx context.Context, chatID, userID, offsetSeq int64, addOffset, limit int) (HistoryResult, error) {
	ok, err := s.chats.IsMember(ctx, s.pool, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	if !ok {
		return HistoryResult{}, ErrNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	msgs, err := s.msgs.GetHistory(ctx, s.pool, chatID, offsetSeq, addOffset, limit)
	if err != nil {
		return HistoryResult{}, err
	}
	count, err := s.msgs.CountMessages(ctx, s.pool, chatID)
	if err != nil {
		return HistoryResult{}, err
	}
	return HistoryResult{Messages: msgs, Count: count}, nil
}

// Difference is the result of GetDifference: updates the client missed since its pts.
type Difference struct {
	NewMessages  []json.RawMessage `json:"new_messages"`
	OtherUpdates []json.RawMessage `json:"other_updates"`
	State        UserState         `json:"state"`
	Slice        bool              `json:"slice"`
	TooLong      bool              `json:"too_long"`
}

// GetDifference returns updates with pts>sincePts, split by kind. If the client is
// too far behind, TooLong is set so it can do a full resync (snapshot via ListDialogs).
func (s *Service) GetDifference(ctx context.Context, userID, sincePts int64) (Difference, error) {
	if sincePts < 0 {
		sincePts = 0
	}
	state, err := s.updates.GetUserState(ctx, s.pool, userID)
	if err != nil {
		return Difference{}, err
	}
	if state.Pts-sincePts > tooLongThreshold {
		return Difference{TooLong: true, State: state}, nil
	}
	ups, err := s.updates.UpdatesSince(ctx, s.pool, userID, sincePts, syncLimit)
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
		d.State = UserState{Pts: ups[len(ups)-1].Pts, Date: state.Date}
	}
	return d, nil
}
