package chat

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakePreviewer отдаёт заранее заданное превью и запоминает запрошенные URL.
type fakePreviewer struct {
	mu   sync.Mutex
	urls []string
	wp   *domain.WebPagePreview
}

func (f *fakePreviewer) Preview(_ context.Context, url string) (*domain.WebPagePreview, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.urls = append(f.urls, url)
	return f.wp, nil
}

func (f *fakePreviewer) calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.urls...)
}

func TestFirstURL(t *testing.T) {
	cases := []struct {
		name, text, want string
		entities         domain.MessageEntities
	}{
		{name: "bare url", text: "смотри https://example.com/a?b=1, круто", want: "https://example.com/a?b=1"},
		{name: "no url", text: "просто текст", want: ""},
		{name: "text_link wins", text: "тут", want: "https://linked.example/x",
			entities: domain.MessageEntities{domain.NewMessageEntityTextURL(0, 3, "https://linked.example/x")}},
		{name: "non-http text_link ignored", text: "и голая http://plain.example/y",
			entities: domain.MessageEntities{domain.NewMessageEntityTextURL(0, 1, "javascript:alert(1)")},
			want:     "http://plain.example/y"},
	}
	for _, c := range cases {
		if got := firstURL(c.text, c.entities); got != c.want {
			t.Errorf("%s: firstURL = %q; want %q", c.name, got, c.want)
		}
	}
}

// Send с URL: превьюер вызван, web_page записан UPDATE'ом, кадр web_page_update
// разослан всем участникам (асинхронно после коммита — ждём с поллингом).
func TestSend_AttachesWebPreviewAsync(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	prev := &fakePreviewer{wp: &domain.WebPagePreview{
		URL: "https://example.com/post", SiteName: "Example", Title: "Заголовок", Description: "Описание", ImageURL: "https://example.com/og.png",
	}}
	in.SetLinkPreviewer(prev)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	msg, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: a, Text: "глянь https://example.com/post"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	// Превью догоняющее (go-рутина) — ждём кадры web_page_update у обоих.
	deadline := time.Now().Add(2 * time.Second)
	countWP := func(userID int64) int {
		pub.mu.Lock()
		defer pub.mu.Unlock()
		n := 0
		for _, f := range pub.frames {
			if f.userID == userID && strings.Contains(string(f.frame), `"web_page_update"`) {
				n++
			}
		}
		return n
	}
	for countWP(a) == 0 || countWP(b) == 0 {
		if time.Now().After(deadline) {
			t.Fatalf("web_page_update not published: a=%d b=%d", countWP(a), countWP(b))
		}
		time.Sleep(10 * time.Millisecond)
	}

	if calls := prev.calls(); len(calls) != 1 || calls[0] != "https://example.com/post" {
		t.Fatalf("previewer calls = %v", calls)
	}
	// UPDATE произошёл: сообщение в сторе несёт превью.
	stored, err := fakeMsgs{s}.GetByID(ctx, msg.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if stored.WebPage == nil || stored.WebPage.Title != "Заголовок" {
		t.Fatalf("web_page not stored: %+v", stored.WebPage)
	}
	// Кадр несёт peer_id/id/media. И peer_id у СТОРОН РАЗНЫЙ: для a это id b,
	// для b — id a. Внутренний chatID не появляется ни в одном из них, а
	// сообщение адресуется ОДНИМ числом — номером в чате.
	//
	// Карточка едет КОНСТРУКТОРОМ messageMediaWebPage — тем же, что и в самом
	// сообщении. Собственного ключа web_page с плоским снимком read-модели у
	// кадра больше нет: это была вторая форма превью на проводе.
	frameFor := func(userID int64) webPageFrame {
		pub.mu.Lock()
		var raw []byte
		for _, f := range pub.frames {
			if f.userID == userID && strings.Contains(string(f.frame), `"web_page_update"`) {
				raw = f.frame
				break
			}
		}
		pub.mu.Unlock()
		var env webPageFrame
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("frame json for %d: %v", userID, err)
		}
		return env
	}
	envA, envB := frameFor(a), frameFor(b)
	if envA.D.PeerID != domain.PeerID(b) {
		t.Fatalf("peer_id для a = %d; want %d (собеседник)", envA.D.PeerID, b)
	}
	if envB.D.PeerID != domain.PeerID(a) {
		t.Fatalf("peer_id для b = %d; want %d (собеседник)", envB.D.PeerID, a)
	}
	if envA.D.ID != msg.Seq {
		t.Fatalf("frame payload = %+v", envA.D)
	}
	if envA.D.Media.Underscore != domain.MessageMediaWebPageTag {
		t.Fatalf("вложение кадра = %+v; ждали messageMediaWebPage", envA.D.Media)
	}
	page := envA.D.Media.WebPage
	if page == nil || page.Underscore != domain.WebPageTag {
		t.Fatalf("карточка кадра = %+v", page)
	}
	if page.SiteName != "Example" || page.Title != "Заголовок" || page.Description != "Описание" {
		t.Fatalf("карточка кадра = %+v", page)
	}
	// display_url — тот же адрес без схемы; он есть только у конструктора, в
	// плоском снимке его не было вовсе.
	if page.DisplayURL != "example.com/post" {
		t.Fatalf("display_url = %q", page.DisplayURL)
	}
	raw := string(mustFrame(t, pub, a, "web_page_update"))
	// Ни второй формы карточки, ни второго числа адреса.
	for _, gone := range []string{`"web_page"`, `"photo_id"`, `"photo_w"`, `"photo_h"`, `"photo_blur"`, `"photo_has_thumb"`, `"msg_id"`, `"chat_id"`} {
		if strings.Contains(raw, gone) {
			t.Fatalf("в кадре осталось %s: %s", gone, raw)
		}
	}
	_ = chatID
}

// webPageFrame — кадр web_page_update глазами клиента: конверт плюс вложение
// конструктором схемы. Отдельный тип, потому что читают его два теста.
type webPageFrame struct {
	T string `json:"t"`
	D struct {
		PeerID domain.PeerID `json:"peer_id"`
		// Адрес сообщения в кадре ОДИН: id со значением номера в чате.
		ID    int64                      `json:"id"`
		Media domain.MessageMediaWebPage `json:"media"`
	} `json:"d"`
}

// mustFrame — сырой кадр типа t для получателя userID.
func mustFrame(t *testing.T, pub *fakePublisher, userID int64, typ string) []byte {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	for _, f := range pub.frames {
		if f.userID == userID && strings.Contains(string(f.frame), `"`+typ+`"`) {
			return f.frame
		}
	}
	t.Fatalf("кадр %s для %d не найден", typ, userID)
	return nil
}

// Сообщение без ссылки превьюер не дёргает.
func TestSend_NoURLNoPreview(t *testing.T) {
	in, _ := newInteractor()
	prev := &fakePreviewer{wp: &domain.WebPagePreview{Title: "x"}}
	in.SetLinkPreviewer(prev)
	ctx := context.Background()
	chatID, _ := in.CreatePrivateChat(ctx, 1, 2)
	if _, err := in.Send(ctx, SendInput{ChatID: chatID, SenderID: 1, Text: "без ссылок"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	if calls := prev.calls(); len(calls) != 0 {
		t.Fatalf("previewer called for text without url: %v", calls)
	}
}
