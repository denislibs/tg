package chat

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeScheduled — in-memory ScheduledRepo для юнит-тестов. s — стор чатов:
// по нему считается собеседник лички (WhenOnlineWaits).
type fakeScheduled struct {
	mu   sync.Mutex
	next int64
	rows map[int64]domain.ScheduledMessage
	s    *store
	// claims — аренда публикации (claimed_until) по ключу строки; retry —
	// отступ воркера (next_attempt_at).
	claims, retry map[int64]time.Time
	// failReschedule / failDelete — сколько ближайших Reschedule / DeleteIDs
	// вернуть сбоем (сбой завершающей транзакции публикации).
	failReschedule, failDelete int
	// onReschedule — вклинивается перед перепостановкой (гонка с автором).
	onReschedule func()
	// onLockForPublish — вклинивается перед блокировкой строки публикацией.
	onLockForPublish func()
}

func newFakeScheduled() *fakeScheduled {
	return &fakeScheduled{rows: map[int64]domain.ScheduledMessage{}, claims: map[int64]time.Time{}, retry: map[int64]time.Time{}}
}

func (f *fakeScheduled) claimed(id int64) bool {
	until, ok := f.claims[id]
	return ok && until.After(time.Now())
}

// workerReady — вне аренды и вне отступа (выборки воркера).
func (f *fakeScheduled) workerReady(id int64) bool {
	until, ok := f.retry[id]
	return !f.claimed(id) && (!ok || !until.After(time.Now()))
}

func (f *fakeScheduled) Claim(_ context.Context, id int64, sendAt time.Time, whenOnline bool, lease time.Duration, countAttempt bool) (domain.ScheduledMessage, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.rows[id]
	if !ok || f.claimed(id) || m.WhenOnline != whenOnline || (!whenOnline && !m.SendAt.Equal(sendAt)) {
		return domain.ScheduledMessage{}, false, nil
	}
	f.claims[id] = time.Now().Add(lease)
	if countAttempt {
		m.Attempts++
	}
	f.rows[id] = m
	return m, true, nil
}

func (f *fakeScheduled) Release(_ context.Context, id int64, retryAfter time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.claims, id)
	if retryAfter > 0 {
		f.retry[id] = time.Now().Add(retryAfter)
	}
	return nil
}

func (f *fakeScheduled) Reschedule(_ context.Context, id int64, from, to time.Time) (domain.ScheduledMessage, bool, error) {
	if f.onReschedule != nil {
		f.onReschedule()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failReschedule > 0 {
		f.failReschedule--
		return domain.ScheduledMessage{}, false, errors.New("reschedule: injected failure")
	}
	m, ok := f.rows[id]
	if !ok || m.WhenOnline || !m.SendAt.Equal(from) {
		return domain.ScheduledMessage{}, false, nil
	}
	m.SendAt, m.Attempts = to, 0
	m.Occurrence++
	m.PaidStars, m.PaidTo = 0, 0
	f.rows[id] = m
	delete(f.claims, id)
	delete(f.retry, id)
	return m, true, nil
}

func (f *fakeScheduled) DeleteUnclaimed(_ context.Context, ids []int64) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.ScheduledMessage
	for _, id := range ids {
		if m, ok := f.rows[id]; ok && !f.claimed(id) {
			out = append(out, m)
			delete(f.rows, id)
			delete(f.claims, id)
		}
	}
	return out, nil
}

func (f *fakeScheduled) LockForPublish(_ context.Context, id int64) (bool, error) {
	if f.onLockForPublish != nil {
		f.onLockForPublish()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.rows[id]
	return ok, nil
}

func (f *fakeScheduled) TakePaidByChat(_ context.Context, chatID int64) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.ScheduledMessage
	for id, m := range f.rows {
		if m.ChatID == chatID && m.PaidStars > 0 {
			out = append(out, m)
			delete(f.rows, id)
		}
	}
	return out, nil
}

func (f *fakeScheduled) LockQueue(context.Context, int64, int64) error { return nil }

// expireClaims — аренды и отступы истекли (следующая попытка воркера).
func (f *fakeScheduled) expireClaims() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.claims = map[int64]time.Time{}
	f.retry = map[int64]time.Time{}
}

func (f *fakeScheduled) sorted(keep func(domain.ScheduledMessage) bool) []domain.ScheduledMessage {
	var out []domain.ScheduledMessage
	for _, m := range f.rows {
		if keep(m) {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(a, b int) bool { return out[a].ID < out[b].ID })
	return out
}

func (f *fakeScheduled) Create(_ context.Context, m domain.ScheduledMessage) (domain.ScheduledMessage, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if m.ClientMsgID != nil {
		for _, r := range f.rows {
			if r.ChatID == m.ChatID && r.SenderID == m.SenderID && r.ClientMsgID != nil && *r.ClientMsgID == *m.ClientMsgID {
				return r, false, nil
			}
		}
	}
	f.next++
	m.ID = f.next
	m.CreatedAt = time.Now()
	// Снимок едет через jsonb — как в базе.
	raw, _ := json.Marshal(m.Params)
	m.Params = domain.ScheduledParams{}
	_ = json.Unmarshal(raw, &m.Params)
	m.WebPage = nil
	f.rows[m.ID] = m
	return m, true, nil
}

func (f *fakeScheduled) ListByChat(_ context.Context, chatID, senderID int64) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sorted(func(m domain.ScheduledMessage) bool { return m.ChatID == chatID && m.SenderID == senderID }), nil
}

func (f *fakeScheduled) CountByChat(_ context.Context, chatID, senderID int64) (int, error) {
	l, _ := f.ListByChat(context.Background(), chatID, senderID)
	return len(l), nil
}

func (f *fakeScheduled) ByID(_ context.Context, id int64) (domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.rows[id]
	if !ok {
		return domain.ScheduledMessage{}, domain.ErrNotFound
	}
	return m, nil
}

func (f *fakeScheduled) ByClientMsgID(_ context.Context, chatID, senderID int64, cmid string) (domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, r := range f.rows {
		if r.ChatID == chatID && r.SenderID == senderID && r.ClientMsgID != nil && *r.ClientMsgID == cmid {
			return r, nil
		}
	}
	return domain.ScheduledMessage{}, domain.ErrNotFound
}

func (f *fakeScheduled) ByIDs(_ context.Context, chatID, senderID int64, ids []int64) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sorted(func(m domain.ScheduledMessage) bool {
		return m.ChatID == chatID && m.SenderID == senderID && slices.Contains(ids, m.ID)
	}), nil
}

func (f *fakeScheduled) ByGroupedID(_ context.Context, chatID, senderID, groupedID int64) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sorted(func(m domain.ScheduledMessage) bool {
		return m.ChatID == chatID && m.SenderID == senderID && m.Params.GroupedID == groupedID
	}), nil
}

func (f *fakeScheduled) DeleteIDs(_ context.Context, ids []int64) ([]int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failDelete > 0 && len(ids) > 0 {
		f.failDelete--
		return nil, errors.New("delete: injected failure")
	}
	var out []int64
	for _, id := range ids {
		if _, ok := f.rows[id]; ok {
			delete(f.rows, id)
			delete(f.claims, id)
			out = append(out, id)
		}
	}
	return out, nil
}

