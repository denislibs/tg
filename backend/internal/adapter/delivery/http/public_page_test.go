package http

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/messenger-denis/backend/internal/domain"
	usecasepublic "github.com/messenger-denis/backend/internal/usecase/public"
)

type fakePublicRepo struct {
	profiles map[string]domain.PublicProfile
	invites  map[string]struct {
		link domain.InviteLink
		chat domain.PublicInvite
	}
	sets  map[string]domain.PublicStickerSet
	posts map[string]domain.PublicPost // ключ "username/seq"
}

func (f *fakePublicRepo) Resolve(_ context.Context, u string) (domain.PublicProfile, error) {
	if p, ok := f.profiles[u]; ok {
		return p, nil
	}
	return domain.PublicProfile{}, domain.ErrNotFound
}

func (f *fakePublicRepo) Invite(_ context.Context, t string) (domain.InviteLink, domain.PublicInvite, error) {
	if v, ok := f.invites[t]; ok {
		return v.link, v.chat, nil
	}
	return domain.InviteLink{}, domain.PublicInvite{}, domain.ErrNotFound
}

func (f *fakePublicRepo) StickerSet(_ context.Context, n string) (domain.PublicStickerSet, error) {
	if s, ok := f.sets[n]; ok {
		return s, nil
	}
	return domain.PublicStickerSet{}, domain.ErrNotFound
}

func (f *fakePublicRepo) Post(_ context.Context, u string, seq int64) (domain.PublicPost, error) {
	if p, ok := f.posts[u+"/"+strconv.FormatInt(seq, 10)]; ok {
		return p, nil
	}
	return domain.PublicPost{}, domain.ErrNotFound
}

func newPublicTestRouter() http.Handler {
	limit := 3
	past := time.Now().Add(-time.Hour)
	channel := domain.PublicProfile{Kind: "channel", Title: "Лента", Username: "lenta", About: "новости", MemberCount: 21}
	repo := &fakePublicRepo{
		profiles: map[string]domain.PublicProfile{
			"alice": {Kind: "user", Title: "Алиса", Username: "alice", About: "обо мне <b>", Verified: true},
			"robot": {Kind: "bot", Title: "Робот", Username: "robot"},
			"club":  {Kind: "group", Title: "Клуб", Username: "club", MemberCount: 2},
			"lenta": channel,
		},
		invites: map[string]struct {
			link domain.InviteLink
			chat domain.PublicInvite
		}{
			"good":    {chat: domain.PublicInvite{Kind: "group", Title: "Закрытая", About: "секрет", MemberCount: 5}},
			"chan":    {chat: domain.PublicInvite{Kind: "channel", Title: "Канал", MemberCount: 1}},
			"revoked": {link: domain.InviteLink{Revoked: true}, chat: domain.PublicInvite{Title: "Отозванная"}},
			"expired": {link: domain.InviteLink{ExpiresAt: &past}, chat: domain.PublicInvite{Title: "Просроченная"}},
			"full":    {link: domain.InviteLink{UsageLimit: &limit, Uses: 3}, chat: domain.PublicInvite{Title: "Исчерпанная"}},
		},
		sets: map[string]domain.PublicStickerSet{
			"cats":  {ShortName: "cats", Title: "Коты"},
			"smile": {ShortName: "smile", Title: "Смайлы", Emoji: true},
		},
		posts: map[string]domain.PublicPost{
			"lenta/5": {
				Channel: channel, Seq: 5, Text: "Привет\nмир <script>",
				Entities:  domain.MessageEntities{domain.NewMessageEntityBold(0, 6)},
				Views:     1520,
				CreatedAt: time.Date(2026, 9, 1, 12, 30, 0, 0, time.UTC),
			},
		},
	}
	r := chi.NewRouter()
	r.Route("/tme", NewPublicHandler(usecasepublic.New(repo), nil, testTme, testApp).Mount)
	return r
}

const (
	testTme = "https://t.me.test"
	testApp = "https://web.msgr.test"
)

