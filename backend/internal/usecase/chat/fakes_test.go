package chat

import (
	"context"
	"encoding/json"
	"errors"
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
	lastReadAt  time.Time
	clearedSeq  int64
	unread      int
	mentions    int
	reactions   int
	// mutedUntil — срок мьюта, а не булево: «навсегда» это domain.MuteUntilForever.
	mutedUntil *time.Time
}

// mentionRow mirrors a message_mentions row in the fake store.
type mentionRow struct {
	chatID, msgID, seq, userID int64
}

// readMark — одна отметка продвижения горизонта чтения (chat_read_marks).
type readMark struct {
	upToSeq int64
	at      time.Time
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
	mediaDims  map[int64]MediaDims                 // mediaID -> мета медиа (read model)
	reactions  map[int64]map[int64]map[string]bool // msgID -> userID -> emoji set
	hidden     map[int64]map[int64]bool            // userID -> msgID -> hidden ("delete for me")
	pins       map[int64][]int64                   // chatID -> pinned msgIDs (newest first)
	viewed     map[int64]map[int64]bool            // msgID -> userID -> viewed (channel view dedup)
	mentions   []mentionRow                        // message_mentions rows
	readMarks  map[int64]map[int64][]readMark      // chatID -> userID -> история горизонта чтения

	// discussionChat — channelID -> текущая привязанная группа обсуждения
	// (chats.discussion_chat_id в реальной БД); 0/отсутствие — не привязана.
	// Заполняется тестами напрямую (seedDiscussion), как и chatType.
	discussionChat map[int64]int64

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
		chatType:       map[int64]string{},
		chatSeq:        map[int64]int64{},
		members:        map[int64]map[int64]*member{},
		messages:       map[int64][]domain.Message{},
		owners:         map[int64]int64{},
		mediaDims:      map[int64]MediaDims{},
		reactions:      map[int64]map[int64]map[string]bool{},
		viewed:         map[int64]map[int64]bool{},
		pts:            map[int64]int64{},
		date:           map[int64]int64{},
		updates:        map[int64][]domain.Update{},
		discussionChat: map[int64]int64{},
	}
}

// seedDiscussion привязывает к каналу группу обсуждения (эквивалент
// chats.discussion_chat_id=groupID в реальной БД) — нужно для MirrorByPost/
// MirrorsByPosts, которые резолвят зеркало только в ТЕКУЩЕЙ группе канала.
func (s *store) seedDiscussion(channelID, groupID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.discussionChat[channelID] = groupID
}

// seedChat заводит чат заданного типа с участниками (эквивалент строки в chats
// + строк в chat_members).
func (s *store) seedChat(chatID int64, typ string, members ...int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.chatType[chatID] = typ
	s.chatSeq[chatID] = 0
	m := map[int64]*member{}
	for _, uid := range members {
		m[uid] = &member{}
	}
	s.members[chatID] = m
}

func (s *store) seedMedia(mediaID, ownerID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.owners[mediaID] = ownerID
}

// seedMediaDims задаёт мету медиа, которую read-модель подмешивает в сообщение
// (hydrateMedia). Без неё DimsByIDs ничего не возвращает — как для необработанного медиа.
func (s *store) seedMediaDims(mediaID int64, d MediaDims) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mediaDims[mediaID] = d
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

