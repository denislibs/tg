# Медиа-суперпорт tweb — ОДИН MR (ветка feat/tweb-media-core)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development. Задачи — чекбоксами, строго последовательно (один worktree).

**Решения пользователя (2026-08-12):**
1. Ядро медиавьювера — **чистый TS** (порт tweb `mediaViewer/base.ts`+`index.ts`, vanilla-класс, один глобальный инстанс в `document.body`). React — только островами через `createRoot`: аватарка автора, caption (RichText). **VideoPlayer и ProgressivePreloader — тоже vanilla** (в tweb они vanilla и есть).
2. Всё — **в один merge request**: вьювер + медиа-слой (CacheStorage) + stripped-превью + прелоадер.

**Референс:** tweb `/Users/denisurevic/Documents/tweb`. Наш код: `web-client/`. Бэкенд: `backend/`.

## Global Constraints

- Поведение/классы/константы 1:1 из tweb; отступление — только с комментарием-обоснованием у строки. Комментарии по-русски.
- Без framer-motion. Норма проводки web-client/CLAUDE.md (строка краснит тест или несёт комментарий).
- Проверка каждой задачи: `npx vitest run` (web-client/), `npx tsc --noEmit`, oxlint; бэкенд-задачи: `go build ./... && go vet ./... && go test ./...`.
- Старый `MediaLightbox.tsx`/`useLightbox.ts` удаляются в конце (мёртвый код не оставлять).

---

## Стадия A — vanilla-хелперы ядра (инертные)

### Task 1: `swipeHandler` — В РАБОТЕ (исполнитель отправлен)
Create `web-client/src/core/dom/swipeHandler.ts` + тесты. Порт tweb `src/components/swipeHandler.ts` дословно.

### Task 2: чистые хелперы
- Create `web-client/src/components/mediaViewer/clipPath.ts` (порт tweb `mediaViewer/clipPath.ts`)
- Create `web-client/src/components/mediaViewer/snapshotSize.ts` (порт `mediaViewer/snapshotSize.ts`; константы `MAX_DEVICE_PIXEL_RATIO = 2`, `MAX_PIXEL_AREA = 1_500_000`)
- Create `web-client/src/core/dom/getVisibleRect.ts` (порт `src/helpers/dom/getVisibleRect.ts`)
- Тесты: портировать tweb `src/tests/mediaViewerClipPath.test.ts`, `mediaViewerSnapshotSize.test.ts` под vitest; getVisibleRect — свои.

### Task 3: `listLoader`
Create `web-client/src/components/mediaViewer/listLoader.ts` (порт `src/helpers/listLoader.ts`; `loadCount = 50`, `loadWhenLeft = 20`) + тесты (go() сплайс/onJump, дозагрузка при остатке < 20, reset). SearchListLoader-специфику MTProto не портировать.

## Стадия B — ProgressivePreloader (vanilla)

### Task 4: порт прелоадера
- Create `web-client/src/components/preloader.ts` — порт tweb `src/components/preloader.ts` (313 строк): SVG-кольцо (`totalLength = 149.82473754882812`, streamable `118.61124420166016`), состояния idle/progress/manual/streamable, `TRANSITION_TIME = 200`, отмена по клику, `tryAgainOnFail`, `setManual`, `attach/detach` через SetTransition-эквивалент (портировать минимум).
- Стили: проверить `web-client/src/styles/` на наличие порта `_preloader.scss`; нет — портировать целиком.
- Прогресс-события: подписка на наши `media:upload_progress`/download-прогресс (см. `rt:`-каталог в `client/realtimeBridge.ts`); чего не хватает в воркере — добавить событие прогресса скачивания в `mediaManager` (у tweb — `download_progress` c троттлингом 50 мс, `apiFileManager.ts:874-883`).
- Тесты: setProgress → strokeDasharray; manual-режим; отмена зовёт cancel.

## Стадия C — медиа-слой: CacheStorage + objectURL (токен из URL исчезает)

**Модель tweb (НЕ через SW):** воркер качает байты → пишет в CacheStorage-корзину → отдаёт `blob:`-objectURL → зеркалит URL вкладкам. SW картинки не перехватывает.

### Task 5: CacheStorageController
Create `web-client/src/core/files/cacheStorage.ts` — порт tweb `src/lib/files/cacheStorage.ts` в нашем объёме: корзина `cachedFiles`, ключи `'/' + entryName` (`media_<id>` / `media_<id>_thumb` — наш аналог `fileName.ts`), `getFile/saveFile/deleteAll`, таймаут операций 15с, `Time-Cached`/`Content-Length` заголовки при save. Шифрование passcode и множественные корзины НЕ тащить (у нас пасскода-шифрования кэша нет — комментарий-обоснование). Тесты на happy-dom с моком caches.

