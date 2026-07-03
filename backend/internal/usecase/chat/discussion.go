package chat

import (
	"context"

	"github.com/messenger-denis/backend/internal/domain"
)

// EnableDiscussion attaches a discussion group to a channel so its posts can
// receive threaded comments. Requires RightChangeInfo on the channel. Idempotent:
// if a discussion group already exists it is returned unchanged. Otherwise a new
// "group" chat is created (actor = creator) and linked via chats.discussion_chat_id.
func (i *Interactor) EnableDiscussion(ctx context.Context, channelID, actorID int64) (int64, error) {
	if err := i.requireRight(ctx, channelID, actorID, domain.RightChangeInfo); err != nil {
		return 0, err
	}
	if cur, _ := i.groups.GetDiscussion(ctx, channelID); cur != 0 {
		return cur, nil
	}
	var gid int64
	err := i.tx.WithinTx(ctx, func(ctx context.Context) error {
		id, e := i.groups.CreateMultiMember(ctx, "group", "Discussion", "", "", false, actorID)
		if e != nil {
			return e
		}
		if e := i.groups.AddMember(ctx, id, actorID, domain.RoleCreator, domain.AllRights); e != nil {
			return e
		}
		if e := i.groups.SetDiscussion(ctx, channelID, id); e != nil {
			return e
		}
		gid = id
		return nil
	})
	if err != nil {
		return 0, err
	}
	return gid, nil
}

// PostComment posts a comment on a channel post. The comment is a message in the
// channel's discussion group with ThreadRootID set to the post id, so it threads
// under that post. Returns domain.ErrNotFound if discussions aren't enabled. The
// commenter is auto-joined to the discussion group (idempotent) before posting.
func (i *Interactor) PostComment(ctx context.Context, channelID, postID, userID int64, text, clientMsgID string) (domain.Message, error) {
	disc, _ := i.groups.GetDiscussion(ctx, channelID)
	if disc == 0 {
		return domain.Message{}, domain.ErrNotFound
	}
	_ = i.groups.AddMember(ctx, disc, userID, domain.RoleMember, 0) // auto-join (idempotent)
	pid := postID
	return i.Send(ctx, SendInput{
		ChatID: disc, SenderID: userID, Type: "text", Text: text,
		ClientMsgID: clientMsgID, ThreadRootID: &pid,
	})
}

// ListComments returns the comment thread (ascending) for a channel post plus the
// total comment count. domain.ErrNotFound if discussions aren't enabled.
func (i *Interactor) ListComments(ctx context.Context, channelID, postID, userID int64, offset, limit int) ([]domain.Message, int, error) {
	disc, _ := i.groups.GetDiscussion(ctx, channelID)
	if disc == 0 {
		return nil, 0, domain.ErrNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	msgs, err := i.msgs.ListThread(ctx, disc, postID, offset, limit)
	if err != nil {
		return nil, 0, err
	}
	cnt, err := i.msgs.CountThread(ctx, disc, postID)
	return msgs, cnt, err
}

// CommentCounts returns a postID -> comment count map for the given posts. When
// discussions aren't enabled it returns an empty map (no error).
func (i *Interactor) CommentCounts(ctx context.Context, channelID int64, postIDs []int64) (map[int64]int, error) {
	out := map[int64]int{}
	disc, _ := i.groups.GetDiscussion(ctx, channelID)
	if disc == 0 {
		return out, nil
	}
	for _, p := range postIDs {
		c, _ := i.msgs.CountThread(ctx, disc, p)
		out[p] = c
	}
	return out, nil
}

// ViewCounts returns the current view count for each of the given channel post
// ids (Telegram's "9.2K 👁"). Non-channel messages report 0. Mirrors the
// commentCounts read path — the client fetches these per open to stay fresh.
func (i *Interactor) ViewCounts(ctx context.Context, postIDs []int64) (map[int64]int64, error) {
	return i.msgs.ViewCounts(ctx, postIDs)
}
