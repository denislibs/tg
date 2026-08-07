# Видимый паритет чата — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести 5 узлов чата (подложки-темизация, BigEmoji, реакц-чип+аватары, обои, голосовой waveform) к tweb 1:1.

**Architecture:** Порт из исходников tweb (`/Users/denisurevic/Documents/tweb`) 1:1. Фронт: React 19/TS/SCSS-модули/Zustand, логика в воркере (RPC). Бэк: Go, чистая архитектура (domain→usecase→adapter), pgx, goose-миграции. Узел 0 (тема-переменные) — фундамент для 1,2. Узлы 3,4 независимы. Уход от зависимости `@twallpaper/react` (свой canvas-рендер как в tweb).

**Tech Stack:** React 19, TypeScript strict, SCSS-модули, Zustand 5, vitest/happy-dom; Go 1.25, pgx/v5, goose.

## Global Constraints

- **Всё 1:1 из tweb.** Каждое значение (размеры, формулы, цвета, пороги) — из указанного tweb file:line, не выдумывать. Расхождение с tweb = дефект.
- **UTF-16 offset/length** для MessageEntity (кросс-каттинг проекта).
- **Мёртвый код удалять** (демо-компоненты MessageBubble/Reaction — после проверки отсутствия импортов).
- **Миграции:** новый файл со следующим номером, существующие не править (`backend/CLAUDE.md`).
- **Реальный путь рендера** — `web-client/src/components/messages/*` (не демо `MessageBubble.tsx`/`Reaction.tsx`).
- Хелперы цвета уже в `web-client/src/shared/lib/color.ts` (Волна 1): `rgbaToHsla`, `hslaStringToRgba`, `getAverageColor`, `mixColors`. Формулы не менять.
- Проверять `npm test` (vitest) + `go test ./...` + сборку до «готово».
- Комментарии/сообщения — по-русски (стиль репо).

---

## Файловая структура (что создаётся/меняется)

**Создаётся:**
- `web-client/src/components/messages/StackedAvatars.tsx` (+ `.module.scss`) — стек аватаров реагировавших.
- `web-client/src/core/chat/patternRenderer.ts` — canvas-рендер паттерна обоев (порт tweb).
- `web-client/src/core/audio/voiceWaveformAnalyser.ts` — расчёт+упаковка пиков при записи (порт tweb).
- `backend/internal/store/postgres/migrations/00NN_media_waveform.sql` — колонка waveform.
- Юнит-тесты рядом с модулями.

**Меняется (фронт):** `shared/lib/color.ts`, `config/themePresets.ts`, `core/theme/themeController.ts`, `styles/_tokens.scss`, `components/RichText.tsx`, `components/messages/MessageContent.tsx`, `components/messages/MessageRow.tsx`, `components/messages/MessageRow.module.scss`, `core/models.ts`, `components/ChatBackground.tsx`, `wallpapers.ts`, `package.json`, `core/hooks/useVoiceRecorder.ts`, `core/hooks/useChatSend.ts`, `core/managers/mediaManager.ts`, `components/messages/VoiceMessage.tsx`, `core/audio/waveform.ts`.

**Меняется (бэк):** `internal/domain/media.go`, `internal/adapter/repo/postgres/mediarepo.go`, `internal/adapter/delivery/http/media_handler.go`, `internal/adapter/repo/postgres/reactionsrepo.go`, `internal/domain/*` (ReactionCount), места сериализации сообщений.

**Удаляется:** `components/MessageBubble.tsx` (+scss), `components/Reaction.tsx` (+scss).

---

## Узел 0 — Темизация подложек

### Task 1: highlightingColor() + DEFAULT_HIGHLIGHTING_COLORS

**Files:**
- Modify: `web-client/src/shared/lib/color.ts`
- Modify: `web-client/src/config/themePresets.ts`
- Test: `web-client/src/shared/lib/color.highlighting.test.ts` (create)

**Interfaces:**
- Produces: `highlightingColor(rgba: [number,number,number,number?]): string` (в color.ts); `DEFAULT_HIGHLIGHTING_COLORS: Record<ThemePresetName, string>` (в themePresets.ts).
- Consumes: `rgbaToHsla` из color.ts.

Порт 1:1 из `tweb/src/helpers/highlightingColor.ts`.

- [ ] **Step 1: Тест формулы**

