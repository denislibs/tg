# Анимированные реакции 1:1 с tweb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить семь захардкоженных текстовых эмодзи на 74 настоящие реакции Telegram с анимацией выбора и эффектом вокруг чипа.

**Architecture:** Реакции выгружены в `backend/assets/reactions/<кодпоинты>/` — семь файлов на реакцию по ролям (`static.webp` + шесть `.tgs`) плюс индекс `reactions.json`. В `sticker_sets` они не ложатся: у реакции не пара «эмодзи → файл», а набор ролей, поэтому заводится своя таблица `available_reactions` со ссылками на `media`. Фронт получает список одним запросом и рендерит чип из `center_icon` (fallback `static_icon`), а при выборе проигрывает `select_animation` и `around_animation` через существующий tlottie-воркер.

**Tech Stack:** Go 1.25 (chi, pgx, goose, minio-go), React 19 + TypeScript strict, SCSS-модули, vitest, tlottie.

## Global Constraints

- **Референс — tweb**, поведение брать из `~/Documents/tweb/src/components/chat/reaction.ts`, не выдумывать.
- **Порядок ролей при выборе иконки** — как в tweb `reaction.ts:299-302` и `:817`: `center_icon ?? static_icon` для статичного показа; `select_animation` — проигрывание в чипе; `around_animation` — эффект вокруг.
- **MUI и framer-motion не возвращать.**
- **`.tgs` не распаковывать на бэкенде**, mime `application/x-tgsticker` (см. Task 1 плана `2026-08-15-stickers-tweb-full.md`).
- **Тесты:** фронт `cd web-client && npm test`, бэк `cd backend && go test ./...`.
- **Зависимость:** этот план требует выполненных Task 1 и Task 4 плана стикеров (`.tgs` на бэке и на фронте).

---

### Task 1: таблица и домен реакций

**Files:**
- Create: `backend/internal/store/postgres/migrations/0094_available_reactions.sql`
- Create: `backend/internal/domain/available_reaction.go`
- Create: `backend/internal/adapter/repo/postgres/reactionsrepo.go`
- Test: `backend/internal/adapter/repo/postgres/reactionsrepo_test.go`

**Interfaces:**
- Consumes: таблица `media`
- Produces: `domain.AvailableReaction`; `ReactionsRepo.List(ctx) ([]domain.AvailableReaction, error)`, `ReactionsRepo.Upsert(ctx, r domain.AvailableReaction) error`

- [ ] **Step 1: Написать миграцию**

Создать `backend/internal/store/postgres/migrations/0094_available_reactions.sql`:

```sql
-- +goose Up
-- Доступные реакции (Telegram messages.getAvailableReactions). У реакции не один
-- файл, а роли: статичная иконка чипа, анимация появления, выбора, активации,
-- эффект вокруг и «чистый» центральный кадр — поэтому это отдельная таблица, а
-- не набор стикеров. Каждая роль — обычная запись media.
CREATE TABLE available_reactions (
  emoji             TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  position          INT  NOT NULL DEFAULT 0,
  premium           BOOLEAN NOT NULL DEFAULT false,
  inactive          BOOLEAN NOT NULL DEFAULT false,
  static_media_id   BIGINT REFERENCES media(id),
  appear_media_id   BIGINT REFERENCES media(id),
  select_media_id   BIGINT REFERENCES media(id),
  activate_media_id BIGINT REFERENCES media(id),
  effect_media_id   BIGINT REFERENCES media(id),
  around_media_id   BIGINT REFERENCES media(id),
  center_media_id   BIGINT REFERENCES media(id)
);

-- +goose Down
DROP TABLE available_reactions;
```

- [ ] **Step 2: Написать падающий тест репозитория**

Создать `backend/internal/adapter/repo/postgres/reactionsrepo_test.go`:

```go
package postgres

import (
	"context"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// List отдаёт реакции в порядке position: это порядок, в котором Telegram
// показывает их в пикере, и переставлять его клиенту нечем.
func TestReactionsUpsertAndList(t *testing.T) {
	ctx := context.Background()
	pool := newTestPool(t)
	repo := NewReactionsRepo(pool)

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
```

- [ ] **Step 3: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestReactionsUpsertAndList -v`
Expected: FAIL — `undefined: NewReactionsRepo`

- [ ] **Step 4: Реализовать домен**

Создать `backend/internal/domain/available_reaction.go`:

```go
package domain

