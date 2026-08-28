package http

import (
	"bufio"
	"net"
	"net/http"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// Провод REST: JSON либо TL — по договорённости, заключённой ЗАГОЛОВКОМ.
//
// Тот же приём, что уже работает у сокета, где провод выбирается подпротоколом
// `tl.1` на рукопожатии: формат — свойство СОЕДИНЕНИЯ (здесь — запроса), а не
// витрины. Одна и та же витрина уезжает JSON-текстом старому клиенту и байтами
// TL новому, и второй формы витрины для этого не требуется.

// WireTLContentType — тип тела на проводе TL. Своё имя, а не
// `application/octet-stream`: тело это ЗНАЧЕНИЕ СХЕМЫ, а не безымянные байты, и
// клиент отличает его от медиа-чанка по одному взгляду на заголовок.
const WireTLContentType = "application/x-tl"

// wireWriter — ResponseWriter, помеченный выбранным проводом.
//
// Метку ставит middleware по заголовку `Accept`; витрины её не спрашивают
// вовсе — за них это делает writeJSON. Иначе договорённость о проводе пришлось
// бы протащить параметром через двести мест, которые о ней ничего не знают.
type wireWriter struct {
	http.ResponseWriter
	tl bool
}

// Unwrap — доступ к исходному writer'у для http.ResponseController (Flush,
// Hijack): обёртка не должна отнимать у стрима медиа его возможности.
func (w *wireWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Hijack — ОТДЕЛЬНО от Unwrap, и это не дублирование.
//
// `Unwrap` понимает только `http.ResponseController` (Go 1.20+). Кто спрашивает
// возможность ПРЯМЫМ приведением `w.(http.Hijacker)` — а так делает
// gorilla/websocket в `Upgrader.Upgrade` — обёртки не видит и получает отказ.
// Цена ошибки здесь не косметическая: без Hijack апгрейд `/ws` отвечает
// 500 «websocket: response does not implement http.Hijacker», то есть
// реалтайма нет ВООБЩЕ — ни кадров, ни присутствия, ни отметок прочтения.
//
// Возвращаем ошибку, а не паникуем, если нижний writer хайджек не умеет
// (HTTP/2): для вызывающего это штатный отказ апгрейда.
func (w *wireWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return h.Hijack()
}

// WireTL — middleware договорённости о проводе. Клиент просит TL заголовком
// `Accept: application/x-tl`; всё остальное (включая отсутствие заголовка)
// остаётся на JSON.
func WireTL(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(&wireWriter{ResponseWriter: w, tl: acceptsTL(r)}, r)
	})
}

func acceptsTL(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept"), ",") {
		if strings.TrimSpace(strings.SplitN(part, ";", 2)[0]) == WireTLContentType {
			return true
		}
	}
	return false
}

// encodeTL пробует записать витрину проводом TL.
//
// Не вышло — значит у витрины нет конструктора, и это не ошибка: границы шага
// A/B разбора названы явно (чужие протоколы — Bot API, WebAuthn, ICE; транспорт
// медиа; свои подсистемы без предмета в схеме). Такая витрина уезжает JSON-ом
// на ЛЮБОМ проводе, а клиент различает их по Content-Type ответа — ровно так
// же, как сокет различает кадр без конструктора.
func encodeTL(w http.ResponseWriter, status int, v any) bool {
	ww, ok := w.(*wireWriter)
	if !ok || !ww.tl {
		return false
	}
	body, err := domain.WireCodec.Marshal(v)
	if err != nil {
		return false
	}
	w.Header().Set("Content-Type", WireTLContentType)
	w.WriteHeader(status)
	_, _ = w.Write(body)
	return true
}
