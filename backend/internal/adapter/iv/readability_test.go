package iv

import (
	"net/url"
	"strings"
	"testing"

	"golang.org/x/net/html"
)

func TestCollectBlocks(t *testing.T) {
	const page = `<article>
		<h1>Big title</h1>
		<p>First <b>paragraph</b>
		   with  spaces <img src="/inline.png"></p>
		<h3>Sub</h3>
		<blockquote><p>Quoted</p></blockquote>
		<pre>line1
line2</pre>
		<ul><li>one</li><li>two</li><li>  </li></ul>
		<ol><li>first</li></ol>
		<figure><img src="https://cdn.example.com/pic.jpg"></figure>
		<img src="javascript:alert(1)">
		<img src="data:image/png;base64,x">
		<p>   </p>
		<script>evil()</script>
	</article>`
	root, err := html.Parse(strings.NewReader(page))
	if err != nil {
		t.Fatal(err)
	}
	base, _ := url.Parse("https://example.com/posts/1")

	got := collectBlocks(root, base)
	want := []struct {
		typ, text, src string
		items          []string
	}{
		{typ: "h2", text: "Big title"},
		{typ: "p", text: "First paragraph with spaces"},
		{typ: "img", src: "https://example.com/inline.png"}, // относительный → через base
		{typ: "h2", text: "Sub"},
		{typ: "blockquote", text: "Quoted"},
		{typ: "pre", text: "line1\nline2"},
		{typ: "ul", items: []string{"one", "two"}},
		{typ: "ol", items: []string{"first"}},
		{typ: "img", src: "https://cdn.example.com/pic.jpg"},
		// javascript:/data:-img, пустые p и script — отброшены
	}
	if len(got) != len(want) {
		t.Fatalf("blocks = %d, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		b := got[i]
		if b.Type != w.typ || b.Text != w.text || b.Src != w.src {
			t.Errorf("block %d = %+v, want %+v", i, b, w)
		}
		if len(w.items) > 0 && strings.Join(b.Items, ",") != strings.Join(w.items, ",") {
			t.Errorf("block %d items = %v, want %v", i, b.Items, w.items)
		}
	}
}
