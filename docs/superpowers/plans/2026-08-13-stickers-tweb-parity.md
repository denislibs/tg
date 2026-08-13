# Стикеры 1:1 с tweb — этап 1: метаданные на бэке + слои показа на фронте

Ветка: `feat/stickers-tweb-parity` (worktree `.claude/worktrees/stickers-tweb-parity`).

## Зачем

Сейчас стикер на фронте — это `StickerMedia`: прямой `fetch` байтов по `media_id`,
определение типа по `Content-Type`, фиксированный квадрат и пустой контейнер до
загрузки. У tweb показ стикера — трёхслойный (`wrapSticker` + `stickerAppearance`):

1. мгновенный силуэт/размытое превью из тумба документа,
2. кэшированный первый кадр (PNG, сохранённый прошлым показом),
3. само медиа (canvas / video / img), которое сменяет нижние слои только после
   доказанной отрисовки (`ensurePresented`).

Слой 1 требует данных, которых бэк не отдаёт: размеров стикера и stripped-превью.
Поэтому этап 1 = «бэк отдаёт метаданные» + «фронт умеет их показывать».

## Что НЕ входит в этап 1

- `customEmoji/renderer` (общий канвас на сообщение) — этап 2.
- `SuperStickerRenderer` (панель по видимости) — этап 3.
- Премиум-эффекты (`video_thumbs`), `stickerViewer` — этап 4+.
- `photoPathSize` (SVG-контур) — у нас нет трассировщика на бэке; роль мгновенного
  слоя играет stripped-JPEG (`media.blur_preview`), он уже генерируется.

## Этап A — бэкенд

**A1. Размеры lottie-стикера.** `ffmpeg.Processor.Process` умеет только то, что
понимает ffprobe; `.tgs`/lottie-json остаётся с `width=height=0`. Добавить разбор
lottie-хедера (`w`, `h`) для `application/json` и gzip-`.tgs` — до 2 полей, без
рендера. Тест на реальном мини-json и на gzip.

**A2. Метаданные стикера наружу.** `domain.Sticker` += `Width`, `Height`, `Mime`,
`Thumb []byte` (это `media.blur_preview`). Источник — JOIN на `media` в
`stickersrepo` (все выборки: набор, recent, faved, поиск по эмодзи). HTTP отдаёт
`width`/`height`/`mime`/`thumb` (base64), как `media_handler` отдаёт `blur_preview`.

**A3.** Проверить, что пустые значения (старые media без прогона процессинга)
деградируют: `width=0` → фронт падает на квадрат, `thumb=nil` → нет слоя 1.

## Этап B — фронт

**B1.** `Sticker` в `core/managers/stickersManager.ts` += `width/height/mime/thumb`.

**B2.** Порт `helpers/saveLottiePreview.ts` + маленькое хранилище кэшированных
первых кадров (`core/stickers/stickerThumbs.ts`): `docId+tone → {url,w,h}`.
Упрощение против tweb: хранилище живёт на главном потоке (у tweb оно в воркере и
зеркалится), потому что у нас стикеры и так грузятся на главном потоке.

**B3.** Порт `components/wrappers/stickerAppearance.ts` 1:1 (контроллер слоёв).

**B4.** `StickerMedia` переводится на слои: stripped-thumb → cached-frame → медиа,
размер — `aspectFitted` от `w/h` стикера.

**B5.** Включить offscreen-рендер (снять `noOffscreen: true`) и кэш кадров.

**B6.** Тесты: маппинг метаданных, контроллер слоёв (порядок и то, что нижний слой
снимается только после `ensurePresented`), сохранение первого кадра.

## Критерий готовности этапа

- `go build ./...`, `go vet`, `gofmt -l` чисто; `go test ./internal/...` зелёный.
- `npm run typecheck`, `npm run lint`, `npm test` зелёные.
- Мутация проводки краснит тест (норма из `web-client/CLAUDE.md`).
