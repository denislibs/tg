package http

import (
	"embed"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	usecasepublic "github.com/messenger-denis/backend/internal/usecase/public"
)

//go:embed templates/public_page.html
var publicPageFS embed.FS

var publicPageTpl = template.Must(template.ParseFS(publicPageFS, "templates/public_page.html"))

// PublicHandler — публичные страницы-превью, аналог t.me (вёрстка tgme_page).
// Живут на своём хосте (Config.PublicLinkOrigin), пути 1:1 с t.me:
//
//	GET /{username}                     пользователь / бот / группа / канал
//	GET /{username}/{seq}               пост публичного канала
//	GET /c/{id}/{seq}                   пост закрытого чата (только для участников)
//	GET /+{hash}, /joinchat/{hash}      ссылка-приглашение
//	GET /addstickers/{name}, /addemoji/{name}  набор стикеров / эмодзи
//	GET /                               → веб-клиент
//
// и картинки к ним (аватарки, фото поста) — страницу читает аноним, поэтому
// отдаётся только то, что и так показано на странице.
//
// Кнопка страницы ведёт в веб-клиент (Config.AppOrigin): `#@username`,
// `#@username/<seq>`, `#<peerId>/<seq>` (схема хэша клиента,
// core/messageLink.ts), `/join/<hash>` (диплинк вступления клиента), набор —
// `#?tgaddr=<tg://…>` (схема tweb index.ts / appImManager onHashChange).
type PublicHandler struct {
	uc    *usecasepublic.Interactor
	media *usecasemedia.Interactor // nil — MinIO выключен, фото недоступны
	tme   string                   // origin хоста страниц, без завершающего «/»
	app   string                   // origin веб-клиента
}

func NewPublicHandler(uc *usecasepublic.Interactor, media *usecasemedia.Interactor, tmeOrigin, appOrigin string) *PublicHandler {
	return &PublicHandler{uc: uc, media: media, tme: tmeOrigin, app: appOrigin}
}

// Mount — маршруты страниц; router.go монтирует их под /tme, куда nginx
// проксирует хост PublicLinkOrigin целиком.
func (h *PublicHandler) Mount(r chi.Router) {
	r.Use(middleware.StripSlashes)
	r.Get("/", h.Root)
	r.Get("/{username}", h.Page)
	r.Get("/{username}/photo", h.Photo)
	r.Get("/{username}/{seq}", h.Post)
	r.Get("/{username}/{seq}/photo", h.PostPhoto)
	r.Get("/c/{id}/{seq}", h.PrivatePost)
	r.Get("/+{hash}", h.Invite)
	r.Get("/joinchat/{hash}", h.Invite)
	r.Get("/joinchat/{hash}/photo", h.InvitePhoto)
	r.Get("/addstickers/{name}", h.StickerSet)
	r.Get("/addemoji/{name}", h.StickerSet)
}

// Root — корень хоста страниц: у t.me это редирект на сайт, у нас — в клиент.
func (h *PublicHandler) Root(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, h.app+"/", http.StatusFound)
}

// градиенты аватарок-заглушек (как peer-цвета в клиенте)
var avatarGradients = []string{
	"linear-gradient(135deg, #ff885e, #ff516a)",
	"linear-gradient(135deg, #ffcd6a, #ffa85c)",
	"linear-gradient(135deg, #82b1ff, #665fff)",
	"linear-gradient(135deg, #a0de7e, #54cb68)",
	"linear-gradient(135deg, #53edd6, #28c9b7)",
	"linear-gradient(135deg, #72d5fd, #2a9ef1)",
	"linear-gradient(135deg, #e0a2f3, #d669ed)",
}

func ruPlural(n int, one, few, many string) string {
	m10, m100 := n%10, n%100
	switch {
	case m10 == 1 && m100 != 11:
		return one
	case m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14):
		return few
	default:
		return many
	}
}