func (f *fakeScheduled) Due(_ context.Context, now time.Time, limit int) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := f.sorted(func(m domain.ScheduledMessage) bool {
		return !m.WhenOnline && !m.SendAt.After(now) && f.workerReady(m.ID)
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeScheduled) WhenOnlineWaits(_ context.Context) ([]ScheduledWait, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	seen := map[[2]int64]bool{}
	var out []ScheduledWait
	for _, m := range f.sorted(func(m domain.ScheduledMessage) bool { return m.WhenOnline }) {
		k := [2]int64{m.ChatID, m.SenderID}
		if seen[k] {
			continue
		}
		seen[k] = true
		f.s.mu.Lock()
		for uid := range f.s.members[m.ChatID] {
			if uid != m.SenderID {
				out = append(out, ScheduledWait{ChatID: m.ChatID, SenderID: m.SenderID, PeerID: uid})
			}
		}
		f.s.mu.Unlock()
	}
	return out, nil
}

func (f *fakeScheduled) WhenOnlineIn(_ context.Context, chatID, senderID int64) ([]domain.ScheduledMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sorted(func(m domain.ScheduledMessage) bool {
		return m.ChatID == chatID && m.SenderID == senderID && m.WhenOnline && f.workerReady(m.ID)
	}), nil
}

func (f *fakeScheduled) Update(_ context.Context, m domain.ScheduledMessage, oldAt time.Time, oldWhenOnline bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[m.ID]
	if !ok || f.claimed(m.ID) || !cur.SendAt.Equal(oldAt) || cur.WhenOnline != oldWhenOnline {
		return domain.ErrNotFound
	}
	cur.Text, cur.Entities, cur.SendAt, cur.WhenOnline, cur.RepeatPeriod = m.Text, m.Entities, m.SendAt, m.WhenOnline, m.RepeatPeriod
	f.rows[m.ID] = cur
	return nil
}

func (f *fakeScheduled) SetWebPage(_ context.Context, id int64, wp *domain.WebPagePreview) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	cur.WebPage = wp
	f.rows[id] = cur
	return nil
}

func (f *fakeScheduled) SetWebPageIfSame(_ context.Context, id int64, wp *domain.WebPagePreview, text string, entities domain.MessageEntities, choice *domain.WebPageInput) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok || f.claimed(id) || cur.Text != text || !entitiesEqual(cur.Entities, entities) ||
		!reflect.DeepEqual(cur.Params.WebPage, choice) {
		return false, nil
	}
	cur.WebPage = wp
	f.rows[id] = cur
	return true, nil
}

func (f *fakeScheduled) SetWebPageChoice(_ context.Context, id int64, choice *domain.WebPageInput) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	cur.Params.WebPage = choice
	f.rows[id] = cur
	return nil
}

func (f *fakeScheduled) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.rows)
}

func (f *fakeScheduled) set(id int64, mut func(*domain.ScheduledMessage)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	m := f.rows[id]
	mut(&m)
	f.rows[id] = m
}

// fakePresence — управляемый онлайн-статус для тестов диспетчера.
type fakePresence struct{ online map[int64]bool }

func (p fakePresence) IsOnline(_ context.Context, userID int64) (bool, error) {
	return p.online[userID], nil
}

// newScheduledTestInteractor: interactor c fakeChats + fakeScheduled (+publisher).
func newScheduledTestInteractor() (*Interactor, *store, *fakeScheduled) {
	s := newStore()
	fs := newFakeScheduled()
	fs.s = s
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	in.SetScheduled(fs)
	in.SetPublisher(&fakePublisher{})
	return in, s, fs
}

func future() int64 { return time.Now().Add(time.Hour).Unix() }

// logOf — записи журнала пользователя данного типа (тела).
func logOf(s *store, userID int64, typ string) []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []map[string]any
	for _, u := range s.updates[userID] {
		if u.Type != typ {
			continue
		}
		var d map[string]any
		_ = json.Unmarshal(u.Payload, &d)
		out = append(out, d)
	}
	return out
}

func messagesOf(s *store, chatID int64) []domain.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]domain.Message(nil), s.messages[chatID]...)
}

// --- Снимок отправки (A1-10, A3-17) ---

// Тест-скан: каждое публичное поле SendInput переживает «поставить →
// опубликовать» (scheduledRowOf → jsonb → sendInputOf), кроме явного списка
// того, что отложить нельзя вовсе (enqueueScheduled отвергает) или что
// хранится сроком строки. Новое поле отправки без правки снимка уронит тест.
func TestScheduledSnapshot_CoversEverySendInputField(t *testing.T) {
	excluded := map[string]string{
		"Action":       "служебки не откладываются",
		"GiveawayID":   "розыгрыш — только CreateGiveaway",
		"GiftID":       "подарок — только SendGift",
		"ReplyMarkup":  "клавиатура бота",
		"EncBody":      "секретный чат",
		"TTLSeconds":   "секретный чат",
		"ScheduleDate": "срок строки: send_at/when_online",
	}
	var in SendInput
	v := reflect.ValueOf(&in).Elem()
	tp := v.Type()
	for k := 0; k < tp.NumField(); k++ {
		f := tp.Field(k)
		if !f.IsExported() {
			continue
		}
		fillNonZero(t, v.Field(k), f.Name)
	}
	row := scheduledRowOf(in)
	raw, _ := json.Marshal(row.Params)
	row.Params = domain.ScheduledParams{}
	if err := json.Unmarshal(raw, &row.Params); err != nil {
		t.Fatal(err)
	}
	back := sendInputOf(row)
	bv := reflect.ValueOf(back)
	for k := 0; k < tp.NumField(); k++ {
		f := tp.Field(k)
		if !f.IsExported() || excluded[f.Name] != "" {
			continue
		}
		if !reflect.DeepEqual(v.Field(k).Interface(), bv.Field(k).Interface()) {
			t.Errorf("поле SendInput.%s теряется у отложенного: %v → %v", f.Name, v.Field(k).Interface(), bv.Field(k).Interface())
		}
	}
}

func fillNonZero(t *testing.T, f reflect.Value, name string) {
	t.Helper()
	switch f.Kind() {
	case reflect.Int64, reflect.Int:
		f.SetInt(86400)
	case reflect.String:
		f.SetString("v-" + name)
	case reflect.Bool:
		f.SetBool(true)
	case reflect.Ptr:
		p := reflect.New(f.Type().Elem())
		fillNonZero(t, p.Elem(), name)
		f.Set(p)
	case reflect.Float64:
		f.SetFloat(55.5)
	case reflect.Slice:
		if f.Type() == reflect.TypeOf(domain.MessageEntities{}) {
			f.Set(reflect.ValueOf(domain.MessageEntities{domain.NewMessageEntityBold(0, 1)}))
			return
		}
		f.Set(reflect.MakeSlice(f.Type(), 1, 1))
	case reflect.Struct:
		for k := 0; k < f.NumField(); k++ {
			if f.Type().Field(k).IsExported() {
				fillNonZero(t, f.Field(k), name+"."+f.Type().Field(k).Name)
			}
		}
	case reflect.Map:
		m := reflect.MakeMap(f.Type())
		key, val := reflect.New(f.Type().Key()).Elem(), reflect.New(f.Type().Elem()).Elem()
		fillNonZero(t, key, name+"[k]")
		fillNonZero(t, val, name+"[v]")
		m.SetMapIndex(key, val)
		f.Set(m)
	case reflect.Interface:
		// Action/ReplyMarkup — в списке исключений.
	default:
		t.Fatalf("SendInput.%s: вид %s не заполняется тестом — дополни fillNonZero", name, f.Kind())
	}
}

// Постановка проходит ВСЕ гейты Send (НО-4): отказ — сразу, строки нет.
// Прежде гейты срабатывали только при публикации, и отказ молча удалял строку.
func TestScheduled_EnqueueRunsSendGates(t *testing.T) {
	ctx := context.Background()

	t.Run("группа без права писать", func(t *testing.T) {
		in, _, _, id := gateGroup(t)
		fs := newFakeScheduled()
		in.SetScheduled(fs)
		if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms&^domain.PermSendMessages, 0); err != nil {
			t.Fatal(err)
		}
		_, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "x", ScheduleDate: future()})
		if !errors.Is(err, domain.ErrForbidden) || fs.count() != 0 {
			t.Fatalf("err=%v rows=%d, want ErrForbidden и ни одной строки", err, fs.count())
		}
	})

	t.Run("подписчик канала", func(t *testing.T) {
		e := newChannelEnv(t)
		fs := newFakeScheduled()
		e.i.SetScheduled(fs)
		_, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 8, Text: "пост", ScheduleDate: future()})
		if !errors.Is(err, domain.ErrForbidden) || fs.count() != 0 {
			t.Fatalf("err=%v rows=%d, want ErrForbidden", err, fs.count())
		}
	})

	t.Run("блок в личке", func(t *testing.T) {
		in, s, fs := newScheduledTestInteractor()
		cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
		in.SetPrivacy(blockedBy{owner: 2})
		_, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "x", ScheduleDate: future()})
		if !errors.Is(err, domain.ErrPrivacy) || fs.count() != 0 {
			t.Fatalf("err=%v rows=%d, want ErrPrivacy", err, fs.count())
		}
	})

	t.Run("дата в прошлом и чужой период", func(t *testing.T) {
		in, s, fs := newScheduledTestInteractor()
		cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
		if _, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "x", ScheduleDate: time.Now().Add(-time.Minute).Unix()}); !errors.Is(err, domain.ErrInvalid) {
			t.Fatalf("прошлое: %v, want ErrInvalid", err)
		}
		if _, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "x", ScheduleDate: future(), ScheduleRepeatPeriod: 3600}); !errors.Is(err, domain.ErrInvalid) {
			t.Fatalf("период 3600: %v, want ErrInvalid", err)
		}
		if fs.count() != 0 {
			t.Fatalf("строк %d, want 0", fs.count())
		}
	})
}

