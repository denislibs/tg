# Медиа-подсистема tweb: структурный референс

Снято 2026-08-16. Источники:

- исходники tweb `/Users/denisurevic/Documents/tweb` (форк, номера строк — по нему);
- наш код `web-client/` на `main`.

Документ — референс для порта медиа-модели 1:1 (решение: SW+cacheStorage → stripped-превью →
медиавьювер 1:1 → аватарки без блюра). Разделы:

1. Карта файлов.
2. Wrappers (`src/components/wrappers/*`).
3. Превью-пайплайн (stripped → cached → full, ProgressivePreloader, lazyLoadQueue).
4. Загрузка/скачивание (appDownloadManager, apiFileManager, upload).
5. Кэширование (cacheStorage, Service Worker: /stream/, /download/).
6. Видео (автоплей, GIF, round, стриминг).
7. Аудио (appMediaPlaybackController, плашка-плеер).
8. Медиавьювер (appMediaViewer*).
9. Стикеры/анимации (кратко — у нас уже есть tlottie-порт).
10. «У нас»: текущее состояние web-client и расхождения.

---

# 1. Карта файлов (верхний уровень)

| Путь | Роль |
|---|---|
| `src/components/wrappers/photo.ts` / `video.ts` / `sticker.ts` / `document.ts` | сборка DOM медиа для бабла/сеток/вьювера |
| `src/components/audio.ts` | `AudioElement` — voice/music сообщение |
| `src/components/preloader.ts` | `ProgressivePreloader` — кружок прогресса/отмены |
| `src/components/lazyLoadQueue*.ts` | ленивые очереди загрузки (IntersectionObserver) |
| `src/components/appMediaPlaybackController.ts` | глобальный аудио/видео-плеер (очередь, MediaSession) |
| `src/components/chat/audio.ts` + `chat/pinnedContainer.ts` | верхняя плашка-плеер над чатом |
| `src/components/appMediaViewerBase.ts` / `appMediaViewer.ts` / `appMediaViewerAvatar.ts` | медиавьювер |
| `src/lib/appDownloadManager.ts` | фасад загрузок/аплоадов для UI-потока |
| `src/lib/appManagers/apiFileManager.ts` | воркер: очереди по DC, чанки, кэш, upload |
| `src/lib/storages/thumbs.ts` | `ThumbsStorage` — cacheContext (url/downloaded по size type) |
| `src/lib/files/cacheStorage.ts` | `CacheStorageController` поверх Cache API |
| `src/lib/files/downloadStorage.ts`, `memoryWriter.ts`, `streamWriter.ts`, `fileStorage.ts` | writers для скачивания |
| `src/lib/serviceWorker/index.service.ts` | SW: роутер fetch-перехватов |
| `src/lib/serviceWorker/stream.ts` | 206-стриминг `/stream/` |
| `src/lib/serviceWorker/download.ts` | стрим-скачивание на диск `/download/` (`d/`) |
| `src/helpers/fileName.ts` | имена файлов кэша + `getFileURL` |
| `src/helpers/dom/createVideo.ts`, `src/helpers/onMediaLoad.ts` | обвязка `<video>` |
| `src/lib/lottie/*` | rlottie-воркеры |
| `src/components/animationIntersector.ts` | пауза анимаций вне вьюпорта |

# 2. Wrappers

`src/components/wrappers/` — 49 файлов, слой «данные MTProto → DOM». Wrapper'ы не знают об экране:
одни и те же функции работают в баблах, shared media, чатлисте, реплаях, попапах и Solid-компонентах.
Общий тип опций — `global.d.ts:300-307`:
`WrapSomethingOptions = {lazyLoadQueue?, middleware?, customEmojiSize?, textColor?, animationGroup?, managers?}`.

| Файл | Экспорт | Назначение |
|---|---|---|
| `photo.ts` (359) | `wrapPhoto` | фото / image-документ / webDocument → `<img>`/`<video>` + thumb |
| `video.ts` (952) | `wrapVideo`, `USE_VIDEO_OBSERVER` | видео / gif / круглое видео |
| `sticker.ts` (880) | `wrapSticker`, `fireStickerEffect`, `StickerTsx`, `videosCache`, `STICKER_EFFECT_MULTIPLIER` | статик/lottie/webm стикеры и кастом-эмодзи |
| `document.ts` (443) | `wrapDocument` | строка файла + делегирование в `AudioElement` |
| `album.ts` (155) | `wrapAlbum` | сетка grouped-медиа |
| `groupedDocuments.ts` (158) | `wrapGroupedDocuments` | список документов одного альбома |
| `mediaSpoiler.ts` (204) | `wrapMediaSpoiler`, `toggleMediaSpoiler`, `onMediaSpoilerClick`, `hasSensitiveSpoiler` | спойлер поверх медиа |
| `webPage.tsx` (152) | `WebPageBox` (Solid) | вёрстка блока превью веб-страницы |
| `reply.ts` (74) | `wrapReply` | контейнер реплая/пина |
| `messageForReply.ts` (452) | `wrapMessageForReply` | текстовое саммари сообщения (реплай/чатлист/нотификации) |
| `stickerSetThumb.ts` (112) | `wrapStickerSetThumb` | превью стикерпака |
| `localSticker.ts` (66) | `wrapLocalSticker` | локальный lottie-ассет или анимированный эмодзи |
| `emojiPattern.ts` (91) | `wrapEmojiPattern` | canvas-паттерн из custom emoji |
| `stickerAnimation.ts` / `stickerAppearance.ts` | `wrapStickerAnimation` / `createStickerAppearance` | премиум-эффекты и слоение thumb→media |
| `photoTsx/videoTsx/documentTsx/mediaTsx` | Solid-обёртки | `createResource` поверх тех же функций (`mediaTsx.tsx:11-51`) |

## 2.1 `wrapPhoto` (`photo.ts:25-52`)

Ключевые опции: `photo`, `message` (нужен `setAttachmentSize` и `uploadingFileName`), `container`
(без него принудительно `withoutPreloader`), `boxWidth/boxHeight`, `size` (при нём бокс игнорируется),
`withTail`, `isOut`, `lazyLoadQueue`, `middleware`, `withoutPreloader`, `loadPromises`,
`autoDownloadSize` (`0` ⇒ `onlyCache` + ручной preloader), `noBlur`/`useBlur`, `noThumb`, `noFadeIn`,
`blurAfter` (заблюрить уже загруженное: `blur(url, 10, 2, 48)` → `canvas.toDataURL()`), `processUrl`,
`fadeInElement`, `onRender/onRenderFinish`, `useRenderCache`, `canHaveVideoPlayer`, `uploadingFileName`.

Возврат (`:53-64`): `{loadPromises: {thumb, full}, images: {thumb, full}, preloader, aspecter}`.

**Выбор размера.** Есть бокс и нет явного `size` → `setAttachmentSize({...})` → `{photoSize, size, isFit}`
(`helpers/setAttachmentSize.ts:14-107`); иначе `choosePhotoSize(photo, boxWidth, boxHeight, useBytes: true)`
(`utils/photos/choosePhotoSize.ts:7-60` — удваивает бокс при `devicePixelRatio > 1`).
`isFit === false`, когда бокс расширен до `EXPAND_TEXT_WIDTH` (есть текст/реплай/webpage/комментарии)
либо до `MIN_IMAGE_WIDTH`/`MIN_VIDEO_SIDE_SIZE`.

**Aspecter — единственный случай двухуровневого DOM** (только при `isFit === false`):

```
div.media-container.media-container-fitted   ← container, размер = расширенный бокс
├── img|canvas.media-photo.thumbnail         ← фон: stripped-thumb (blur) либо
│                                              рекурсивный wrapPhoto(blurAfter: true)
└── div.media-container-aspecter              ← aspecter, реальные пропорции
    ├── img|canvas.media-photo                ← thumb
    └── img|video.media-photo                 ← full media
```

При `isFit === true` `aspecter === container`. Код, ищущий `.media-photo` прямым потомком контейнера,
ломается на ветке с aspecter.

**Загрузка** (`:330-339`): скачано → `load()` сразу; нет очереди → `load()`; иначе
`lazyLoadQueue.push({div: container, load})`. Preloader не вешается на превью меньше 150×150
(`canAttachPreloader`, `:297-301`).

## 2.2 `wrapVideo` (`video.ts:80-113`)

Константы: `MAX_VIDEO_AUTOPLAY_SIZE = 50 MB` (`:50`), `USE_VIDEO_OBSERVER = false` (`:51`).
`middleware` — обязательная. Особые опции: `altDoc` (H.265/AVC — подменяет `doc` без стриминга при
`!IS_H265_SUPPORTED`), `noInfo`, `noPlayButton`, `group`, `onlyPreview`, `noPreview`, `withPreview`,
`autoDownload`, `photoSize`, `videoSize`, `searchContext`, `noAutoplayAttribute`, `ignoreStreaming`,
`canAutoplay`, `observer`, `setShowControlsOn`, `uploadingFileName`, `onGlobalMedia`, `onLoad`.

Автоплей (`:129-136`):
`canAutoplay ??= (doc.type !== 'video' || (doc.size <= 50MB && !isGroupedItem)) && liteMode.isAvailable(gif ? 'gif' : 'video')`,
где `isGroupedItem = !(boxWidth && boxHeight)`.

Пять режимов:

1. `mime_type === 'image/gif'` (`:185-208`) — целиком делегирует в `wrapPhoto`.
2. **Круглое видео** (`:220-405`): `div.media-round` + `canvas.video-round-canvas` + `svg.progress-ring` + `video`. Воспроизведение идёт **не в этом `<video>`**, а в глобальном элементе `appMediaPlaybackController.addMedia({message})` (`:265`); кадры рисуются вручную `ctx.drawImage` (`:281`), прогресс — `strokeDashoffset` кольца.
3. Постер через `wrapPhoto` (`:410-453`), всегда `withoutPreloader: true`; при `(!canAutoplay && type !== 'gif') || onlyPreview` — ранний возврат.
4. Gifs masonry без `message` (`:454-480`) — только stripped-thumb `media-poster`, без aspecter.
5. GIF без автоплея (`:708-713`) — клик по контейнеру (`once`) убирает `.video-play` и запускает `load()`.

Обратный отсчёт длительности — `timeupdate` → `toHHMMSS(duration - currentTime)` (`:550-563`);
кнопка play удаляется на первом `timeupdate`. Вставка `<video>` в DOM отложена до готовности постера
(`appendVideo()` → `photoRes?.aspecter || container`).

## 2.3 `wrapSticker` (`sticker.ts:65-107`)

Возврат `{render, load, width, height, downloaded}`. Тип берётся из `doc.sticker ?? StickerType.Static`.

| Тип | Условие | Рендер |
|---|---|---|
| Static | `Static`, либо `WebM && !IS_WEBM_SUPPORTED`, либо `static: true` ⇒ `asStatic` | `new Image()` + `renderImageFromUrlPromise` |
| Lottie | `Lottie && !asStatic` | `downloadMedia` → `lottieLoader.loadAnimationWorker({...toneIndex, sync, group, liteModeKey, textColor, noOffscreen, compositorDelivery})` |
| WebM | `WebM && !asStatic` | `createVideo({middleware})`, числовой `loop` эмулируется счётчиком `timeupdate` |

Размеры при отсутствии `width/height`: бокс `mediaSizes.active.emojiSticker` / `animatedSticker` /
`staticSticker` → `makeMediaSize(doc.w, doc.h).aspectFitted(box)`.
`loop = !!(!emoji || isCustomEmoji) && loop`; при `!liteMode.isAvailable(liteModeKey)` (по умолчанию
`'stickers_panel'`) `play = loop = false`.

**Цепочка thumb'ов** (`:247-406`), владелец — `createStickerAppearance` (`stickerAppearance.ts:29`):
кешированный lottie-превью → `photoPathSize` (SVG-силуэт) → `photoStrippedSize` (+конвертация WebP
через `webpWorkerController`) → скачивание thumb'а. `onlyThumb: true` — ранний возврат.

Особенности: `exportLoad` отдаёт `load` наружу; премиум-эффект по клику
(`fireStickerEffect` → `wrapStickerAnimation`, `STICKER_EFFECT_MULTIPLIER = 1.49`);
`withLock` → `.is-premium-sticker` + `--lock-url`; `syncedVideo`/`videosCache` — один `<video>`
на все контейнеры дока; **единственный wrapper, принимающий массив контейнеров** (`toArray`, `:109`).

DOM: `div.media-sticker-wrapper[data-doc-id]` > (`span.premium-sticker-lock`) +
`svg|img[data-sticker-thumb]` + `canvas|img.media-sticker|video.media-sticker`.

## 2.4 `wrapDocument` (`document.ts:49-108`)

`doc.type ∈ {audio, voice, round}` → `new AudioElement()` (см. §7.6). Иначе строка документа:

```
div.document.ext-<ext>[data-doc-id][.document-with-thumb][.downloading][.downloaded]
├── div.document-ico  (span.document-ico-text | img|canvas.document-thumb ← wrapPhoto 54×54)
├── div.document-download        ← только если не скачано, есть mid и thumb
├── div.document-name > middle-ellipsis-element
└── div.document-size > span     ← formatBytes · дата · отправитель
```

`load()` (`:341-396`) **намеренно не async** (Safari блокирует отложенное скачивание). Ветвление:
недоверенный клик → `downloadToDisc`; `.md` → `readBlobAsText` + `openMarkdownInstantView`;
поддерживаемый media-mime + thumbs + `size <= MAX_FILE_SAVE_SIZE` → `downloadMediaURL` (в кеш);
иначе `downloadToDisc` (для IP-revealing расширений — `confirmationPopup('Chat.File.QuickLook.Svg')`).

