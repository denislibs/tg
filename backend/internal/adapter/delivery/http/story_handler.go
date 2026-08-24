package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/messenger-denis/backend/internal/domain"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
)

// StoryHandler serves the stories endpoints (post / feed / view / viewers /
// delete). It delegates all logic to the story service; privacy and
// author-gating live there.
// peers — слой разрешения peerId ↔ chatID: «поделиться историей» адресует пиров.
type StoryHandler struct {
	svc   *storyusecase.Service
	peers PeerResolver
}

func NewStoryHandler(svc *storyusecase.Service, peers PeerResolver) *StoryHandler {
	return &StoryHandler{svc: svc, peers: peers}
}

// storyAddr разбирает ВНЕШНИЙ адрес истории из пути: пир автора плюс номер
// внутри него. Глобального ключа снаружи больше нет — приём и причина те же,
// что у сообщения (`/chats/{peerID}/messages/{msgSeq}`).
//
// Автор истории у нас всегда пользователь (каналы историй не публикуют),
// поэтому ключ пира и есть его id; отдельного разрешения он не требует.
func storyAddr(w http.ResponseWriter, r *http.Request) (authorID, seq int64, ok bool) {
	authorID, ok = pathInt(w, r, "peerID")
	if !ok {
		return 0, 0, false
	}
	seq, ok = pathInt(w, r, "storySeq")
	if !ok {
		return 0, 0, false
	}
	return authorID, seq, true
}

func (h *StoryHandler) mapErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrBadReaction):
		writeError(w, http.StatusBadRequest, "invalid reaction")
	case errors.Is(err, domain.ErrTooLong):
		writeError(w, http.StatusBadRequest, "too long")
	case errors.Is(err, domain.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid request")
	case errors.Is(err, domain.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrConflict):
		writeError(w, http.StatusConflict, "cooldown")
	case errors.Is(err, domain.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "unavailable")
	default:
		writeError(w, http.StatusInternalServerError, "server error")
	}
}

// reactionsJSON serializes a per-emoji reaction breakdown (emoji/count/mine).
//
// Осталась ОДНОМУ потребителю — статистике историй (её форма у нас своя, см.
// Р12 разбора). Витрины историй ей больше не пользуются: разбивка едет чипами
// `reactionCount` внутри `storyViews`.
func reactionsJSON(rcs []domain.ReactionCount) []map[string]any {
	out := make([]map[string]any, 0, len(rcs))
	for _, rc := range rcs {
		out = append(out, map[string]any{"emoji": rc.Emoji, "count": rc.Count, "mine": rc.Mine})
	}
	return out
}

// storyItems переводит строки выборки в конструкторы `storyItem`.
//
// `owner` — истории принадлежат зрителю: от этого зависит один параметр,
// аудитория (`privacy`), которую видит только автор.
func storyItems(items []domain.StoryRecord, owner bool) []domain.StoryItem {
	out := make([]domain.StoryItem, 0, len(items))
	for _, it := range items {
		out = append(out, it.ToStoryItem(owner))
	}
	return out
}

func (h *StoryHandler) Post(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		MediaID      int64             `json:"media_id"`
		Caption      string            `json:"caption"`
		Privacy      string            `json:"privacy"`
		AllowUserIDs []int64           `json:"allow_user_ids"`
		MediaAreas   domain.MediaAreas `json:"media_areas"`
		// Period — срок жизни истории в секундах (6h/12h/24h/48h; 24h по умолчанию).
		Period int64 `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.MediaID == 0 {
		writeError(w, http.StatusBadRequest, "media_id required")
		return
	}
	id, err := h.svc.Post(r.Context(), user.ID, b.MediaID, b.Caption, b.Privacy, b.AllowUserIDs, b.MediaAreas, b.Period)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Ответ — САМ номер созданной истории: обёртка `{"id": …}` конструктора
	// не имеет, а `int` это объявленный тип схемы.
	writeJSON(w, http.StatusOK, id)
}

// Repost serves POST /stories/repost — republish an existing story as a new one
// referencing the source (tweb fwd_from). Body: source_story_id (required),
// optional source_author_id (informational), caption/privacy/allow_user_ids/period
// like Post.
func (h *StoryHandler) Repost(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	// Источник адресуется ПАРОЙ «автор + номер»: `source_author_id` перестал
	// быть справочным полем и стал половиной адреса.
	var b struct {
		SourceAuthorID int64   `json:"source_author_id"`
		SourceStoryID  int64   `json:"source_story_id"`
		Caption        string  `json:"caption"`
		Privacy        string  `json:"privacy"`
		AllowUserIDs   []int64 `json:"allow_user_ids"`
		Period         int64   `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.SourceStoryID == 0 || b.SourceAuthorID == 0 {
		writeError(w, http.StatusBadRequest, "source_author_id and source_story_id required")
		return
	}
	id, err := h.svc.Repost(r.Context(), user.ID, b.SourceAuthorID, b.SourceStoryID, b.Caption, b.Privacy, b.AllowUserIDs, b.Period)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Ответ — САМ номер созданной истории: обёртка `{"id": …}` конструктора
	// не имеет, а `int` это объявленный тип схемы.
	writeJSON(w, http.StatusOK, id)
}