// Публикация несёт снимок целиком: альбом (группой, по одному ключу), эффект,
// спойлер, цитата, гео-venue, тишина, from_scheduled; send_now одного элемента
// альбома публикует весь альбом (tweb contextMenu.ts:2042-2048).
func TestScheduled_PublishKeepsSnapshotAndAlbum(t *testing.T) {
	in, _, s, id := gateGroup(t)
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	orig, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "исходный текст"})
	if err != nil {
		t.Fatal(err)
	}
	notif := &fakeNotifier{}
	in.SetNotifier(notif)
	s.mu.Lock()
	s.owners[101], s.owners[102] = 8, 8
	s.mu.Unlock()
	quote, off := "текст", 9
	date := future()
	var ids []int64
	for _, media := range []int64{101, 102} {
		m := media
		sm, err := in.Send(ctx, SendInput{
			ChatID: id, SenderID: 8, Type: "photo", MediaID: &m, GroupedID: 555, MediaSpoiler: true,
			Effect: "fireworks", Silent: true, ReplyToID: &orig.Seq, ReplyQuoteText: &quote, ReplyQuoteOffset: &off,
			ScheduleDate: date,
		})
		if err != nil {
			t.Fatalf("постановка элемента альбома: %v", err)
		}
		ids = append(ids, sm.Seq)
	}
	title := "Кремль"
	geo, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Type: "geo", GeoLat: f64(55.75), GeoLng: f64(37.62), GeoTitle: &title, ScheduleDate: date})
	if err != nil {
		t.Fatal(err)
	}
	before := len(messagesOf(s, id))

	if _, err := in.SendScheduledNow(ctx, id, 8, []int64{ids[1]}); err != nil {
		t.Fatalf("send_now: %v", err)
	}
	got := messagesOf(s, id)[before:]
	if len(got) != 2 {
		t.Fatalf("опубликовано %d, want весь альбом (2)", len(got))
	}
	for _, m := range got {
		if m.GroupedID == nil || *m.GroupedID != 555 || !m.MediaSpoiler || m.Effect != "fireworks" || !m.FromScheduled ||
			m.ReplyQuoteText == nil || *m.ReplyQuoteText != quote || m.ReplyToID == nil || *m.ReplyToID != orig.Seq {
			t.Fatalf("снимок потерян при публикации: %+v", m)
		}
	}
	if len(notif.recipients) != 0 {
		t.Fatalf("тихое отложенное дало пуш: %v", notif.recipients)
	}
	if _, err := in.SendScheduledNow(ctx, id, 8, []int64{geo.Seq}); err != nil {
		t.Fatal(err)
	}
	last := messagesOf(s, id)
	g := last[len(last)-1]
	if g.Type != "geo" || g.GeoTitle == nil || *g.GeoTitle != title || g.GeoLat == nil {
		t.Fatalf("venue потерян: %+v", g)
	}
	if fs.count() != 0 {
		t.Fatalf("строки не сняты: %d", fs.count())
	}
}

// --- Кадры (A2-18) ---

// Постановка, удаление, публикация и отказ при публикации пишут в журнал
// автора ровно свой кадр; собеседник их не получает.
func TestScheduled_FramesToAuthorOnly(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)

	a, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "a", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "b", ScheduleDate: future()})
	c, _ := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "c", ScheduleDate: future()})
	news := logOf(s, 1, scheduledNewFrame)
	if len(news) != 3 {
		t.Fatalf("scheduled_new в журнале автора: %d, want 3", len(news))
	}
	msg := news[0]["message"].(map[string]any)
	if news[0]["_"] != domain.UpdateNewScheduledMessageTag || msg["message"] != "a" ||
		msg["pFlags"].(map[string]any)["is_scheduled"] != true {
		t.Fatalf("тело постановки: %v", news[0])
	}

	if _, err := in.DeleteScheduled(ctx, cid, 1, []int64{a.Seq}); err != nil {
		t.Fatal(err)
	}
	dels := logOf(s, 1, scheduledDeleteFrame)
	if len(dels) != 1 || dels[0]["_"] != domain.UpdateDeleteScheduledMessagesTag || dels[0]["sent_messages"] != nil {
		t.Fatalf("удаление: %v", dels)
	}

	if _, err := in.SendScheduledNow(ctx, cid, 1, []int64{b.Seq}); err != nil {
		t.Fatal(err)
	}
	dels = logOf(s, 1, scheduledDeleteFrame)
	published := messagesOf(s, cid)
	sent, _ := dels[1]["sent_messages"].([]any)
	if len(dels) != 2 || len(sent) != 1 || int64(sent[0].(float64)) != published[len(published)-1].Seq {
		t.Fatalf("публикация: %v (опубликовано %+v)", dels, published)
	}

	// Отказ при публикации (автора нет в чате) — строка снята, кадр без sent_messages.
	s.mu.Lock()
	delete(s.members[cid], 1)
	s.mu.Unlock()
	fs.set(c.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Second) })
	if n, err := in.DispatchDueScheduled(ctx); err != nil || n != 0 {
		t.Fatalf("dispatch: n=%d err=%v", n, err)
	}
	dels = logOf(s, 1, scheduledDeleteFrame)
	if len(dels) != 3 || dels[2]["sent_messages"] != nil || fs.count() != 0 {
		t.Fatalf("отказ при публикации: %v rows=%d", dels, fs.count())
	}

	for _, typ := range []string{scheduledNewFrame, scheduledDeleteFrame} {
		if len(logOf(s, 2, typ)) != 0 {
			t.Fatalf("%s ушёл собеседнику", typ)
		}
	}
}

// НО-8: повтор кадра отправки с тем же client_msg_id не плодит строку и кадр.
func TestScheduled_ClientMsgIDIdempotent(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	date := future()
	first, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "x", ClientMsgID: "c-1", ScheduleDate: date})
	if err != nil {
		t.Fatal(err)
	}
	again, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "x", ClientMsgID: "c-1", ScheduleDate: date})
	if err != nil || again.Seq != first.Seq || fs.count() != 1 || len(logOf(s, 1, scheduledNewFrame)) != 1 {
		t.Fatalf("повтор: err=%v id %d/%d rows=%d", err, again.Seq, first.Seq, fs.count())
	}
}

// В-6: лимит очереди — 100 на чат (Telegram SCHEDULE_TOO_MUCH).
func TestScheduled_LimitPerChat(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	other, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)
	for k := 0; k < maxScheduledPerChat; k++ {
		_, _, _ = fs.Create(ctx, domain.ScheduledMessage{ChatID: cid, SenderID: 1, Type: "text", Text: "x", SendAt: time.Now().Add(time.Hour)})
	}
	if _, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "101", ScheduleDate: future()}); !errors.Is(err, domain.ErrScheduleTooMuch) {
		t.Fatalf("101-е: %v, want ErrScheduleTooMuch", err)
	}
	if fs.count() != maxScheduledPerChat {
		t.Fatalf("строк %d, want %d", fs.count(), maxScheduledPerChat)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: other, SenderID: 1, Text: "в другой чат", ScheduleDate: future()}); err != nil {
		t.Fatalf("лимит — на чат, а не на пользователя: %v", err)
	}
}

// --- Черновик (A3-16) ---

