package linkpreview

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecaseiv "github.com/messenger-denis/backend/internal/usecase/iv"
)

const fixtureOG = `<!doctype html>
<html>
<head>
	<title>Page &lt;title&gt; fallback</title>
	<meta property="og:site_name" content="Example News">
	<meta property="og:title" content="Заголовок статьи">
	<meta property="og:description" content="Короткое описание статьи.">
	<meta property="og:image" content="/img/cover.jpg">
</head>
<body><p>ignored <meta property="og:title" content="body-meta-must-not-win"></p></body>
</html>`

func TestParse_OGTags(t *testing.T) {
	base, _ := url.Parse("https://news.example.com/articles/1")
	wp, err := Parse(strings.NewReader(fixtureOG), base)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if wp.SiteName != "Example News" {
		t.Errorf("SiteName = %q", wp.SiteName)
	}
	if wp.Title != "Заголовок статьи" {
		t.Errorf("Title = %q", wp.Title)
	}
	if wp.Description != "Короткое описание статьи." {
		t.Errorf("Description = %q", wp.Description)
	}
	// Относительный og:image резолвится от финального URL страницы.
	if wp.ImageURL != "https://news.example.com/img/cover.jpg" {
		t.Errorf("ImageURL = %q", wp.ImageURL)
	}
}

func TestParse_TwitterAndTitleFallbacks(t *testing.T) {
	base, _ := url.Parse("https://blog.example.com/x")
	html := `<html><head>
		<title>  Простой   заголовок  </title>
		<meta name="twitter:description" content="tw описание">
		<meta name="twitter:image" content="https://cdn.example.com/tw.png">
	</head><body></body></html>`
	wp, err := Parse(strings.NewReader(html), base)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if wp.Title != "Простой заголовок" {
		t.Errorf("Title = %q", wp.Title)
	}
	if wp.SiteName != "blog.example.com" {
		t.Errorf("SiteName = %q", wp.SiteName)
	}
	if wp.Description != "tw описание" {
		t.Errorf("Description = %q", wp.Description)
	}
	if wp.ImageURL != "https://cdn.example.com/tw.png" {
		t.Errorf("ImageURL = %q", wp.ImageURL)
	}
}

func TestParse_NoTitleNoPreview(t *testing.T) {
	base, _ := url.Parse("https://empty.example.com/")
	if _, err := Parse(strings.NewReader(`<html><head></head><body>text</body></html>`), base); err == nil {
		t.Fatal("expected error for page without title")
	}
}

func TestParse_RejectsNonHTTPImage(t *testing.T) {
	base, _ := url.Parse("https://x.example.com/")
	html := `<html><head>
		<meta property="og:title" content="t">
		<meta property="og:image" content="javascript:alert(1)">
	</head></html>`
	wp, err := Parse(strings.NewReader(html), base)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if wp.ImageURL != "" {
		t.Errorf("ImageURL = %q; want empty for non-http scheme", wp.ImageURL)
	}
}

// Разбор сбоев на временные (повтор может пройти) и нет — на нём держится
// «повтор только временных» в usecase; текст ошибки не несёт путь и query.
func TestFetchAndStatusErrors(t *testing.T) {
	transient := func(err error) bool { return errors.Is(err, usecasechat.ErrPreviewTransient) }
	timeout := &url.Error{Op: "Get", URL: "https://a.example/secret?token=x", Err: context.DeadlineExceeded}
	for _, c := range []struct {
		name string
		err  error
		want bool
	}{
		{"таймаут", timeout, true},
		{"обрыв", &url.Error{Op: "Get", URL: "https://a.example/p", Err: io.ErrUnexpectedEOF}, true},
		{"кривой адрес редиректа", &url.Error{Op: "Get", URL: "https://a.example/", Err: usecaseiv.ErrBadURL}, false},
		{"SSRF", &url.Error{Op: "Get", URL: "https://a.example/", Err: fmt.Errorf("x: %w", usecaseiv.ErrForbiddenTarget)}, false},
		{"нет хоста", &url.Error{Op: "Get", URL: "https://a.example/", Err: &net.DNSError{Err: "no such host", IsNotFound: true}}, false},
		{"битый сертификат", &url.Error{Op: "Get", URL: "https://a.example/", Err: x509.UnknownAuthorityError{}}, false},
		{"не TLS на https", &url.Error{Op: "Get", URL: "https://a.example/", Err: tls.RecordHeaderError{Msg: "first record does not look like a TLS handshake"}}, false},
	} {
		got := fetchError("a.example", c.err)
		if transient(got) != c.want {
			t.Errorf("%s: временная = %v; want %v (%v)", c.name, transient(got), c.want, got)
		}
		if strings.Contains(got.Error(), "secret") || strings.Contains(got.Error(), "token") {
			t.Errorf("%s: в ошибке путь/query: %v", c.name, got)
		}
	}
	for code, want := range map[int]bool{502: true, 503: true, 429: false, 404: false, 403: false} {
		if err := statusError("a.example", code); err == nil || transient(err) != want {
			t.Errorf("status %d: %v; временная want %v", code, err, want)
		}
	}
	if statusError("a.example", 200) != nil {
		t.Error("200 — ошибка")
	}
}

// Ревью 3, п.1: обрыв на чтении тела — временный сбой (а не «не разобралась»).
func TestPreview_BodyReadFailureIsTransient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Content-Length", "100000")
		_, _ = w.Write([]byte("<html><head><title>x"))
		hj, ok := w.(http.Hijacker)
		if !ok {
			return
		}
		conn, _, _ := hj.Hijack()
		_ = conn.Close() // обрыв посреди тела
	}))
	defer srv.Close()
	c := &Client{http: srv.Client()}
	_, err := c.Preview(context.Background(), srv.URL+"/page")
	if err == nil || !errors.Is(err, usecasechat.ErrPreviewTransient) {
		t.Fatalf("err = %v; ждали временный сбой", err)
	}
}