## 2.5 Остальные wrappers

| Wrapper | Что делает |
|---|---|
| `wrapAlbum` (`album.ts:17-34`) | размеры (`choosePhotoSize(media, 480, 480)`), раскладка `prepareAlbum({maxWidth: mediaSizes.active.album.width, minWidth: 100, spacing: 1, forMedia: true})`, затем `wrapPhoto`/`wrapVideo` с `boxWidth: 0, boxHeight: 0`; спойлеры в процентах ячейки |
| `wrapGroupedDocuments` | оборачивает каждый `wrapDocument` в `div.document-container[.is-first][.is-last].grouped-item`, вешает на бабл `is-multiple-documents is-grouped` |
| `wrapMediaSpoiler` (`:166-171`) | `div.media-spoiler-container` > `img.media-spoiler-thumbnail` + `canvas.canvas-dots`; `sensitive` → `.sensitive-content-warning` + `Icon('eyecross_outline')`; раскрытие `revealWithAnimation` |
| `WebPageBox` (`webPage.tsx:93-102`) | `a\|div.webpage.quote-like` > `.webpage-quote.quote-like-border` > `.webpage-content` с `.webpage-name/-title/-text/-preview-resizer/-footer` |
| `wrapReply` (`reply.ts:29-73`) | `ReplyContainer('reply')` + `quote-like quote-like-hoverable quote-like-border`, при `isQuote` — `quote-like-icon reply-multiline`, цвет пира `setPeerColorToElement` |
| `wrapMessageForReply` | `plain: true` → `string`, иначе `DocumentFragment` (условный тип возврата) |
| `wrapStickerSetThumb` | есть `thumbs` → ленивая загрузка lottie/`<img>`/`<video>`; иначе `thumb_document_id` → `wrapSticker` |
| `wrapLocalSticker` | локальный ассет (`loadAnimationAsAsset` + `waitForFirstFrame`) либо `getAnimatedEmojiSticker` → `wrapSticker` |
| `wrapEmojiPattern` | `wrapSticker({static: true, exportLoad: 2})` → один `<img>` → многократный `drawImage` по `positions [x,y,size,alpha]` в `canvas.emoji-pattern-canvas` с DPR → `applyColorOnContext` |

## 2.6 Rich text — `lib/richTextProcessor/wrapRichText.ts:122`

Возвращает `DocumentFragment`. Опции (`:36-70`): `entities`, `contextSite`, `highlightUsername`,
`noLinks`, `noLinebreaks`, `wrappingDraft`, `noTextFormat`, `passEntities`, `maxMediaTimestamp`,
`isSelectable`, `whitelistedDomains`, `contextHashtag`, `customEmojis`, `doubleLinebreak`, `textColor`
(`nasty` — внутреннее рекурсивное состояние, снаружи не передавать).

Обрабатываемые entity: форматирование (`Bold :215`, `Italic :227`, `Strike :239`, `Underline :253`,
`Pre/Code :267`, `Blockquote :794` со схлопыванием через `makeQuoteCollapsable` + `ResizeObserver`),
ссылки (`Url/TextUrl :544`, `Email :617`, `Hashtag :627`, `MentionName :644`, `Mention :655`,
`Phone :368`, `BotCommand :377`), спец (`CustomEmoji :400`, `Emoji :465`, `Spoiler :669`,
`Timestamp :716`, `Caret :515`, `Linebreak :521`) и локальные diff-сущности (`:824-834`).
Custom emoji складываются в `options.customEmojis`, а рендерит их `CustomEmojiRenderer`
(`lib/customEmoji/renderer.ts:711` → `wrapSticker`).

## 2.7 Кто вызывает (сводно)

- **`wrapPhoto`** — баблы (`bubbles.ts:7910, 8220, 8446, 8975`), альбом, `wrapVideo` (постер и gif), `wrapDocument` (54×54), `audio.ts:643` (обложка 48×48), shared media (`appSearchSuper.ts:898, 1023`), чатлист (`appDialogsManager.ts:2116`), реплай, инлайн-боты, гео, аватары, профиль, сторис, попапы.
- **`wrapVideo`** — баблы (`:8103, 8409, 8549, 8956`), альбом, shared media (`onlyPreview`), реплай, GIF-панель, `stickerViewer`, сторис, `newMedia`, premium-карусель.
- **`wrapSticker`** — 44 вызова: баблы, реакции (`reaction.ts`, `reactionsMenu.ts`), производные wrappers, `customEmoji/renderer.ts:711`, панель эмодзи (`SuperStickerRenderer`), профиль, вьюверы, попапы, медиаредактор.
- **`wrapDocument`** — баблы, `groupedDocuments`, shared media (Files/Voice/Music), round-бабл, savedMusic, `newMedia`.

**Медиавьювер wrappers не использует**: `mediaViewer/*` собирает загрузку сам поверх тех же хелперов
(`setAttachmentSize`, `getMediaThumbIfNeeded`, `createVideo`, `renderImageFromUrl`, `onMediaLoad`).
Правки в `wrapPhoto`/`wrapVideo` его не затрагивают.

# 3. Превью-пайплайн

<!-- SECTION:THUMBS -->

## 3.1 Stripped thumb: из inline-байтов в JPEG

### Источник данных

`PhotoSize.photoStrippedSize` (`src/layer.d.ts:2054-2060`): `{_, type, bytes: Uint8Array, w?, h?}`.
Байты приходят внутри `photo.sizes` / `document.thumbs` (без отдельной загрузки), для аватаров —
`userProfilePhoto.stripped_thumb` (`src/components/avatarNew.tsx:574-577`).

### Разворачивание в валидный JPEG — `src/helpers/bytes/getPreviewURLFromBytes.ts`

| Что | Где | Значение |
|---|---|---|
| `JPEG_HEADER_HEX` | `:6` | hex-строка: SOI + APP0/JFIF + два DQT + SOF0 + два DHT + SOS (~0x286 байт) |
| `JPEG_TAIL` | `:9` | `ffd9` (EOI) |
| Сборка | `:36-44` | см. ниже |
| MIME | `:46-51` | `image/jpeg`; для стикеров `image/webp` (Safari — `image/png`) |
| Выход | `:53-54` | `bytesToDataURL(arr, mime)` — data:URL |

```
if(!isSticker && bytes[0] === 0x1):          // маркер telegram-stripped
  arr = JPEG_HEADER ++ bytes.slice(3) ++ JPEG_TAIL
  arr[164] = bytes[1]                        // height → SOF0
  arr[166] = bytes[2]                        // width  → SOF0
else:
  arr = bytes                                // готовый webp/png (стикер)
return `data:${mime};base64,...`
```

Первые 3 байта stripped — `[0x01, h, w]`: telegram шлёт только entropy-coded данные, таблицы
квантования/Хаффмана — из фиксированного заголовка. Обратная операция (при отправке) —
`getPreviewBytesFromURL` (`:11-34`, вызов `popups/newMedia.ts:42`). Обёртка
`getPreviewURLFromThumb` (`src/helpers/getPreviewURLFromThumb.ts:7-11`).

### Блюр: canvas, не CSS — `src/helpers/blur.ts`

| Параметр | Строка | Значение |
|---|---|---|
| `RADIUS` / `ITERATIONS` | `:5-6` | `2` / `2` |
| Реализация | `:10-16` | `IS_CANVAS_FILTER_SUPPORTED` → нативный `ctx.filter`; иначе `import('../vendor/fastBlur')` |
| Класс канваса | `:65` | `canvas-thumbnail` |
| Кэш | `:52-62, 96-102` | `Map<dataUri, {canvas, promise}>`, `CACHE_SIZE = 150`, при переполнении — `clear()` |
| Планировщик | `:77-81` | `addHeavyTask(…, 'unshift')` (`helpers/heavyQueue.ts:15-25`: чанки по 6 мс + `getHeavyAnimationPromise`) |

Ядро `processBlurNext` (`:18-49`): при `IS_CANVAS_FILTER_SUPPORTED` — `ctx.filter = blur(2px)` +
overdraw `drawImage(img, -r*2, -r*2, w+r*4, h+r*4)` (без светлых краёв); иначе `fastBlurFunc`.
⚠️ В нашем форке `blur()` 4-арная (`blur(dataUri, radius, iterations, maxSize)`) — «frosted glass»
side-fill в `photo.ts:283-291` (`blur(url, 10, 2, 48)`), в апстриме этого нет.

### Классы и CSS

| Класс | Кто ставит | CSS |
|---|---|---|
| `thumbnail` | `getImageFromStrippedThumb.ts:24` | `_chatBubble.scss:694-696` — `position:absolute` |
| `canvas-thumbnail` | `blur.ts:65` | `base.scss:1244-1248` (100%×100%), `_chatBubble.scss:698-700` (`border-radius:inherit`) |
| `media-photo` | `wrappers/photo.ts:150,174,200,218,221` | `base.scss:1282-1294` — absolute, все стороны 0 |
| `media-container(-aspecter/-fitted)` | `photo.ts:102,136,178` | `_chatBubble.scss:864-882` |
| `no-background` | `renderMediaWithFadeIn.ts:43,49` | `background:none !important` |

В `media-container-fitted` (side-fill) `.thumbnail` держится на `opacity:.8` и появляется
кейфреймом `thumbnail-fade-in-opacity` 0→.8 (`_chatBubble.scss:871-881`, `base.scss:675-683`).

## 3.2 Иерархия превью: stripped → cached size → full

### `getMediaThumbIfNeeded` — `src/helpers/getStrippedThumbIfNeeded.ts:9-59`

Опции: `photo`, `cacheContext: ThumbCache`, `useBlur: boolean|number` (number = radius),
`ignoreCache`, `onlyStripped`. Алгоритм:

```
1. isVideo = type ∈ {video, gif}                                          // :22
2. cacheContext.downloaded && !isVideo && !ignoreCache → null             // :23 (full уже есть)
3. ранний null для document со скачанным нужным типом                     // :24-31
4. sizes = photo.sizes ?? document.thumbs; пусто → null                   // :33-37
5. !onlyStripped: обход sizes СПРАВА НАЛЕВО (крупные → мелкие)            // :40-50
     если у size есть скачанный cacheContext → вернуть его БЕЗ блюра
6. fallback: photoStrippedSize → getImageFromStrippedThumb(…, useBlur)    // :52-55
```

Итог: **скачанный промежуточный size (без блюра) → stripped (с блюром) → ничего**, поверх — full.

`getImageFromStrippedThumb` (`src/helpers/getImageFromStrippedThumb.ts:8-26`): `!useBlur` →
`new Image()` + `renderImageFromUrlPromise`; `useBlur` → `blur(url)` → canvas; обоим класс
`thumbnail`; возвращает `{image, loadPromise}`.

### `choosePhotoSize` — `src/lib/appManagers/utils/photos/choosePhotoSize.ts:7-60`

```
if(devicePixelRatio > 1) boxWidth *= 2, boxHeight *= 2            // :14-17
if(pushDocumentSize && не photo) sizes += {photoSize, THUMB_TYPE_FULL}  // :32-40
перебор слева направо: best = size; первый, чей calcImageInBox >= бокса — break  // :43-53
useBytes && ничего не нашли && sizes[0] stripped → вернуть stripped        // :55-57
```

Боксы телеграма — комментарий `:19-28` (`s 100, m 320, x 800, y 1280, w 2560`, кропы a/b/c/d).
Вызовы: `photo.ts:183` (useBytes), `setAttachmentSize.ts:45`, `appSearchSuper.ts:882` (200×200),
`replyContainer.ts:121`, `appDialogsManager.ts:2106` (20×20), `album.ts:43` (480×480), `document.ts:198` (54×54).

`setAttachmentSize` (`src/helpers/setAttachmentSize.ts:14-107`): выбирает size, применяет минимумы
`MIN_SIDE_SIZE=200`, `MIN_IMAGE_WIDTH=120`, `MIN_VIDEO_SIDE_SIZE=368`, `EXPAND_TEXT_WIDTH=320`
(`:9-12`, `:69-93`) и **сразу** ставит `element.style.width/height` (`:102-103`) — бабл не прыгает.

## 3.3 `ProgressivePreloader` — `src/components/preloader.ts`

### Опции конструктора (`:33-48`)

| Опция | Default | Эффект |
|---|---|---|
| `isUpload` | `false` | форсит `tryAgainOnFail=false` (`:45-47`); повторный `attachPromise` игнорируется (`:158`) |
| `cancelable` | `true` | SVG «крестик» + «стрелка вниз», клик (`:108-133`) |
| `streamable` | `false` | класс `preloader-streamable`, viewBox `25 25 50 50`, r=19 (`:96-105`) |
| `tryAgainOnFail` | `true` | при ошибке → режим manual вместо detach (`:191-198`) |
| `attachMethod` | `'append'` | `elem[attachMethod](preloader)` (`:242`); в баблах — `'prepend'` |

`TRANSITION_TIME = 200` (`:9`). `setManifest` НЕ существует — только `setProgress`/`attachPromise`.

### DOM (`:50-134`)

```
div.preloader-container
 ├ .you-spin-me-round
 │   └ svg.preloader-circular viewBox="27 27 54 54"
 │       └ circle.preloader-path-new cx=54 cy=54 r=24
 ├ svg.preloader-close     (cancelable)
 └ svg.preloader-download  (cancelable)
```

