package chat

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// urlPreviewer — превьюер, у которого карточка зависит от ссылки (заголовок =
// адрес), а ответ по выбранной ссылке можно придержать: так воспроизводится
// гонка «поздняя сборка от старой правки».
type urlPreviewer struct {
	mu    sync.Mutex
	urls  []string
	holds map[string]chan struct{}
}

func (p *urlPreviewer) Preview(ctx context.Context, url string) (*domain.WebPagePreview, error) {
	p.mu.Lock()
	p.urls = append(p.urls, url)
	hold := p.holds[url]
	p.mu.Unlock()
	if hold != nil {
		select {
		case <-hold:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return &domain.WebPagePreview{URL: url, Title: url}, nil
}

func (p *urlPreviewer) calls() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.urls...)
}

// hold — придержать ответ по url до close(возвращённого канала).
func (p *urlPreviewer) hold(url string) chan struct{} {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.holds == nil {
		p.holds = map[string]chan struct{}{}
	}
	ch := make(chan struct{})
	p.holds[url] = ch
	return ch
}

func storedMsg(t *testing.T, s *store, id int64) domain.Message {
	t.Helper()
	m, err := fakeMsgs{s}.GetByID(context.Background(), id)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	return m
}

func countFrames(pub *fakePublisher, userID int64, typ string) int {
	pub.mu.Lock()
	defer pub.mu.Unlock()
	n := 0
	for _, f := range pub.frames {
		var env struct {
			T string `json:"t"`
		}
		if f.userID == userID && json.Unmarshal(f.frame, &env) == nil && env.T == typ {
			n++
		}
	}
	return n
}

// lastEditFrame — тело последнего кадра edit_message получателя.
func lastEditFrame(t *testing.T, pub *fakePublisher, userID int64) map[string]any {
	t.Helper()
	pub.mu.Lock()
	defer pub.mu.Unlock()
	var d map[string]any
	for _, f := range pub.frames {
		var env struct {
			T string         `json:"t"`
			D map[string]any `json:"d"`
		}
		if f.userID == userID && json.Unmarshal(f.frame, &env) == nil && env.T == "edit_message" {
			d = env.D
		}
	}
	if d == nil {
		t.Fatalf("кадра edit_message для %d нет", userID)
	}
	return d
}

type previewEnv struct {
	in     *Interactor
	s      *store
	pub    *fakePublisher
	prev   *urlPreviewer
	chatID int64
}

func newPreviewEnv(t *testing.T) previewEnv {
	t.Helper()
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	prev := &urlPreviewer{}
	in.SetLinkPreviewer(prev)
	chatID, err := in.CreatePrivateChat(context.Background(), 1, 2)
	if err != nil {
		t.Fatalf("CreatePrivateChat: %v", err)
	}
	return previewEnv{in: in, s: s, pub: pub, prev: prev, chatID: chatID}
}

// A2-21: правка «без ссылки → со ссылкой» строит карточку и шлёт её
// обоим участникам догоняющим кадром.
func TestEditMessage_AddedLinkBuildsPreview(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	msg, err := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "без ссылки"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if _, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "теперь https://a.example/x", nil); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	waitFor(t, func() bool { return countFrames(e.pub, 2, "web_page_update") == 1 })
	if wp := storedMsg(t, e.s, msg.ID).WebPage; wp == nil || wp.URL != "https://a.example/x" {
		t.Fatalf("web_page = %+v", wp)
	}
	if countFrames(e.pub, 1, "web_page_update") != 1 {
		t.Fatal("автор не получил карточку")
	}
}

// A3-36: правка «со ссылкой → без» снимает карточку в той же транзакции:
// кадр правки едет без media, в строке web_page пуст.
func TestEditMessage_RemovedLinkDropsPreview(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "смотри https://a.example/x"})
	waitFor(t, func() bool { return storedMsg(t, e.s, msg.ID).WebPage != nil })

	got, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "уже без ссылки", nil)
	if err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if got.WebPage != nil || storedMsg(t, e.s, msg.ID).WebPage != nil {
		t.Fatal("карточка осталась после правки без ссылки")
	}
	m, _ := lastEditFrame(t, e.pub, 2)["message"].(map[string]any)
	if _, has := m["media"]; has {
		t.Fatalf("кадр правки несёт media: %v", m["media"])
	}
	time.Sleep(30 * time.Millisecond)
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("Preview звали %d раз; ждали 1 (только отправка)", n)
	}
}

