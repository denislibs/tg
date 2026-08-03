// Package dnp — серверная сторона L0-канала DNP (Noise_NK responder).
package dnp

import (
	"errors"
	"io"

	"github.com/flynn/noise"
)

const prologueV1 = "dnp/1"

func cipherSuite() noise.CipherSuite {
	return noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)
}

// Responder — обёртка над flynn/noise NK responder для одного соединения.
type Responder struct {
	hs         *noise.HandshakeState
	send, recv *noise.CipherState
}

// NewResponder строит responder со статическим приватным ключом сервера (32 байта).
func NewResponder(staticPriv []byte, rand io.Reader) (*Responder, error) {
	cs := cipherSuite()
	kp, err := noise.DH25519.GenerateKeypair(bytesReader(staticPriv))
	if err != nil {
		return nil, err
	}
	hs, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: cs, Random: rand, Pattern: noise.HandshakeNK,
		Initiator: false, Prologue: []byte(prologueV1), StaticKeypair: kp,
	})
	if err != nil {
		return nil, err
	}
	return &Responder{hs: hs}, nil
}

// ReadMessage1 обрабатывает первый кадр клиента (e, es).
func (r *Responder) ReadMessage1(msg1 []byte) error {
	_, _, _, err := r.hs.ReadMessage(nil, msg1)
	return err
}

// WriteMessage2 формирует ответный кадр (e, ee) и завершает хендшейк.
func (r *Responder) WriteMessage2() ([]byte, error) {
	msg2, cs0, cs1, err := r.hs.WriteMessage(nil, nil)
	if err != nil {
		return nil, err
	}
	if cs0 == nil || cs1 == nil {
		return nil, errors.New("dnp: handshake incomplete after message 2")
	}
	// cs0: initiator->responder (recv у сервера); cs1: responder->initiator (send у сервера).
	r.recv, r.send = cs0, cs1
	return msg2, nil
}

// Split возвращает транспортные cipher-state сервера (send, recv) после хендшейка.
func (r *Responder) Split() (send, recv *noise.CipherState) { return r.send, r.recv }

// bytesReader отдаёт фиксированные 32 байта приватного ключа как io.Reader для GenerateKeypair.
func bytesReader(b []byte) io.Reader { return &staticKeyReader{b: b} }

type staticKeyReader struct{ b []byte }

func (s *staticKeyReader) Read(p []byte) (int, error) { return copy(p, s.b), nil }
