package ws

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/flynn/noise"
	"github.com/gorilla/websocket"
	httptransport "github.com/messenger-denis/backend/internal/adapter/delivery/http"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// upFakeRepo — минимальный usecasemedia.MediaRepo: единственная строка (media
// ID=5), OwnerID совпадает с userID, который fakeAuth{token:"good"} возвращает
// (42, см. dnp_accept_test.go) — иначе StreamUploads.WriteChunk вернул бы
// ErrForbidden. Остальные методы интерфейса (multipart-путь, #137) здесь не
// задействованы — заглушки.
type upFakeRepo struct{ m domain.Media }

func (r *upFakeRepo) Create(_ context.Context, m domain.Media) (domain.Media, error) { return m, nil }

func (r *upFakeRepo) GetByID(_ context.Context, id int64) (domain.Media, error) {
	if id == r.m.ID {
		return r.m, nil
	}
	return domain.Media{}, domain.ErrNotFound
}

func (r *upFakeRepo) UpdateProcessed(_ context.Context, _ int64, _, _, _ int, _ string) error {
	return nil
}
func (r *upFakeRepo) SetUploadID(_ context.Context, _ int64, uploadID string) (string, error) {
	return uploadID, nil
}
func (r *upFakeRepo) SetUploadTotal(_ context.Context, _ int64, _ int) error { return nil }
func (r *upFakeRepo) SavePart(_ context.Context, _ int64, _ int, _ string, _ int64) error {
	return nil
}
func (r *upFakeRepo) ReceivedParts(_ context.Context, _ int64) ([]int, error) { return nil, nil }
func (r *upFakeRepo) PartsForComplete(_ context.Context, _ int64) ([]usecasemedia.UploadedPart, error) {
	return nil, nil
}
func (r *upFakeRepo) UpdateFinalized(_ context.Context, _ int64, _ int64, _, _, _ int, _, _ string) error {
	return nil
}
func (r *upFakeRepo) ClearUpload(_ context.Context, _ int64) error { return nil }

// upFakeStorage — минимальный usecasemedia.ObjectStorage: PutObject реально
// читает io.Pipe до EOF и кладёт байты по ключу (то, что StreamUploads
// использует для сборки объекта). Остальные методы (multipart, presign) в
// этом e2e не участвуют — заглушки.
type upFakeStorage struct{ blobs map[string][]byte }

func (s *upFakeStorage) Bucket() string { return "media" }
func (s *upFakeStorage) PresignedPut(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://put/" + key, nil
}
func (s *upFakeStorage) PresignedGet(_ context.Context, key string, _ time.Duration) (string, error) {
	return "http://get/" + key, nil
}
func (s *upFakeStorage) PutObject(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	if s.blobs == nil {
		s.blobs = map[string][]byte{}
	}
	s.blobs[key] = b
	return nil
}
func (s *upFakeStorage) GetObject(_ context.Context, _ string) (io.ReadSeekCloser, usecasemedia.ObjectInfo, error) {
	return nil, usecasemedia.ObjectInfo{}, domain.ErrNotFound
}
func (s *upFakeStorage) StartMultipart(_ context.Context, _, _ string) (string, error) {
	return "", nil
}
func (s *upFakeStorage) PutPart(_ context.Context, _, _ string, _ int, _ io.Reader, _ int64) (string, error) {
	return "", nil
}
func (s *upFakeStorage) CompleteMultipart(_ context.Context, _, _ string, _ []usecasemedia.UploadedPart) error {
	return nil
}
func (s *upFakeStorage) AbortMultipart(_ context.Context, _, _ string) error { return nil }

// assertFileUpOk парсит JSON file_up_ok и сверяет req_id (зеркало containsErr
// в upload_dispatch_test.go, но для позитивного ack).
func assertFileUpOk(t *testing.T, b []byte, wantReqID uint32) {
	t.Helper()
	var f struct {
		T string `json:"t"`
		D struct {
			ReqID uint32 `json:"req_id"`
		} `json:"d"`
	}
	if json.Unmarshal(b, &f) != nil {
		t.Fatalf("bad json: %s", b)
	}
	if f.T != "file_up_ok" || f.D.ReqID != wantReqID {
		t.Fatalf("expected file_up_ok req_id=%d, got %s", wantReqID, b)
	}
}

