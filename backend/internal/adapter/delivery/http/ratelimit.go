package http

import (
	"sync"
	"time"
)

// keyRateLimiter — token-bucket на ключ (rps + burst). Общий для Bot API и
// анти-брутфорса auth-роутов. Потокобезопасен; бакеты создаются лениво.
type keyRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket
}

type tokenBucket struct {
	tokens float64
	last   time.Time
}

func newKeyRateLimiter() *keyRateLimiter {
	return &keyRateLimiter{buckets: map[string]*tokenBucket{}}
}

// allow пропускает запрос по ключу с заданной скоростью (rps) и «ведром» (burst).
func (l *keyRateLimiter) allow(key string, rps, burst float64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b := l.buckets[key]
	if b == nil {
		b = &tokenBucket{tokens: burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * rps
	if b.tokens > burst {
		b.tokens = burst
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}
