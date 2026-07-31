// Package saferun восстанавливает панику в detached-горутинах, чтобы одна
// упавшая фоновая задача не роняла весь процесс. chi middleware.Recoverer
// покрывает только горутину HTTP-хендлера; фоновые горутины (WS fan-out,
// ffmpeg над загруженным медиа, парсинг чужого HTML для превью, воркеры) без
// собственного recover при панике убивают весь сервер (Go: неперехваченная
// паника в любой горутине завершает программу).
package saferun

import (
	"log"
	"runtime/debug"
)

// Recover — deferred-гард: логирует панику со стеком и гасит её. Ставить первым
// defer в теле фоновой горутины/обработчика, который не должен ронять процесс.
func Recover(name string) {
	if r := recover(); r != nil {
		log.Printf("saferun: panic in %s: %v\n%s", name, r, debug.Stack())
	}
}

// Go запускает fn в отдельной горутине под Recover.
func Go(name string, fn func()) {
	go func() {
		defer Recover(name)
		fn()
	}()
}