// Та же ссылка, другой текст — карточка не трогается, сайт второй раз не
// запрашивается, кадр правки несёт прежнюю карточку.
func TestEditMessage_SameLinkKeepsPreview(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "смотри https://a.example/x"})
	waitFor(t, func() bool { return storedMsg(t, e.s, msg.ID).WebPage != nil })

	if _, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "ещё раз https://a.example/x !", nil); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	time.Sleep(30 * time.Millisecond)
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("Preview звали %d раз; ждали 1", n)
	}
	if storedMsg(t, e.s, msg.ID).WebPage == nil {
		t.Fatal("карточка снята при той же ссылке")
	}
	m, _ := lastEditFrame(t, e.pub, 2)["message"].(map[string]any)
	if media, _ := m["media"].(map[string]any); media["_"] != domain.MessageMediaWebPageTag {
		t.Fatalf("кадр правки без карточки: %v", m["media"])
	}
}

// Ссылку сменили — старая карточка снимается сразу, новая доезжает
// догоняющим кадром.
func TestEditMessage_ChangedLinkRebuilds(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x"})
	waitFor(t, func() bool { return storedMsg(t, e.s, msg.ID).WebPage != nil })

	got, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "https://b.example/y", nil)
	if err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if got.WebPage != nil {
		t.Fatal("кадр правки несёт карточку СТАРОЙ ссылки")
	}
	waitFor(t, func() bool {
		wp := storedMsg(t, e.s, msg.ID).WebPage
		return wp != nil && wp.URL == "https://b.example/y"
	})
}

// НО-6: поздняя сборка от старой правки не перезаписывает карточку новой
// и кадра не шлёт.
func TestEditMessage_LateBuildDoesNotOverwrite(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "без ссылки"})

	release := e.prev.hold("https://one.example/")
	if _, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "https://one.example/", nil); err != nil {
		t.Fatalf("правка A: %v", err)
	}
	waitFor(t, func() bool { return len(e.prev.calls()) == 1 })
	time.Sleep(2 * time.Millisecond) // edited_at правки B строго позже A
	if _, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "https://two.example/", nil); err != nil {
		t.Fatalf("правка B: %v", err)
	}
	waitFor(t, func() bool {
		wp := storedMsg(t, e.s, msg.ID).WebPage
		return wp != nil && wp.URL == "https://two.example/"
	})
	close(release) // сборка A приходит последней
	time.Sleep(50 * time.Millisecond)
	if wp := storedMsg(t, e.s, msg.ID).WebPage; wp == nil || wp.URL != "https://two.example/" {
		t.Fatalf("поздняя сборка перезаписала карточку: %+v", wp)
	}
	if n := countFrames(e.pub, 2, "web_page_update"); n != 1 {
		t.Fatalf("кадров карточки = %d; ждали 1 (только от правки B)", n)
	}
}

// Сборка от отправки, которую обогнала правка без ссылки, карточку не
// возвращает.
func TestSend_LateBuildAfterEditDropped(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	release := e.prev.hold("https://a.example/x")
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x"})
	waitFor(t, func() bool { return len(e.prev.calls()) == 1 })
	if _, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "передумал", nil); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	close(release)
	time.Sleep(50 * time.Millisecond)
	if storedMsg(t, e.s, msg.ID).WebPage != nil {
		t.Fatal("сборка отправки вернула карточку после правки без ссылки")
	}
	if n := countFrames(e.pub, 2, "web_page_update"); n != 0 {
		t.Fatalf("кадров карточки = %d; ждали 0", n)
	}
}

// Б-72: no_webpage — превью не строится при отправке и снимается при правке.
func TestWebPageInput_NoWebpage(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://a.example/x",
		WebPage: domain.WebPageInput{NoWebpage: true}})
	time.Sleep(30 * time.Millisecond)
	if n := len(e.prev.calls()); n != 0 {
		t.Fatalf("no_webpage: Preview звали %d раз", n)
	}

	other, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "https://b.example/y"})
	waitFor(t, func() bool { return storedMsg(t, e.s, other.ID).WebPage != nil })
	if _, err := e.in.EditMessage(ctx, e.chatID, other.ID, 1, "https://b.example/y", nil, domain.WebPageInput{NoWebpage: true}); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if storedMsg(t, e.s, other.ID).WebPage != nil {
		t.Fatal("no_webpage в правке не снял карточку")
	}
	_ = msg
}