```ts
// color.highlighting.test.ts
import { describe, it, expect } from 'vitest'
import { highlightingColor } from './color'

describe('highlightingColor (порт tweb PresentationData iOS)', () => {
  it('поднимает насыщенность и затемняет L·0.65, alpha .4', () => {
    // s>0: s = min(100, s + 5 + 0.1*(100-s)); l = l*0.65
    // вход rgb(77,142,80) ≈ зелёный: h≈122.3, s≈29.7, l≈43.0
    expect(highlightingColor([77, 142, 80])).toMatch(/^hsla\(/)
  })
  it('серый (s=0) не трогает насыщенность', () => {
    const out = highlightingColor([128, 128, 128])
    expect(out).toContain('0%') // s остаётся 0
  })
  it('всегда alpha .4', () => {
    expect(highlightingColor([10, 20, 30])).toMatch(/, \.4\)$/)
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `cd web-client && npx vitest run src/shared/lib/color.highlighting.test.ts`
Expected: FAIL (highlightingColor не экспортирован).

- [ ] **Step 3: Порт функции** (1:1 из `tweb/src/helpers/highlightingColor.ts`)

```ts
// в color.ts — добавить экспорт
export function highlightingColor(rgba: [number, number, number, number?]): string {
  let { h, s, l } = rgbaToHsla(rgba[0], rgba[1], rgba[2])
  if (s > 0) {
    s = Math.min(100, s + 5 + 0.1 * (100 - s))
  }
  l = Math.max(0, l * 0.65)
  return `hsla(${h}, ${s}%, ${l}%, .4)`
}
```

- [ ] **Step 4: DEFAULT_HIGHLIGHTING_COLORS** в `config/themePresets.ts` (значения 1:1 из `tweb/src/config/state.ts:391-398`; classic отсутствует — не портируем; light = day-значение, т.к. в tweb light = base day):

```ts
export const DEFAULT_HIGHLIGHTING_COLORS: Record<ThemePresetName, string> = {
  day:    'hsla(210, 67.741935%, 50.588235%, .4)',
  light:  'hsla(210, 67.741935%, 50.588235%, .4)',
  night:  'hsla(299.142857, 44.166666%, 37.470588%, .4)',
  tinted: 'hsla(258.461538, 50%, 65.490196%, .4)',
}
```

- [ ] **Step 5: Тест зелёный**

Run: `cd web-client && npx vitest run src/shared/lib/color.highlighting.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web-client/src/shared/lib/color.ts web-client/src/shared/lib/color.highlighting.test.ts web-client/src/config/themePresets.ts
git commit -m "feat(theme): порт highlightingColor() + DEFAULT_HIGHLIGHTING_COLORS (1:1 tweb)"
```

### Task 2: applyHighlightingColor + message-time-background + чистка bespoke

**Files:**
- Modify: `web-client/src/core/theme/themeController.ts`
- Modify: `web-client/src/styles/_tokens.scss`
- Modify: `web-client/src/components/messages/MessageRow.module.scss` (убрать хардкод `.stickerMeta`)
- Test: `web-client/src/core/theme/themeController.highlighting.test.ts` (create)

**Interfaces:**
- Consumes: `highlightingColor`, `hslaStringToRgba` (color.ts); `DEFAULT_HIGHLIGHTING_COLORS` (themePresets.ts); существующие `setTheme`, `applyChatTheme` (themeController.ts:227,328).
- Produces: `applyHighlightingColor(preset: ThemePresetName, element?: HTMLElement): void`; `applyHighlightingColorFromRgb(rgb, element?)` (для обоев, узел 3).

Порт `applyHighlightingColor` 1:1 из `tweb/src/helpers/themeController.ts:293-316`.

- [ ] **Step 1: Тест — пишет три переменные**

```ts
// themeController.highlighting.test.ts
import { describe, it, expect } from 'vitest'
import { applyHighlightingColor } from './themeController'

describe('applyHighlightingColor', () => {
  it('пишет --message-highlighting-color + -rgb + -alpha', () => {
    const el = document.createElement('div')
    applyHighlightingColor('night', el)
    expect(el.style.getPropertyValue('--message-highlighting-color')).toContain('hsla')
    expect(el.style.getPropertyValue('--message-highlighting-color-rgb').split(',').length).toBe(3)
    const a = parseFloat(el.style.getPropertyValue('--message-highlighting-alpha'))
    expect(a).toBeCloseTo(0.4, 1)
  })
})
```

- [ ] **Step 2: Запустить — падает** (`npx vitest run src/core/theme/themeController.highlighting.test.ts`)

- [ ] **Step 3: Реализация** (порт tweb; hsla → rgba через уже готовый `hslaStringToRgba`):

```ts
export function applyHighlightingColor(preset: ThemePresetName, element: HTMLElement = document.documentElement): void {
  applyHighlightingColorHsla(DEFAULT_HIGHLIGHTING_COLORS[preset], element)
}
function applyHighlightingColorHsla(hsla: string, element: HTMLElement): void {
  const rgba = hslaStringToRgba(hsla) // [r,g,b,a] a in 0..255
  element.style.setProperty('--message-highlighting-color', hsla)
  element.style.setProperty('--message-highlighting-color-rgb', rgba.slice(0, 3).join(','))
  element.style.setProperty('--message-highlighting-alpha', '' + rgba[3] / 255)
}
// для узла 3 (средний цвет обоев):
export function applyHighlightingColorFromRgb(rgb: [number, number, number], element: HTMLElement = document.documentElement): void {
  applyHighlightingColorHsla(highlightingColor(rgb), element)
}
```

- [ ] **Step 4: Вызвать из setTheme и applyChatTheme.** В `setTheme` (после инъекции CSS) — `applyHighlightingColor(preset)` на documentElement. В `applyChatTheme(element, preset, ...)` — `applyHighlightingColor(preset, element)` (per-chat скоуп, как tweb chat.ts:564). В `clearChatTheme` — снять три переменные.

- [ ] **Step 5: Токены.** В `_tokens.scss`:
  - убрать bespoke `--message-highlighting-color` (обе группы day/light и night/tinted);
  - добавить в `:root`: `--message-time-background: rgba(0, 0, 0, .35);` (1:1 tweb base.scss:82) и `--message-highlighting-hover-color: rgba(var(--message-highlighting-color-rgb), calc(var(--message-highlighting-alpha) + .24));` (base.scss:320).

- [ ] **Step 6: Контекст «без пузыря».** В `MessageRow.module.scss`: заменить хардкод фона тайм-пилюли `.stickerMeta { background: rgba(0,0,0,.45) }` на `background: var(--message-time-background)`; в скоупе стикера/emoji-big/медиа-без-подписи задать `--message-time-background: var(--message-highlighting-color)` (1:1 tweb `_chatBubble.scss:760` `.just-media`).

- [ ] **Step 7: Тест + сборка зелёные**

Run: `cd web-client && npx vitest run src/core/theme && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web-client/src/core/theme web-client/src/styles/_tokens.scss web-client/src/components/messages/MessageRow.module.scss
git commit -m "feat(theme): applyHighlightingColor + --message-time-background (1:1 tweb), убрать bespoke"
```

---

## Узел 1 — BigEmoji

### Task 3: детект — порог 7 + custom-emoji + «только эмодзи»

**Files:**
- Modify: `web-client/src/components/RichText.tsx` (`emojiOnlyCount`)
- Test: `web-client/src/components/richtext.bigemoji.test.ts` (create)

**Interfaces:**
- Produces: `emojiOnlyCount(text: string): number` (0..7).
- Consumers: `MessageContent.tsx:209`, `MessageRow.tsx:162`, `StickersHelper.tsx`, `emojiEffects.ts` (порог меняется — сверить, что ≤7 не ломает их; они используют `>0` как «биг»).

Механика 1:1: tweb `messageEntityEmoji` парсится локально (`tweb/src/lib/richTextProcessor/parseEntities.ts:81`), сервер не шлёт — наш regex это тот же локальный разбор. Порог `Math.min(7, count)` (tweb `bubbles.ts:319,7374`).

- [ ] **Step 1: Тесты**

```ts
// richtext.bigemoji.test.ts
import { describe, it, expect } from 'vitest'
import { emojiOnlyCount } from './RichText'

