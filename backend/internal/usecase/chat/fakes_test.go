package chat

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeTx runs fn directly with the same ctx; no real transaction.
type fakeTx struct{}

func (fakeTx) WithinTx(ctx context.Context, fn func(ctx context.Context) error) error {
	return fn(ctx)
}

// ---- in-memory store shared by the fake repos ----

type member struct {
	lastReadSeq int64
	unread      int
	muted       bool
}

type store struct {
	mu sync.Mutex

	nextChatID  int64
	nextMsgID   int64
	chatType    map[int64]string
	chatSeq     map[int64]int64           // chatID -> last_seq
	members     map[int64]map[int64]*member // chatID -> userID -> member
	messages    map[int64][]domain.Message  // chatID -> messages (by seq order)
	owners      map[int64]int64           // mediaID -> ownerID
	reactions   map[int64]map[int64]map[string]bool // msgID -> userID -> emoji set
	hidden      map[int64]map[int64]bool            // userID -> msgID -> hidden ("delete for me")
	pins        map[int64][]int64                   // chatID -> pinned msgIDs (newest first)

	// per-user update log
	pts     map[int64]int64
	date    map[int64]int64
	updates map[int64][]domain.Update // userID -> updates (pts asc)
}

func newStore() *store {
	return &store{
		chatType:  map[int64]string{},
		chatSeq:   map[int64]int64{},
		members:   map[int64]map[int64]*member{},
		messages:  map[int64][]domain.Message{},
		owners:    map[int64]int64{},
		reactions: map[int64]map[int64]map[string]bool{},
		pts:       map[int64]int64{},
		date:      map[int64]int64{},
		updates:   map[int64][]domain.Update{},
	}
}

func (s *store) seedMedia(mediaID, ownerID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.owners[mediaID] = ownerID
}

// ---- ChatRepo ----

type fakeChats struct{ s *store }

func (r fakeChats) FindPrivate(_ context.Context, a, b int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for cid, typ := range r.s.chatType {
		if typ != "private" {
			continue
		}
		m := r.s.members[cid]
		if m[a] != nil && m[b] != nil {
			return cid, nil
		}
	}
	return 0, domain.ErrNotFound
}

func (r fakeChats) CreatePrivate(_ context.Context, a, b int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	r.s.nextChatID++
	cid := r.s.nextChatID
	r.s.chatType[cid] = "private"
	r.s.chatSeq[cid] = 0
	r.s.members[cid] = map[int64]*member{a: {}, b: {}}
	return cid, nil
}

func (r fakeChats) MemberIDs(_ context.Context, chatID int64) ([]int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var ids []int64
	for uid := range r.s.members[chatID] {
		ids = append(ids, uid)
	}
	return ids, nil
}

func (r fakeChats) IsMember(_ context.Context, chatID, userID int64) (bool, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	return r.s.members[chatID][userID] != nil, nil
}

func (r fakeChats) ListDialogs(_ context.Context, userID int64) ([]domain.Dialog, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.Dialog
	for cid, m := range r.s.members {
		mem := m[userID]
		if mem == nil {
			continue
		}
		d := domain.Dialog{
			ChatID:      cid,
			Type:        r.s.chatType[cid],
			LastReadSeq: mem.lastReadSeq,
			UnreadCount: mem.unread,
			Muted:       mem.muted,
		}
		msgs := r.s.messages[cid]
		if len(msgs) > 0 {
			last := msgs[len(msgs)-1]
			d.HasLast = true
			d.LastSeq = last.Seq
			d.LastText = last.Text
			d.LastSenderID = last.SenderID
			d.LastAt = last.CreatedAt
		}
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ChatID < out[j].ChatID })
	return out, nil
}