// Б-72: inputMediaWebPage выбирает ссылку и размер карточки; размер едет в
// messageMediaWebPage.pFlags.
func TestWebPageInput_MediaChoosesURLAndSize(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	media := &domain.InputMediaWebPage{Underscore: domain.InputMediaWebPageTag, URL: "https://chosen.example/",
		PFlags: map[string]bool{"force_small_media": true, "optional": true}}
	msg, _ := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1,
		Text: "https://first.example/ и https://chosen.example/", WebPage: domain.WebPageInput{Media: media}})
	waitFor(t, func() bool { return storedMsg(t, e.s, msg.ID).WebPage != nil })
	wp := storedMsg(t, e.s, msg.ID).WebPage
	if wp.URL != "https://chosen.example/" || !wp.ForceSmallMedia || wp.ForceLargeMedia {
		t.Fatalf("карточка = %+v", wp)
	}
	if pf := wp.ToMedia().PFlags; !pf["force_small_media"] || pf["force_large_media"] {
		t.Fatalf("pFlags карточки = %v", pf)
	}

	// Правка той же ссылки с другим размером — флаги меняются на месте, без
	// повторного похода на сайт.
	media.PFlags = map[string]bool{"force_large_media": true}
	if _, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "https://chosen.example/", nil, domain.WebPageInput{Media: media}); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	wp = storedMsg(t, e.s, msg.ID).WebPage
	if wp == nil || !wp.ForceLargeMedia || wp.ForceSmallMedia {
		t.Fatalf("размер после правки = %+v", wp)
	}
	time.Sleep(30 * time.Millisecond)
	if n := len(e.prev.calls()); n != 1 {
		t.Fatalf("Preview звали %d раз; ждали 1", n)
	}
}

// Б-72: invert_media — флаг сообщения: ставится отправкой, правка задаёт его
// состояние, внутренняя правка без аргумента его не трогает.
func TestWebPageInput_InvertMedia(t *testing.T) {
	e := newPreviewEnv(t)
	ctx := context.Background()
	msg, err := e.in.Send(ctx, SendInput{ChatID: e.chatID, SenderID: 1, Text: "привет",
		WebPage: domain.WebPageInput{InvertMedia: true}})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !msg.InvertMedia || !storedMsg(t, e.s, msg.ID).InvertMedia {
		t.Fatal("invert_media не записан при отправке")
	}
	if _, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "правка", nil); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if !storedMsg(t, e.s, msg.ID).InvertMedia {
		t.Fatal("правка без аргумента сняла invert_media")
	}
	got, err := e.in.EditMessage(ctx, e.chatID, msg.ID, 1, "правка 2", nil, domain.WebPageInput{})
	if err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if got.InvertMedia || storedMsg(t, e.s, msg.ID).InvertMedia {
		t.Fatal("правка с invert_media=false флаг не сняла")
	}
}

// НО-5: у зеркала свежего поста появляется карточка: зеркало создаётся в
// транзакции Send раньше, чем готово превью, и догоняется вместе с постом.
func TestChannelPost_PreviewReachesMirror(t *testing.T) {
	e := newChannelEnv(t)
	e.i.SetLinkPreviewer(&urlPreviewer{})
	ctx := context.Background()
	disc, err := e.i.EnableDiscussion(ctx, e.ch, 7)
	if err != nil {
		t.Fatalf("EnableDiscussion: %v", err)
	}
	post, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "смотри https://a.example/x"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	mirrorID, err := e.i.msgs.MirrorOfExactPost(ctx, e.ch, post.ID)
	if err != nil || mirrorID == 0 {
		t.Fatalf("зеркала нет: %v", err)
	}
	waitFor(t, func() bool { return storedMsg(t, e.s, mirrorID).WebPage != nil })
	mirror := storedMsg(t, e.s, mirrorID)
	if mirror.ChatID != disc || mirror.WebPage.URL != "https://a.example/x" {
		t.Fatalf("зеркало = %+v", mirror)
	}
	// Участник группы обсуждения (владелец 7) получил зеркало с карточкой.
	waitFor(t, func() bool { return len(mirrorEditFrames(t, e, disc, mirror.Seq)) > 0 })
}