func membersLine(kind string, n int) string {
	if kind == "channel" {
		return fmt.Sprintf("%d %s", n, ruPlural(n, "подписчик", "подписчика", "подписчиков"))
	}
	return fmt.Sprintf("%d %s", n, ruPlural(n, "участник", "участника", "участников"))
}

// pageView — данные шаблона. Блоки страницы — 1:1 классы t.me: tgme_page_photo
// (или tgme_page_icon), _title, _extra, _description, _action, _additional.
type pageView struct {
	AppURL        string // шапка: лого и «Открыть Web»
	PageTitle     string
	NoIndex       bool
	OGTitle       string
	OGDescription string
	OGImage       string

	PhotoURL       string // tgme_page_photo_image
	Initial        string // заглушка аватарки, если фото нет
	AvatarGradient template.CSS
	Icon           string // tgme_icon_<Icon> вместо фото: user | group | stickers

	Title       string
	Verified    bool
	Extras      []string
	Description string
	// Lead — фиксированная фраза вместо описания у страниц-заглушек и набора:
	// Kind выбирает текст в шаблоне, LeadName — подставляемое имя.
	Lead     string
	LeadName string
	LeadHref string

	ButtonText  string
	ButtonHref  string
	ButtonShine bool
	ButtonGreen bool // tgme_action_button — старая зелёная кнопка t.me (пустое приглашение)

	// AdditionalLead — «вы можете сразу …» в tgme_page_additional (виден на узком экране).
	AdditionalLead string

	Post *postView
}

type postView struct {
	Error       string // пост не найден — вместо содержимого бабла
	AuthorName  string
	AuthorHref  string
	AuthorPhoto string
	Initial     string
	PhotoURL    string
	PhotoW      int
	PhotoH      int
	Text        template.HTML
	Views       string
	Date        string
	DateISO     string
	LinkLabel   string
	Link        string
}

func initialOf(title string) string {
	for _, r := range title {
		return strings.ToUpper(string(r))
	}
	return "?"
}

func gradientOf(title string) template.CSS {
	var hash int
	for _, c := range title {
		hash = (hash*31 + int(c)) % len(avatarGradients)
	}
	if hash < 0 {
		hash = -hash
	}
	return template.CSS(avatarGradients[hash])
}

// Адреса страниц — абсолютные от PublicLinkOrigin: og:image без схемы и хоста
// превью ссылок не понимают, а на поддомене (`durov.t.me`) относительный путь
// указывал бы не туда.
func (h *PublicHandler) page(path string) string { return h.tme + path }

// inApp — адрес веб-клиента: путь (`/join/…`) или хэш (`#@durov`).
func (h *PublicHandler) inApp(target string) string {
	if strings.HasPrefix(target, "#") {
		return h.app + "/" + target
	}
	return h.app + target
}

func (h *PublicHandler) render(w http.ResponseWriter, status int, v pageView) {
	v.AppURL = h.app + "/"
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(status)
	_ = publicPageTpl.Execute(w, v)
}

func (h *PublicHandler) internalError(w http.ResponseWriter) {
	writeError(w, http.StatusInternalServerError, "internal")
}

// notFoundUser — t.me для незанятого имени: иконка, «можете написать @name»,
// «Написать», noindex.
func (h *PublicHandler) notFoundUser(w http.ResponseWriter, username string) {
	h.render(w, http.StatusNotFound, pageView{
		PageTitle: "Messenger: Контакт @" + username, NoIndex: true,
		OGTitle: "Messenger: Контакт @" + username,
		Icon:    "user", Lead: "contact", LeadName: "@" + username, LeadHref: h.inApp("#@" + username),
		ButtonText: "Написать", ButtonHref: h.inApp("#@" + username),
	})
}

func (h *PublicHandler) hasPhoto(mediaID int64) bool { return mediaID != 0 && h.media != nil }

