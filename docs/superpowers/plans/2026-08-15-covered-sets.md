# Covered sets: превью едут вместе со списком наборов — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Экран поиска стикеров показывает превью и силуэты сразу при открытии, не дожидаясь отдельного запроса на каждый набор — как covered sets в Telegram.

**Architecture:** Сейчас `featured`/`search` отдают только метаданные набора, а пять превью каждой строки приезжают отдельным `setBySlug` — сорок дополнительных round-trip'ов, и до их ответа строка пуста, поэтому силуэт из `path_thumb` показать не из чего. Telegram решает это covered sets: `messages.getFeaturedStickers` возвращает набор вместе с первыми документами (`tweb/src/layer.d.ts`, `StickerSetCovered`). Делаем так же: одним SQL-запросом добираем по пять стикеров на набор и кладём их в тот же ответ.

**Tech Stack:** Go 1.25 (pgx, chi), React 19 + TypeScript strict, vitest.

## Global Constraints

- **Референс — tweb.** Поведение и структура ответа берутся из covered sets Telegram (`StickerSetCovered` в `tweb/src/layer.d.ts`, использование — `tweb/src/components/sidebarRight/tabs/stickers.tsx`).
- **Ровно пять превью на набор** — `PREVIEW_COUNT` фронта и `min(5, count)` строки в tweb.
- **Не ломать существующее:** `setBySlug` остаётся — им пользуются модалка набора и панель композера; covered лишь снимает нужду звать его ради превью.
- **Мёртвый код удалять** агрессивно. Комментарии по-русски, объясняют «почему».
- **TypeScript strict, gofmt.** MUI и framer-motion не возвращать.
- **Тесты:** бэк `cd backend && go test ./internal/adapter/repo/postgres/ ./internal/adapter/delivery/http/ ./internal/usecase/stickers/`; фронт `cd web-client && npm test`.
- Тесты запускать обычным вызовом, ждать в том же вызове — **не** фоновой командой.

---

### Task 1: featured/search отдают первые превью набора

**Files:**
- Modify: `backend/internal/adapter/repo/postgres/stickersrepo.go` (метод `CoverStickers`)
- Modify: `backend/internal/usecase/stickers/ports.go`, `interactor.go` (`Featured`/`SearchSets` возвращают covered)
- Modify: `backend/internal/adapter/delivery/http/stickers_handler.go` (`Featured`, `SearchSets`)
- Test: `backend/internal/adapter/repo/postgres/stickersrepo_test.go`, `backend/internal/usecase/stickers/interactor_test.go`, `backend/internal/adapter/delivery/http/stickers_handler_test.go`

**Interfaces:**
- Consumes: `domain.StickerSet`, `domain.Sticker` (с `PathThumb` из плана `2026-08-15-stickers-search-lazy`)
- Produces: `StickersRepo.CoverStickers(ctx, setIDs []int64, perSet int) (map[int64][]domain.Sticker, error)`; ответ ручек — `{"sets": [...], "covers": {"<setID>": [Sticker×5]}}`

Ключ решения — один запрос на всю выдачу, а не N запросов по набору. В Postgres это оконная функция:

```sql
SELECT set_id, <stickerCols> FROM (
  SELECT st.*, row_number() OVER (PARTITION BY st.set_id ORDER BY st.position, st.id) AS rn
    FROM stickers st WHERE st.set_id = ANY($1)
) st <join media> WHERE rn <= $2
```

- [ ] **Step 1: Написать падающий тест репозитория**

В `backend/internal/adapter/repo/postgres/stickersrepo_test.go` (хелперы — фактические из пакета, `seedFullSet` уже есть):

```go
// CoverStickers — превью наборов для экрана поиска: первые perSet стикеров
// каждого набора одним запросом (аналог covered sets Telegram).
func TestCoverStickers(t *testing.T) {
	pool := storepostgres.NewTestDB(t)
	r := NewStickersRepo(pool)
	ctx := context.Background()
	owner := seedUser(t, pool, "+7900")

	big, _ := seedFullSet(t, pool, r, owner, "cover_big", 7)
	small, _ := seedFullSet(t, pool, r, owner, "cover_small", 2)
	empty, err := r.CreateSet(ctx, domain.StickerSet{Slug: "cover_empty", Title: "Empty", Kind: "sticker"})
	if err != nil {
		t.Fatal(err)
	}

	covers, err := r.CoverStickers(ctx, []int64{big.ID, small.ID, empty.ID}, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(covers[big.ID]) != 5 {
		t.Errorf("big: %d превью, ожидалось 5", len(covers[big.ID]))
	}
	if len(covers[small.ID]) != 2 {
		t.Errorf("small: %d превью, ожидалось 2", len(covers[small.ID]))
	}
	if _, ok := covers[empty.ID]; ok {
		t.Error("пустой набор не должен попадать в выдачу")
	}
	// Порядок — тот же, что у Stickers: по position.
	all, err := r.Stickers(ctx, big.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i, st := range covers[big.ID] {
		if st.ID != all[i].ID {
			t.Fatalf("превью %d: id %d, ожидался %d (порядок по position)", i, st.ID, all[i].ID)
		}
	}
	// Пустой список наборов — пустая карта, без похода в БД с ANY('{}').
	none, err := r.CoverStickers(ctx, nil, 5)
	if err != nil || len(none) != 0 {
		t.Fatalf("CoverStickers(nil): %v, %v", none, err)
	}
}
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestCoverStickers -v`
Expected: FAIL — `r.CoverStickers undefined`