// TestDNPChannelFileUpEndToEnd проверяет сквозной upload-стрим: живой
// flynn/noise NK initiator (та же обвязка, что TestDNPChannelFileReqEndToEnd/
// TestDNPChannelRPCEndToEnd — хендшейк не дублируем) стримит 2 бинарных
// file_up-кадра (kind 0x02, offset 0 и 3) по каналу; сервер диспатчит их
// через РЕАЛЬНЫЙ usecasemedia.StreamUploads (не fake на уровне ws) поверх
// fake MediaRepo/ObjectStorage — так e2e проверяет не только оба ack
// file_up_ok, но и то, что StreamUploads реально собрал объект в fakeStorage
// из offset-ordered чанков (io.Pipe → PutObject), т.е. весь путь
// ws.dispatchFileUp → http.MediaUploader → usecase.StreamUploads целиком.
func TestDNPChannelFileUpEndToEnd(t *testing.T) {
	serverPriv := bytes.Repeat([]byte{0x11}, 32)
	cs := dnpSuite()
	serverStatic, _ := cs.GenerateKeypair(fixedReader{serverPriv})

	// auth-userID канала (fakeAuth{token:"good"} → domain.User{ID: 42}) должен
	// совпасть с OwnerID медиа, иначе StreamUploads вернёт ErrForbidden.
	repo := &upFakeRepo{m: domain.Media{ID: 5, OwnerID: 42, ObjectKey: "k", Size: 6, Mime: "application/octet-stream"}}
	storage := &upFakeStorage{}
	su := usecasemedia.NewStreamUploads(usecasemedia.New(repo, storage, nil))
	uploader := httptransport.NewMediaUploader(su)

	up := websocket.Upgrader{Subprotocols: []string{"dnp.2"}, CheckOrigin: func(*http.Request) bool { return true }}
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
		c := newConn(wsConn, nil, nil, nil, user, deviceID, codec, nil, nil)
		c.SetUploadDispatcher(uploader)
		go c.writePump(context.Background())
		c.readPump(context.Background())
	}))
	defer srv.Close()

	// Клиент: flynn/noise NK initiator по dnp.2 (та же обвязка, что в
	// TestDNPChannelFileReqEndToEnd — не дублируем).
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	d := websocket.Dialer{Subprotocols: []string{"dnp.2"}}
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

	// Первый чанк: offset=0, total=6, data={1,2,3} (kind 0x02 = file_up).
	chunk1, err := dnp.EncryptFrame(iSend, append([]byte{0x02}, fileUpFrame(7, 5, 0, 6, []byte{1, 2, 3})...))
	if err != nil {
		t.Fatalf("encrypt chunk1: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, chunk1); err != nil {
		t.Fatalf("write chunk1: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, ack1Raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ack1: %v", err)
	}
	ack1Framed, err := dnp.DecryptFrame(iRecv, ack1Raw)
	if err != nil {
		t.Fatalf("decrypt ack1: %v", err)
	}
	assertFileUpOk(t, stripKind(t, ack1Framed), 7)

	// Второй (последний, done) чанк: offset=3, total=6, data={4,5,6}. Клиент —
	// stop-and-wait: следующий чанк шлётся только после ack предыдущего, что
	// и гарантирует offset-порядок на сервере (см. dispatchFileUp).
	chunk2, err := dnp.EncryptFrame(iSend, append([]byte{0x02}, fileUpFrame(8, 5, 3, 6, []byte{4, 5, 6})...))
	if err != nil {
		t.Fatalf("encrypt chunk2: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, chunk2); err != nil {
		t.Fatalf("write chunk2: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, ack2Raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ack2: %v", err)
	}
	ack2Framed, err := dnp.DecryptFrame(iRecv, ack2Raw)
	if err != nil {
		t.Fatalf("decrypt ack2: %v", err)
	}
	assertFileUpOk(t, stripKind(t, ack2Framed), 8)

	if got := storage.blobs["k"]; !bytes.Equal(got, []byte{1, 2, 3, 4, 5, 6}) {
		t.Fatalf("assembled object mismatch: %v", got)
	}
}
