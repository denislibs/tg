package ws

import (
	"bytes"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
)

func TestPlainCodecIdentity(t *testing.T) {
	c := plainCodec{}
	mt, out := c.encode(frameKindJSON, []byte(`{"t":"x"}`))
	if mt != websocket.TextMessage || string(out) != `{"t":"x"}` {
		t.Fatalf("encode: %d %q", mt, out)
	}
	got, err := c.decode([]byte(`{"t":"x"}`))
	if err != nil || string(got) != `{"t":"x"}` {
		t.Fatalf("decode: %v %q", err, got)
	}
}

func TestDNPCodecRoundTripBinary(t *testing.T) {
	send, recv := dnpCipherPair(t) // общий хелпер из dnp_support_test.go
	c := newDNPCodec(send, nil)
	mt, wire := c.encode(frameKindJSON, []byte(`{"t":"ping"}`))
	if mt != websocket.BinaryMessage {
		t.Fatalf("dnp must use binary, got %d", mt)
	}
	dec := newDNPCodec(nil, recv)
	got, err := dec.decode(wire)
	if err != nil || !bytes.Equal(got, []byte(`{"t":"ping"}`)) {
		t.Fatalf("decode: %v %q", err, got)
	}
}

// file-kind (0x01): decode ('только JSON') должен отвергнуть чужой kind, но сам
// зашифрованный payload должен нести именно 0x01 первым байтом plaintext.
func TestDNPCodecEncodeFileKind(t *testing.T) {
	send, recv := dnpCipherPair(t)
	enc := newDNPCodec(send, nil)
	payload := []byte{0xde, 0xad, 0xbe, 0xef}
	mt, wire := enc.encode(frameKindFile, payload)
	if mt != websocket.BinaryMessage {
		t.Fatalf("want binary, got %d", mt)
	}
	// расшифруем на низком уровне: plaintext = [0x01] ++ payload
	plain, err := dnp.DecryptFrame(recv, wire)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if len(plain) != 1+len(payload) || plain[0] != frameKindFile || !bytes.Equal(plain[1:], payload) {
		t.Fatalf("plaintext mismatch: %x", plain)
	}
}