- [ ] **Step 3: Реализовать запрос**

В `stickersrepo.go` рядом со `Stickers`, тем же стилем (`stickerCols`, `stickerMediaJoin`, `scanStickers`). Пустой `setIDs` — вернуть пустую карту, не ходя в БД. Порядок внутри набора — `position, id`, как у `Stickers`.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestCoverStickers -v`
Expected: PASS

- [ ] **Step 5: Провести covers через usecase**

`Featured` и `SearchSets` возвращают наборы **и** карту превью. Сигнатуры меняются, поэтому обнови порт в `ports.go` и фейк в `interactor_test.go`. Число превью на набор — константа рядом с прочими лимитами (`coverLim = 5`), с комментарием про `min(5, count)` в tweb.

- [ ] **Step 6: Отдать covers в ручках**

`Featured` и `SearchSets` кладут в ответ `"covers"` — карту `setID → []Sticker`, сериализованную существующей `stickersJSON` (она уже отдаёт `path_thumb`). Пустая карта должна приезжать как `{}`, а не `null` — тем же приёмом, что `sets` приезжают как `[]`. Тесты хендлеров: covers присутствуют и содержат ожидаемые стикеры; пустая выдача даёт `{"sets":[],"covers":{}}`.

- [ ] **Step 7: Прогнать тесты бэка**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ ./internal/usecase/stickers/ ./internal/adapter/delivery/http/`
Expected: PASS

- [ ] **Step 8: Коммит**

```bash
git add backend/internal
git commit -m "feat(stickers): featured/search отдают превью наборов (covered sets)"
```

---

### Task 2: строка рисует превью из covered, а не отдельным запросом

**Files:**
- Modify: `web-client/src/core/managers/stickersManager.ts` (`featuredSets`/`searchSets` возвращают covers)
- Modify: `web-client/src/core/hooks/useStickersSearch.ts` (проброс covers)
- Modify: `web-client/src/components/rightSidebar/StickersSearchTab.tsx` (строка использует covers)
- Test: `web-client/src/components/rightSidebar/StickersSearchTab.covers.test.tsx` (создать), правка существующих тестов таба

**Interfaces:**
- Consumes: `{"sets": [...], "covers": {...}}` из Task 1
- Produces: `featuredSets()`/`searchSets(q)` возвращают `{ sets: StickerSet[]; covers: Map<number, Sticker[]> }`; `useStickersSearch` отдаёт `covers` наружу

- [ ] **Step 1: Написать падающий тест**

Создать `StickersSearchTab.covers.test.tsx`: выдача из двух наборов с covers; проверить, что превью отрисованы **без единого вызова** `setBySlug` (мок менеджера должен его не досчитаться), и что при пустых covers для набора строка показывает пустые ячейки-заглушки, а не падает. Моки — по образцу существующего `StickersSearchTab.test.tsx`.

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/components/rightSidebar/StickersSearchTab.covers.test.tsx`
Expected: FAIL — строка по-прежнему зовёт `setBySlug`

- [ ] **Step 3: Пробросить covers через менеджер и хук**

Маппинг сырых `covers` (ключи — строки) в `Map<number, Sticker[]>` тем же маппером `mapSticker`, что и остальные стикеры.

- [ ] **Step 4: Строка берёт превью из covers**

`StickerSetRow` получает готовые превью пропом и больше не зовёт `loadSetStickers`. Вместе с этим уходит и `setStickersCache`, и постановка `setBySlug` в очередь — если после правки они больше нигде не используются, удалить их целиком (мёртвый код). Ленивая загрузка **самих файлов** через `LazyLoadQueue` и `useLazyVisibility` остаётся: covers дают лишь метаданные и контуры, а `.tgs`/`.webm` по-прежнему качаются по видимости.

- [ ] **Step 5: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/components/rightSidebar/StickersSearchTab.covers.test.tsx`
Expected: PASS

- [ ] **Step 6: Прогнать полный фронт**

Run: `cd web-client && npm test`
Expected: PASS. Существующие тесты таба, завязанные на `setBySlug`, обновить по смыслу, а не выхолащивать: то, что раньше проверяло ленивость запроса состава, теперь должно проверять ленивость загрузки файлов.

- [ ] **Step 7: Коммит**

```bash
git add web-client/src
git commit -m "feat(stickers): экран поиска рисует превью из covered sets без запроса на набор"
```

---

## Что НЕ входит в этот план

- **Панель композера** (`EmojiDropdown`/`StickersTab`) — она показывает установленные наборы целиком, covered ей не нужны.
- **Модалка набора** — ей нужен полный состав, она продолжает звать `setBySlug`.
- **Пагинация выдачи** — потолок `featuredLim = 2000` остаётся как есть.
