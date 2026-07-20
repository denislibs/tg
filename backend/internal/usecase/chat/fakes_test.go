package chat

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"testing"
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
	clearedSeq  int64
	unread      int
	mentions    int
	muted       bool
}

// mentionRow mirrors a message_mentions row in the fake store.
type mentionRow struct {
	chatID, msgID, seq, userID int64
}

type store struct {
	mu sync.Mutex

	nextChatID int64
	nextMsgID  int64
	chatType   map[int64]string
	chatSeq    map[int64]int64                     // chatID -> last_seq
	members    map[int64]map[int64]*member         // chatID -> userID -> member
	messages   map[int64][]domain.Message          // chatID -> messages (by seq order)
	owners     map[int64]int64                     // mediaID -> ownerID
	reactions  map[int64]map[int64]map[string]bool // msgID -> userID -> emoji set
	hidden     map[int64]map[int64]bool            // userID -> msgID -> hidden ("delete for me")
	pins       map[int64][]int64                   // chatID -> pinned msgIDs (newest first)
	viewed     map[int64]map[int64]bool            // msgID -> userID -> viewed (channel view dedup)
	mentions   []mentionRow                        // message_mentions rows

	// автоудаление: период чата / глобальный период пользователя
	autoDelete     map[int64]int
	userAutoDelete map[int64]int

	// per-user update log
	pts     map[int64]int64
	date    map[int64]int64
	updates map[int64][]domain.Update // userID -> updates (pts asc)

	// self-destruct: аргументы каждого вызова SetDestructOnRead (для проверки,
	// что MarkRead запускает таймер).
	destructCalls []destructCall
}

type destructCall struct{ ChatID, ReaderID, ReadSeq int64 }

