package http

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
	usecasecontacts "github.com/messenger-denis/backend/internal/usecase/contacts"
	usecaseprivacy "github.com/messenger-denis/backend/internal/usecase/privacy"
)

// Роутер с адресной книгой (и личными фото) и профилем /users/{id}: то, что
// зритель записал о контакте, едет в ПОЛНОЙ карточке пользователя, как у
// оригинала (userFull.note, userFull.personal_photo, user.pFlags.contact).
func newContactCardRouter(t *testing.T) http.Handler {
	t.Helper()
	pool := postgres.NewTestDB(t)
	repo := pgadapter.NewContactsRepo(pool)
	contactsUC := usecasecontacts.New(repo)
	contactsUC.SetCustomPhotos(repo)
	privacyUC := usecaseprivacy.New(pgadapter.NewPrivacyRepo(pool))
	return NewRouter(newAuthUC(pool), newChatUC(pool), nil, nil, nil, nil, nil, nil, contactsUC,
		NewICEHandler("", "test"), nil, nil, nil, privacyUC, nil, nil, nil, nil, nil, nil, nil)
}

// profileCard — ответ /users/{id}: полная форма и краткая того же пользователя.
type profileCard struct {
	FullUser map[string]any   `json:"full_user"`
	Users    []map[string]any `json:"users"`
}

func getProfile(t *testing.T, h http.Handler, token string, userID int64) profileCard {
	t.Helper()
	rec := authedReq(t, h, http.MethodGet, "/users/"+itoa(userID), token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("profile: %d %s", rec.Code, rec.Body.String())
	}
	var out profileCard
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Users) != 1 {
		t.Fatalf("разбор профиля: %v (%s)", err, rec.Body.String())
	}
	return out
}

func textWithEntities(text string, entities ...map[string]any) map[string]any {
	if entities == nil {
		entities = []map[string]any{}
	}
	return map[string]any{"_": "textWithEntities", "text": text, "entities": entities}
}

func pflag(card map[string]any, name string) bool {
	flags, _ := card["pFlags"].(map[string]any)
	return flags[name] == true
}

// О-20: заметка контакта — TextWithEntities в userFull.note; addContact без
// note её не трогает, updateContactNote правит и стирает.
func TestContactNote_LivesInFullUser_HTTP(t *testing.T) {
	h := newContactCardRouter(t)
	tokenA, _ := signInToken(t, h, "+79990000301")
	tokenB, idB := signInToken(t, h, "+79990000302")
	_, idC := signInToken(t, h, "+79990000303")

	bold := map[string]any{"_": "messageEntityBold", "offset": 0, "length": 7}
	evil := map[string]any{"_": "messageEntityTextUrl", "offset": 0, "length": 7, "url": "javascript:alert(1)"}
	rec := authedReq(t, h, http.MethodPost, "/contacts", tokenA, map[string]any{
		"contact_id": idB, "first_name": "Майя", "note": textWithEntities("коллега", bold, evil),
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}

	note := func(token string, id int64) map[string]any {
		n, _ := getProfile(t, h, token, id).FullUser["note"].(map[string]any)
		return n
	}
	n := note(tokenA, idB)
	if n["_"] != "textWithEntities" || n["text"] != "коллега" {
		t.Fatalf("userFull.note = %v", n)
	}
	// Разметка — та же санитизация, что у сообщения: javascript:-ссылка не
	// хранится, жирный остаётся.
	if es, _ := n["entities"].([]any); len(es) != 1 || es[0].(map[string]any)["_"] != "messageEntityBold" {
		t.Fatalf("note.entities = %v, want только bold", n["entities"])
	}
	// Заметку видит только тот, кто её написал.
	if n := note(tokenB, idB); n != nil {
		t.Fatalf("чужая заметка утекла владельцу карточки: %v", n)
	}

	// addContact без note — правка имени, заметка цела (прежде upsert писал
	// note='' и стирал её при каждом сохранении без поля).
	if rec := authedReq(t, h, http.MethodPost, "/contacts", tokenA, map[string]any{
		"contact_id": idB, "first_name": "Майя2",
	}); rec.Code != http.StatusCreated {
		t.Fatalf("re-add: %d %s", rec.Code, rec.Body.String())
	}
	if n := note(tokenA, idB); n["text"] != "коллега" {
		t.Fatalf("addContact без note стёр заметку: %v", n)
	}

	// contacts.updateContactNote: правка — Bool, пустой текст стирает ключ.
	rec = authedReq(t, h, http.MethodPut, "/contacts/"+itoa(idB)+"/note", tokenA, map[string]any{
		"note": textWithEntities("друг"),
	})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "boolTrue") {
		t.Fatalf("update note: %d %s", rec.Code, rec.Body.String())
	}
	if n := note(tokenA, idB); n["text"] != "друг" {
		t.Fatalf("после updateContactNote: %v", n)
	}
	if rec := authedReq(t, h, http.MethodPut, "/contacts/"+itoa(idB)+"/note", tokenA, map[string]any{
		"note": textWithEntities(""),
	}); rec.Code != http.StatusOK {
		t.Fatalf("clear note: %d %s", rec.Code, rec.Body.String())
	}
	if n := note(tokenA, idB); n != nil {
		t.Fatalf("пустая заметка должна исчезнуть ключом: %v", n)
	}

	// Не контакт — заметку писать некуда.
	if rec := authedReq(t, h, http.MethodPut, "/contacts/"+itoa(idC)+"/note", tokenA, map[string]any{
		"note": textWithEntities("x"),
	}); rec.Code != http.StatusNotFound {
		t.Fatalf("note для не-контакта: %d, want 404", rec.Code)
	}
	// Предел длины — как у поля заметки оригинала (maxLength 128).
	long := strings.Repeat("я", 129)
	if rec := authedReq(t, h, http.MethodPut, "/contacts/"+itoa(idB)+"/note", tokenA, map[string]any{
		"note": textWithEntities(long),
	}); rec.Code != http.StatusBadRequest {
		t.Fatalf("длинная заметка: %d, want 400", rec.Code)
	}
	if rec := authedReq(t, h, http.MethodPost, "/contacts", tokenA, map[string]any{
		"contact_id": idB, "first_name": "Майя", "note": textWithEntities(long),
	}); rec.Code != http.StatusBadRequest {
		t.Fatalf("длинная заметка в addContact: %d, want 400", rec.Code)
	}
}

