// Command dnpkeygen генерит Curve25519-пару для DNP: приватный → env DNP_SERVER_PRIVKEY
// (только на сервере), публичный → VITE_DNP_SERVER_PUBKEYS (билд фронта).
package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/flynn/noise"
)

func main() {
	kp, err := noise.DH25519.GenerateKeypair(rand.Reader)
	if err != nil {
		panic(err)
	}
	fmt.Printf("DNP_SERVER_PRIVKEY=%s\n", hex.EncodeToString(kp.Private))
	fmt.Printf("VITE_DNP_SERVER_PUBKEYS=%s\n", hex.EncodeToString(kp.Public))
}