func newStore() *store {
	return &store{
		chatType:  map[int64]string{},
		chatSeq:   map[int64]int64{},
		members:   map[int64]map[int64]*member{},
		messages:  map[int64][]domain.Message{},
		owners:    map[int64]int64{},
		reactions: map[int64]map[int64]map[string]bool{},
		viewed:    map[int64]map[int64]bool{},
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

func (r fakeChats) CreateSecret(_ context.Context, a, b int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	r.s.nextChatID++
	cid := r.s.nextChatID
	r.s.chatType[cid] = "secret"
	r.s.chatSeq[cid] = 0
	r.s.members[cid] = map[int64]*member{a: {}, b: {}}
	return cid, nil
}

func (r fakeChats) FindSaved(_ context.Context, userID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for cid, typ := range r.s.chatType {
		if typ == "saved" && r.s.members[cid][userID] != nil {
			return cid, nil
		}
	}
	return 0, domain.ErrNotFound
}

func (r fakeChats) CreateSaved(_ context.Context, userID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	r.s.nextChatID++
	cid := r.s.nextChatID
	r.s.chatType[cid] = "saved"
	r.s.chatSeq[cid] = 0
	r.s.members[cid] = map[int64]*member{userID: {}}
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
			ChatID:              cid,
			Type:                r.s.chatType[cid],
			LastReadSeq:         mem.lastReadSeq,
			UnreadCount:         mem.unread,
			UnreadMentionsCount: mem.mentions,
			Muted:               mem.muted,
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

func (r fakeChats) AddMention(_ context.Context, chatID, msgID, seq, userID int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for _, m := range r.s.mentions { // idempotent on (msgID, userID)
		if m.msgID == msgID && m.userID == userID {
			return nil
		}
	}
	r.s.mentions = append(r.s.mentions, mentionRow{chatID, msgID, seq, userID})
	if m := r.s.members[chatID][userID]; m != nil {
		m.mentions++
	}
	return nil
}

func (r fakeChats) ClearMentions(_ context.Context, chatID, userID, uptoSeq int64) (int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	kept := r.s.mentions[:0]
	remaining := 0
	for _, m := range r.s.mentions {
		if m.chatID == chatID && m.userID == userID {
			if m.seq <= uptoSeq {
				continue // read → drop
			}
			remaining++
		}
		kept = append(kept, m)
	}
	r.s.mentions = kept
	if m := r.s.members[chatID][userID]; m != nil {
		m.mentions = remaining
	}
	return remaining, nil
}

func (r fakeChats) NextMention(_ context.Context, chatID, userID, afterSeq int64) (int64, int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var best *mentionRow
	for i := range r.s.mentions {
		m := r.s.mentions[i]
		if m.chatID != chatID || m.userID != userID || m.seq <= afterSeq {
			continue
		}
		if best == nil || m.seq < best.seq {
			best = &r.s.mentions[i]
		}
	}
	if best == nil {
		return 0, 0, domain.ErrNotFound
	}
	return best.seq, best.msgID, nil
}

func (r fakeChats) MaxSeq(_ context.Context, chatID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	return r.s.chatSeq[chatID], nil
}

func (r fakeChats) ClearedSeq(_ context.Context, chatID, userID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if m := r.s.members[chatID][userID]; m != nil {
		return m.clearedSeq, nil
	}
	return 0, nil
}

func (r fakeChats) SetClearedSeq(_ context.Context, chatID, userID, seq int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if m := r.s.members[chatID][userID]; m != nil {
		m.clearedSeq = seq
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
	if m.CreatedAt.IsZero() {
		m.CreatedAt = time.Now() // как БД: DEFAULT now() (нужно для slowmode)
	}
	r.s.messages[m.ChatID] = append(r.s.messages[m.ChatID], m)
	return m, nil
}

func (r fakeMsgs) LastMessageAt(_ context.Context, chatID, senderID int64) (time.Time, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	msgs := r.s.messages[chatID]
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].SenderID == senderID && !msgs[i].Deleted {
			return msgs[i].CreatedAt, nil
		}
	}
	return time.Time{}, domain.ErrNotFound
}

func (r fakeMsgs) SavedDialogs(_ context.Context, _, _ int64) ([]domain.SavedDialog, error) {
	return []domain.SavedDialog{}, nil
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

func (r fakeMsgs) GetAround(_ context.Context, chatID, userID, centerSeq int64, limit int, _ *int64, clearedSeq int64) ([]domain.Message, bool, bool, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if limit <= 0 {
		limit = 40
	}
	half := limit / 2
	all := r.s.messages[chatID]
	var older, newer []domain.Message
	for _, m := range all {
		if m.Deleted || m.Seq <= clearedSeq {
			continue
		}
		if m.Seq <= centerSeq {
			older = append(older, m)
		} else {
			newer = append(newer, m)
		}
	}
	reachedTop := len(older) <= half+1
	reachedBottom := len(newer) <= half
	if len(older) > half+1 {
		older = older[len(older)-(half+1):]
	}
	if len(newer) > half {
		newer = newer[:half]
	}
	return append(older, newer...), reachedTop, reachedBottom, nil
}

func (r fakeMsgs) MediaHistory(_ context.Context, chatID int64, filter string, offset, limit int) ([]domain.Message, int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.Message
	all := r.s.messages[chatID]
	for i := len(all) - 1; i >= 0; i-- { // newest first
		m := all[i]
		if m.Deleted {
			continue
		}
		ok := false
		switch filter {
		case "media":
			ok = m.Type == "photo" || m.Type == "video"
		case "files":
			ok = m.Type == "document"
		case "music":
			ok = m.Type == "audio"
		case "voice":
			ok = m.Type == "voice" || m.Type == "roundVideo"
		case "links":
			ok = m.Type == "text" && (strings.Contains(m.Text, "http://") || strings.Contains(m.Text, "https://"))
		}
		if ok {
			out = append(out, m)
		}
	}
	total := len(out)
	if offset > len(out) {
		offset = len(out)
	}
	out = out[offset:]
	if len(out) > limit {
		out = out[:limit]
	}
	return out, total, nil
}

func (r fakeMsgs) ByPollID(_ context.Context, pollID int64) ([]domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.Message
	for _, all := range r.s.messages {
		for _, m := range all {
			if m.PollID != nil && *m.PollID == pollID && !m.Deleted {
				out = append(out, m)
			}
		}
	}
	return out, nil
}

func (r fakeMsgs) GlobalSearchMessages(_ context.Context, userID int64, q, filter string, offset, limit int) ([]domain.Message, int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var hits []domain.Message
	for chatID, all := range r.s.messages {
		if r.s.members[chatID][userID] == nil {
			continue
		}
		for _, m := range all {
			if m.Deleted {
				continue
			}
			if q != "" && !strings.Contains(strings.ToLower(m.Text), strings.ToLower(q)) {
				continue
			}
			switch filter {
			case "":
			case "media":
				if m.Type != "photo" && m.Type != "video" {
					continue
				}
			case "files":
				if m.Type != "document" {
					continue
				}
			case "music":
				if m.Type != "audio" {
					continue
				}
			case "voice":
				if m.Type != "voice" && m.Type != "roundVideo" {
					continue
				}
			case "links":
				if m.Type != "text" || !strings.Contains(m.Text, "http") {
					continue
				}
			default:
				continue
			}
			hits = append(hits, m)
		}
	}
	sort.Slice(hits, func(a, b int) bool { return hits[a].ID > hits[b].ID })
	count := len(hits)
	if offset > len(hits) {
		offset = len(hits)
	}
	hits = hits[offset:]
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return hits, count, nil
}

func (r fakeMsgs) SearchMessages(_ context.Context, chatID int64, q string, offset, limit int) ([]domain.Message, int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var hits []domain.Message
	all := r.s.messages[chatID]
	for i := len(all) - 1; i >= 0; i-- { // newest first
		m := all[i]
		if !m.Deleted && q != "" && strings.Contains(strings.ToLower(m.Text), strings.ToLower(q)) {
			hits = append(hits, m)
		}
	}
	count := len(hits)
	if offset > len(hits) {
		offset = len(hits)
	}
	hits = hits[offset:]
	if limit > 0 && len(hits) > limit {
		hits = hits[:limit]
	}
	return hits, count, nil
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

func (r fakeMsgs) UpdateText(_ context.Context, msgID int64, text string, entities []domain.MessageEntity) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	now := time.Now()
	for chatID, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID {
				m.Text = text
				m.Entities = entities
				m.EditedAt = &now
				r.s.messages[chatID][idx] = m
				return m, nil
			}
		}
	}
	return domain.Message{}, domain.ErrNotFound
}

func (r fakeMsgs) UpdateReplyMarkup(_ context.Context, msgID int64, markup *domain.ReplyMarkup) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	now := time.Now()
	for chatID, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID {
				m.ReplyMarkup = markup
				m.EditedAt = &now
				r.s.messages[chatID][idx] = m
				return m, nil
			}
		}
	}
	return domain.Message{}, domain.ErrNotFound
}

