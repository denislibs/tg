package ws

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/flynn/noise"
	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
)

// objFileDisp — offset-осведомлённый fake FileDispatcher: в отличие от
// fakeFileDisp (file_dispatch_test.go), который отдаёт фиксированные байты
// независимо от offset, этот режет реальный объект по [offset:offset+limit],
// чтобы тест ниже действительно проверял offset-слайсинг, а не просто эхо.
type objFileDisp struct{ obj []byte }

func (f objFileDisp) ReadPart(_ context.Context, _, _, offset, limit int64) ([]byte, int64, error) {
	total := int64(len(f.obj))
	if offset >= total {
		return nil, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return f.obj[offset:end], total, nil
}

// TestDNPChannelFileReqEndToEnd проверяет сквозной путь media-чанков: flynn/noise
// NK initiator поднимает DNP-канал (хендшейк + auth), затем шлёт file_req с
// НЕНУЛЕВЫМ offset внутри канала — сервер (dnpAccept → newConn → conn.dispatch)
// асинхронно диспетчит его через FileDispatcher и отвечает БИНАРНЫМ file_chunk
// (kind 0x01, а не JSON) по тому же зашифрованному каналу. Это регрессионный
// сторож живого пути: хендшейк/auth/nonce-последовательность/async-диспатч +
// бинарный фрейминг — см. также TestDNPChannelRPCEndToEnd (JSON-путь).
func TestDNPChannelFileReqEndToEnd(t *testing.T) {
	serverPriv := bytes.Repeat([]byte{0x11}, 32)
	cs := dnpSuite()
	serverStatic, _ := cs.GenerateKeypair(fixedReader{serverPriv})

	obj := []byte("0123456789abcdef") // total=16
	fileDisp := objFileDisp{obj: obj}

	up := websocket.Upgrader{Subprotocols: []string{"dnp/2"}, CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsConn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		codec, user, deviceID, err := dnpAccept(r.Context(), wsConn, serverPriv, fakeAuth{token: "good"})
		if err != nil {
			_ = wsConn.Close()
			return
		}
		c := newConn(wsConn, nil, nil, nil, user, deviceID, codec, nil, fileDisp)
		go c.writePump(context.Background())
		c.readPump(context.Background())
	}))
	defer srv.Close()

	// Клиент: flynn/noise NK initiator по dnp/2 (та же обвязка, что в
	// TestDNPChannelRPCEndToEnd — не дублируем, а прогоняем file_req/file_chunk).
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	d := websocket.Dialer{Subprotocols: []string{"dnp/2"}}
	conn, _, err := d.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	initHS, _ := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: rand.Reader, Pattern: noise.HandshakeNK,
		Initiator: true, Prologue: []byte("dnp/2"), PeerStatic: serverStatic.Public,
	})
	msg1, _, _, _ := initHS.WriteMessage(nil, nil)
	_ = conn.WriteMessage(websocket.BinaryMessage, dnp.FrameLen(msg1))

	_, raw, _ := conn.ReadMessage()
	m2, _ := dnp.UnframeLen(raw)
	_, iSend, iRecv, err := initHS.ReadMessage(nil, m2)
	if err != nil {
		t.Fatalf("read msg2: %v", err)
	}

	// auth-кадр (sealed, kind-байт 0x00=JSON поверх seal-слоя).
	authWire, _ := dnp.EncryptFrame(iSend, kindJSON([]byte(`{"t":"auth","d":{"token":"good"}}`)))
	_ = conn.WriteMessage(websocket.BinaryMessage, authWire)

	// file_req внутри канала (sealed): offset=4 нарочно ненулевой, чтобы
	// отличить эхо запрошенного offset от захардкоженного нуля.
	reqWire, err := dnp.EncryptFrame(iSend, kindJSON([]byte(`{"t":"file_req","d":{"req_id":7,"media_id":5,"offset":4,"limit":512}}`)))
	if err != nil {
		t.Fatalf("encrypt file_req: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, reqWire); err != nil {
		t.Fatalf("write file_req: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, respRaw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read file_chunk: %v", err)
	}
	plainFramed, err := dnp.DecryptFrame(iRecv, respRaw)
	if err != nil {
		t.Fatalf("decrypt file_chunk: %v", err)
	}

	// Ответ — file_chunk (kind 0x01), НЕ JSON: stripKind тут не подходит
	// (он проверяет kind 0x00).
	if len(plainFramed) < 1 || plainFramed[0] != frameKindFile {
		t.Fatalf("bad frame kind: %x", plainFramed)
	}
	body := plainFramed[1:]
	if len(body) < 24 {
		t.Fatalf("file_chunk header too short: %d bytes", len(body))
	}

	reqID := binary.BigEndian.Uint32(body[0:4])
	offset := binary.BigEndian.Uint64(body[4:12])
	total := binary.BigEndian.Uint64(body[12:20])
	length := binary.BigEndian.Uint32(body[20:24])
	data := body[24 : 24+length]

	if reqID != 7 {
		t.Fatalf("req_id = %d, want 7", reqID)
	}
	if offset != 4 {
		t.Fatalf("offset = %d, want 4 (эхо запрошенного offset)", offset)
	}
	if total != 16 {
		t.Fatalf("total = %d, want 16", total)
	}
	if string(data) != "456789abcdef" {
		t.Fatalf("data = %q, want %q", data, "456789abcdef")
	}
}