// Share serves POST /stories/{storyID}/share — post the story into the given
// chats as a regular media message with an attribution caption. Body: {peer_ids}.
func (h *StoryHandler) Share(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	authorID, seq, ok := storyAddr(w, r)
	if !ok {
		return
	}
	var b struct {
		PeerIDs []domain.PeerID `json:"peer_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || len(b.PeerIDs) == 0 {
		writeError(w, http.StatusBadRequest, "peer_ids required")
		return
	}
	chatIDs := make([]int64, 0, len(b.PeerIDs))
	for _, p := range b.PeerIDs {
		id, ok := resolveBodyPeer(w, r, h.peers, p, true)
		if !ok {
			return
		}
		chatIDs = append(chatIDs, id)
	}
	sent, err := h.svc.Share(r.Context(), authorID, seq, user.ID, chatIDs)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Ответ — САМО число чатов, куда история ушла.
	writeJSON(w, http.StatusOK, sent)
}

func (h *StoryHandler) Feed(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	groups, err := h.svc.Feed(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Контейнер `stories.allStories`: карточки авторов едут ОДИН раз вектором
	// `users`, а внутри группы стоит ссылка `peer` — то же решение, что порт
	// диалогов принял для контейнера `/chats`.
	peerStories := make([]domain.PeerStories, 0, len(groups))
	users := make([]domain.User, 0, len(groups))
	for i := range groups {
		author := &groups[i].Author
		peerStories = append(peerStories, domain.NewPeerStories(
			domain.NewPeer(domain.PeerID(author.ID)),
			groups[i].MaxReadID,
			storyItems(groups[i].Stories, author.ID == user.ID),
		))
		users = append(users, author)
	}
	// Stealth-окно приезжает ВМЕСТЕ с лентой, как у оригинала. Хранилище
	// опционально — тогда окна просто нет (оба срока отсутствуют).
	stealth, _ := h.svc.StealthState(r.Context(), user.ID)
	writeJSON(w, http.StatusOK, domain.NewStoriesAllStories(peerStories, users, stealthMode(stealth)))
}

func (h *StoryHandler) View(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	authorID, seq, ok := storyAddr(w, r)
	if !ok {
		return
	}
	if err := h.svc.View(r.Context(), authorID, seq, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *StoryHandler) Viewers(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	authorID, seq, ok := storyAddr(w, r)
	if !ok {
		return
	}
	viewers, err := h.svc.Viewers(r.Context(), authorID, seq, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Контейнер `stories.storyViewsList`: сам просмотр (кто, КОГДА и чем
	// отреагировал) отдельно, карточки зрителей — вектором `users`.
	writeJSON(w, http.StatusOK, domain.NewStoriesStoryViewsList(viewers.Views, usersOf(viewers.Users), reactedCount(viewers.Views)))
}

// usersOf поднимает карточки до объединения `User` — вектор контейнера.
func usersOf(in []domain.UserReal) []domain.User {
	out := make([]domain.User, 0, len(in))
	for i := range in {
		out = append(out, &in[i])
	}
	return out
}

// reactedCount — сколько зрителей отреагировали (`storyViewsList.reactions_count`).
func reactedCount(views []domain.StoryView) int {
	n := 0
	for _, v := range views {
		if v.Reaction != nil {
			n++
		}
	}
	return n
}

// Stats serves GET /stories/{storyID}/stats — view statistics for the author's
// own story (tweb stats.getStoryStats): total views + a per-day views series.
func (h *StoryHandler) Stats(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	authorID, seq, ok := storyAddr(w, r)
	if !ok {
		return
	}
	st, err := h.svc.Stats(r.Context(), authorID, seq, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"views":           st.Views,
		"views_by_day":    seriesJSON(st.ViewsByDay),
		"reactions_total": st.ReactionsTotal,
		"reactions":       reactionsJSON(st.Reactions),
	})
}

// SetReaction serves POST /stories/{storyID}/reaction — set/replace the
// caller's reaction on a story they can see (tweb stories.sendReaction).
func (h *StoryHandler) SetReaction(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	authorID, seq, ok := storyAddr(w, r)
	if !ok {
		return
	}
	var b struct {
		Reaction string `json:"reaction"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.Reaction == "" {
		writeError(w, http.StatusBadRequest, "reaction required")
		return
	}
	if err := h.svc.SetReaction(r.Context(), authorID, seq, user.ID, b.Reaction); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// RemoveReaction serves DELETE /stories/{storyID}/reaction — clear the caller's
// reaction on a story they can see.
func (h *StoryHandler) RemoveReaction(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	authorID, seq, ok := storyAddr(w, r)
	if !ok {
		return
	}
	if err := h.svc.RemoveReaction(r.Context(), authorID, seq, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

func (h *StoryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	_, seq, ok := storyAddr(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), seq, user.ID); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// CloseFriends serves GET /me/close_friends → {user_ids:[...]}.
func (h *StoryHandler) CloseFriends(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	ids, err := h.svc.CloseFriends(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	// Ответ — сам ВЕКТОР ключей (`Vector<long>`), а не список под именем поля.
	writeJSON(w, http.StatusOK, orEmptyIDs(ids))
}

// SetCloseFriends serves PUT /me/close_friends body {user_ids:[...]} — full
// replacement of the caller's close-friends list.
func (h *StoryHandler) SetCloseFriends(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	var b struct {
		UserIDs []int64 `json:"user_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.SetCloseFriends(r.Context(), user.ID, b.UserIDs); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// stealthMode переводит окно stealth-режима в конструктор схемы.
//
// Даты становятся секундами эпохи, а «окна нет» — ОТСУТСТВИЕМ параметра, а не
// значением null под тем же ключом (Р10 разбора).
func stealthMode(m domain.StealthMode) domain.StoriesStealthMode {
	var active, cooldown int64
	if !m.ActiveUntil.IsZero() {
		active = m.ActiveUntil.Unix()
	}
	if !m.CooldownUntil.IsZero() {
		cooldown = m.CooldownUntil.Unix()
	}
	return domain.NewStoriesStealthMode(active, cooldown)
}

// StealthState serves GET /stories/stealth → current stealth window.
func (h *StoryHandler) StealthState(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	m, err := h.svc.StealthState(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stealthMode(m))
}

// ActivateStealth serves POST /stories/stealth/activate → the new window, or
// 409 while a cooldown is still in effect.
func (h *StoryHandler) ActivateStealth(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	m, err := h.svc.ActivateStealth(r.Context(), user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stealthMode(m))
}

// Archive serves GET /stories/archive?limit&offset_id → the caller's own expired
// stories, newest first.
func (h *StoryHandler) Archive(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	limit, _ := strconv.ParseInt(r.URL.Query().Get("limit"), 10, 64)
	offsetID, _ := strconv.ParseInt(r.URL.Query().Get("offset_id"), 10, 64)
	items, err := h.svc.Archive(r.Context(), user.ID, limit, offsetID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewStoriesStories(storyItems(items, true), nil))
}

// Pinned serves GET /stories/pinned?peer={userID} → a peer's pinned stories
// (defaults to the caller when peer is omitted).
func (h *StoryHandler) Pinned(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	peer, _ := strconv.ParseInt(r.URL.Query().Get("peer"), 10, 64)
	if peer == 0 {
		peer = user.ID
	}
	items, err := h.svc.PinnedStories(r.Context(), peer, user.ID)
	if err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewStoriesStories(storyItems(items, peer == user.ID), nil))
}

// Pin serves POST /stories/{storyID}/pin body {pinned} — owner toggles the
// profile-pin of a story.
func (h *StoryHandler) Pin(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	_, seq, ok := storyAddr(w, r)
	if !ok {
		return
	}
	var b struct {
		Pinned bool `json:"pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.SetPinned(r.Context(), seq, user.ID, b.Pinned); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}

// Edit serves PATCH /stories/{storyID} body {caption?, privacy?, allow_user_ids?}
// — owner edits a story; caption/privacy are optional and omitted fields are
// left unchanged.
func (h *StoryHandler) Edit(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	_, seq, ok := storyAddr(w, r)
	if !ok {
		return
	}
	var b struct {
		Caption      *string            `json:"caption"`
		Privacy      *string            `json:"privacy"`
		AllowUserIDs []int64            `json:"allow_user_ids"`
		MediaAreas   *domain.MediaAreas `json:"media_areas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.EditStory(r.Context(), seq, user.ID, b.Caption, b.Privacy, b.AllowUserIDs, b.MediaAreas); err != nil {
		h.mapErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.NewBool(true))
}