func (r fakeMsgs) UpdateGeoLive(_ context.Context, msgID int64, lat, lng float64, heading *int, stopped bool) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	now := time.Now()
	for chatID, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID {
				m.GeoLat, m.GeoLng = &lat, &lng
				m.GeoHeading, m.GeoLiveStopped = heading, stopped
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

func (r fakeMsgs) SetDestructOnRead(_ context.Context, chatID, readerID, readSeq int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	r.s.destructCalls = append(r.s.destructCalls, destructCall{chatID, readerID, readSeq})
	return nil
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

func (r fakeMsgs) GetHistory(_ context.Context, chatID, userID, offsetSeq int64, addOffset, limit int, _ *int64, clearedSeq int64) ([]domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	all := r.s.messages[chatID]
	isHidden := func(m domain.Message) bool {
		if m.Deleted {
			return true // deleted messages are never returned
		}
		if m.Seq <= clearedSeq {
			return true // «очищено» у себя: за персональным горизонтом
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

func (r fakeMsgs) RegisterChannelViews(_ context.Context, chatID, userID, upToSeq int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if r.s.chatType[chatID] != "channel" {
		return nil
	}
	for idx, m := range r.s.messages[chatID] {
		if m.Seq > upToSeq || m.Deleted {
			continue
		}
		if r.s.viewed[m.ID] == nil {
			r.s.viewed[m.ID] = map[int64]bool{}
		}
		if r.s.viewed[m.ID][userID] {
			continue
		}
		r.s.viewed[m.ID][userID] = true
		r.s.messages[chatID][idx].Views++
	}
	return nil
}

func (r fakeMsgs) ClearMediaUnread(_ context.Context, msgID int64) (bool, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for chatID, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID {
				changed := m.MediaUnread
				r.s.messages[chatID][idx].MediaUnread = false
				return changed, nil
			}
		}
	}
	return false, nil
}

func (r fakeMsgs) ViewCounts(_ context.Context, ids []int64) (map[int64]int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	want := map[int64]bool{}
	for _, id := range ids {
		want[id] = true
	}
	out := map[int64]int64{}
	for _, msgs := range r.s.messages {
		for _, m := range msgs {
			if want[m.ID] {
				out[m.ID] = m.Views
			}
		}
	}
	return out, nil
}

func (r fakeMsgs) IncrementForwards(_ context.Context, msgID int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for chatID, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID {
				r.s.messages[chatID][idx].Forwards++
				return nil
			}
		}
	}
	return nil
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

func (r fakeReactions) ReactionsFor(_ context.Context, messageIDs []int64, viewerID int64) (map[int64][]domain.ReactionCount, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	res := map[int64][]domain.ReactionCount{}
	for _, messageID := range messageIDs {
		counts := map[string]int{}
		mine := map[string]bool{}
		for userID, emojis := range r.s.reactions[messageID] {
			for e := range emojis {
				counts[e]++
				if userID == viewerID {
					mine[e] = true
				}
			}
		}
		var out []domain.ReactionCount
		for e, c := range counts {
			out = append(out, domain.ReactionCount{Emoji: e, Count: c, Mine: mine[e]})
		}
		sort.Slice(out, func(i, j int) bool {
			if out[i].Count != out[j].Count {
				return out[i].Count > out[j].Count
			}
			return out[i].Emoji < out[j].Emoji
		})
		if len(out) > 0 {
			res[messageID] = out
		}
	}
	return res, nil
}

// ---- MediaAccessRepo ----

type fakeMedia struct{ s *store }

func (r fakeMedia) DimsByIDs(_ context.Context, _ []int64) (map[int64]MediaDims, error) {
	return map[int64]MediaDims{}, nil
}

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

// fakeSecretRepo — in-memory SecretRepo (одна запись на chatID).
type fakeSecretRepo struct {
	mu  sync.Mutex
	rec map[int64]domain.SecretChat
}

func (f *fakeSecretRepo) Create(_ context.Context, sc domain.SecretChat) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.rec == nil {
		f.rec = map[int64]domain.SecretChat{}
	}
	f.rec[sc.ChatID] = sc
	return nil
}

func (f *fakeSecretRepo) Accept(_ context.Context, chatID int64, responderPub []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	sc, ok := f.rec[chatID]
	if !ok {
		return domain.ErrNotFound
	}
	sc.ResponderPub = responderPub
	sc.State = domain.SecretAccepted
	f.rec[chatID] = sc
	return nil
}

func (f *fakeSecretRepo) SetState(_ context.Context, chatID int64, state string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	sc, ok := f.rec[chatID]
	if !ok {
		return domain.ErrNotFound
	}
	sc.State = state
	f.rec[chatID] = sc
	return nil
}

func (f *fakeSecretRepo) Get(_ context.Context, chatID int64) (domain.SecretChat, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	sc, ok := f.rec[chatID]
	if !ok {
		return domain.SecretChat{}, domain.ErrNotFound
	}
	return sc, nil
}

// newSecretTestInteractor wires the interactor with an in-memory SecretRepo.
func newSecretTestInteractor(t *testing.T) (*Interactor, *fakeSecretRepo) {
	s := newStore()
	fs := &fakeSecretRepo{}
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	in.SetSecret(fs)
	return in, fs
}

// Автоудаление: держим период в store, чтобы юнит-тесты могли его проверять.
func (r fakeChats) SetAutoDelete(_ context.Context, chatID int64, seconds int) error {
	if r.s.autoDelete == nil {
		r.s.autoDelete = map[int64]int{}
	}
	r.s.autoDelete[chatID] = seconds
	return nil
}

func (r fakeChats) UserAutoDelete(_ context.Context, userID int64) (int, error) {
	return r.s.userAutoDelete[userID], nil
}

func (r fakeChats) SetUserAutoDelete(_ context.Context, userID int64, seconds int) error {
	if r.s.userAutoDelete == nil {
		r.s.userAutoDelete = map[int64]int{}
	}
	r.s.userAutoDelete[userID] = seconds
	return nil
}

func (r fakeMsgs) ExpiredMessages(context.Context, int) ([]domain.Message, error) { return nil, nil }
