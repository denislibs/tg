package http

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/messenger-denis/backend/internal/domain"
	usecaselangpack "github.com/messenger-denis/backend/internal/usecase/langpack"
)

// LangPackHandler — витрины языкового пакета (`langpack.*` схемы).
//
// Ручки ПУБЛИЧНЫЕ, вне группы Bearer, и это не упущение: строки нужны экрану
// входа, то есть до того, как появился токен. У оригинала методы `langpack.*`
// точно так же вызываются на незалогиненном соединении.
type LangPackHandler struct{ uc *usecaselangpack.Interactor }

func NewLangPackHandler(uc *usecaselangpack.Interactor) *LangPackHandler {
	return &LangPackHandler{uc: uc}
}

// Имена отказов. Приезжают клиенту телом конструктора `error` и становятся
// `HttpError.type` — тем, по чему ветвится вызывающий (у оригинала это
// `ApiError.type`). Первые два — имена самого Telegram.
const (
	errLangCodeNotSupported = "LANG_CODE_NOT_SUPPORTED"
	errLangPackInvalid      = "LANG_PACK_INVALID"
	errFromVersionInvalid   = "FROM_VERSION_INVALID"
	errLangKeysTooMany      = "LANG_KEYS_TOO_MANY"
)

// maxLangCodeLen — предел длины кода языка. Не про безопасность, а про смысл:
// код языка это `ru`, `pt-br`, `zh-hans`, и всё, что длиннее, — не код.
const maxLangCodeLen = 16

// langCode достаёт код языка из пути и отсеивает то, что кодом быть не может.
//
// Неподходящее отсеивается ЗДЕСЬ, а не запросом в базу: «такого языка нет» —
// правильный ответ и на `ru-XX`, и на километровую строку, но искать её в
// таблице незачем.
func langCode(r *http.Request) (string, bool) {
	code := chi.URLParam(r, "langCode")
	if code == "" || len(code) > maxLangCodeLen {
		return "", false
	}
	for i := 0; i < len(code); i++ {
		c := code[i]
		if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' {
			continue
		}
		return "", false
	}
	return code, true
}

// Languages — `langpack.getLanguages`: все языки пакета.
func (h *LangPackHandler) Languages(w http.ResponseWriter, r *http.Request) {
	langs, err := h.uc.Languages(r.Context())
	if err != nil {
		writeLangPackError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, langs)
}

// Language — `langpack.getLanguage`: один язык.
func (h *LangPackHandler) Language(w http.ResponseWriter, r *http.Request) {
	code, ok := langCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, errLangCodeNotSupported)
		return
	}
	lang, err := h.uc.Language(r.Context(), code)
	if err != nil {
		writeLangPackError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, lang)
}

// LangPack — `langpack.getLangPack`: весь пакет языка.
func (h *LangPackHandler) LangPack(w http.ResponseWriter, r *http.Request) {
	code, ok := langCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, errLangCodeNotSupported)
		return
	}
	diff, err := h.uc.LangPack(r.Context(), code)
	if err != nil {
		writeLangPackError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, diff)
}

// Difference — `langpack.getDifference`: что изменилось после версии клиента.
//
// Версия приезжает параметром запроса и ОБЯЗАТЕЛЬНА. Подставить ноль вместо
// пропущенной было бы худшим из решений: разница молча превратилась бы в весь
// пакет, и ошибка клиента выглядела бы как рабочая ручка.
func (h *LangPackHandler) Difference(w http.ResponseWriter, r *http.Request) {
	code, ok := langCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, errLangCodeNotSupported)
		return
	}
	raw := r.URL.Query().Get("from_version")
	if raw == "" {
		writeError(w, http.StatusBadRequest, errFromVersionInvalid)
		return
	}
	from, err := strconv.Atoi(raw)
	if err != nil || from < 0 {
		writeError(w, http.StatusBadRequest, errFromVersionInvalid)
		return
	}
	diff, err := h.uc.Difference(r.Context(), code, from)
	if err != nil {
		writeLangPackError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, diff)
}

// Strings — `langpack.getStrings`: доспрос отдельных ключей.
//
// Ключи едут ПОВТОРЯЮЩИМСЯ параметром (`?key=A&key=B`), а не одним списком
// через разделитель: ключи содержат точки и заглавные буквы, и любой выбранный
// разделитель однажды встретится внутри ключа — тогда один ключ молча
// превратится в два ненайденных.
func (h *LangPackHandler) Strings(w http.ResponseWriter, r *http.Request) {
	code, ok := langCode(r)
	if !ok {
		writeError(w, http.StatusNotFound, errLangCodeNotSupported)
		return
	}
	keys := r.URL.Query()["key"]
	if len(keys) > usecaselangpack.MaxStringKeys {
		writeError(w, http.StatusBadRequest, errLangKeysTooMany)
		return
	}
	strings, err := h.uc.Strings(r.Context(), code, keys)
	if err != nil {
		writeLangPackError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, strings)
}

// writeLangPackError — отказ ИМЕНЕМ, а не текстом: клиент ветвится по
// `HttpError.type`, и «неизвестный язык» он обязан отличать от «сервер лёг».
func writeLangPackError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, errLangCodeNotSupported)
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, errLangPackInvalid)
	default:
		writeError(w, http.StatusInternalServerError, "langpack unavailable")
	}
}