func (r fakeChats) ChatPartners(_ context.Context, userID int64) ([]int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	seen := map[int64]bool{}
	var out []int64
	for _, m := range r.s.members {
		if m[userID] == nil {
			continue
		}
		for uid := range m {
			if uid != userID && !seen[uid] {
				seen[uid] = true
				out = append(out, uid)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, nil
}

func (r fakeChats) IncUnread(_ context.Context, chatID, userID int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if m := r.s.members[chatID][userID]; m != nil {
		m.unread++
	}
	return nil
}

func (r fakeChats) CurrentReadSeq(_ context.Context, chatID, userID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if m := r.s.members[chatID][userID]; m != nil {
		return m.lastReadSeq, nil
	}
	return 0, domain.ErrNotFound
}

func (r fakeChats) SetRead(_ context.Context, chatID, userID, seq int64, unread int) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if m := r.s.members[chatID][userID]; m != nil {
		m.lastReadSeq = seq
		m.unread = unread
	}
	return nil
}

func (r fakeChats) ChatType(_ context.Context, chatID int64) (string, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if t, ok := r.s.chatType[chatID]; ok {
		return t, nil
	}
	return "", domain.ErrNotFound
}

func (r fakeChats) PinMessage(_ context.Context, chatID, msgID, _ int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if r.s.pins == nil {
		r.s.pins = map[int64][]int64{}
	}
	for _, id := range r.s.pins[chatID] {
		if id == msgID {
			return nil
		}
	}
	r.s.pins[chatID] = append([]int64{msgID}, r.s.pins[chatID]...) // newest first
	return nil
}

func (r fakeChats) UnpinMessage(_ context.Context, chatID, msgID int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	cur := r.s.pins[chatID]
	out := cur[:0]
	for _, id := range cur {
		if id != msgID {
			out = append(out, id)
		}
	}
	r.s.pins[chatID] = out
	return nil
}

func (r fakeChats) ListPins(_ context.Context, chatID int64) ([]domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.Message
	for _, msgID := range r.s.pins[chatID] {
		for _, m := range r.s.messages[chatID] {
			if m.ID == msgID && !m.Deleted {
				out = append(out, m)
			}
		}
	}
	return out, nil
}

func (r fakeChats) Viewers(_ context.Context, chatID, seq, excludeUser int64) ([]int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []int64
	for uid, m := range r.s.members[chatID] {
		if uid != excludeUser && m.lastReadSeq >= seq {
			out = append(out, uid)
		}
	}
	sort.Slice(out, func(a, b int) bool { return out[a] < out[b] })
	return out, nil
}

// ---- MessageRepo ----

type fakeMsgs struct{ s *store }

func (r fakeMsgs) NextSeq(_ context.Context, chatID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if _, ok := r.s.chatType[chatID]; !ok {
		return 0, domain.ErrNotFound
	}
	r.s.chatSeq[chatID]++
	return r.s.chatSeq[chatID], nil
}

func (r fakeMsgs) Insert(_ context.Context, m domain.Message) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	r.s.nextMsgID++
	m.ID = r.s.nextMsgID
	r.s.messages[m.ChatID] = append(r.s.messages[m.ChatID], m)
	return m, nil
}

func (r fakeMsgs) FindByClientMsgID(_ context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for _, m := range r.s.messages[chatID] {
		if m.SenderID == senderID && m.ClientMsgID != nil && *m.ClientMsgID == clientMsgID {
			return m, nil
		}
	}
	return domain.Message{}, domain.ErrNotFound
}

func (r fakeMsgs) GetByID(_ context.Context, msgID int64) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for _, msgs := range r.s.messages {
		for _, m := range msgs {
			if m.ID == msgID {
				return m, nil
			}
		}
	}
	return domain.Message{}, domain.ErrNotFound
}

func (r fakeMsgs) GetByIDs(_ context.Context, ids []int64) ([]domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	want := map[int64]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var out []domain.Message
	for _, msgs := range r.s.messages {
		for _, m := range msgs {
			if want[m.ID] {
				out = append(out, m)
			}
		}
	}
	return out, nil
}

