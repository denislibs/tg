package ws_test

import (
	"encoding/json"
	"testing"
	"time"

	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// nextMediaRead — seq из ближайшего кадра media_read соединения.
func nextMediaRead(t *testing.T, read func() []byte) int64 {
	t.Helper()
	data := read()
	if data == nil {
		t.Fatal("media_read не пришёл")
	}
	var f struct {
		D struct {
			Messages []int64 `json:"messages"`
		} `json:"d"`
	}
	if err := json.Unmarshal(data, &f); err != nil || len(f.D.Messages) != 1 {
		t.Fatalf("media_read = %s (%v)", data, err)
	}
	return f.D.Messages[0]
}

// MC-04: read_media несёт ВЕКТОР серверных номеров под именем id (TL
// messages.readMessageContents{id: Vector<int>}, tweb appMessagesManager.ts:9568).
// Прежний кадр читал id скаляром, а клиент слал msg_id — кадр молча гас.
func TestWS_ReadMediaVector(t *testing.T) {
	env := newWSEnv(t)
	defer env.close()
	connA := dial(t, env.url, env.tokenA)
	defer connA.Close()
	connB := dial(t, env.url, env.tokenB)
	defer connB.Close()
	time.Sleep(150 * time.Millisecond)

	var seqs []int64
	for range 4 {
		m, err := env.chatSvc.Send(env.ctx, usecasechat.SendInput{ChatID: env.chatID, SenderID: env.userA, Type: "voice"})
		if err != nil {
			t.Fatalf("Send: %v", err)
		}
		seqs = append(seqs, m.Seq)
	}
	next := func() int64 {
		return nextMediaRead(t, func() []byte { return readUntil(t, connA, "media_read") })
	}

	// Два номера в одном кадре — у автора по кадру на каждый, по порядку номеров.
	sendFrame(t, connB, "read_media", map[string]any{"peer_id": env.userA, "id": seqs[:2]})
	if a, b := next(), next(); a != seqs[0] || b != seqs[1] {
		t.Fatalf("media_read %d, %d; want %d, %d", a, b, seqs[0], seqs[1])
	}

	// Больше 10 номеров — кадр отбрасывается целиком, даже с настоящим seqs[2].
	// Кадры одного соединения идут по порядку: если бы длинный кадр сработал,
	// следующим пришёл бы media_read на seqs[2], а не на seqs[3].
	over := []int64{seqs[2]}
	for n := int64(1000); len(over) < 11; n++ {
		over = append(over, n)
	}
	sendFrame(t, connB, "read_media", map[string]any{"peer_id": env.userA, "id": over})
	sendFrame(t, connB, "read_media", map[string]any{"peer_id": env.userA, "id": seqs[3:]})
	if got := next(); got != seqs[3] {
		t.Fatalf("после длинного кадра пришёл media_read на %d; want %d", got, seqs[3])
	}
}
