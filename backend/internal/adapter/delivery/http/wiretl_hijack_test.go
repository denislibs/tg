package http

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Апгрейд WebSocket проходит СКВОЗЬ middleware провода.
//
// Почему тест именно такой. `wireWriter` оборачивает `ResponseWriter` у КАЖДОГО
// запроса, включая `/ws`. Возможности нижнего writer'а он отдаёт через
// `Unwrap`, но `Unwrap` понимает только `http.ResponseController` — а
// gorilla/websocket спрашивает ПРЯМЫМ приведением `w.(http.Hijacker)`. Пока
// метода не было, приведение проваливалось, и `Upgrader.Upgrade` отвечал
// 500 «websocket: response does not implement http.Hijacker»: реалтайма не было
// ВООБЩЕ — ни кадров, ни присутствия, ни отметок прочтения.
//
// Ловится это только сквозным вопросом «умеет ли writer, дошедший до ручки,
// хайджек», а не проверкой самого `wireWriter` в изоляции: в изоляции метод
// есть и без цепочки. Поэтому стенд — настоящий `WireTL` поверх настоящего
// `httptest`-сервера.
func TestWireTL_PassesHijackerThrough(t *testing.T) {
	var (
		gotHijacker bool
		hijackErr   error
	)

	h := WireTL(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hj, ok := w.(http.Hijacker)
		gotHijacker = ok
		if !ok {
			return
		}
		var conn net.Conn
		conn, _, hijackErr = hj.Hijack()
		if conn != nil {
			_ = conn.Close()
		}
	}))

	srv := httptest.NewServer(h)
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err == nil {
		_ = resp.Body.Close()
	}

	if !gotHijacker {
		t.Fatal("writer, дошедший до ручки, не умеет Hijack: апгрейд /ws ответит 500 и реалтайма не будет")
	}
	if hijackErr != nil {
		t.Fatalf("Hijack вернул ошибку: %v", hijackErr)
	}
}

// Нижний writer хайджек не умеет (HTTP/2) — обёртка обязана отдать ШТАТНЫЙ
// отказ, а не панику: для вызывающего это «апгрейд невозможен», и он должен
// суметь ответить клиенту сам.
func TestWireTL_HijackUnsupportedIsAnError(t *testing.T) {
	w := &wireWriter{ResponseWriter: noHijackWriter{httptest.NewRecorder()}}

	if _, _, err := w.Hijack(); err == nil {
		t.Fatal("ждали ошибку, когда нижний writer не Hijacker")
	}
}

// noHijackWriter прячет `Hijack` у рекордера: `httptest.ResponseRecorder` его и
// так не имеет, но обёртка делает намерение явным.
type noHijackWriter struct{ http.ResponseWriter }
