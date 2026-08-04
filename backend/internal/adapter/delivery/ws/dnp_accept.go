package ws

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"time"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
	"github.com/messenger-denis/backend/internal/domain"
)

const dnpHandshakeWait = 10 * time.Second

// dnpAccept выполняет Noise_NK хендшейк по уже апгрейженному сокету и авторизацию
// первым кадром внутри канала. Возвращает готовый dnpCodec и пользователя.
func dnpAccept(ctx context.Context, wsConn *websocket.Conn, serverPriv []byte, auth Authenticator) (frameCodec, domain.User, int64, error) {
	responder, err := dnp.NewResponder(serverPriv, rand.Reader)
	if err != nil {
		return nil, domain.User{}, 0, err
	}
	_ = wsConn.SetReadDeadline(time.Now().Add(dnpHandshakeWait))

	// msg1 (e, es)
	msg1, err := readWSFramed(wsConn)
	if err != nil {
		return nil, domain.User{}, 0, err
	}
	if err := responder.ReadMessage1(msg1); err != nil {
		return nil, domain.User{}, 0, err
	}
	// msg2 (e, ee)
	msg2, err := responder.WriteMessage2()
	if err != nil {
		return nil, domain.User{}, 0, err
	}
	_ = wsConn.SetWriteDeadline(time.Now().Add(dnpHandshakeWait))
	if err := wsConn.WriteMessage(websocket.BinaryMessage, dnp.FrameLen(msg2)); err != nil {
		return nil, domain.User{}, 0, err
	}
	send, recv := responder.Split()

	// первый кадр внутри канала — auth{token}
	authCiphertext, err := readWSFramed(wsConn)
	if err != nil {
		return nil, domain.User{}, 0, err
	}
	plain, err := dnp.Open(recv, authCiphertext) // длина уже снята readWSFramed
	if err != nil {
		return nil, domain.User{}, 0, err
	}
	var f struct {
		T string `json:"t"`
		D struct {
			Token string `json:"token"`
		} `json:"d"`
	}
	if json.Unmarshal(plain, &f) != nil || f.T != "auth" || f.D.Token == "" {
		return nil, domain.User{}, 0, errors.New("dnp: expected auth frame")
	}
	user, deviceID, err := auth.Authenticate(ctx, f.D.Token)
	if err != nil {
		return nil, domain.User{}, 0, err
	}
	_ = wsConn.SetReadDeadline(time.Time{}) // снять дедлайн хендшейка
	return newDNPCodec(send, recv), user, deviceID, nil
}

// readWSFramed читает бинарное WS-сообщение и снимает length-префикс.
func readWSFramed(wsConn *websocket.Conn) ([]byte, error) {
	mt, data, err := wsConn.ReadMessage()
	if err != nil {
		return nil, err
	}
	if mt != websocket.BinaryMessage {
		return nil, errors.New("dnp: expected binary frame")
	}
	return dnp.UnframeLen(data)
}
