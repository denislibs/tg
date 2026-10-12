package domain

import (
	"strings"
	"testing"
)

// Черновик хранит решение о превью как прислали (tweb draftsAreEqual
// сравнивает черновик целиком), но media — только inputMediaWebPage с
// http(s)-ссылкой и флагами конструктора.
func TestWebPageInput_ForDraft(t *testing.T) {
	in := WebPageInput{NoWebpage: true, Media: &InputMediaWebPage{Underscore: InputMediaWebPageTag, URL: " https://a.example/x ",
		PFlags: map[string]bool{"force_small_media": true, "optional": true, "force_large_media": false, "junk": true}}}
	got := in.ForDraft(100)
	if !got.NoWebpage || got.Media == nil || got.Media.URL != "https://a.example/x" ||
		len(got.Media.PFlags) != 2 || !got.Media.PFlags["force_small_media"] || !got.Media.PFlags["optional"] {
		t.Fatalf("ForDraft = %+v (%+v)", got, got.Media)
	}
	for _, bad := range []*InputMediaWebPage{
		{Underscore: "inputMediaPhoto", URL: "https://a.example"},
		{Underscore: InputMediaWebPageTag, URL: "javascript:alert(1)"},
		{Underscore: InputMediaWebPageTag, URL: "https://" + strings.Repeat("a", 200)},
	} {
		if got := (WebPageInput{InvertMedia: true, Media: bad}).ForDraft(100); got.Media != nil || !got.InvertMedia {
			t.Fatalf("media %+v должно сняться: %+v", bad, got)
		}
	}
	if !(WebPageInput{}).ForDraft(100).IsZero() {
		t.Fatal("пустое решение перестало быть пустым")
	}
}
