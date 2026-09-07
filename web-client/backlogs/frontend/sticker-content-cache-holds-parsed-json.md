# Кэш стикеров держит РАЗОБРАННЫЙ lottie-JSON и разбирает его на главном потоке

**Статус:** открыт, долг назван (не закрыт кодом).
**Дата фиксации:** ревью ветки `fix/reaction-effect-latency` (PR #240), 2026-09-06.
**Файл:** `web-client/src/components/wrappers/stickerContent.ts`
(дубль того же кода и второй, независимый кэш — `components/StickerMedia.tsx`).
**Кто это выявил:** предзагрузка ассетов реакций
(`components/chat/reactions.ts::preloadReactionAssets`, порт
`AppReactionsManager.after`, tweb `lib/appManagers/appReactionsManager.ts:88-115`)
— она стала первым потребителем, который зовёт кэш ПАКЕТОМ и заранее.

## Что именно держим

`loadStickerContent` (`stickerContent.ts:75-104`) кэширует по `mediaId`
**итог разбора**, а не байты:

```ts
const cache = new Map<number, Promise<StickerContent>>()
// StickerContent = { kind: 'lottie'; data: unknown } | { kind: 'image'|'video'; url: string }
if (isLottieMime(ct)) return { kind: 'lottie', data: await readLottie(res) }
```

`readLottie` (`core/stickers/tgs.ts:12-17`) снимает gzip
(`DecompressionStream('gzip')`) и делает `Response.json()`. Оба шага — **на
главном потоке**, в том же таске, что и всё остальное приложение.

Вытеснения у `cache` нет ни по числу записей, ни по размеру, ни по времени:
запись живёт до перезагрузки страницы (`resetStickerContentCache` — только для
тестов, `stickerContent.ts:106-109`).

## Сколько это в памяти на семи реакциях

Предзагрузка качает первые 7 реакций каталога × 4 роли
(`around`, `static`, `appear`, `center`) = **28 файлов**. Замер по нашим же
ассетам (`backend/assets/reactions/reactions.json`, первые семь: `2764`,
`1f44d`, `1f44e`, `1f525`, `1f970`, `1f44f`, `1f601`):

| | байт |
|---|---|
| на проводе (как лежит, `.tgs` = gzip) | **439 975** (≈430 КБ) |
| после gunzip — текст JSON | **3 427 466** (≈3.3 МБ) |
| в памяти JS — граф объектов из этого текста | ориентировочно **10–20 МБ** (обычные для JSON 3–6× от текста) |

`static.webp` (7 файлов, 12 КБ суммарно) уходит в `URL.createObjectURL` — это
как раз то, что делает и оригинал, вопросов нет. Проблема ровно в 21 lottie:
3.3 МБ текста разбираются на главном потоке и остаются графом объектов навсегда.

Это только предзагрузка реакций. Тот же кэш наполняет и каждый стикер ленты
(`wrappers/sticker.ts:361`), у которого вытеснения тоже нет, — цифра выше это
пол, а не потолок.

## Что делает оригинал

Прогрев tweb — `apiFileManager.downloadMediaURL`
(`lib/appManagers/apiFileManager.ts:1029-1045`), зовётся из
`appReactionsManager.ts:107`. Он:

1. работает **в шаред-воркере** (это метод менеджера), то есть главного потока
   не касается вовсе;
2. держит **`Blob` + objectURL** (`URL.createObjectURL(blob)`, :1038-1040) и
   отметку в `cacheContext` — байты, а не разобранное дерево;
3. gunzip и `JSON.parse` у него делает **lottie-воркер** в момент показа
   (`lottieLoader.loadAnimationWorker`, `lib/lottie/lottieLoader.ts:222`), и
   разобранное дерево живёт внутри воркера вместе с плеером, а не в модульной
   карте таба.

То есть предзагрузка оригинала стоит сети и дискового кэша — и нисколько не
стоит ни главного потока, ни памяти таба.

## Почему не чинится в ветке `fix/reaction-effect-latency`

Это не свойство предзагрузки, а свойство **общего механизма кэша стикеров**:
`StickerContent` с разобранным `data` — публичный контракт `stickerContent.ts`,
на нём стоит весь `wrappers/sticker.ts` (`loadLottie(content.data)`, :366) и
`bubbles.stickers.test.ts`/`sticker.test.ts`. Чинить пришлось бы:

1. Перевести кэш на байты: хранить `ArrayBuffer`/`Blob`, а gunzip+parse делать
   на выдаче (или вовсе отдавать байты в tlottie-воркер, как оригинал).
2. Пересмотреть `hasStickerContent`/`getStickerContentKind`
   (`stickerContent.ts:47-62`): сейчас `kind` известен только после разбора, а
   в новой схеме — сразу после чтения `Content-Type`.
3. Завести вытеснение (у оригинала его роль играет cacheStorage + LRU
   браузера); сейчас его нет ни у одного из двух наших кэшей.
4. Снять дубль в `components/StickerMedia.tsx` (свой второй кэш того же вида) —
   он и так помечен как временный в шапке `stickerContent.ts`.

Ни один из четырёх пунктов не про задержку эффекта реакции, и любой из них
трогает ленту целиком. Поэтому — долг.

## Критерий готовности

1. `preloadReactionAssets` на семи реакциях не удерживает в памяти таба
   разобранного lottie: retained size модульного кэша после предзагрузки —
   порядка провода (≈430 КБ), а не разобранного дерева.
2. Профиль главного потока во время предзагрузки не содержит ни gunzip'а, ни
   `JSON.parse` ассетов реакций.
3. Кэш ограничен сверху: показ длинной ленты стикеров не растит его
   безгранично.