// AvailableReaction — доступная реакция (Telegram messages.getAvailableReactions).
// Роли-файлы лежат в media; клиент рисует чип из Center (или Static, если центра
// нет — tweb reaction.ts:817) и проигрывает Select с Around при выборе.
// ID роли 0 — файла для неё нет.
type AvailableReaction struct {
	Emoji    string `json:"emoji"`
	Title    string `json:"title"`
	Position int    `json:"position"`
	Premium  bool   `json:"premium"`
	Inactive bool   `json:"inactive"`

	StaticMediaID   int64 `json:"static_media_id,omitempty"`
	AppearMediaID   int64 `json:"appear_media_id,omitempty"`
	SelectMediaID   int64 `json:"select_media_id,omitempty"`
	ActivateMediaID int64 `json:"activate_media_id,omitempty"`
	EffectMediaID   int64 `json:"effect_media_id,omitempty"`
	AroundMediaID   int64 `json:"around_media_id,omitempty"`
	CenterMediaID   int64 `json:"center_media_id,omitempty"`
}
```

- [ ] **Step 5: Реализовать репозиторий**

Создать `backend/internal/adapter/repo/postgres/reactionsrepo.go` с `NewReactionsRepo(pool)`, `List` (`ORDER BY position, emoji`, `COALESCE(...,0)` по всем ролям) и `Upsert` (`INSERT ... ON CONFLICT (emoji) DO UPDATE`, `NULLIF($n, 0)` для ролей). Стиль и хелперы (`querier`) — как в соседнем `stickersrepo.go`.

- [ ] **Step 6: Прогнать тест — должен пройти**

Run: `cd backend && go test ./internal/adapter/repo/postgres/ -run TestReactionsUpsertAndList -v`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add backend/internal/store/postgres/migrations/0094_available_reactions.sql \
        backend/internal/domain/available_reaction.go \
        backend/internal/adapter/repo/postgres/reactionsrepo.go \
        backend/internal/adapter/repo/postgres/reactionsrepo_test.go
git commit -m "feat(reactions): таблица и репозиторий доступных реакций"
```

---

### Task 2: сид реакций

**Files:**
- Create: `backend/cmd/seed-reactions/main.go`
- Test: `backend/cmd/seed-reactions/main_test.go`

**Interfaces:**
- Consumes: `ReactionsRepo.Upsert`, `usecasemedia.Interactor.Upload`, `stickerMime`-логику (скопировать роль-специфичную версию: `.tgs` → `application/x-tgsticker`, `.webp` → `image/webp`)
- Produces: заполненная `available_reactions`

- [ ] **Step 1: Написать падающий тест разбора индекса**

Создать `backend/cmd/seed-reactions/main_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"testing"
)

// reactions.json — индекс выгрузки (tools/fetch_stickers.py --reactions):
// какой файл какой роли соответствует.
func TestLoadIndex(t *testing.T) {
	dir := t.TempDir()
	body := `[{"reaction":"❤","title":"Red Heart","slug":"2764","premium":false,"inactive":false,
	           "files":{"static":"static.webp","select":"select.tgs","around":"around.tgs"}}]`
	if err := os.WriteFile(filepath.Join(dir, "reactions.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	list, err := loadIndex(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("реакций %d, ожидалась 1", len(list))
	}
	if list[0].Reaction != "❤" || list[0].Files["select"] != "select.tgs" {
		t.Errorf("разобрано неверно: %+v", list[0])
	}
}
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./cmd/seed-reactions/ -run TestLoadIndex -v`
Expected: FAIL — пакета нет

- [ ] **Step 3: Реализовать сид**

Создать `backend/cmd/seed-reactions/main.go` по образцу `cmd/seed-stickers/main.go`: те же env и подключения (`config.Load`, `postgres.Migrate`, `postgres.Connect`, `minioadapter.Connect`), флаг `-dir` со значением `assets/reactions`. Разбирает `reactions.json`, на каждую реакцию заливает существующие файлы ролей в `media` и делает `Upsert` с полученными id и `Position` по порядку в индексе. Идемпотентность — по `emoji`: реакция уже с непустым `static_media_id` пропускается целиком.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd backend && go test ./cmd/seed-reactions/ -run TestLoadIndex -v`
Expected: PASS

- [ ] **Step 5: Прогнать сид на стенде**

```bash
cd backend && go run ./cmd/seed-reactions
```

Expected: `+ ❤ Red Heart: 7 файлов` и так далее, 74 строки; 516 файлов в MinIO.

- [ ] **Step 6: Коммит**

```bash
git add backend/cmd/seed-reactions/
git commit -m "feat(reactions): сид доступных реакций из assets/reactions"
```

---

### Task 3: API списка реакций

**Files:**
- Create: `backend/internal/adapter/delivery/http/reactions_handler.go`
- Modify: `backend/internal/adapter/delivery/http/router.go:254-274` (рядом с блоком стикеров)
- Modify: `backend/internal/app/server.go` (регистрация в fx)
- Test: `backend/internal/adapter/delivery/http/reactions_handler_test.go`

**Interfaces:**
- Consumes: `ReactionsRepo.List`
- Produces: `GET /api/reactions` → `{"reactions": [AvailableReaction...]}`

- [ ] **Step 1: Написать падающий тест хендлера**

Создать `backend/internal/adapter/delivery/http/reactions_handler_test.go`:

```go
package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

