package ws

import (
	"bytes"
	"testing"

	"github.com/flynn/noise"
	"github.com/messenger-denis/backend/internal/adapter/delivery/ws/dnp"
)

// fixedReader — детерминированный io.Reader для ключей/эфемералей в тестах.
type fixedReader struct{ b []byte }

func (f fixedReader) Read(p []byte) (int, error) { return copy(p, f.b), nil }

func dnpSuite() noise.CipherSuite {
	return noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)
}

// dnpCipherPair гоняет полный NK-хендшейк (flynn обе стороны) и возвращает
// send initiator'а и recv responder'а (одно направление — один ключ).
func dnpCipherPair(t *testing.T) (iSend, rRecv *noise.CipherState) {
	t.Helper()
	cs := dnpSuite()
	serverStatic, err := cs.GenerateKeypair(fixedReader{bytes.Repeat([]byte{0x11}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := dnp.NewResponder(bytes.Repeat([]byte{0x11}, 32), fixedReader{bytes.Repeat([]byte{0x33}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	initHS, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: fixedReader{bytes.Repeat([]byte{0x22}, 32)},
		Pattern: noise.HandshakeNK, Initiator: true, Prologue: []byte("dnp/1"),
		PeerStatic: serverStatic.Public,
	})
	if err != nil {
		t.Fatal(err)
	}
	msg1, _, _, _ := initHS.WriteMessage(nil, nil)
	if err := resp.ReadMessage1(msg1); err != nil {
		t.Fatal(err)
	}
	msg2, _ := resp.WriteMessage2()
	_, is, _, err := initHS.ReadMessage(nil, msg2)
	if err != nil {
		t.Fatal(err)
	}
	_, rRecv = resp.Split()
	return is, rRecv
}