// Постановка снимает черновик (clear_draft в том же запросе у tweb), а
// публикация — нет: к моменту отправки в поле уже другой текст.
func TestScheduled_DraftClearedOnEnqueueKeptOnPublish(t *testing.T) {
	in, s, _ := newScheduledTestInteractor()
	drafts := newFakeDrafts()
	in.SetDrafts(drafts)
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	_, _ = drafts.Upsert(ctx, 1, domain.Draft{ChatID: cid, Text: "черновик"})
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "потом", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := drafts.m[[3]int64{cid, 1, 0}]; ok {
		t.Fatal("постановка не сняла черновик")
	}
	_, _ = drafts.Upsert(ctx, 1, domain.Draft{ChatID: cid, Text: "новый черновик"})
	if _, err := in.SendScheduledNow(ctx, cid, 1, []int64{sm.Seq}); err != nil {
		t.Fatal(err)
	}
	if _, ok := drafts.m[[3]int64{cid, 1, 0}]; !ok {
		t.Fatal("публикация сняла текущий черновик")
	}
}

// --- В-2: медленный режим и плата — при постановке ---

func TestScheduled_SlowmodeOnEnqueueNotOnPublish(t *testing.T) {
	in, _, s, id := gateGroup(t)
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 60); err != nil {
		t.Fatal(err)
	}
	at := future()
	sm, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "отложено", ScheduleDate: at})
	if err != nil {
		t.Fatalf("постановка: %v", err)
	}
	// Реальных сообщений нет: отказ даёт только интервал ВНУТРИ очереди.
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "ещё", ScheduleDate: at + 30}); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("постановка в окне медленного режима: %v, want ErrSlowmode", err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "через минуту", ScheduleDate: at + 60}); err != nil {
		t.Fatalf("постановка за окном: %v", err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "сейчас"}); err != nil {
		t.Fatal(err)
	}
	before := len(messagesOf(s, id))
	if _, err := in.SendScheduledNow(ctx, id, 8, []int64{sm.Seq}); err != nil {
		t.Fatal(err)
	}
	if len(messagesOf(s, id)) != before+1 {
		t.Fatal("публикация отложенного упёрлась в медленный режим")
	}
}

func TestScheduled_PaidChargedOnEnqueueOnce(t *testing.T) {
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	stars := newFakeStars()
	in.SetStars(stars)
	in.SetPublisher(&fakePublisher{})
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	cid, _, err := in.CreateGroup(ctx, 1, "Paid", "", "", false, []int64{2})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.SetChatChargeStars(ctx, cid, 1, 5); err != nil {
		t.Fatal(err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, Text: "x", ScheduleDate: future(), AllowPaidStars: 5}); !errors.Is(err, domain.ErrBalanceTooLow) || fs.count() != 0 {
		t.Fatalf("без звёзд: %v rows=%d, want ErrBalanceTooLow", err, fs.count())
	}
	if _, err := in.TopUpStars(ctx, 2, 20); err != nil {
		t.Fatal(err)
	}
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, Text: "x", ScheduleDate: future(), AllowPaidStars: 5})
	if err != nil {
		t.Fatal(err)
	}
	if bal, _ := stars.Balance(ctx, 2); bal != 15 {
		t.Fatalf("после постановки баланс %d, want 15", bal)
	}
	if _, err := in.SendScheduledNow(ctx, cid, 2, []int64{sm.Seq}); err != nil {
		t.Fatal(err)
	}
	if bal, _ := stars.Balance(ctx, 2); bal != 15 {
		t.Fatalf("публикация списала второй раз: баланс %d", bal)
	}
}

// --- «Когда будет в сети» (A5-19, НО-2, НО-3) ---

func TestScheduled_WhenOnline(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "привет", ScheduleDate: domain.SendWhenOnlineTimestamp})
	if err != nil {
		t.Fatal(err)
	}
	row, _ := fs.ByID(ctx, sm.Seq)
	if !row.WhenOnline {
		t.Fatal("when_online не сохранён")
	}
	list, _ := in.ListScheduled(ctx, cid, 1)
	if len(list) != 1 || list[0].Date != domain.SendWhenOnlineTimestamp {
		t.Fatalf("лента: %+v", list)
	}

	in.SetPresence(fakePresence{online: map[int64]bool{}})
	if n, _ := in.DispatchDueScheduled(ctx); n != 0 || len(messagesOf(s, cid)) != 0 {
		t.Fatal("ушло, пока собеседник офлайн")
	}
	in.SetPresence(fakePresence{online: map[int64]bool{2: true}})
	if n, err := in.DispatchDueScheduled(ctx); err != nil || n != 1 {
		t.Fatalf("онлайн: n=%d err=%v", n, err)
	}
	if got := messagesOf(s, cid); len(got) != 1 || got[0].Text != "привет" || !got[0].FromScheduled {
		t.Fatalf("не доставлено: %+v", got)
	}

	group, _ := fakeChats{s}.CreatePrivate(ctx, 1, 3)
	s.chatType[group] = "group"
	if _, err := in.Send(ctx, SendInput{ChatID: group, SenderID: 1, Text: "x", ScheduleDate: domain.SendWhenOnlineTimestamp}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("группа: %v, want ErrForbidden", err)
	}
}

// НО-2: ожидания «когда в сети» у офлайн-собеседников не заслоняют онлайн-собеседника.
func TestScheduled_WhenOnlineNoStarvation(t *testing.T) {
	in, s, _ := newScheduledTestInteractor()
	ctx := context.Background()
	for k := int64(0); k < 60; k++ {
		cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 100+k)
		if _, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "ждёт", ScheduleDate: domain.SendWhenOnlineTimestamp}); err != nil {
			t.Fatal(err)
		}
	}
	target, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	if _, err := in.Send(ctx, SendInput{ChatID: target, SenderID: 1, Text: "мне", ScheduleDate: domain.SendWhenOnlineTimestamp}); err != nil {
		t.Fatal(err)
	}
	in.SetPresence(fakePresence{online: map[int64]bool{2: true}})
	if n, err := in.DispatchDueScheduled(ctx); err != nil || n != 1 || len(messagesOf(s, target)) != 1 {
		t.Fatalf("онлайн-собеседник ждал за 60 офлайн: n=%d err=%v", n, err)
	}
}

// --- Правка (п. 3.2.5, НО-3) ---

func TestScheduled_Edit(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	date := future()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "было", ScheduleDate: date})
	if err != nil {
		t.Fatal(err)
	}
	edit := func(text string, d int64) error {
		_, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: cid, ID: sm.Seq, UserID: 1, Text: text, ScheduleDate: d})
		return err
	}
	if err := edit("стало", date); err != nil {
		t.Fatal(err)
	}
	if row, _ := fs.ByID(ctx, sm.Seq); row.Text != "стало" {
		t.Fatalf("текст не изменён: %q", row.Text)
	}
	news := logOf(s, 1, scheduledNewFrame)
	if len(news) != 2 || int64(news[1]["message"].(map[string]any)["id"].(float64)) != sm.Seq {
		t.Fatalf("правка — updateNewScheduledMessage с тем же id: %v", news)
	}
	if err := edit("стало", date); !errors.Is(err, domain.ErrMessageNotModified) {
		t.Fatalf("без изменений: %v, want ErrMessageNotModified", err)
	}
	if err := edit("", date); !errors.Is(err, domain.ErrMessageEmpty) {
		t.Fatalf("пустой текст: %v, want ErrMessageEmpty", err)
	}
	// НО-3: перенос в «когда будет в сети» — флаг, а не дата 2038 года.
	if err := edit("стало", domain.SendWhenOnlineTimestamp); err != nil {
		t.Fatal(err)
	}
	if row, _ := fs.ByID(ctx, sm.Seq); !row.WhenOnline {
		t.Fatal("перенос в «когда в сети» не перевёл в when_online")
	}
	back := time.Now().Add(2 * time.Hour).Unix()
	if err := edit("стало", back); err != nil {
		t.Fatal(err)
	}
	if row, _ := fs.ByID(ctx, sm.Seq); row.WhenOnline || row.SendAt.Unix() != back {
		t.Fatalf("обратный перенос: %+v", row)
	}
	if _, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: cid, ID: sm.Seq, UserID: 2, Text: "чужое", ScheduleDate: back}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("чужое отложенное: %v, want ErrNotFound", err)
	}
}

// --- Повтор без Premium (schedule_repeat_period) ---

