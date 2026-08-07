# Видимый паритет чата — дизайн (Волна)

**Дата:** 2026-08-07
**Ветка:** `style/visible-chat-parity`
**Референс:** tweb (`/Users/denisurevic/Documents/tweb`) — берём 1:1.
**Программа:** часть «фронт 1:1 с tweb» (см. память `web-css-tweb-parity`). Предыдущие волны: тема-подсистема (PR #142) + per-chat темизация (PR #143).

## Цель

Устранить самые заметные визуальные расхождения чата с web.telegram.org, приведя 5 узлов к tweb 1:1:
подложки-темизация (highlighting-color), BigEmoji, реакционный чип + аватары, обои с интенсивностью/маской, голосовой waveform end-to-end.

## Мандат (из CLAUDE.md / решений пользователя)

- Всё **1:1 из исходников tweb**, без отсебятины. Любое расхождение — привести к tweb, не выдумывать своё.
- Мёртвый код и обёртки-костыли удалять агрессивно. Отказ от лишних зависимостей (свои примитивы «как в tweb»).
- Проверять сборку/тесты/поведение до «готово».
- Отвечать по-русски.

## Решения пользователя по развилкам

1. **Голосовой waveform** → **полный e2e как tweb** (хранить посчитанные пики, не пересчитывать у получателя). Задевает бэкенд.
2. **Обои** → **порт canvas-рендера tweb** (`patternRenderer.ts` + `chatBackground`), **убрать зависимость `@twallpaper/react`**.
3. Всё — **одной волной**, один PR, SDD.

---

## Важная поправка к первичной разведке

Первичная разведка частично смотрела `web-client/src/components/MessageBubble.tsx` и `components/Reaction.tsx` — это **статичный демо-макет, который нигде не импортируется**. Реальный рендер чата — в `web-client/src/components/messages/` (`MessageRow.tsx`, `MessageContent.tsx`, `RichText.tsx` и их `MessageRow.module.scss`). Все правки этой волны идут в реальный путь.

Следствие: BigEmoji и реакционный чип у нас **уже реализованы с приличной верностью** — это доводка до 1:1, а не порт с нуля. Демо-компоненты `MessageBubble.tsx`/`MessageBubble.module.scss`/`Reaction.tsx`/`Reaction.module.scss` в рамках волны **удаляются как мёртвый код** (проверить отсутствие импортов перед удалением).

---

## Узел 0 — Темизация подложек (highlighting-color + message-time-background)

Фундамент: даёт `--message-highlighting-color` (+`-rgb`/`-alpha`) и `--message-time-background`, которые питают узлы 1 (тайм-пилюля big-emoji), 2 (фон реакц-чипа) и 4/обои (источник — средний цвет обоев).

### Как в tweb
- **`--message-time-background`** — тема-независимая константа `rgba(0, 0, 0, .35)` (`src/scss/base.scss:82`). В контексте «без пузыря» (`.just-media`: медиа/стикер/emoji-big) переопределяется на `var(--message-highlighting-color)` (`src/scss/partials/_chatBubble.scss:760`).
- **`--message-highlighting-color`** — производная от **среднего цвета обоев** по формуле Telegram-iOS (`src/helpers/highlightingColor.ts`):
  ```
  {h,s,l} = rgbaToHsla(avgColor)
  if (s > 0) s = min(100, s + 5 + 0.1*(100 - s))
  l = max(0, l * 0.65)
  → `hsla(h, s%, l%, .4)`
  ```
- Применяется через `themeController.applyHighlightingColor` (`src/helpers/themeController.ts:293-316`): пишет три переменные — `--message-highlighting-color` (hsla-строка), `--message-highlighting-color-rgb` (первые 3 канала RGB), `--message-highlighting-alpha` (alpha/255). Hover-производная: `--message-highlighting-hover-color: rgba(var(--message-highlighting-color-rgb), calc(var(--message-highlighting-alpha) + .24))` (`base.scss:320`).
- Пока обои не посчитаны — дефолт **per-base-theme** (`src/config/state.ts:391-398`, `DEFAULT_HIGHLIGHTING_COLORS`):
  - day: `hsla(210, 67.741935%, 50.588235%, .4)`
  - night: `hsla(299.142857, 44.166666%, 37.470588%, .4)`
  - tinted: `hsla(258.461538, 50%, 65.490196%, .4)`
  - classic: `hsla(86.4, 43.846153%, 45.117647%, .4)` (у нас classic удалён — не портируем)
- В webpage-preview переопределяется на `rgba(var(--primary-color-rgb), .3)` (`_chatBubble.scss:2702`).

### Как у нас (расхождение)
- `--message-time-background` — **переменной нет**; тайм-пилюля big-emoji/стикера захардкожена `rgba(0,0,0,.45)` (`web-client/src/components/messages/MessageRow.module.scss`, класс `.stickerMeta`).
- `--message-highlighting-color` — есть в `web-client/src/styles/_tokens.scss` (bespoke: `rgba(0,0,0,.24)` light / `rgba(255,255,255,.16)` dark) — **отсебятина**, не выведена из обоев, не per-base по HSL-формуле, нет `-rgb`/`-alpha`.
- Хелперы `rgbaToHsla`, `hslaStringToRgba`, `getAverageColor` уже портированы в Волне 1 (`web-client/src/shared/lib/color.ts`).

### Что делаем (1:1)
1. Порт `highlightingColor(rgba)` в `web-client/src/shared/lib/color.ts` (использует уже готовый `rgbaToHsla`).
2. `DEFAULT_HIGHLIGHTING_COLORS` (day/night/light/tinted) в `web-client/src/config/themePresets.ts`. Для `light` берём day-значение (в tweb light = base day); tinted — своё.
3. `applyHighlightingColor(preset, element?)` в `web-client/src/core/theme/themeController.ts`: пишет `--message-highlighting-color` + `-rgb` + `-alpha` из дефолта пресета. Вызвать из `setTheme` (глобально) и из per-chat `applyChatTheme` (по контейнеру чата, как tweb `chat.ts:564`). Источник «средний цвет обоев» подключается в узле 3 (обои): когда фон посчитан — пересчитать highlighting из среднего цвета.
4. Ввести `--message-time-background: rgba(0, 0, 0, .35)` (константа) + `--message-highlighting-hover-color` (формула). В контексте стикера/emoji-big/медиа-без-подписи — `--message-time-background: var(--message-highlighting-color)`.
5. Убрать bespoke `--message-highlighting-color` из `_tokens.scss` и хардкод `.stickerMeta` — потребители читают тема-переменные.

---

## Узел 1 — BigEmoji → 1:1

### Как в tweb
- Детект (`src/components/chat/bubbles.ts:7357-7384`): собирает `emojiEntities` из **серверных** `messageEntityEmoji` + `messageEntityCustomEmoji`; big-режим когда сумма длин эмодзи-entities == длине текста без пробелов (т.е. только эмодзи). Кол-во больших = `min(7, emojiEntities.length)`.
- Шкала (`bubbles.ts:319-328`), px: `{1:96, 2:90, 3:84, 4:72, 5:60, 6:48, 7:36}`, прокидывается как CSS-переменная `--emoji-size` (`bubbles.ts:7381`).
- Разметка (`bubbles.ts:7510-7538`): `isStandaloneMedia=true`, `canHaveTail=false` (нет хвостика), класс `emoji-big`, фон/тень пузыря убраны (`_chatBubble.scss` `.just-media`), тайм-штамп плавает в правом-нижнем углу (`_chatBubble.scss:1874-1881`) на `--message-time-background`.
- Анимир. одиночный: `bigEmojis===1` без custom-emoji → анимированный стикер эмодзи, размер = **96** (`customEmojiSize = size`).
- Гейт настройки `appSettings.emoji.big`.

### Как у нас
- Детект `emojiOnlyCount(text)` (`web-client/src/components/RichText.tsx:16-24`): **regex по тексту**, порог жёстко **≤3**, custom-emoji в big-путь не попадают.
- Рендер `BigEmojiBubble` (`web-client/src/components/messages/MessageContent.tsx:107-154`), размеры **3 значения** захардкожены `56/46/38` px; анимир. одиночный через `useAnimatedEmoji` при size **160** (`ANIMATED_EMOJI_SIZE`).
- Тайм-пилюля `.stickerMeta` хардкод (см. узел 0).

### Что делаем (1:1)
1. Порог `≤3` → `≤7`; шкала → `96/90/84/72/60/48/36`, задать через `--emoji-size` (одна переменная вместо трёх литералов).
2. Учитывать custom-emoji в детекте (наш `RichText` уже умеет `CustomEmoji` инлайном; big-путь должен принимать сообщение из одних custom-emoji и рендерить их крупными). Детект приблизить к tweb: «весь текст без пробелов = только эмодзи (обычные + custom)». Наш детект остаётся regex-based по тексту (серверные emoji-entities у нас не формируются так же, как в tweb MTProto) — но привести порог, набор (custom) и размеры к tweb.
3. Анимир. одиночный размер **160 → 96** (1:1 tweb).
4. Тайм-пилюля big-emoji → `--message-time-background` (из узла 0), убрать хардкод `rgba(0,0,0,.45)`.
5. Гейт настройки `emoji.big` — **out-of-scope** (у нас нет этой настройки; big всегда включён — оставляем как есть, tweb-дефолт тоже включён).

---

## Узел 2 — Реакционный чип → 1:1 (+ аватары реагировавших)

### Как в tweb
- Чип (`src/scss/partials/_reaction.scss:81-224`): `--reaction-size: 1.375rem` (22px), высота `= reaction-size + .5rem`, `border-radius` = высоте (полная пилюля), `padding: 0 .5rem`, фон `--background-color: var(--message-highlighting-color)` (тёмная полупрозрачная подложка из обоев/дефолта), счётчик `--counter-color:#fff`, `font-size:.9375rem` (15px) bold.
- is-chosen (`_reaction.scss:115-155`): псевдоэлемент `:before` `scale(0→1)+opacity(0→1)` через `SetTransition` 300ms, цвет `--chosen-background-color: var(--message-primary-color)`.
- **Аватары** (`src/components/chat/reaction.ts:1060-1084`): только Block-тип; показываются **вместо числа** когда `count < 4` (`REACTIONS_DISPLAY_COUNTER_AT[Block]=4`) И `canRenderAvatars`. `canRenderAvatars` (`reactions.ts:305-307`) = `(can_see_list || peerId.isUser()) && totalReactions < 4`. `StackedAvatars` `avatarSize:24`, наложение `--margin-right:-.875rem` (`_reaction.scss:157-163`), рендерятся из `recentReactions.map(peer_id)`.
- Позиционирование (`bubbles.ts:9822-9872`): медиа без подписи → блок в `.bubble-content-wrapper` поверх медиа (`justify-content:flex-end; margin-inline-start:auto`, `_chatBubble.scss:3549-3573`); иначе → под текстом в `.message`.
- Burst/around-анимация (`fireAroundAnimation`, тяжёлый Lottie-renderer) — **out-of-scope** этой волны.

### Как у нас
- Реальный чип `ReactionChip`/`MessageReactions` в `web-client/src/components/messages/MessageRow.tsx:68-152` — **уже** 22px эмодзи, пилюля 30px (22+8), radius=высоте, is-chosen `::before` scale/opacity 0.3s (мимикрия SetTransition 300), hover 0.08, счётчик 15px bold tabular, star-реакции, полноценный data-flow (toggle/onShow).
- Позиционирование `MessageRow.module.scss`: `.reactionsPad` (внутри медиабабла) + `.reactionsOut`/`.zoneCol` (плавающая строка под стикером/кружком/голосовым) — **уже есть** media/reactions-out ветки.
- Фон чипа `--r-bg` (`MessageRow.module.scss:28-43`): **отсебятина** `color-mix(in srgb, var(--primary-color) 10%, transparent)` (in-bubble) / `--message-out-primary-color 12%` (out). tweb — `--message-highlighting-color`.
- **Аватары реагировавших — отсутствуют полностью.** Модель реакции (`web-client/src/core/models.ts:191,239-241,325`) — `{emoji, count, mine}`, **без списка недавних реагировавших**. Бэкенд recent-reactors тоже не отдаёт (grep пуст).

### Что делаем (1:1)
1. **Фон чипа** `--r-bg` → `var(--message-highlighting-color)` (узел 0), счётчик `#fff`; is-chosen bg → `--primary-color` (in-bubble), на медиа/стикере — surface-инверсия (уже есть `MessageRow.module.scss:471-472`). Убрать `color-mix`-отсебятину.
2. **Аватары реагировавших** — новый компонент `StackedAvatars` (порт tweb `stackedAvatars.ts`: наложение, size 24, border-color). Показ **вместо числа** при `count < 4` И (приватный чат ИЛИ `can_see_list`).
   - **Backend-зависимость:** нужно поле «недавние реагировавшие» (список peer_id на реакцию). Требует: поле в протоколе/модели (`models.ts` `ReactionCount += recent?: peerId[]`), отдачу с бэкенда (реакции хранятся в БД — добавить выборку последних N реагировавших), маппинг. Аватары рендерятся из уже загруженных пиров (peer store).
   - Порог/условие `can_see_list` — если бэк не отдаёт флаг, для приватных чатов (isUser) показываем всегда (tweb-ветка `peerId.isUser()`); для групп — при наличии данных.
3. Свериться по значениям пилюли (высота, padding, margin, счётчик) с tweb — расхождения (у нас 30px/8px vs tweb `1.375rem+.5rem`/`.5rem`) привести к tweb-величинам в rem.
4. Удалить демо `Reaction.tsx`/`Reaction.module.scss` (мёртвый код).

---

## Узел 3 — Обои: интенсивность/маска (порт canvas-рендера, уход от @twallpaper/react)

### Как в tweb
- Компонент `src/components/chat/bubbles/chatBackground.tsx` + `src/components/chat/patternRenderer.ts` + `chatBackground.module.scss`. Слои в `.Slot` (двойная буферизация для кроссфейда): цвет слота → `gradientCanvas` → `patternCanvas`.
- Две стратегии приглушения (`chatBackground.tsx:218-273`); выбор `useOverlayRender = themeName==='tinted'`, `isDarkPattern = useOverlayRender || intensity < 0`:
  - **MASK-путь (тёмные, напр. night):** `patternRenderer` с `mask:true` — холст заливается `#000`, `globalCompositeOperation='destination-out'` выбивает дырки формой дудла; градиент виден в дырках. Приглушение через **opacity градиента**: `opacityMax = |intensity|·0.5`, пол `Math.max(0.3, …)` (для night intensity −50 → 0.25 → **0.3**).
  - **OVERLAY-путь (только tinted):** `mask:false`, паттерн-канвас `.Blend` = `mix-blend-mode: soft-light` + `.DarkPatternInvert` = `filter: invert(1)`; intensity форсится `-0.38`; opacity **паттерна** = `|intensity|` = 0.38.
  - **Светлый путь (day/light):** `mask:false`, `.Blend` = `mix-blend-mode: soft-light` без invert; opacity паттерна = `|intensity|` = **0.5** (intensity 50).
- Дефолты (`src/config/state.ts:262-379`, `DEFAULT_THEME`): intensity per-base (light/day **50**, night **−50**, tinted **−40**); градиенты — day `#b1e0fa,#82b0d8,#a0d8e8,#e5f0f8`, night `#fec496,#dd6cb9,#962fbf,#4f5bd5`, tinted `#1e3557,#182036,#1c4352,#16263a`. Дефолтный дудл `assets/img/pattern.svg`.
- `ChatBackgroundGradientRenderer` (анимация градиента при отправке) — **out-of-scope** (отдельная волна тяжёлых рендеров).

### Как у нас (отсебятина → пересвет)
- `web-client/src/components/ChatBackground.tsx` использует сторонний `@twallpaper/react`. `patternFor` (`ChatBackground.tsx:23-28`) — **хардкод `opacity: 0.5` для всех тем**, никакого intensity; `mode==='dark' → {mask:true}` иначе `{mask:false}`; night и tinted валятся в один mask-путь.
- Пакет twallpaper зашивает `.tw-pattern { mix-blend-mode: overlay; opacity: .5 }` — **overlay вместо soft-light** (контрастнее, дудлы выпирают); из нашего кода не настраивается.
- `--tg-bgGrad0..3` (`_tokens.scss:44-47` light / `77-80` dark) — один яркий «sunset»-набор на обе тёмные темы; светит на 0.5 в night (tweb — 0.3) → главный пересвет.

### Что делаем (1:1)
1. Порт `patternRenderer.ts` (canvas: mask destination-out / нормальная отрисовка) и логики слоёв `chatBackground` в наш `ChatBackground.tsx` — свой canvas-рендер, **убрать зависимость `@twallpaper/react`** (удалить из package.json, снять импорты).
2. Ввести **intensity** per-preset (day/light 50, night −50, tinted −40) и всю математику приглушения tweb (`opacityMax`, множитель ·0.5 для mask, пол `Math.max(0.3,…)`, знак).
3. Blend светлого/tinted → `soft-light` (не overlay); tinted — overlay-путь с invert; night — mask-путь.
4. Развести градиенты night и tinted: night оставить `#fec496…#4f5bd5`, tinted → тёмно-синий `#1e3557,#182036,#1c4352,#16263a`. Значения — в токены/пресеты обоев (`_tokens.scss` / `wallpapers.ts`).
5. Подключить средний цвет обоев к узлу 0: посчитанный `getAverageColor` фона → `highlightingColor()` → `applyHighlightingColor` (как tweb `chatBackground.tsx:365`).
6. Анимированный градиент (`ChatBackgroundGradientRenderer`) не портируем — статический многоточечный градиент (текущий подход) сохраняем, меняем только слой паттерна.

---

## Узел 4 — Голосовой waveform end-to-end (полная модель tweb, хранить пики)

### Как в tweb
- **Расчёт при записи** (`src/helpers/voiceWaveformAnalyser.ts`): `VoiceWaveformAnalyser` таппит `MediaStream` через `ScriptProcessorNode` (буфер 4096). `WAVEFORM_SAMPLES_COUNT=100`, `WAVEFORM_BYTES_LENGTH=63` (ceil(100·5/8)), `DOWNSAMPLE_THRESHOLD=200`. Амплитуда per-chunk = `max(abs(sample))·32767`; адаптивный лог-даунсэмплинг ≤200 бакетов; `finish()`: `normPeak = max(sum·1.8/N, 2500)`, `v = min(31, clamped·31/normPeak)`, **5-битная LSB-first упаковка** в `Uint8Array(63)`.
- **Хранение/передача:** `chatRecording.ts:208` `waveform = analyser.finish()` → `sendFile({waveform, duration})` → атрибут `documentAttributeAudio.waveform` (MTProto).
- **Рендер** (`src/components/audio.ts`): `decodeWaveform()` (57-81) распаковывает 5-бит → `Uint8Array(0..31)`; `createWaveformBars(waveform, duration)` (83-147) — **SVG `<rect>`** бары: `barWidth=2, barMargin=2, barHeightMin=4, barHeightMax=23`; ширина `clamp(duration/60·maxW, minW, maxW)` (desktop 190/256); `barCount = min(availW/(barWidth+barMargin), wfSize)`. Проигранное — второй SVG (`audio-waveform-fake`) с шириной `currentTime/duration·100%`. Seek — `scrub()` по offsetX.

### Как у нас
- **Фронт-рендер** `web-client/src/components/messages/VoiceMessage.tsx` — уже настоящий waveform, но бары — **div'ы**; `useWaveform(mediaId)` (`web-client/src/core/audio/waveform.ts`) **пересчитывает у получателя**: `decodeAudioData` скачанного файла → 44 амплитуды (`WAVE_BARS=44`), кэш по mediaId. Плеер полноценный (play/pause/seek/unread).
- **Запись** `web-client/src/core/hooks/useVoiceRecorder.ts` — `MediaRecorder` (opus/webm); есть live-визуализатор входного уровня (`AnalyserNode` RMS, 90 баров) **только для UI-пилюли**, итоговые пики не считаются, в `VoiceResult` (`useVoiceRecorder.ts:19-25`) не попадают.
- **Протокол/модель:** `useChatSend.ts:99-128` → `managers.media.upload({blob,mime,size,duration})` → `sendMessage({type:'voice', mediaId})`; пики не передаются. `mediaManager.ts` `UploadArgs`/`MediaMeta` — есть `duration`, нет waveform. `models.ts:185` `media_duration`, waveform нет.
- **Бэк:** `backend/internal/domain/media.go:5-27` `Media{Duration int}`, нет waveform; миграция `backend/internal/store/postgres/migrations/0004_media.sql`; репо `backend/internal/adapter/repo/postgres/mediarepo.go` (INSERT/SELECT/Finalize); HTTP `backend/internal/adapter/delivery/http/media_handler.go`. Поля под пики нет.

### Что делаем (1:1 e2e)
1. **Запись пиков:** порт `VoiceWaveformAnalyser` (100 сэмплов, 5-бит, 63 байта, iOS-даунсэмплинг) — новый модуль во фронте; интегрировать в `useVoiceRecorder.ts`, выдавать `waveform: Uint8Array(63)` в `VoiceResult`. Live-визуализатор записи оставить (он для UI), но итог — из анализатора.
2. **Передача:** `waveform` в `UploadArgs`/`MediaMeta` (`mediaManager.ts:8-9`); прокинуть в `useChatSend.ts:121` `media.upload`. Для secret-голоса (`useChatSend.ts:110-119`) — пики в E2E-полезной нагрузке (сервер видит только ciphertext, открыто не гнать).
3. **HTTP:** поле `waveform` (base64/bytes) в upload-хендлере (`media_handler.go`) и в ответе meta.
4. **Бэк-хранение:** **новая миграция** (следующий номер, не править 0004 — правило `backend/CLAUDE.md`) — колонка `waveform BYTEA`; поле `Waveform []byte` в `domain.Media`; INSERT/SELECT/Finalize в `mediarepo.go`.
5. **Рендер:** порт `decodeWaveform` (5-бит → 0..31) + `createWaveformBars` (SVG-геометрия tweb: barWidth 2 / margin 2 / heightMax 23, 100→N баров, clamp по duration) в `VoiceMessage.tsx`; **при наличии переданных пиков — использовать их**, `waveform.ts` (client-side recompute) оставить только как фолбэк для старых сообщений без пиков.

---

## Порядок задач (план построит поверх)

0. Узел 0 (фундамент, чистый порт) — темизация подложек.
1. Узел 1 — BigEmoji (использует `--message-time-background` из 0).
2. Узел 2 — реакц-чип (фон из 0) + аватары (backend-поле recent-reactors).
3. Узел 3 — обои (порт canvas, уход от twallpaper) + подключить средний цвет к 0.
4. Узел 4 — голосовой waveform e2e (фронт-запись + протокол + бэк-миграция + рендер).

Узлы 1 и 2 зависят от 0. Узлы 3 и 4 независимы (3 доопыляет 0 средним цветом обоев — не блокирует). Порядок минимизирует конфликты.

## Out-of-scope (в этой волне не делаем)

- Burst/around-анимация реакций (тяжёлый Lottie-renderer `fireAroundAnimation`) → волна анимаций.
- `ChatBackgroundGradientRenderer` (анимация градиента при отправке), морф/3D-cube сторис → волна тяжёлых рендеров.
- Настройка `appSettings.emoji.big` (у нас нет UI настроек эмодзи; tweb-дефолт = включено).
- Облачные темы чата (backend-зависимые) — отложены ранее.
- Paid/star-реакции визуал не переделываем сверх текущего (data-flow есть; burst — вне scope).

## Тестирование

- **Юниты (vitest, happy-dom):** `highlightingColor()` формула (h/s/l пороги, известные входы), 5-бит упаковка/распаковка waveform (round-trip), интенсивность→opacity математика обоев (пол 0.3, знак), детект BigEmoji (порог 7, custom-emoji, «только эмодзи»).
- **Бэк (go test):** миграция waveform up/down, repo INSERT/SELECT waveform round-trip, HTTP upload с waveform.
- **Live (стенд msgrverify :38443):** big-emoji шкала визуально, реакц-чип тёмная пилюля + аватары (приватный чат), обои night не пересвечены (0.3), голосовое: записать → отправить → у получателя waveform из пиков (не пересчёт).
- Полный `npm test` + `go test ./...` + сборка фронта + `docker compose -p msgrverify` перед «готово».

## Затрагиваемые файлы (карта)

**Фронт (тема/подложки):** `shared/lib/color.ts`, `config/themePresets.ts`, `core/theme/themeController.ts`, `styles/_tokens.scss`.
**Фронт (BigEmoji):** `components/RichText.tsx`, `components/messages/MessageContent.tsx`, `components/messages/MessageRow.module.scss`, `core/animatedEmoji.ts`/`core/hooks/useAnimatedEmoji.ts`.
**Фронт (реакции):** `components/messages/MessageRow.tsx`, `MessageRow.module.scss`, новый `components/StackedAvatars.tsx`, `core/models.ts`.
**Фронт (обои):** `components/ChatBackground.tsx`, новый `core/chat/patternRenderer.ts`, `styles/_tokens.scss`, `wallpapers.ts`, `package.json` (убрать `@twallpaper/react`).
**Фронт (голосовое):** новый `core/audio/voiceWaveformAnalyser.ts`, `core/hooks/useVoiceRecorder.ts`, `core/hooks/useChatSend.ts`, `core/managers/mediaManager.ts`, `components/messages/VoiceMessage.tsx`, `core/audio/waveform.ts` (фолбэк), `core/models.ts`.
**Бэк (голосовое + реакции-аватары):** `internal/domain/media.go`, новая миграция `store/postgres/migrations/00NN_*.sql`, `adapter/repo/postgres/mediarepo.go`, `adapter/delivery/http/media_handler.go`; реакции — выборка recent-reactors в репо реакций + отдача.
**Удалить (мёртвый код):** `components/MessageBubble.tsx`, `components/MessageBubble.module.scss`, `components/Reaction.tsx`, `components/Reaction.module.scss` (после проверки отсутствия импортов).