// getPublic — запрос так, как его передаёт nginx хоста страниц: `/<путь t.me>` → `/tme/<путь>`.
func getPublic(t *testing.T, h http.Handler, path string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/tme"+path, nil)
	req.Host = "msgr.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if ct := rec.Header().Get("Content-Type"); rec.Code != http.StatusNotFound && !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("%s: Content-Type %q", path, ct)
	}
	return rec.Code, rec.Body.String()
}

func mustContain(t *testing.T, path, body string, parts ...string) {
	t.Helper()
	for _, p := range parts {
		if !strings.Contains(body, p) {
			t.Errorf("%s: нет %q в ответе", path, p)
		}
	}
}

func mustNotContain(t *testing.T, path, body string, parts ...string) {
	t.Helper()
	for _, p := range parts {
		if strings.Contains(body, p) {
			t.Errorf("%s: лишнее %q в ответе", path, p)
		}
	}
}

func TestPublicPages(t *testing.T) {
	h := newPublicTestRouter()
	cases := []struct {
		path   string
		status int
		want   []string
		absent []string
	}{
		{"/alice", 200, []string{
			"<title>Messenger: Контакт @alice</title>", `property="og:title" content="Алиса"`,
			`class="tgme_page_title"`, `class="verified-icon"`, `<div class="tgme_page_extra">@alice</div>`,
			"обо мне &lt;b&gt;", `href="https://web.msgr.test/#@alice">Написать</a>`, "написать пользователю",
			`class="tgme_head_right_btn" href="https://web.msgr.test/"`,
		}, []string{"noindex"}},
		{"/alice/", 200, []string{"Messenger: Контакт @alice"}, nil},
		{"/robot", 200, []string{"Messenger: Запустить @robot", "Запустить бота", `href="https://web.msgr.test/#@robot"`}, nil},
		{"/club", 200, []string{"2 участника", "Открыть в Messenger", "открыть группу"}, nil},
		{"/lenta", 200, []string{"21 подписчик", `href="https://web.msgr.test/#@lenta"`, "открыть канал"}, nil},
		{"/nobody", 404, []string{
			"noindex", "Messenger: Контакт @nobody", `class="tgme_page_icon"`,
			`<a class="tgme_username_link" href="https://web.msgr.test/#@nobody">@nobody</a>`, ">Написать</a>",
		}, []string{`class="tgme_page_title"`}},

		{"/lenta/5", 200, []string{
			"tgme_page_post", `class="tgme_widget_message_author"`, "Лента",
			"<b>Привет</b><br>мир &lt;script&gt;", "1.5K", "1 сен 2026 в 12:30",
			`property="og:description" content="Привет мир &lt;script&gt;"`,
			`href="https://web.msgr.test/#@lenta?post=5">Открыть в приложении</a>`,
			`<a href="https://t.me.test/lenta/5">t.me.test/lenta</a>`,
		}, []string{"<script>"}},
		{"/lenta/99", 404, []string{"Пост не найден", `href="https://web.msgr.test/#@lenta"`}, nil},
		{"/alice/1", 404, []string{"Messenger: Контакт @alice", `class="tgme_page_icon"`}, nil},
		{"/nobody/1", 404, []string{"Messenger: Контакт @nobody"}, nil},
		{"/lenta/abc", 404, []string{"Messenger: Контакт @lenta"}, nil},

		{"/c/1234/56", 200, []string{
			"noindex", "Сообщение в закрытой группе или канале",
			`href="https://web.msgr.test/#-1234/56">Открыть сообщение</a>`,
		}, nil},

		{"/+good", 200, []string{
			"Messenger: Вступить в группу", "Закрытая", "5 участников", "секрет",
			`href="https://web.msgr.test/join/good">Присоединиться</a>`, "вступить в группу",
		}, nil},
		{"/joinchat/good", 200, []string{"Закрытая", `href="https://web.msgr.test/join/good"`}, nil},
		{"/+chan", 200, []string{"Messenger: Вступить в канал", "1 подписчик", "подписаться на канал"}, nil},
		{"/+revoked", 404, []string{"Вас пригласили в <strong>групповой чат</strong>", `class="tgme_action_button"`}, []string{"Отозванная"}},
		{"/+expired", 404, []string{"групповой чат"}, []string{"Просроченная"}},
		{"/joinchat/full", 404, []string{"групповой чат"}, []string{"Исчерпанная"}},
		{"/+missing", 404, []string{"noindex", "Вступить в группу"}, nil},

		{"/addstickers/cats", 200, []string{
			"Messenger: Добавить набор стикеров", `content="Добавить набор стикеров Коты в Messenger"`,
			"создал набор стикеров <strong>Коты</strong>", ">Добавить стикеры</a>",
			`href="https://web.msgr.test/#?tgaddr=tg%3A%2F%2Faddstickers%3Fset%3Dcats"`,
		}, nil},
		{"/addemoji/smile", 200, []string{"набор эмодзи <strong>Смайлы</strong>", "Добавить эмодзи", "tg%3A%2F%2Faddemoji%3Fset%3Dsmile"}, nil},
		{"/addstickers/nope", 404, []string{"noindex", "<strong>набор стикеров</strong>", "tg%3A%2F%2Faddstickers%3Fset%3Dnope"}, nil},
	}
	for _, c := range cases {
		code, body := getPublic(t, h, c.path)
		if code != c.status {
			t.Errorf("%s: status %d, want %d", c.path, code, c.status)
		}
		mustContain(t, c.path, body, c.want...)
		mustNotContain(t, c.path, body, c.absent...)
	}
}

