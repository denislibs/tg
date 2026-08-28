package chat

import (
	"context"
	"testing"
)

// fakeReactionCatalog — каталог доступных реакций: отвечает, чей файл.
type fakeReactionCatalog struct{ ids map[int64]bool }

func (f fakeReactionCatalog) IsReactionMedia(_ context.Context, mediaID int64) (bool, error) {
	return f.ids[mediaID], nil
}

// Каталог доступных реакций ПУБЛИЧЕН — ровно как наборы стикеров: иконку
// реакции рисует каждый, кто открыл чат, независимо от того, чей это файл.
//
// Файлы каталога принадлежат сервисному аккаунту (их заливает cmd/seed-reactions),
// поэтому проверка «владелец либо участник чата» их не пропускает, а
// исключение было заведено ровно одно — для стикеров. Итог: каждая иконка
// реакции отдавалась 404, то есть пикер реакций и реакции на баблах были
// пустыми у всех.
//
// Дефект не проявлялся, потому что каталог на стенде был пуст: залили —
// увидели 404 на первый же запрос иконки.
func TestCanAccessMedia_ReactionCatalogIsPublic(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const owner, stranger int64 = 1, 2
	const reactionMedia int64 = 500

	// Файл каталога: владелец — сервисный аккаунт, ни в одном чате не лежит.
	s.seedMedia(reactionMedia, owner)
	in.SetReactionCatalog(fakeReactionCatalog{ids: map[int64]bool{reactionMedia: true}})

	ok, err := in.CanAccessMedia(ctx, stranger, reactionMedia)
	if err != nil {
		t.Fatalf("CanAccessMedia: %v", err)
	}
	if !ok {
		t.Fatal("иконка реакции недоступна постороннему — пикер реакций пуст у всех, кроме сервисного аккаунта")
	}
}

// Обратная сторона: каталог не должен открывать ЧУЖИЕ файлы. Проверка отвечает
// про конкретный media, а не «раз каталог подключён — можно всё».
func TestCanAccessMedia_UnknownMediaStaysPrivate(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const owner, stranger int64 = 1, 2
	const privateMedia int64 = 501

	s.seedMedia(privateMedia, owner)
	in.SetReactionCatalog(fakeReactionCatalog{ids: map[int64]bool{999: true}})

	if ok, _ := in.CanAccessMedia(ctx, stranger, privateMedia); ok {
		t.Fatal("подключённый каталог открыл постороннему чужой файл")
	}
}
