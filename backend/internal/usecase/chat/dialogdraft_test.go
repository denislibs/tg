package chat

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Черновик — ПОЛЕ диалога (flags.1?DraftMessage), а не отдельный список рядом.
//
// Пока он ехал своей ручкой и своим стором, «когда чат последний раз трогали»
// собиралось из двух источников — а от этой даты зависит порядок списка.
func TestDialogsPage_DraftRidesOnTheDialog(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	drafts := newFakeDrafts()
	in.SetDrafts(drafts)
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if _, err := in.SaveDraft(ctx, a, chatID, "недописанное", nil, nil); err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}

	page, err := in.DialogsPage(ctx, a, domain.DialogPage{Limit: 20})
	if err != nil {
		t.Fatalf("DialogsPage: %v", err)
	}
	if len(page.Dialogs) != 1 {
		t.Fatalf("dialogs = %d, want 1", len(page.Dialogs))
	}
	row, ok := page.Dialogs[0].(domain.DialogReal)
	if !ok {
		t.Fatalf("строка списка = %T", page.Dialogs[0])
	}
	draft, ok := row.Draft.(domain.DraftMessageReal)
	if !ok {
		t.Fatalf("draft = %T, ждали конструктор draftMessage", row.Draft)
	}
	if draft.Message != "недописанное" {
		t.Fatalf("текст черновика = %q", draft.Message)
	}
	// Текст лежит в `message` — том же имени, что у самого сообщения; своего
	// `text` у черновика на проводе нет.
	if draft.Date == 0 {
		t.Fatal("у черновика нет даты — по ней считается активность чата")
	}
}

// «Черновика нет» — ОТСУТСТВИЕ параметра, а не draftMessageEmpty: пустой
// конструктор значит «черновик СНЯЛИ», и это событие кадра, а не состояние
// строки списка.
func TestDialogsPage_NoDraftMeansNoParam(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	in.SetDrafts(newFakeDrafts())
	ctx := context.Background()
	const a, b int64 = 1, 2
	if _, err := in.CreatePrivateChat(ctx, a, b); err != nil {
		t.Fatalf("CreatePrivateChat: %v", err)
	}

	page, err := in.DialogsPage(ctx, a, domain.DialogPage{Limit: 20})
	if err != nil {
		t.Fatalf("DialogsPage: %v", err)
	}
	row := page.Dialogs[0].(domain.DialogReal)
	if row.Draft != nil {
		t.Fatalf("draft = %#v, ждали отсутствие параметра", row.Draft)
	}
}

// Черновик ЧУЖОГО пользователя в мой диалог не попадает: хранится он парой
// (чат, владелец), и витрина обязана спрашивать про зрителя.
func TestDialogsPage_DraftIsPerViewer(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	in.SetDrafts(newFakeDrafts())
	ctx := context.Background()
	const a, b int64 = 1, 2
	chatID, _ := in.CreatePrivateChat(ctx, a, b)

	if _, err := in.SaveDraft(ctx, b, chatID, "черновик собеседника", nil, nil); err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}

	page, err := in.DialogsPage(ctx, a, domain.DialogPage{Limit: 20})
	if err != nil {
		t.Fatalf("DialogsPage: %v", err)
	}
	if row := page.Dialogs[0].(domain.DialogReal); row.Draft != nil {
		t.Fatalf("в мою строку попал чужой черновик: %#v", row.Draft)
	}
}