// Page — GET /{username}.
func (h *PublicHandler) Page(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")
	p, err := h.uc.Resolve(r.Context(), username)
	if errors.Is(err, domain.ErrNotFound) {
		h.notFoundUser(w, username)
		return
	}
	if err != nil {
		h.internalError(w)
		return
	}

	v := pageView{
		OGTitle: p.Title, OGDescription: p.About,
		Title: p.Title, Verified: p.Verified, Description: p.About,
		Initial: initialOf(p.Title), AvatarGradient: gradientOf(p.Title),
		ButtonHref: h.inApp("#@" + p.Username), ButtonShine: true,
	}
	if h.hasPhoto(p.AvatarMediaID) {
		v.PhotoURL = h.page("/" + p.Username + "/photo")
		v.OGImage = v.PhotoURL
	}
	switch p.Kind {
	case "bot":
		v.PageTitle = "Messenger: Запустить @" + p.Username
		v.Extras = []string{"@" + p.Username}
		v.ButtonText = "Запустить бота"
		v.AdditionalLead = "запустить бота"
	case "group", "channel":
		v.PageTitle = "Messenger: Просмотр @" + p.Username
		v.Extras = []string{membersLine(p.Kind, p.MemberCount)}
		v.ButtonText = "Открыть в Messenger"
		if p.Kind == "channel" {
			v.AdditionalLead = "открыть канал"
		} else {
			v.AdditionalLead = "открыть группу"
		}
	default:
		v.PageTitle = "Messenger: Контакт @" + p.Username
		v.Extras = []string{"@" + p.Username}
		v.ButtonText = "Написать"
		v.AdditionalLead = "написать пользователю"
	}
	h.render(w, http.StatusOK, v)
}

