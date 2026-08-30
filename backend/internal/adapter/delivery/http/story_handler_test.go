package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasecontacts "github.com/messenger-denis/backend/internal/usecase/contacts"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
	storyusecase "github.com/messenger-denis/backend/internal/usecase/story"
)

// newStoryRouter builds a router wired with auth, chat, media, and story
// handlers over the test DB (media uses an in-memory storage so uploads work
// without MinIO).
func newStoryRouter(t *testing.T) (http.Handler, *pgxpool.Pool) {
	pool := postgres.NewTestDB(t)
	chatUC := newChatUC(pool)
	authUC := newAuthUC(pool)
	mediaH := NewMediaHandler(usecasemedia.New(pgadapter.NewMediaRepo(pool), newFakeStorage(), nil), chatUC, authUC, "test-secret")
	storySvc := storyusecase.New(
		pgadapter.NewStoryRepo(pool),
		chatUC,
		pgadapter.NewMediaAccessRepo(pool),
		pgadapter.NewTxManager(pool),
	)
	storySvc.SetMessageSender(chatUC)
	storyH := NewStoryHandler(storySvc, chatUC)
	// Адресная книга подключена не для полноты: близость к другу читается
	// именно оттуда — флагом карточки (`user.pFlags.close_friend`). Без неё
	// связка «поставил близким → видно на карточке» была бы непроверяема.
	contactsUC := usecasecontacts.New(pgadapter.NewContactsRepo(pool))
	contactsUC.SetCloseFriends(storySvc)
	return NewRouter(authUC, chatUC, nil, mediaH, nil, nil, storyH, nil, contactsUC, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil), pool
}

// ── форма ответа: контейнеры схемы ──────────────────────────────────────────
//
// GET /stories отвечает `stories.allStories`: группы — `peerStories` со
// ССЫЛКОЙ на автора, карточки авторов — ОДИН раз вектором `users`. Плоского
// `{groups:[{author, stories}]}` больше нет.

type wireStory struct {
	ID         int64            `json:"id"`
	Caption    string           `json:"caption"`
	PFlags     map[string]bool  `json:"pFlags"`
	Media      map[string]any   `json:"media"`
	MediaAreas []map[string]any `json:"media_areas"`
	Privacy    []map[string]any `json:"privacy"`
	Views      map[string]any   `json:"views"`
	Viewed     bool             `json:"viewed"`
	FwdFrom    map[string]any   `json:"fwd_from"`
}

type wireFeed struct {
	PeerStories []struct {
		Peer      map[string]any `json:"peer"`
		MaxReadID int64          `json:"max_read_id"`
		Stories   []wireStory    `json:"stories"`
	} `json:"peer_stories"`
	Users []struct {
		ID int64 `json:"id"`
	} `json:"users"`
	StealthMode map[string]any `json:"stealth_mode"`
}

// decodeFeed разбирает контейнер ленты.
func decodeFeed(t *testing.T, body string) wireFeed {
	t.Helper()
	var f wireFeed
	if err := json.Unmarshal([]byte(body), &f); err != nil {
		t.Fatalf("feed не разбирается: %v (%s)", err, body)
	}
	return f
}

// onlyStory требует ровно одну группу с одной историей — форма, в которой ленту
// проверяет большинство сценариев.
// decodeStoryKeys — сырые ключи первой истории ленты. Отсутствие ключа
// типизированной структурой не проверить: она молча отбросит лишнее.
func decodeStoryKeys(t *testing.T, body string) map[string]any {
	t.Helper()
	var raw struct {
		PeerStories []struct {
			Stories []map[string]any `json:"stories"`
		} `json:"peer_stories"`
	}
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		t.Fatalf("feed не разбирается: %v", err)
	}
	if len(raw.PeerStories) == 0 || len(raw.PeerStories[0].Stories) == 0 {
		t.Fatalf("feed пуст: %s", body)
	}
	return raw.PeerStories[0].Stories[0]
}

func onlyStory(t *testing.T, body string) wireStory {
	t.Helper()
	f := decodeFeed(t, body)
	if len(f.PeerStories) != 1 || len(f.PeerStories[0].Stories) != 1 {
		t.Fatalf("feed shape: %s", body)
	}
	return f.PeerStories[0].Stories[0]
}

