package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// ВРЕМЕННО (P1 до влития БЭК-3): помощник синхронизации зеркала живёт у
// БЭК-3 в message_edit.go (контракт f5-contract.md). Файл удаляется при
// ребейзе на main с БЭК-3.
func (i *Interactor) syncMirrorContent(ctx context.Context, post domain.Message, edited bool) {
	if i.groups == nil {
		return
	}
	disc, err := i.groups.GetDiscussion(ctx, post.ChatID)
	if err != nil || disc == 0 {
		return
	}
	mid, err := i.msgs.MirrorOfExactPost(ctx, post.ChatID, post.ID)
	if err != nil || mid == 0 {
		return
	}
	if err := i.msgs.SetWebPage(ctx, mid, post.WebPage); err != nil {
		return
	}
	mirror, err := i.msgs.GetByID(ctx, mid)
	if err != nil {
		return
	}
	if mirror, err = i.hydrateBroadcastMessage(ctx, mirror); err != nil {
		return
	}
	members, err := i.chats.MemberIDs(ctx, disc)
	if err != nil {
		return
	}
	pp, err := i.newPeerPayloads(ctx, disc, i.editMessagePayload(ctx, mirror))
	if err != nil {
		return
	}
	for _, uid := range members {
		payload, err := pp.payload(uid)
		if err != nil {
			return
		}
		pts, err := i.updates.AppendUpdate(ctx, uid, 1, nowUnix(), "edit_message", payload)
		if err == nil && i.publisher != nil {
			_ = i.publisher.PublishToUser(ctx, uid, pp.framePts("edit_message", uid, pts))
		}
	}
	_ = edited
}
