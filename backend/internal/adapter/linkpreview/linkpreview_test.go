package linkpreview

import (
	"net/url"
	"strings"
	"testing"
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
