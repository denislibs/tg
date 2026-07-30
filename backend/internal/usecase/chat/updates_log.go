package chat

import (
	"context"
	"encoding/json"
)

// logAndPublish records `typ`(base) in every recipient's per-user update log —
// capturing each recipient's dense pts — and, after the log tx commits, publishes
// a live frame carrying that pts (framePts) to each. It is the Wave-2 counterpart
// of the inline log+publish blocks in message.go / reaction.go, for the stateful
// updates whose mutation has already committed by the time they fan out: the
// append is its own short transaction, so a /sync catch-up replays exactly what
// the live path delivered and the client's cursor stays dense.
//
// base is the shared payload marshalled once for the log; it is never mutated —
// framePts injects each recipient's pts into a COPY (frameFields). Recipients are
// used as given (the caller dedups); own-device events pass a single id.
//
// No-op without an update log (some unit-test setups wire updates=nil, mirroring
// postGroupService); publishing is skipped without a publisher.
func (i *Interactor) logAndPublish(ctx context.Context, recipients []int64, typ string, base map[string]any) error {
	if i.updates == nil || len(recipients) == 0 {
		return nil
	}
	payload, err := json.Marshal(base)
	if err != nil {
		return err
	}
	ptsByUser := make(map[int64]int64, len(recipients))
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		date := nowMillis()
		for _, uid := range recipients {
			pts, e := i.updates.AppendUpdate(ctx, uid, 1, date, typ, payload)
			if e != nil {
				return e
			}
			ptsByUser[uid] = pts
		}
		return nil
	})
	if err != nil {
		return err
	}
	if i.publisher != nil {
		for _, uid := range recipients {
			_ = i.publisher.PublishToUser(ctx, uid, framePts(typ, base, ptsByUser[uid]))
		}
	}
	return nil
}

// logAndPublishChannel is the O(1) channel-broadcast counterpart of logAndPublish
// for stateful channel updates (chat_update/boost_update): instead of fanning the
// payload into every subscriber's per-user log (N rows + N publishes), it appends
// ONE typed row to the channel_updates log (dense channel_pts) and PUBLISHes ONCE
// to channel:{id}. Subscribers receive it live; the rest catch up on open via the
// typed GET /channels/{id}/difference. base is an absolute snapshot, so replay is
// idempotent. No-op without a channel log; publish skipped without a publisher.
func (i *Interactor) logAndPublishChannel(ctx context.Context, channelID int64, typ string, base map[string]any) error {
	if i.channels == nil {
		return nil
	}
	payload, err := json.Marshal(base)
	if err != nil {
		return err
	}
	var pts int64
	err = i.tx.WithinTx(ctx, func(ctx context.Context) error {
		p, e := i.channels.AppendUpdate(ctx, channelID, typ, payload)
		pts = p
		return e
	})
	if err != nil {
		return err
	}
	if i.chPub != nil {
		_ = i.chPub.PublishToChannel(ctx, channelID, frameChannelPts(typ, base, pts))
	}
	return nil
}