describe('emojiOnlyCount — порог 7 (1:1 tweb)', () => {
  it('1 эмодзи → 1', () => expect(emojiOnlyCount('😀')).toBe(1))
  it('7 эмодзи → 7', () => expect(emojiOnlyCount('😀😃😄😁😆😅😂')).toBe(7))
  it('8 эмодзи → 0 (сверх лимита)', () => expect(emojiOnlyCount('😀😃😄😁😆😅😂🤣')).toBe(0))
  it('ZWJ-семья считается одним', () => expect(emojiOnlyCount('👨‍👩‍👧')).toBe(1))
  it('эмодзи + текст → 0', () => expect(emojiOnlyCount('😀 hi')).toBe(0))
  it('пустая строка → 0', () => expect(emojiOnlyCount('')).toBe(0))
})
```

- [ ] **Step 2: Запустить — падает на «7 эмодзи» и «8 → 0»** (текущий порог ≤3).

Run: `cd web-client && npx vitest run src/components/richtext.bigemoji.test.ts`

- [ ] **Step 3: Правка** — заменить последнюю строку `emojiOnlyCount`:

```ts
  return matches.length <= 7 ? matches.length : 0 // tweb BIG_EMOJI: min(7, count)
```

Обновить JSDoc «1–3 emoji» → «1–7 emoji».

- [ ] **Step 4: Custom-emoji.** Проверить, несёт ли `ConvMsg`/`m.text` маркеры custom-emoji (см. `RichText.tsx` `CustomEmoji`, парсинг documentId). Если несёт — считать их атомами наравне с обычными (сообщение из одних custom-emoji → big). Если наша модель сообщений custom-emoji в тексте не переносит — обычные эмодзи уже 1:1, отметить это в отчёте (не выдумывать поле). Тест на custom добавить только если модель их несёт.

- [ ] **Step 5: Тесты зелёные + проверить консьюмеров** (grep `emojiOnlyCount`, убедиться что порог 7 не ломает StickersHelper/emojiEffects — они трактуют результат как булев «биг»).

- [ ] **Step 6: Commit**

```bash
git add web-client/src/components/RichText.tsx web-client/src/components/richtext.bigemoji.test.ts
git commit -m "feat(bigemoji): порог 1..7 + custom-emoji атомы (1:1 tweb)"
```

### Task 4: рендер — шкала --emoji-size, анимир 96, тайм-пилюля

**Files:**
- Modify: `web-client/src/components/messages/MessageContent.tsx` (`BigEmojiBubble`, ~107-154)
- Modify: `web-client/src/components/messages/MessageRow.module.scss` (класс big-emoji)
- Test: `web-client/src/components/messages/bigemoji.render.test.tsx` (create)

**Interfaces:**
- Consumes: `emojiOnlyCount` (Task 3), `--message-time-background` (Task 2).

Шкала 1:1 tweb `bubbles.ts:319-328`: `{1:96,2:90,3:84,4:72,5:60,6:48,7:36}`. Анимир. одиночный = 96 (было 160). Задать размер через CSS-переменную `--emoji-size` (как tweb `bubbles.ts:7381`).

- [ ] **Step 1: Тест — размеры по количеству**

```tsx
// bigemoji.render.test.tsx — проверяем маппинг count→px
import { describe, it, expect } from 'vitest'
import { BIG_EMOJI_SIZES } from './MessageContent'