// После публикации строка переставляется на следующий срок с тем же id
// (кадр — правка даты), а не снимается.
func TestScheduled_RepeatReschedules(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "каждый день", ScheduleDate: future(), ScheduleRepeatPeriod: 86400})
	if err != nil {
		t.Fatal(err)
	}
	due := time.Now().Add(-time.Minute)
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = due })
	if n, err := in.DispatchDueScheduled(ctx); err != nil || n != 1 {
		t.Fatalf("dispatch: n=%d err=%v", n, err)
	}
	row, err := fs.ByID(ctx, sm.Seq)
	if err != nil {
		t.Fatalf("строка повтора снята: %v", err)
	}
	if !row.SendAt.Equal(due.Add(24*time.Hour)) || row.RepeatPeriod != 86400 {
		t.Fatalf("следующий срок %v, want %v", row.SendAt, due.Add(24*time.Hour))
	}
	news := logOf(s, 1, scheduledNewFrame)
	if len(news) != 2 || len(logOf(s, 1, scheduledDeleteFrame)) != 0 {
		t.Fatalf("перепостановка — правка тем же id, без снятия: new=%d", len(news))
	}
	// Второй проход того же срока дублем не публикует (ключ публикации — id+срок).
	if n, _ := in.DispatchDueScheduled(ctx); n != 0 || len(messagesOf(s, cid)) != 1 {
		t.Fatalf("дубль публикации: %d", len(messagesOf(s, cid)))
	}
	wire, _ := in.ListScheduled(ctx, cid, 1)
	if len(wire) != 1 || wire[0].ScheduleRepeatPeriod != 86400 {
		t.Fatalf("schedule_repeat_period на проводе: %+v", wire)
	}
}

// --- Лента (НО-1) ---

func TestScheduled_ListCarriesMedia(t *testing.T) {
	in, s, _ := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	s.mu.Lock()
	s.owners[300] = 1
	s.mediaDims[300] = domain.MediaSource{Mime: "audio/ogg", Kind: "voice"}
	s.mu.Unlock()
	media := int64(300)
	if _, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Type: "voice", MediaID: &media, ScheduleDate: future()}); err != nil {
		t.Fatal(err)
	}
	list, err := in.ListScheduled(ctx, cid, 1)
	if err != nil || len(list) != 1 || list[0].Media == nil {
		t.Fatalf("голосовое в ленте отложенных без media: %+v err=%v", list, err)
	}
}

// --- Отложенная пересылка ---

func TestScheduled_Forward(t *testing.T) {
	in, _, s, id := gateGroup(t)
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	src, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "от Алисы"})
	if err != nil {
		t.Fatal(err)
	}
	queued, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: id, ToChatID: id, MsgIDs: []int64{src.ID}, SenderID: 8, ScheduleDate: future()})
	if err != nil || len(queued) != 1 || fs.count() != 1 {
		t.Fatalf("отложенная пересылка: %v rows=%d", err, fs.count())
	}
	before := len(messagesOf(s, id))
	list, _ := in.ListScheduled(ctx, id, 8)
	if len(list) != 1 || list[0].FwdFrom == nil || list[0].Message != "от Алисы" {
		t.Fatalf("лента без атрибуции пересылки: %+v", list)
	}
	if _, err := in.SendScheduledNow(ctx, id, 8, []int64{queued[0].Seq}); err != nil {
		t.Fatal(err)
	}
	got := messagesOf(s, id)
	if len(got) != before+1 {
		t.Fatalf("копия не опубликована")
	}
	c := got[len(got)-1]
	if c.FwdFromUserID == nil || *c.FwdFromUserID != 7 || !c.FromScheduled || c.Text != "от Алисы" || c.SenderID != 8 {
		t.Fatalf("копия: %+v", c)
	}
}

// Просьба C1: опрос ставится в очередь тем же schedule_date (tweb sendMedia с
// inputMediaPoll и schedule_date/schedule_repeat_period,
// appMessagesManager.ts:4152-4166): в ленту не уходит, публикация несёт опрос.
func TestScheduled_Poll(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	in.SetPolls(newFakePolls())
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	m, err := in.SendPoll(ctx, SendPollInput{
		ChatID: cid, SenderID: 1, Question: "Куда?", Options: []string{"сюда", "туда"},
		ClientMsgID: "p-1", ScheduleDate: future(), ScheduleRepeatPeriod: 86400,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(messagesOf(s, cid)) != 0 || fs.count() != 1 {
		t.Fatalf("опрос ушёл сразу: msgs=%d rows=%d", len(messagesOf(s, cid)), fs.count())
	}
	row, err := fs.ByID(ctx, m.Seq)
	if err != nil || row.Params.PollID == nil || row.RepeatPeriod != 86400 {
		t.Fatalf("снимок: err=%v poll=%v repeat=%d", err, row.Params.PollID, row.RepeatPeriod)
	}
	if _, err := in.SendScheduledNow(ctx, cid, 1, []int64{m.Seq}); err != nil {
		t.Fatal(err)
	}
	got := messagesOf(s, cid)
	if len(got) != 1 || got[0].Type != "poll" || got[0].PollID == nil || *got[0].PollID != *row.Params.PollID {
		t.Fatalf("публикация: %+v", got)
	}
	if _, err := in.SendPoll(ctx, SendPollInput{
		ChatID: cid, SenderID: 1, Question: "Q", Options: []string{"a", "b"}, ScheduleDate: 1,
	}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("прошедшая дата: %v, want ErrInvalid", err)
	}
}

// --- Ревью: медленный режим очереди у пересылки, переноса и альбома ---

func TestScheduled_SlowmodeQueueForwardEditAlbum(t *testing.T) {
	in, _, s, id := gateGroup(t)
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	src, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "от Алисы"})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 60); err != nil {
		t.Fatal(err)
	}
	at := future()
	first, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "раз", ScheduleDate: at})
	if err != nil {
		t.Fatal(err)
	}
	// Пересылка на ту же минуту — интервал очереди.
	if _, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: id, ToChatID: id, MsgIDs: []int64{src.ID}, SenderID: 8,
		ScheduleDate: at + 10}); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("отложенная пересылка в окне: %v, want ErrSlowmode", err)
	}
	second, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "два", ScheduleDate: at + 120})
	if err != nil {
		t.Fatal(err)
	}
	// Перенос срока в окно соседнего отложенного — отказ; свой же срок не мешает.
	if _, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: id, ID: second.Seq, UserID: 8, Text: "два",
		ScheduleDate: at + 20}); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("перенос в окно: %v, want ErrSlowmode", err)
	}
	if _, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: id, ID: first.Seq, UserID: 8, Text: "раз",
		ScheduleDate: at + 5}); err != nil {
		t.Fatalf("перенос в окне своего же срока: %v", err)
	}
	// Альбом на один срок — одна единица, но не больше maxAlbumSize.
	albumAt := at + 600
	s.mu.Lock()
	for k := 0; k <= maxAlbumSize; k++ {
		s.owners[int64(1000+k)] = 8
	}
	s.mu.Unlock()
	for k := 0; k < maxAlbumSize; k++ {
		mid := int64(1000 + k)
		if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Type: "photo", MediaID: &mid, GroupedID: 77,
			ScheduleDate: albumAt}); err != nil {
			t.Fatalf("элемент альбома %d: %v", k, err)
		}
	}
	mid := int64(1000 + maxAlbumSize)
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Type: "photo", MediaID: &mid, GroupedID: 77,
		ScheduleDate: albumAt}); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("%d-й элемент альбома: %v, want ErrSlowmode", maxAlbumSize+1, err)
	}
}

// --- Ревью: аренда публикации против правки и снятия ---

func TestScheduled_ClaimedRowNotEditedOrDeleted(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	row, _ := fs.ByID(ctx, sm.Seq)
	if _, ok, _ := fs.Claim(ctx, row.ID, row.SendAt, false, time.Minute, true); !ok {
		t.Fatal("claim")
	}
	frames := len(logOf(s, 1, scheduledNewFrame))
	if _, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: cid, ID: sm.Seq, UserID: 1, Text: "y",
		ScheduleDate: row.SendAt.Unix()}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("правка публикуемой строки: %v, want ErrNotFound", err)
	}
	if upd, err := in.DeleteScheduled(ctx, cid, 1, []int64{sm.Seq}); err != nil || len(upd) != 0 || fs.count() != 1 {
		t.Fatalf("снятие публикуемой строки: upd=%v err=%v rows=%d", upd, err, fs.count())
	}
	if len(logOf(s, 1, scheduledNewFrame)) != frames || len(logOf(s, 1, scheduledDeleteFrame)) != 0 {
		t.Fatal("кадр по публикуемой строке")
	}
	// Второй публикатор строку в аренде не берёт; устаревший снимок срока — тоже.
	stale := row
	stale.SendAt = row.SendAt.Add(time.Minute)
	if _, n, _ := in.publishScheduled(ctx, cid, 1, []domain.ScheduledMessage{row, stale}, false); n != 0 || len(messagesOf(s, cid)) != 0 {
		t.Fatalf("опубликовано %d из чужой аренды/устаревшего снимка", n)
	}
}