// mirrorEditFrames — кадры edit_message владельцу 7 о сообщении seq В ГРУППЕ
// disc (номер поста в канале и номер зеркала могут совпасть, поэтому пир
// сверяется тоже), с карточкой превью.
func mirrorEditFrames(t *testing.T, e channelEnv, disc, seq int64) []map[string]any {
	t.Helper()
	raw, _ := json.Marshal(domain.NewPeer(domain.ToPeerID(disc, true)))
	var want map[string]any
	_ = json.Unmarshal(raw, &want)
	var out []map[string]any
	for _, d := range e.userFrames(7, "edit_message") {
		m, _ := d["message"].(map[string]any)
		media, _ := m["media"].(map[string]any)
		id, _ := m["id"].(float64)
		if int64(id) == seq && reflect.DeepEqual(m["peer_id"], want) && media["_"] == domain.MessageMediaWebPageTag {
			out = append(out, m)
		}
	}
	return out
}

// Пост без обсуждения: зеркала нет — кроме правки поста (журнал канала и
// копия автору) ничего не уходит.
func TestChannelPost_PreviewNoDiscussion(t *testing.T) {
	e := newChannelEnv(t)
	e.i.SetLinkPreviewer(&urlPreviewer{})
	ctx := context.Background()
	post, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "https://a.example/x"})
	waitFor(t, func() bool { return len(e.channelLog()) == 2 })
	if storedMsg(t, e.s, post.ID).WebPage == nil {
		t.Fatal("пост без карточки")
	}
	if n := len(e.userFrames(7, "edit_message")); n != 1 {
		t.Fatalf("кадров правки автору = %d; ждали 1 (своя копия правки поста)", n)
	}
	for _, typ := range e.userLog(7) {
		if typ == "edit_message" || typ == "web_page_update" {
			t.Fatalf("личный журнал автора = %v: превью поста легло мимо журнала канала", e.userLog(7))
		}
	}
}

// Правка поста канала со сменой ссылки: новая карточка едет правкой журнала
// канала (writeChannelWebPreview), а не личными журналами подписчиков.
func TestChannelPost_EditRebuildsViaChannelJournal(t *testing.T) {
	e := newChannelEnv(t)
	e.i.SetLinkPreviewer(&urlPreviewer{})
	ctx := context.Background()
	post, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "пост без ссылки"})
	if _, err := e.i.EditMessage(ctx, e.ch, post.ID, 7, "https://a.example/x", nil); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	waitFor(t, func() bool { return len(e.channelLog()) == 3 })
	log := e.channelLog()
	d := bodyTag(t, log[2].Payload)
	m, _ := d["message"].(map[string]any)
	media, _ := m["media"].(map[string]any)
	if log[2].Type != "edit_message" || media["_"] != domain.MessageMediaWebPageTag {
		t.Fatalf("журнал канала = %v / %v", log[2].Type, m["media"])
	}
}

// messages.getWebPage: карточка без картинки (картинка качается к нам только
// вместе с сообщением), чужая схема — карточки нет.
func TestGetWebPage(t *testing.T) {
	in, _ := newInteractor()
	in.SetLinkPreviewer(&fakePreviewer{wp: &domain.WebPagePreview{
		URL: "https://a.example/x", Title: "T", ImageURL: "https://a.example/og.png",
	}})
	ctx := context.Background()
	wp := in.GetWebPage(ctx, " https://a.example/x ")
	if wp == nil || wp.Title != "T" || wp.ImageURL != "" || wp.PhotoID != 0 {
		t.Fatalf("карточка = %+v", wp)
	}
	if in.GetWebPage(ctx, "javascript:alert(1)") != nil {
		t.Fatal("карточка для не-http ссылки")
	}
	raw, _ := json.Marshal(domain.NewMessagesWebPage("https://a.example/x", nil))
	if !strings.Contains(string(raw), `"_":"webPageEmpty"`) || !strings.Contains(string(raw), `"_":"messages.webPage"`) {
		t.Fatalf("пустой ответ = %s", raw)
	}
}