type fakeReactions struct{ list []domain.AvailableReaction }

func (f *fakeReactions) List(context.Context) ([]domain.AvailableReaction, error) {
	return f.list, nil
}

func TestReactionsList(t *testing.T) {
	h := NewReactionsHandler(&fakeReactions{list: []domain.AvailableReaction{
		{Emoji: "❤", Title: "Red Heart", Position: 1, CenterMediaID: 7},
		{Emoji: "👍", Title: "Thumbs Up", Position: 2},
	}})

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/reactions", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("код %d, ожидался 200", rec.Code)
	}
	var body struct {
		Reactions []domain.AvailableReaction `json:"reactions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Reactions) != 2 || body.Reactions[0].Emoji != "❤" {
		t.Fatalf("выдача %+v", body.Reactions)
	}
	if body.Reactions[0].CenterMediaID != 7 {
		t.Errorf("center_media_id = %d, ожидался 7", body.Reactions[0].CenterMediaID)
	}
}

// Пустой список должен приезжать как [], иначе клиент получает null и падает
// на .map — тот же контракт, что у StickersHandler.Featured.
func TestReactionsListEmpty(t *testing.T) {
	h := NewReactionsHandler(&fakeReactions{})
	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/reactions", nil))

	if got := rec.Body.String(); got != `{"reactions":[]}`+"\n" {
		t.Errorf("тело %q", got)
	}
}
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd backend && go test ./internal/adapter/delivery/http/ -run TestReactions -v`
Expected: FAIL — `undefined: ReactionsHandler`

- [ ] **Step 3: Реализовать хендлер и маршрут**

`ReactionsHandler.List` отдаёт `writeJSON(w, http.StatusOK, map[string]any{"reactions": list})`, пустой список — `[]`, не `null` (как сделано в `StickersHandler.Featured`). Маршрут в защищённой группе рядом со стикерами:

```go
		if reactionsH != nil {
			pr.Get("/reactions", reactionsH.List)
		}
```

- [ ] **Step 4: Прогнать тесты — должны пройти**

Run: `cd backend && go test ./internal/adapter/delivery/http/`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add backend/internal/adapter/delivery/http/ backend/internal/app/server.go
git commit -m "feat(reactions): GET /reactions"
```

---

### Task 4: менеджер реакций на фронте

Сейчас список реакций — константа `REACTIONS` в `web-client/src/core/reactions.ts:5` (семь эмодзи). Заменяем на данные с бэка, сохранив синхронный доступ для тех мест, что рисуют чип до загрузки.

**Files:**
- Create: `web-client/src/core/managers/reactionsManager.ts`
- Modify: `web-client/src/core/reactions.ts`
- Test: `web-client/src/core/managers/reactionsManager.test.ts`

**Interfaces:**
- Consumes: `GET /api/reactions`
- Produces: `newReactionsManager({rest})` с `list(): Promise<AvailableReaction[]>`; тип `AvailableReaction { emoji, title, premium, inactive, staticMediaId?, selectMediaId?, aroundMediaId?, centerMediaId?, ... }`

- [ ] **Step 1: Написать падающий тест**

Создать `web-client/src/core/managers/reactionsManager.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { newReactionsManager } from './reactionsManager'

describe('reactionsManager', () => {
  it('маппит snake_case бэка в camelCase фронта', async () => {
    const rest = {
      get: vi.fn().mockResolvedValue({
        reactions: [{ emoji: '❤', title: 'Red Heart', position: 1, premium: false,
                      inactive: false, center_media_id: 7, around_media_id: 8 }],
      }),
    }
    const m = newReactionsManager({ rest: rest as never })
    const list = await m.list()
    expect(list[0]).toMatchObject({ emoji: '❤', centerMediaId: 7, aroundMediaId: 8 })
  })

  it('пустой ответ отдаёт пустым массивом, а не падает', async () => {
    const rest = { get: vi.fn().mockResolvedValue({}) }
    const m = newReactionsManager({ rest: rest as never })
    expect(await m.list()).toEqual([])
  })
})
```

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/core/managers/reactionsManager.test.ts`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализовать менеджер**

Создать `web-client/src/core/managers/reactionsManager.ts` по образцу `stickersManager.ts` (тот же стиль: `newXManager({rest})`, маппер сырого ответа, экспорт типа). Зарегистрировать менеджер там же, где регистрируется `stickers` (см. `core/managers/*` и `web-client/CLAUDE.md` — менеджеры живут в воркере, витрина ходит через RPC).

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/core/managers/reactionsManager.test.ts`
Expected: PASS

- [ ] **Step 5: Переключить core/reactions.ts на данные**

`REACTIONS` и `QUICK_REACTION` остаются как фолбэк для первого кадра (до ответа сети), но помечаются в комментарии как фолбэк, а не как источник истины. Потребители (`useMessageActions`, пикер реакций) получают список из менеджера.

- [ ] **Step 6: Прогнать тесты**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add web-client/src/core/managers/reactionsManager.ts \
        web-client/src/core/managers/reactionsManager.test.ts web-client/src/core/reactions.ts
git commit -m "feat(reactions): менеджер списка реакций"
```

---

### Task 5: анимированный чип реакции

**Files:**
- Create: `web-client/src/components/messages/ReactionIcon.tsx`
- Modify: `web-client/src/components/messages/MessageReactions.tsx` (замена `<Emoji>` на `<ReactionIcon>`)
- Test: `web-client/src/components/messages/ReactionIcon.test.tsx`

**Interfaces:**
- Consumes: `AvailableReaction` из Task 4, `StickerMedia` (умеет `.tgs` после Task 4 плана стикеров)
- Produces: `<ReactionIcon emoji={string} play={boolean} />`

- [ ] **Step 1: Написать падающий тест**

Создать `web-client/src/components/messages/ReactionIcon.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ReactionIcon from './ReactionIcon'

let reactions = [
  { emoji: '❤', title: 'Red Heart', position: 1, premium: false, inactive: false,
    staticMediaId: 3, centerMediaId: 7, selectMediaId: 9, aroundMediaId: 8 },
]

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="media" data-media={mediaId} />,
}))
vi.mock('../../core/hooks/useReactions', () => ({ useReactions: () => reactions }))

describe('ReactionIcon', () => {
  it('рисует центральный кадр реакции', () => {
    render(<ReactionIcon emoji="❤" play={false} />)
    expect(screen.getByTestId('media')).toHaveAttribute('data-media', '7')
  })

  it('без центрального кадра падает на статичную иконку (tweb reaction.ts:817)', () => {
    reactions = [{ ...reactions[0], centerMediaId: undefined }]
    render(<ReactionIcon emoji="❤" play={false} />)
    expect(screen.getByTestId('media')).toHaveAttribute('data-media', '3')
  })

  it('при play проигрывает анимацию выбора', () => {
    reactions = [{ ...reactions[0], centerMediaId: 7, selectMediaId: 9 }]
    render(<ReactionIcon emoji="❤" play />)
    expect(screen.getByTestId('media')).toHaveAttribute('data-media', '9')
  })

  it('незнакомую реакцию рисует текстовым эмодзи', () => {
    render(<ReactionIcon emoji="🫥" play={false} />)
    expect(screen.queryByTestId('media')).toBeNull()
    expect(screen.getByText('🫥')).toBeInTheDocument()
  })
})
```

Хук `useReactions` — тонкая обёртка над менеджером из Task 4, отдающая список синхронно (пустой до загрузки); создать его в этом же шаге, `web-client/src/core/hooks/useReactions.ts`.

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/components/messages/ReactionIcon.test.tsx`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализовать компонент**

`ReactionIcon` берёт реакцию из менеджера по эмодзи и рендерит `StickerMedia` с `centerMediaId ?? staticMediaId`; при `play` — `selectMediaId` (одноразовое проигрывание, без loop). Реакции нет в списке (сервер её не знает) — рендерить текстовый эмодзи, как сейчас.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/components/messages/ReactionIcon.test.tsx`
Expected: PASS

- [ ] **Step 5: Подставить в чипы**

В `MessageReactions.tsx` заменить `<Emoji>` на `<ReactionIcon>`, сохранив размеры и раскладку чипа (пилюля 30px, счётчик, `is-chosen`).

- [ ] **Step 6: Прогнать тесты**

Run: `cd web-client && npm test`
Expected: PASS (в том числе существующие `reactionChip.test.tsx`, `quickReaction.test.tsx` — если они завязаны на текстовый эмодзи, обновить их вместе с компонентом)

- [ ] **Step 7: Коммит**

```bash
git add web-client/src/components/messages/ReactionIcon.tsx \
        web-client/src/components/messages/ReactionIcon.test.tsx \
        web-client/src/components/messages/MessageReactions.tsx
git commit -m "feat(reactions): анимированный чип реакции"
```

---

### Task 6: эффект вокруг при выборе реакции

**Files:**
- Create: `web-client/src/components/messages/ReactionAroundEffect.tsx`
- Modify: `web-client/src/core/hooks/useMessageActions.tsx` (запуск эффекта на своей реакции)
- Test: `web-client/src/components/messages/ReactionAroundEffect.test.tsx`

**Interfaces:**
- Consumes: `AvailableReaction.aroundMediaId`
- Produces: `<ReactionAroundEffect emoji={string} onDone={() => void} />`

- [ ] **Step 1: Написать падающий тест**

Создать `web-client/src/components/messages/ReactionAroundEffect.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReactionAroundEffect from './ReactionAroundEffect'

let reactions = [
  { emoji: '❤', title: 'Red Heart', position: 1, premium: false, inactive: false,
    staticMediaId: 3, centerMediaId: 7, selectMediaId: 9, aroundMediaId: 8 },
]

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId, onComplete }: { mediaId: number; onComplete?: () => void }) => (
    <div data-testid="media" data-media={mediaId} onClick={onComplete} />
  ),
}))
vi.mock('../../core/hooks/useReactions', () => ({ useReactions: () => reactions }))

describe('ReactionAroundEffect', () => {
  beforeEach(() => {
    reactions = [{ ...reactions[0], aroundMediaId: 8 }]
  })

  it('проигрывает эффект вокруг', () => {
    render(<ReactionAroundEffect emoji="❤" onDone={() => {}} />)
    expect(screen.getByTestId('media')).toHaveAttribute('data-media', '8')
  })

  it('зовёт onDone по завершении анимации', () => {
    const onDone = vi.fn()
    render(<ReactionAroundEffect emoji="❤" onDone={onDone} />)
    screen.getByTestId('media').click()
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('без эффекта ничего не рисует и сразу завершается', () => {
    reactions = [{ ...reactions[0], aroundMediaId: undefined }]
    const onDone = vi.fn()
    render(<ReactionAroundEffect emoji="❤" onDone={onDone} />)
    expect(screen.queryByTestId('media')).toBeNull()
    expect(onDone).toHaveBeenCalledOnce()
  })
})
```

Имя коллбэка завершения (`onComplete`) сверить с фактическим API `StickerMedia`; если его нет — добавить его в `StickerMedia` в этом же шаге, эффект без сигнала о завершении не снять.

- [ ] **Step 2: Прогнать тест — убедиться, что падает**

Run: `cd web-client && npx vitest run src/components/messages/ReactionAroundEffect.test.tsx`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализовать эффект**

Оверлей поверх чипа, размер — как в tweb (`reaction.ts:1183`: эффект вокруг крупнее самой иконки), `pointer-events: none`, снимается по завершении. Никакого framer-motion: проигрывание — tlottie, одноразовое.

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd web-client && npx vitest run src/components/messages/ReactionAroundEffect.test.tsx`
Expected: PASS

- [ ] **Step 5: Запускать эффект при постановке своей реакции**

В `useMessageActions.tsx` при успешной постановке реакции пользователем — показать эффект один раз. На чужих реакциях, приезжающих по WebSocket, эффект не играть (иначе экран мигает на активном чате).

- [ ] **Step 6: Прогнать тесты**

Run: `cd web-client && npm test`
Expected: PASS

- [ ] **Step 7: Проверить на стенде**

```bash
cd web-client && npx vite build --outDir ../client-build
```

Открыть :38080, поставить реакцию на сообщение. Ожидается: чип рисуется анимированной иконкой, при постановке играет анимация выбора и эффект вокруг.

- [ ] **Step 8: Коммит**

```bash
git add web-client/src/components/messages/ReactionAroundEffect.tsx \
        web-client/src/components/messages/ReactionAroundEffect.test.tsx \
        web-client/src/core/hooks/useMessageActions.tsx
git commit -m "feat(reactions): эффект вокруг при выборе реакции"
```

---

## Что НЕ входит в этот план

- **Кастом-эмодзи как реакции** (`reactionCustomEmoji`, премиум-механика Telegram) — файлы приезжают в 99 emoji-наборах, но выбор кастом-эмодзи реакцией требует отдельного UI и правки схемы реакций сообщения.
- **Платные ⭐-реакции** — уже есть своя ветка (`domain.Message.StarReactionTotal`, таблица `star_reactions`), этот план её не трогает.