func TestStories_Lifecycle_HTTP(t *testing.T) {
	h, pool := newStoryRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990000070")
	tokenB, idB := signUp(t, h, pool, "+79990000071")
	tokenC, _ := signUp(t, h, pool, "+79990000072")

	// A ставит B близким другом. Читается это НЕ отдельной ручкой — её нет ни
	// у нас, ни в схеме, — а флагом на карточке контакта.
	rec := authedReq(t, h, http.MethodPut, "/me/close_friends", tokenA, map[string]any{"user_ids": []int64{idB}})
	if rec.Code != http.StatusOK {
		t.Fatalf("set close_friends: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/contacts", tokenA,
		map[string]any{"contact_id": idB, "first_name": "Близкий"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("add contact: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/contacts", tokenA, nil)
	var book struct {
		Users []struct {
			ID     int64           `json:"id"`
			PFlags map[string]bool `json:"pFlags"`
		} `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &book); err != nil {
		t.Fatalf("адресная книга не разбирается: %v (%s)", err, rec.Body.String())
	}
	var friendCard *struct {
		ID     int64           `json:"id"`
		PFlags map[string]bool `json:"pFlags"`
	}
	for i := range book.Users {
		if book.Users[i].ID == idB {
			friendCard = &book.Users[i]
		}
	}
	if friendCard == nil {
		t.Fatalf("карточки %d нет в книге: %s", idB, rec.Body.String())
	}
	if !friendCard.PFlags["close_friend"] {
		t.Fatalf("close_friend не поднят: pFlags = %v", friendCard.PFlags)
	}

	// A uploads media and posts a "close" story.
	rec = authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	rec = authedReq(t, h, http.MethodPost, "/stories", tokenA, map[string]any{
		"media_id": created.MediaID, "caption": "close story", "privacy": "close",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post close story: %d %s", rec.Code, rec.Body.String())
	}
	var posted int64
	_ = json.Unmarshal(rec.Body.Bytes(), &posted)

	// Close friend B can view; stranger C is forbidden from viewing and reacting.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/view", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("B view close story: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/view", tokenC, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C view close story: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/reaction", tokenC, map[string]any{"reaction": "👍"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C react close story: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// A edits the story: new caption + widen to everyone; payload shows edited=true.
	rec = authedReq(t, h, http.MethodPatch, "/stories/"+itoa(idA)+"/"+itoa(posted), tokenA, map[string]any{
		"caption": "edited", "privacy": "everyone",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("edit story: %d %s", rec.Code, rec.Body.String())
	}
	// C (non-owner) cannot edit.
	rec = authedReq(t, h, http.MethodPatch, "/stories/"+itoa(idA)+"/"+itoa(posted), tokenC, map[string]any{"caption": "hax"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C edit: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// A's own feed reflects edited=true, privacy=everyone, new caption.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenA, nil)
	st := onlyStory(t, rec.Body.String())
	// «Отредактирована» и аудитория — ФЛАГИ истории, а не поля-строки: строки
	// `privacy: "everyone"` на проводе больше нет вовсе.
	if !st.PFlags["edited"] || !st.PFlags["public"] || st.Caption != "edited" {
		t.Fatalf("edited story payload = %+v", st)
	}
	// Аудитория автору едет вектором ПРАВИЛ.
	if len(st.Privacy) != 1 || st.Privacy[0]["_"] != "privacyValueAllowAll" {
		t.Fatalf("privacy = %+v", st.Privacy)
	}

	// A pins the story; non-owner C cannot.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/pin", tokenA, map[string]any{"pinned": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("pin: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/pin", tokenC, map[string]any{"pinned": false})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C pin: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// Pinned list for A returns the story with pinned=true.
	rec = authedReq(t, h, http.MethodGet, "/stories/pinned?peer="+itoa(idA), tokenA, nil)
	// Плоский список — контейнер `stories.stories`; «закреплена» это ФЛАГ.
	var pinned struct {
		Count   int         `json:"count"`
		Stories []wireStory `json:"stories"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &pinned)
	if pinned.Count != 1 || len(pinned.Stories) != 1 || pinned.Stories[0].ID != posted {
		t.Fatalf("pinned = %s", rec.Body.String())
	}
	if !pinned.Stories[0].PFlags["pinned"] {
		t.Fatalf("pinned флаг не выехал: %s", rec.Body.String())
	}

	// Stealth store is not configured in this router → 503.
	rec = authedReq(t, h, http.MethodGet, "/stories/stealth", tokenA, nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("stealth state without store: want 503, got %d %s", rec.Code, rec.Body.String())
	}
}

// TestStories_SelectedAllowlist_HTTP verifies that allow_user_ids is exposed
// only on the author's own selected story, never to other viewers (even those
// on the allowlist), so audiences of others' stories are not revealed.
func TestStories_SelectedAllowlist_HTTP(t *testing.T) {
	h, pool := newStoryRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990000080")
	tokenB, idB := signUp(t, h, pool, "+79990000081")

	// A uploads media and posts a "selected" story allowing B.
	rec := authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	rec = authedReq(t, h, http.MethodPost, "/stories", tokenA, map[string]any{
		"media_id": created.MediaID, "caption": "sel", "privacy": "selected", "allow_user_ids": []int64{idB},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post selected story: %d %s", rec.Code, rec.Body.String())
	}

	// A (автор) видит аудиторию своей selected-истории — вектором правил
	// (`privacyValueAllowUsers`), а не отдельным ключом allow_user_ids.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenA, nil)
	st := onlyStory(t, rec.Body.String())
	if len(st.Privacy) != 1 || st.Privacy[0]["_"] != "privacyValueAllowUsers" {
		t.Fatalf("A own selected story privacy = %+v", st.Privacy)
	}
	users, _ := st.Privacy[0]["users"].([]any)
	if len(users) != 1 || int64(users[0].(float64)) != idB {
		t.Fatalf("A own selected story allow = %v; want [%d]", users, idB)
	}

	// B (в allow-листе, но не автор) историю видит, а аудиторию — нет: параметр
	// `privacy` до чужого зрителя не доезжает вовсе.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	body := rec.Body.String()
	stB := onlyStory(t, body)
	if len(stB.Privacy) != 0 {
		t.Fatalf("аудитория утекла не-автору: %s", body)
	}
	if strings.Contains(body, "allow_user_ids") {
		t.Fatalf("allow_user_ids leaked to non-owner: %s", body)
	}
}

func TestStories_Flow_HTTP(t *testing.T) {
	h, pool := newStoryRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990000060")
	tokenB, idB := signUp(t, h, pool, "+79990000061")

	// A uploads a media object they own.
	rec := authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.MediaID == 0 {
		t.Fatalf("no media id: %s", rec.Body.String())
	}

	// A↔B private chat so B is a contact (partner) of A.
	rec = authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}

	// A posts a story.
	rec = authedReq(t, h, http.MethodPost, "/stories", tokenA, map[string]any{
		"media_id": created.MediaID, "caption": "hi", "privacy": "contacts",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post story: %d %s", rec.Code, rec.Body.String())
	}
	var posted int64
	_ = json.Unmarshal(rec.Body.Bytes(), &posted)
	if posted == 0 {
		t.Fatalf("no story id: %s", rec.Body.String())
	}

	// B's feed shows A's story group with viewed=false.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("feed: %d %s", rec.Code, rec.Body.String())
	}
	feed := decodeFeed(t, rec.Body.String())
	if len(feed.PeerStories) != 1 || len(feed.PeerStories[0].Stories) != 1 {
		t.Fatalf("expected 1 group/1 story, got %s", rec.Body.String())
	}
	// Автор группы — ССЫЛКА `peer`, а его карточка едет вектором `users`.
	if got := feed.PeerStories[0].Peer["_"]; got != "peerUser" {
		t.Fatalf("группа адресует автора не ссылкой: %+v", feed.PeerStories[0].Peer)
	}
	if len(feed.Users) != 1 {
		t.Fatalf("карточка автора не выехала вектором users: %s", rec.Body.String())
	}
	// Вложение — СТУПЕНЬ: плоского media_id рядом с историей больше нет.
	story := feed.PeerStories[0].Stories[0]
	if story.Media == nil || story.Media["_"] == nil {
		t.Fatalf("медиа истории не ступень: %+v", story.Media)
	}
	if story.ID != posted {
		t.Fatalf("unexpected feed: %s", rec.Body.String())
	}
	// Прочитанность — ГОРИЗОНТ группы, а не признак истории: до просмотра он
	// нулевой, и «непрочитанную» клиент выводит сравнением, как непрочитанное
	// сообщение по read_inbox_max_id.
	if feed.PeerStories[0].MaxReadID != 0 {
		t.Fatalf("горизонт до просмотра = %d; ожидался 0", feed.PeerStories[0].MaxReadID)
	}
	if _, exists := decodeStoryKeys(t, rec.Body.String())["viewed"]; exists {
		t.Fatalf("признак viewed остался на истории: %s", rec.Body.String())
	}

	// B views the story.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/view", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("view: %d %s", rec.Code, rec.Body.String())
	}

	// Просмотр сдвинул горизонт — один номер на автора вместо признака на
	// каждой истории.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	if got := decodeFeed(t, rec.Body.String()).PeerStories[0].MaxReadID; got != posted {
		t.Fatalf("горизонт после просмотра = %d; ожидался %d", got, posted)
	}

	// A (author) sees B in the viewers list.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/viewers", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("viewers: %d %s", rec.Code, rec.Body.String())
	}
	// Контейнер `stories.storyViewsList`: сам просмотр (с ДАТОЙ) и карточка
	// зрителя — разными векторами.
	var viewers struct {
		Count int `json:"count"`
		Views []struct {
			UserID int64 `json:"user_id"`
			Date   int64 `json:"date"`
		} `json:"views"`
		Users []struct {
			ID int64 `json:"id"`
		} `json:"users"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &viewers)
	if viewers.Count != 1 || len(viewers.Views) != 1 || viewers.Views[0].UserID != idB {
		t.Fatalf("expected views=[B], got %s", rec.Body.String())
	}
	if viewers.Views[0].Date == 0 {
		t.Fatalf("дата просмотра не выехала: %s", rec.Body.String())
	}
	if len(viewers.Users) != 1 || viewers.Users[0].ID != idB {
		t.Fatalf("expected users=[B], got %s", rec.Body.String())
	}

	// B (non-author) is forbidden from the viewers list.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/viewers", tokenB, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-author viewers, got %d %s", rec.Code, rec.Body.String())
	}

	// A (author) reads story stats: 1 view + a per-day views series.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/stats", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
	}
	var stats struct {
		Views      int64 `json:"views"`
		ViewsByDay []struct {
			Date  string `json:"date"`
			Value int64  `json:"value"`
		} `json:"views_by_day"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &stats)
	if stats.Views != 1 || len(stats.ViewsByDay) != 1 || stats.ViewsByDay[0].Value != 1 {
		t.Fatalf("unexpected story stats: %s", rec.Body.String())
	}

	// B (non-author) is forbidden from story stats.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/stats", tokenB, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-author stats, got %d %s", rec.Code, rec.Body.String())
	}

	// B reacts to the story; A's feed reflects the aggregate; B's my_reaction set.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/reaction", tokenB, map[string]any{"reaction": "👍"})
	if rec.Code != http.StatusOK {
		t.Fatalf("react: %d %s", rec.Code, rec.Body.String())
	}
	// Агрегат реакций живёт ВНУТРИ `views`, а личная реакция — отдельным
	// параметром самой истории (`sent_reaction`): тело истории одно на всех
	// получателей, личное в нём выделено. Разбивка — чипы `reactionCount`,
	// «моя» в них выражена `chosen_order`, а не булевым `mine`.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	body := rec.Body.String()
	st := onlyStory(t, body)
	if st.Views == nil || int(st.Views["reactions_count"].(float64)) != 1 {
		t.Fatalf("expected views.reactions_count=1, got %s", body)
	}
	results, _ := st.Views["reactions"].([]any)
	if len(results) != 1 {
		t.Fatalf("unexpected reactions breakdown: %s", body)
	}
	chip, _ := results[0].(map[string]any)
	if r, _ := chip["reaction"].(map[string]any); r == nil || r["emoticon"] != "👍" {
		t.Fatalf("чип реакции = %+v", chip)
	}
	if int(chip["count"].(float64)) != 1 {
		t.Fatalf("счётчик чипа = %+v", chip)
	}
	if _, mine := chip["chosen_order"]; !mine {
		t.Fatalf("своя реакция не помечена chosen_order: %+v", chip)
	}
	var sent map[string]any
	_ = json.Unmarshal([]byte(body), &struct{}{})
	var withSent struct {
		PeerStories []struct {
			Stories []struct {
				SentReaction map[string]any `json:"sent_reaction"`
			} `json:"stories"`
		} `json:"peer_stories"`
	}
	_ = json.Unmarshal([]byte(body), &withSent)
	sent = withSent.PeerStories[0].Stories[0].SentReaction
	if sent == nil || sent["emoticon"] != "👍" {
		t.Fatalf("личная реакция не выехала параметром истории: %s", body)
	}

	// A's stats include the reaction.
	rec = authedReq(t, h, http.MethodGet, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/stats", tokenA, nil)
	var rstats struct {
		ReactionsTotal int64 `json:"reactions_total"`
		Reactions      []struct {
			Emoji string `json:"emoji"`
			Count int    `json:"count"`
		} `json:"reactions"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &rstats)
	if rstats.ReactionsTotal != 1 || len(rstats.Reactions) != 1 || rstats.Reactions[0].Emoji != "👍" {
		t.Fatalf("unexpected stats reactions: %s", rec.Body.String())
	}

	// B removes the reaction; count drops to 0.
	rec = authedReq(t, h, http.MethodDelete, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/reaction", tokenB, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("unreact: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	cleared := onlyStory(t, rec.Body.String())
	// Реакций не осталось — значит и рассказывать нечего: `views` не едет вовсе,
	// а не приезжает объектом с нулями.
	if cleared.Views != nil {
		t.Fatalf("expected reactions cleared, got %s", rec.Body.String())
	}

	// A deletes the story; it disappears from B's feed.
	rec = authedReq(t, h, http.MethodDelete, "/stories/"+itoa(idA)+"/"+itoa(posted), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	if len(decodeFeed(t, rec.Body.String()).PeerStories) != 0 {
		t.Fatalf("expected empty feed after delete, got %s", rec.Body.String())
	}
}

// TestStories_MediaAreasRepostShare_HTTP covers the 4d endpoints end-to-end:
// posting a story with media_areas (round-tripped in the feed payload), a
// visibility-gated repost carrying fwd_from, and sharing the story into a chat
// as a regular media message.
func TestStories_MediaAreasRepostShare_HTTP(t *testing.T) {
	h, pool := newStoryRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990000090")
	tokenB, idB := signUp(t, h, pool, "+79990000091")
	tokenC, _ := signUp(t, h, pool, "+79990000092")

	// A↔B private chat makes B a partner of A (can see contacts stories) and a
	// valid share target.
	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	chat := createdPeerFrom(t, rec)

	// A uploads media and posts a story with media_areas.
	rec = authedReq(t, h, http.MethodPost, "/media/upload", tokenA, map[string]any{"mime": "image/jpeg", "size": 2048})
	var created struct {
		MediaID int64 `json:"media_id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	// Области едут КОНСТРУКТОРАМИ и в запросе тоже: форма одна на всём пути —
	// тело запроса, колонка `stories.media_areas`, витрина.
	areas := []map[string]any{
		{
			"_":           "mediaAreaSuggestedReaction",
			"coordinates": map[string]any{"_": "mediaAreaCoordinates", "x": 50, "y": 50, "w": 10, "h": 10, "rotation": 0},
			"reaction":    map[string]any{"_": "reactionEmoji", "emoticon": "👍"},
		},
		{
			"_":           "mediaAreaGeoPoint",
			"coordinates": map[string]any{"_": "mediaAreaCoordinates", "x": 1, "y": 2, "w": 5, "h": 5, "rotation": 0},
			"geo":         map[string]any{"_": "geoPoint", "lat": 55.75, "long": 37.61},
		},
	}
	// "selected" allowing only B: B may repost/see it, C may not (contacts/everyone
	// stories are visible to everyone by the Visible predicate, so they can't gate C).
	rec = authedReq(t, h, http.MethodPost, "/stories", tokenA, map[string]any{
		"media_id": created.MediaID, "caption": "orig", "privacy": "selected",
		"allow_user_ids": []int64{idB}, "media_areas": areas,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("post story: %d %s", rec.Code, rec.Body.String())
	}
	var posted int64
	_ = json.Unmarshal(rec.Body.Bytes(), &posted)

	// A's feed payload carries media_areas.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenA, nil)
	fa := onlyStory(t, rec.Body.String()).MediaAreas
	// Вид области — ВЫБОР конструктора, а не строка `type`; эмодзи предложенной
	// реакции — объединение `Reaction`, а точка — ступень `geoPoint`.
	if len(fa) != 2 {
		t.Fatalf("media_areas payload = %+v", fa)
	}
	if fa[0]["_"] != "mediaAreaSuggestedReaction" {
		t.Fatalf("область реакции = %+v", fa[0])
	}
	if r, _ := fa[0]["reaction"].(map[string]any); r == nil || r["emoticon"] != "👍" {
		t.Fatalf("реакция области = %+v", fa[0]["reaction"])
	}
	if fa[1]["_"] != "mediaAreaGeoPoint" {
		t.Fatalf("гео-область = %+v", fa[1])
	}
	if g, _ := fa[1]["geo"].(map[string]any); g == nil || g["_"] != "geoPoint" {
		t.Fatalf("точка не ступень: %+v", fa[1]["geo"])
	}

	// C (no chat with A) cannot repost A's contacts story.
	rec = authedReq(t, h, http.MethodPost, "/stories/repost", tokenC, map[string]any{
		"source_author_id": idA, "source_story_id": posted,
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C repost: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// B (partner) reposts; the new story references A via fwd_from.
	rec = authedReq(t, h, http.MethodPost, "/stories/repost", tokenB, map[string]any{
		"source_author_id": idA, "source_story_id": posted, "caption": "look", "privacy": "everyone",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("B repost: %d %s", rec.Code, rec.Body.String())
	}
	var reposted int64
	_ = json.Unmarshal(rec.Body.Bytes(), &reposted)

	// B's feed shows the repost with fwd_from → A.
	//
	// Искать историю приходится ВНУТРИ группы автора: номер теперь пер-авторский,
	// и «первая история B» и «первая история A» имеют один и тот же номер. Это и
	// есть смысл адресации парой — сам по себе номер историю не адресует.
	rec = authedReq(t, h, http.MethodGet, "/stories", tokenB, nil)
	bfeed := decodeFeed(t, rec.Body.String())
	var fwdSeen bool
	for _, g := range bfeed.PeerStories {
		if int64(g.Peer["user_id"].(float64)) != idB {
			continue
		}
		for _, s := range g.Stories {
			if s.ID != reposted {
				continue
			}
			// Автор исходной истории — ССЫЛКА `peer`, а не число `author_id`.
			from, _ := s.FwdFrom["from"].(map[string]any)
			if from == nil || from["_"] != "peerUser" || int64(from["user_id"].(float64)) != idA {
				t.Fatalf("repost fwd_from payload = %+v", s.FwdFrom)
			}
			if int64(s.FwdFrom["story_id"].(float64)) != posted {
				t.Fatalf("repost fwd_from story = %+v", s.FwdFrom)
			}
			fwdSeen = true
		}
	}
	if !fwdSeen {
		t.Fatalf("repost not found in B feed: %s", rec.Body.String())
	}

	// A shares the story into the A↔B chat: sent count 1, a media message lands.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/share", tokenA, map[string]any{
		"peer_ids": []int64{chat},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("share: %d %s", rec.Code, rec.Body.String())
	}
	// Ответ — САМО число чатов, куда история ушла.
	var sent int
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)
	if sent != 1 {
		t.Fatalf("share sent = %d; want 1", sent)
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(chat)+"/history?limit=10", tokenA, nil)
	// Id медиа живёт ВНУТРИ вложения (document.id / photo.id), плоского
	// media_id рядом с ним больше нет.
	var hist struct {
		Messages []struct {
			Media *struct {
				Photo    *struct{ ID int64 } `json:"photo"`
				Document *struct{ ID int64 } `json:"document"`
			} `json:"media"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &hist)
	var shared bool
	for _, m := range hist.Messages {
		if m.Media == nil {
			continue
		}
		if (m.Media.Photo != nil && m.Media.Photo.ID == created.MediaID) ||
			(m.Media.Document != nil && m.Media.Document.ID == created.MediaID) {
			shared = true
		}
	}
	if !shared {
		t.Fatalf("shared media message not found in chat history: %s", rec.Body.String())
	}

	// C cannot share a story it cannot see.
	rec = authedReq(t, h, http.MethodPost, "/stories/"+itoa(idA)+"/"+itoa(posted)+"/share", tokenC, map[string]any{
		"peer_ids": []int64{chat},
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("C share: want 403, got %d %s", rec.Code, rec.Body.String())
	}
}