describe('BIG_EMOJI_SIZES (1:1 tweb)', () => {
  it('шкала 96..36', () => {
    expect(BIG_EMOJI_SIZES).toEqual([0, 96, 90, 84, 72, 60, 48, 36])
  })
})
```

- [ ] **Step 2: Запустить — падает** (константа не экспортирована).

- [ ] **Step 3: Ввести шкалу.** В `MessageContent.tsx` экспортировать `export const BIG_EMOJI_SIZES = [0, 96, 90, 84, 72, 60, 48, 36]` (индекс = count). В `BigEmojiBubble` вместо `count===1?56:...` использовать `BIG_EMOJI_SIZES[count]`; прокинуть в стиль контейнера `{'--emoji-size': BIG_EMOJI_SIZES[count] + 'px'}` и рендерить глиф размером `var(--emoji-size)`. Анимир. одиночный: `ANIMATED_EMOJI_SIZE` 160 → 96 (или `BIG_EMOJI_SIZES[1]`).

- [ ] **Step 4: SCSS.** Класс big-emoji: глиф/стикер `width/height: var(--emoji-size)`; тайм-пилюля уже переведена на `--message-time-background` (Task 2). Убедиться, что фон/тень пузыря убраны (standalone), хвоста нет.

- [ ] **Step 5: Тест + сборка зелёные** (`npx vitest run src/components/messages/bigemoji.render.test.tsx && npx tsc -b --noEmit`).

- [ ] **Step 6: Commit**

```bash
git add web-client/src/components/messages/MessageContent.tsx web-client/src/components/messages/MessageRow.module.scss web-client/src/components/messages/bigemoji.render.test.tsx
git commit -m "feat(bigemoji): шкала размеров 96..36 через --emoji-size, анимир 96 (1:1 tweb)"
```

---

## Узел 2 — Реакц-чип + аватары

### Task 5: backend — recent-reactors в ReactionsFor

**Files:**
- Modify: `backend/internal/domain/reaction.go` (или где `ReactionCount` — найти грепом; поле `RecentUserIDs []int64`)
- Modify: `backend/internal/adapter/repo/postgres/reactionsrepo.go` (`ReactionsFor`, ~40-66)
- Modify: места сериализации сообщений (где `ReactionCount` кладётся в DTO/WS — грепом)
- Test: `backend/internal/adapter/repo/postgres/reactionsrepo_test.go` (добавить кейс; если файла нет — создать по образцу других repo-тестов)

**Interfaces:**
- Produces: `domain.ReactionCount { Emoji string; Count int; Mine bool; RecentUserIDs []int64 }`.

tweb: аватары показываются при `count < 4` — достаточно вернуть до 3 последних реагировавших на `(message_id, emoji)`.

- [ ] **Step 1: Тест repo** — вставить 2 реакции разных юзеров на один emoji, `ReactionsFor` возвращает `RecentUserIDs` с обоими.

```go
func TestReactionsFor_RecentUserIDs(t *testing.T) {
    // arrange: repo.Add(ctx, msgID, u1, "👍"); repo.Add(ctx, msgID, u2, "👍")
    // act: res, _ := repo.ReactionsFor(ctx, []int64{msgID}, u1)
    // assert: rc := res[msgID][0]; require.Equal(t, 2, rc.Count)
    //         require.ElementsMatch(t, []int64{u1, u2}, rc.RecentUserIDs)
}
```

- [ ] **Step 2: Запустить — падает** (`cd backend && go test ./internal/adapter/repo/postgres/ -run RecentUserIDs`).

- [ ] **Step 3: Реализация.** Расширить SQL `ReactionsFor`: добавить агрегат последних N user_id на `(message_id, emoji)`. Вариант: `array_agg(user_id ORDER BY created_at DESC)` с усечением до 3 в Go, ИЛИ подзапрос с `LIMIT`. Учесть, что таблица `reactions(message_id, user_id, emoji)` — при отсутствии `created_at` использовать порядок вставки/id. Заполнить `RecentUserIDs`.

- [ ] **Step 4: Сериализация.** Прокинуть `RecentUserIDs` во все DTO/WS, где отдаётся `ReactionCount` (грепнуть использования, добавить поле в JSON, snake_case `recent_user_ids`).

- [ ] **Step 5: `go test ./...` зелёный + `go vet`.**

- [ ] **Step 6: Commit**

```bash
git add backend/internal
git commit -m "feat(reactions): recent-reactors в ReactionsFor (для аватаров, 1:1 tweb count<4)"
```

### Task 6: frontend model — ReactionCount.recent + маппинг

**Files:**
- Modify: `web-client/src/core/models.ts` (`ReactionCount` ~239-241, `reactions` тип ~191, маппинг ~733-734)
- Test: `web-client/src/core/models.reactions.test.ts` (create)

**Interfaces:**
- Consumes: raw DTO `recent_user_ids` (Task 5).
- Produces: `ReactionCount { emoji; count; mine; recent?: number[] }`; `ConvMsg.reactions[].recent`.

- [ ] **Step 1: Тест маппинга** — сырое `{emoji, count, mine, recent_user_ids:[7,8]}` → `{emoji, count, mine, recent:[7,8]}`.

- [ ] **Step 2: Запустить — падает.**

- [ ] **Step 3: Реализация.** Добавить `recent?: number[]` в тип реакции (`models.ts:191` и `ReactionCount:239`); в маппинге (`models.ts:733-734`) прокинуть `recent: x.recent_user_ids ?? undefined`.

- [ ] **Step 4: Тест зелёный + tsc.**

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/models.ts web-client/src/core/models.reactions.test.ts
git commit -m "feat(reactions): поле recent (реагировавшие) в модели + маппинг"
```

