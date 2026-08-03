package dnp

import (
	"bytes"
	"testing"

	"github.com/flynn/noise"
)

func TestFrameLenRoundTrip(t *testing.T) {
	for _, p := range [][]byte{{}, {1}, bytes.Repeat([]byte{7}, 500)} {
		got, err := UnframeLen(FrameLen(p))
		if err != nil || !bytes.Equal(got, p) {
			t.Fatalf("round-trip %d: %v %x", len(p), err, got)
		}
	}
}

func TestUnframeLenRejectsBadInput(t *testing.T) {
	if _, err := UnframeLen([]byte{0, 0}); err == nil {
		t.Fatal("short header must error")
	}
	// len says 10 but only 2 payload bytes
	if _, err := UnframeLen([]byte{0, 0, 0, 10, 1, 2}); err == nil {
		t.Fatal("length mismatch must error")
	}
}

// completeHandshake runs an NK handshake (flynn both sides) and returns the
// initiator's send state and the responder's recv state (same direction key pair).
func completeHandshake(t *testing.T) (iSend, rRecv *noise.CipherState) {
	t.Helper()
	cs := cipherSuite()
	serverStatic, err := cs.GenerateKeypair(bytesReader(bytes.Repeat([]byte{0x11}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := NewResponder(bytes.Repeat([]byte{0x11}, 32), bytesReader(bytes.Repeat([]byte{0x33}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	initHS, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: bytesReader(bytes.Repeat([]byte{0x22}, 32)),
		Pattern: noise.HandshakeNK, Initiator: true, Prologue: []byte(prologueV1),
		PeerStatic: serverStatic.Public,
	})
	if err != nil {
		t.Fatal(err)
	}
	msg1, _, _, err := initHS.WriteMessage(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := resp.ReadMessage1(msg1); err != nil {
		t.Fatal(err)
	}
	msg2, err := resp.WriteMessage2()
	if err != nil {
		t.Fatal(err)
	}
	_, is, _, err := initHS.ReadMessage(nil, msg2)
	if err != nil {
		t.Fatal(err)
	}
	_, rRecv = resp.Split() // responder recv = initiator send direction
	return is, rRecv
}

func TestEncryptDecryptFrameRoundTrip(t *testing.T) {
	iSend, rRecv := completeHandshake(t)
	wire, err := EncryptFrame(iSend, []byte(`{"t":"ping"}`))
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecryptFrame(rRecv, wire)
	if err != nil || string(got) != `{"t":"ping"}` {
		t.Fatalf("decrypt: %v %q", err, got)
	}
}
