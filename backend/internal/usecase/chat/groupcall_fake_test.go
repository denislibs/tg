package chat

import (
	"context"
	"slices"
	"sort"
	"sync"
	"time"
)

// fakeClock — подменяемые часы: стор, ограничитель снимков и тикер читают одни
// и те же, поэтому окно в 5 с проходит одним вызовом advance.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newFakeClock() *fakeClock { return &fakeClock{t: time.Unix(1_800_000_000, 0)} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// fakeCallStore — GroupCallStore в памяти с теми же правилами, что у Redis-стора
// (adapter/cache/redis/groupcallstore.go): признак перехода 0→1 / 1→0, ключ
// ограничителя со сроком, ZSET отложенных снимков с арендой.
type fakeCallStore struct {
	mu    sync.Mutex
	clock *fakeClock
	parts map[int64][]int64
	// snapUntil — до какого момента занят ограничитель снимков чата.
	snapUntil map[int64]time.Time
	// dirty — чат → срок публикации либо конец аренды (одно поле, как у ZSET).
	dirty map[int64]time.Time

	activeAmongCalls int
	// activeAmongErr — сбой источника звонков (Redis недоступен).
	activeAmongErr error
	// afterActiveAmong срабатывает один раз ПОСЛЕ расчёта ответа, до возврата:
	// так тест меняет состояние звонка, пока снимок собирается по старому.
	afterActiveAmong func()
}

func newFakeCallStore(clock *fakeClock) *fakeCallStore {
	return &fakeCallStore{
		clock: clock, parts: map[int64][]int64{},
		snapUntil: map[int64]time.Time{}, dirty: map[int64]time.Time{},
	}
}

func (f *fakeCallStore) Join(_ context.Context, chatID, userID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	first := len(f.parts[chatID]) == 0
	if !slices.Contains(f.parts[chatID], userID) {
		f.parts[chatID] = append(f.parts[chatID], userID)
	}
	return first, nil
}

func (f *fakeCallStore) Leave(_ context.Context, chatID, userID int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	had := len(f.parts[chatID]) > 0
	f.parts[chatID] = slices.DeleteFunc(f.parts[chatID], func(id int64) bool { return id == userID })
	return had && len(f.parts[chatID]) == 0, nil
}

func (f *fakeCallStore) Participants(_ context.Context, chatID int64) ([]int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.parts[chatID]), nil
}

func (f *fakeCallStore) ActiveAmong(_ context.Context, chatIDs []int64) (map[int64]bool, error) {
	f.mu.Lock()
	f.activeAmongCalls++
	if f.activeAmongErr != nil {
		err := f.activeAmongErr
		f.mu.Unlock()
		return nil, err
	}
	out := map[int64]bool{}
	for _, id := range chatIDs {
		if len(f.parts[id]) > 0 {
			out[id] = true
		}
	}
	hook := f.afterActiveAmong
	f.afterActiveAmong = nil
	f.mu.Unlock()
	if hook != nil {
		hook()
	}
	return out, nil
}

func (f *fakeCallStore) ClaimSnapshot(_ context.Context, chatID int64, ttl time.Duration) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := f.clock.Now()
	if until, ok := f.snapUntil[chatID]; ok && now.Before(until) {
		return false, nil
	}
	f.snapUntil[chatID] = now.Add(ttl)
	return true, nil
}

func (f *fakeCallStore) MarkSnapshotDirty(_ context.Context, chatID int64, due time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if cur, ok := f.dirty[chatID]; !ok || cur.After(due) {
		f.dirty[chatID] = due
	}
	return nil
}

func (f *fakeCallStore) LeaseDirtySnapshots(_ context.Context, now, leaseUntil time.Time, limit int) ([]int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var due []int64
	for id, at := range f.dirty {
		if !at.After(now) {
			due = append(due, id)
		}
	}
	sort.Slice(due, func(a, b int) bool { return due[a] < due[b] })
	if len(due) > limit {
		due = due[:limit]
	}
	for _, id := range due {
		f.dirty[id] = leaseUntil
	}
	return due, nil
}

func (f *fakeCallStore) FinishDirtySnapshot(_ context.Context, chatID int64, leaseUntil time.Time, ttl time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.snapUntil[chatID] = f.clock.Now().Add(ttl)
	if cur, ok := f.dirty[chatID]; ok && cur.Equal(leaseUntil) {
		delete(f.dirty, chatID)
	}
	return nil
}

// pendingDirty — сколько чатов ждут отложенного снимка.
func (f *fakeCallStore) pendingDirty() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.dirty)
}