// О-21: профиль несёт признак «это контакт» (pFlags.contact/mutual_contact) и
// личное фото — полной формой (userFull.personal_photo) и краткой
// (user.photo с pFlags.personal), как книга и список диалогов.
func TestContactCard_FlagsAndPersonalPhoto_HTTP(t *testing.T) {
	h := newContactCardRouter(t)
	tokenA, idA := signInToken(t, h, "+79990000311")
	tokenB, idB := signInToken(t, h, "+79990000312")

	card := getProfile(t, h, tokenA, idB)
	if pflag(card.Users[0], "contact") || pflag(card.Users[0], "mutual_contact") {
		t.Fatalf("не контакт, а флаги есть: %v", card.Users[0])
	}

	if rec := authedReq(t, h, http.MethodPost, "/contacts", tokenA, map[string]any{
		"contact_id": idB, "first_name": "Би",
	}); rec.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}
	card = getProfile(t, h, tokenA, idB)
	if !pflag(card.Users[0], "contact") || pflag(card.Users[0], "mutual_contact") {
		t.Fatalf("A→B: contact без взаимности, got %v", card.Users[0]["pFlags"])
	}
	// Флаг зависит от ЗРИТЕЛЯ: у B в книге A нет.
	if back := getProfile(t, h, tokenB, idA); pflag(back.Users[0], "contact") {
		t.Fatalf("B не добавлял A, а флаг есть: %v", back.Users[0])
	}

	if rec := authedReq(t, h, http.MethodPost, "/contacts", tokenB, map[string]any{
		"contact_id": idA, "first_name": "Эй",
	}); rec.Code != http.StatusCreated {
		t.Fatalf("add back: %d %s", rec.Code, rec.Body.String())
	}
	if card = getProfile(t, h, tokenA, idB); !pflag(card.Users[0], "mutual_contact") {
		t.Fatalf("взаимный контакт без mutual_contact: %v", card.Users[0]["pFlags"])
	}

	// Личное фото: A ставит B своё фото.
	if rec := authedReq(t, h, http.MethodPut, "/contacts/"+itoa(idB)+"/photo", tokenA, map[string]any{
		"media_id": 4242,
	}); rec.Code != http.StatusOK {
		t.Fatalf("set personal photo: %d %s", rec.Code, rec.Body.String())
	}
	card = getProfile(t, h, tokenA, idB)
	pp, _ := card.FullUser["personal_photo"].(map[string]any)
	if pp["_"] != "photo" || pp["id"] != float64(4242) {
		t.Fatalf("userFull.personal_photo = %v", card.FullUser["personal_photo"])
	}
	photo, _ := card.Users[0]["photo"].(map[string]any)
	if photo["_"] != "userProfilePhoto" || photo["photo_id"] != float64(4242) || !pflag(photo, "personal") {
		t.Fatalf("user.photo = %v, want личное фото с pFlags.personal", card.Users[0]["photo"])
	}
	// Сам B своего «личного» фото не видит.
	if self := getProfile(t, h, tokenB, idB); self.FullUser["personal_photo"] != nil {
		t.Fatalf("личное фото утекло владельцу карточки: %v", self.FullUser)
	}

	// Сброс — ключ исчезает.
	if rec := authedReq(t, h, http.MethodDelete, "/contacts/"+itoa(idB)+"/photo", tokenA, nil); rec.Code != http.StatusOK {
		t.Fatalf("clear personal photo: %d %s", rec.Code, rec.Body.String())
	}
	if card = getProfile(t, h, tokenA, idB); card.FullUser["personal_photo"] != nil {
		t.Fatalf("после сброса personal_photo остался: %v", card.FullUser)
	}
}

