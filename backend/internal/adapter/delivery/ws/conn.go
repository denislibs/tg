package ws

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/flynn/noise"
	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/pkg/saferun"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// frameCodec абстрагирует чтение/запись байтов ОДНОГО кадра. dispatch/hub/pump
// от шифрования не зависят — DNP вклинивается только здесь.
type frameCodec interface {
	decode(raw []byte) ([]byte, error)            // WS-байты → plaintext-кадр (без kind)
	encode(kind byte, frame []byte) (int, []byte) // (kind, payload) → (websocket msgType, WS-байты)
}

// plainCodec — текущий путь: text-кадры JSON as-is.
type plainCodec struct{}

func (plainCodec) decode(raw []byte) ([]byte, error) { return raw, nil }

// kind игнорируется: plain-WS шлёт JSON-текст as-is; бинарные file-кадры на
// plain-путь не попадают.
func (plainCodec) encode(_ byte, frame []byte) (int, []byte) { return websocket.TextMessage, frame }

// dnpCodec — Noise-канал: binary + шифрование каждого кадра. send использует
// только writePump, recv — только readPump (гонок нет).
type dnpCodec struct{ send, recv *noise.CipherState }

func newDNPCodec(send, recv *noise.CipherState) frameCodec { return &dnpCodec{send: send, recv: recv} }

// frameKindJSON — единственный на сегодня kind транспортных кадров DNP (поверх
// codec-слоя seal/open): 0x00 = JSON. Байт зарезервирован под будущие бинарные
// kind'ы (например media-чанки) без смены протокола/prologue.
const frameKindJSON byte = 0x00

// frameKindFile — бинарный media-чанк (PR-1b). Первый байт plaintext внутри
// AEAD-конверта; codec seal/open остаётся байто-агностичным.
const frameKindFile byte = 0x01

func (c *dnpCodec) decode(raw []byte) ([]byte, error) {
	plain, err := dnp.DecryptFrame(c.recv, raw)
	if err != nil {
		return nil, err
	}
	if len(plain) < 1 || plain[0] != frameKindJSON {
		return nil, errors.New("dnp: unexpected frame kind")
	}
	return plain[1:], nil
}

func (c *dnpCodec) encode(kind byte, frame []byte) (int, []byte) {
	out, err := dnp.EncryptFrame(c.send, append([]byte{kind}, frame...))
	if err != nil {
		return websocket.BinaryMessage, nil // nil → writePump рвёт соединение
	}
	return websocket.BinaryMessage, out
}

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 25 * time.Second
	maxMessageSize = 1 << 20 // 1 MiB
	sendBuffer     = 32
)

// Presence is the subset of presence.Manager the connection uses (kept as an
// interface so ws doesn't import presence).
type Presence interface {
	Online(ctx context.Context, userID int64) error
	Heartbeat(ctx context.Context, userID int64) error
	Offline(ctx context.Context, userID int64) error
}

// RPCDispatcher реплеит rpc-запрос канала (реализуется в пакете http через
// RouterRPC). Несёт user+deviceID, чтобы ws не зависел от http.
type RPCDispatcher interface {
	Dispatch(ctx context.Context, user domain.User, deviceID int64, method, path string, body []byte) (int, []byte)
}

const rpcMaxConcurrent = 16

type rpcReqData struct {
	ReqID  string          `json:"req_id"`
	Method string          `json:"method"`
	Path   string          `json:"path"`
	Body   json.RawMessage `json:"body"`
}

func rpcRespFrame(reqID string, status int, body []byte) []byte {
	switch {
	case len(body) == 0:
		body = []byte("null")
	case !json.Valid(body):
		// chi's stock 404/500 handlers write plain text — wrap so the frame stays valid JSON.
		if w, err := json.Marshal(map[string]string{"error": strings.TrimSpace(string(body))}); err == nil {
			body = w
		} else {
			body = []byte("null")
		}
	}
	b, err := json.Marshal(map[string]any{
		"t": "rpc_resp",
		"d": map[string]any{"req_id": reqID, "status": status, "body": json.RawMessage(body)},
	})
	if err != nil {
		return nil // unreachable now: body is guaranteed valid JSON above
	}
	return b
}

// outFrame — единица очереди отправки: kind (0x00 JSON / 0x01 file) + payload.
type outFrame struct {
	kind byte
	data []byte
}

