package dnp

import (
	"encoding/binary"
	"errors"

	"github.com/flynn/noise"
)

// MaxFrameLen — верхняя граница payload одного кадра (совпадает с ws.maxMessageSize).
const MaxFrameLen = 1 << 20

// Формат кадра: u32 big-endian длина payload + payload. Над WS префикс избыточен
// (границы даёт сам WS), но закладываем его единообразно ради будущего сырого-TCP
// носителя (см. спеку DNP §4/§10.8). Хендшейк: payload = сырое Noise-сообщение;
// транспорт: payload = зашифрованный кадр.
func FrameLen(payload []byte) []byte {
	out := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(out[:4], uint32(len(payload)))
	copy(out[4:], payload)
	return out
}

// UnframeLen снимает длину и валидирует, что она ровно соответствует остатку.
func UnframeLen(raw []byte) ([]byte, error) {
	if len(raw) < 4 {
		return nil, errors.New("dnp: short frame header")
	}
	n := binary.BigEndian.Uint32(raw[:4])
	if n > MaxFrameLen {
		return nil, errors.New("dnp: frame too large")
	}
	if int(n) != len(raw)-4 {
		return nil, errors.New("dnp: frame length mismatch")
	}
	return raw[4:], nil
}

// Seal/Open — только крипта (без длины), AD пустой. Для случаев, где длина уже снята
// (напр. auth-кадр после readWSFramed).
func Seal(cs *noise.CipherState, plaintext []byte) ([]byte, error) {
	return cs.Encrypt(nil, nil, plaintext)
}
func Open(cs *noise.CipherState, ciphertext []byte) ([]byte, error) {
	return cs.Decrypt(nil, nil, ciphertext)
}

// EncryptFrame шифрует прикладной кадр и оборачивает длиной: [len][Encrypt(pt)].
func EncryptFrame(cs *noise.CipherState, plaintext []byte) ([]byte, error) {
	ct, err := Seal(cs, plaintext)
	if err != nil {
		return nil, err
	}
	return FrameLen(ct), nil
}

// DecryptFrame снимает длину и расшифровывает: Open(unframe(raw)).
func DecryptFrame(cs *noise.CipherState, raw []byte) ([]byte, error) {
	ct, err := UnframeLen(raw)
	if err != nil {
		return nil, err
	}
	return Open(cs, ct)
}