// Перепостановка повтора не воскрешает строку, которую тем временем
// перенесли (или сняли), и не затирает правку.
func TestScheduled_RepeatRaceWithEdit(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "каждый день", ScheduleDate: future(), ScheduleRepeatPeriod: 86400})
	if err != nil {
		t.Fatal(err)
	}
	due := time.Now().Add(-time.Minute)
	edited := time.Now().Add(3 * time.Hour)
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = due })
	fs.onReschedule = func() {
		fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt, m.Text = edited, "правка автора" })
	}
	frames := len(logOf(s, 1, scheduledNewFrame))
	if n, _ := in.DispatchDueScheduled(ctx); n != 1 {
		t.Fatalf("публикация: %d", n)
	}
	row, err := fs.ByID(ctx, sm.Seq)
	if err != nil || !row.SendAt.Equal(edited) || row.Text != "правка автора" {
		t.Fatalf("правка затёрта перепостановкой: %+v err=%v", row, err)
	}
	if len(logOf(s, 1, scheduledNewFrame)) != frames {
		t.Fatal("кадр перепостановки по перенесённой строке")
	}
}

// Сбой завершающей транзакции: следующий проход после аренды дублем не
// публикует, а строку повтора всё же переставляет.
func TestScheduled_RepeatFinishFailureNoDuplicate(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "каждый день", ScheduleDate: future(), ScheduleRepeatPeriod: 86400})
	if err != nil {
		t.Fatal(err)
	}
	due := time.Now().Add(-time.Minute)
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = due })
	fs.failReschedule = 1
	_, _ = in.DispatchDueScheduled(ctx)
	if n, _ := in.DispatchDueScheduled(ctx); n != 0 {
		t.Fatal("строка в аренде взята вторым проходом")
	}
	fs.expireClaims()
	_, _ = in.DispatchDueScheduled(ctx)
	if got := len(messagesOf(s, cid)); got != 1 {
		t.Fatalf("сообщений %d, want 1 (ключ публикации)", got)
	}
	row, _ := fs.ByID(ctx, sm.Seq)
	if !row.SendAt.Equal(due.Add(24*time.Hour)) || row.Occurrence != 1 {
		t.Fatalf("перепостановка после сбоя: %+v", row)
	}
}

// Уже опубликованное сообщение не превращается в «отвергнутое», если автор
// потерял право между публикацией и снятием строки.
func TestScheduled_PublishedBeforeGateLossNotRejected(t *testing.T) {
	in, _, s, id := gateGroup(t)
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Minute) })
	before := len(messagesOf(s, id))
	fs.failDelete = 1
	_, _ = in.DispatchDueScheduled(ctx)
	if err := in.SetChatPermissions(ctx, id, 7, 0, 0); err != nil {
		t.Fatal(err)
	}
	fs.expireClaims()
	_, _ = in.DispatchDueScheduled(ctx)
	if len(messagesOf(s, id)) != before+1 || fs.count() != 0 {
		t.Fatalf("msgs=%d rows=%d", len(messagesOf(s, id))-before, fs.count())
	}
	var withSent bool
	for _, d := range logOf(s, 8, scheduledDeleteFrame) {
		if _, ok := d["sent_messages"]; ok {
			withSent = true
		}
	}
	if !withSent {
		t.Fatal("снятие без sent_messages — сообщение посчитано отвергнутым")
	}
}

// --- Ревью: send_now при отказе гейта ---

func TestScheduled_SendNowRefusalKeepsRow(t *testing.T) {
	in, _, s, id := gateGroup(t)
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.SetChatPermissions(ctx, id, 7, 0, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := in.SendScheduledNow(ctx, id, 8, []int64{sm.Seq}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("send_now без права: %v, want ErrForbidden", err)
	}
	if fs.count() != 1 || len(logOf(s, 8, scheduledDeleteFrame)) != 0 {
		t.Fatalf("строка снята при отказе send_now: rows=%d", fs.count())
	}
	// Аренда снята: после возврата права строка публикуется.
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := in.SendScheduledNow(ctx, id, 8, []int64{sm.Seq}); err != nil || fs.count() != 0 {
		t.Fatalf("send_now после возврата права: %v rows=%d", err, fs.count())
	}
}

// --- Ревью: предохранители воркера ---

func TestScheduled_WorkerGivesUpAndRejectsBrokenSnapshot(t *testing.T) {
	in, s, fs := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	a, _ := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "исчерпано", ScheduleDate: future()})
	b, _ := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "битый снимок", ScheduleDate: future()})
	past := time.Now().Add(-time.Minute)
	fs.set(a.Seq, func(m *domain.ScheduledMessage) { m.SendAt, m.Attempts = past, maxPublishAttempts })
	fs.set(b.Seq, func(m *domain.ScheduledMessage) { m.SendAt, m.ParamsBroken = past, true })
	if n, _ := in.DispatchDueScheduled(ctx); n != 0 {
		t.Fatalf("опубликовано %d", n)
	}
	if fs.count() != 0 || len(messagesOf(s, cid)) != 0 {
		t.Fatalf("rows=%d msgs=%d", fs.count(), len(messagesOf(s, cid)))
	}
	for _, d := range logOf(s, 1, scheduledDeleteFrame) {
		if _, ok := d["sent_messages"]; ok {
			t.Fatal("отвергнутые сняты с sent_messages")
		}
	}
}

// --- Ревью: повтор в платной группе платит за каждое вхождение после первого ---

func TestScheduled_PaidRepeatChargesEachOccurrence(t *testing.T) {
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	stars := newFakeStars()
	in.SetStars(stars)
	in.SetPublisher(&fakePublisher{})
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	cid, _, err := in.CreateGroup(ctx, 1, "Paid", "", "", false, []int64{2})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.SetChatChargeStars(ctx, cid, 1, 5); err != nil {
		t.Fatal(err)
	}
	if _, err := in.TopUpStars(ctx, 2, 12); err != nil {
		t.Fatal(err)
	}
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "x", ScheduleDate: future(), ScheduleRepeatPeriod: 86400})
	if err != nil {
		t.Fatal(err)
	}
	ticks := 0
	tick := func() { // у каждого вхождения свой срок (ключ публикации — id+срок)
		ticks++
		fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Duration(ticks) * time.Hour) })
		_, _ = in.DispatchDueScheduled(ctx)
	}
	tick() // первое вхождение оплачено постановкой
	if bal, _ := stars.Balance(ctx, 2); bal != 7 {
		t.Fatalf("после первого вхождения баланс %d, want 7", bal)
	}
	tick() // второе — платит
	if bal, _ := stars.Balance(ctx, 2); bal != 2 {
		t.Fatalf("после второго вхождения баланс %d, want 2", bal)
	}
	tick() // третье — звёзд не хватает: строка снята как отвергнутая
	if fs.count() != 0 {
		t.Fatal("повтор без оплаты остался в очереди")
	}
}

// flakyMsgs — сбой чтения ключа публикации (временный сбой БД при публикации).
type flakyMsgs struct {
	fakeMsgs
	fail *int
}

func (f flakyMsgs) FindByClientMsgID(ctx context.Context, chatID, senderID int64, cmid string) (domain.Message, error) {
	if *f.fail > 0 {
		*f.fail--
		return domain.Message{}, errors.New("db: injected failure")
	}
	return f.fakeMsgs.FindByClientMsgID(ctx, chatID, senderID, cmid)
}

