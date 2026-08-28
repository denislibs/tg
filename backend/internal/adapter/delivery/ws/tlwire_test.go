package ws

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/domain"
)

// Кадр-АПДЕЙТ уезжает контейнером Updates, а кадр без конструктора — как был.
//
// Проверяется не «функция что-то вернула», а РАЗВИЛКА: на проводе TL текстовый
// кадр означает «не апдейт», и второго признака у нас нет. Ошибись развилка —
// клиент либо не разберёт транспортный кадр как TL, либо пропустит апдейт.
func TestTLEncodeUpdateFrame_OnlyConstructors(t *testing.T) {
	msg := domain.MessageReal{Underscore: domain.MessageTag, ID: 12,
		PeerID: domain.NewPeerUser(7), Date: 1787334148, Message: "привет"}
	body, err := json.Marshal(domain.NewUpdateNewMessage(msg, 41))
	if err != nil {
		t.Fatalf("тело кадра: %v", err)
	}
	frame, err := json.Marshal(map[string]any{"t": "new_message", "d": json.RawMessage(body)})
	if err != nil {
		t.Fatalf("кадр: %v", err)
	}

	out, ok := tlEncodeUpdateFrame(frame)
	if !ok {
		t.Fatal("кадр с конструктором обязан кодироваться")
	}
	// Первые четыре байта — id оболочки updateShort#78d4dec1 (little-endian).
	if got := hex.EncodeToString(out[:4]); got != "c1ded478" {
		t.Fatalf("оболочка = %s, ожидался updateShort", got)
	}

	// Транспортный кадр (решение Р6) конструктора не имеет — кодировать нечего.
	hello, _ := json.Marshal(map[string]any{"t": "hello", "d": map[string]any{"pts": 5, "date": 1}})
	if _, ok := tlEncodeUpdateFrame(hello); ok {
		t.Fatal("транспортный кадр не должен кодироваться в TL")
	}

	// Непортированный предмет — тоже: у folder_update конструктора ещё нет (#51).
	folder, _ := json.Marshal(map[string]any{"t": "folder_update", "d": map[string]any{"id": 1, "title": "Работа"}})
	if _, ok := tlEncodeUpdateFrame(folder); ok {
		t.Fatal("кадр без конструктора не должен кодироваться в TL")
	}
}

// Курсор из КОНВЕРТА обязан доехать до контейнера: у кадров, чей конструктор
// `pts` не объявляет, другого места у него нет вовсе.
func TestTLEncodeUpdateFrame_EnvelopeCursorBecomesSeq(t *testing.T) {
	body, err := json.Marshal(domain.NewUpdateDialogPinned(domain.NewPeerUser(7), true))
	if err != nil {
		t.Fatalf("тело кадра: %v", err)
	}
	frame, err := json.Marshal(map[string]any{"t": "dialog_pin", "d": json.RawMessage(body), "pts": 42})
	if err != nil {
		t.Fatalf("кадр: %v", err)
	}

	out, ok := tlEncodeUpdateFrame(frame)
	if !ok {
		t.Fatal("кадр с конструктором обязан кодироваться")
	}
	if got := hex.EncodeToString(out[:4]); got != "4042ae74" {
		t.Fatalf("оболочка = %s, ожидался updates (курсор едет seq)", got)
	}
	// Последние четыре байта контейнера — seq: он и есть курсор кадра.
	if got := hex.EncodeToString(out[len(out)-4:]); got != "2a000000" {
		t.Fatalf("seq контейнера = %s, ожидался 42", got)
	}
}

// Тот же кадр БЕЗ выбранного подпротокола уезжает JSON-текстом: формат — это
// свойство соединения, и умолчание не меняется.
func TestPlainCodec_TLKindGoesBinary(t *testing.T) {
	c := plainCodec{}
	if mt, _ := c.encode(frameKindJSON, []byte(`{"t":"x"}`)); mt != websocket.TextMessage {
		t.Fatalf("JSON обязан ехать текстом, а поехал %d", mt)
	}
	if mt, _ := c.encode(frameKindTL, []byte{0x01, 0x02}); mt != websocket.BinaryMessage {
		t.Fatalf("TL обязан ехать бинарём, а поехал %d", mt)
	}
}

// Имя подпротокола не должно уходить в аутентификацию токеном: иначе выбор
// формата провода ломал бы вход.
func TestWSToken_IgnoresKnownSubprotocols(t *testing.T) {
	r := newSubprotocolRequest(t, "tl.1, bearer, deadbeef")
	if got := wsToken(r); got != "deadbeef" {
		t.Fatalf("токен = %q", got)
	}
	if !hasSubprotocol(r, wireTLSubprotocol) {
		t.Fatal("подпротокол tl.1 не распознан")
	}
}

func newSubprotocolRequest(t *testing.T, value string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/ws", nil)
	r.Header.Set("Sec-Websocket-Protocol", value)
	return r
}

// Счётчики поста канала кодируются в TL так же, как всё остальное: своим
// конструктором из таблицы схемы. Просмотры — конструктор ОРИГИНАЛА
// (updateChannelMessageViews#f226ac08), комментарии — наш
// (updateChannelMessageReplies#c8022fb8, id назначен тем же правилом CRC32 по
// строке определения, что и у остальных наших).
//
// Курсора у обоих нет ни в конструкторе, ни в конверте — оболочкой становится
// updateShort, как у любого кадра без курсора (печатает/присутствие).
func TestTLEncodeUpdateFrame_PostCounters(t *testing.T) {
	for _, tc := range []struct {
		name string
		typ  string
		body any
	}{
		{"просмотры", "views_update", domain.NewUpdateChannelMessageViews(42, 7, 1234)},
		{"комментарии", "replies_update", domain.NewUpdateChannelMessageReplies(42, 7, 3)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.body)
			if err != nil {
				t.Fatalf("тело кадра: %v", err)
			}
			frame, _ := json.Marshal(map[string]any{"t": tc.typ, "d": json.RawMessage(raw)})
			out, ok := tlEncodeUpdateFrame(frame)
			if !ok {
				t.Fatal("кадр с конструктором обязан кодироваться в TL")
			}
			if got := hex.EncodeToString(out[:4]); got != "c1ded478" {
				t.Fatalf("оболочка = %s, ожидался updateShort", got)
			}
		})
	}
}
