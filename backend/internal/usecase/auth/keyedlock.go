package auth

import (
	"context"
	"sync"
)

// keyedLock — взаимное исключение по ключу (id пользователя) с ожиданием, которое
// отпускает ctx. Нулевое значение готово к работе. Гарантия — в пределах одного
// процесса: при нескольких экземплярах бэкенда порядок между ними не
// упорядочивается (так же устроены прочие процессные замки usecase).
type keyedLock struct {
	mu sync.Mutex
	m  map[int64]*keyedLockEntry
}

type keyedLockEntry struct {
	ch   chan struct{} // ёмкость 1: токен владельца
	refs int
}

// lock занимает ключ; ошибка — ctx закончился раньше, чем ключ освободился.
func (k *keyedLock) lock(ctx context.Context, key int64) (unlock func(), err error) {
	if err := ctx.Err(); err != nil {
		return nil, err // select при свободном ключе и мёртвом ctx выбирал бы случайно
	}
	k.mu.Lock()
	if k.m == nil {
		k.m = map[int64]*keyedLockEntry{}
	}
	e := k.m[key]
	if e == nil {
		e = &keyedLockEntry{ch: make(chan struct{}, 1)}
		k.m[key] = e
	}
	e.refs++
	k.mu.Unlock()

	release := func() {
		k.mu.Lock()
		if e.refs--; e.refs == 0 {
			delete(k.m, key)
		}
		k.mu.Unlock()
	}
	select {
	case e.ch <- struct{}{}:
		return func() { <-e.ch; release() }, nil
	case <-ctx.Done():
		release()
		return nil, ctx.Err()
	}
}

// held — занят ли ключ прямо сейчас (для тестов порядка).
func (k *keyedLock) held(key int64) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	e := k.m[key]
	return e != nil && len(e.ch) == 1
}