// Conn is one client WebSocket connection. It implements Sink.
type Conn struct {
	ws       *websocket.Conn
	hub      *Hub
	svc      *usecasechat.Interactor
	presence Presence
	user     domain.User
	userID   int64
	deviceID int64
	send     chan outFrame
	codec    frameCodec
	rpc      RPCDispatcher  // nil у plain-conn
	rpcSem   chan struct{}  // ограничение конкурентности rpc-диспатча
	file     FileDispatcher // nil у plain-conn / до SetFileDispatcher
	fileSem  chan struct{}  // ограничение конкурентности file-диспатча
	// активный групповой звонок этого соединения (0 — нет): при обрыве
	// сокета участника автоматически выводим из звонка.
	groupCallChat int64
}

func newConn(ws *websocket.Conn, hub *Hub, svc *usecasechat.Interactor, presence Presence, user domain.User, deviceID int64, codec frameCodec, rpc RPCDispatcher, file FileDispatcher) *Conn {
	return &Conn{
		ws: ws, hub: hub, svc: svc, presence: presence,
		user: user, userID: user.ID, deviceID: deviceID,
		send: make(chan outFrame, sendBuffer), codec: codec,
		rpc: rpc, rpcSem: make(chan struct{}, rpcMaxConcurrent),
		file: file, fileSem: make(chan struct{}, fileMaxConcurrent),
	}
}

// Close force-closes the underlying socket (used by the hub on revoke). The
// read pump then exits and run() cleans up.
func (c *Conn) Close() { _ = c.ws.Close() }

// Send queues a JSON frame (kind 0x00) for the writer. Drops the frame if the
// buffer is full (a stuck client must not block fan-out).
func (c *Conn) Send(frame []byte) { c.enqueue(outFrame{frameKindJSON, frame}) }

// SendBinary queues a raw binary payload (kind 0x01, media-чанк). Drop-if-full
// как Send. Плейн-conn его не зовёт (file_req обслуживается лишь при c.file != nil).
func (c *Conn) SendBinary(payload []byte) { c.enqueue(outFrame{frameKindFile, payload}) }

func (c *Conn) enqueue(f outFrame) {
	select {
	case c.send <- f:
	default:
	}
}

func (c *Conn) run(ctx context.Context) {
	// Последний рубеж: паника в этой горутине (несмотря на per-dispatch recover)
	// не должна ронять процесс. Утечка регистрации лучше краша всего сервера.
	defer saferun.Recover("ws.conn.run")
	// Register ДО hello. Иначе апдейт, закоммиченный между чтением UserState и
	// Register, ушёл бы фан-аутом только уже-зарегистрированным сокетам (этот ещё
	// не виден) и потерялся БЫ навсегда, а hello с устаревшим-но-консистентным pts
	// заставил бы клиент пропустить catch-up (want===cursor). С Register-first такой
	// апдейт доставляется живым; если он опередит hello — это безвредный дубль/
	// лишний catch-up на клиенте, но не потеря. Сбой чтения state не фатален —
	// просто без hello (клиент сделает полный catch-up).
	c.hub.Register(ctx, c.userID, c.deviceID, c)
	if st, err := c.svc.UserState(ctx, c.userID); err == nil {
		c.Send(helloFrame(st))
	}
	if c.presence != nil {
		_ = c.presence.Online(ctx, c.userID)
	}
	go c.writePump(ctx)
	c.readPump(ctx) // blocks until the connection closes
	// Cleanup must not ride the request context: on an abrupt client disconnect
	// it may already be cancelled, which would silently skip the Redis
	// unsubscribe and the offline fan-out (last_seen / presence(offline)).
	cleanupCtx := context.Background()
	if c.groupCallChat != 0 {
		_ = c.svc.LeaveGroupCall(cleanupCtx, c.groupCallChat, c.userID)
	}
	lastUser := c.hub.Unregister(cleanupCtx, c.userID, c.deviceID, c)
	if c.presence != nil && lastUser {
		_ = c.presence.Offline(cleanupCtx, c.userID)
	}
	close(c.send)
}