`totalLength` = 149.82 (обычный) / 118.61 (streamable) (`:103-105`). Не-cancelable → класс
`preloader-swing` (бесконечное вращение). CSS `_preloader.scss:98-192`: `--color:#fff`, подложка
`rgba(0,0,0,.3)`, `stroke-dasharray: 5,149.82`, stroke-width 2; `.manual .preloader-path-new
{stroke-width:0}`, `.manual` показывает download-иконку. В бабле `z-index:2`, прячет `.video-play`
(`_chatBubble.scss:838-886`).

### Жизненный цикл

| Метод | Стр. | Поведение |
|---|---|---|
| `attach(elem, reset?, promise?)` | 221–257 | ленивый `construct()`, `SetTransition('is-visible', 200мс)` |
| `attachPromise(promise)` | 157–219 | `tempId` против гонок; `addNotifyListener(({done,total}) => setProgress(done/total*100))` (`:208-218`) |
| успех | 176–189 | `setProgress(100)` → `detach()` (сразу или через 150 мс — дорисовать дугу) |
| ошибка | 190–199 | `tryAgainOnFail` → `attach` + `setManual()`; иначе `detach()` |
| `setProgress(p)` | 296–312 | `strokeDasharray = max(5, p/100*totalLength) + ',' + totalLength` |
| `setManual()` | 152–155 | класс `manual` + `setProgress(0)` — иконка download |
| `onClick` | 136–146 | manual → `loadFunc()` (докачать); иначе `promise.cancel()` |
| `setDownloadFunction` | 148–150 | сохраняет loadFunc (`photo.ts:326-328`) |

## 3.4 `lazyLoadQueue*` — иерархия

```
LazyLoadQueueBase                  (lazyLoadQueueBase.ts)
  └ LazyLoadQueueIntersector       (lazyLoadQueueIntersector.ts)
      ├ LazyLoadQueue              (lazyLoadQueue.ts)          ← основной
      ├ LazyLoadQueueRepeat        (повторная загрузка при возврате во вьюпорт)
      └ LazyLoadQueueRepeat2
VisibilityIntersector              (visibilityIntersector.ts)  ← обёртка IntersectionObserver
```

**Base** (`lazyLoadQueueBase.ts`): `PARALLEL_LIMIT = 8` (`:6`); `processQueue = throttle(_, 8ms)`
(`:26`); `lock()/unlock()` (`:39-61`); `getItem = queue.shift()`; `push/unshift` (`:131-137`) —
`unshift` = в голову очереди (используется вьювером для преднагрузки соседей: `base.ts:2895, 2981`).

**LazyLoadQueue** (`lazyLoadQueue.ts:7-68`): конструктор `(parallelLimit?, ignoreHeavyAnimation?)`;
при смене видимости элемент переставляется **перед первым невидимым** (`:20-37`); `getItem()` —
`findAndSplice(queue, item => item.wasSeen)` — **грузятся только уже показавшиеся** (`:39-41`);
после загрузки `unobserve` (`:43-46`); `setAllSeen()` (`:62-68`) — форс всей очереди.

**VisibilityIntersector** (`visibilityIntersector.ts:5-122`): дедуп по `Map<target, isIntersecting>`;
`lock`/`unlockAndRefresh`; `refresh()` = disconnect + re-observe.

### Кто создаёт очереди

| Владелец | Файл:строка | Параметры |
|---|---|---|
| Чат (баблы) | `chat/bubbles.ts:755-756` | `new LazyLoadQueue(undefined, true)` + свой `queueId` (`:301`) |
| Список диалогов | `appDialogsManager.ts:582` | `new LazyLoadQueue(5, true)` |
| Shared media | `appSearchSuper.ts:369` | `new LazyLoadQueue()` |
| Emoticons dropdown | `emoticonsDropdown/index.ts:96` | `new LazyLoadQueue(1)` |
| GIF-масонри | `gifsMasonry.ts:32-38` | `LazyLoadQueueRepeat2` (play/pause по видимости) |
| SuperStickerRenderer | `emoticonsDropdown/tabs/SuperStickerRenderer.ts:35-39` | `LazyLoadQueueRepeat` |
| Медиавьювер | `mediaViewer/base.ts:316` | `LazyLoadQueueBase()` — без IO |
| Нотификации / отправка | `uiNotificationsManager.ts:155` / `appMessagesManager.ts:554` | `Base(1)` / `Base(10)` |

### Заморозка на heavy animation и смена чата

1. Внутри очереди: `useHeavyAnimationCheck(lock, unlockAndRefresh)` (`lazyLoadQueue.ts:13-17`).
2. Чат управляет сам (`ignoreHeavyAnimation=true`): `bubbles.ts:1416-1428` lock/unlockAndRefresh.
3. Смена пира: lock (`bubbles.ts:5252`) → новый `queueId` + `apiFileManager.setQueueId`
   (`bubbles.ts:5203-5204`) → unlock после монтирования (`:5428`) → `setAllSeen()` после
   `pause(1000)+heavyAnimationPromise` (`:5952-5956`). `queueId` уходит в каждый downloadMediaURL
   (`photo.ts:254`, `video.ts:594`, `sticker.ts:423`, `document.ts:346-375`) — старый чат
   депрайоритизируется (см. §4.2 `downloadCheck`).

## 3.5 Полная последовательность: фото в бабле

```
bubbles.ts:7874-7920  div.attachment → wrapPhoto({photo, container, lazyLoadQueue, middleware,
                                                  loadPromises, autoDownloadSize})
photo.ts:102   'media-container'
photo.ts:115   setAttachmentSize → style.width/height СРАЗУ
photo.ts:132   cacheContext = apiManagerProxy.getCacheContext(photo, size.type)
photo.ts:190   getMediaThumbIfNeeded({useBlur: !noBlur}) → canvas.canvas-thumbnail  ← ПРЕВЬЮ ВИДНО
photo.ts:226   needFadeIn = (thumbImage || !downloaded) && liteMode('animations') && !noFadeIn
photo.ts:230   !downloaded → new ProgressivePreloader({attachMethod:'prepend'})
photo.ts:330-339  downloaded/без очереди → await load(); иначе lazyLoadQueue.push({div, load})
--- очередь дошла (только wasSeen) ---
photo.ts:302-317  load(): noAutoDownload → setManual;
                  promise = appDownloadManager.downloadMediaURL({media, thumb: size, queueId, onlyCache});
                  size.w/h >= 150 → preloader.attach(container, false, promise)   // photo.ts:297-301
photo.ts:276-293  onLoad(url) → renderMediaWithFadeIn
renderMediaWithFadeIn.ts:29-52:
   needFadeIn → media.classList.add('fade-in')
   renderImageFromUrlPromise(media, url)      // decode() ДО вставки в DOM
   sequentialDom.mutateElement → aspecter.append(media)
   animationend → remove('fade-in'), thumbImage.remove(), container.add('no-background')
```

Анимации: `.fade-in` → `fade-in-opacity .2s forwards` (`base.scss:685-691`, под
`animation-level(2)`); fitted-thumbnail → `thumbnail-fade-in-opacity` 0→.8. `loadThumbPromise`
кладётся в `loadPromises` бабла (`photo.ts:341-343`) — чат ждёт превью перед вставкой бабла в DOM.

## 3.6 Хелперы

**`renderImageFromUrl`** (`src/helpers/dom/renderImageFromUrl.ts`): глобальный кэш `loadedURLs`
(`:5`); `set()` — img/video → `.src`, SVGImage → `href`, иначе `backgroundImage` (`:6-10`);
медленный путь — `loader.decoding='async'; loader.src=url; return loader.decode().then(...)`
(`:48-95`) — **декод до вставки**, поэтому нет мигания; ошибки `cannot be decoded` глушатся (`:78-84`).

**`sequentialDom`** (`src/helpers/sequentialDom.ts:6-73`): батчинг read/write через один `fastRaf`
(`measure`/`mutate`/`mutateElement`; вне DOM — синхронно).

## 3.7 Сводка «кто применяет stripped thumb»

| Место | Файл:строка | Режим |
|---|---|---|
| Фото/видео в бабле | `photo.ts:140,190`; `video.ts:455-459` | блюр включён |
| Grid shared media | `appSearchSuper.ts:898-909` | `noBlur: true`, без прелоадера |
| Аватары | `avatarNew.tsx:574-589` | `getPreviewURLFromBytes(stripped_thumb)` напрямую, **без блюра** |
| Стикеры | `sticker.ts:332, 379` | `isSticker=true` (webp/png), конверт для не-WEBP браузеров (`:342-353`) |
| Спойлер медиа | `mediaSpoiler.ts:174-180` | всегда blur + dots-канвас поверх |
| Медиавьювер | `mediaViewer/base.ts:43` | превью под мовером |
| Side-fill | `photo.ts:283-291` | `blur(url, 10, 2, 48)` (форк-специфика) |

# 4. Загрузка/скачивание

## 4.1 `AppDownloadManager` — `src/lib/appDownloadManager.ts` (фасад в UI-потоке)

Ключевые типы (стр. 30–39):

```ts
export type DownloadBlob = CancellablePromise<Blob>;
export type DownloadUrl  = CancellablePromise<string>;
export type Progress = {done: number, fileName: string, total: number, offset: number};
type DownloadType = 'url' | 'blob' | 'void' | 'disc';
```

Реестр — `downloads: {[fileName]: {main} & {[type]?: Download}}` (стр. 42): на один файл может
одновременно висеть blob-загрузка и «на диск», у них общий `main` (шарят `cancel`/`notifyAll`, стр. 97–107).

| Метод | Стр. | Поведение |
|---|---|---|
| `construct(managers)` | 51–65 | подписка на `rootScope 'download_progress'` → `download.main.notifyAll(details)` — так прогресс доезжает до всех `ProgressivePreloader.attach` |
| `getNewDeferred(fileName, type)` | 67–117 | `deferredPromise` + `cancel = () => apiFileManager.cancelDownload(fileName)`; на reject — `clearDownload` |
| `download(options)` | 187–194 | по «сырой» локации (без file_reference!) — иначе throw «use downloadMedia instead» |
| `downloadMedia(options, type)` | 196–220 | диспетчер: `'url'→downloadMediaURL`, `'void'→downloadMediaVoid`, иначе `downloadMedia` (всё — прокси-вызовы менеджера в воркере) |
| `downloadMediaURL(options)` | 222–224 | главный путь «URL для DOM» |
| `upload(file, fileName?)` | 230–241 | `apiFileManager.upload({file, fileName})`, deferred с прогрессом |
| `getUpload(fileName)` | 153–163 | deferred текущего аплоада (для прелоадеров баблов) |
| `downloadToDisc(options, justAttach?)` | 257–384 | см. 4.4 |

## 4.2 `ApiFileManager` — `src/lib/appManagers/apiFileManager.ts` (воркер)

Константы (стр. 87–95): `MAX_DOWNLOAD_FILE_PART_SIZE = 1 MiB`, `MAX_UPLOAD_FILE_PART_SIZE = 512 KiB`,
`MIN_PART_SIZE = 64 KiB`, `AVG_PART_SIZE = 512 KiB`; лимиты одновременности в «дельтах» по 64 KiB:
`REGULAR_DOWNLOAD_DELTA = (9*512KiB)/64KiB = 72`, `PREMIUM_DOWNLOAD_DELTA = (56*512KiB)/64KiB = 448`.

**Очередь по DC** — `downloadPulls[dcId]` (стр. 154–167), элемент `{id, queueId, cb, deferred, activeDelta, priority}`:

- `downloadRequest({dcId, id, cb, activeDelta, queueId, priority})` (стр. 233–265) —
  вставка `insertInDescendSortedArray(pull, el, 'priority')` + `downloadCheck(dcId)`;
- `downloadCheck(dcId)` (стр. 267–304): пока `downloadActives[dcId] < downloadLimit`
  (72 или 448 «дельт»), берётся элемент: сначала с `priority`, затем `queueId === 0`,
  затем `queueId === this.queueId` (текущий чат — `setQueueId`, стр. 306–309), затем FIFO (стр. 277).
  `activeDelta = limit/64KiB` — большие чанки «весят» больше;
- итого: реальная параллельность ≈ 4.5 МБ (обычный) / 28 МБ (премиум) в полёте на DC.

**Часть файла** — `requestFilePart` (стр. 434–479): `upload.getFile {location, offset, limit}` через
`invokeApiWithReference` (стр. 566–619) — при `FILE_REFERENCE_EXPIRED/INVALID` рефреш
`referencesStorage.refreshReference` c дедупликацией по hex (стр. 621–645) и повтор.

**Выбор размера чанка** — `getLimitPart(size, isUpload)` (стр. 489–509): начиная с 64 KiB удваивается,
пока частей больше `maxParts` (из appConfig: `upload_max_fileparts_*`, стр. 201–204; по умолчанию 4000/8000).

**Конвертации при получении** — `getConvertMethod` (стр. 659–676):
`application/x-tgsticker` → gzipUncompress → `application/json` (лимит 8 MiB, стр. 91);
`image/webp` → PNG (если браузер не умеет webp); `application/x-tgwallpattern` → svg;
`audio/ogg` → wav (если нет opus).

### `download(options)` — ядро (стр. 686–996)

1. `fileName = getDownloadFileNameFromOptions` → `getFileNameByLocation`
   (`src/helpers/fileName.ts:6-63`): `photo_{id}_{thumb_size}`, `document_{id}_{thumb_size}`,
   `peerPhoto_{photo_id}_big|small`, `stickerSetThumb_{id}_{version}`, `webFile_{url}`…
   `+ '_download'` при downloadId.
