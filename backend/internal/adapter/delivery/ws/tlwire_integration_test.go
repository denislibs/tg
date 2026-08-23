package ws_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/domain"
)

// Провод TL от начала до конца: соединение просит формат подпротоколом, живой
// кадр уезжает БАЙТАМИ контейнера, а транспортный — по-прежнему текстом.
//
// Это единственная проверка, которая держит СВЯЗКУ целиком: развилку в Send,
// выбор подпротокола на рукопожатии и то, что бинарь читается кодеком, а не
// «похож на бинарь». Отдельные тесты кодирования на такое не отвечают.
func TestWS_TLWireDeliversUpdatesAsTL(t *testing.T) {
	env := newWSEnv(t)
	defer env.close()

	connA := dialTL(t, env.url, env.tokenA)
	defer connA.Close()
	connB := dialTL(t, env.url, env.tokenB)
	defer connB.Close()
	time.Sleep(150 * time.Millisecond) // дать обоим зарегистрироваться

	// hello — кадр ТРАНСПОРТНЫЙ (решение Р6): конструктора у него нет, поэтому
	// даже на проводе TL он уезжает текстом.
	_ = connB.SetReadDeadline(time.Now().Add(2 * time.Second))
	mt, data, err := connB.ReadMessage()
	if err != nil {
		t.Fatalf("read hello: %v", err)
	}
	if mt != websocket.TextMessage {
		t.Fatalf("hello приехал типом %d — транспортный кадр обязан остаться текстом", mt)
	}
	var hello struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(data, &hello); err != nil || hello.T != "hello" {
		t.Fatalf("первый кадр = %s (%v)", data, err)
	}

	sendFrame(t, connA, "send_message", map[string]any{
		"peer_id": env.peerB, "text": "привет", "client_msg_id": "tl-1",
	})

	// Первый БИНАРНЫЙ кадр у B — это и есть апдейт о новом сообщении.
	raw := readBinary(t, connB)
	envelope, err := domain.WireCodec.UnmarshalTree(raw)
	if err != nil {
		t.Fatalf("кодек не разобрал кадр: %v", err)
	}
	if envelope["_"] != "updateShort" {
		t.Fatalf("оболочка = %v, ожидался updateShort (у updateNewMessage свой pts)", envelope["_"])
	}
	update, ok := envelope["update"].(map[string]any)
	if !ok {
		t.Fatalf("апдейт внутри оболочки = %T", envelope["update"])
	}
	if update["_"] != "updateNewMessage" {
		t.Fatalf("апдейт = %v", update["_"])
	}
	msg, ok := update["message"].(map[string]any)
	if !ok {
		t.Fatalf("сообщение внутри апдейта = %T", update["message"])
	}
	if msg["message"] != "привет" {
		t.Fatalf("текст сообщения = %v", msg["message"])
	}
}

// Соединение БЕЗ подпротокола остаётся на JSON — умолчание не меняется.
func TestWS_WithoutSubprotocolStaysJSON(t *testing.T) {
	env := newWSEnv(t)
	defer env.close()

	connA := dial(t, env.url, env.tokenA)
	defer connA.Close()
	connB := dial(t, env.url, env.tokenB)
	defer connB.Close()
	time.Sleep(150 * time.Millisecond)

	sendFrame(t, connA, "send_message", map[string]any{
		"peer_id": env.peerB, "text": "hi", "client_msg_id": "json-1",
	})

	if got := readUntil(t, connB, "new_message"); got == nil {
		t.Fatal("B не получил new_message текстом")
	}
}

func dialTL(t *testing.T, wsURL, token string) *websocket.Conn {
	t.Helper()
	d := *websocket.DefaultDialer
	d.Subprotocols = []string{"tl.1", "bearer", token}
	c, resp, err := d.Dial(wsURL+"/", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	// Сервер обязан ВЫБРАТЬ подпротокол: без эха браузер закрыл бы соединение.
	if got := resp.Header.Get("Sec-Websocket-Protocol"); got != "tl.1" {
		t.Fatalf("сервер выбрал подпротокол %q, ожидался tl.1", got)
	}
	return c
}

// Ждёт БИНАРНЫЙ кадр, а увиденные текстовые копит: без них падение сообщало бы
// только «не дождались», и было бы не видно, уехал ли кадр текстом (то есть
// развилка не сработала) или не уехал вовсе.
func readBinary(t *testing.T, c *websocket.Conn) []byte {
	t.Helper()
	var texts []string
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_ = c.SetReadDeadline(deadline)
		mt, data, err := c.ReadMessage()
		if err != nil {
			t.Fatalf("бинарного кадра не дождались (%v); текстом приехало: %v", err, texts)
		}
		if mt == websocket.BinaryMessage {
			return data
		}
		texts = append(texts, string(data))
	}
	t.Fatalf("бинарного кадра не дождались; текстом приехало: %v", texts)
	return nil
}
