package http

import (
	"embed"
	"errors"
	"fmt"
	"html/template"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/messenger-denis/backend/internal/domain"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	usecasepublic "github.com/messenger-denis/backend/internal/usecase/public"
)

//go:embed templates/public_page.html
var publicPageFS embed.FS

var publicPageTpl = template.Must(template.ParseFS(publicPageFS, "templates/public_page.html"))

// PublicHandler — публичная страница-превью @username (аналог t.me):
// GET /@{username} — HTML, GET /@{username}/photo — аватарка.
type PublicHandler struct {
	uc    *usecasepublic.Interactor
	media *usecasemedia.Interactor // nil — MinIO выключен, фото недоступны
}

func NewPublicHandler(uc *usecasepublic.Interactor, media *usecasemedia.Interactor) *PublicHandler {
	return &PublicHandler{uc: uc, media: media}
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

type publicPageData struct {
	Kind           string
	Title          string
	Username       string
	About          string
	Extra          string
	ButtonText     string
	Verified       bool
	HasPhoto       bool
	Initial        string
	AvatarGradient template.CSS
}

func (h *PublicHandler) Page(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")
	p, err := h.uc.Resolve(r.Context(), username)
	if errors.Is(err, domain.ErrNotFound) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_ = publicPageTpl.Execute(w, publicPageData{
			Kind: "none", Title: "@" + username, Username: username,
			Extra: "Такого имени пользователя нет", ButtonText: "Открыть Web",
			Initial: "?", AvatarGradient: template.CSS(avatarGradients[0]),
		})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}

	data := publicPageData{
		Kind:     p.Kind,
		Title:    p.Title,
		Username: p.Username,
		About:    p.About,
		Verified: p.Verified,
		HasPhoto: p.AvatarMediaID != 0 && h.media != nil,
	}
	switch p.Kind {
	case "group":
		data.Extra = fmt.Sprintf("%d %s", p.MemberCount, ruPlural(p.MemberCount, "участник", "участника", "участников"))
		data.ButtonText = "Открыть в Web"
	case "channel":
		data.Extra = fmt.Sprintf("%d %s", p.MemberCount, ruPlural(p.MemberCount, "подписчик", "подписчика", "подписчиков"))
		data.ButtonText = "Открыть в Web"
	default:
		data.Extra = "@" + p.Username
		data.ButtonText = "Отправить сообщение"
	}
	initial := "?"
	for _, r := range p.Title {
		initial = string(r)
		break
	}
	data.Initial = initial
	var hash int
	for _, c := range p.Title {
		hash = (hash*31 + int(c)) % len(avatarGradients)
	}
	if hash < 0 {
		hash = -hash
	}
	data.AvatarGradient = template.CSS(avatarGradients[hash])

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_ = publicPageTpl.Execute(w, data)
}

// Photo — публичная аватарка страницы (аватар и так виден всем, как на t.me).
func (h *PublicHandler) Photo(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")
	p, err := h.uc.Resolve(r.Context(), username)
	if err != nil || p.AvatarMediaID == 0 || h.media == nil {
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	rc, info, _, err := h.media.GetContent(r.Context(), p.AvatarMediaID)
	if err != nil {
		writeError(w, http.StatusNotFound, "no photo")
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", info.ContentType)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeContent(w, r, "", info.ModTime, rc)
}
