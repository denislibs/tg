package chat

import (
	"context"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// scheduledPreviewEnv — отложенные в личке 1↔2 с превьюером по ссылке.
func scheduledPreviewEnv(t *testing.T) (*Interactor, *store, *fakeScheduled, *urlPreviewer, int64) {
	t.Helper()
	in, s, fs := newScheduledTestInteractor()
	prev := &urlPreviewer{}
	in.SetLinkPreviewer(prev)
	cid, err := fakeChats{s}.CreatePrivate(context.Background(), 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	return in, s, fs, prev, cid
}

func scheduledRow(t *testing.T, fs *fakeScheduled, id int64) domain.ScheduledMessage {
	t.Helper()
	row, err := fs.ByID(context.Background(), id)
	if err != nil {
		t.Fatalf("ByID(%d): %v", id, err)
	}
	return row
}

// lastScheduledMedia — media последнего updateNewScheduledMessage автору 1.
func lastScheduledMedia(s *store) map[string]any {
	news := logOf(s, 1, scheduledNewFrame)
	if len(news) == 0 {
		return nil
	}
	msg, _ := news[len(news)-1]["message"].(map[string]any)
	media, _ := msg["media"].(map[string]any)
	return media
}

// П. 4.2.4: отложенное со ссылкой получает карточку до публикации — запись в
// строку и updateNewScheduledMessage автору (правка того же id, tweb
// appMessagesManager.ts:11773-11794); публикация переносит карточку в
// сообщение без второй сборки.
func TestScheduledPreview_BuiltBeforePublishAndCarried(t *testing.T) {
	in, s, fs, prev, cid := scheduledPreviewEnv(t)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "смотри https://a.example/x", ScheduleDate: future(),
		WebPage: domain.WebPageInput{InvertMedia: true}})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return scheduledRow(t, fs, sm.Seq).WebPage != nil })
	waitFor(t, func() bool { return len(logOf(s, 1, scheduledNewFrame)) == 2 })
	media := lastScheduledMedia(s)
	if media["_"] != domain.MessageMediaWebPageTag {
		t.Fatalf("кадр превью отложенного без карточки: %v", media)
	}
	news := logOf(s, 1, scheduledNewFrame)
	msg := news[1]["message"].(map[string]any)
	pf, _ := msg["pFlags"].(map[string]any)
	if int64(msg["id"].(float64)) != sm.Seq || pf["is_scheduled"] != true || pf["invert_media"] != true {
		t.Fatalf("кадр превью = %v", msg)
	}
	if _, err := in.SendScheduledNow(ctx, cid, 1, []int64{sm.Seq}); err != nil {
		t.Fatal(err)
	}
	published := messagesOf(s, cid)
	last := published[len(published)-1]
	if last.WebPage == nil || last.WebPage.URL != "https://a.example/x" || !last.InvertMedia || !last.FromScheduled {
		t.Fatalf("опубликованное = %+v", last)
	}
	time.Sleep(30 * time.Millisecond)
	if n := len(prev.calls()); n != 1 {
		t.Fatalf("Preview звали %d раз; ждали 1 (публикация переносит готовую карточку)", n)
	}
}

// no_webpage в снимке: превью не строится ни у отложенного, ни при публикации.
func TestScheduledPreview_NoWebpage(t *testing.T) {
	in, s, _, prev, cid := scheduledPreviewEnv(t)
	ctx := context.Background()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "https://a.example/x", ScheduleDate: future(),
		WebPage: domain.WebPageInput{NoWebpage: true}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.SendScheduledNow(ctx, cid, 1, []int64{sm.Seq}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(30 * time.Millisecond)
	if n := len(prev.calls()); n != 0 {
		t.Fatalf("no_webpage: Preview звали %d раз", n)
	}
	if last := messagesOf(s, cid); last[len(last)-1].WebPage != nil {
		t.Fatal("опубликованное с карточкой при no_webpage")
	}
}

// Гонка: текст отложенного правят, пока собирается карточка старой ссылки —
// поздняя карточка не пишется и кадра не шлёт; правка собирает свою.
func TestScheduledPreview_StaleBuildDropped(t *testing.T) {
	in, s, fs, prev, cid := scheduledPreviewEnv(t)
	ctx := context.Background()
	release := prev.hold("https://old.example/")
	date := future()
	sm, err := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "https://old.example/", ScheduleDate: date})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(prev.calls()) == 1 })
	if _, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: cid, ID: sm.Seq, UserID: 1,
		Text: "https://new.example/", ScheduleDate: date, WebPage: &domain.WebPageInput{}}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		wp := scheduledRow(t, fs, sm.Seq).WebPage
		return wp != nil && wp.URL == "https://new.example/"
	})
	framesBefore := len(logOf(s, 1, scheduledNewFrame))
	close(release)
	time.Sleep(50 * time.Millisecond)
	if wp := scheduledRow(t, fs, sm.Seq).WebPage; wp == nil || wp.URL != "https://new.example/" {
		t.Fatalf("поздняя карточка старой ссылки перезаписала новую: %+v", wp)
	}
	if n := len(logOf(s, 1, scheduledNewFrame)); n != framesBefore {
		t.Fatalf("кадров после поздней сборки %d → %d", framesBefore, n)
	}
}