func (r fakeMsgs) UpdateText(_ context.Context, msgID int64, text string) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	now := time.Now()
	for chatID, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID {
				m.Text = text
				m.EditedAt = &now
				r.s.messages[chatID][idx] = m
				return m, nil
			}
		}
	}
	return domain.Message{}, domain.ErrNotFound
}

func (r fakeMsgs) SoftDelete(_ context.Context, msgID int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for chatID, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID {
				m.Deleted = true
				m.Text = ""
				r.s.messages[chatID][idx] = m
				return nil
			}
		}
	}
	return domain.ErrNotFound
}

func (r fakeMsgs) HideForUser(_ context.Context, userID, msgID int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if r.s.hidden == nil {
		r.s.hidden = map[int64]map[int64]bool{}
	}
	if r.s.hidden[userID] == nil {
		r.s.hidden[userID] = map[int64]bool{}
	}
	r.s.hidden[userID][msgID] = true
	return nil
}

func (r fakeMsgs) GetHistory(_ context.Context, chatID, userID, offsetSeq int64, addOffset, limit int) ([]domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	all := r.s.messages[chatID]
	isHidden := func(m domain.Message) bool {
		if m.Deleted {
			return true // deleted messages are never returned
		}
		return r.s.hidden != nil && r.s.hidden[userID] != nil && r.s.hidden[userID][m.ID]
	}
	var picked []domain.Message
	switch {
	case offsetSeq == 0: // newest, desc
		for i := len(all) - 1; i >= 0; i-- {
			if isHidden(all[i]) {
				continue
			}
			picked = append(picked, all[i])
			if len(picked) == limit {
				break
			}
		}
	case addOffset <= 0: // newer than offset, asc
		for _, m := range all {
			if m.Seq > offsetSeq && !isHidden(m) {
				picked = append(picked, m)
				if len(picked) == limit {
					break
				}
			}
		}
	default: // older, inclusive of offset, desc
		for i := len(all) - 1; i >= 0; i-- {
			if all[i].Seq <= offsetSeq && !isHidden(all[i]) {
				picked = append(picked, all[i])
				if len(picked) == limit {
					break
				}
			}
		}
	}
	return picked, nil
}

func (r fakeMsgs) ListThread(_ context.Context, chatID, threadRootID int64, offset, limit int) ([]domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var picked []domain.Message
	for _, m := range r.s.messages[chatID] {
		if m.ThreadRootID != nil && *m.ThreadRootID == threadRootID && !m.Deleted {
			picked = append(picked, m)
		}
	}
	if offset > len(picked) {
		offset = len(picked)
	}
	picked = picked[offset:]
	if limit > 0 && len(picked) > limit {
		picked = picked[:limit]
	}
	return picked, nil
}

func (r fakeMsgs) CountThread(_ context.Context, chatID, threadRootID int64) (int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	n := 0
	for _, m := range r.s.messages[chatID] {
		if m.ThreadRootID != nil && *m.ThreadRootID == threadRootID && !m.Deleted {
			n++
		}
	}
	return n, nil
}

func (r fakeMsgs) CountMessages(_ context.Context, chatID int64) (int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	return len(r.s.messages[chatID]), nil
}

func (r fakeMsgs) CountUnread(_ context.Context, chatID, userID, afterSeq int64) (int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	n := 0
	for _, m := range r.s.messages[chatID] {
		if m.Seq > afterSeq && m.SenderID != userID && !m.Deleted {
			n++
		}
	}
	return n, nil
}

func (r fakeMsgs) MessageChatID(_ context.Context, messageID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for cid, msgs := range r.s.messages {
		for _, m := range msgs {
			if m.ID == messageID {
				return cid, nil
			}
		}
	}
	return 0, domain.ErrNotFound
}

// ---- UpdateRepo ----

type fakeUpdates struct{ s *store }

