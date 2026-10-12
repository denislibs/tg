package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// НО-6: запись превью условна по edited_at — поздняя сборка от старой правки
// карточку новой не перезаписывает, а строку без правок пишет как раньше.
func TestMessagesRepo_SetWebPageIfEdited(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7960")
	b := seedUser(t, pool, "+7961")
	chatID := createPrivate(t, pool, a, b)
	seq, _ := msgs.NextSeq(ctx, chatID)
	msg, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "https://one.example"})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}

	// Не правилось: edited_at IS NULL совпадает с nil.
	ok, err := msgs.SetWebPageIfEdited(ctx, msg.ID, &domain.WebPagePreview{URL: "https://one.example", Title: "1"}, nil)
	if err != nil || !ok {
		t.Fatalf("первая запись: ok=%v err=%v", ok, err)
	}

	// Правка A, затем правка B: сборка с меткой A опоздала.
	editA, err := msgs.UpdateText(ctx, msg.ID, "https://two.example", nil)
	if err != nil {
		t.Fatalf("UpdateText A: %v", err)
	}
	editB, err := msgs.UpdateText(ctx, msg.ID, "https://three.example", nil)
	if err != nil {
		t.Fatalf("UpdateText B: %v", err)
	}
	if ok, err := msgs.SetWebPageIfEdited(ctx, msg.ID, &domain.WebPagePreview{URL: "https://three.example", Title: "3"}, editB.EditedAt); err != nil || !ok {
		t.Fatalf("сборка B: ok=%v err=%v", ok, err)
	}
	if ok, err := msgs.SetWebPageIfEdited(ctx, msg.ID, &domain.WebPagePreview{URL: "https://two.example", Title: "2"}, editA.EditedAt); err != nil || ok {
		t.Fatalf("поздняя сборка A записалась: ok=%v err=%v", ok, err)
	}
	if ok, _ := msgs.SetWebPageIfEdited(ctx, msg.ID, &domain.WebPagePreview{URL: "x"}, nil); ok {
		t.Fatal("сборка от отправки записалась поверх правки")
	}
	got, err := msgs.GetByID(ctx, msg.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.WebPage == nil || got.WebPage.Title != "3" {
		t.Fatalf("web_page = %+v; ждали карточку правки B", got.WebPage)
	}
}

// Б-72: invert_media и выбор размера карточки переживают запись и чтение.
func TestMessagesRepo_InvertMediaAndWebPageSize(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	msgs := NewMessagesRepo(pool)
	ctx := context.Background()
	a := seedUser(t, pool, "+7962")
	b := seedUser(t, pool, "+7963")
	chatID := createPrivate(t, pool, a, b)
	seq, _ := msgs.NextSeq(ctx, chatID)
	msg, err := msgs.Insert(ctx, domain.Message{ChatID: chatID, Seq: seq, SenderID: a, Type: "text", Text: "x", InvertMedia: true})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if !msg.InvertMedia {
		t.Fatal("Insert не вернул invert_media")
	}
	if err := msgs.SetWebPage(ctx, msg.ID, &domain.WebPagePreview{URL: "https://a.example", ForceSmallMedia: true}); err != nil {
		t.Fatalf("SetWebPage: %v", err)
	}
	if err := msgs.SetInvertMedia(ctx, msg.ID, false); err != nil {
		t.Fatalf("SetInvertMedia: %v", err)
	}
	got, err := msgs.GetByID(ctx, msg.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.InvertMedia || got.WebPage == nil || !got.WebPage.ForceSmallMedia {
		t.Fatalf("строка = invert %v, web_page %+v", got.InvertMedia, got.WebPage)
	}
}