### Task 7: StackedAvatars компонент (порт tweb)

**Files:**
- Create: `web-client/src/components/messages/StackedAvatars.tsx`
- Create: `web-client/src/components/messages/StackedAvatars.module.scss`
- Test: `web-client/src/components/messages/stackedAvatars.test.tsx` (create)

**Interfaces:**
- Produces: `<StackedAvatars peerIds={number[]} size={24} />`.
- Consumes: существующий avatar-компонент/peer store (найти как рендерятся аватары в списке — переиспользовать).

Значения 1:1 tweb `_reaction.scss:157-163` + `_stackedAvatars.scss`: `size 24`, наложение `margin-right: -.875rem` (в block-контексте), `border-size .125rem`, `border-color` = фон подложки.

- [ ] **Step 1: Тест** — 3 peerId → 3 аватара, у не-последнего есть отрицательный margin (наложение).

- [ ] **Step 2: Запустить — падает.**

- [ ] **Step 3: Реализация.** Компонент рендерит аватары справа-налево (z-index), size 24px, наложение через `margin-inline-start: -.875rem` на всех кроме первого, рамка `.125rem` цвета фона. Использовать существующий Avatar-примитив (peer name/photo из store).

- [ ] **Step 4: Тест + tsc зелёные.**

- [ ] **Step 5: Commit**

```bash
git add web-client/src/components/messages/StackedAvatars.tsx web-client/src/components/messages/StackedAvatars.module.scss web-client/src/components/messages/stackedAvatars.test.tsx
git commit -m "feat(reactions): компонент StackedAvatars (порт tweb stackedAvatars)"
```

### Task 8: чип 1:1 — тёмная подложка + аватары в чипе

**Files:**
- Modify: `web-client/src/components/messages/MessageRow.tsx` (`ReactionChip`, `MessageReactions` ~68-152)
- Modify: `web-client/src/components/messages/MessageRow.module.scss` (`--r-bg` ~28-43, `.reactionChip` ~354)
- Test: интеграционный рендер `web-client/src/components/messages/reactionChip.test.tsx` (create)

**Interfaces:**
- Consumes: `--message-highlighting-color` (Task 2), `ReactionCount.recent` (Task 6), `StackedAvatars` (Task 7).

1:1: фон чипа `--message-highlighting-color` (`_reaction.scss:87`), счётчик #fff; аватары **вместо числа** при `count < 4` И (приватный чат ИЛИ can_see_list) — `reactions.ts:305-307`, `reaction.ts:1060-1084`.

- [ ] **Step 1: Тест** — (а) чип с `count>=4` рендерит число, не аватары; (б) чип `count<4` + `recent` + приватный чат рендерит `StackedAvatars`, без числа.

- [ ] **Step 2: Запустить — падает.**

- [ ] **Step 3: Подложка.** `--r-bg` → `var(--message-highlighting-color)` (убрать `color-mix` отсебятину); `--r-fg` счётчик → `#fff`; is-chosen bg → `--primary-color` (in-bubble) / surface на медиа (уже есть :471). Сверить размеры пилюли с tweb (`1.375rem + .5rem` высота, `padding 0 .5rem`, счётчик `.9375rem` — привести к rem-величинам tweb, если расходятся с текущими 30px/8px/15px).

- [ ] **Step 4: Аватары в чипе.** В `ReactionChip`: если `r.recent?.length && r.count < 4 && canRenderAvatars` → рендерить `<StackedAvatars peerIds={r.recent} size={24}/>` вместо `<span reactionCount>`. `canRenderAvatars` = приватный чат (isUser) ИЛИ флаг can_see_list из контекста чата.

- [ ] **Step 5: Тесты + tsc + сборка зелёные.**

- [ ] **Step 6: Commit**

```bash
git add web-client/src/components/messages/MessageRow.tsx web-client/src/components/messages/MessageRow.module.scss web-client/src/components/messages/reactionChip.test.tsx
git commit -m "feat(reactions): тёмная пилюля --message-highlighting-color + аватары в чипе (1:1 tweb)"
```

---

## Узел 3 — Обои

### Task 9: patternRenderer (canvas, порт tweb) + математика интенсивности

**Files:**
- Create: `web-client/src/core/chat/patternRenderer.ts`
- Test: `web-client/src/core/chat/patternRenderer.test.ts` (create)

**Interfaces:**
- Produces: функция расчёта opacity из intensity (юнит-тестируемая) + рендер паттерна на canvas (mask/normal).

Порт логики из `tweb/src/components/chat/patternRenderer.ts` + математики приглушения `tweb/src/components/chat/bubbles/chatBackground.tsx:218-273`.

- [ ] **Step 1: Тест математики**