// Повторное ревью: временный сбой публикации снимает аренду (автор может
// снять строку), а воркер ждёт отступа.
func TestScheduled_TransientFailureReleasesClaim(t *testing.T) {
	s := newStore()
	fs := newFakeScheduled()
	fs.s = s
	fail := 0
	in := New(fakeTx{}, fakeChats{s}, flakyMsgs{fakeMsgs{s}, &fail}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	in.SetScheduled(fs)
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Minute) })
	fail = 1
	if n, _ := in.DispatchDueScheduled(ctx); n != 0 {
		t.Fatal("опубликовано при сбое")
	}
	if n, _ := in.DispatchDueScheduled(ctx); n != 0 {
		t.Fatal("воркер не выдержал отступ")
	}
	if upd, err := in.DeleteScheduled(ctx, cid, 1, []int64{sm.Seq}); err != nil || len(upd) != 1 || fs.count() != 0 {
		t.Fatalf("снятие в отступе после сбоя: upd=%v err=%v rows=%d", upd, err, fs.count())
	}
	fs.expireClaims()
	if n, _ := in.DispatchDueScheduled(ctx); n != 0 || len(messagesOf(s, cid)) != 0 {
		t.Fatal("снятое автором опубликовано")
	}
}

// Повторное ревью: неудачные «Отправить сейчас» не считаются попытками
// воркера; предел попыток не снимает уже вставленное сообщение без sent_messages.
func TestScheduled_AttemptsOnlyWorkerAndAfterDedup(t *testing.T) {
	in, _, s, id := gateGroup(t)
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.SetChatPermissions(ctx, id, 7, 0, 0); err != nil {
		t.Fatal(err)
	}
	for k := 0; k <= maxPublishAttempts; k++ {
		_, _ = in.SendScheduledNow(ctx, id, 8, []int64{sm.Seq})
	}
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 0); err != nil {
		t.Fatal(err)
	}
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Minute) })
	before := len(messagesOf(s, id))
	fs.failDelete = 1
	if n, _ := in.DispatchDueScheduled(ctx); n != 1 || len(messagesOf(s, id)) != before+1 {
		t.Fatalf("после неудачных send_now воркер не опубликовал: n=%d", n)
	}
	// Завершение упало; попытки исчерпаны — но сообщение уже есть: снятие с sent_messages.
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.Attempts = maxPublishAttempts + 5 })
	fs.expireClaims()
	_, _ = in.DispatchDueScheduled(ctx)
	var withSent bool
	for _, d := range logOf(s, 8, scheduledDeleteFrame) {
		if _, ok := d["sent_messages"]; ok {
			withSent = true
		}
	}
	if fs.count() != 0 || !withSent {
		t.Fatalf("rows=%d withSent=%v", fs.count(), withSent)
	}
}

// --- Решение 2026-10-11: возврат звёзд отвергнутому отложенному ---

// paidScheduledGroup — платная группа (5 звёзд за сообщение): 1 — владелец,
// 2 — участник с балансом topUp.
func paidScheduledGroup(t *testing.T, topUp int64) (*Interactor, *fakeStars, *fakeScheduled, *store, int64) {
	t.Helper()
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	stars := newFakeStars()
	in.SetStars(stars)
	in.SetPublisher(&fakePublisher{})
	fs := newFakeScheduled()
	in.SetScheduled(fs)
	ctx := context.Background()
	cid, _, err := in.CreateGroup(ctx, 1, "Paid", "", "", false, []int64{2})
	if err != nil {
		t.Fatal(err)
	}
	if err := in.SetChatChargeStars(ctx, cid, 1, 5); err != nil {
		t.Fatal(err)
	}
	if _, err := in.TopUpStars(ctx, 2, topUp); err != nil {
		t.Fatal(err)
	}
	return in, stars, fs, s, cid
}

func TestScheduled_RejectedPaidRefundedOnce(t *testing.T) {
	in, stars, fs, s, cid := paidScheduledGroup(t, 20)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := stars.Balance(ctx, 2); b != 15 {
		t.Fatalf("после постановки %d, want 15", b)
	}
	// Гейт публикации не пройдёт: писать запрещено всем участникам.
	if err := in.SetChatPermissions(ctx, cid, 1, 0, 0); err != nil {
		t.Fatal(err)
	}
	before := len(messagesOf(s, cid))
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Minute) })
	// Первая попытка: снятие с возвратом падает (сбой транзакции) — ни снятия, ни возврата.
	fs.failDelete = 1
	_, _ = in.DispatchDueScheduled(ctx)
	if b, _ := stars.Balance(ctx, 2); b != 15 || fs.count() != 1 {
		t.Fatalf("сбой снятия: баланс %d rows=%d", b, fs.count())
	}
	fs.expireClaims()
	_, _ = in.DispatchDueScheduled(ctx)
	fs.expireClaims()
	_, _ = in.DispatchDueScheduled(ctx)
	if b, _ := stars.Balance(ctx, 2); b != 20 {
		t.Fatalf("после отказа баланс автора %d, want 20 (возврат ровно один раз)", b)
	}
	if b, _ := stars.Balance(ctx, 1); b != 0 {
		t.Fatalf("владелец сохранил %d звёзд за неотправленное", b)
	}
	if fs.count() != 0 || len(messagesOf(s, cid)) != before {
		t.Fatalf("rows=%d msgs=%d", fs.count(), len(messagesOf(s, cid))-before)
	}
	var refunded bool
	for _, d := range logOf(s, 2, "balance_update") {
		if bal, ok := d["balance"].(map[string]any); ok && bal["amount"] == float64(20) {
			refunded = true
		}
	}
	if !refunded {
		t.Fatal("нет updateStarsBalance с возвращённым балансом")
	}
}

// Повтор: первое вхождение оплачено постановкой и опубликовано; второе
// платит при публикации и отвергнуто — его списание откатывается вместе с
// Send, возврата за первое (уже доставленное) нет.
func TestScheduled_RepeatRefundOnlyRejectedOccurrence(t *testing.T) {
	in, stars, fs, _, cid := paidScheduledGroup(t, 20)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "x", ScheduleDate: future(), ScheduleRepeatPeriod: 86400})
	if err != nil {
		t.Fatal(err)
	}
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-2 * time.Hour) })
	if n, _ := in.DispatchDueScheduled(ctx); n != 1 {
		t.Fatal("первое вхождение не опубликовано")
	}
	if b, _ := stars.Balance(ctx, 2); b != 15 {
		t.Fatalf("после первого вхождения %d, want 15", b)
	}
	if err := in.SetChatPermissions(ctx, cid, 1, 0, 0); err != nil {
		t.Fatal(err)
	}
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Hour) })
	_, _ = in.DispatchDueScheduled(ctx)
	if b, _ := stars.Balance(ctx, 2); b != 15 || fs.count() != 0 {
		t.Fatalf("отвергнутое второе вхождение: баланс %d rows=%d, want 15 и 0", b, fs.count())
	}
	if b, _ := stars.Balance(ctx, 1); b != 5 {
		t.Fatalf("владелец %d, want 5 за доставленное первое вхождение", b)
	}
}

// Владелец успел потратить полученное: с владельца снимается не больше его
// баланса, и автору возвращается ровно снятое (решение пользователя 2026-10-15:
// иначе возврат печатал бы звёзды).
func TestScheduled_RefundCapsCreatorBalance(t *testing.T) {
	in, stars, fs, _, cid := paidScheduledGroup(t, 20)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stars.AddBalance(ctx, 1, -3); err != nil {
		t.Fatal(err)
	}
	if err := in.SetChatPermissions(ctx, cid, 1, 0, 0); err != nil {
		t.Fatal(err)
	}
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Minute) })
	_, _ = in.DispatchDueScheduled(ctx)
	if b, _ := stars.Balance(ctx, 2); b != 17 {
		t.Fatalf("автор %d, want 17 (15 + снятые с владельца 2)", b)
	}
	if b, _ := stars.Balance(ctx, 1); b != 0 {
		t.Fatalf("владелец %d, want 0", b)
	}
}

