package domain

// IVArticle — статья Instant View (reader mode): основной контент страницы,
// извлечённый reader-парсером и приведённый к типизированным блокам.
// HTML наружу не отдаётся — только плоский текст/ссылки на картинки.
type IVArticle struct {
	Title    string    `json:"title"`
	Byline   string    `json:"byline"`
	SiteName string    `json:"site_name"`
	Blocks   []IVBlock `json:"blocks"`
}

// Типы блоков IVArticle.
const (
	IVBlockP          = "p"
	IVBlockH1         = "h1"
	IVBlockH2         = "h2"
	IVBlockBlockquote = "blockquote"
	IVBlockImg        = "img"
	IVBlockPre        = "pre"
	IVBlockUL         = "ul"
	IVBlockOL         = "ol"
)

// IVBlock — один блок статьи. Заполненность полей зависит от Type:
// p/h1/h2/blockquote/pre — Text, img — Src, ul/ol — Items.
type IVBlock struct {
	Type  string   `json:"type"`
	Text  string   `json:"text,omitempty"`
	Src   string   `json:"src,omitempty"`
	Items []string `json:"items,omitempty"`
}
