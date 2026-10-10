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

	sendFrame(t, connA, "send_message", map[string]any{
		"peer_id": env.peerB, "text": "привет", "client_msg_id": "tl-1",
	})

	// Бинарный кадр у B с новым сообщением. Кадр присутствия A (его «в
	// сети» после подключения) может приехать раньше — он к предмету теста
	// не относится и пропускается.
	var envelope map[string]any
	for envelope == nil {
		raw := readBinary(t, connB)
		env, err := domain.WireCodec.UnmarshalTree(raw)
		if err != nil {
			t.Fatalf("кодек не разобрал кадр: %v", err)
		}
		if u, _ := env["update"].(map[string]any); u != nil && u["_"] == "updateUserStatus" {
			continue
		}
		if list, _ := env["updates"].([]any); len(list) == 1 {
			if u, _ := list[0].(map[string]any); u != nil && u["_"] == "updateUserStatus" {
				continue
			}
		}
		envelope = env
	}
	// Первый кадр от A — с карточкой A (A4-05): у updateShort векторов нет,
	// поэтому оболочка — updates; seq 0, курсор у updateNewMessage свой.
	if envelope["_"] != "updates" {
		t.Fatalf("оболочка = %v, ожидался updates с карточкой автора", envelope["_"])
	}
	if users, _ := envelope["users"].([]any); len(users) == 0 {
		t.Fatalf("кадр без карточки автора: %v", envelope["users"])
	}
	list, _ := envelope["updates"].([]any)
	if len(list) != 1 {
		t.Fatalf("апдейтов в оболочке = %d", len(list))
	}
	update, ok := list[0].(map[string]any)
	if !ok {
		t.Fatalf("апдейт внутри оболочки = %T", list[0])
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

	// message_ack — кадр ТРАНСПОРТНЫЙ (решение Р6): конструктора у него нет,
	// поэтому даже на проводе TL он уезжает текстом. Бинарные кадры A
	// (присутствие B) к предмету не относятся и пропускаются.
	_ = connA.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		mt, data, err := connA.ReadMessage()
		if err != nil {
			t.Fatalf("A не получил message_ack текстом: %v", err)
		}
		if mt == websocket.BinaryMessage {
			continue
		}
		var f struct {
			T string `json:"t"`
		}
		if err := json.Unmarshal(data, &f); err != nil || f.T != "message_ack" {
			t.Fatalf("текстовый кадр A = %s (%v), want message_ack", data, err)
		}
		break
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