2. Дедупликация: `downloadPromises[fileName]` (стр. 705–711).
3. Готовятся writer'ы: `cacheStorage.prepareWriting` (→ `MemoryWriter`, пишет blob в Cache API по
   завершении) и/или `downloadStorage.prepareWriting` (при `downloadId` — стрим в SW, см. 5.4)
   (стр. 787–820). В cacheStorage не пишутся файлы > `MAX_FILE_SAVE_SIZE = 20 MiB`
   (`appManagers/constants.ts:18`, проверка стр. 787, 967).
4. Сначала `getFile(cacheFileName)` из Cache API — попадание = мгновенный resolve (стр. 828–854).
5. Промах → параллельный цикл `superpuper()` (стр. 888–986): полные `size/limitPart` итераций
   стартуют сразу (стр. 984–986), но реальная конкуренция ограничена `downloadCheck`;
   запись чанков строго по порядку через цепочку `_writePromise` (стр. 886–896, 934–940).
6. Прогресс: `rootScope.dispatchEvent('download_progress', {done, total, offset, fileName})`,
   троттлинг 50 мс (стр. 874–883).
7. Отмена: `cancelDownload(fileName)` (стр. 315–327) реджектит deferred → `checkCancel()` бросает
   внутри цикла; `cancelDownloadByReference` (стр. 329–336) — для удалённых сообщений.

### `downloadMedia` / `downloadMediaURL` (стр. 998–1045)

```
downloadMedia({media, thumb, queueId, onlyCache, downloadId})
  → media заменяется на оригинал из appDocsManager/appPhotosManager (file_reference!) (1006-1010)
  → getDownloadMediaDetails → downloadOptions (dcId, location, size, mimeType, limitPart) + fileName
  → download(downloadOptions)
  → для документа без thumb: события 'document_downloading' / 'document_downloaded' (1018-1023)

downloadMediaURL (1029-1045):
  cacheContext = thumbsStorage.getCacheContext(media, thumb?.type)
  если downloaded >= thumb.size и url есть → вернуть url сразу
  иначе downloadMedia → blob → URL.createObjectURL → thumbsStorage.setCacheContextURL(media, type, url, size)
```

## 4.3 `ThumbsStorage` — `src/lib/storages/thumbs.ts` (единый реестр URL)

```ts
export type ThumbCache  = {downloaded: number, url: string, type: string};   // стр. 12-16
export type ThumbsCache = {[key: string]: {[size: string]: ThumbCache}};     // key = photo_{id} | document_{id} | ...
```

- `getCacheContext(media, thumbSize = THUMB_TYPE_FULL)` (стр. 41–52) — ленивая инициализация пустышкой;
- `setCacheContextURL(media, thumbSize, url, downloaded)` (стр. 88–100);
- каждый апдейт **зеркалится во все потоки** через `MTProtoMessagePort.invokeVoid('mirror', {name:'thumbs', ...})`
  (стр. 54–62; UI-поток читает зеркало через `apiManagerProxy.getCacheContext`);
- `saveStickerPreview` (стр. 118–132) — отрендеренный первый кадр стикера (canvas → blob → objectURL),
  ключ `docId-toneIndex`.

## 4.4 Скачивание на диск («Download»)

`appDownloadManager.downloadToDisc(options)` (стр. 257–384):

1. Для фото без `thumb` берётся самый большой size (стр. 261–263).
2. `USE_SW = !IS_MOBILE_SAFARI && !!apiManagerProxy.serviceMessagePort` (стр. 265).
3. SW-путь: `downloadId = random`, `url = 'd/' + id` (стр. 292–296);
   `apiManagerProxy.pingServiceWorkerWithIframe()` → скрытый `<iframe src="d/{id}">`
   (`createDownloadIframe`, стр. 386–417) → ожидание понга `'downloadRequestReceived'` ≤ 1500 мс
   (стр. 308–336) — иначе фолбэк.
4. `downloadMedia(options, 'disc', pingPromise)`: воркер пишет чанки в `DownloadStorage`
   (`lib/files/downloadStorage.ts`), тот шлёт их SW (`downloadChunk`), браузер качает как обычный файл
   **стримом, без сборки blob в памяти**.
5. Фолбэк (нет SW / нет понга): blob → `URL.createObjectURL` → `createDownloadAnchor(url, fileName)`
   (стр. 360–368).

## 4.5 Upload — `apiFileManager.upload` (стр. 1056–1184)

- `isBigFile = size >= 10 МБ` → `inputFileBig` + `upload.saveBigFilePart`, иначе `inputFile` +
  `upload.saveFilePart` (стр. 1060, 1090);
- `partSize = getLimitPart(size, true)` (≤ 512 KiB), `totalParts = ceil(size/partSize)`;
  `totalParts > maxUploadParts` → `FILE_TOO_BIG` (стр. 1074–1077);
- части идут через ту же очередь `downloadRequest({dcId: 'upload'})` генератором + пул `process()`
  (стр. 1094–1181), файл слайсится по частям (`file.slice(offset, offset+partSize)` — весь файл в память
  не читается, стр. 1104);
- `gzipCompress: true`, если mime не входит в список «уже сжатых» (стр. 109–134);
- прогресс: `deferred.notify({done, offset, total, fileName})` → `rootScope 'download_progress'`
  (стр. 1131–1132, 1158–1160) — тот же канал, что у загрузок; UI цепляет
  `ProgressivePreloader({isUpload: true}).attachPromise(appDownloadManager.getUpload(fileName))`.

# 5. Кэширование: cacheStorage и Service Worker

## 5.1 `CacheStorageController` — `src/lib/files/cacheStorage.ts`

Корзины (стр. 28–47), `encryptable` = шифруется AES при включённом пасскоде:

| Имя Cache API | encryptable | Содержимое |
|---|---|---|
| `cachedAssets` | нет | статика приложения (js/css/шрифты/картинки) — пишет SW |
| `cachedBackgrounds` | нет | обои |
| `cachedFiles` | да | **скачанные медиа-файлы целиком** (ключ — fileName из 4.2) |
| `cachedStreamChunks` | да | чанки стриминга видео/аудио (ключ `{acc}-{docId}?offset=&limit=`) |
| `cachedHlsQualityFiles` / `cachedHlsStreamChunks` | да | HLS |

API: `get/save` (стр. 201–248; при сохранении добавляются заголовки `cachedTime`, `contentLength`),
`getFile/saveFile` (стр. 250–280), `delete/deleteAll`, всё через `timeoutOperation` c таймаутом 15 с
(стр. 49, 282–313). Шифрование — `aes-local-encrypt/decrypt` в крипто-воркере (стр. 98–132), прозрачно
в `get`/`save` (стр. 207–216, 236–245). `prepareWriting` (стр. 315–326) → `MemoryWriter`, который по
`finalize()` сам кладёт blob в корзину. Статики `temporarilyToggle*` (стр. 345–367) — «замораживают»
операции на время пересоздания ключа. Один и тот же класс инстанцируется и в mtproto-воркере
(`apiFileManager.ts:137`), и в SW (`serviceWorker/stream.ts:19`) — **Cache API общий на origin**.

## 5.2 Service Worker: роутинг — `src/lib/serviceWorker/index.service.ts`

`onFetch` (стр. 269–346): сначала статика (prod, не Safari) — по regexp расширений →
`requestCache(event)` (кэш `cachedAssets`, стр. 270–276). Затем скоуп = предпоследний сегмент URL:

| Скоуп | Обработчик | Что делает |
|---|---|---|
| `stream` | `onStreamFetch` (`stream.ts:310`) | 206-ответы для `<video>/<audio>` |
| `d`, `download` | `onDownloadFetch` (`download.ts:150`) | стрим-скачивание на диск |
| `share` | `onShareFetch` | Web Share Target |
| `ping` | `Response('pong')` | keepalive (`pingServiceWorkerWithIframe`) |
| `rtmp`, `hls`, `hls_quality_file`, `hls_stream` | rtmp/hls модули | трансляции и HLS-качества |
| `backgrounds` | `onBackgroundsFetch` | обои |

Жизненный цикл: `install → skipWaiting` (стр. 352–355), `activate → caches.delete(cachedAssets) +
clients.claim()` (стр. 357–361). Связь с mtproto-воркером: при первом окне SW создаёт `MessageChannel`
и шлёт `port` окну, окно перекидывает его воркеру (стр. 73–88) — далее SW напрямую делает
`serviceMessagePort.invoke('requestFilePart', …, mtprotoMessagePort)`.

## 5.3 Стриминг `/stream/` — `src/lib/serviceWorker/stream.ts`

URL создаётся на клиенте: `getFileURL(type, options)` (`src/helpers/fileName.ts:65-72`) —
`'stream/' + encodeURIComponent(JSON.stringify(DownloadOptions))` (вся локация/dcId/size/mimeType — в URL).
Типы: `photo | thumb | document | stream | download | hls` (`getDocumentURL.ts:20-31` выбирает
`download → thumb → hls → stream → document`).

`onStreamFetch(event, params, search)` (стр. 310–334):

```
Range: bytes=A-B → parseRange (374-381)
info = JSON.parse(decodeURIComponent(params))
Stream.get(info)  — один Stream на (accountNumber, docId), Map streams (43)
respondWith(race(timeout(45s), stream.requestRange([A,B])))
```

`Stream` (стр. 45–304):

- `limitPart`: файл > 75 МБ → `STREAM_CHUNK_UPPER_LIMIT = 1 MiB`, иначе `512 KiB` (стр. 59, 369–372;
  комментарий: мобильный Safari не стартует большие видео с чанками 512 KiB);
- `requestRange` (стр. 205–279): фейковый 2-байтовый 206 на первый Safari-пробник `[0,1]`
  (стр. 348–363); offset выравнивается на сетку чанков (`alignOffset`, 383–385), limit — степень
  двойки (`alignLimit`, 387–390); при пересечении границы берутся 2 чанка и режутся (стр. 230–249);
  ответ `206 Partial Content` c `Content-Range/Length/Type` (стр. 260–276);
- каждый чанк: сперва `cachedStreamChunks` (стр. 131–146), промах →
  `serviceMessagePort.invoke('requestFilePart', payload, mtprotoPort, timeout 60s)` (стр. 84–129) с
  дедупликацией по taskId; результат пишется в кэш (стр. 166–173);
- **предзагрузка**: окно `PRELOAD_SIZE = 20 MiB` вперёд (стр. 22, 184–203); на самом первом чанке
  дополнительно грузится **последний** чанк файла (mp4 `moov` обычно в хвосте, стр. 185–189);
- жизнь стрима: `destroyDebounced` 150 с (стр. 60); `toggleStreamInUse` (стр. 336–346) — main-поток
  через `createVideo` (`src/helpers/dom/createVideo.ts:7-11`) сообщает «src навешен/снят»; на destroy —
  `cancelFilePartRequests` в воркер (стр. 71–75);
- заплатка Chromium mp4 (crbug 1250841): `?_crbug1250841` → `tryPatchMp4` (стр. 251–255, 321–323;
  ретрай — `helpers/onMediaLoad.ts:16-30`).

## 5.4 Скачивание на диск `/download/` — `src/lib/serviceWorker/download.ts`

События от воркера (стр. 30–139): `download {id, headers}` → создаётся `ReadableStream` c
`CountQueuingStrategy({highWaterMark: 1})` (backpressure — воркер не шлёт следующий чанк, пока SW не
принял предыдущий), `downloadChunk {id, chunk}` → `controller.enqueue`, `downloadFinalize` → close,
`downloadCancel` → error. `onDownloadFetch` (стр. 150–168): отвечает `Response(readableStream,
{headers})` — браузер показывает обычную загрузку файла; первым делом `invokeVoidAll('downloadRequestReceived')`
(стр. 151) — тот самый понг для `downloadToDisc`. При закрытии всех окон — `cancelAllDownloads` (стр. 170–178).

## 5.5 Как URL медиа попадает в DOM

| Случай | URL | Кто минтит |
|---|---|---|
| Фото/док (скачивается целиком) | `blob:` | воркер: `apiFileManager.downloadMediaURL` → `URL.createObjectURL` (1039) → `thumbsStorage.setCacheContextURL` → зеркало во все потоки; UI читает `apiManagerProxy.getCacheContext(media).url` |
| Стримируемое видео/аудио/большой GIF | `stream/{json}` | `appDocsManager.saveDoc` (стр. 266–285): `supportsStreaming = SW онлайн && (gif>8МБ или audio или video)`; URL кладётся в cacheContext заранее, без скачивания |
| Скачивание на диск | `d/{randomId}` | `downloadToDisc` + `<iframe>` |
| Stripped-превью | `data:`/`blob:` из inline-байтов | см. раздел 3 |

Без SW (`appManagersManager.isServiceWorkerOnline === false`) стриминга нет — всё качается целиком
в blob (для видео это значит «ждать полной загрузки»; тот же фолбэк для мобильного Safari).

# 6. Видео

## 6.1 Автоплей-политика

`liteMode` (`src/helpers/liteMode.ts:4-19`): ключи `all, gif, video, emoji*, effects*, stickers*,
chat*, animations, blur`; `isAvailable(key) = !liteMode.all && !liteMode[key]`.

`wrapVideo` (`src/components/wrappers/video.ts:129-136`):

```ts
canAutoplay ??= (
  doc.type !== 'video' ||
  (doc.size <= MAX_VIDEO_AUTOPLAY_SIZE /* 50 MiB, стр. 50 */ && !isGroupedItem)
) && (doc.type === 'gif' ? liteMode.isAvailable('gif') : liteMode.isAvailable('video'));
```