// Правка отложенного: ссылку убрали — карточка снята в том же кадре правки;
// no_webpage — снята без пересборки; «Изменить время» (без полей превью и с
// прежним текстом, tweb contextMenu.ts:979-983) решение снимка не трогает.
func TestScheduledPreview_Edit(t *testing.T) {
	in, s, fs, prev, cid := scheduledPreviewEnv(t)
	ctx := context.Background()
	date := future()
	sm, _ := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "https://a.example/x", ScheduleDate: date,
		WebPage: domain.WebPageInput{InvertMedia: true}})
	waitFor(t, func() bool { return scheduledRow(t, fs, sm.Seq).WebPage != nil })

	// Перенос срока: снимок (invert_media) и карточка на месте.
	later := time.Now().Add(2 * time.Hour).Unix()
	if _, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: cid, ID: sm.Seq, UserID: 1,
		Text: "https://a.example/x", ScheduleDate: later, WebPage: &domain.WebPageInput{}}); err != nil {
		t.Fatal(err)
	}
	row := scheduledRow(t, fs, sm.Seq)
	if row.WebPage == nil || row.Params.WebPage == nil || !row.Params.WebPage.InvertMedia {
		t.Fatalf("перенос срока тронул превью: %+v / %+v", row.WebPage, row.Params.WebPage)
	}

	// Ссылку убрали — карточка снята, кадр правки без media.
	if _, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: cid, ID: sm.Seq, UserID: 1,
		Text: "без ссылки", ScheduleDate: later, WebPage: &domain.WebPageInput{}}); err != nil {
		t.Fatal(err)
	}
	if scheduledRow(t, fs, sm.Seq).WebPage != nil || lastScheduledMedia(s) != nil {
		t.Fatal("карточка пережила правку без ссылки")
	}

	// Ссылку вернули с no_webpage — карточки нет и сборки нет.
	calls := len(prev.calls())
	if _, err := in.EditScheduled(ctx, EditScheduledInput{ChatID: cid, ID: sm.Seq, UserID: 1,
		Text: "https://b.example/y", ScheduleDate: later, WebPage: &domain.WebPageInput{NoWebpage: true}}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(30 * time.Millisecond)
	if n := len(prev.calls()); n != calls || scheduledRow(t, fs, sm.Seq).WebPage != nil {
		t.Fatalf("no_webpage в правке отложенного: сборок %d → %d", calls, n)
	}
	// Решение no_webpage — в снимке: публикация карточку не строит.
	if _, err := in.SendScheduledNow(ctx, cid, 1, []int64{sm.Seq}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(30 * time.Millisecond)
	if n := len(prev.calls()); n != calls {
		t.Fatalf("публикация после no_webpage собрала карточку (%d → %d)", calls, n)
	}
}

// Публикуемая (в аренде) строка карточку не получает: кадр правки лёг бы после
// её снятия и вернул бы клиенту уже отправленное отложенное.
func TestScheduledPreview_ClaimedRowSkipped(t *testing.T) {
	in, s, fs, prev, cid := scheduledPreviewEnv(t)
	ctx := context.Background()
	release := prev.hold("https://a.example/x")
	date := future()
	sm, _ := in.Send(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "https://a.example/x", ScheduleDate: date})
	waitFor(t, func() bool { return len(prev.calls()) == 1 })
	row := scheduledRow(t, fs, sm.Seq)
	if _, ok, _ := fs.Claim(ctx, sm.Seq, row.SendAt, row.WhenOnline, time.Minute, false); !ok {
		t.Fatal("аренда не взята")
	}
	frames := len(logOf(s, 1, scheduledNewFrame))
	close(release)
	time.Sleep(50 * time.Millisecond)
	if scheduledRow(t, fs, sm.Seq).WebPage != nil || len(logOf(s, 1, scheduledNewFrame)) != frames {
		t.Fatal("карточка записана в публикуемую строку")
	}
}
