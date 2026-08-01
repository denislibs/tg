package http

import "testing"

func TestRedactPath(t *testing.T) {
	cases := map[string]string{
		"/bot/123:ABCDEF/sendMessage": "/bot/***/sendMessage",
		"/bot/secret-token":           "/bot/***",
		"/bot/secret/getUpdates":      "/bot/***/getUpdates",
		"/auth/qr/deadbeeftoken":      "/auth/qr/***",
		"/auth/qr/new":                "/auth/qr/new", // POST создания — не токен
		"/media/42/content":           "/media/42/content",
		"/auth/sign_in":               "/auth/sign_in",
		"/ws":                         "/ws",
	}
	for in, want := range cases {
		if got := redactPath(in); got != want {
			t.Errorf("redactPath(%q) = %q, want %q", in, got, want)
		}
	}
}