- автоплей всегда **muted + loop** (стр. 574–579), `video.autoplay = true` ставится и для Safari (стр. 406–408);
- `autoDownload.video === 0` → `noAutoDownload` (стр. 125–126): прелоадер в «ручном» режиме
  (`setManual`, стр. 583–586), загрузка `onlyCache` (стр. 595) — скачивание начнётся только по клику;
- нет автоплея → кнопка `Button('btn-circle video-play position-center', {icon:'largeplay'})` (стр. 173–176);
- при автоплее в `video-time` добавляется иконка `nosound` (стр. 159);
- видео в процессе аплоада не автоплеится, доигрывается после завершения (стр. 503–519);
- у видео `timeupdate` перерисовывает `video-time` как «оставшееся время» с троттлом 1 с (стр. 550–563).

## 6.2 GIF vs video

| | GIF (`doc.type === 'gif'`) | Видео |
|---|---|---|
| Бейдж | `spanTime.innerText = 'GIF'` (стр. 165) | длительность `toHHMMSS` (стр. 147) |
| Автоплей | `liteMode('gif')`, без лимита размера | ≤ 50 МБ, не в альбоме, `liteMode('video')` |
| Клик без автоплея | `load()` прямо в бабле (capture, once — стр. 708–713) | открытие вьювера |
| Пауза вне вьюпорта | `animationIntersector.addAnimation({type:'video', group})` (стр. 648–656) | то же при автоплее |
| `image/gif` mime | вообще не `<video>` — обычный `wrapPhoto` (стр. 185–208) | — |
| Контейнер | `media-gif-wrapper` + `dataset.docId` (стр. 120–123) | — |

## 6.3 Круглые видео (round)

`wrapVideo`, ветка `doc.type === 'round'` (стр. 220–405):

```
div.media-round.z-depth-1 [is-unread] [is-paused]   (dataset.mid/peerId, стр. 221-225)
  ├ svg-кольцо прогресса (createProgressRing, strokeWidth 3.5, стр. 227-243)
  ├ canvas.video-round-canvas (w=h=doc.w, стр. 250-252)   ← кадры рисуются сюда
  ├ span.video-time  (осталось времени + nosound на паузе, стр. 303, 310-318)
  └ video.media-video (скрывается при play — кадры идут через canvas, стр. 321)
```

- прогресс по окружности: `circumference = 2πr`, `strokeDasharray = C C`,
  `strokeDashoffset = C − t/duration·C` в rAF-цикле `animateSingle(onFrame, canvas)`
  (стр. 230–243, 280–287, 323);
- **воспроизведение глобальное**: `globalVideo = appMediaPlaybackController.addMedia({message})`
  (стр. 265) — сам `<video>` бабла лишь постер; события `play/pause/ended/timeupdate` вешаются на
  глобальный элемент (стр. 351–354);
- клик по canvas (стр. 356–384): пауза/плей; перед плеем `setSearchContext` +
  `setTargets(…, findMediaTargets(divRound, mid))` — чтобы плеер листал соседние round/voice;
- `ended` → канвас остаётся на последнем кадре, `video` бабла показывается снова, время сбрасывается (стр. 339–349);
- исходящее сообщение: `onLoad` откладывается через `AudioElement.onLoad` до подтверждения (стр. 399–405).

## 6.4 Стриминг и `<video>`-обвязка

- `supportsStreaming` (см. 5.5) → `video.src = cacheContext.url` (= `stream/...`) через
  `renderImageFromUrl(video, url)` (стр. 695); прелоадер **некэнселебл** (стр. 524–528) и снимается по
  `canplay` (Safari — по `timeupdate`, стр. 605–610);
- не-стримируемое: `appDownloadManager.downloadMediaURL({media: doc, queueId, thumb: videoSize})`
  (стр. 592–600), прелоадер с прогрессом и отменой;
- `ignoreStreaming` — форс-скачивание (опция wrapVideo, стр. 105, 114);
- `createVideo({middleware, pip})` (`helpers/dom/createVideo.ts`): переопределяет сеттер `src` →
  `toggleStreamInUse` в SW (держит Stream живым), на destroy — `video.src = ''; video.load()`;
- `onMediaLoad(video)` + `handleVideoLeak` + `shouldIgnoreVideoError` (`helpers/onMediaLoad.ts:6-30`,
  video.ts:532–548, 644–678) — обработка `URL safety check`, crbug 1250841, утечек;
- H.265: если есть `altDoc` (h264-версия) — оба URL вставляются `<source>`-ами c `width`, браузер
  выбирает сам (стр. 114–118, 680–693);
- HLS: `hls/{json}`-URL (`getDocumentURL.ts:26-28`), модули `src/lib/hls/*` (плейлист/качества через SW);
  в текущем форке выбор HLS в `saveDoc` закомментирован (appDocsManager.ts:276–284);
- сводная таблица:

| Тип | Автоплей | Звук | Контролы в бабле | Клик |
|---|---|---|---|---|
| video | ≤50МБ, не альбом, liteMode | muted, `nosound` | нет (время+прелоадер) | вьювер |
| gif | liteMode('gif') | нет звука | бейдж GIF | без автоплея — load в бабле |
| round | нет (только постер) | да, через глобальный плеер | кольцо прогресса, время | play/pause на месте |
| webm-стикер | всегда (как анимация) | нет | нет | — |

# 7. Аудио: глобальный плеер

<!-- SECTION:AUDIO -->

> Форк-специфика: `ChatAudio`/`PinnedContainer` (классы) заменены Solid-функциями `createChatAudio`
> (`src/components/chat/audio.tsx`) и `createTopbarPlate` (`chat/topbarPlate.tsx`); метод называется
> `resolveWaitingForLoadMedia` (не `resolveWaitingForMedia`). Добавлены `boost` (WebAudio-усиление
> voice), `slot`, `MusicListenTracker`, `MediaListLoaderFactory`.

## 7.1 Singleton `AppMediaPlaybackController`

`src/components/appMediaPlaybackController.ts:107` — `extends EventListenerBase`, экспорт
синглтона `:1242-1245`, инициализация из `appImManager.ts:274` → `construct()` (`:169-281`):
скрытый `<div style="display:none">`-контейнер для всех media-элементов (`:175-178`),
Media Session handlers (`:180-199`), подписка `document_downloaded` (`:201-208`), кросс-табовый
`media_play` (`:210-219`), реактивные свойства через `defineProperties` (`:221-264`).
Восстановление/персист параметров — `appDialogsManager.ts:691-698`; дефолты — `config/state.ts:499-511`.

## 7.2 Реестр media-элементов

| Поле | Тип | Стр. |
|---|---|---|
| `media` / `scheduled` | `Map<PeerId, Map<storageKey, HTMLMediaElement>>` | 116–117 |
| `mediaDetails` | `Map<media, {peerId, mid, storageKey, docId, doc, message, clean, isScheduled}>` | 118, 51–65 |
| `playingMedia` / `playingMediaType` | текущий элемент + `'voice'|'video'|'audio'` | 119–120 |
| `waitingMediaForLoad` | отложенная загрузка (deferred на peerId+mid) | 122–123 |
| `willBePlayedMedia` | «запустить сразу после докачки» | 126 |
| `listLoader` / `listLoaderFactory` | очередь воспроизведения | 129–130 |
| `gainAudioContext` / `mediaGainMap` | WebAudio-цепочка voice-boost | 162–163 |

### `addMedia({message, autoload, doc?, slot?, clean?})` — `:402-503`

Вызывают: `AudioElement.onLoad` (`audio.ts:591`), `wrapVideo` для round (`video.ts:265`),
savedMusic (`savedMusic.tsx:107`), `listLoader.processItem` (`:1064-1067`).

- `storageKey = mid + (slot ?? 0)` (`:405`); дедуп — если элемент уже есть, вернуть его (`:414-417`);
- `round|video` → `<video playsinline>`, иначе `<audio>` (`:420-427`); append в скрытый контейнер (`:429-446`);
- слушатели `play/pause/ended` → `onPlay/onPause/onEnded` (`:448-450`); авточтение непрочитанного
  voice/round по первому `timeupdate` → `readMessages` (`:452-456`);
- `autoload` → deferred сразу resolve, иначе в `waitingMediaForLoad` (`:472-483`);
- после resolve: стрим/есть url → `onMediaDocumentLoad` (ставит `media.src = cacheContext.url`,
  `playbackRate`, `loop` только для audio — `:510-538`), иначе `appDownloadManager.downloadMediaURL`
  (`:485-500`). Safari-фикс стримящейся музыки — `:35-41, 542-566`.

`resolveWaitingForLoadMedia(peerId, mid)` (`:568-585`) — резолв deferred (клик по элементу:
`audio.ts:674`, `playItem` `:971-973`, round `video.ts:628`). `willBePlayed(media)` (`:1028-1030`) —
помечается в `AudioElement.onDownloadInit` (`audio.ts:796`), проверяется в `readyPromise.then`
(`audio.ts:759-762` → `safePlay`).

## 7.3 Управление воспроизведением

| Метод | Стр. | Поведение |
|---|---|---|
| `toggle(play?)` / `play()` / `pause()` | 860–880, 909–915 | инверт/явно |
| `stop(media?, force?)` | 917–958 | pause + `currentTime=0` + **синтетический `ended`** (`:927`); `clean` → вычистка из реестра |
| `playItem({peerId, mid})` | 960–974 | `getMedia().play()` + resolveWaiting |
| `seekBackward/Forward/To` | 384–400 | `SEEK_OFFSET = 10 c` (`:43`) |
| `next()` / `previous()` | 1006–1016 | previous сперва `seekToStart` (если `currentTime > 5` — рестарт, `:1018-1026`) |
| `go(length)` | 976–987 | music → `listLoader.goRound`, иначе `go`; блокируется `lockedSwitchers` |
| `setSingleMedia({media, message})` | 1132–1202 | «плеер под себя» (вьювер/PiP/запись голоса), возвращает release |
| `pauseMediaInOtherTabs()` | 851–854 | `rootScope 'media_play'` (приёмник `:210-219`) |

Обработчики: `onPlay` (`:752-813`) — паузит PiP, при смене элемента `stop()+setMedia()`,
синхронизирует позицию в очереди (поиск в getPrevious/getNext → `go(jump, false)` либо
`repositionTo`/`setTargets`), диспатчит `'play'` и глушит другие вкладки. `onEnded` (`:830-849`) —
только trusted; автопереход `next()`, стоп при `lockedSwitchers`/конце списка.

События: `play` (payload `getPlayingDetails()`: `{doc, message, media, playbackParams}`, `:723-750`),
`pause`, `stop`, `playbackParams` (`:284`), `toggleVideoAutoplaySound` (см. §6). Подписчики —
`chat/audio.tsx:267-273`, `volumeSelector.ts:73`, `wrappers/video.ts:931-933`, `mediaPlayer/index.ts:481`.

## 7.4 `PlaybackParams`

Форма — `getPlaybackParams()` (`:358-369`):

| Поле | Семантика |
|---|---|
| `volume` [0..1] | общий мастер |
| `boost` [0..1] | **только voice/round**: прибавка сверх мастера (итог до 200%) |
| `muted` | |
| `playbackRate` | скорость **текущего** типа |
| `playbackRates: Record<'voice'|'video'|'audio', number>` | **раздельные скорости по типам** (`:152-156`) |
| `loop` | повтор трека, применяется только к `audio` |
| `round` | wrap-around плейлиста в `onEnded` |

- маппинг типа: `voice`+`round` → `'voice'`, `video` → `'video'`, прочее → `'audio'`
  (`getPlaybackMediaTypeFromMessage`, `:1098-1110`) — **round делит скорость/громкость с voice**;
- сеттеры (`:221-264`): clamp, применение к `playingMedia`, запись в `playbackRates[type]` (`:256-258`),
  диспатч `playbackParams` (`:260`);
- при смене трека `setMedia` (`:1112-1130`) подтягивает `playbackRates[mediaType]` напрямую в приватное
  поле без диспатча — UI обновится через `play`;
- громкость voice — через WebAudio: source → gain → DynamicsCompressor → destination
  (`getOrCreateMediaGain` `:287-319`; >100% квадратично, `:329-356`); слайдер плашки 0–200%:
  `get/setGlobalSliderVolume` (`:891-907`);
- персист c миграцией старого `volume > 1` в `boost` (`:371-382`);
- источники смены скорости: `playbackRateButton.ts:36,62` (меню 0.5/1/1.5/2),
  `mediaPlayer/speedDragHandler.tsx:73,143,172`.

## 7.5 Верхняя плашка-плеер — `chat/audio.tsx`

`createChatAudio(appImManager, managers)` (`audio.tsx:35`), монтаж в `#column-center`
(`appImManager.ts:722-723`). Строится `createTopbarPlate({modifier:'audio', height:48, render})`
(`audio.tsx:82-147`; билдер — `topbarPlate.tsx:251-284`).

| Элемент | Стр. | Действие |
|---|---|---|
| `fast_rewind` / play-pause / `fast_forward` | 88–108 | `previous()` / `toggle()` / `next()` |
| Title / Subtitle («время • исполнитель/дата») | 109–116 | клик → переход к сообщению |
| Громкость (`VolumeSelector`, вертикальный) | 60–68, 118 | до 200% для голоса (`setMaxVolume(isMusic ? 1 : 2)`, `:227`) |
| Скорость `PlaybackRateButton` | 58, 119 | меню 0.5x/1x/1.5x/2x |
| Repeat (`audio_repeat`/`audio_repeat_single`) | 120–136 | цикл: `round=1` → `loop=1` → сброс (`:125-134`) |
| Close | 137–139 | `stop(undefined, true)` |
| `MediaProgressLine({withTransition, useTransform})` | 70–75, 142–144 | прогресс + seek |

