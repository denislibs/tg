package dnp

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/flynn/noise"
)

// Детерминированный io.Reader: отдаёт фиксированные байты (для эфемерных ключей).
type fixedReader struct{ b []byte }

func (f *fixedReader) Read(p []byte) (int, error) { return copy(p, f.b), nil }

func suite() noise.CipherSuite {
	return noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)
}

// Прогоняет полный NK-хендшейк flynn/noise (обе стороны детерминированы) и пишет
// фикстуру, против которой JS-initiator обязан сойтись байт-в-байт (interop-гейт).
func TestGenerateInteropFixture(t *testing.T) {
	cs := suite()
	prologue := []byte("dnp/1")

	serverStatic, err := cs.GenerateKeypair(&fixedReader{bytes.Repeat([]byte{0x11}, 32)})
	if err != nil {
		t.Fatal(err)
	}

	initHS, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: &fixedReader{bytes.Repeat([]byte{0x22}, 32)},
		Pattern: noise.HandshakeNK, Initiator: true, Prologue: prologue,
		PeerStatic: serverStatic.Public,
	})
	if err != nil {
		t.Fatal(err)
	}
	respHS, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: &fixedReader{bytes.Repeat([]byte{0x33}, 32)},
		Pattern: noise.HandshakeNK, Initiator: false, Prologue: prologue,
		StaticKeypair: serverStatic,
	})
	if err != nil {
		t.Fatal(err)
	}

	msg1, _, _, err := initHS.WriteMessage(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = respHS.ReadMessage(nil, msg1); err != nil {
		t.Fatal(err)
	}
	// flynn/noise returns (out, cs0, cs1): cs0 = initiator->responder direction,
	// cs1 = responder->initiator direction. On the responder side that means
	// cs0 is recv (decrypts what the initiator sent) and cs1 is send.
	msg2, rRecv, rSend, err := respHS.WriteMessage(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, iSend, iRecv, err := initHS.ReadMessage(nil, msg2)
	if err != nil {
		t.Fatal(err)
	}
	if iSend == nil || rSend == nil {
		t.Fatal("handshake did not complete")
	}

	// Транспорт: initiator шлёт "ping" (AD пустой), responder расшифровывает.
	transport, err := iSend.Encrypt(nil, nil, []byte("ping"))
	if err != nil {
		t.Fatal(err)
	}
	if got, err := rRecv.Decrypt(nil, nil, transport); err != nil || string(got) != "ping" {
		t.Fatalf("responder decrypt: %v %q", err, got)
	}
	_ = iRecv

	// split-ключи initiator для сверки в JS: flynn/noise (v1.1.0) предоставляет
	// CipherState.UnsafeKey() [32]byte — используем его, чтобы JS мог сверить
	// производные транспортные ключи байт-в-байт, а не только ciphertext.
	initSendKey := iSend.UnsafeKey()
	initRecvKey := iRecv.UnsafeKey()

	fx := map[string]string{
		"serverStaticPub":   hex.EncodeToString(serverStatic.Public),
		"initEphemeralPriv": hex.EncodeToString(bytes.Repeat([]byte{0x22}, 32)),
		"prologue":          "dnp/1",
		"msg1":              hex.EncodeToString(msg1),
		"msg2":              hex.EncodeToString(msg2),
		"initSendKey":       hex.EncodeToString(initSendKey[:]),
		"initRecvKey":       hex.EncodeToString(initRecvKey[:]),
		"transportFromInit": hex.EncodeToString(transport),
	}
	out, _ := json.MarshalIndent(fx, "", "  ")
	dst := filepath.Join("..", "..", "..", "..", "..", "..", "web-client", "src", "core", "net", "dnp", "noise", "fixtures", "nk-vector.json")
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, out, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestResponderCompletesHandshakeWithFlynnInitiator(t *testing.T) {
	cs := suite()
	serverStatic, _ := cs.GenerateKeypair(&fixedReader{bytes.Repeat([]byte{0x44}, 32)})
	resp, err := NewResponder(bytes.Repeat([]byte{0x44}, 32), &fixedReader{bytes.Repeat([]byte{0x55}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	initHS, _ := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: &fixedReader{bytes.Repeat([]byte{0x66}, 32)},
		Pattern: noise.HandshakeNK, Initiator: true, Prologue: []byte("dnp/1"),
		PeerStatic: serverStatic.Public,
	})
	msg1, _, _, _ := initHS.WriteMessage(nil, nil)
	if err := resp.ReadMessage1(msg1); err != nil {
		t.Fatal(err)
	}
	msg2, err := resp.WriteMessage2()
	if err != nil {
		t.Fatal(err)
	}
	_, iSend, _, err := initHS.ReadMessage(nil, msg2)
	if err != nil {
		t.Fatal(err)
	}
	send, _ := resp.Split()
	if send == nil {
		t.Fatal("no server cipher state")
	}
	ct, _ := iSend.Encrypt(nil, nil, []byte("hi"))
	got, err := recvDecrypt(resp, ct)
	if err != nil || string(got) != "hi" {
		t.Fatalf("server decrypt: %v %q", err, got)
	}
}

func recvDecrypt(r *Responder, ct []byte) ([]byte, error) {
	_, recv := r.Split()
	return recv.Decrypt(nil, nil, ct)
}