### Task 6: воркерный конвейер download→cache→objectURL
Modify `web-client/src/core/managers/mediaManager.ts`:
- `downloadMediaURL(id, thumb?)`: кэш-контекст в памяти воркера (`{downloaded, url}` по образцу tweb `storages/thumbs.ts`) → промах: `getFile` из cacheStorage → промах: байты (DNP-ON: `fileDownload.downloadMedia`; DNP-OFF: worker-`fetch` с `Authorization: Bearer` — БЕЗ токена в URL) → `saveFile` если ≤ `MAX_FILE_SAVE_SIZE = 20 * 1024 * 1024` (константа tweb) → `URL.createObjectURL` (в воркере доступен) → записать в кэш-контекст.
- Зеркало вкладкам: URL-ы публикуются ops-событием (наша норма «владелец публикует, витрина зеркалит» — web-client/CLAUDE.md), поздняя вкладка получает снимок RPC-ответом.
- Logout/смена сессии: `deleteAll()` корзины + сброс контекста в существующем `onLoggingOut` (`workerCore`) — закрывает остаточный риск PR #191.
- Токен-механизм (`mediaUrl.ts`) пока не удалять: стрим-URL для `<video>` при DNP-OFF всё ещё токенный; пометить комментарием, что картинки на него больше не ходят.
- Тесты: повторный запрос = тот же URL без сети; reload-симуляция (пустой контекст, полный кэш) → URL без сети; logout стирает.

### Task 7: перевод потребителей картинок
Modify: `RealMediaBubble.tsx`, `AlbumGrid.tsx`, `MessageContent.tsx`, `useMediaThumb.ts`, `useMediaContentUrl.ts`, `SearchView.tsx`, `SharedMedia.tsx`, `useAvatarSrc.ts` (аватарки — тот же канал, ключ `media_<id>`): вместо токен-URL — async запрос `downloadMediaURL` к воркеру с зеркальным кэшем на витрине (синхронный при повторном рендере — джиттер ленты не возвращать: первый запрос async, но URL оседает в зеркале, см. норму). Удалить мёртвые ветки токен-URL у картинок.

## Стадия D — stripped-превью до tweb-уровня

### Task 8: аудит+бэкенд
У нас `blurPreview` (base64 JPEG) уже в payload медиа (см. `RealMediaBubble.tsx:131`). Довести: (а) убедиться, что размер соответствует tweb stripped (~32-40px, байты уровня сотен), иначе ужать генерацию в `backend/internal/usecase/media` (ffmpeg-процессинг); (б) добавить тот же stripped в payload **аватарок** пиров (сейчас нет — аватарка грузится без превью); миграция + прокладка через DTO. Go-тесты.

### Task 9: фронт — канвас-блюр
- Create `web-client/src/helpers/blur.ts` — порт tweb `src/helpers/blur.ts`: `RADIUS = 2`, `ITERATIONS = 2`, канвас `canvas-thumbnail`, кэш 150, очередь тяжёлых задач упростить до микро-очереди (комментарий).
- Применить в баблах вместо CSS-блюра (проверить текущий способ), в vanilla-вьювере (Стадия E) и в аватарках 1:1 tweb: у аватарок stripped БЕЗ блюра (`avatarNew.tsx:574-590`).

## Стадия E — vanilla-ядро вьювера

### Task 10: каркас `AppMediaViewerBase`
Create `web-client/src/components/mediaViewer/base.ts` — порт tweb DOM-дерева (классы 1:1: `media-viewer-whole/overlays/topbar/buttons/movers/mover-wrapper/mover/aspecter`, порядок append load-bearing для CSS-соседей), константы `OPEN_TRANSITION_TIME = 200`, `MOVE_TRANSITION_TIME = 350`, `RESERVE_TOP/BOTTOM_DESKTOP = 80/110`, `VIDEO_MIN_WIDTH = 420`; `getOverlayRoot()` = body; `toggleWholeActive` (backwards+setTimeout 0). Стили: наш партиал `_mediaViewer.scss` уже порт — выверить против tweb `mediaViewer.scss` (счётчик расхождений в коммите).