Реакции: `'play'` → `onMediaPlay` (`:209-255`): voice/round — `PeerTitle`+дата, музыка —
`title/performer` из `documentAttributeAudio`; repeat прячется для не-музыки; `progressLine.setMedia`;
`dataset.peerId/mid`. `'pause'` → иконка play; `'stop'` → скрыть плашку. Показ/скрытие —
`SetTransition('is-visible', 250мс)` + `body.is-pinned-audio-shown` (`:185-200`; CSS
`_chatPinned.scss:492-517`, сдвиг топбара `_chatTopbar.scss:7-16`). Клик по центру →
`appImManager.setInnerPeer({peerId, lastMsgId: mid})` из searchContext (`:151-181`).

## 7.6 `AudioElement` — `src/components/audio.ts`

Custom element `<audio-element>` (`:500`, регистрация `:872-874`), создаётся в `wrapDocument`
для `audio|voice|round` (`wrappers/document.ts:116-152`). `render()` (`:540-792`), `onLoad(autoload)`
(`:588-639`) — `addMedia` + подписки; `togglePlay` (`:804-813`) — `setTargetsIfNeeded()` + `safePlay`;
разметка: `.audio-toggle.audio-ico` (`:558-566`), `.audio-download` (preloader, `:568`), `is-unread` (`:571-574`).

**Voice (waveform)** — `wrapVoiceMessage` (`:149-340`): `decodeWaveform` — 5-битная распаковка
(`:57-81`), первые 63 байта (`:160`); `createWaveformBars` (`:83-147`): бар 2px + 2px margin, высота
4..23, ширина `clamp(duration/60*maxW, minW, maxW)`, SVG `<rect class="audio-waveform-bar">`; два
слоя — `.audio-waveform-background` + `.audio-waveform-fake` (заполнение = `width: t/duration*100%`
в `onTimeUpdate`, `:260-264`, через `animateSingle`); seek кликом/драгом по SVG (`:275-324`);
время `toHHMMSS(current) + ' / ' + duration` (`:606`).

**Music (обложка)** — `wrapAudio` (`:342-444`): `.audio-details > .audio-title/.audio-subtitle`,
`MiddleEllipsisElement`; при первом `play` описание подменяется на `MediaProgressLine`
(класс `audio-show-progress`, `:405-430`); обложка — `wrapPhoto` из `doc.thumbs` в `.audio-toggle` (`:641-659`).

**Скачивание** (`:661-775`): не-стрим → `ProgressivePreloader` + `downloadMediaURL` (`:714-736`);
стрим → corner-download с фейковым 75% на `play` (`:679-712`); voice/round автозагрузка всегда
(`autoDownload = doc.type !== 'audio'`, `:664`), музыка — по клику; по готовности — автозапуск, если
`willBePlayedMedia === this.audio` (`:759-762`).

**Транскрипция** (кратко): кнопка `.audio-to-text-button` + состояния 0/1/2 (`:186-237`), не-premium →
`PopupPremium`; запрос `transcribeAudio`, результат событием `message_transcribed` рисует
`bubbles.ts:1144-1207`.

## 7.7 Media Session API

- регистрация handlers `play/pause/stop/seekbackward/seekforward/seekto/previoustrack/nexttrack`
  с try/catch (`:180-199`); handlers через `bindBrowserCallback` — при активном PiP действие идёт
  к `this.pip`, иначе к очереди (`:989-1004`);
- `setNewMediadata(message, media)` (`:600-704`): ждёт `onMediaLoad` (иначе macOS не подхватывает),
  artwork из `doc.thumbs` (с дозагрузкой), voice/round — title = имя собеседника; fallback — иконки
  приложения 72…512 (`:670-695`); `navigator.mediaSession.metadata = new MediaMetadata(...)` (`:697-703`);
- вызов из `setMedia` при `'mediaSession' in navigator` (`:1127-1129`).

## 7.8 Очередь воспроизведения

Загрузчики: `ListLoader` (`helpers/listLoader.ts:14`) → `SearchListLoader`
(`helpers/searchListLoader.ts:13`, подгрузка `getHistory` + `otherSideLoader` + `goRound`);
`EmptyMediaListLoader` (poll/slot); `SavedMusicLoader` (`savedMusic.tsx:190,660,680`).
Требуемый интерфейс — `MediaListLoader` (`:67-74`), дефолт — `SearchListLoader` (`:1049`).

```
клик (AudioElement.togglePlay, audio.ts:806)
  └ setTargetsIfNeeded (audio.ts:815)
      ├ setSearchContext(this.searchContext ?? {NULL_PEER_ID, inputMessagesFilterEmpty}) (:817-821)
      ├ findMediaTargets(anchor, mid) → [prev, next] ИЗ DOM (audio.ts:458-498)
      └ setTargets(current, prev, next) (контроллер :1051-1096)
          ├ listLoader (loadCount:10, loadWhenLeft:5); processItem → addMedia({autoload:false})
          ├ onJump → playItem; onEmptied → stop
          ├ reverse = true для чата (next = более новые) (:1083)
          └ load(true) + load(false)
```

`findMediaTargets` (`audio.ts:458-498`): соседи из DOM (`.bubbles-inner`/`.tabs-tab`); music —
`.audio:not(.is-voice)`, voice/round — `.audio.is-voice, .media-round`; исходящие и
`data-to-be-skipped` исключаются. `inputFilter` при обёртке: round/voice —
`inputMessagesFilterRoundVoice`, music — `inputMessagesFilterMusic` (`bubbles.ts:8563-8605`,
`sharedMedia.tsx:634,638`, `sidebarLeft/index.ts:1155,1159`).

Направление: и voice, и music играются **от старых к новым**. Wrap-around — только музыка:
`goRound` (`searchListLoader.ts:223-264`) через `otherSideLoader` → `goToOtherEnd`. Живые апдейты:
`history_delete` (удалён текущий → stop), `history_multiappend`/`message_sent`
(`searchListLoader.ts:98-159`).

## 7.9 Voice: opus и round

- `IS_OPUS_SUPPORTED` = `audio.canPlayType('audio/ogg;')` (`environment/opusSupport.ts:1-4`);
  без поддержки — конверт `audio/ogg` → `audio/wav` в `apiFileManager.getConvertMethod`
  (`apiFileManager.ts:670-672`) через `opusDecodeController` (`lib/opusDecodeController.ts:26`:
  воркеры decoderWorker/waveWorker, таймаут 10 с, blob wav → objectURL); второй потребитель —
  запись голосового (`chatRecording.ts:224,672,989`);
- **round идёт через этот же контроллер** (см. §6.3): элемент `<video playsinline>` из `addMedia`,
  для параметров считается `'voice'` (`:1102-1104`), при `play` глушится `animationIntersector` (`:266-272`).

# 8. Медиавьювер

<!-- SECTION:VIEWER -->

> Пути в форке: `appMediaViewerBase.ts` → `src/components/mediaViewer/base.ts`,
> `appMediaViewer.ts` → `mediaViewer/index.ts`, `appMediaViewerAvatar.ts` → `mediaViewer/avatar.ts`.

## 8.1 Карта файлов

| Файл | Строк | Что внутри |
|---|---|---|
| `mediaViewer/base.ts` | 3006 | `AppMediaViewerBase`: DOM, mover-анимация, зум/поворот, свайпы, клавиатура, видео/фото |
| `mediaViewer/index.ts` | 525 | `AppMediaViewer` (сообщения чата) + `onMediaCaptionClick` |
| `mediaViewer/avatar.ts` | 226 | `AppMediaViewerAvatar` (фото профиля) |
| `mediaViewer/openAvatarViewer.ts` | 106 | развилка: чат-аватары → `AppMediaViewer`, юзер → `AppMediaViewerAvatar` |
| `mediaViewer/static.ts` | 121 | `AppMediaViewerStatic` — медиа вне истории (опросы) |
| `mediaViewer/rtmp.ts` | 447 | live-стрим |
| `mediaViewer/clipPath.ts` / `snapshotSize.ts` | 32 / 29 | `inset()`-обрезка у края скролла; размер canvas-снимка (DPR≤2, ≤1.5 Мп) |
| `mediaViewer/mediaViewer.scss` | 1139 | `--open-duration: .2s` (`:528`) |
| `helpers/listLoader.ts` / `searchListLoader.ts` / `avatarListLoader.ts` | 202/309/54 | листание + догрузка |
| `lib/mediaPlayer/index.ts` | 768 | `VideoPlayer` (наследник `ControlsHover`) |
| `components/swipeHandler.ts` | 521 | свайпы, pinch/wheel-zoom, double-click |

Stories-вьювер — отдельная подсистема (Solid, `stories/viewer.tsx`, 3509 строк), не наследует базу.

## 8.2 Иерархия и generic'и

```
EventListenerBase<{setMoverBefore, setMoverAfter}>
└ AppMediaViewerBase<ContentAdditionType, ButtonsAdditionType, TargetType extends {element}> base.ts:195
   ├ AppMediaViewer      <'caption', 'delete'|'forward', {element, mid, peerId}>   index.ts:75
   ├ AppMediaViewerAvatar<'',        'delete',           {element, photoId}>       avatar.ts:14
   ├ AppMediaViewerStatic<never,     'forward',          {media, element, fromId}> static.ts:32
   └ AppMediaViewerRtmp  <never,     'forward',          never>                    rtmp.ts:30
```

Loader'ы: `AppMediaViewer` → `SearchListLoader` (`index.ts:88`); avatar → `AvatarListLoader`
(`avatar.ts:22`). Конструктор базы: `(listLoader, topButtons, extraHeightPadding = 0)`
(`base.ts:295-298`); база доклеивает кнопки `['download','rotate','zoomin','close']` (`:353`).
`target` — прокси к `listLoader.current` (`:290-294`). Константы (`:82-104`): `ZOOM_STEP=0.5`,
`ZOOM_MIN=0.5`, `ZOOM_MAX=4`, `OPEN_TRANSITION_TIME=200`, `MOVE_TRANSITION_TIME=350`,
`RESERVE_TOP/BOTTOM_DESKTOP = 80/110` (мобилка 0/0), `VIDEO_MIN_WIDTH=420`.

## 8.3 DOM

Строится императивно в конструкторе (`base.ts:316-437`), монтируется в overlay-root при открытии (`:2453`):

```
div.media-viewer-whole (+ active/backwards/is-zooming/chrome-hidden/has-video[-controls]/hide-caption/live)
├ div.overlays > div.media-viewer (mainDiv)
│   └ div.media-viewer-content > div.media-viewer-container
│       └ div.media-viewer-media          ← скрытый «эталон»: его rect = containerRect анимаций
├ div.zoom-container (только !IS_TOUCH: zoomout / RangeSelector 0.5..4 / zoomin)   :368-397
├ div.media-viewer-topbar.media-viewer-appear
│   ├ topbar-left: [mobile-close] + .media-viewer-author (аватар 44 + name + date)
│   └ .media-viewer-buttons: [forward?] [delete?] download rotate zoomin close     :349-361
├ div.media-viewer-movers                 ← transform зума/поворота живёт ЗДЕСЬ
│   ├ .media-viewer-switcher-left/right (prev/next)                                :405-412
│   └ .media-viewer-mover-wrapper* (clip-path)                                     :1960
│       └ .media-viewer-mover (+opening/active/moving/center/hiding)               :1964
│           └ .media-viewer-aspecter > img/video/canvas.thumbnail | .ckin__player  :1414
└ div.media-viewer-caption (только AppMediaViewer, Scrollable)                     index.ts:112-143
```

Кнопки: `download` — `base.ts:448` (при вариантах качества — меню, `:453`); `rotate` →
`rotateMedia()` (`:480`, −90° против часовой); `zoomin` — тоггл `resetZoom()/addZoomStep` (`:473`);
prev/next → `listLoader.go(∓1)` (`:465-470`). Мобильное btn-menu (`:966`): Forward/Download/Delete
(`index.ts:147-162`). Caption: `setCaption` (`index.ts:304`), `TranslatableMessage` (`:344`),
тайм-коды из caption → `videoTimestamps` → `VideoPlayer` (`base.ts:2647`); клик по ссылке в caption
закрывает вьювер и потом кликает (`index.ts:174-185`).

## 8.4 Анимация открытия из бабла

Двигается **mover** — временный клон миниатюры размером `containerRect` (rect `content.media`);
стартовый transform уводит его в rect источника со `scale3d`.

**Target**: вызывающий передаёт `target` (img/video в бабле); `_openMedia` (`base.ts:2320`):
`useContainerAsTarget = !target || target === container` (`:2397-2398`) — без таргета анимация «из
центра»; `++this.tempId` — токен гонок (`:2401`). В `setMoverToTarget` (`:1176`) target уточняется до
`video, img, .canvas-thumbnail` (`:1521-1524`); с него снимается **canvas-снимок**
(`:1533-1560`, размер `getMediaViewerSnapshotSize`) либо переиспользуется декодированный `src` (`:1585-1592`).

**Rect'ы**: спец-кейсы (аватар/`.grid-item`/карусель профиля — `:1292-1309`); обрезка скроллом —
`findUpClassName(…, 'scrollable')` + пересечение с `.bubbles-viewport` (`:1326-1342`) →
`getVisibleRect` (`:1343`); частичное перекрытие → `clip-path: inset(...)` на wrapper
(`:1361-1365, 1481-1505`), затем ретракция в `inset(0px)` (`:1743`).

**Transform** (`:1385-1394, 1425-1442, 1732-1740`):

