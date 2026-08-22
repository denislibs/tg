package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// List отдаёт реакции в порядке position: это порядок, в котором Telegram
// показывает их в пикере, и переставлять его клиенту нечем.
func TestReactionsUpsertAndList(t *testing.T) {
	ctx := context.Background()
	pool := storepostgres.NewTestDB(t)
	repo := NewAvailableReactionsRepo(pool)

	if err := repo.Upsert(ctx, domain.AvailableReaction{Emoji: "👍", Title: "Thumbs Up", Position: 2}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Upsert(ctx, domain.AvailableReaction{Emoji: "❤", Title: "Red Heart", Position: 1}); err != nil {
		t.Fatal(err)
	}
	// повторный upsert той же реакции обновляет, а не дублирует
	if err := repo.Upsert(ctx, domain.AvailableReaction{Emoji: "❤", Title: "Red Heart", Position: 1, StaticMediaID: 0}); err != nil {
		t.Fatal(err)
	}

	list, err := repo.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("реакций %d, ожидалось 2", len(list))
	}
	if list[0].Emoji != "❤" || list[1].Emoji != "👍" {
		t.Errorf("порядок %q,%q — ожидался ❤,👍", list[0].Emoji, list[1].Emoji)
	}
}

// Telegram отдаёт не все роли для каждой реакции (например, у части эмодзи нет
// Effect/Around) — незаполненная роль должна читаться как 0, а не падать сканом
// NULL в int64. Повторный upsert без ролей обязан их стереть (NULLIF($n,0) на
// 0 — это NULL), а не оставить старые id висеть на удалённых файлах.
func TestReactionsPartialRolesAndClearOnUpsert(t *testing.T) {
	ctx := context.Background()
	pool := storepostgres.NewTestDB(t)
	repo := NewAvailableReactionsRepo(pool)
	owner := seedUser(t, pool, "+79000000000")

	staticID := seedMedia(t, pool, owner, "reactions/fire/static")
	selectID := seedMedia(t, pool, owner, "reactions/fire/select")

	err := repo.Upsert(ctx, domain.AvailableReaction{
		Emoji: "🔥", Title: "Fire", Position: 3, Premium: true,
		StaticMediaID: staticID, SelectMediaID: selectID,
	})
	if err != nil {
		t.Fatal(err)
	}

	list, err := repo.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("реакций %d, ожидалось 1", len(list))
	}
	got := list[0]
	if got.StaticMediaID != staticID || got.SelectMediaID != selectID {
		t.Fatalf("заполненные роли не совпали: %+v", got)
	}
	if got.AppearMediaID != 0 || got.ActivateMediaID != 0 || got.EffectMediaID != 0 ||
		got.AroundMediaID != 0 || got.CenterMediaID != 0 {
		t.Fatalf("незаполненные роли должны читаться как 0: %+v", got)
	}
	if !got.Premium {
		t.Error("Premium не сохранился")
	}

	// Повторный upsert той же реакции без ролей стирает ранее выставленные.
	if err := repo.Upsert(ctx, domain.AvailableReaction{Emoji: "🔥", Title: "Fire", Position: 3}); err != nil {
		t.Fatal(err)
	}
	list, err = repo.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if list[0].StaticMediaID != 0 || list[0].SelectMediaID != 0 {
		t.Fatalf("роли после сброса: %+v, ожидались нули", list[0])
	}
}

// Каталог реакций ПУБЛИЧЕН: гейт доступа к медиа спрашивает у него, «наш ли
// это файл», и по ответу пускает любого. Проверка ходит по ВСЕМ ролям — новая
// роль, забытая в запросе, сделает свой файл молча недоступным.
//
// Найдено на стенде: пока каталог был пуст, путь не проверялся; залили — и
// каждая иконка реакции стала отдавать 404 всем, кроме сервисного аккаунта.
func TestReactionsIsReactionMediaCoversEveryRole(t *testing.T) {
	ctx := context.Background()
	pool := storepostgres.NewTestDB(t)
	repo := NewAvailableReactionsRepo(pool)
	owner := seedUser(t, pool, "+79990001101")

	// По файлу на каждую роль — иначе тест прошёл бы и при запросе по одной.
	roles := map[string]int64{}
	for _, role := range []string{"static", "appear", "select", "activate", "effect", "around", "center"} {
		roles[role] = seedStickerMedia(t, pool, owner, "reaction/"+role)
	}
	if err := repo.Upsert(ctx, domain.AvailableReaction{
		Emoji: "👍", Title: "Thumbs Up", Position: 1,
		StaticMediaID: roles["static"], AppearMediaID: roles["appear"], SelectMediaID: roles["select"],
		ActivateMediaID: roles["activate"], EffectMediaID: roles["effect"], AroundMediaID: roles["around"],
		CenterMediaID: roles["center"],
	}); err != nil {
		t.Fatal(err)
	}

	for role, mediaID := range roles {
		ok, err := repo.IsReactionMedia(ctx, mediaID)
		if err != nil {
			t.Fatalf("IsReactionMedia(%s): %v", role, err)
		}
		if !ok {
			t.Errorf("роль %s не опознана каталогом — её файл отдаётся 404", role)
		}
	}

	// Посторонний файл каталогу не принадлежит: проверка отвечает про
	// конкретный media, а не «раз каталог непуст — можно всё».
	stranger := seedStickerMedia(t, pool, owner, "reaction/stranger")
	if ok, _ := repo.IsReactionMedia(ctx, stranger); ok {
		t.Error("каталог признал своим посторонний файл")
	}
}
