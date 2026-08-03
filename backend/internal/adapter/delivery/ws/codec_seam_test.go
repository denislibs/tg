package ws

import (
	"bytes"
	"testing"

	"github.com/gorilla/websocket"
)

func TestPlainCodecIdentity(t *testing.T) {
	c := plainCodec{}
	mt, out := c.encode([]byte(`{"t":"x"}`))
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
	mt, wire := c.encode([]byte(`{"t":"ping"}`))
	if mt != websocket.BinaryMessage {
		t.Fatalf("dnp must use binary, got %d", mt)
	}
	dec := newDNPCodec(nil, recv)
	got, err := dec.decode(wire)
	if err != nil || !bytes.Equal(got, []byte(`{"t":"ping"}`)) {
		t.Fatalf("decode: %v %q", err, got)
	}
}