```ts
mover.style.width/height = containerRect.width/height
transform = `translate3d(${rect.left}px,${rect.top}px,0) scale3d(${rect.w/containerRect.w}, ${rect.h/containerRect.h}, 1)`
// aspecter внутри — обратный scale, чтобы содержимое было rect-размера
await doubleRaf();
mover.style.transform = `translate3d(${containerRect.left}px,${containerRect.top}px,0) scale3d(1,1,1)`
```

Скругления наследуются от обрезающего предка (до 12 уровней, `computeEffectiveCornerRadii`
`:2071`) и пишутся эллиптически `x / y` из-за неравномерного scale (`:1451-1457`); у баблов с
хвостом анимируется SVG-путь (`sizeTailPath`, `:1884`). Плавающие оверлеи источника
(`.video-time`, `.video-play` и т.п.) прячутся `hideFloatings()` (`:2153`) и возвращаются при закрытии (`:2176`).

**Последовательность открытия**:

| # | Шаг | Файл:строка |
|---|---|---|
| 1 | клик → `new AppMediaViewer().setSearchContext(...).openMedia(...)` | `bubbles.ts:3828` |
| 2 | guard `setMoverPromise`, `setCaption` | `index.ts:440-468` |
| 3 | `_openMedia`: `setAuthorInfo`, layout | `base.ts:2360-2371` |
| 4 | первый раз: `listLoader.setTargets(prevTargets, nextTargets, reverse)`; `window.appMediaViewer = this` | `base.ts:2373-2379` |
| 5 | стрелки по `previous/next.length` | `:2387-2388` |
| 6 | `fromRight !== 0` → `moveTheMover()+setNewMover()`; иначе NavigationItem `type:'media'`, `toggleOverlay(true)`, монтаж, `toggleWholeActive(true)` | `:2427-2457` |
| 7 | `setAttachmentSize` под `mediaBoxSize` (видео ≥ 420px) | `:2465-2493` |
| 8 | таргет=контейнер → рисуем thumb и **ждём decode** | `:2495-2531` |
| 9 | `setMoverToTarget`: start-transform → `.active/.moving/.opening` → `doubleRaf` → финал | `:1685-1746` |
| 10 | `transitionend` (страховка `duration+100мс`, `:1800`): `.center` + `applyCenterStyles` | `:1752-1789` |
| 11 | после анимации — полный файл/`VideoPlayer` (`lazyLoadQueue.unshift`) | `:2635-2724, 2891` |
| 12 | `next.length < 10` → `listLoader.load(true)` | `:2993-3001` |

**Закрытие** (`close()`, `base.ts:975-1030`): `setMoverToTarget(this.target?.element, true)` —
летим ровно в сохранённый DOM-узел, **повторного поиска по mid нет**. Если элемент догружен
loader'ом (`element === null`) или **проскроллен из видимости** (`getVisibleRect` → undefined) —
ретаргет на `content.media` + fade по opacity вместо движения (`:1345-1354`,
`transitionProperty = needOpacity ? 'opacity' : 'transform'`, `:1512`). Закрытие из зума: transform
переносится с `moversContainer` на mover синхронно (`:1191-1256`), докрутка поворота (`:1469-1476`).
Финал: `wholeDiv.remove()`, `toggleOverlay(false)`, `middlewareHelper.destroy()`.

## 8.5 Навигация prev/next и догрузка истории

- клики по switcher'ам (`:465-471`), `ArrowLeft/Right` при `!isZooming` (`:1142-1144`), свайп по X
  (`:546-553`); `listLoader.onJump` → `onPrevClick/onNextClick` (`index.ts:204-220`) — заново
  `openMedia({..., fromRight: ∓1})`;
- `ListLoader.go` (`listLoader.ts:67-101`): сам догружает при `< loadWhenLeft = 20`;
  `loadCount = 50` (`:23`); `load(older)` (`:142-201`) — якорь = крайний элемент, `processItem`,
  вставка с учётом `reverse`, `onLoadedMore` → перерисовка стрелок (`base.ts:439-443`);
- `SearchListLoader.loadMore` (`searchListLoader.ts:27-61`): `getHistory({...searchContext,
  offsetId: anchor.mid, limit/backLimit})`; `inputFilter` из searchContext —
  `inputMessagesFilterPhotoVideo` / `Document` (`bubbles.ts:3833`), `ChatPhotos`
  (`openAvatarViewer.ts:28`); фильтрация + `skipSensitive` (`:89-96`);
- живые апдейты: `history_delete` (текущий удалён → `onEmptied` → `close()`, `index.ts:104`),
  `history_multiappend`/`message_sent` (`searchListLoader.ts:98-157`);
- **догруженные targets имеют `element: null`** (`index.ts:100`) → на них анимация «из центра»
  через `moveTheMover` (`base.ts:1928`).

## 8.6 Зум и поворот

| Действие | Вход |
|---|---|
| Кнопки/ползунок zoom-container | `addZoomStep(±0.5)` / `onScrub` (`base.ts:372-392`) |
| Колесо + Ctrl/Meta/Shift | `swipeHandler.ts:462-471` → шаг `−delta*0.01` |
| Колесо без модификатора | панорамирование при зуме (`:474`) |
| Pinch | `zoomFactor = endDistance/initialDistance` (`swipeHandler.ts:420-436`) |
| Двойной клик | `resetZoom()` / `changeZoomByPosition(x, y, 3)` (`base.ts:565-572`) |
| `Ctrl` + `-`/`=` | `base.ts:1145-1149` |

`onZoom` (`base.ts:658-701`): clamp в `[0.5, ZOOM_MAX*3]` (bounce), центр сохраняется, смещение
`x − scale*x` (`:718`), границы `calculateOffsetBoundaries`/`getZoomBoundaries` (`:795, 815`).
Итоговый transform на `moversContainer` (`:867-872`):
`translate3d(x,y,0) scale(S) translate(cx,cy) rotate(deg) scale(fit) translate(−cx,−cy)`.
Отпускание — bounce к пределам + инерция (`k=0.1`, `:614-656`); `scale < 1` → `resetZoom()`.
Поворот: `rotation −= 90`, `getRotationFitScale` вписывает бокс (`:891-932`); при зуме/повороте
видео-контролы принудительно скрыты (`updateVideoControlsLock`, `:956`).

## 8.7 Видео во вьювере

`VideoPlayer` (`lib/mediaPlayer/index.ts:40`, наследник `ControlsHover`) создаётся в `createPlayer()`
(`base.ts:2628-2735`) после `Promise.all([canplay, onAnimationEnd])`. Опции: `videoTimestamps` из
caption, `streamable: doc.supportsStreaming`, `onPip/onPipClose` (скрытие оверлея + `setPictureInPicture`,
`:2667-2707`), `listenKeyboardEvents: 'always'`, `useGlobalVolume: 'auto'`.

Шорткаты (`mediaPlayer/index.ts:386-415`): `F` фулскрин, `M` mute, `Space` play/pause,
`Alt+=/−` скорость, `←/→` seek **только в фулскрине** (вне — навигация вьювера). Контролы:
`buildControls` (`:603`) — градиент, `MediaProgressLine`, превью-скрабер, скорость, качество, PiP;
авто-скрытие 3 с (`controlsHover.ts:82/119`), класс `has-video-controls` (`base.ts:2718-2720`).
Буферизация: `preloaderStreamable` + `waiting/canplay` + класс `is-buffering` (`:2737-2800`); HLS —
`getDocumentURL(..., {supportsHlsStreaming: true})` (`:2557`). Одиночная сессия —
`appMediaPlaybackController.setSingleMedia` (`:2618`); автолуп gif и видео < 60 с (`:2596-2603`).

## 8.8 `AppMediaViewerAvatar`

- `AvatarListLoader.loadMore` → `appPhotosManager.getUserPhotos(peerId, maxId, loadCount)`
  (`avatarListLoader.ts:27`); «публичное» фото всегда последнее и не якорь пагинации (`:22-43`);
- кнопки: только `delete` (видимость по `computeCanDelete` — свой профиль / `change_info`,
  `avatar.ts:60-66`); удаление — `deletePhotos`/`editPhoto` → `close()` (`:107-114`);
- подпись «X of Y» — `applyDateExtra` (`:180-201`); анимированная аватарка —
  `overlayAvatarVideoOnMover` после анимации (`:161-167`);
- открытие: `openAvatarViewer()` (`openAvatarViewer.ts:8`): чат → обычный `AppMediaViewer` с
  `inputMessagesFilterChatPhotos` (аватары чата = сервисные сообщения, `:62-72`); юзер →
  `AppMediaViewerAvatar` (`:99`). Единственный вызов — карусель профиля (`peerProfileAvatars.ts:213`).

## 8.9 Кто открывает и жизненный цикл

| Точка | Файл:строка |
|---|---|
| Бабл чата (`checkTargetForMediaViewer`; собирает targets по всем отрендеренным баблам `:3726-3801`) | `bubbles.ts:3641, 3828` |
| Shared media (правая колонка), контекст `copySearchContext(+nextRate)` | `appSearchSuper.ts:716, 756, 2795` |
| Instant View / платные медиа | `instantView.tsx:460`, `popups/starsPay.tsx:456` (`new AppMediaViewer(true)` — local) |
| Опросы | `PollMessageContent.tsx:415` (`AppMediaViewerStatic`) |
| Карусель профиля | `peerProfileAvatars.ts:213` |

**Каждый раз новый инстанс** — `new AppMediaViewer()` в обработчике клика; DOM строится в
конструкторе, умирает в `close()`. Глобальная ссылка `window.appMediaViewer` (`base.ts:2378`,
снимается в close `:1006-1008`) — для тайм-кодов из диплинков (`internalLinkProcessor.ts:129`).

## 8.10 Swipe / мобильное

- горизонтальный свайп (порог 20% ширины или 125px) → prev/next; вертикальный → `close()`
  (`base.ts:546-560`); драг при зуме → `adjustPosition` + `cancelDrag` (`:539-546`);
- тап по фото — тоггл «хрома» (`chrome-hidden`, `:1084-1088`); тап подсвечивает стрелки на 3 с
  (`highlight-switchers`, `:1090-1102`); клик по фону на десктопе закрывает (`:1119-1123`);
- системный «назад» → `navigationItem.onPop`; iOS Safari — мгновенный `remove()` без анимации
  (`:2439-2441`); резервы на мобилке 0/0 — mover на весь вьюпорт (`:2245-2250`);
- при `liteMode('animations') === false` — `delay = 0`, переходы мгновенные (`:1278`);
- ресайз: `mediaSizes 'resize'` → `applyLayoutPadding + refitMediaToViewport + applyCenterStyles`
  (`:1046, 2196-2234`).

# 9. Стикеры и анимации