func (r fakeUpdates) AppendUpdate(_ context.Context, userID int64, ptsCount int, date int64, typ string, payload json.RawMessage) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	r.s.pts[userID] += int64(ptsCount)
	r.s.date[userID] = date
	newPts := r.s.pts[userID]
	r.s.updates[userID] = append(r.s.updates[userID], domain.Update{
		Pts: newPts, PtsCount: ptsCount, Type: typ, Payload: payload,
	})
	return newPts, nil
}

func (r fakeUpdates) GetUserState(_ context.Context, userID int64) (domain.UserState, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	return domain.UserState{Pts: r.s.pts[userID], Date: r.s.date[userID]}, nil
}

func (r fakeUpdates) UpdatesSince(_ context.Context, userID, sincePts int64, limit int) ([]domain.Update, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.Update
	for _, u := range r.s.updates[userID] {
		if u.Pts > sincePts {
			out = append(out, u)
			if len(out) == limit {
				break
			}
		}
	}
	return out, nil
}

// ---- ReactionRepo ----

type fakeReactions struct{ s *store }

func (r fakeReactions) Add(_ context.Context, messageID, userID int64, emoji string) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if r.s.reactions[messageID] == nil {
		r.s.reactions[messageID] = map[int64]map[string]bool{}
	}
	if r.s.reactions[messageID][userID] == nil {
		r.s.reactions[messageID][userID] = map[string]bool{}
	}
	r.s.reactions[messageID][userID][emoji] = true
	return nil
}

func (r fakeReactions) Remove(_ context.Context, messageID, userID int64, emoji string) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if u := r.s.reactions[messageID][userID]; u != nil {
		delete(u, emoji)
	}
	return nil
}

func (r fakeReactions) ReactionsFor(_ context.Context, messageID int64) ([]domain.ReactionCount, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	counts := map[string]int{}
	for _, emojis := range r.s.reactions[messageID] {
		for e := range emojis {
			counts[e]++
		}
	}
	var out []domain.ReactionCount
	for e, c := range counts {
		out = append(out, domain.ReactionCount{Emoji: e, Count: c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Emoji < out[j].Emoji
	})
	return out, nil
}

// ---- MediaAccessRepo ----

type fakeMedia struct{ s *store }

func (r fakeMedia) OwnerID(_ context.Context, mediaID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if owner, ok := r.s.owners[mediaID]; ok {
		return owner, nil
	}
	return 0, domain.ErrNotFound
}

func (r fakeMedia) CanAccess(_ context.Context, userID, mediaID int64) (bool, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if r.s.owners[mediaID] == userID {
		return true, nil
	}
	// member of a chat that references the media
	for cid, msgs := range r.s.messages {
		for _, m := range msgs {
			if m.MediaID != nil && *m.MediaID == mediaID && r.s.members[cid][userID] != nil {
				return true, nil
			}
		}
	}
	return false, nil
}

// ---- fake publisher / notifier ----

type capturedFrame struct {
	userID int64
	frame  []byte
}

type fakePublisher struct {
	mu     sync.Mutex
	frames []capturedFrame
}

func (p *fakePublisher) PublishToUser(_ context.Context, userID int64, f []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.frames = append(p.frames, capturedFrame{userID, append([]byte(nil), f...)})
	return nil
}

func (p *fakePublisher) countFor(userID int64) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, f := range p.frames {
		if f.userID == userID {
			n++
		}
	}
	return n
}

func (p *fakePublisher) reset() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.frames = nil
}

type fakeNotifier struct {
	mu         sync.Mutex
	recipients []int64
}

func (n *fakeNotifier) NotifyNewMessage(_ context.Context, recipientID, _, _, _, _ int64, _ string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.recipients = append(n.recipients, recipientID)
}

// newInteractor wires the interactor against a fresh in-memory store.
func newInteractor() (*Interactor, *store) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	return in, s
}