func (r fakeChats) ListDialogs(_ context.Context, userID int64) ([]domain.DialogRecord, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.DialogRecord
	for cid, m := range r.s.members {
		mem := m[userID]
		if mem == nil {
			continue
		}
		var until time.Time
		if mem.mutedUntil != nil {
			until = *mem.mutedUntil
		}
		d := domain.DialogRecord{
			ChatID:               cid,
			Type:                 r.s.chatType[cid],
			LastReadSeq:          mem.lastReadSeq,
			UnreadCount:          mem.unread,
			UnreadMentionsCount:  mem.mentions,
			UnreadReactionsCount: mem.reactions,
			NotifySettings:       domain.NewPeerNotifySettings(until, nil, nil),
		}
		// Последнее сообщение адресуется ЧИСЛОМ: сам объект едет вектором
		// messages контейнера, а не выжимкой внутри строки диалога. Очистка
		// истории учитывается так же, как в SQL (seq > cleared_max_seq).
		for i := len(r.s.messages[cid]) - 1; i >= 0; i-- {
			if last := r.s.messages[cid][i]; last.Seq > mem.clearedSeq {
				// Ключ строки и НОМЕР едут из одной строки выборки: собирать
				// номер поиском по загруженным сообщениям нельзя — промах дал бы
				// 0, то есть «самое новое».
				d.TopMessageID, d.TopMessageSeq = last.ID, last.Seq
				break
			}
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

func (r fakeChats) IncUnread(_ context.Context, chatID, userID int64) (int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if m := r.s.members[chatID][userID]; m != nil {
		m.unread++
		return m.unread, nil
	}
	return 0, nil
}

func (r fakeChats) IncUnreadBulk(_ context.Context, chatID int64, userIDs []int64) (map[int64]int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	out := make(map[int64]int64, len(userIDs))
	for _, uid := range userIDs {
		if m := r.s.members[chatID][uid]; m != nil {
			m.unread++
			out[uid] = int64(m.unread)
		}
	}
	return out, nil
}

func (r fakeChats) IncUnreadReactions(_ context.Context, chatID, userID int64) (int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if m := r.s.members[chatID][userID]; m != nil {
		m.reactions++
		return m.reactions, nil
	}
	return 0, nil
}

func (r fakeChats) ClearUnreadReactions(_ context.Context, chatID, userID int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if m := r.s.members[chatID][userID]; m != nil {
		m.reactions = 0
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
		if seq > m.lastReadSeq {
			m.lastReadAt = time.Now()
		}
		m.lastReadSeq = seq
		m.unread = unread
	}
	return nil
}

func (r fakeChats) AppendReadMark(_ context.Context, chatID, userID, upToSeq int64) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	if r.s.readMarks == nil {
		r.s.readMarks = map[int64]map[int64][]readMark{}
	}
	if r.s.readMarks[chatID] == nil {
		r.s.readMarks[chatID] = map[int64][]readMark{}
	}
	r.s.readMarks[chatID][userID] = append(r.s.readMarks[chatID][userID], readMark{upToSeq: upToSeq, at: time.Now()})
	return nil
}

func (r fakeChats) ReadAtForSeq(_ context.Context, chatID, userID, seq int64) (time.Time, bool, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var best *readMark
	for i := range r.s.readMarks[chatID][userID] {
		m := &r.s.readMarks[chatID][userID][i]
		if m.upToSeq >= seq && (best == nil || m.upToSeq < best.upToSeq) {
			best = m
		}
	}
	if best == nil {
		return time.Time{}, false, nil
	}
	return best.at, true, nil
}

func (r fakeChats) LastReadAt(_ context.Context, chatID, userID int64) (time.Time, bool, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	m := r.s.members[chatID][userID]
	if m == nil {
		return time.Time{}, false, domain.ErrNotFound
	}
	if m.lastReadAt.IsZero() {
		return time.Time{}, false, nil
	}
	return m.lastReadAt, true, nil
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

func (r fakeChats) NextMention(_ context.Context, chatID, userID, afterSeq int64) (int64, error) {
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
		return 0, domain.ErrNotFound
	}
	return best.seq, nil
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

// racyMirrorMsgs оборачивает fakeMsgs и имитирует проигрыш гонки за создание
// зеркала поста: следующая вставка зеркала (IsDiscussionMirror) сначала
// молча кладёт строку в стор — как будто её только что успел вставить
// параллельный «победитель» — а самому вызывающему возвращает ошибку, как
// это делает уникальный индекс uq_messages_discussion_mirror в реальной БД
// при конфликте. Нужен TestPostComment_RaceLazyMirror_UsesWinnersMirror.
type racyMirrorMsgs struct {
	fakeMsgs
	failNextMirrorInsert *bool
}

var errMirrorConflict = errors.New("conflict: uq_messages_discussion_mirror")

func (r racyMirrorMsgs) Insert(ctx context.Context, m domain.Message) (domain.Message, error) {
	if m.IsDiscussionMirror && r.failNextMirrorInsert != nil && *r.failNextMirrorInsert {
		*r.failNextMirrorInsert = false
		if _, err := r.fakeMsgs.Insert(ctx, m); err != nil {
			return domain.Message{}, err
		}
		return domain.Message{}, errMirrorConflict
	}
	return r.fakeMsgs.Insert(ctx, m)
}

func (r fakeMsgs) SetWebPage(_ context.Context, msgID int64, wp *domain.WebPagePreview) error {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for cid, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID && !m.Deleted {
				r.s.messages[cid][idx].WebPage = wp
				return nil
			}
		}
	}
	return nil
}

func (r fakeMsgs) SetFactCheck(_ context.Context, msgID int64, fc *domain.FactCheck) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for cid, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID && !m.Deleted {
				r.s.messages[cid][idx].FactCheck = fc
				return r.s.messages[cid][idx], nil
			}
		}
	}
	return domain.Message{}, domain.ErrNotFound
}