// Имя из книги ВЕЗДЕ: у оригинала сервер отдаёт `user` с first_name/last_name
// из контакта смотрящего и pFlags.contact в каждом ответе, где этот user есть,
// а клиент кладёт карточку в кэш как есть. Один ответ с профильным именем
// затирает в кэше имя контакта — «то Боб, то Боб Петров».
func TestContactName_SeenByViewerEverywhere_HTTP(t *testing.T) {
	h := newContactCardRouter(t)
	tokenA, idA := signInToken(t, h, "+79990000311")
	tokenB, idB := signInToken(t, h, "+79990000312")
	if rec := authedReq(t, h, http.MethodPatch, "/me", tokenB, map[string]any{"first_name": "Боб", "last_name": "Петров"}); rec.Code != http.StatusOK {
		t.Fatalf("PATCH /me: %d %s", rec.Code, rec.Body.String())
	}
	if rec := authedReq(t, h, http.MethodPost, "/contacts", tokenA, map[string]any{"contact_id": idB, "first_name": "Бобби"}); rec.Code != http.StatusCreated {
		t.Fatalf("add contact: %d %s", rec.Code, rec.Body.String())
	}
	rec := authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB})
	if rec.Code != http.StatusOK {
		t.Fatalf("create chat: %d %s", rec.Code, rec.Body.String())
	}
	private := createdPeerFrom(t, rec)
	// Пир приватного чата — у каждой стороны свой: Боб пишет в ключ Алисы.
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+itoa(idA)+"/messages", tokenB, map[string]any{"text": "привет", "client_msg_id": "b1"}); rec.Code != http.StatusOK {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}
	rec = authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{"title": "Команда", "member_ids": []int64{idB}})
	if rec.Code != http.StatusOK {
		t.Fatalf("create group: %d %s", rec.Code, rec.Body.String())
	}
	group := createdPeerID(t, rec)

	// usersOf — карточка idB из ответа: вектор `users` контейнера либо голый вектор.
	usersOf := func(token, path string) map[string]any {
		t.Helper()
		rec := authedReq(t, h, http.MethodGet, path, token, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
		var list []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
			var box struct {
				Users []map[string]any `json:"users"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &box); err != nil {
				t.Fatalf("%s: разбор %v (%s)", path, err, rec.Body.String())
			}
			list = box.Users
		}
		for _, u := range list {
			if id, _ := u["id"].(float64); int64(id) == idB {
				return u
			}
		}
		t.Fatalf("%s: в users нет карточки %d: %s", path, idB, rec.Body.String())
		return nil
	}
	want := func(path string, u map[string]any, first, last string, contact bool) {
		t.Helper()
		gotLast, _ := u["last_name"].(string)
		if u["first_name"] != first || gotLast != last || pflag(u, "contact") != contact {
			t.Errorf("%s: имя %v %q contact=%v, want %q %q contact=%v", path, u["first_name"], gotLast, pflag(u, "contact"), first, last, contact)
		}
	}

	for _, path := range []string{
		"/chats",                               // список диалогов
		"/chats/" + itoa(private) + "/history", // история
		"/chats/" + itoa(group) + "/members",   // участники группы
		"/users?ids=" + itoa(idB),              // батч карточек
		"/users/" + itoa(idB),                  // профиль
		"/search?q=" + url.QueryEscape("Боб"),  // поиск пиров
		"/contacts",                            // сама книга
	} {
		want(path, usersOf(tokenA, path), "Бобби", "", true)
	}
	// Чёрный список — тоже карточка глазами зрителя.
	if rec := authedReq(t, h, http.MethodPost, "/me/blocked", tokenA, map[string]any{"user_id": idB}); rec.Code != http.StatusOK {
		t.Fatalf("block: %d %s", rec.Code, rec.Body.String())
	}
	want("/me/blocked", usersOf(tokenA, "/me/blocked"), "Бобби", "", true)

	// У Боба Алисы в книге нет: он видит её профильное имя и без contact,
	// а то, что Алиса записала, — только её.
	if u := getProfile(t, h, tokenB, idA).Users[0]; pflag(u, "contact") {
		t.Errorf("Боб видит Алису контактом: %v", u)
	}
	want("участники у самого Боба", usersOf(tokenB, "/chats/"+itoa(group)+"/members"), "Боб", "Петров", false)
}