// Ревью s1b: удаление группы владельцем возвращает звёзды за её очередь.
func TestScheduled_DeleteGroupRefundsQueue(t *testing.T) {
	in, stars, fs, _, cid := paidScheduledGroup(t, 20)
	ctx := context.Background()
	if _, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "x", ScheduleDate: future()}); err != nil {
		t.Fatal(err)
	}
	if err := in.DeleteGroup(ctx, cid, 1); err != nil {
		t.Fatal(err)
	}
	if b, _ := stars.Balance(ctx, 2); b != 20 || fs.count() != 0 {
		t.Fatalf("после удаления группы автор %d rows=%d, want 20 и 0", b, fs.count())
	}
	if b, _ := stars.Balance(ctx, 1); b != 0 {
		t.Fatalf("владелец сохранил %d", b)
	}
}

// Ревью s1b: строку, чьё сообщение уже вставлено по прежнему сроку, нельзя
// перенести (новый ключ публикации дал бы дубль или возврат за доставленное).
func TestScheduled_EditTimeRefusedAfterPublishedKey(t *testing.T) {
	in, stars, fs, s, cid := paidScheduledGroup(t, 20)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Minute) })
	before := len(messagesOf(s, cid))
	fs.failDelete = 1
	_, _ = in.DispatchDueScheduled(ctx) // опубликовано, снятие упало
	fs.expireClaims()
	if _, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: cid, ID: sm.Seq, UserID: 2, Text: "x",
		ScheduleDate: future()}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("перенос опубликованной строки: %v, want ErrNotFound", err)
	}
	if err := in.SetChatPermissions(ctx, cid, 1, 0, 0); err != nil {
		t.Fatal(err)
	}
	_, _ = in.DispatchDueScheduled(ctx)
	if len(messagesOf(s, cid)) != before+1 || fs.count() != 0 {
		t.Fatalf("msgs=%d rows=%d", len(messagesOf(s, cid))-before, fs.count())
	}
	if b, _ := stars.Balance(ctx, 2); b != 15 {
		t.Fatalf("возврат за доставленное: баланс %d, want 15", b)
	}
}

// --- Решение 2026-10-12: возврат звёзд при снятии отложенного автором ---

func TestScheduled_AuthorDeleteRefunds(t *testing.T) {
	in, stars, _, s, cid := paidScheduledGroup(t, 20)
	ctx := context.Background()
	send := func(text string) int64 {
		sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: text, ScheduleDate: future() + int64(len(text))})
		if err != nil {
			t.Fatal(err)
		}
		return sm.Seq
	}
	one, two, three := send("a"), send("bb"), send("ccc")
	if b, _ := stars.Balance(ctx, 2); b != 5 {
		t.Fatalf("после трёх постановок %d, want 5", b)
	}
	// Одна.
	if upd, err := in.DeleteScheduled(ctx, cid, 2, []int64{one}); err != nil || len(upd) != 1 {
		t.Fatalf("снятие: %v %v", upd, err)
	}
	if b, _ := stars.Balance(ctx, 2); b != 10 {
		t.Fatalf("после снятия одной %d, want 10", b)
	}
	// Повторное снятие той же — без второго возврата.
	if upd, _ := in.DeleteScheduled(ctx, cid, 2, []int64{one}); len(upd) != 0 {
		t.Fatal("повторное снятие дало кадр")
	}
	// Пакетом (с уже снятой внутри).
	if _, err := in.DeleteScheduled(ctx, cid, 2, []int64{one, two, three}); err != nil {
		t.Fatal(err)
	}
	if b, _ := stars.Balance(ctx, 2); b != 20 {
		t.Fatalf("после пакетного снятия %d, want 20 (каждая ровно один раз)", b)
	}
	if b, _ := stars.Balance(ctx, 1); b != 0 {
		t.Fatalf("владелец сохранил %d", b)
	}
	var last float64
	for _, d := range logOf(s, 2, "balance_update") {
		if bal, ok := d["balance"].(map[string]any); ok {
			last, _ = bal["amount"].(float64)
		}
	}
	if last != 20 {
		t.Fatalf("последний updateStarsBalance автору %v, want 20", last)
	}
}

// Гонка с публикацией: строку в аренде снятие пропускает (возврата нет), её
// публикует воркер; доставленное по прежнему сроку (сбой снятия после
// публикации) снятие автором не возвращает.
func TestScheduled_AuthorDeleteRaceWithPublish(t *testing.T) {
	in, stars, fs, _, cid := paidScheduledGroup(t, 20)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	row, _ := fs.ByID(ctx, sm.Seq)
	if _, ok, _ := fs.Claim(ctx, row.ID, row.SendAt, false, time.Minute, true); !ok {
		t.Fatal("claim")
	}
	if upd, _ := in.DeleteScheduled(ctx, cid, 2, []int64{sm.Seq}); len(upd) != 0 {
		t.Fatal("снята строка в аренде")
	}
	if b, _ := stars.Balance(ctx, 2); b != 15 {
		t.Fatalf("возврат за публикуемую строку: %d", b)
	}
	fs.expireClaims()
	// Опубликовано, снятие строки упало: сообщение доставлено.
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Minute) })
	fs.failDelete = 1
	_, _ = in.DispatchDueScheduled(ctx)
	fs.expireClaims()
	if _, err := in.DeleteScheduled(ctx, cid, 2, []int64{sm.Seq}); err != nil || fs.count() != 0 {
		t.Fatalf("снятие доставленной строки: %v rows=%d", err, fs.count())
	}
	if b, _ := stars.Balance(ctx, 2); b != 15 {
		t.Fatalf("возврат за доставленное: %d, want 15", b)
	}
}

// Повтор: снятие до первой публикации возвращает оплату постановки; после
// первого вхождения оплаты на строке нет (следующие платят при публикации).
func TestScheduled_AuthorDeleteRepeat(t *testing.T) {
	in, stars, fs, _, cid := paidScheduledGroup(t, 20)
	ctx := context.Background()
	a, _ := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "до", ScheduleDate: future(), ScheduleRepeatPeriod: 86400})
	b, _ := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "после", ScheduleDate: future() + 100, ScheduleRepeatPeriod: 86400})
	if bal, _ := stars.Balance(ctx, 2); bal != 10 {
		t.Fatalf("после постановок %d", bal)
	}
	if _, err := in.DeleteScheduled(ctx, cid, 2, []int64{a.Seq}); err != nil {
		t.Fatal(err)
	}
	if bal, _ := stars.Balance(ctx, 2); bal != 15 {
		t.Fatalf("снятие неопубликованного повтора: %d, want 15", bal)
	}
	fs.set(b.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Minute) })
	if n, _ := in.DispatchDueScheduled(ctx); n != 1 {
		t.Fatal("первое вхождение не опубликовано")
	}
	if _, err := in.DeleteScheduled(ctx, cid, 2, []int64{b.Seq}); err != nil || fs.count() != 0 {
		t.Fatalf("снятие повтора после вхождения: %v rows=%d", err, fs.count())
	}
	if bal, _ := stars.Balance(ctx, 2); bal != 15 {
		t.Fatalf("возврат за опубликованное вхождение: %d, want 15", bal)
	}
}

// Ревью s1c: аренда истекла посреди публикации, автор снял строку и получил
// возврат — транзакция вставки, заблокировав строку, её уже не находит и
// сообщение не вставляет (иначе доставка за возвращённые звёзды).
func TestScheduled_AuthorDeleteDuringSlowPublish(t *testing.T) {
	in, stars, fs, s, cid := paidScheduledGroup(t, 20)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 2, AllowPaidStars: 5, Text: "x", ScheduleDate: future()})
	if err != nil {
		t.Fatal(err)
	}
	fs.set(sm.Seq, func(m *domain.ScheduledMessage) { m.SendAt = time.Now().Add(-time.Minute) })
	before := len(messagesOf(s, cid))
	fs.onLockForPublish = func() {
		fs.onLockForPublish = nil
		fs.expireClaims()
		if upd, err := in.DeleteScheduled(ctx, cid, 2, []int64{sm.Seq}); err != nil || len(upd) != 1 {
			t.Errorf("снятие посреди публикации: %v %v", upd, err)
		}
	}
	_, _ = in.DispatchDueScheduled(ctx)
	if got := len(messagesOf(s, cid)) - before; got != 0 {
		t.Fatalf("вставлено %d сообщений после снятия с возвратом", got)
	}
	if b, _ := stars.Balance(ctx, 2); b != 20 {
		t.Fatalf("баланс %d, want 20 (ровно один возврат)", b)
	}
}
