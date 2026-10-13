package http

import (
	"math"
	"sync"
	"time"
)

// keyRateLimiter — token-bucket на ключ (rps + burst). Общий для Bot API и
// анти-брутфорса auth-роутов. Потокобезопасен; бакеты создаются лениво.
type keyRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket
	idle    time.Duration // через сколько простоя бакет можно выбросить
}

type tokenBucket struct {
	tokens float64
	last   time.Time
}

func newKeyRateLimiter() *keyRateLimiter { return newKeyRateLimiterIdle(limiterIdle) }

// newKeyRateLimiterIdle — лимитер со своим сроком простоя ведра: для ключей,
// которых заводят много и случайно (QR-вход), он короче общего.
func newKeyRateLimiterIdle(idle time.Duration) *keyRateLimiter {
	return &keyRateLimiter{buckets: map[string]*tokenBucket{}, idle: idle}
}

// allow пропускает запрос по ключу с заданной скоростью (rps) и «ведром» (burst).
func (l *keyRateLimiter) allow(key string, rps, burst float64) bool {
	ok, _ := l.allowWait(key, rps, burst)
	return ok
}

// allowWait — как allow, плюс при отказе число целых секунд (≥ 1), через
// которое в ведре появится токен: из него строится FLOOD_WAIT_<N>.
func (l *keyRateLimiter) allowWait(key string, rps, burst float64) (ok bool, waitSec int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b := l.buckets[key]
	if b == nil {
		l.sweep(now)
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
		return true, 0
	}
	if rps <= 0 {
		return false, 1
	}
	return false, max(1, int(math.Ceil((1-b.tokens)/rps)))
}

// limiterMaxBuckets — сколько ключей держится без уборки; дальше бакеты,
// не тронутые limiterIdle, выбрасываются (они всё равно полны: за это время
// любая скорость дольёт ведро до burst).
const (
	limiterMaxBuckets = 50000
	limiterIdle       = 10 * time.Minute
)

func (l *keyRateLimiter) sweep(now time.Time) {
	if len(l.buckets) < limiterMaxBuckets {
		return
	}
	for k, b := range l.buckets {
		if now.Sub(b.last) > l.idle {
			delete(l.buckets, k)
		}
	}
}