// Без MinIO картинок нет: фото-маршруты отвечают 404, а страница — заглушкой-инициалом.
func TestPublicPhotosWithoutMedia(t *testing.T) {
	h := newPublicTestRouter()
	for _, p := range []string{"/alice/photo", "/lenta/5/photo", "/joinchat/good/photo", "/joinchat/revoked/photo"} {
		req := httptest.NewRequest(http.MethodGet, "/tme"+p, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", p, rec.Code)
		}
	}
	_, body := getPublic(t, h, "/alice")
	mustContain(t, "/alice", body, "tgme_page_photo_initials", ">А</span>")
	mustNotContain(t, "/alice", body, "og:image")
}

// Корень хоста страниц — в веб-клиент (у t.me — на сайт).
func TestPublicRootRedirect(t *testing.T) {
	rec := httptest.NewRecorder()
	newPublicTestRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/tme/", nil))
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != testApp+"/" {
		t.Fatalf("root: %d %q", rec.Code, rec.Header().Get("Location"))
	}
}

func TestRenderRichText(t *testing.T) {
	cases := []struct {
		text string
		ents domain.MessageEntities
		want string
	}{
		{"a<b", nil, "a&lt;b"},
		// пересечение: курсив обрывается границей жирного и переоткрывается
		{"abcdef", domain.MessageEntities{domain.NewMessageEntityBold(0, 4), domain.NewMessageEntityItalic(2, 4)},
			"<b>ab<i>cd</i></b><i>ef</i>"},
		// UTF-16: эмодзи — две единицы
		{"😀x", domain.MessageEntities{domain.NewMessageEntityBold(2, 1)}, "😀<b>x</b>"},
		{"go", domain.MessageEntities{domain.NewMessageEntityTextURL(0, 2, "https://e.x/?a=1&b=2")},
			`<a href="https://e.x/?a=1&amp;b=2" target="_blank" rel="noopener">go</a>`},
		{"js", domain.MessageEntities{domain.NewMessageEntityTextURL(0, 2, "javascript:alert(1)")}, "js"},
		{"q", domain.MessageEntities{domain.NewMessageEntityBold(0, 99)}, "<b>q</b>"},
	}
	for _, c := range cases {
		if got := string(renderRichText(c.text, c.ents)); got != c.want {
			t.Errorf("renderRichText(%q) = %q, want %q", c.text, got, c.want)
		}
	}
}

func TestShortCount(t *testing.T) {
	for n, want := range map[int64]string{7: "7", 1000: "1K", 1520: "1.5K", 3_140_000: "3.14M"} {
		if got := shortCount(n); got != want {
			t.Errorf("shortCount(%d) = %q, want %q", n, got, want)
		}
	}
}