> В этом форке классический `rlottie` заменён на **tlottie** (`src/vendor/tlottie/tlottie.wasm`)
> + опциональный offscreen-рендер (OffscreenCanvas в воркере / отдельный compositor-воркер).
> Каталога `src/lib/rlottie/` нет — всё в `src/lib/lottie/`. У нас порт tlottie уже сделан
> (см. память проекта «tlottie port», PR #55).

Цепочка:

```
wrapSticker (wrappers/sticker.ts:65)
  └─ Lottie → lottieLoader.loadAnimationWorker (lib/lottie/lottieLoader.ts:224)
       ├─ loadLottieWorkers → registerThreadedWorker (lottieLoader.ts:117 / apiManagerProxy.ts:800)
       ├─ initPlayer → new LottiePlayer (:322) → loadFromData (:358)
       │    └─ lottieMessagePort.invokeLottie(workerId, 'loadFromData'|'renderFrame') → tlottie.worker.ts
       └─ animationIntersector.addAnimation({type: 'lottie'}) (:274)
  └─ WebM / static → createVideo / new Image (sticker.ts:509, 524)
       └─ animationIntersector.addAnimation({type: 'video'}) (sticker.ts:675)
```

## 9.1 Пул воркеров и кэш кадров

| Что | Где | Суть |
|---|---|---|
| Размер пула | `config/app.ts:14,32` | `threads = min(4, hardwareConcurrency)`, `lottieWorkers = threads` |
| Регистрация | `apiManagerProxy.ts:800` | воркер собирается один раз, исходник клонируется в N blob-URL (`createProxyWorkerURLs`, `appManagersManager.ts:130`) |
| SharedWorker vs Worker | `apiManagerProxy.ts:849` | по умолчанию SharedWorker (шаринг между вкладками); Safari + lottie → dedicated Worker |
| Транспорт | `lib/lottie/lottieMessagePort.ts:15-32` | RPC: `loadFromData`, `renderFrame`, `presentFrame`, `exportFrame`, `resizeCanvases`, `setColor`, `clearFramesCache`, `playFreeRun/pauseFreeRun`, `suspendTab/resumeTab` |
| Балансировка | `:50` round-robin; `:72` `getWorkerIndexForName` — хэш имени | offscreen-плееры с `cacheName` роутятся **cache-affine**, чтобы один стикер декодировался одним воркером |
| Пауза скрытой вкладки | `lottieLoader.ts:144-151` | таймеры SharedWorker не троттлятся браузером → на `visibilitychange` шлётся `suspendTab`/`resumeTab` |

**`FramesCache`** (`helpers/framesCache.ts`): ключ `generateName(name, width, height, color, toneIndex)`
(`:68`) — **toneIndex входит в ключ**, поэтому тона эмодзи не путаются. Элемент (`:7`) —
`{frames, framesNew: Map<number, ImageBitmap|Canvas>, framesURLs, counter}`, reference-counted:
`getCache` инкрементит, `releaseCache` при 0 чистит и закрывает `ImageBitmap` (`:42, 54`).
Глубина кэширования — эвристика `cachingDelta` (`lottiePlayer.ts:233-241`): Apple и >100px → `2`
(50 % кадров), <100px → `Infinity`, иначе `4` (75 %). Offscreen-плееры не трогают общий UI-кэш
(`lottiePlayer.ts:265`).

## 9.2 `SuperStickerRenderer` — батч-рендер сетки

`emoticonsDropdown/tabs/SuperStickerRenderer.ts:12`. В панели стикеров сотни ячеек — live-плеер
на каждую держать нельзя.

- Один `LazyLoadQueueRepeat` с одним `IntersectionObserver` на весь рендерер (`:35`).
- `renderSticker()` (`:54`) кладёт только **thumb** (`onlyThumb: doc.animated`) + `middlewareHelper` на элемент.
- Вход во вьюпорт → `processVisible` (`:127`): полный `wrapSticker({play: true, loop: true})`.
- Выход → `processInvisible` (`:169`): `animationIntersector.removeAnimation` для всех плееров элемента, `middlewareHelper.clean()` (это убивает LottiePlayer через `middleware.onClean`), затем снова thumb. Есть защита от гонки, если ячейка снова стала видимой (`:179`).

## 9.3 `animationIntersector` — диспетчер воспроизведения

`components/animationIntersector.ts:43`. Один `IntersectionObserver` на всё приложение (`:142-146`),
индексы `byGroups` / `byPlayer` / `byElement`.

| Механизм | Строка | Поведение |
|---|---|---|
| Регистрация | `addAnimation()` `:236` | типы `'lottie' \| 'dots' \| 'video' \| 'emoji'`; `controlled: Middleware` авто-снимает по `onClean` |
| Уход из вьюпорта | `onObserve` `:62-104` | пауза + для lottie `clearCacheWhenSafe()` (`:96`) — освобождение памяти кадров |
| Группы | `:14-17` | `'chat-N'`, `'emoticons-dropdown'`, `'STICKERS-POPUP'`, `'EMOJI'`, `'STICKER-VIEWER'`, `'none'` |
| «Играет только одна группа» | `setOnlyOnePlayableGroup()` `:360` | из `stickerViewer`, `popups/stickers`, `popups/newMedia`, `appImManager` |
| Пауза всего | `checkAnimations/checkAnimations2` `:283, :316` | blur/idle/медиавьювер/попап; idle — через `idleController` с исключениями `overrideIdleGroups` |
| `toggleVideosUnder(el, paused)` | `:167` | правая колонка скрыта `transform`ом, IO считает её видимой → принудительная пауза видео внутри (`sidebarRight/index.ts:98, 132`) |
| `toggleMediaPause` | `:148` | глобальный `videosLocked` при проигрывании аудио/видео |
| lite mode | `setAutoplay` `:404`, `setLoop` `:419` | ключи `stickers_chat`, `stickers_panel`, `effects_emoji`… |
| PiP | `onAppWindowChange` `:127-135` | при поп-ауте в Document PiP IO пересоздаётся в новом realm |

`AnimationItemWrapper` (`:30`) — минимальный контракт (`play/pause/remove/paused/autoplay/loop`),
поэтому в интерсекторе одинаково живут `LottiePlayer`, `HTMLVideoElement` и `CustomEmojiElement`.

## 9.4 Custom emoji — общий canvas

`CustomEmojiRendererElement` (`lib/customEmoji/renderer.ts:35`) — **один `<canvas class="custom-emoji-canvas">`
на сообщение**, в него композитятся все эмодзи текста. Каждый плеер грузится с `sync: true`
(`sticker.ts:439`) → `loadAnimationWorker` переиспользует существующий плеер по `cacheName`
(`lottieLoader.ts:238-257`): один эмодзи в 20 местах = один декодер.

- Legacy-путь: `player.overrideRender = frame => syncedPlayersFrames.set(player, frame)` (`renderer.ts:856`); общий тик `renderEmojis()` (`:1229`) раз в `CUSTOM_EMOJI_FRAME_INTERVAL = 1000/60` чистит canvas и блитит все кадры по offsets → эмодзи идут кадр-в-кадр.
- Offscreen-путь: canvas отдаётся compositor-воркеру, UI шлёт только изменившиеся offsets (`:840`, `:1266`); при запаузенном рендерере сообщений не шлётся вовсе.
- `CustomEmojiElement` (`element.ts:11`) — «слот» в тексте, реализует `AnimationItemWrapper`; плеер паузится, только когда запаузены **все** его элементы (`element.ts:146`).

## 9.5 Кэш первого кадра и появление стикера

`saveLottiePreview(doc, canvas|ImageBitmap, toneIndex)` (`helpers/saveLottiePreview.ts:33`): по событию
`firstFrame` первый кадр → blob → `thumbsStorage.saveStickerPreview` (`storages/thumbs.ts:118`).
Ключ — `getStickerThumbKey(docId, toneIndex)`, где `toneIndex` может быть строкой = CSS-переменной
цвета (тонированные эмодзи), тогда применяется `applyColorOnContext`; смена темы чистит цветные thumb'ы.
Для offscreen кадр вытягивается RPC `exportFrame` (`:86-102`).
На старте `wrapSticker` читает `apiManagerProxy.getStickerCachedThumb(doc.id, toneIndex)` (`sticker.ts:225`).

Слои появления — `createStickerAppearance` (`wrappers/stickerAppearance.ts:29`): path-svg → `<img>`
(`upgradeToImage`) → canvas (`onMediaFirstFrame`), с `data-sticker-thumb = docId-toneIndex`;
предыдущий слой снимается только после отрисовки следующего — мигания нет.

## 9.6 Что учесть при порте

1. Round-robin повторить просто, но **cache-affine роутинг по имени** даёт бесплатный шаринг декодированных кадров между вкладками при SharedWorker.
2. `cachingDelta` + reference-counted `FramesCache` — ключ к памяти на панели стикеров; без `clearCacheWhenSafe()` на выходе из вьюпорта память течёт.
3. `SuperStickerRenderer` и `animationIntersector` — независимые слои: первый управляет **жизнью** плеера (создать/снести), второй — **воспроизведением** (play/pause). Портировать их нужно вместе.

# 10. «У нас»: состояние web-client и расхождения

<!-- SECTION:OURS -->

Решение от 2026-08-12: медиа «супер аналогично» tweb — SW+cacheStorage → stripped-превью →
медиавьювер 1:1 → аватарки без блюра; MTProto-протезы не портируем. Значительная часть уже сделана.

## 10.1 Карта (web-client)

| Файл | Роль (аналог tweb) |
|---|---|
| `src/core/managers/mediaManager.ts` (397) | воркер-владелец: медиа-токен (обновление за минуту до истечения, `rt:media_token`), `downloadMediaURL` — качает байты, кладёт в корзину `cachedFiles` (порт `CacheStorageController` — `src/core/files/cacheStorage.ts`), минтит `blob:` **в воркере** (blob-стор общий на origin — модель `apiFileManager.ts:1039` + зеркало thumbs), бродкаст `rt:media_url`; upload: single-PUT или чанки 8 MiB, конкуренция 3, ретраи/резюм |
| `src/core/mediaUrl.ts` (153) | синхронное зеркало токена в main-потоке; после Task 6/7 картинки ушли на воркерный конвейер, токен остался стриму и байтам: `<video>/<audio>` при DNP-OFF (`resolveStreamUrl`), fetch байтов (StickerMedia, waveform, DocRow) |
| `src/core/mediaCache.ts` (125) | зеркало objectURL'ов (`useSyncExternalStore`) + подсчёт/очистка корзины (порт `storageQuota.tsx`) |
| `src/core/hooks/useMediaUrl.ts`, `useMediaThumb.ts` | потребление на рендере; правило `hasThumb` = tweb `replyContainer.ts:79-81` |
| `public/sw.js` + `sw-bridge.js` + `sw-stream.js` | SW: push, app-shell precache и **206-стриминг** — `sw-stream.js` = порт `serviceWorker/stream.ts` 1:1 на plain JS (те же 512K/1M чанки, Safari-пробник, align), байты через мост к SharedWorker (DNP-ON) |
| `src/components/mediaViewer/*` | порт вьювера: `base.ts` (2770 — mover/zoom/touch/video), `appMediaViewer.ts`, `listLoader.ts`, `openMediaViewer.ts`, `collectLightboxItems.ts` + широкий набор тестов; blur-подложка из `media.blurPreview` (`base.ts:2402-2403`) |
| `src/core/audio/mediaPlaybackController.ts` (295) + `src/stores/audioStore.ts` + `src/components/NowPlayingBar.tsx` | глобальный плеер + верхняя плашка (аналог ChatAudio); `VoiceMessage.tsx` |
| `src/components/preloader.ts` (302), `RadialProgress.tsx` | порт `ProgressivePreloader` |
| `src/components/messages/RealMediaBubble.tsx` (542) | фото/видео/gif-бабл: канвас-blur-превью (`useBlurThumb`), кольцо аплоада с отменой, DocRow с управляемым скачиванием |
| `src/components/StickerMedia.tsx`, `src/core/stickers/*` | реальные стикеры (по mediaId) — tlottie (SIMD-WASM порт rlottie из tweb, декод в воркере; PR #55) |
| `src/lib/lottie/lottieLoader.ts` + `lottiePlayer.ts` | единственный движок lottie в дереве (программа «один движок lottie», `docs/superpowers/plans/2026-09-05-lottie-single-engine.md`, PR #55 + Этапы 0-4); второй движок (`lottie-web`) снесён из зависимостей, скан-пин — `lib/lottie/noLottieWeb.test.ts` |
| `src/components/lottieAnimation.solid.tsx` (Solid), `LottieSticker.tsx` (React) | единая точка входа для встроенных ассетов (обезьянки, уточки, иконки папок/ключа/пасскода, шапки карточек) — порт tweb `components/lottieAnimation.tsx`, зовёт `lottieLoader.loadAnimationAsAsset(params, name: LottieAssetName)` |
| `public/assets/tgs/*.json` | встроенные ассеты статикой, как в оригинале (было — 11 json'ов отдельными JS-чанками бандла); `lottieLoader.makeAssetUrl` резолвит `assets/tgs/<name>.json` |
| `src/components/mediaEditor/`, `StoryViewer.tsx`, `GifsMasonry.tsx` | медиа-редактор, сторис-вьювер, сетка GIF |

## 10.2 Главные расхождения с tweb

| Область | tweb | У нас | Gap |
|---|---|---|---|
| Stripped-превью | inline-байты в сообщении, сборка JPEG на клиенте + blur | сервер кладёт `blurPreview` (base64 JPEG) в `MediaMeta`; blur — canvas (`useBlurThumb`) | UX совпадает; клиентской сборки из байтов нет и не нужно (формат наш) |
| URL-модель | единый `cacheContext` (url/downloaded per size type) с зеркалом во все потоки | два пути: blob-конвейер воркера (картинки, `rt:media_url`) + token-URL (стрим/байты при DNP-OFF) | token-путь — временный протез вне DNP-канала; целимся на blob/`/stream/` везде |
| cacheContext по size type | `photo_{id}_{type}` — много размеров | один thumb-вариант: ключ `{id}` / `{id}_thumb` | у нас один размер превью с бэка — осознанное упрощение |
| Очереди загрузки | per-DC пулы, priority/queueId, лимиты 72/448 дельт, `lazyLoadQueue` c IO | HTTP-параллельность браузера; `lazyLoadQueue` нет | приоритезация видимого — кандидат на порт вместе с прунингом ленты |
| Стриминг видео | SW `/stream/` + `cachedStreamChunks` всегда (когда SW жив) | 206-стриминг только при DNP-ON (sw-stream); при DNP-OFF — token-URL напрямую на бэк (Range отдаёт бэк) | обе ветки дают 206; чанко-кэша при DNP-OFF нет |
| Скачивание на диск | SW-стрим `d/{id}` + iframe, фолбэк anchor | blob + anchor (`useMessageActions`) | стрим-скачивание больших файлов не портировано |
| Вьювер | `appMediaViewerBase` + avatar-вьювер | порт 1:1 (mover/zoom/video) | avatar-вьювер и sharing таргетов между источниками — сверить с §8 |
| Аватарки | stripped+blur | без блюра | осознанное решение (2026-08-12) |

Смежные наши доки: `2026-08-08-tweb-deep-structural-audit.md`, `bubbles.md`
(медиа-баблы), `right-sidebar.md` (§4 shared media),
`2026-08-01-dnp-noise-transport-protocol.md` (медиа-путь в DNP-канале).

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Фото и видео в бабле: сначала stripped-превью, потом полный размер, без рывка размеров.
- [ ] Медиавьювер: открытие по клику, стрелки и свайп между медиа, зум, закрытие по Esc.
- [ ] Видео: автоплей по политике, GIF зациклен без звука, круглое видео играет по клику.
- [ ] Аудио и голосовое: плеер, волна, скорость, продолжение воспроизведения в шапке при уходе из чата.
- [ ] Документ: иконка или превью, прогресс загрузки, отмена загрузки.
- [ ] Стикеры трёх видов (статический, анимированный, видео); вне вьюпорта воспроизведение на паузе.
- [ ] Повторное открытие того же медиа берёт файл из cacheStorage — в сетевой панели нового запроса нет.
- [ ] Аватарки и превью в чатлисте и shared media строятся тем же кодом, что медиа в бабле.

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 09-media-viewer, 03-document, 03-reply-audio, 03c-sticker-poll-video.