```ts
// patternRenderer.test.ts
import { describe, it, expect } from 'vitest'
import { patternOpacity } from './patternRenderer'

describe('patternOpacity (1:1 tweb chatBackground)', () => {
  // mask-путь (тёмные, intensity<0): opacityMax = |intensity|*0.5, пол Math.max(0.3,…)
  it('night intensity −50 → 0.3 (пол)', () => {
    expect(patternOpacity(-50, /*mask*/ true)).toBeCloseTo(0.3, 5) // 0.5*0.5=0.25 → floor 0.3
  })
  // light/overlay путь: opacityMax = |intensity|
  it('day intensity 50 → 0.5', () => {
    expect(patternOpacity(50, false)).toBeCloseTo(0.5, 5)
  })
  it('tinted intensity −38 (overlay) → 0.38', () => {
    expect(patternOpacity(-38, false)).toBeCloseTo(0.38, 5)
  })
})
```

Примечание: `intensity` здесь в «tweb-единицах» (−50..50); внутри делится на 100 → множитель. Реализовать 1:1: mask → `Math.max(0.3, (|i|/100)*0.5)`; иначе → `|i|/100`.

- [ ] **Step 2: Запустить — падает.**

- [ ] **Step 3: Реализация.** `patternOpacity(intensity, mask)` по формулам выше. Плюс canvas-рендер `renderPattern({canvas, img, mask, color})`: mask-путь — залить `#000`, `globalCompositeOperation='destination-out'`, отрисовать дудл (выбить дырки); normal-путь — просто отрисовать дудл. Порт из tweb `patternRenderer.ts:138-193` (`fillCanvas`).

- [ ] **Step 4: Тест зелёный.**

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/chat/patternRenderer.ts web-client/src/core/chat/patternRenderer.test.ts
git commit -m "feat(wallpaper): порт patternRenderer canvas + математика intensity (1:1 tweb)"
```

### Task 10: ChatBackground на своём рендере, убрать @twallpaper/react

**Files:**
- Modify: `web-client/src/components/ChatBackground.tsx`
- Modify: `web-client/src/styles/_tokens.scss` (развести night/tinted градиенты)
- Modify: `web-client/src/wallpapers.ts` (intensity per-preset)
- Modify: `web-client/package.json` (убрать `@twallpaper/react`)
- Test: визуально на стенде (Task 16) + tsc/build

**Interfaces:**
- Consumes: `patternRenderer` (Task 9), дудл-ассет `assets/pattern.svg`.

1:1: intensity per-preset (day/light 50, night −50, tinted −40) — tweb `state.ts:262-379`; night mask-путь, tinted overlay+invert (`soft-light`), light soft-light; градиенты — night `#fec496,#dd6cb9,#962fbf,#4f5bd5`, tinted `#1e3557,#182036,#1c4352,#16263a` (`state.ts:349-352`).

- [ ] **Step 1:** Переписать `ChatBackground.tsx`: убрать `TWallpaper`/`@twallpaper/react`, рисовать градиент (текущий многоточечный статический подход сохраняем) + слой паттерна через `patternRenderer` (Task 9). Blend: light/tinted `mix-blend-mode: soft-light`; tinted + `filter: invert(1)`; night — mask-путь. Opacity — из `patternOpacity(intensity, mask)`.

- [ ] **Step 2:** Ввести intensity в `wallpapers.ts`/пресеты (day/light 50, night −50, tinted −40). `readTheme` — определить mask/overlay/light путь по пресету (tinted ≠ night!).

- [ ] **Step 3:** `_tokens.scss`: развести `--tg-bgGrad*` для night и tinted (сейчас общий блок `[data-theme='night'],[data-theme='tinted']` строки 77-80) — tinted получает тёмно-синий набор.

- [ ] **Step 4:** Удалить `@twallpaper/react` из `package.json` + `node_modules` импорты; `npm i` для обновления lock.

- [ ] **Step 5:** `npx tsc -b --noEmit` + сборка фронта зелёные; grep — ноль ссылок на twallpaper.

- [ ] **Step 6: Commit**

```bash
git add web-client/src/components/ChatBackground.tsx web-client/src/styles/_tokens.scss web-client/src/wallpapers.ts web-client/package.json web-client/package-lock.json
git commit -m "feat(wallpaper): свой canvas-рендер обоев, уход от @twallpaper/react, intensity+развод night/tinted (1:1 tweb)"
```

### Task 11: подключить средний цвет обоев → highlightingColor

**Files:**
- Modify: `web-client/src/components/ChatBackground.tsx`
- Modify: `web-client/src/core/theme/themeController.ts` (использовать `applyHighlightingColorFromRgb` из Task 2)

**Interfaces:**
- Consumes: `getAverageColor` (color.ts), `applyHighlightingColorFromRgb` (Task 2), `patternRenderer` цвета градиента.

1:1 tweb `chatBackground.tsx:365`: посчитанный средний цвет фона → `highlightingColor(pixel)` → применить.

- [ ] **Step 1:** После расчёта/применения фона в `ChatBackground` вычислить средний цвет градиента (среднее по 2-4 стоп-цветам через `getAverageColor` попарно) и вызвать `applyHighlightingColorFromRgb(avgRgb, chatContainerEl)` — highlighting подстраивается под обои (как tweb). Скоуп — контейнер чата (как per-chat тема).

