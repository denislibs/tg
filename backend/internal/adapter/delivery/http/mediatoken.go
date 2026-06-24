package http

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// Media tokens are short-lived, media-scoped grants used in ?token= on the
// <img>/<video> content URL. Unlike the session bearer token they cannot be used
// against the API — they only authorize media reads for one user for a few
// minutes, so leaking one (history, logs, referrer) is low-impact.
const (
	mediaTokenTTL    = 15 * time.Minute
	mediaTokenPrefix = "m1"
)

// signMediaToken returns "m1.<userID>.<expUnix>.<hex(hmac)>".
func signMediaToken(secret []byte, userID int64, now time.Time) string {
	exp := now.Add(mediaTokenTTL).Unix()
	body := mediaTokenPrefix + "." + strconv.FormatInt(userID, 10) + "." + strconv.FormatInt(exp, 10)
	return body + "." + mediaTokenMAC(secret, body)
}

func mediaTokenMAC(secret []byte, body string) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(body))
	return hex.EncodeToString(m.Sum(nil))
}

// parseMediaToken validates a media token and returns its user id. ok is false
// for any malformed, tampered, or expired token.
func parseMediaToken(secret []byte, tok string, now time.Time) (userID int64, ok bool) {
	parts := strings.Split(tok, ".")
	if len(parts) != 4 || parts[0] != mediaTokenPrefix {
		return 0, false
	}
	body := strings.Join(parts[:3], ".")
	want := mediaTokenMAC(secret, body)
	if !hmac.Equal([]byte(want), []byte(parts[3])) {
		return 0, false
	}
	uid, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, false
	}
	exp, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || now.Unix() > exp {
		return 0, false
	}
	return uid, true
}