### Task 11: `setMoverToTarget` (open/close полной верности)
Порт `base.ts:1176-1798`: мувер fixed, размер = целевой rect, scale вниз к источнику; clip-path на wrapper (`getMediaViewerClipPath`); canvas-снапшот источника (`snapshotSize`); наследование радиусов от предков (`computeEffectiveCornerRadii`, TOLERANCE 1.5, деление на scaleX/scaleY); hideFloatings/reveal (адаптировать селекторы под наши классы бабла — таймкод, play, is-floating time); `doubleRaf` перед целевым transform; `waitForMoverTransition` (transitionend+страховочный таймер +100мс); закрытие с ре-измерением, opacity-фолбэк оффскрина, перенос zoom/rotate-трансформа на мувер одним кадром.

### Task 12: зум/пан/поворот + тач
Порт `buildMoversTransform` (две стопки: мувер vs `moversContainer`), `onZoom/calculateScaleOffset/getZoomBoundaries/calculateOffsetBoundaries`, инерция `k = 0.1`, bounce (`zoomMaxBounceValue = ZOOM_MAX * 3`, clamp-дебаунс 300 мс); разводка SwipeHandler из Task 1 по `base.ts:522-587` (пороги 20%/125px, зум-пан, verifyTouchTarget-белый список); тап → `chrome-hidden`, `highlight-switchers` 3000 мс; wheel/пинч/дабл-клик (в зуме reset, иначе scale 3 в точку).

### Task 13: наполнение медиа + прелоадер + острова
`_openMedia`-порт: `setAttachmentSize`-эквивалент на layout-ghost `content.media` (visibility:hidden), thumb → мувер → полное медиа ПОСЛЕ `onAnimationEnd` (fastRaf-свап), `fullPhotoSize`-добор; прелоадер из Task 4 (`canAttachPreloader` ≥150×150, manual при отключённой автозагрузке — у нас пока всегда авто, ветку manual оставить живой под тест); React-острова: аватарка автора (`createRoot` в `.media-viewer-userpic`-узел), caption RichText (в `.media-viewer-caption .scrollable`), клик по автору → закрыть и перейти к сообщению.

### Task 14: `AppMediaViewer` (message-вариант) + навигация
Порт `index.ts`-подмножества: `topButtons ['delete','forward']` (проброс наших действий над сообщением: forward — существующий флоу пересылки, delete — удаление с подтверждением), мобильное ⋮-меню; листание через listLoader (Task 3) с нашим источником: окно сообщений + дозапрос истории медиа (наш `chats/{id}/media` REST) при остатке < 20; слайд-анимация `moveTheMover`; клавиатура (стрелки вне зума, Esc через наш navLayer).

### Task 15: видео — vanilla VideoPlayer
Create `web-client/src/components/mediaViewer/videoPlayer.ts` (или `core/mediaPlayer/`) — порт tweb `src/lib/mediaPlayer/index.ts` (768 строк) в объёме вьювера: chrome-разметка (`ckin__player/ckin__video/default__controls/…` 1:1 — стили `_ckin.scss` уже есть), progress line, volume, playback rate, fullscreen, PiP (наш `core/pip.ts`), `has-video`/`has-video-controls`/буферизация `is-buffering`; создание плеера ПОСЛЕ `onAnimationEnd`; gif без плеера; `video.src` — `resolveStreamUrl` (DNP-ON → SW-206). Существующий React `VideoPlayer.tsx`: если используется только вьювером — удалить; если ещё где-то — оставить с комментарием и тикетом.

### Task 16: точки входа + снос старого
- Разводка: чат (клик по медиа в бабле — квалификация клика по tweb `bubbles.ts:3673-3688`: перехват на прелоадер, сбор prev/next-таргетов из отрендеренных баблов), профиль (аватар-вариант: листание фото профиля), shared media.
- Удалить: `MediaLightbox.tsx`, `MediaLightbox.module.scss`, `useLightbox.ts`, три места монтирования; починить `z-index` к tweb (4), хоткеи-экран (`Ctrl+±` ↔ код).
- Ручная проверка на стенде: открытие/закрытие с полётом от миниатюры (в т.ч. отскролленной), листание, зум+закрытие, видео со стримом, свайпы на тач-эмуляции.

### Task 17: финал
Полный прогон (vitest, tsc, oxlint, go test), счётчики расхождений с tweb по `mediaViewer.scss`/`base.ts`-структуре в описание MR, обновление `web-client/CLAUDE.md` (раздел про vanilla-вьювер и медиа-слой).