func (c *Conn) readPump(ctx context.Context) {
	defer c.ws.Close()
	c.ws.SetReadLimit(maxMessageSize)
	_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
		plain, err := c.codec.decode(data)
		if err != nil {
			// Для зашифрованного канала (DNP) сбой расшифровки означает
			// рассинхрон Noise-nonce — nonce строго упорядочен и продвигается
			// только при УСПЕШНОМ decrypt, поэтому один битый/потерянный/
			// переставленный кадр необратимо десинхронизирует receive-nonce:
			// все последующие кадры тоже не расшифруются, тихо и навсегда.
			// Рвём соединение — клиент переподключится и заново проведёт
			// хендшейк. Для plainCodec decode никогда не ошибается (identity),
			// поэтому эта ветка на plain-путь не влияет.
			return
		}
		var f Frame
		if json.Unmarshal(plain, &f) != nil {
			continue
		}
		c.dispatch(ctx, f)
	}
}

func (c *Conn) dispatch(ctx context.Context, f Frame) {
	// Паника при обработке одного входящего кадра не должна ронять соединение
	// (и процесс) — гасим, следующий кадр читается дальше.
	defer saferun.Recover("ws.conn.dispatch")
	switch f.T {
	case "ping":
		c.Send([]byte(`{"t":"pong"}`))
	case "send_message":
		var d sendMessageData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		if d.Type == "service" { // server-only type (group action pills)
			return
		}
		var encBody []byte
		if d.EncBody != "" {
			if b, e := base64.StdEncoding.DecodeString(d.EncBody); e == nil {
				encBody = b
			}
		}
		msg, err := c.svc.Send(ctx, usecasechat.SendInput{
			ChatID: d.ChatID, SenderID: c.userID, Type: d.Type, Text: d.Text, Entities: d.Entities,
			ReplyToID: d.ReplyToID, ReplyQuoteText: d.ReplyQuoteText, ReplyQuoteOffset: d.ReplyQuoteOffset,
			ClientMsgID: d.ClientMsgID, MediaID: d.MediaID, GroupedID: d.GroupedID,
			GeoLat: d.GeoLat, GeoLng: d.GeoLng, ContactUserID: d.ContactUserID,
			GeoTitle: d.GeoTitle, GeoAddress: d.GeoAddress,
			GeoLivePeriod: d.GeoLivePeriod, GeoHeading: d.GeoHeading,
			ThreadRootID: d.ThreadRootID,
			EncBody:      encBody, TTLSeconds: d.TTLSeconds,
			Silent: d.Silent, Effect: d.Effect,
			PaidMediaPrice: d.PaidMediaPrice,
			SendAsChatID:   d.SendAsChatID,
		})
		if err != nil {
			// NACK the sender so the client stops retrying and can clear the bubble.
			reason := "failed"
			if errors.Is(err, domain.ErrTooLong) {
				reason = "too_long"
			} else if errors.Is(err, domain.ErrSlowmode) {
				reason = "slowmode"
			} else if errors.Is(err, domain.ErrForbidden) {
				reason = "forbidden"
			} else if errors.Is(err, domain.ErrPrivacy) {
				reason = "privacy"
			} else if errors.Is(err, domain.ErrPaidRequired) {
				reason = "paid_required"
			}
			nack, _ := json.Marshal(map[string]any{
				"t": "message_error",
				"d": map[string]any{"client_msg_id": d.ClientMsgID, "reason": reason},
			})
			c.Send(nack)
			return
		}
		ack, _ := json.Marshal(map[string]any{
			"t": "message_ack",
			"d": map[string]any{"client_msg_id": d.ClientMsgID, "msg_id": msg.ID, "seq": msg.Seq, "created_at": msg.CreatedAt},
		})
		c.Send(ack)
	case "read":
		var d readData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		_ = c.svc.MarkRead(ctx, d.ChatID, c.userID, d.UpToSeq)
	case "read_media":
		var d readMediaData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		_ = c.svc.ReadMedia(ctx, d.ChatID, c.userID, d.MsgID)
	case "typing":
		var d typingData
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		_ = c.svc.Typing(ctx, d.ChatID, c.userID, d.Action)
	case "subscribe_channel":
		var d struct {
			ChatID int64 `json:"chat_id"`
		}
		if json.Unmarshal(f.D, &d) == nil && d.ChatID != 0 {
			c.hub.SubscribeChannel(ctx, d.ChatID, c)
		}
	case "unsubscribe_channel":
		var d struct {
			ChatID int64 `json:"chat_id"`
		}
		if json.Unmarshal(f.D, &d) == nil && d.ChatID != 0 {
			c.hub.UnsubscribeChannel(ctx, d.ChatID, c)
		}
	// 1:1 call signaling (WebRTC): the server is a dumb relay — the frame is
	// re-addressed to every device of to_user_id with from_user_id stamped in.
	case "call_request", "call_accept", "call_decline", "call_end", "call_signal":
		var d map[string]any
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		to, _ := d["to_user_id"].(float64)
		delete(d, "to_user_id")
		_ = c.svc.RelayCall(ctx, f.T, c.userID, int64(to), d)
	// Групповой звонок: join/leave меняют список участников (+фан-аут
	// group_call_update членам чата), signal — адресное реле SDP/ICE.
	case "group_call_join":
		var d struct {
			ChatID int64 `json:"chat_id"`
		}
		if json.Unmarshal(f.D, &d) != nil || d.ChatID == 0 {
			return
		}
		if _, err := c.svc.JoinGroupCall(ctx, d.ChatID, c.userID); err == nil {
			c.groupCallChat = d.ChatID
		}
	case "group_call_leave":
		var d struct {
			ChatID int64 `json:"chat_id"`
		}
		if json.Unmarshal(f.D, &d) != nil || d.ChatID == 0 {
			return
		}
		_ = c.svc.LeaveGroupCall(ctx, d.ChatID, c.userID)
		if c.groupCallChat == d.ChatID {
			c.groupCallChat = 0
		}
	case "group_call_signal":
		var d map[string]any
		if json.Unmarshal(f.D, &d) != nil {
			return
		}
		to, _ := d["to_user_id"].(float64)
		chatID, _ := d["chat_id"].(float64)
		delete(d, "to_user_id")
		_ = c.svc.RelayGroupCallSignal(ctx, c.userID, int64(chatID), int64(to), d)
	case "rpc_req":
		if c.rpc == nil {
			return // plain-conn: RPC не обслуживает
		}
		var d rpcReqData
		if json.Unmarshal(f.D, &d) != nil || d.ReqID == "" {
			return
		}
		// Неблокирующий гейт конкурентности: не стопорим read-pump, сбрасываем нагрузку 503.
		select {
		case c.rpcSem <- struct{}{}:
		default:
			c.Send(rpcRespFrame(d.ReqID, 503, []byte(`{"error":"rpc busy"}`)))
			return
		}
		rpc, user, deviceID := c.rpc, c.user, c.deviceID
		reqID, method, path, body := d.ReqID, d.Method, d.Path, d.Body
		go func() {
			defer func() { <-c.rpcSem }()
			defer saferun.Recover("ws.conn.rpc")
			status, respBody := rpc.Dispatch(context.Background(), user, deviceID, method, path, body)
			c.Send(rpcRespFrame(reqID, status, respBody))
		}()
	case "file_req":
		if c.file == nil {
			return // plain-conn / до SetFileDispatcher: file_req не обслуживаем
		}
		var d fileReqData
		if json.Unmarshal(f.D, &d) != nil || d.ReqID == 0 || d.MediaID == 0 {
			return
		}
		// Неблокирующий гейт: не стопорим read-pump; переполнение → file_err "busy".
		select {
		case c.fileSem <- struct{}{}:
		default:
			c.Send(fileErrFrame(d.ReqID, "busy"))
			return
		}
		file, userID := c.file, c.userID
		reqID, mediaID, offset, limit := d.ReqID, d.MediaID, d.Offset, d.Limit
		go func() {
			defer func() { <-c.fileSem }()
			defer saferun.Recover("ws.conn.file")
			data, total, err := file.ReadPart(context.Background(), userID, mediaID, offset, limit)
			if err != nil {
				msg := "error"
				if errors.Is(err, domain.ErrForbidden) {
					msg = "forbidden"
				}
				c.Send(fileErrFrame(reqID, msg))
				return
			}
			c.SendBinary(fileChunkFrame(reqID, offset, total, data))
		}()
	}
}

func (c *Conn) writePump(ctx context.Context) {
	defer saferun.Recover("ws.conn.writePump")
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.ws.Close()
	}()
	for {
		select {
		case f, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			mt, out := c.codec.encode(f.kind, f.data)
			if out == nil {
				return // сбой шифрования — рвём соединение (клиент переустановит канал)
			}
			if err := c.ws.WriteMessage(mt, out); err != nil {
				return
			}
		case <-ticker.C:
			if c.presence != nil {
				_ = c.presence.Heartbeat(ctx, c.userID)
			}
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