// Photo — GET /{username}/photo (аватар и так виден всем, как на t.me).
func (h *PublicHandler) Photo(w http.ResponseWriter, r *http.Request) {
	p, err := h.uc.Resolve(r.Context(), chi.URLParam(r, "username"))
	if err != nil {
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	h.serveMedia(w, r, p.AvatarMediaID)
}

func (h *PublicHandler) serveMedia(w http.ResponseWriter, r *http.Request, mediaID int64) {
	if !h.hasPhoto(mediaID) {
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	rc, info, _, err := h.media.GetContent(r.Context(), mediaID)
	if err != nil {
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", info.ContentType)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeContent(w, r, "", info.ModTime, rc)
}

// publicInviteToken — хэш из /+{hash} или /joinchat/{hash}.
var inviteTokenRe = regexp.MustCompile(`^[\w-]{1,64}$`)

func publicInviteToken(r *http.Request) string {
	t := chi.URLParam(r, "hash")
	if !inviteTokenRe.MatchString(t) {
		return ""
	}
	return t
}

// Invite — GET /+{hash}, /joinchat/{hash}. Недействительная ссылка — «пустое»
// приглашение t.me (иконка группы, «Вас пригласили в групповой чат»).
func (h *PublicHandler) Invite(w http.ResponseWriter, r *http.Request) {
	token := publicInviteToken(r)
	inv, err := domain.PublicInvite{}, domain.ErrNotFound
	if token != "" {
		inv, err = h.uc.Invite(r.Context(), token)
	}
	if errors.Is(err, domain.ErrNotFound) {
		h.render(w, http.StatusNotFound, pageView{
			PageTitle: "Messenger: Вступить в групповой чат", NoIndex: true,
			OGTitle: "Вступить в групповой чат в Messenger",
			Icon:    "group", Lead: "invite",
			ButtonText: "Вступить в группу", ButtonHref: h.inApp("/join/" + token), ButtonGreen: true,
		})
		return
	}
	if err != nil {
		h.internalError(w)
		return
	}
	v := pageView{
		OGTitle: inv.Title, OGDescription: inv.About,
		Title: inv.Title, Description: inv.About,
		Extras:  []string{membersLine(inv.Kind, inv.MemberCount)},
		Initial: initialOf(inv.Title), AvatarGradient: gradientOf(inv.Title),
		ButtonText: "Присоединиться", ButtonHref: h.inApp("/join/" + token), ButtonShine: true,
	}
	if inv.Kind == "channel" {
		v.PageTitle = "Messenger: Вступить в канал"
		v.AdditionalLead = "подписаться на канал"
	} else {
		v.PageTitle = "Messenger: Вступить в группу"
		v.AdditionalLead = "вступить в группу"
	}
	if h.hasPhoto(inv.AvatarMediaID) {
		v.PhotoURL = h.page("/joinchat/" + token + "/photo")
		v.OGImage = v.PhotoURL
	}
	h.render(w, http.StatusOK, v)
}

// InvitePhoto — GET /joinchat/{hash}/photo: фото чата с приглашения.
func (h *PublicHandler) InvitePhoto(w http.ResponseWriter, r *http.Request) {
	token := publicInviteToken(r)
	if token == "" {
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	inv, err := h.uc.Invite(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	h.serveMedia(w, r, inv.AvatarMediaID)
}

// StickerSet — GET /addstickers/{name}, /addemoji/{name}.
func (h *PublicHandler) StickerSet(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	set, err := h.uc.StickerSet(r.Context(), name)
	if errors.Is(err, domain.ErrNotFound) {
		// t.me на неизвестный набор отвечает той же страницей, только без имени.
		h.render(w, http.StatusNotFound, pageView{
			PageTitle: "Messenger: Добавить набор стикеров", NoIndex: true,
			OGTitle: "Добавить набор стикеров в Messenger",
			Icon:    "stickers", Lead: "stickers",
			ButtonText: "Добавить стикеры", ButtonHref: h.stickersHref("addstickers", name), ButtonShine: true,
		})
		return
	}
	if err != nil {
		h.internalError(w)
		return
	}
	scheme, what, button := "addstickers", "набор стикеров", "Добавить стикеры"
	if set.Emoji {
		scheme, what, button = "addemoji", "набор эмодзи", "Добавить эмодзи"
	}
	h.render(w, http.StatusOK, pageView{
		PageTitle: "Messenger: Добавить " + what,
		OGTitle:   "Добавить " + what + " " + set.Title + " в Messenger",
		Icon:      "stickers", Lead: scheme, LeadName: set.Title,
		ButtonText: button, ButtonShine: true,
		ButtonHref: h.stickersHref(scheme, set.ShortName),
	})
}

// stickersHref — вход в клиент по схеме tweb `#?tgaddr=<tg://addstickers?set=…>`.
func (h *PublicHandler) stickersHref(scheme, name string) string {
	return h.inApp("#?tgaddr=" + url.QueryEscape("tg://"+scheme+"?set="+url.QueryEscape(name)))
}

var ruMonths = [...]string{"янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"}

// shortCount — счётчик просмотров как у t.me: 999, 1.2K, 3.14M.
func shortCount(n int64) string {
	switch {
	case n < 1000:
		return strconv.FormatInt(n, 10)
	case n < 1_000_000:
		return trimZeros(fmt.Sprintf("%.1f", float64(n)/1000)) + "K"
	default:
		return trimZeros(fmt.Sprintf("%.2f", float64(n)/1_000_000)) + "M"
	}
}

func trimZeros(s string) string {
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}

// Post — GET /{username}/{seq}: пост публичного канала (tgme_page_post).
func (h *PublicHandler) Post(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")
	seq, err := strconv.ParseInt(chi.URLParam(r, "seq"), 10, 64)
	if err != nil {
		h.notFoundUser(w, username)
		return
	}
	p, err := h.uc.Post(r.Context(), username, seq)
	if errors.Is(err, domain.ErrNotFound) {
		h.postNotFound(w, r, username)
		return
	}
	if err != nil {
		h.internalError(w)
		return
	}
	ch := p.Channel
	postURL := h.page(fmt.Sprintf("/%s/%d", ch.Username, p.Seq))
	channelURL := h.page("/" + ch.Username)
	d := p.CreatedAt.UTC()
	pv := &postView{
		AuthorName: ch.Title, AuthorHref: channelURL, Initial: initialOf(ch.Title),
		Text:      renderRichText(p.Text, p.Entities),
		Views:     shortCount(p.Views),
		Date:      fmt.Sprintf("%d %s %d в %s", d.Day(), ruMonths[d.Month()-1], d.Year(), d.Format("15:04")),
		DateISO:   d.Format(time.RFC3339),
		LinkLabel: strings.TrimPrefix(strings.TrimPrefix(channelURL, "https://"), "http://"), Link: postURL,
	}
	v := pageView{
		PageTitle: "Messenger: Просмотр @" + ch.Username,
		OGTitle:   ch.Title, OGDescription: plainPreview(p.Text, 200),
		ButtonText: "Открыть в приложении", ButtonHref: h.inApp("#@" + ch.Username + "/" + strconv.FormatInt(p.Seq, 10)),
		ButtonShine: true, AvatarGradient: gradientOf(ch.Title),
		Post: pv,
	}
	if h.hasPhoto(ch.AvatarMediaID) {
		pv.AuthorPhoto = channelURL + "/photo"
		v.OGImage = pv.AuthorPhoto
	}
	if h.hasPhoto(p.MediaID) {
		pv.PhotoURL = postURL + "/photo"
		pv.PhotoW, pv.PhotoH = p.MediaW, p.MediaH
		v.OGImage = pv.PhotoURL
	}
	h.render(w, http.StatusOK, v)
}

// postNotFound — у t.me: канал есть, поста нет — страница поста с ошибкой
// в бабле («!» вместо аватарки); нет и канала — страница незанятого имени.
func (h *PublicHandler) postNotFound(w http.ResponseWriter, r *http.Request, username string) {
	ch, err := h.uc.Resolve(r.Context(), username)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && ch.Kind != "channel") {
		h.notFoundUser(w, username)
		return
	}
	if err != nil {
		h.internalError(w)
		return
	}
	h.render(w, http.StatusNotFound, pageView{
		PageTitle: "Messenger: Просмотр @" + ch.Username, NoIndex: true,
		OGTitle:    ch.Title,
		ButtonText: "Открыть в приложении", ButtonHref: h.inApp("#@" + ch.Username), ButtonShine: true,
		AvatarGradient: template.CSS("#e57979"),
		Post:           &postView{Error: "Пост не найден", Initial: "!"},
	})
}

// PrivatePost — GET /c/{id}/{seq}: пост закрытой группы/канала. Как у t.me —
// без обращения к данным (аноним не должен узнать даже, есть ли такой чат):
// «ссылка работает только для участников» и вход в клиент на `#-<id>/<seq>`.
func (h *PublicHandler) PrivatePost(w http.ResponseWriter, r *http.Request) {
	id, err1 := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	seq, err2 := strconv.ParseInt(chi.URLParam(r, "seq"), 10, 64)
	if err1 != nil || err2 != nil || id <= 0 || seq <= 0 {
		h.notFoundUser(w, "c")
		return
	}
	h.render(w, http.StatusOK, pageView{
		PageTitle: "Messenger", NoIndex: true,
		Icon: "group", Lead: "privatepost",
		ButtonText: "Открыть сообщение", ButtonShine: true,
		ButtonHref: h.inApp(fmt.Sprintf("#-%d/%d", id, seq)),
	})
}

// PostPhoto — GET /{username}/{seq}/photo: картинка поста.
func (h *PublicHandler) PostPhoto(w http.ResponseWriter, r *http.Request) {
	seq, err := strconv.ParseInt(chi.URLParam(r, "seq"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	p, err := h.uc.Post(r.Context(), chi.URLParam(r, "username"), seq)
	if err != nil {
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	h.serveMedia(w, r, p.MediaID)
}
