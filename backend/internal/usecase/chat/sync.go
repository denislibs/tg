package chat

import (
	"context"
	"encoding/json"

	"github.com/messenger-denis/backend/internal/domain"
)

// GetHistory returns a window of messages plus the chat's total count.
// threadRoot != nil ограничивает окно тредом (форум-топик / комментарии поста);
// тред discussion-группы читается и не-членом (как ListComments — комментарии
// канала доступны подписчикам без вступления в группу).
func (i *Interactor) GetHistory(ctx context.Context, chatID, userID, offsetSeq int64, addOffset, limit int, threadRoot *int64) (HistoryResult, error) {
	if err := i.checkHistoryAccess(ctx, chatID, userID, threadRoot); err != nil {
		return HistoryResult{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	msgs, err := i.msgs.GetHistory(ctx, chatID, userID, offsetSeq, addOffset, limit, threadRoot)
	if err != nil {
		return HistoryResult{}, err
	}
	// Верх треда достигнут (короткая страница при чтении от新ейших/старее) —
	// подшиваем корневой пост канала первым сообщением (tweb: пост форварднут
	// в discussion-группу и открывает тред).
	if threadRoot != nil && len(msgs) < limit && addOffset >= 0 {
		msgs = i.prependForeignThreadRoot(ctx, chatID, *threadRoot, msgs)
	}
	if e := i.hydrateReplies(ctx, msgs); e != nil {
		return HistoryResult{}, e
	}
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return HistoryResult{}, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
	_ = i.hydrateReactions(ctx, userID, msgs)
	var count int
	if threadRoot != nil {
		count, err = i.msgs.CountThread(ctx, chatID, *threadRoot)
	} else {
		count, err = i.msgs.CountMessages(ctx, chatID)
	}
	if err != nil {
		return HistoryResult{}, err
	}
	return HistoryResult{Messages: msgs, Count: count}, nil
}

// prependForeignThreadRoot: корень треда комментариев — пост КАНАЛА (другой
// чат); в окно треда он подшивается синтетическим seq=0, чтобы встать первым
// (у форум-топиков корень в том же чате и попадает в выборку сам). Best-effort.
func (i *Interactor) prependForeignThreadRoot(ctx context.Context, chatID, threadRoot int64, msgs []domain.Message) []domain.Message {
	for _, m := range msgs {
		if m.ID == threadRoot {
			return msgs // корень уже в окне (тред форум-топика)
		}
	}
	root, err := i.msgs.GetByID(ctx, threadRoot)
	if err != nil || root.Deleted || root.ChatID == chatID {
		return msgs
	}
	root.Seq = 0
	return append([]domain.Message{root}, msgs...)
}

// checkHistoryAccess: член чата — всегда; не-член — только тред в discussion-
// группе канала (комментарии читаются без вступления, tweb).
func (i *Interactor) checkHistoryAccess(ctx context.Context, chatID, userID int64, threadRoot *int64) error {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	if threadRoot != nil && i.groups != nil {
		if disc, e := i.groups.IsDiscussionGroup(ctx, chatID); e == nil && disc {
			return nil
		}
	}
	return domain.ErrNotFound
}

// hydrateReactions fills Reactions (emoji aggregates + the viewer's mine flag) on
// a window of messages with one batch query. Best-effort: reactions are cosmetic,
// a failure must not break history.
func (i *Interactor) hydrateReactions(ctx context.Context, viewerID int64, msgs []domain.Message) error {
	ids := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		if !m.Deleted {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	byMsg, err := i.reactions.ReactionsFor(ctx, ids, viewerID)
	if err != nil {
		return err
	}
	for idx := range msgs {
		msgs[idx].Reactions = byMsg[msgs[idx].ID]
	}
	return nil
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
		// Carry formatting only for untruncated snippets — entity offsets are over
		// the full text, so clipping the string would misalign them.
		entities := t.Entities
		if len([]rune(text)) > 120 {
			text = string([]rune(text)[:120])
			entities = nil
		}
		msgs[idx].ReplyTo = &domain.ReplyPreview{MsgID: t.ID, Seq: t.Seq, SenderID: t.SenderID, Text: text, Entities: entities, Type: t.Type, MediaID: t.MediaID}
	}
	return nil
}

// hydrateMedia fills width/height/mime on messages that carry media, batch-fetching
// dims by media id (one query). Lets the client reserve the exact media box before
// the bytes load (no layout shift). Missing/unprocessed media are left at zero.
func (i *Interactor) hydrateMedia(ctx context.Context, msgs []domain.Message) error {
	ids := make([]int64, 0)
	seen := map[int64]bool{}
	for _, m := range msgs {
		if m.MediaID != nil && *m.MediaID > 0 && !seen[*m.MediaID] {
			seen[*m.MediaID] = true
			ids = append(ids, *m.MediaID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	dims, err := i.mediaAccess.DimsByIDs(ctx, ids)
	if err != nil {
		return err
	}
	for idx := range msgs {
		if msgs[idx].MediaID == nil {
			continue
		}
		if d, ok := dims[*msgs[idx].MediaID]; ok {
			msgs[idx].MediaWidth = d.Width
			msgs[idx].MediaHeight = d.Height
			msgs[idx].MediaMime = d.Mime
			msgs[idx].MediaBlur = d.Blur
			msgs[idx].MediaHasThumb = d.HasThumb
			msgs[idx].MediaDuration = d.Duration
			msgs[idx].MediaSize = d.Size
			msgs[idx].MediaName = d.FileName
		}
	}
	return nil
}

// AroundResult is a jump-to-message window: messages around a seq + end flags.
type AroundResult struct {
	Messages      []domain.Message
	ReachedTop    bool
	ReachedBottom bool
	Count         int
}

// GetHistoryAround returns a window centered on centerSeq (for jump-to-message),
// with reply previews hydrated.
func (i *Interactor) GetHistoryAround(ctx context.Context, chatID, userID, centerSeq int64, limit int, threadRoot *int64) (AroundResult, error) {
	if err := i.checkHistoryAccess(ctx, chatID, userID, threadRoot); err != nil {
		return AroundResult{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	msgs, top, bottom, err := i.msgs.GetAround(ctx, chatID, userID, centerSeq, limit, threadRoot)
	if err != nil {
		return AroundResult{}, err
	}
	if threadRoot != nil && top {
		msgs = i.prependForeignThreadRoot(ctx, chatID, *threadRoot, msgs)
	}
	if e := i.hydrateReplies(ctx, msgs); e != nil {
		return AroundResult{}, e
	}
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return AroundResult{}, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
	_ = i.hydrateReactions(ctx, userID, msgs)
	var count int
	if threadRoot != nil {
		count, err = i.msgs.CountThread(ctx, chatID, *threadRoot)
	} else {
		count, err = i.msgs.CountMessages(ctx, chatID)
	}
	if err != nil {
		return AroundResult{}, err
	}
	return AroundResult{Messages: msgs, ReachedTop: top, ReachedBottom: bottom, Count: count}, nil
}

// SearchMessages returns messages in a chat matching q (newest first) + total count.
// MediaHistory lists a chat's shared media of one kind (profile tabs).
func (i *Interactor) MediaHistory(ctx context.Context, chatID, userID int64, filter string, offset, limit int) (HistoryResult, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	if !ok {
		return HistoryResult{}, domain.ErrNotFound
	}
	if limit <= 0 || limit > 60 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	msgs, count, err := i.msgs.MediaHistory(ctx, chatID, filter, offset, limit)
	if err != nil {
		return HistoryResult{}, err
	}
	return HistoryResult{Messages: msgs, Count: count}, nil
}

func (i *Interactor) SearchMessages(ctx context.Context, chatID, userID int64, q string, offset, limit int) (HistoryResult, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return HistoryResult{}, err
	}
	if !ok {
		return HistoryResult{}, domain.ErrNotFound
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	msgs, count, err := i.msgs.SearchMessages(ctx, chatID, q, offset, limit)
	if err != nil {
		return HistoryResult{}, err
	}
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return HistoryResult{}, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
	return HistoryResult{Messages: msgs, Count: count}, nil
}

// GlobalSearchMessages searches messages across every chat the user belongs to
// (tweb global search). filter ∈ {"", media, files, links, music, voice}; with
// an empty q AND empty filter there is nothing to search — returns empty.
func (i *Interactor) GlobalSearchMessages(ctx context.Context, userID int64, q, filter string, offset, limit int) (HistoryResult, error) {
	if q == "" && filter == "" {
		return HistoryResult{}, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	msgs, count, err := i.msgs.GlobalSearchMessages(ctx, userID, q, filter, offset, limit)
	if err != nil {
		return HistoryResult{}, err
	}
	if e := i.hydrateMedia(ctx, msgs); e != nil {
		return HistoryResult{}, e
	}
	_ = i.hydratePolls(ctx, userID, msgs)
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