- [ ] **Step 2:** Проверить, что дефолт-путь (Task 2, per-preset) остаётся фолбэком до расчёта.

- [ ] **Step 3:** tsc + сборка зелёные.

- [ ] **Step 4: Commit**

```bash
git add web-client/src/components/ChatBackground.tsx web-client/src/core/theme/themeController.ts
git commit -m "feat(wallpaper): highlighting-color из среднего цвета обоев (1:1 tweb)"
```

---

## Узел 4 — Голосовой waveform e2e

### Task 12: backend — колонка waveform (миграция + domain + repo + http)

**Files:**
- Create: `backend/internal/store/postgres/migrations/00NN_media_waveform.sql` (следующий номер)
- Modify: `backend/internal/domain/media.go` (`Media.Waveform []byte`)
- Modify: `backend/internal/adapter/repo/postgres/mediarepo.go` (INSERT/SELECT/Finalize ~25-59,134-145)
- Modify: `backend/internal/adapter/delivery/http/media_handler.go` (upload body + meta ответ)
- Test: `backend/internal/adapter/repo/postgres/mediarepo_test.go` (round-trip waveform)

- [ ] **Step 1: Миграция.** Найти max номер в `migrations/`, создать `00NN_media_waveform.sql`:

```sql
-- +goose Up
ALTER TABLE media ADD COLUMN waveform BYTEA;
-- +goose Down
ALTER TABLE media DROP COLUMN waveform;
```

- [ ] **Step 2: Тест repo** — сохранить media с `Waveform: []byte{1,2,3}`, прочитать, сравнить.

- [ ] **Step 3: Запустить — падает.**

- [ ] **Step 4: Реализация.** `Media.Waveform []byte` в domain; INSERT/SELECT/Finalize в mediarepo включают `waveform`; HTTP upload принимает поле `waveform` (base64), отдаёт в meta.

- [ ] **Step 5: `go test ./...` зелёный.**

- [ ] **Step 6: Commit**

```bash
git add backend/internal
git commit -m "feat(media): колонка waveform (миграция+domain+repo+http) для голосовых"
```

### Task 13: VoiceWaveformAnalyser (порт tweb, 5-бит упаковка)

**Files:**
- Create: `web-client/src/core/audio/voiceWaveformAnalyser.ts`
- Test: `web-client/src/core/audio/voiceWaveformAnalyser.test.ts` (create)

**Interfaces:**
- Produces: класс/функция расчёта пиков + `pack5bit(values: number[]): Uint8Array` (63 байта) + `unpack5bit(bytes: Uint8Array): number[]`.

Порт 1:1 `tweb/src/helpers/voiceWaveformAnalyser.ts`: `WAVEFORM_SAMPLES_COUNT=100`, `WAVEFORM_BYTES_LENGTH=63`, 5-бит LSB-first.

- [ ] **Step 1: Тест round-trip упаковки**

```ts
import { describe, it, expect } from 'vitest'
import { pack5bit, unpack5bit } from './voiceWaveformAnalyser'

describe('5-bit waveform pack/unpack (1:1 tweb)', () => {
  it('63 байта на 100 значений', () => {
    const vals = Array.from({length: 100}, (_, i) => i % 32)
    expect(pack5bit(vals).length).toBe(63)
  })
  it('round-trip сохраняет значения 0..31', () => {
    const vals = Array.from({length: 100}, (_, i) => (i * 7) % 32)
    expect(unpack5bit(pack5bit(vals)).slice(0, 100)).toEqual(vals)
  })
})
```

- [ ] **Step 2: Запустить — падает.**

- [ ] **Step 3: Порт.** `pack5bit`/`unpack5bit` (LSB-first, 5 бит/значение) + анализатор (ScriptProcessorNode буфер 4096, амплитуда `max(abs)*32767`, лог-даунсэмплинг ≤200, `finish()`: `normPeak = max(sum*1.8/N, 2500)`, `v = min(31, clamped*31/normPeak)`). Порт из tweb 1:1.

- [ ] **Step 4: Тест зелёный.**

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/audio/voiceWaveformAnalyser.ts web-client/src/core/audio/voiceWaveformAnalyser.test.ts
git commit -m "feat(voice): порт VoiceWaveformAnalyser + 5-бит упаковка (1:1 tweb)"
```

### Task 14: запись пиков → отправка (recorder + upload)

**Files:**
- Modify: `web-client/src/core/hooks/useVoiceRecorder.ts` (`VoiceResult += waveform`)
- Modify: `web-client/src/core/managers/mediaManager.ts` (`UploadArgs += waveform`, `MediaMeta += waveform`)
- Modify: `web-client/src/core/hooks/useChatSend.ts` (~99-128 прокинуть waveform)

**Interfaces:**
- Consumes: `VoiceWaveformAnalyser` (Task 13), backend waveform (Task 12).
- Produces: `VoiceResult { …; waveform: Uint8Array | null }`.

- [ ] **Step 1:** Подключить `VoiceWaveformAnalyser` к потоку записи в `useVoiceRecorder` (таппить тот же MediaStream), в `finish()` вернуть 63-байтовый `waveform` в `VoiceResult`. Live-визуализатор входного уровня оставить как есть (он для UI).

- [ ] **Step 2:** `UploadArgs`/`MediaMeta` += `waveform?: Uint8Array` (`mediaManager.ts:8-9`); прокинуть в `upload` (base64 в HTTP-тело).

- [ ] **Step 3:** `useChatSend.ts` — при обычном голосовом передать `waveform` в `media.upload`. Для secret-голоса (~110-119) — waveform в E2E-payload (не открыто серверу).

- [ ] **Step 4:** tsc + сборка зелёные.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/core/hooks/useVoiceRecorder.ts web-client/src/core/managers/mediaManager.ts web-client/src/core/hooks/useChatSend.ts
git commit -m "feat(voice): считать пики при записи и передавать в upload (e2e, 1:1 tweb)"
```

