package saferun

import (
	"sync"
	"testing"
)

func TestRecover_SwallowsPanic(t *testing.T) {
	func() {
		defer Recover("test")
		panic("boom")
	}()
	// Дошли сюда — паника погашена.
}

func TestGo_RecoversInGoroutine(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)
	Go("test", func() {
		defer wg.Done()
		panic("boom")
	})
	wg.Wait() // не должно упасть; горутина завершилась под Recover
}

func TestRecover_NoPanicPassesThrough(t *testing.T) {
	ran := false
	func() {
		defer Recover("test")
		ran = true
	}()
	if !ran {
		t.Fatal("тело не выполнилось")
	}
}