func (r fakeMsgs) SetTranscription(_ context.Context, msgID int64, text string) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for cid, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID && !m.Deleted {
				r.s.messages[cid][idx].Transcription = &text
				return r.s.messages[cid][idx], nil
			}
		}
	}
	return domain.Message{}, domain.ErrNotFound
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

func (r fakeMsgs) CallLog(context.Context, int64, int, int) ([]domain.CallLogEntry, error) {
	return nil, nil
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

func (r fakeMsgs) ByChecklistID(_ context.Context, checklistID int64) ([]domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.Message
	for _, all := range r.s.messages {
		for _, m := range all {
			if m.ChecklistID != nil && *m.ChecklistID == checklistID && !m.Deleted {
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

func (r fakeMsgs) SearchMessages(_ context.Context, chatID int64, q string, f SearchFilter, offset, limit int) ([]domain.Message, int, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var hits []domain.Message
	all := r.s.messages[chatID]
	for i := len(all) - 1; i >= 0; i-- { // newest first
		m := all[i]
		if m.Deleted {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(m.Text), strings.ToLower(q)) {
			continue
		}
		if f.SenderID != 0 && m.SenderID != f.SenderID {
			continue
		}
		switch f.MediaType {
		case "":
		case "photo":
			if m.Type != "photo" {
				continue
			}
		case "video":
			if m.Type != "video" {
				continue
			}
		case "voice":
			if m.Type != "voice" {
				continue
			}
		case "roundvideo":
			if m.Type != "roundVideo" {
				continue
			}
		case "file":
			if m.Type != "document" {
				continue
			}
		case "music":
			if m.Type != "audio" {
				continue
			}
		case "link":
			if m.Type != "text" || !strings.Contains(m.Text, "http") {
				continue
			}
		default:
			continue
		}
		if f.Reaction != "" {
			has := false
			for _, emojis := range r.s.reactions[m.ID] {
				if emojis[f.Reaction] {
					has = true
					break
				}
			}
			if !has {
				continue
			}
		}
		hits = append(hits, m)
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

func (r fakeMsgs) CalendarMonth(_ context.Context, chatID int64, from, to time.Time) ([]domain.CalendarDay, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.CalendarDay
	seen := map[string]bool{}
	for _, m := range r.s.messages[chatID] {
		if m.Deleted || m.MediaID == nil || m.CreatedAt.Before(from) || !m.CreatedAt.Before(to) {
			continue
		}
		day := m.CreatedAt.UTC().Truncate(24 * time.Hour)
		key := day.Format("2006-01-02")
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, domain.CalendarDay{Day: day, Seq: m.Seq, MediaID: *m.MediaID, Type: m.Type})
	}
	return out, nil
}

func (r fakeMsgs) MessageSeqByDate(_ context.Context, chatID int64, from time.Time) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	all := r.s.messages[chatID]
	var earliest, newest int64
	for _, m := range all {
		if m.Deleted {
			continue
		}
		if m.Seq > newest {
			newest = m.Seq
		}
		if !m.CreatedAt.Before(from) && (earliest == 0 || m.Seq < earliest) {
			earliest = m.Seq
		}
	}
	if earliest != 0 {
		return earliest, nil
	}
	if newest != 0 {
		return newest, nil
	}
	return 0, domain.ErrNotFound
}

// IDBySeq/IDsBySeqs/SeqsByIDs/GetBySeqs — слой адресации: снаружи сообщение
// адресуется парой «пир + номер», внутри живёт ключ строки (msgaddr.go).
func (r fakeMsgs) IDBySeq(_ context.Context, chatID, seq int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for _, m := range r.s.messages[chatID] {
		if m.Seq == seq {
			return m.ID, nil
		}
	}
	return 0, domain.ErrNotFound
}

func (r fakeMsgs) IDsBySeqs(_ context.Context, chatID int64, seqs []int64) (map[int64]int64, error) {
	want := map[int64]bool{}
	for _, s := range seqs {
		want[s] = true
	}
	out := map[int64]int64{}
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for _, m := range r.s.messages[chatID] {
		if want[m.Seq] {
			out[m.Seq] = m.ID
		}
	}
	return out, nil
}

func (r fakeMsgs) SeqsByIDs(_ context.Context, ids []int64) (map[int64]int64, error) {
	want := map[int64]bool{}
	for _, id := range ids {
		want[id] = true
	}
	out := map[int64]int64{}
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	for _, msgs := range r.s.messages {
		for _, m := range msgs {
			if want[m.ID] {
				out[m.ID] = m.Seq
			}
		}
	}
	return out, nil
}

func (r fakeMsgs) GetBySeqs(_ context.Context, chatID int64, seqs []int64) ([]domain.Message, error) {
	want := map[int64]bool{}
	for _, s := range seqs {
		want[s] = true
	}
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.Message
	for _, m := range r.s.messages[chatID] {
		if want[m.Seq] {
			out = append(out, m)
		}
	}
	return out, nil
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

func (r fakeMsgs) UpdateText(_ context.Context, msgID int64, text string, entities domain.MessageEntities) (domain.Message, error) {
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

func (r fakeMsgs) UpdateAction(_ context.Context, msgID int64, action domain.MessageAction) (domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	now := time.Now()
	for chatID, msgs := range r.s.messages {
		for idx, m := range msgs {
			if m.ID == msgID {
				m.Action = action
				m.EditedAt = &now
				r.s.messages[chatID][idx] = m
				return m, nil
			}
		}
	}
	return domain.Message{}, domain.ErrNotFound
}

func (r fakeMsgs) UpdateReplyMarkup(_ context.Context, msgID int64, markup domain.ReplyMarkup) (domain.Message, error) {
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

func (r fakeMsgs) GetHistory(_ context.Context, chatID, userID, offsetSeq int64, addOffset, limit int, _ *int64, clearedSeq int64, tag string) ([]domain.Message, error) {
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
		// Фильтр «Избранного» по тегу-реакции: оставляем помеченные зрителем tag.
		if tag != "" {
			if _, ok := r.s.reactions[m.ID][userID][tag]; !ok {
				return true
			}
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

// resolveAlbumRoot возвращает id, на зеркало которого должен резолвиться
// postID: если пост — элемент альбома (общий grouped_id), это id ПЕРВОГО
// (минимального) элемента группы среди сообщений канала channelID; если нет
// — id самого поста без изменений. Тред у альбома один — на зеркале первого
// элемента, как getMainGroupedMessage в tweb (см. MessagesRepo.MirrorByPost).
// Сознательно БЕЗ фильтра по m.Deleted при поиске минимума — та же политика
// стабильности корня, что и в Postgres-версии (см. её комментарий): корень
// не «переезжает», если первый элемент альбома потом удалили.
// Вызывается уже под r.s.mu — своей блокировки не берёт.
func (r fakeMsgs) resolveAlbumRoot(channelID, postID int64) int64 {
	var grouped *int64
	for _, m := range r.s.messages[channelID] {
		if m.ID == postID {
			grouped = m.GroupedID
			break
		}
	}
	if grouped == nil {
		return postID
	}
	root := int64(0)
	for _, m := range r.s.messages[channelID] {
		if m.GroupedID != nil && *m.GroupedID == *grouped && (root == 0 || m.ID < root) {
			root = m.ID
		}
	}
	return root
}

// MirrorByPost ищет зеркало ТОЛЬКО в текущей группе обсуждения канала
// (discussionChat[channelID]) — сообщение с IsDiscussionMirror и совпадающими
// FwdFromChatID/FwdFromMsgID. Зеркало в старой (отвязанной) группе обсуждения
// найдено быть не должно — эквивалент SQL-версии MessagesRepo.MirrorByPost,
// которая ограничивает выборку chat_id=(SELECT discussion_chat_id ...).
// Для элемента альбома резолвится зеркало корня группы (resolveAlbumRoot).
func (r fakeMsgs) MirrorByPost(_ context.Context, channelID, postID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	discID, ok := r.s.discussionChat[channelID]
	if !ok || discID == 0 {
		return 0, nil
	}
	root := r.resolveAlbumRoot(channelID, postID)
	for _, m := range r.s.messages[discID] {
		if m.IsDiscussionMirror && !m.Deleted &&
			m.FwdFromChatID != nil && *m.FwdFromChatID == channelID &&
			m.FwdFromMsgID != nil && *m.FwdFromMsgID == root {
			return m.ID, nil
		}
	}
	return 0, nil
}

// MirrorOfExactPost — как MirrorByPost, но БЕЗ resolveAlbumRoot: ищет
// строку-зеркало строго этого postID. См. комментарий у Postgres-версии про
// то, зачем mirrorChannelPost нужна именно эта, не коллапсирующая, проверка
// идемпотентности.
func (r fakeMsgs) MirrorOfExactPost(_ context.Context, channelID, postID int64) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	discID, ok := r.s.discussionChat[channelID]
	if !ok || discID == 0 {
		return 0, nil
	}
	for _, m := range r.s.messages[discID] {
		if m.IsDiscussionMirror && !m.Deleted &&
			m.FwdFromChatID != nil && *m.FwdFromChatID == channelID &&
			m.FwdFromMsgID != nil && *m.FwdFromMsgID == postID {
			return m.ID, nil
		}
	}
	return 0, nil
}

// MirrorsByPosts — батч-версия MirrorByPost, той же ограничивающей логики
// (включая резолв через resolveAlbumRoot): результат ключуется исходным
// postID, но найден по зеркалу корня его альбома.
func (r fakeMsgs) MirrorsByPosts(_ context.Context, channelID int64, postIDs []int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	if len(postIDs) == 0 {
		return out, nil
	}
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	discID, ok := r.s.discussionChat[channelID]
	if !ok || discID == 0 {
		return out, nil
	}
	roots := make(map[int64]int64, len(postIDs))
	for _, id := range postIDs {
		roots[id] = r.resolveAlbumRoot(channelID, id)
	}
	mirrorByRoot := map[int64]int64{}
	for _, m := range r.s.messages[discID] {
		if m.IsDiscussionMirror && !m.Deleted &&
			m.FwdFromChatID != nil && *m.FwdFromChatID == channelID && m.FwdFromMsgID != nil {
			mirrorByRoot[*m.FwdFromMsgID] = m.ID
		}
	}
	for postID, root := range roots {
		if mirror, ok := mirrorByRoot[root]; ok {
			out[postID] = mirror
		}
	}
	return out, nil
}

// AlbumMessages — см. комментарий у Postgres-версии (messagesrepo.go): все
// сообщения альбома в чате, по возрастанию id, БЕЗ фильтра по Deleted (та же
// политика, что и у resolveAlbumRoot — стабильность корня треда важнее).
// r.s.messages[chatID] уже упорядочен по возрастанию ID (Insert только
// добавляет в конец под общим счётчиком r.s.nextMsgID), досортировывать не
// нужно.
func (r fakeMsgs) AlbumMessages(_ context.Context, chatID int64, groupedID int64) ([]domain.Message, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.Message
	for _, m := range r.s.messages[chatID] {
		if m.GroupedID != nil && *m.GroupedID == groupedID {
			out = append(out, m)
		}
	}
	return out, nil
}

func (r fakeMsgs) RecentThreadRepliers(_ context.Context, chatID int64, rootIDs []int64, limit int) (map[int64][]int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	out := map[int64][]int64{}
	for _, root := range rootIDs {
		seen := map[int64]bool{}
		msgs := r.s.messages[chatID]
		for i := len(msgs) - 1; i >= 0; i-- {
			m := msgs[i]
			if m.ThreadRootID == nil || *m.ThreadRootID != root || m.Deleted || seen[m.SenderID] {
				continue
			}
			seen[m.SenderID] = true
			out[root] = append(out[root], m.SenderID)
			if len(out[root]) >= limit {
				break
			}
		}
	}
	return out, nil
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

func (r fakeUpdates) AppendUpdateBulk(_ context.Context, userIDs []int64, ptsCount int, date int64, typ string, payload json.RawMessage) (map[int64]int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	out := make(map[int64]int64, len(userIDs))
	for _, userID := range userIDs {
		r.s.pts[userID] += int64(ptsCount)
		r.s.date[userID] = date
		newPts := r.s.pts[userID]
		r.s.updates[userID] = append(r.s.updates[userID], domain.Update{
			Pts: newPts, PtsCount: ptsCount, Type: typ, Payload: payload,
		})
		out[userID] = newPts
	}
	return out, nil
}

func (r fakeUpdates) PruneUpdates(_ context.Context, keepPerUser int64, _ int) (int64, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var deleted int64
	for uid, ups := range r.s.updates {
		cur := r.s.pts[uid]
		kept := ups[:0]
		for _, u := range ups {
			if u.Pts > cur-keepPerUser {
				kept = append(kept, u)
			} else {
				deleted++
			}
		}
		r.s.updates[uid] = kept
	}
	return deleted, nil
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

func (r fakeReactions) ReactionUsers(_ context.Context, messageID int64) ([]domain.ReactionUser, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	var out []domain.ReactionUser
	for userID, emojis := range r.s.reactions[messageID] {
		for e := range emojis {
			out = append(out, domain.ReactionUser{User: domain.UserReal{ID: userID}, Emoji: e})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].User.ID != out[j].User.ID {
			return out[i].User.ID < out[j].User.ID
		}
		return out[i].Emoji < out[j].Emoji
	})
	return out, nil
}

// ---- MediaAccessRepo ----

type fakeMedia struct{ s *store }

func (r fakeMedia) DimsByIDs(_ context.Context, ids []int64) (map[int64]MediaDims, error) {
	r.s.mu.Lock()
	defer r.s.mu.Unlock()
	out := map[int64]MediaDims{}
	for _, id := range ids {
		if d, ok := r.s.mediaDims[id]; ok {
			out[id] = d
		}
	}
	return out, nil
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

func (p *fakePublisher) PublishToUsers(_ context.Context, userIDs []int64, frames [][]byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i, userID := range userIDs {
		p.frames = append(p.frames, capturedFrame{userID, append([]byte(nil), frames[i]...)})
	}
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

func (n *fakeNotifier) NotifyNewMessage(_ context.Context, recipientID, _, _, _ int64, _ string, _ domain.PeerID) {
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
func (r fakeChats) SetChatTheme(_ context.Context, _ int64, _ string, _ int64) error { return nil }

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