### Task 15: рендер waveform из переданных пиков (SVG-бары)

**Files:**
- Modify: `web-client/src/components/messages/VoiceMessage.tsx`
- Modify: `web-client/src/core/audio/waveform.ts` (оставить как фолбэк)
- Modify: `web-client/src/core/models.ts` (media waveform-поле в модели сообщения)
- Test: `web-client/src/components/messages/voiceWaveform.test.tsx` (create)

**Interfaces:**
- Consumes: `unpack5bit` (Task 13), waveform из модели (Task 12/14).

Порт tweb `audio.ts:83-147` `createWaveformBars`: `barWidth=2, barMargin=2, barHeightMin=4, barHeightMax=23`, ширина `clamp(duration/60·maxW, minW, maxW)` (desktop 190/256), `barCount = min(availW/(barWidth+barMargin), wfSize)`.

- [ ] **Step 1: Тест** — из 63-байтового waveform рендерится N SVG-баров (rect), высоты нормированы по max.

- [ ] **Step 2: Запустить — падает.**

- [ ] **Step 3:** Модель сообщения (`models.ts`) — media несёт `waveform?: Uint8Array` (декод из base64). В `VoiceMessage.tsx`: если пики переданы — `unpack5bit` + `createWaveformBars` (SVG-геометрия tweb) вместо клиентского `useWaveform`. `waveform.ts` (recompute) оставить фолбэком для старых сообщений без пиков. Проигранная часть — второй слой шириной `currentTime/duration`.

- [ ] **Step 4:** Тесты + tsc + сборка зелёные.

- [ ] **Step 5: Commit**

```bash
git add web-client/src/components/messages/VoiceMessage.tsx web-client/src/core/audio/waveform.ts web-client/src/core/models.ts web-client/src/components/messages/voiceWaveform.test.tsx
git commit -m "feat(voice): рендер waveform из переданных пиков (SVG-бары, 1:1 tweb), recompute-фолбэк"
```

---

## Финализация

### Task 16: удалить мёртвый демо-код + live-верификация

**Files:**
- Delete: `web-client/src/components/MessageBubble.tsx`, `MessageBubble.module.scss`, `Reaction.tsx`, `Reaction.module.scss`

- [ ] **Step 1:** grep импортов каждого файла — убедиться, что не используются (нигде не импортятся). Если что-то импортит — не удалять, доложить.

- [ ] **Step 2:** Удалить неиспользуемые демо-файлы.

- [ ] **Step 3: Полная проверка.** `cd web-client && npm test` (весь vitest) + `npx tsc -b --noEmit`; `cd backend && go test ./...`; сборка фронта `npx vite build --outDir ../client-build --base=/`.

- [ ] **Step 4: Live-стенд** (msgrverify :38443, см. память `messenger-verify-stack`): собрать фронт из worktree, `docker compose -p msgrverify -f docker-compose.verify.yml up -d --build`. Проверить: BigEmoji-шкала, тёмная пилюля реакций + аватары (приватный чат, <4), обои night не пересвечены (0.3, soft-light), голосовое e2e (записать→отправить→у получателя waveform из пиков). Пересобрать backend с `-p msgrverify`, т.к. миграция+repo менялись.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: удалить мёртвые демо-компоненты MessageBubble/Reaction + live-верификация"
```

---

## Self-Review (заполнено при написании)

- **Покрытие спеки:** узел 0 → Task 1-2; узел 1 → Task 3-4; узел 2 → Task 5-8; узел 3 → Task 9-11; узел 4 → Task 12-15; финализация → Task 16. Все 5 узлов + out-of-scope (burst/градиент-анимация/emoji.big-настройка/облачные темы) исключены.
- **Типы:** `ReactionCount.recent` (Task 6) ← `RecentUserIDs` (Task 5); `StackedAvatars` (Task 7) ← в чипе (Task 8); `pack5bit/unpack5bit` (Task 13) ← упаковка (Task 14) / распаковка (Task 15); `patternOpacity`/`renderPattern` (Task 9) ← ChatBackground (Task 10); `applyHighlightingColorFromRgb` (Task 2) ← обои (Task 11).
- **Зависимости:** 1→2 (тайм-пилюля); 4←2; 8←2,6,7; 10←9; 11←2,10; 14←13,12; 15←13,12,14. Порядок задач соблюдает.
- **Открытые проверки для имплементера (не плейсхолдеры, а верификация факта):** Task 3 custom-emoji — зависит от того, несёт ли наша модель custom-emoji в тексте (проверить, не выдумывать поле); Task 5 — точное имя файла domain для ReactionCount + наличие created_at в reactions (грепом); Task 8 — источник флага can_see_list (контекст чата).
