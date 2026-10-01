# Медиаредактор tweb на Solid (1:1): аватар первым, затем медиа при отправке и истории — план программы

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: `superpowers:subagent-driven-development` (или
> `superpowers:executing-plans`). Шаги помечены чекбоксами (`- [ ]`). Перед каждой задачей —
> скилл `tweb-parity` (`.claude/skills/tweb-parity/SKILL.md`): док → исходник tweb → код.

**Цель.** Порт медиаредактора tweb `812502980` (`src/components/mediaEditor/**`, 9 837 строк TS/TSX
+ 1 759 SCSS) файлами, на Solid, с его входами `helpers/getFileAndOpenEditor.ts` и
`components/avatarEdit.ts`. Первым идёт режим аватара: кроп в круг или скруглённый квадрат, фото и
видео-аватар. Когда редактор готов для аватара, класс `AvatarEdit` и `getFileAndOpenEditor` сразу
получают экраны регистрации, профиля, новой группы и канала, редактирования чата и контакта. Временный
мост «выбор файла вместо редактора» им тогда не нужен. Потом редактор получает остальные вкладки и
заменяет наш React `MediaEditor.tsx` в попапе отправки медиа и в создании истории. В конце React-редактор
и `settings/AvatarCropper.tsx` удаляются.

**Архитектура.** tweb — гибрид. Редактор у него — Solid-дерево, которое `openMediaEditor`
(`mediaEditor.tsx:182`) рендерит в `getOverlayRoot()`. Снаружи вызывающий получает одну функцию:
`openMediaEditorFromMedia*` (`index.ts:25`, `:50`, `:78`) или `getFileAndOpenEditor`. Мост из React
поэтому не нужен в принципе: React-экран зовёт функцию, а редактор сам монтирует и снимает Solid-корень.
Этот «островной» шов уже работает для попапов 2C. Порт идёт снизу вверх: опора (хелперы) → каркас
оверлея → WebGL-холст → кроп → финальный рендер фото → `AvatarEdit` → врезка потребителей аватара →
видео → остальные вкладки → отправка медиа и истории → снос React.

**Стек.** TypeScript strict, Solid (`solid-js` 1.9.x стоковый, `solid-js/store`: `createMutable`,
`modifyMutable`, `produce`), WebGL 1, WebCodecs (`VideoEncoder`/`AudioEncoder`) + `mediabunny` (у нас
уже есть, `web-client/package.json:37`), tlottie (`lib/lottie/lottieLoader.ts`), vitest + happy-dom,
Playwright-стенд (`docs/testing/e2e-scenarios.md`, ветка `origin/docs/e2e-scenarios-plan`).

**Оригинал:** `/Users/denisurevic/Documents/tweb`, коммит **`812502980`**. Все адреса ниже даны по
нему. Наш код — `web-client/src/`, срез `fa136b4a` (2026-09-30). «Старая база» `e52b5d931` кадрировала
аватар попапом `popups/avatar.ts` (`PopupAvatar`). В `812502980` этого файла нет: весь кроп ушёл в
медиаредактор. Поэтому долг `web-client/backlogs/frontend/avatar-cropper-solid-port.md` («портировать
`PopupAvatar`») устарел, и эта программа закрывает его иначе.

**Место в программе.** Спека `docs/superpowers/specs/2026-08-28-solid-migration-design.md` § 8,
волна 4 («`StoryViewer`, `MediaEditor`»). Решение пользователя от 2026-09-30 («кропер тоже перенеси с
tweb») выделяет медиаредактор в отдельную программу с этим планом. `StoryViewer` остаётся за волной 4.
Задача **2D-27** (`plans/2026-09-26-wave-2d-settings-rowtsx.md:1133`) предполагала временный вход в
React-редактор. Вместо него — эта программа: 2D-27 берёт готовые `AvatarEdit`/`EditPeer`, О-24 плана 2D
закрывают задачи МР-5 и МР-8. Спека § 8 обновлена в этом же PR.

**Детальность.** Этапы 1 и 2 расписаны по задачам с файлами, тестами и мутациями. Этапы 3 и 4 — так
же, но крупнее. Внутренности `resizableLayers`/`textLayerContent` и попапа отправки вскроются при
переносе.

---

## Решения пользователя (обязательные)

1. **Кроппер переносится с tweb** (2026-09-30). Кроп аватара — медиаредактор tweb в режиме
   `isEditingForAvatar`, а не наш `AvatarCropper` и не старый `PopupAvatar`.
2. **1:1 с tweb, файлами.** Источник — файл tweb, наш React-редактор даёт только список сценариев
   (спека § 6a, память `port-anchor-tweb-not-react`). Расхождения либо приводятся к tweb, либо
   объявляются у строки с номером.
3. **Первый приоритет — режим аватара.** Задачи 0а-2, 0а-3, 0б-1, 0б-10 волны 7, 2D-27 и
   `SignUpCard.solid.tsx` должны получить `AvatarEdit` + редактор без временных мостов.
4. **Без стековых PR.** Каждая задача — отдельный PR от `main`.

## Карта медиаредактора tweb (`812502980`)

### Модули (`src/components/mediaEditor/**`, `wc -l`)

| Папка | Файлы (строк) | Итого |
|---|---|---|
| корень | `index.ts` 189 (три входа `openMediaEditorFrom*`, «летящий» canvas), `mediaEditor.tsx` 198 (оверлей, фокус-трап, `appNavigationController`, подтверждение выхода), `context.ts` 283 (стор, история, `canFinish`), `toolbar.tsx` 180, `topbar.tsx` 82 (закрыть/undo/redo, Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y), `types.ts` 57, `utils.ts` 191 (`snapToViewport`, `snapToAngle`, `processHistoryItem`, `fontInfoMap`, качества видео), `adjustments.ts` 85, `brushesSvg.tsx` 588, `colorPicker.tsx` 200, `createStoredValue.ts` 64, `createStoredColor.ts` 43, `finishButton.tsx` 34, `largeButton.tsx` 27, `rangeInput.tsx` 76, `stepInput.tsx` 68, `renderProgressCircle.tsx` 35, `support.ts` 39 (`supportsVideoEncoding`, `MAX_EDITABLE_VIDEO_SIZE` = 100 МБ), `useIsMobile.ts` 32 | 2 471 |
| `canvas/` | `imageCanvas.tsx` 118, `mainCanvas.tsx` 51, `cropHandles.tsx` 474, `rotationWheel.tsx` 328, `brushCanvas.tsx` 340, `brushPainter.ts` 240, `resizableLayers.tsx` 476, `textLayerContent.tsx` 323, `stickerLayerContent.tsx` 47, `videoControls.tsx` 637 (+ `.module.scss` 293), `useVideoControlsCanvas.ts` 78, `initVideoPlayback.ts` 121, `createVideoForDrawing.ts` 68, `useFinalTransform.ts` 187, `animateToNewRotationOrRatio.ts` 64, `getConvenientPositioning.tsx` 71, `useCropOffset.ts` 20, `useNormalizePoint.ts` 26, `useProcessPoint.ts` 23, `previewBrushSize.tsx` 27 | 3 719 (+293) |
| `tabs/` | `tabs.tsx` 84 (пять вкладок `:15-21`), `tabContent.tsx` 122, `adjustmentsTab.tsx` 173, `cropTab.tsx` 163, `brushTab.tsx` 161, `textTab.tsx` 170, `stickersTab.tsx` 335 | 1 208 |
| `finalRender/` | `createFinalResult.ts` 259, `renderToImage.ts` 69, `renderToActualVideo.ts` 624, `renderToVideoGIF.ts` 180, `createMp4VideoEncoder.ts` 48, `calcCodecAndBitrate.ts` 24, `getResultSize.ts` 51, `getResultTransform.ts` 68, `getScaledLayersAndLines.ts` 47, `drawTextLayer.ts` 90, `drawStickerLayer.ts` 32, `imageStickerFrameByFrameRenderer.ts` 50, `lottieStickerFrameByFrameRenderer.ts` 86, `videoStickerFrameByFrameRenderer.ts` 74, `generateVideoPreview.ts` 98, `spawnAnimatedPreview.ts` 67, `types.ts` 10, `constants.ts` 2 | 1 879 |
| `webgl/` | `shaderSources.ts` 330 (динамический импорт, `initWebGL.ts:23`), `initWebGL.ts` 56, `loadTexture.ts` 67, `draw.ts` 55, `initShaderProgram.ts` 33, `initBuffers.ts` 19 | 560 |
| стили | `mediaEditor.scss` 1466 (импорт `mediaEditor.tsx:8`), `scss/fonts/_mediaEditorFonts.scss` 56 (`scss/fonts.scss:3`), 7 TTF в `public/assets/fonts` | 1 522 |

Прямые зависимости вне папки, которых больше никто не использует: `helpers/getFileAndOpenEditor.ts`
129, `components/avatarEdit.ts` 417, `helpers/solid/withCurrentOwner.ts` 8,
`helpers/object/exceptKeys.ts` 11, `helpers/createImageAndURLFromBlob.ts` 24,
`helpers/animateImageToTarget.ts` 47, `helpers/video/detectVideoHasSound.ts` 87. Итого около 780 строк.
Настройки кисти и текста лежат в `state.settings.mediaEditor` (`config/state.ts:162-171`,
по умолчанию `:590-592`). Ключей лэнгпака `MediaEditor.*` — 71 (`lang.ts:1127-1187`, `:4643-4652`).

### Зависимости и что у нас уже есть

| Зависимость tweb | Где используется | У нас |
|---|---|---|
| WebGL 1: один фрагментный шейдер с 11 uniform-настройками (`shaderSources.ts:54-64`) и трансформом (`:7-12`) | `imageCanvas`, `createFinalResult` | шейдер перенесён дословно в React-файл `mediaEditor/enhanceGL.ts` (492). Порт берёт файлы `webgl/*`, наш файл удаляется |
| WebCodecs `VideoEncoder` + `mediabunny` (`Output`, `Mp4OutputFormat({fastStart:'in-memory'})`, `EncodedVideoPacketSource('avc')`), аудио `AudioEncoder('opus')` (`renderToActualVideo.ts:140`, `:554-624`, `createMp4VideoEncoder.ts:11-38`). ffmpeg, wasm и `MediaRecorder` не используются | видео, GIF-режим | `mediabunny` ^1.51.0 есть; `videoExport.ts` (174) делает то же иначе (seek вместо `requestVideoFrameCallback`) и удаляется |
| lottie: `lottieLoader.loadAnimationWorker({noOffscreen, skipFirstFrameRendering})` + `LottiePlayer` (`lottieStickerFrameByFrameRenderer.ts:28-37`) | финальный рендер стикеров | есть (`lib/lottie/lottieLoader.ts:231`, `lottiePlayer.ts:41-45`) |
| `wrapSticker` (`stickerLayerContent.tsx:19-29`) | слой стикера | есть (`components/wrappers/sticker.ts`, 382) |
| `SuperStickerRenderer` (194), `EmoticonsSearch` (`emoticonsDropdown/search.tsx`, 199), `wrapStickerSetThumb` (129), `getStickerSetInput` | вкладка стикеров (через `useHotReloadGuard`, `stickersTab.tsx:24`) | **нет**: каталога `emoticonsDropdown/` нет, наш `emoji/StickersTab.tsx` — React. Вопрос В-2 |
| `appStickersManager.getRecentStickersStickers`/`getAllStickers`/`getStickerSet`/`searchStickers`/`getPremiumStickers`/`getStickersByEmoticon` (`stickersTab.tsx:32`, `:33`, `:175`, `:267`, `:273`, `:277`) | вкладка стикеров | наш `stickersManager`: `recent`, `mySets`, `getStickerSet`, `searchSets`, `searchByEmoji` (`core/managers/stickersManager.ts:107-168`); премиум-стикеров нет — ОМ-4 |
| шрифты: 8 `FontKey` (`types.ts:39`), `fontInfoMap` (`utils.ts:136-177`), `@font-face` из TTF | текст | шрифты подключены пакетами `@fontsource/*` (`package.json:22-29`) в React-редакторе (`MediaEditor.tsx:12-18`) |
| `SwipeHandler`, `useSwipe` | кисть, кроп, слои, колесо, таймлайн | `core/dom/swipeHandler.ts` (549) есть; `useSwipe` нет |
| `ripple`, `RippleElement`, `IconTsx`, `Space`, `Scrollable`/`ScrollableX`, `resizeObserver`, `colorPicker.ts`, `positionMenu`, `createContextMenu`, `focusTrap`, `overlayCounter`, `shortcutListener`, `appNavigationController`, `confirmationPopup`, `LazyLoadQueue` | повсюду | есть: `components/ripple.ts`, `rippleElement.solid.tsx`, `iconTsx.solid.tsx`, `space.solid.tsx`, `scrollable.ts`, `resizeObserver.ts`, `colorPicker.ts`, `helpers/positionMenu.ts`, `helpers/dom/createContextMenu.ts`, `helpers/dom/focusTrap.ts`, `helpers/overlayCounter.ts`, `helpers/shortcutListener.ts`, `core/navigation/appNavigationController.ts`, `popups/popupPeer.ts:249`, `core/lazyLoadQueue.ts` |
| `buttonIconTsx`, `progressCircleSVG`, `tooltip`, `helpers/solid/{withCurrentOwner,createMiddleware,track,heightTransition}`, `helpers/{objectUrl,createPoster,createImageAndURLFromBlob,animateImageToTarget}`, `dom/{handleVideoLeak,isTargetAnInput,tabList}`, `number/nMap`, `object/{exceptKeys,getDeepProperty}`, `schedulers/asyncThrottle`, `string/toHHMMSS`, `video/detectVideoHasSound`, `environment/videoMimeTypesSupport`, `config/stickerType` | повсюду | **нет** — портируются в МР-1 и МР-7 |
| `lib/solidjs/hotReloadGuard(Provider)` | `stickersTab.tsx:24`, `createStoredValue.ts:27`, `openMediaEditor` | **нет** — прямые импорты, Отступление ВМ-3 |
| `lib/managers` (`AppManagers`) | `context.ts` | у нас `Managers` из `client/bootstrap` |

### Внешние входы (кто открывает редактор у tweb)

| Вызывающий | Как | Режим | У нас |
|---|---|---|---|
| `AvatarEdit` (`avatarEdit.ts:235-270`) ← `editPeer.ts:57` (профиль `editProfile.tsx:294`, `editChat.tsx:193`, `editBot.tsx:91`), `newGroup.tsx:45`, `newChannel.tsx:26`, `pages/cards/SignUpCard.tsx:38`, сообщества | `getFileAndOpenEditor({isEditingForAvatar: true, isEditingForumAvatar, acceptMediaTypes: ['photo', 'video']})` | аватар: фото и видео | `AvatarCropper` в 4 React-экранах; `SignUpCard.solid.tsx` без кропа; временный `AvatarEdit` в ветке `origin/feat/w7-0a-3-new-channel-tab` |
| `pickAvatarAndUpload` (`avatarEdit.ts:139-158`) ← `editContact.tsx:73` (личное фото), `:89` (предложить), `privacy/profilePhoto.tsx:94` (фото для скрытых) | то же + загрузка в `handleAvatarEditorResult` (`:72-135`) | аватар контакта, предложение, `fallback` | `EditContactView` + `AvatarCropper`; `fallback` нет — ОМ-2 |
| `editAndSetOwnAvatar` (`avatarEdit.ts:163-193`) ← `chat/bubbles.ts:8239` («Установить фото» в сервисном бабле предложения) | `openAvatarEditorWithFile` (`:197-233`) | принять предложенное фото через редактор | кнопки нет (`components/chat/serviceMessage.ts:30-33`); ручка `contacts.acceptPhotoSuggestion` (`contactsManager.ts:327-330`) не вызывается из UI |
| `popups/newMedia.tsx:1514-1555` (кнопка «equalizer» у вложения) | `openMediaEditorFromMedia({imageType: 'image/jpeg', imageQuality, editingMediaState, canImageResultInGIF})` | медиа при отправке | React `SendMediaPopup.tsx:412-425` → React `MediaEditor` |
| `chat/input.ts:5542-5655` (`editMediaWithEditor`) | `openMediaEditorFromMedia`/`…NoAnimation` → `showNewMediaPopup(…, {editResult})` | правка медиа отправленного сообщения | нет (правка сообщения — только текст, `chat_handler.go:691-696`) — ОМ-1 |
| `popups/createPoll/mediaAttachment.tsx:148`, `:325` | `getFileAndOpenEditor` / `openMediaEditorFromMedia` | медиа в опросе | нет — ОМ-3 |
| истории | — | в `812502980` создание истории редактор **не** использует (`components/stories/*` — только просмотр) | `core/hooks/useSidebarStories.tsx:66-71` → React `MediaEditor` → Отступление ВМ-2 |

## Режим аватара у tweb — срез этапа 1

Флагов три: `isEditingForAvatar`, `isEditingForumAvatar`, `isVideoAvatarMode` (`context.ts:176-178`,
`mediaEditor.tsx:33-36`). Флага `standaloneCrop` нет.

- **Вкладки не фильтруются.** В режиме аватара доступны все пять (`tabs.tsx:15-21`,
  `toolbar.tsx:170-176`). Стартовая вкладка — `crop` для фото, `adjustments` для видео
  (`getFileAndOpenEditor.ts:89`, `avatarEdit.ts:228`). Для `crop` ставится
  `cropTabAnimationProgress = 1` (`context.ts:212-216`).
- **Квадрат сразу.** Если `isEditingForAvatar && !currentImageRatio`, то
  `scale = max(w2/w1, h2/h1)`, `currentImageRatio = 1`, `fixedImageRatioKey = '1x1'`
  (`imageCanvas.tsx:70-84`). В `cropTab` все пропорции, кроме «Квадрат», получают
  `disabled={isEditingForAvatar}` (`cropTab.tsx:69`, `:76`, `:90-157`).
- **Маска.** Скругление `min(w, h) / (isEditingForumAvatar ? 3 : 2)`: круг для обычного аватара,
  скруглённый квадрат для форума (`cropHandles.tsx:376-381`, SVG-маска `rx` `:441-470`).
- **Размер фото** — не больше 800 px по большей стороне (`createFinalResult.ts:105-113`). Выход —
  `toBlob('image/jpeg', imageQuality)` (`renderToImage.ts:57-62`).
- **Видео-аватар:**
  - `videoMuted = true` (`context.ts:205-207`); кнопка звука скрыта (`videoControls.tsx:327`), выбор
    качества тоже (`adjustmentsTab.tsx:64`);
  - обрезка не длиннее 10 с (`videoControls.tsx:22`, `:119-133`), кадр обложки зажат внутри обрезки
    (`:137-144`, `:452-468`);
  - кодирование: не больше 30 fps и 10 с (`renderToActualVideo.ts:78-85`), битрейт не выше 1,5 Мбит/с
    (`:176-179`), сторона не больше 800, размеры чётные (`createFinalResult.ts:89-97`);
  - результат: обложка JPEG + MP4 + `video_start_ts`. `computeVideoStartTs` (`avatarEdit.ts:34-41`)
    считает `clamp(cover − trimStart, 0, clipLen)` в секундах от начала обрезанного клипа.
- **Выход редактора** — `MediaEditorFinalResult` (`createFinalResult.ts:25-46`): `preview`,
  `getResult()` (у видео — промис, кодирование идёт в фоне после закрытия), `isVideo`, `width`,
  `height`, `videoDuration`, `editingMediaState`, `animatedPreview`, `creationProgress`.

Отсюда минимальный срез этапа 1: каркас, WebGL-холст, вкладки «Настройки» и «Кроп», финальный рендер
фото, `getFileAndOpenEditor` (пока только фото) и `AvatarEdit` (ветка фото). Вкладки «Текст», «Кисть» и
«Стикеры» в этом срезе временно скрыты: у tweb они видны и в режиме аватара, поэтому это объявленная
временная мера с номером, вопрос В-1. Видео-аватар — этап 2.

## Что у нас сейчас и что удаляется

| Файл | Строк | Кто зовёт | Удаляется |
|---|---|---|---|
| `components/settings/AvatarCropper.tsx` (+ `.module.scss`) | 133 | `EditProfile.tsx:10`, `:299`; `NewGroupFlow.tsx:12`, `:206`; `EditContactView.tsx:17`, `:172`; `group/GroupEditFlow.tsx:15`, `:262` | **МР-6** |
| видео-аватар без редактора `EditProfile.tsx:123-176` (`onVideoPick`: постер с canvas, два аплоада, без обрезки и `video_start_ts`) | ~55 | `EditProfile.tsx:233-241` | **МР-8** (или вместе с файлом в 2D-27, если она раньше) |
| `components/mediaEditor/MediaEditor.tsx` + `MediaEditor.module.scss` (`z-index: 4200`, `:13`) | 1689 + 704 | `messages/SendMediaPopup.tsx:13`, `:412-425`; `core/hooks/useSidebarStories.tsx:14`, `:66-71` | **МР-14** |
| `mediaEditor/{sceneRender,enhanceGL,editorMath,stickerAssets,videoExport,StickerPicker,editorHistory,videoMath,stickerLayer,videoSupport}.ts(x)` + 8 тестов | 2 189 + ~1 100 | только `MediaEditor.tsx` | **МР-14** |
| временный `components/avatarEdit.ts` из `origin/feat/w7-0a-3-new-channel-tab` (107, `// ВРЕМЕННО до 2D-27`, `:9`, `:61`, `:72`) | 107 | `sidebarLeft/tabs/newChannel.solid.tsx` | **МР-5** заменяет файл портом целиком; метки `ВРЕМЕННО до 2D-27` снимает МР-5, а не 2D-27 |
| пин `lazyChunks.test.ts:140` (`MediaEditor.tsx` ← `SendMediaPopup.tsx`) | — | — | **МР-2** добавляет пин нового входа, **МР-14** снимает старый |
| `web-client/backlogs/frontend/avatar-cropper-solid-port.md` | — | — | **МР-6** (долг закрыт) |

## Бэкенд видео-аватара

- `POST /me/photos` принимает `{media_id, video_media_id?}` (`profile_handler.go:408-436`);
  `video_start_ts` нет. В БД есть `profile_photos.video_media_id`
  (`adapter/repo/postgres/authrepo.go:268`), колонки `video_start_ts` нет.
- Ответ галереи видео теряет: `galleryPhoto()` строит `domain.NewPhoto(p.MediaID, …)` без видео
  (`profile_handler.go:404-406`), у `domain.Photo` нет `video_sizes`. Долг записан в
  `backend/backlogs/profile-video-avatar-wire.md`. Клиент поэтому пишет `videoMediaId: undefined`
  (`core/managers/profileManager.ts:146-148`), хотя проигрывание уже есть
  (`peerProfileAvatars.ts:806-950`).
- Фото чата — `PUT /chats/{id}/photo {media_id}` (`group_handler.go:121-139`); фото контакта и
  предложение — `{media_id}` (`contact_photo_handler.go:40`, `:98`). Видео нет ни там, ни там.
- tweb шлёт `photos.uploadProfilePhoto({file, video, video_start_ts, fallback})`
  (`appProfileManager.ts:1031-1053`), фото чата — `inputChatUploadedPhoto` с видео
  (`appChatsManager.ts:903`), контакт — `uploadContactProfilePhoto({…, suggest, save})`.

По DoD 2a бэкенд делается первым: задача **МР-Б1** (этап 2, идёт параллельно этапу 1).
`fallback`-фото на сервере нет — ОМ-2.

## Global Constraints

- **Источник порта — файл tweb `812502980`, а не наш React** (спека § 6a). Наш `MediaEditor.tsx` —
  только список сценариев. Сценарий, которого нет у tweb, либо обосновывается комментарием у строки
  с номером Отступления (ВМ-n), либо удаляется. Не писать «сохрани текущее поведение».
- **DoD — спека § 9, все 14 пунктов.** Особо: п. 3–4 (мутация прогнана ФАКТИЧЕСКИ, реальный вывод
  vitest — в теле коммита), п. 5 (после `onClose` в `getOverlayRoot()` нет `.media-editor__overlay`,
  Solid-корень снят), п. 10 (стенд, числа «было/стало»), п. 14 (React-файл удалён в том же PR, где
  его последний потребитель ушёл; число `.tsx` с `from 'react'` без тестов уменьшилось).
- **DoD 2a.** Чего нет на бэкенде (видео-аватар), то делается на бэкенде отдельным PR (МР-Б1), а
  клиент остаётся дословным. Если бэкенд не входит в программу — пункт «Отложено» (ОМ-n) и
  комментарий у строки `// ОМ-n медиаредактор`.
- **Нумерация программы своя:** задачи `МР-n` (бэкенд — `МР-Б1`), Отступления `ВМ-n`, Отложено
  `ОМ-n`. Номера О-n других планов не занимаются. Временные меры — `// ВРЕМЕННО до МР-n`; задача,
  которая меру снимает, проверяет `git grep -n "ВРЕМЕННО до МР-n"` → пусто.
- **Пути — как у tweb:** `web-client/src/components/mediaEditor/**`, `helpers/getFileAndOpenEditor.ts`,
  `components/avatarEdit.ts`. JSX-файлы — `.solid.tsx` с прагмой `/** @jsxImportSource solid-js */`
  (маска `shared/solid/fileRuntime.ts:12`), импортов `react` нет (скан `shared/solid/boundary.test.ts`).
  **Коллизия имён:** на регистронезависимой APFS `mediaEditor.tsx` tweb и наш `MediaEditor.tsx` не
  уживаются. Поэтому корень — `mediaEditor.solid.tsx`. После МР-14 имя остаётся: `.solid.tsx` — это
  наше правило для всех JSX-файлов.
- **Импорты — алиасами tweb** (`@components/…`, `@helpers/…`, `@lib/…`, `@environment/…`, `@config/…`;
  `vite.config.ts:35-44`). Недостающий хелпер портируется файлом по пути tweb (МР-1/МР-7), а не
  заменяется своим.
- **Стили — файлом tweb рядом с компонентом:** `components/mediaEditor/mediaEditor.scss` (импорт из
  `mediaEditor.solid.tsx`, как tweb `:8`). Так 1466 строк остаются в ленивом чанке.
  `videoControls.module.scss` — тоже файлом. `_mediaEditorFonts.scss` — в `styles/tweb/fonts/`.
  Сверка — `node tools/tweb-parity/scss-parity.mjs mediaEditor.scss`, инвентарь перегенерируется
  (`styles.json:9-20`: сейчас `ported:false`, 4 из 137 классов).
- **Слои — порядком DOM, `z-index: 4`** (tweb `mediaEditor.scss:14`). Наш хак 4200
  (`MediaEditor.module.scss:13`, 2C О-3, проп `zIndex` в `popups/indexTsx.solid.tsx`) уходит в МР-14.
  Пока жив React `shared/ui/Popup` на 4090, вызов из него идёт через временную меру МР-12.
- **Ленивость.** Редактор грузится `await import('@components/mediaEditor')` (tweb
  `getFileAndOpenEditor.ts:71`); `mediabunny` и `shaderSources` — динамическими импортами внутри
  (tweb `createMp4VideoEncoder.ts:11`, `initWebGL.ts:23`). Пин `lazyChunks.test.ts` — на новый вход.
- **Строки langpack — ключами tweb** (план `2026-08-30-i18n-langpack.md`). У tweb 71 ключ
  `MediaEditor.*`, у нас 37; 46 не хватает, 12 наших лишних (`BrushSize`, `Cover`, `Crop`,
  `Discard.Text`, `Draw`, `Flip`, `Mute`, `Rotate`, `StickerAnimatedUnsupported`, `StickerNotRendered`,
  `TextSize`, `Unmute`) удаляются в МР-14 вместе с React-редактором. Переводы — `src/i18n/dict.*.ts`.
- **Настройки редактора** (`state.settings.mediaEditor`, tweb `config/state.ts:162-171`) — через
  `stores/appSettings.solid.ts` (`useAppSettings`), строками в таблицу `APP_SETTINGS_KEYS` (её
  расхождение 1). Отдельного хранилища нет.
- **Никакого `git add -A` и `git stash`.** Только явные пути (память `no-git-add-all-while-agents-run`).
- **vitest — только из `web-client/`** (`cd web-client && npx vitest run …`). Перед каждым коммитом —
  полный прогон `--maxWorkers=4`, `npx tsc --noEmit`, `npx oxlint --type-aware` по изменённым.
  `realtimeBridge` флакает ~1 из 10 — перепроверять изолированно. Бэкенд — `go test` затронутых
  пакетов, `go vet ./...`.
- **WebGL в happy-dom отсутствует.** `getContext('webgl')` там возвращает `null`, моков WebGL в
  репозитории нет (2D-холст подменяет `test/fakeCanvas.ts`). МР-1 заводит `test/fakeWebGL.ts` —
  регистратор вызовов (шейдеры, uniform, `texImage2D`, `drawArrays`). Тесты проверяют логику
  (контекст, история, геометрия, размеры результата, флаги режима, DOM и классы), а не пиксели.
  Пиксели проверяются на стенде и в Playwright.
- **Комментарии и коммиты — по-русски**, объясняют ПОЧЕМУ. Шапка порта — `порт tweb/src/…:строки`,
  расхождения — нумерованным списком в шапке.
- **Референс.** Дока подсистемы в `docs/tweb/` нет. МР-0 заводит `docs/tweb/media-editor.md` (по
  конвенциям `docs/tweb/README.md`), каждая задача обновляет его секцию «у нас» в своём PR.
- **Стенд** — по `common.md` программы (https://web.telegram.local, проект `msgrverify`, блокировка
  `stand.lock`, возврат стенда к `origin/main`). Браузер — Chrome DevTools MCP в своём
  `isolatedContext`. Во встроенном браузере — `?noSharedWorker=1`.
- **E2E-сторожа на каждом шаге стенда** (`e2e-scenarios.md:17-23`): ошибка в консоли, ответ
  4xx/5xx, `NaN`/`undefined`/`null` в адресе запроса, вечный лоадер, необработанный reject в воркере.
- **Производительность — числами в коммит:** время от клика до первого кадра на холсте, финальный
  рендер фото 4000×3000, кодирование 10-секундного видео-аватара, размер ленивого чанка (gzip) до и
  после.

## Порядок этапов и зависимости

```
МР-0 референс docs/tweb/media-editor.md
  │
ЭТАП 1  редактор для аватара (фото)                                    МР-Б1 бэкенд видео-аватара
  МР-1 опора (хелперы, fakeWebGL, ключи) ──► МР-2 каркас оверлея         (параллельно, отдельный PR)
      ──► МР-3 WebGL-холст + «Настройки» ──► МР-4 кроп и режим аватара          │
      ──► МР-5 финальный рендер фото + getFileAndOpenEditor + AvatarEdit (фото)  │
      ──► МР-6 врезка аватара: SignUpCard, EditProfile, NewGroupFlow,           │
               GroupEditFlow, EditContactView; снос AvatarCropper               │
          ═══► разблокированы 0а-2, 0а-3, 0б-1, 0б-10 (волна 7), 2D-27           │
ЭТАП 2  видео (МР-5; МР-8 ещё и МР-Б1)                                          │
  МР-7 видео в редакторе (таймлайн, кодирование) ──► МР-8 видео-аватар + ◄──────┘
       «Установить фото» (editAndSetOwnAvatar)
ЭТАП 3  остальные вкладки (после МР-3; параллельно этапу 2)
  МР-9 кисти   МР-10 текст и слои   МР-11 стикеры + GIF-режим (МР-10)
ЭТАП 4  медиа при отправке и истории (этапы 2 и 3)
  МР-12 SendMediaPopup → openMediaEditorFromMedia   МР-13 истории → openMediaEditorFromMediaRaw
      ──► МР-14 снос React-редактора, zIndex 4200, @fontsource, лишних ключей
```

**Почему аватар первым и без видео.** Семь потребителей аватара (пять задач волны 7 и 2D, карточка
регистрации, три React-экрана) ждут только фото-кроп. Видео-аватару нужен бэкенд (МР-Б1) и самая
тяжёлая часть редактора — реальное кодирование (`renderToActualVideo.ts`, 624 строки). Если ставить
её первой, потребители простоят лишние ~10 дней. Интерфейс `AvatarEditPayload` с `video?` и
`videoStartTs?` вводится сразу в МР-5, поэтому МР-8 не трогает потребителей: ветка видео
просто начинает заполнять эти поля.

**Почему React-редактор живёт до этапа 4.** Попап отправки и истории пользуются вкладками «Кисть»,
«Текст», «Стикеры» и видео. Пока их нет в порте, замена ухудшила бы функцию. Две копии редактора
живут одновременно с МР-2 по МР-14. Это объявленное исключение из DoD 14, и оно снимается задачей
МР-14 (Отступление ВМ-4).

## Оценка объёма (дни одного исполнителя; порт + тесты + стенд + ревью)

| Этап | Задачи | Строк tweb | Дней |
|---|---|---|---|
| — | МР-0 референс | — | **1** |
| 1 | МР-1…МР-6 | ~5 500 TS + 1 466 SCSS (каркас ~1 500, холст и кроп ~1 480, вкладки 542, финальный рендер ~700, webgl 560, входы и хелперы ~700) | **20** |
| 2 | МР-Б1, МР-7, МР-8 | ~2 400 TS + 293 SCSS; бэкенд — 3 ручки, миграция, провод | **4 (бэкенд) + 10** |
| 3 | МР-9…МР-11 | ~4 000 (кисти ~1 660, текст и слои ~1 030, стикеры и GIF ~1 300 с тремя файлами `emoticonsDropdown`) | **16** |
| 4 | МР-12…МР-14 | врезки и снос (минус ~5 700 строк нашего React) | **5** |
| **Итого** | | ~11 900 TS/TSX + ~1 800 SCSS | **≈ 56** |

Критический путь для аватара: МР-0 → МР-1 → МР-2 → МР-3 → МР-4 → МР-5 → МР-6 = **21 день**. С двумя
исполнителями (МР-Б1 и этап 3 идут параллельно) программа занимает календарно ≈ 35–40 дней. Если
детальная работа над этапом разойдётся с оценкой больше чем на 25 %, это выносится пользователю.

## E2E-сценарии — ворота этапов

Каталог — `docs/testing/e2e-scenarios.md` (ветка `origin/docs/e2e-scenarios-plan`). Пока
Playwright-набор не влит, сценарий прогоняется на стенде вручную со сторожами. **До** — на `main`,
**после** — на ветке задачи. Регресс против «до» блокирует мерж.

| Этап | P0 (зелёные до и после) | P1/P2 (регресс блокирует) |
|---|---|---|
| 1 | AUTH-01 (регистрация с фото), ST-01 (фото квадратное, не сплющено), GR-01 (создание группы с фото), CH-01, P0-01, P0-07 (смена фото группы) | GR-09, RS-08, **ME-14** (кроп аватара), **ME-16** (доступность редактора) |
| 2 | ST-01, P0-07 | **ME-15** (видео-аватар), **ME-17** (принять предложенное фото), RS-02 (контакт) |
| 3 | — (потребителей этапа нет) | **ME-14** повторно (вкладки видны в режиме аватара) |
| 4 | ME-01, P0-01…P0-10 | ME-02, ME-03, ME-05, **ME-11** (редактор перед отправкой: кроп, рисование), LS-11 (истории) |

**Пробел каталога.** Сценариев редактора в каталоге почти нет (только ME-11, P2). МР-0 добавляет в
каталог (PR в ветку каталога или, после влития, в `main`) четыре сценария с ожиданиями из кода tweb:

- **ME-14** — аватар фото: профиль → камера → выбор JPEG 4000×3000 → открыт кроп, рамка квадратная,
  маска круглая; пропорции «Свободно»/«Оригинал»/«3:2»… заблокированы, «Квадрат» — нет; поворот на
  90° → «Готово» → превью летит в круг; у второго аккаунта аватар квадратный ≤ 800 px (tweb
  `imageCanvas.tsx:70-84`, `cropTab.tsx:69-157`, `cropHandles.tsx:376-381`,
  `createFinalResult.ts:105-113`).
- **ME-15** — видео-аватар: выбор MP4 30 с → вкладка «Настройки», звук выключен и кнопки звука нет,
  обрезка ≤ 10 с, обложка внутри обрезки → «Готово» → кольцо прогресса на аватаре → у второго
  аккаунта в профиле играет видео с кадра обложки (`videoControls.tsx:22`, `:119-144`, `:327`,
  `avatarEdit.ts:34-41`, `:327-392`).
- **ME-16** — доступность: `role="dialog"`, `aria-modal`, фокус на «Закрыть», Tab по вкладкам со
  стрелками, Esc спрашивает «Отменить изменения?» (порт tweb `e2e/accessibilityMediaEditor.spec.ts`,
  107 строк; `mediaEditor.tsx:123-141`, `:144-156`).
- **ME-17** — B предлагает A фото → у A в сервисном бабле «Установить фото» → редактор → «Готово» →
  фото у A стало аватаром, тост `UserInfo.SuggestedPhotoApplied` (`bubbles.ts:8236-8249`,
  `avatarEdit.ts:163-193`).

---

## МР-0: референс `docs/tweb/media-editor.md`

**Файлы:** создать `docs/tweb/media-editor.md`; изменить `docs/tweb/README.md` (строка индекса),
`.claude/skills/tweb-parity/SKILL.md` (строки «Медиаредактор» в таблицах «Симптом → куда смотреть» и
«Подсистема → док»), каталог e2e (ME-14…ME-17).

- [ ] **Шаг 1:** из карт этого плана собрать док по конвенциям `docs/tweb/README.md`: § 1 входы и
  жизненный цикл оверлея (`mediaEditor.tsx:47-198`, `index.ts`), § 2 контекст и история
  (`context.ts`), § 3 холст и WebGL, § 4 кроп и режим аватара, § 5 финальный рендер (фото, GIF,
  видео), § 6 вкладки, § 7 `AvatarEdit` и загрузка, § 8 «у нас» (таблица «Что у нас сейчас» из этого
  плана), § 9 чеклист проверки после порта.
- [ ] **Шаг 2:** сценарии ME-14…ME-17 — в каталог.
- [ ] **Шаг 3:** коммит явными путями.

**Готово когда:** `docs/tweb/README.md` ссылается на док, скилл называет его в обеих таблицах.
**Оценка:** 1 день. **Зависимости:** нет.

---

## Этап 1 — редактор для аватара (фото)

### Задача МР-1: опора — хелперы tweb, фейк WebGL, ключи лэнгпака

**Порт (файлами, по путям tweb):** `helpers/solid/withCurrentOwner.ts` (8),
`helpers/solid/createMiddleware.ts`, `helpers/solid/track.ts`, `helpers/solid/heightTransition.ts`,
`helpers/object/exceptKeys.ts` (11), `helpers/object/getDeepProperty.ts`, `helpers/number/nMap.ts`,
`helpers/schedulers/asyncThrottle.ts`, `helpers/dom/tabList.ts`, `helpers/dom/isTargetAnInput.ts`,
`helpers/objectUrl.ts`, `helpers/createImageAndURLFromBlob.ts` (24), `helpers/animateImageToTarget.ts`
(47), `components/buttonIconTsx.solid.tsx`, `config/stickerType.ts`. Перед портом каждого —
`git grep` по имени: если у нас есть эквивалент под другим путём (например, `helpers/solid/useElementSize.ts`
вместо `hooks/useElementSize`), берётся он, а расхождение пути записывается в шапку порта.
Видео-хелперы (`createPoster`, `detectVideoHasSound`, `handleVideoLeak`, `useSwipe`, `toHHMMSS`,
`environment/videoMimeTypesSupport`) — в МР-7.

**Файлы:**
- Создать: перечисленные хелперы + тест на каждый, у которого есть логика (`exceptKeys`,
  `getDeepProperty`, `nMap`, `asyncThrottle`, `tabList`, `createImageAndURLFromBlob`, `objectUrl`);
  `web-client/src/test/fakeWebGL.ts` + `fakeWebGL.test.ts`
- Изменить: `web-client/src/lang.ts`, `src/i18n/dict.{en,ru}.ts` — 46 недостающих ключей
  `MediaEditor.*` дословно из tweb `lang.ts:1127-1187`, `:4643-4652`

**Интерфейсы:**
- Даёт: `installFakeWebGL(): {calls: GlCall[], restore(): void}` — подменяет
  `HTMLCanvasElement.prototype.getContext` для `'webgl'`, отдаёт объект с методами WebGL 1, которые
  зовут `webgl/*` tweb (`createShader`, `shaderSource`, `compileShader`, `getShaderParameter` → `true`,
  `createProgram`, `attachShader`, `linkProgram`, `getProgramParameter` → `true`, `useProgram`,
  `getAttribLocation`, `getUniformLocation`, `uniform1f`/`uniform2f`/`uniform1i`, `createBuffer`,
  `bindBuffer`, `bufferData`, `createTexture`, `bindTexture`, `texImage2D`, `texSubImage2D`,
  `texParameteri`, `pixelStorei`, `viewport`, `clearColor`, `clear`, `drawArrays`,
  `getExtension('WEBGL_lose_context')` → `{loseContext}`), и пишет каждый вызов в `calls`.
  Для `'2d'` делегирует в `installFakeCanvas()` (`test/fakeCanvas.ts:32`).

```ts
// web-client/src/test/fakeWebGL.ts — форма (реализация в задаче)
export type GlCall = {name: string; args: unknown[]}
export function installFakeWebGL(): {calls: GlCall[]; restore: () => void}
```

- [ ] **Шаг 1: прочитать** исходники хелперов tweb и тесты tweb, если есть; наш `test/fakeCanvas.ts`.
- [ ] **Шаг 2: падающие тесты:** (а) `exceptKeys({a:1,b:2,c:3}, ['b'])` → `{a:1,c:3}`;
  (б) `getDeepProperty({a:{b:{c:5}}}, 'a.b.c')` → 5; (в) `nMap(5, 0, 10, 0, 100)` → 50;
  (г) `asyncThrottle`: три вызова за один тик дают один запуск, следующий вызов после резолва — ещё
  один; (д) `handleTabKeyDown` двигает фокус по `role="tab"` стрелками и Home/End;
  (е) `createImageAndURLFromBlob(не-картинка)` → `{ok: false}`, URL отозван;
  (ж) `installFakeWebGL`: `canvas.getContext('webgl')` не `null`, `drawArrays` попадает в `calls`,
  `restore()` возвращает `null`.
- [ ] **Шаг 3: убедиться, что падают.** **Мутации (фактически):** в `exceptKeys` не удалять ключ →
  (а) краснеет; в `createImageAndURLFromBlob` не звать `revokeObjectURL` на ошибке → (е) краснеет.
- [ ] **Шаг 4: реализовать** дословно; расхождения — в шапку.
- [ ] **Шаг 5:** ключи лэнгпака; `npx tsc --noEmit` ловит опечатку ключа в `LangPackKey`.
- [ ] **Шаг 6: коммит** явными путями, вывод мутаций — в тело.

**Готово когда:** все хелперы по путям tweb, `git grep -n "withCurrentOwner\|exceptKeys" web-client/src`
находит только новые файлы; 71 ключ `MediaEditor.*` в `lang.ts`.
**Оценка:** 2 дня. **Зависимости:** МР-0.

### Задача МР-2: каркас оверлея — `openMediaEditor`, контекст, история, тулбар

**Порт:** `mediaEditor.tsx` (198) → `components/mediaEditor/mediaEditor.solid.tsx`; `index.ts` (189),
`context.ts` (283), `types.ts` (57), `utils.ts` (191), `topbar.tsx` (82), `toolbar.tsx` (180),
`tabs/tabs.tsx` (84), `tabs/tabContent.tsx` (122), `finishButton.tsx` (34), `largeButton.tsx` (27),
`rangeInput.tsx` (76), `stepInput.tsx` (68), `useIsMobile.ts` (32), `mediaEditor.scss` (1466) — в
`components/mediaEditor/` с суффиксом `.solid.tsx` у JSX.

**Отступление ВМ-3.** `openMediaEditor(props, HotReloadGuardProvider)` (`mediaEditor.tsx:182`) —
у нас без второго параметра: `lib/solidjs/hotReloadGuard` нет, модули импортируются напрямую. Так же
сделано в `components/lottieAnimation.solid.tsx:26-30`. Комментарий у сигнатуры.

**Временная мера (при «А» на В-1).** `toolbar.solid.tsx` рендерит вкладки `text`, `brush`, `stickers`
скрытыми (`mediaEditorTabsOrder` фильтруется по списку готовых), с комментарием
`// ВРЕМЕННО до МР-9` / `МР-10` / `МР-11` у строки фильтра. `mainCanvas` пока без `BrushCanvas`,
`ResizableLayers`, `PreviewBrushSize` и `VideoControls` — те же метки (`VideoControls` —
`ВРЕМЕННО до МР-7`).

**Файлы:**
- Создать: перечисленные файлы; `mediaEditor.solid.test.tsx`, `context.test.ts`, `topbar.solid.test.tsx`
- Изменить: `lazyChunks.test.ts` — пин нового входа (`components/mediaEditor/index.ts` ленивый)

**Интерфейсы:**
- Потребляет: МР-1 (`withCurrentOwner`, `exceptKeys`, `tabList`, `buttonIconTsx`), `confirmationPopup`
  (`popups/popupPeer.ts:249`), `appNavigationController` (`core/navigation/appNavigationController.ts:458`,
  `:480`), `overlayCounter`, `createFocusTrap` (`helpers/dom/focusTrap.ts`), `getOverlayRoot`
  (`helpers/appWindow.ts:34`).
- Даёт (дословно tweb, кроме ВМ-3):

```ts
// components/mediaEditor/mediaEditor.solid.tsx
export type MediaEditorProps = {
  onClose: (hasGif: boolean) => void; managers: Managers;
  onEditFinish: (result: MediaEditorFinalResult) => void;
  onCanvasReady: (canvas: HTMLCanvasElement) => Promise<void>; onImageRendered: () => void;
  mediaSrc: string; mediaType: MediaType; getMediaBlob: () => Promise<Blob | null>;
  editingMediaState?: EditingMediaState; isEditingForAvatar?: boolean; isEditingForumAvatar?: boolean;
  canFinishWithoutChanges?: boolean; isVideoAvatarMode?: boolean; canImageResultInGIF?: boolean;
  dontCreatePreview?: boolean; initialTab?: string;
  imageType?: 'image/jpeg' | 'image/png'; imageQuality?: number;
}
export function openMediaEditor(props: MediaEditorProps): void // ВМ-3
// components/mediaEditor/index.ts
export function openMediaEditorFromMedia(args): void
export function openMediaEditorFromMediaNoAnimation(args): void
export function openMediaEditorFromMediaRaw(args): void
// components/mediaEditor/context.ts
export function createContextValue(props: MediaEditorProps): MediaEditorContextValue
export const useMediaEditorContext: () => MediaEditorContextValue
```

`MediaEditorFinalResult` в МР-2 объявляется типом в `finalRender/createFinalResult.ts` (без функции:
её тело — МР-5), чтобы `onEditFinish` типизировался с первого PR.

- [ ] **Шаг 1: прочитать** tweb `mediaEditor.tsx`, `index.ts`, `context.ts`, `topbar.tsx`, `toolbar.tsx`,
  `tabs/tabs.tsx`, `tabs/tabContent.tsx`, `mediaEditor.scss`; наш `MediaEditor.tsx:214-300` (только
  список сценариев: undo/redo, подтверждение выхода).
- [ ] **Шаг 2: падающие тесты** (`installFakeWebGL`; холст — заглушка до МР-3):
  (а) `openMediaEditorFromMediaRaw({…})` → в `document.body` один `.media-editor__overlay.night` с
  `role="dialog"`, `aria-modal="true"`; после `doubleRaf` снят `--hidden` (`mediaEditor.tsx:63-78`);
  (б) Esc (через `appNavigationController`) при `canFinish() === false` закрывает оверлей через 200 мс,
  `onClose(false)` вызван один раз, в DOM нет `.media-editor__overlay` — пин DoD 5;
  (в) при изменениях Esc открывает `confirmationPopup` с `MediaEditor.DiscardChanges`, отказ оставляет
  оверлей, согласие закрывает;
  (г) `canFinishWithoutChanges: true` → `canFinish()` сразу `true`;
  (д) `pushToHistory` + Ctrl+Z возвращает значение по пути `HistoryItem.path`, Ctrl+Shift+Z и Ctrl+Y
  повторяют (`topbar.tsx:17-55`); новый `pushToHistory` чистит `redoHistory` (`context.ts:220-225`);
  (е) `initialTab: 'crop'` → `editorState.currentTab === 'crop'` и `cropTabAnimationProgress === 1`;
  (ж) `isVideoAvatarMode: true` → `mediaState.videoMuted === true`, а `hasModifications()` через
  200 мс — `true` (клон снят раньше, `context.ts:201-207`);
  (з) при открытом оверлее `overlayCounter.isDarkOverlayActive === true`, после закрытия — `false`;
  (и) вкладки: `role="tablist"`, стрелка вправо переносит `aria-selected`.
- [ ] **Шаг 3: убедиться, что падают.** **Мутации:** не звать `appNavigationController.removeItem` в
  `onCleanup` → повторное открытие ловит два элемента навигации, тест «после закрытия в стеке нет
  элемента» краснеет; убрать `redoHistory.splice` → (д) краснеет; убрать `dispose()` в `onClose` —
  (б) краснеет.
- [ ] **Шаг 4: реализовать** дословно. Расхождения — в шапку каждого файла.
- [ ] **Шаг 5:** `node tools/tweb-parity/scss-parity.mjs mediaEditor.scss` — только объявленные
  расхождения; `node tools/tweb-parity/inventory.mjs`.
- [ ] **Шаг 6: коммит**; размер ленивого чанка (gzip) — в тело.

**Готово когда:** оверлей открывается и закрывается функцией без React; `boundary.test.ts` зелёный;
`scss-parity` без необъявленных расхождений. **Оценка:** 4 дня. **Зависимости:** МР-1.

### Задача МР-3: WebGL-холст и вкладка «Настройки»

**Порт:** `webgl/{shaderSources,initWebGL,loadTexture,draw,initShaderProgram,initBuffers}.ts` (560),
`canvas/imageCanvas.solid.tsx` (118), `canvas/mainCanvas.solid.tsx` (51), `canvas/useFinalTransform.ts`
(187), `canvas/useCropOffset.ts`, `useNormalizePoint.ts`, `useProcessPoint.ts`,
`canvas/initVideoPlayback.ts` (121 — его импортирует `imageCanvas.tsx:2`, для фото он не срабатывает),
`adjustments.ts` (85), `tabs/adjustmentsTab.solid.tsx` (173).

**Файлы:** создать перечисленные + `imageCanvas.solid.test.tsx`, `adjustmentsTab.solid.test.tsx`,
`webgl/initWebGL.test.ts`.

**Интерфейсы:**
- Потребляет: МР-2 (`useMediaEditorContext`, `editorState.imageCanvas`, `mediaState.adjustments`),
  МР-1 (`installFakeWebGL`, `createMiddleware`).
- Даёт: `initWebGL({gl, mediaSrc, mediaType, videoTime?, waitToSeek?}): Promise<RenderingPayload>`,
  `draw(gl, payload, params)`, `editorState.renderingPayload`, `editorState.mediaRatio`.

- [ ] **Шаг 1: прочитать** tweb `webgl/*`, `imageCanvas.tsx`, `mainCanvas.tsx`, `useFinalTransform.ts`,
  `adjustments.ts`, `adjustmentsTab.tsx`; наш `enhanceGL.ts` (только сверить шейдер: он «1:1» —
  расхождение будет видно диффом).
- [ ] **Шаг 2: падающие тесты:** (а) `initWebGL` компилирует две шейдерные программы и грузит
  текстуру: в `calls` есть `compileShader` ×2, `linkProgram`, `texImage2D`; (б) изменение
  `adjustments.enhance` в сторе приводит к `uniform1f(uEnhance, v/100)` и `drawArrays` в следующем
  кадре (нормировка — по `adjustments.ts`); (в) `mediaRatio = width/height` источника
  (`imageCanvas.tsx:60`); (г) после закрытия редактора — `WEBGL_lose_context.loseContext()` вызван
  (`utils.ts`, `cleanupWebGl`); (д) вкладка «Настройки»: 11 ползунков в порядке `adjustments.ts`,
  подписи — ключами `MediaEditor.Adjustments.*`; (е) движение ползунка пишет одну запись истории на
  жест, а не на каждый кадр.
- [ ] **Шаг 3: падают.** **Мутации:** не вызывать `cleanupWebGl` в `onCleanup` → (г) краснеет;
  перепутать uniform `uContrast`/`uSaturation` в `adjustments.ts` → (б) краснеет.
- [ ] **Шаг 4: реализовать** дословно. **Шаг 5: стенд** (временной врезки нет — открыть консолью
  `(await import('/src/components/mediaEditor/index.ts')).openMediaEditorFromMediaRaw(...)` на dev-сборке):
  фото 4000×3000, каждый ползунок меняет картинку, числа — время до первого кадра.
- [ ] **Шаг 6: коммит.**

**Готово когда:** картинка рисуется WebGL-ом, 11 настроек работают на стенде; тесты зелёные.
**Оценка:** 4 дня. **Зависимости:** МР-2.

### Задача МР-4: кроп, поворот, режим аватара

**Порт:** `canvas/cropHandles.solid.tsx` (474), `canvas/rotationWheel.solid.tsx` (328),
`tabs/cropTab.solid.tsx` (163), `canvas/animateToNewRotationOrRatio.ts` (64),
`canvas/getConvenientPositioning.solid.tsx` (71); тест tweb `src/tests/mediaEditorSnapToAngle.test.ts`
→ `components/mediaEditor/snapToAngle.test.ts`.

**Файлы:** создать перечисленные + `cropHandles.solid.test.tsx`, `cropTab.solid.test.tsx`.

**Интерфейсы:**
- Потребляет: МР-3 (`useFinalTransform`, `useCropOffset`), `core/dom/swipeHandler.ts`.
- Даёт: `mediaState.{scale, rotation, flip, translation, currentImageRatio}`,
  `editorState.fixedImageRatioKey`.

- [ ] **Шаг 1: прочитать** tweb файлы задачи и `imageCanvas.tsx:70-84`.
- [ ] **Шаг 2: падающие тесты:** (а) `isEditingForAvatar` → после загрузки `currentImageRatio === 1`,
  `fixedImageRatioKey === '1x1'`, `scale = max(w2/w1, h2/h1)`: для 4000×3000 в квадратной области кропа это `4/3`;
  (б) в `cropTab` у всех пунктов, кроме «Квадрат», атрибут `disabled` (`cropTab.tsx:69-157`), без
  флага аватара — ни у одного; (в) скругление маски `rx` = `min(w,h)/2`, при
  `isEditingForumAvatar` — `/3` (`cropHandles.tsx:376-381`); (г) поворот колесом ограничен −90…90 и
  снапится к углу по `snapToAngle` (порт теста tweb); (д) «Повернуть влево» — `rotation −= π/2` с
  записью в историю, undo возвращает; (е) «Отразить» переключает `flip[0]`; (ж) колесо мыши над
  рамкой меняет масштаб (`cropHandles.tsx:304-311`).
- [ ] **Шаг 3: падают.** **Мутации:** убрать `disabled={isEditingForAvatar}` у «Оригинал» → (б)
  краснеет; поставить делитель 2 для форума → (в) краснеет.
- [ ] **Шаг 4: реализовать; шаг 5: стенд** — открытие консолью с `isEditingForAvatar: true`: круглая
  маска, перетаскивание, зум, поворот; `isEditingForumAvatar: true` — скруглённый квадрат.
- [ ] **Шаг 6: коммит.**

**Готово когда:** кроп и поворот ведут себя как tweb, включая режим аватара; порт теста tweb зелёный.
**Оценка:** 4 дня. **Зависимости:** МР-3.

### Задача МР-5: финальный рендер фото, `getFileAndOpenEditor`, `AvatarEdit`

**Порт:**
- `finalRender/{createFinalResult,renderToImage,getResultSize,getResultTransform,getScaledLayersAndLines,drawTextLayer,drawStickerLayer,spawnAnimatedPreview,types,constants}.ts`.
  Ветка видео `createFinalResult.ts` (`:89-97`, `:127-158`) и `renderToActualVideo`/`renderToVideoGIF`
  — в МР-7 и МР-11: до них `mediaType === 'video'` не приходит, вход принимает только фото
  (`// ВРЕМЕННО до МР-7`). `drawTextLayer`/`drawStickerLayer` портируются сразу: их импортирует
  `renderToImage.ts:5-6`, а пустые слои они пропускают.
- `helpers/getFileAndOpenEditor.ts` (129) дословно. `acceptMediaTypes` по умолчанию `['photo']`, как у
  tweb. Видео `AvatarEdit` запрашивает, но `getFileAndOpenEditor` до МР-7 режет `'video'`
  (`// ВРЕМЕННО до МР-7`).
- `components/avatarEdit.ts` (417): класс `AvatarEdit` (`:235-270`), `finishFromResult` (`:278-325`),
  `mediaEditorResultToAvatarPayload` (`:46-65`), `handleAvatarEditorResult` (`:72-135`),
  `pickAvatarAndUpload` (`:139-158`), `openAvatarEditorWithFile` (`:197-233`). Видео-ветки
  (`finishFromVideoResult` `:327-392`, `spawnAvatarProgressRing` `:397-417`, `computeVideoStartTs`
  `:34-41`, `editAndSetOwnAvatar` `:163-193`) — МР-8. Если к старту задачи в `main` уже есть
  временный `avatarEdit.ts` из 0а-3, файл заменяется портом целиком, и все
  `// ВРЕМЕННО до 2D-27` в нём снимаются.
- `components/editPeer.ts` (123) — **нет**, это 2D-27 (он зовёт `new AvatarEdit`, `editPeer.ts:57`).

**Отступление ВМ-1 (постоянное).** `AvatarEditPayload.file` отдаёт `() => Promise<number>` (id медиа
из `managers.media.upload`), а не `CancellablePromise<InputFile>`. Причина: провод адресует медиа
числовым id, а семейство `InputFile` программа TL не копирует (`docs/readiness/tl-program.md:72-80`).
То же для `video`. `appDownloadManager.upload(blob, name)` tweb заменяется `managers.media.upload({blob,
mime, size, width, height, fileName})`. Прогресс-источник для отмены — `CancellablePromise` вокруг
аплоада (`helpers/cancellablePromise.ts`), форма отмены «отменить обе загрузки» (`:97-106`) —
дословно.

**Файлы:**
- Создать: перечисленные `finalRender/*`, `helpers/getFileAndOpenEditor.ts`, `components/avatarEdit.ts`;
  тесты `createFinalResult.test.ts`, `getFileAndOpenEditor.test.ts`, `avatarEdit.test.ts`
- Изменить: `docs/tweb/media-editor.md` («у нас»)

**Интерфейсы:**
- Потребляет: МР-2…МР-4; `managers.media.upload`, `managers.profile.addPhoto`
  (`core/managers/profileManager.ts:92`), `managers.contacts.setPhoto`/`suggestPhoto`
  (`contactsManager.ts:312-325`).
- Даёт (для МР-6, 0а-2, 0а-3, 0б-1, 0б-10, 2D-27):

```ts
// components/avatarEdit.ts
export type AvatarEditPayload = {
  file: () => CancellablePromise<number>          // ВМ-1: id медиа вместо InputFile
  video?: () => CancellablePromise<number>        // заполняет МР-8
  videoStartTs?: number                           // заполняет МР-8
}
export default class AvatarEdit {
  container: HTMLElement                          // button.avatar-edit > canvas.avatar-edit-canvas + span.avatar-edit-icon
  constructor(onChange: (payload: AvatarEditPayload) => void, options?: {isForum?: boolean})
  clear(): void
}
export function pickAvatarAndUpload(opts: {managers: Managers; isForum?: boolean;
  mode: 'fallback' | {userId: UserId; suggest?: boolean};
  onUploadStart?: (p: CancellablePromise<number>) => void; onUploaded?: () => void}): void
export async function openAvatarEditorWithFile(file: File | Blob, o: {isForum?: boolean;
  dontCreatePreview?: boolean; onFinish: (r: MediaEditorFinalResult) => void}): Promise<void>
// helpers/getFileAndOpenEditor.ts — сигнатура tweb `:15-32` дословно
```

`managers` в конструкторе `AvatarEdit` у tweb не нужен: загрузчик глобальный. У нас загрузка идёт
через `rootScope.managers` (как у tweb `getFileAndOpenEditor.ts:81`), поэтому опция `managers`
временного файла 0а-3 (`:51`) исчезает, и сигнатура совпадает с tweb.

- [ ] **Шаг 1: прочитать** tweb `createFinalResult.ts`, `renderToImage.ts`, `getResultSize.ts`,
  `spawnAnimatedPreview.ts`, `getFileAndOpenEditor.ts`, `avatarEdit.ts`, `animateImageToTarget.ts`;
  временный `avatarEdit.ts` 0а-3 (если влит) — только чтобы снять его метки.
- [ ] **Шаг 2: падающие тесты:** (а) `createFinalResult` для 4000×3000 в режиме аватара даёт
  `width === height === 800` (`:105-113`); без режима — не больше 2560 (`getResultSize.ts:4-5`);
  (б) `renderToImage` зовёт `toBlob` с `imageType`/`imageQuality` из пропсов, по умолчанию
  `'image/jpeg'`; (в) `getFileAndOpenEditor`: `input.accept` собран из
  `IMAGE_MIME_TYPES_SUPPORTED` (`environment/imageMimeTypesSupport.ts`); невалидная картинка редактор
  не открывает; отмена выбора (фокус окна без `change` через 1 с) — не открывает, `input` удалён
  (`:117-123`); `shouldOpenEditor → false` зовёт `onSkipEditor(file)`; (г) `new AvatarEdit(cb)` →
  разметка `button.avatar-edit > canvas.avatar-edit-canvas + span.avatar-edit-icon` (tweb `:240-246`);
  клик → редактор открыт с `isEditingForAvatar: true`, `initialTab: 'crop'`,
  `canFinishWithoutChanges: true`; (д) «Готово» → `cb` вызван один раз, `payload.file` ещё не
  вызывался (загрузки нет до сабмита экрана — tweb `SignUpCard.tsx:36-40`); канва затемнена
  `rgba(0,0,0,0.3)` (`:309-310`); (е) `pickAvatarAndUpload({mode: {userId, suggest: true}})` зовёт
  `contacts.suggestPhoto`, `{userId}` — `contacts.setPhoto`, отмена прогресса отменяет загрузку и
  менеджер не вызывается; (ж) после «Готово» и 400 мс в DOM нет `.media-editor__overlay` и
  «летящего» `img` — пин DoD 5.
- [ ] **Шаг 3: падают.** **Мутации:** убрать кап 800 → (а) краснеет; звать `payload.file()` сразу в
  `finishFromResult` → (д) краснеет; не удалять `animatedPreview` в `handleAvatarEditorResult`
  (`:84`) → (ж) краснеет.
- [ ] **Шаг 4: реализовать** дословно; ВМ-1 — в шапку `avatarEdit.ts` и у строк аплоада.
- [ ] **Шаг 5: стенд** (врезки ещё нет — консолью `new AvatarEdit(console.log)` в `document.body`):
  кроп, «Готово», полёт превью в круг, `payload.file()` возвращает id; числа — время рендера фото
  4000×3000.
- [ ] **Шаг 6: коммит.**

**Готово когда:** `AvatarEdit` и `getFileAndOpenEditor` работают на стенде;
`git grep -n "ВРЕМЕННО до 2D-27" web-client/src` пуст. **Оценка:** 3 дня. **Зависимости:** МР-4.

### Задача МР-6: врезка аватара во всех потребителях, снос `AvatarCropper`

**Врезка (по tweb):**

| Экран | Сейчас | После | tweb |
|---|---|---|---|
| `auth/cards/SignUpCard.solid.tsx` | файл без кропа (`:31-50`, `:170-189`) | `new AvatarEdit(payload => uploadAvatar = payload)`, загрузка `payload.file()` после `signUp` | `pages/cards/SignUpCard.tsx:36-40` |
| `settings/EditProfile.tsx` (React, до 2D-27) | `AvatarCropper` `:299` | класс `AvatarEdit` через `useImperativeIsland` (как решено в 2D `:1218`) | `editProfile.tsx:294` (через `EditPeer`) |
| `NewGroupFlow.tsx` (React, до 0а-2) | `AvatarCropper` `:206` | то же | `newGroup.tsx:45` |
| `group/GroupEditFlow.tsx` (React, до 0б-1) | `AvatarCropper` `:262` | то же | `editChat.tsx:193` |
| `EditContactView.tsx` (React, до 0б-10) | `AvatarCropper` `:172` + `useEditContact.ts:72-90` | `pickAvatarAndUpload({mode: {userId}})` / `{userId, suggest: true}` из кнопок | `editContact.tsx:73`, `:89` |

Если к моменту врезки Solid-вкладка уже заменила React-экран (0а-2, 0а-3, 0б-1, 0б-10, 2D-27), этот
пункт врезки делает сама вкладка без моста. МР-6 тогда проверяет, что в ней стоит `AvatarEdit`
(tweb-путь), а не временный выбор файла.

**Файлы:**
- Изменить: `auth/cards/SignUpCard.solid.tsx` (+ тест), `settings/EditProfile.tsx`, `NewGroupFlow.tsx`,
  `group/GroupEditFlow.tsx`, `EditContactView.tsx`, `core/hooks/useEditContact.ts`
- Удалить: `components/settings/AvatarCropper.tsx`, `AvatarCropper.module.scss`,
  `web-client/backlogs/frontend/avatar-cropper-solid-port.md`; шапочный комментарий
  `SignUpCard.solid.tsx:31-50` («кроппер вне периметра») — переписывается ссылкой на tweb

- [ ] **Шаг 1: прочитать** tweb `SignUpCard.tsx:30-60`, `editPeer.ts:48-65`, `newGroup.tsx:40-60`,
  `editContact.tsx:60-100`; наши экраны (только чем кормят результат).
- [ ] **Шаг 2: падающие тесты:** (а) `SignUpCard`: клик по `.avatar-edit` открывает редактор с
  `isEditingForAvatar`; после «Готово» `media.upload` не вызван, пока нет `signUp`; после `signUp` —
  `upload` → `profile.addPhoto` один раз; отказ заливки не мешает `toIm()` (tweb `.finally`);
  (б) `EditContactView`: «Предложить фото» → `pickAvatarAndUpload` с `suggest: true` →
  `contacts.suggestPhoto`; (в) скан: `git grep -n "AvatarCropper" web-client/src` пуст (тест-скан
  рядом с `boundary.test.ts` не нужен — это строка «Готово когда»).
- [ ] **Шаг 3: падают.** **Мутация:** в `SignUpCard` звать `payload.file()` в `onChange` → (а)
  краснеет (загрузка до аккаунта).
- [ ] **Шаг 4: реализовать; шаг 5: стенд** — AUTH-01, ST-01, GR-01, CH-01, P0-07, GR-09, RS-08 до и
  после; ME-14, ME-16. Числа: размер аватара на сервере (800 → 640/320/160 превью), время открытия.
- [ ] **Шаг 6: коммит**; список удалённых React-файлов и новое число `.tsx` с `from 'react'` — в тело.

**Готово когда:** `git grep -n "AvatarCropper" web-client/src` пуст; P0 зелёные; бэклог-файл удалён.
**Оценка:** 3 дня. **Зависимости:** МР-5.

**Разблокирует:** задачи 0а-2, 0а-3, 0б-1, 0б-10 волны 7 и 2D-27 берут `AvatarEdit`
(`components/avatarEdit.ts`) напрямую, без `// ВРЕМЕННО до 2D-27`. 2D-27 портирует `editPeer.ts` (123)
поверх него.

---

## Этап 2 — видео

### Задача МР-Б1: бэкенд видео-аватара (отдельный PR `backend/`)

**Предмет:** провод и хранение, как у `photos.uploadProfilePhoto`/`inputChatUploadedPhoto`/
`uploadContactProfilePhoto` tweb, но на нашем REST и id медиа (ВМ-1). Закрывает
`backend/backlogs/profile-video-avatar-wire.md`.

**Файлы:**
- Миграция `internal/store/postgres/migrations/<следующий свободный номер>_profile_video_start_ts.sql` (на `fa136b4a` последний — `0133`): `profile_photos.video_start_ts
  double precision NULL`; видео фото чата (`chats.photo_video_media_id`, `chats.photo_video_start_ts`) и
  личного фото контакта — по фактической схеме (сверить `0091_avatar_previews.sql`, `0103_peer_model_tl.sql`)
- `internal/domain/mtmedia.go`: `VideoSize` (`videoSize#e831c556 type w h size video_start_ts` + наш
  `media_id`), `Photo.VideoSizes []VideoSize` (`json:"video_sizes,omitempty"`); `ProfilePhoto.VideoStartTs`
  (`domain/user.go:98-104`); флаг `has_video` у `userProfilePhoto`/`chatPhoto`
- `adapter/delivery/http/profile_handler.go`: `addPhotoBody.VideoStartTs float64`
  (`json:"video_start_ts"`); `galleryPhoto()` (`:404-406`) кладёт `video_sizes`
- `group_handler.go:121-139`: тело `{media_id, video_media_id?, video_start_ts?}`
- `contact_photo_handler.go:40`, `:98`: то же для личного и предложенного фото
- Тесты: `profile_handler_test.go`, `group_handler_test.go`, `contact_photo_handler_test.go`, репо
- Клиент (в том же PR, провод): `profileManager.addPhoto(mediaId, videoMediaId?, videoStartTs?)`,
  `mapProfilePhoto` читает `video_sizes` вместо `videoMediaId: undefined` (`:146-148`),
  `groupsManager.setPhoto`, `contactsManager.setPhoto`/`suggestPhoto` с видео

- [ ] **Шаг 1: прочитать** backlog-файл, `profile_handler.go:236-460`, `group_handler.go:121-139`,
  `contact_photo_handler.go`, `authrepo.go:260-290`; tweb `appProfileManager.ts:1031-1075`,
  `appChatsManager.ts:895-910`.
- [ ] **Шаг 2: падающие тесты** (Go): (а) `POST /me/photos {media_id, video_media_id, video_start_ts: 1.5}`
  → `GET /users/{id}/photos` отдаёт у фото `video_sizes[0].video_start_ts == 1.5` и id видео;
  (б) без видео `video_sizes` отсутствует (omitempty); (в) `PUT /chats/{id}/photo` с видео → у чата
  `has_video`; (г) `video_media_id` чужого медиа → 403 (по правилам `mediaaccessrepo.go`);
  (д) клиент: `mapProfilePhoto` собирает `videoMediaId` из `video_sizes`, существующий тест
  `peerProfileAvatars.test.ts` (ветка видео) зелёный без правки.
- [ ] **Шаг 3: падают.** **Мутация:** не заполнять `video_sizes` в `galleryPhoto` → (а) краснеет.
- [ ] **Шаг 4: реализовать**; `go test ./internal/...` затронутых пакетов, `go vet ./...`; vitest клиента.
- [ ] **Шаг 5: стенд** — старый `onVideoPick` (`EditProfile.tsx:123-176`) ставит видео, у второго
  аккаунта карусель профиля играет видео (раньше — статичный кадр). Числа — в коммит.
- [ ] **Шаг 6: коммит**, PR `backend/`; backlog-файл удалён.

**Готово когда:** видео-аватар доходит до второго аккаунта; backlog-файл удалён.
**Оценка:** 4 дня. **Зависимости:** нет (идёт параллельно этапу 1).

### Задача МР-7: видео в редакторе — таймлайн, воспроизведение, кодирование

**Порт:** `canvas/videoControls.solid.tsx` (637) + `videoControls.module.scss` (293),
`canvas/useVideoControlsCanvas.ts` (78), `canvas/createVideoForDrawing.ts` (68),
`finalRender/{renderToActualVideo,createMp4VideoEncoder,calcCodecAndBitrate,generateVideoPreview}.ts`,
`support.ts` (39), `renderProgressCircle.solid.tsx` (35), ветки видео `createFinalResult.ts`
(`:89-97`, `:127-158`); хелперы `helpers/createPoster.ts`, `helpers/video/detectVideoHasSound.ts` (87),
`helpers/dom/handleVideoLeak.ts`, `helpers/useSwipe.ts`, `helpers/string/toHHMMSS.ts`,
`environment/videoMimeTypesSupport.ts`, `components/progressCircleSVG.solid.tsx`. Снимаются
`// ВРЕМЕННО до МР-7` (МР-2 — `VideoControls` в `mainCanvas`; МР-5 — `acceptMediaTypes` и ветка видео).

**Файлы:** создать перечисленные + `videoControls.solid.test.tsx`, `renderToActualVideo.test.ts`,
`support.test.ts`, `createFinalResult.video.test.ts`.

**Интерфейсы:**
- Потребляет: МР-5 (`createFinalResult`), `mediabunny` (динамический импорт).
- Даёт: `MediaEditorFinalResult` с `isVideo: true`, `getResult(): Promise<{blob, hasSound, thumb}>`,
  `creationProgress: Signal<number>`, `videoDuration`; `supportsVideoEncoding(): Promise<boolean>`,
  `MAX_EDITABLE_VIDEO_SIZE`.

- [ ] **Шаг 1: прочитать** tweb файлы задачи; наш `videoExport.ts` (только сценарии).
- [ ] **Шаг 2: падающие тесты** (`VideoEncoder`/`AudioEncoder` — фейки через глобал, как
  `videoSupport.ts:1-4`; `mediabunny` — `vi.mock`): (а) `supportsVideoEncoding` → `false`, если
  хотя бы один из конфигов `highResCodec`/`defaultCodec` не поддержан (`support.ts:10-22`);
  (б) видео без изменений → `getResult()` отдаёт исходный blob, кодировщик не создавался
  (`createFinalResult.ts:127-158`); (в) `isVideoAvatarMode`: обрезка ограничена `10/duration`
  (`videoControls.tsx:119-133`), кнопки звука нет (`:327`), обложку нельзя вынести за обрезку
  (`:452-468`); (г) кодирование в режиме аватара: кадров не больше `ceil(10 × 30)`, битрейт
  `≤ 1.5e6`, размеры чётные и ≤ 800 (`renderToActualVideo.ts:78-85`, `:176-179`,
  `createFinalResult.ts:89-97`); (д) потеря фокуса окна ставит кодирование на паузу
  (`renderToActualVideo.ts:127-137`); (е) `creationProgress` растёт от 0 до 1.
- [ ] **Шаг 3: падают.** **Мутации:** убрать кап битрейта → (г) краснеет; убрать ветку «без
  изменений» → (б) краснеет.
- [ ] **Шаг 4: реализовать; шаг 5: стенд** — видео 30 с 1080p в режиме аватара и без: таймлайн,
  обрезка, обложка, звук; числа — время кодирования 10 с аватара и 30 с 1080p, размер MP4.
- [ ] **Шаг 6: коммит.**

**Готово когда:** видео редактируется и кодируется на стенде в Chrome и Firefox (где
`supportsVideoEncoding()` истинно); `git grep -n "ВРЕМЕННО до МР-7" web-client/src` пуст.
**Оценка:** 7 дней. **Зависимости:** МР-5.

### Задача МР-8: видео-аватар и «Установить фото»

**Порт:** `avatarEdit.ts`: `computeVideoStartTs` (`:34-41`), видео-ветка
`mediaEditorResultToAvatarPayload` (`:52-60`), `finishFromVideoResult` (`:327-392`),
`spawnAvatarProgressRing` (`:397-417`), `editAndSetOwnAvatar` (`:163-193`); сервисный бабл
предложения фото — кнопка `UserInfo.SetPhotoTitle` / `UserInfo.SuggestedPhotoView` и клик
(`chat/bubbles.ts:8225-8250`) в наш `components/chat/serviceMediaBubble.ts` / `serviceMessage.ts`
(снимается строка «Кнопка „Установить фото“ … НЕ портированы», `serviceMessage.ts:30-33`).

**Файлы:**
- Изменить: `components/avatarEdit.ts` (+ тест), `components/chat/serviceMediaBubble.ts`,
  `serviceMessage.ts` (+ тесты), `settings/EditProfile.tsx` (удалить `onVideoPick` `:123-176` и второй
  `input` `:233-241`: видео теперь идёт через `AvatarEdit`), вызовы менеджеров с `video`/`videoStartTs`
  (МР-Б1)
- Удалить (при «А» на В-3): `contactsManager.acceptPhotoSuggestion` (`:327-330`) и ручку
  `POST /photo_suggestions/{id}/accept` — отдельным коммитом в `backend/`, если она больше ни для чего не
  нужна (сверить `git grep`)

- [ ] **Шаг 1: прочитать** tweb ветки видео `avatarEdit.ts`, `bubbles.ts:8200-8260`,
  `wrapServiceMediaBubble`; наш `serviceMediaBubble.ts`.
- [ ] **Шаг 2: падающие тесты:** (а) `computeVideoStartTs`: cover 0.5, trimStart 0.2, clipLen 0.5 при
  длительности 20 с → 6 с; cover до обрезки → 0; после — `clipLen`; (б) видео-результат →
  `onChange({file, video, videoStartTs})`, кольцо прогресса смонтировано в `getOverlayRoot()` и снято
  после `getResult()` (пин DoD 5); (в) `EditProfile`: видео-аватар уходит в
  `profile.addPhoto(posterId, videoId, videoStartTs)`; (г) сервисный бабл `suggest` входящий →
  кнопка `UserInfo.SetPhotoTitle`, клик → `editAndSetOwnAvatar` (стаб), исходящий →
  `UserInfo.SuggestedPhotoView` и просмотрщик; (д) `editAndSetOwnAvatar` с `video_sizes` скачивает
  видео (`chooseProfileVideoSize` — наш эквивалент выбора размера) и открывает редактор в режиме видео.
- [ ] **Шаг 3: падают.** **Мутации:** считать `videoStartTs` от начала исходника, а не обрезки → (а)
  краснеет; не снимать кольцо → (б) краснеет.
- [ ] **Шаг 4: реализовать; шаг 5: стенд** — ME-15, ME-17, ST-01, P0-07, RS-02; числа — время от
  «Готово» до появления видео у второго аккаунта.
- [ ] **Шаг 6: коммит.**

**Готово когда:** видео-аватар ставится через редактор с обложкой и `video_start_ts`; «Установить
фото» работает через редактор; О-24 плана 2D закрыто (строка в таблице 2D — «снято МР-8»).
**Оценка:** 3 дня. **Зависимости:** МР-7, МР-Б1.

---

## Этап 3 — остальные вкладки (параллельно этапу 2, после МР-3)

### Задача МР-9: кисти

**Порт:** `canvas/brushCanvas.solid.tsx` (340), `canvas/brushPainter.ts` (240), `brushesSvg.solid.tsx`
(588), `tabs/brushTab.solid.tsx` (161), `canvas/previewBrushSize.solid.tsx` (27), `colorPicker.solid.tsx`
(200, поверх `components/colorPicker.ts`), `createStoredValue.ts` (64), `createStoredColor.ts` (43);
строки `mediaEditor.*` в `stores/appSettings.solid.ts` (`APP_SETTINGS_KEYS`) и в zustand-настройках —
форма tweb `config/state.ts:162-171`, по умолчанию `{colorByBrush: {}}` (`:590-592`). Снимаются
`// ВРЕМЕННО до МР-9` (вкладка `brush` в `toolbar`, `BrushCanvas`/`PreviewBrushSize` в `mainCanvas`).
Финальный рендер штрихов — `getScaledLayersAndLines` + `brushPainter` (уже есть из МР-5).

**Тесты:** (а) шесть кистей в порядке tweb (`MediaEditor.Brushes.*`); (б) blur доступен только для
картинок (`brushCanvas.tsx:97`); (в) штрих — одна запись истории, undo снимает его;
(г) цвет и размер кисти сохраняются в `appSettings.mediaEditor` и восстанавливаются при новом
открытии; (д) штрих попадает в результат `renderToImage` (фейковый 2D-холст: в `calls` есть путь).
**Мутации:** не писать `colorByBrush` → (г) краснеет; писать историю на каждый `pointermove` → (в)
краснеет. **Стенд:** ME-11 (часть «рисование»), числа — FPS при рисовании.
**Оценка:** 5 дней. **Зависимости:** МР-3 (МР-5 — для финального рендера).

### Задача МР-10: текст, слои, шрифты

**Порт:** `tabs/textTab.solid.tsx` (170), `canvas/textLayerContent.solid.tsx` (323),
`canvas/resizableLayers.solid.tsx` (476, перемещение, масштаб, поворот, контекстное меню слоя через
`createContextMenu`/`positionMenu`), `styles/tweb/fonts/_mediaEditorFonts.scss` (56) + 7 TTF из tweb
`public/assets/fonts` в `web-client/public/assets/fonts/`, `@use` — как tweb `scss/fonts.scss:3`.
Снимаются `// ВРЕМЕННО до МР-10` (вкладка `text`, `ResizableLayers` в `mainCanvas`).

**Тесты:** (а) восемь шрифтов (`fontInfoMap`, `utils.ts:136-177`) с `font-family` tweb; (б) три стиля
(`Normal`/`Outline`/`Background`) меняют класс слоя; (в) перетаскивание слоя — одна запись истории;
(г) контекстное меню слоя: «Вверх/Вниз/…» (`MediaEditor.MoveUp` …) двигают слой; (д) текст
попадает в результат (`drawTextLayer`). **Мутация:** не сохранять `textFont` → повторное открытие
теряет шрифт, тест краснеет. **Стенд:** все шрифты видны (без мигания подмены), числа — время
первого рендера текста.
**Оценка:** 5 дней. **Зависимости:** МР-3, МР-9 (цвет — `colorPicker.solid.tsx`).

### Задача МР-11: стикеры и GIF-режим

**Порт:** `tabs/stickersTab.solid.tsx` (335), `canvas/stickerLayerContent.solid.tsx` (47),
`finalRender/{renderToVideoGIF,imageStickerFrameByFrameRenderer,lottieStickerFrameByFrameRenderer,videoStickerFrameByFrameRenderer}.ts`.
При «А» на В-2 — ещё `components/emoticonsDropdown/tabs/SuperStickerRenderer.ts` (194),
`components/emoticonsDropdown/search.solid.tsx` (199), `components/wrappers/stickerSetThumb.ts` (129),
`lib/appManagers/utils/stickers/getStickerSetInput.ts` по путям tweb. Позже их подберёт порт
`EmoticonsDropdown` (задача 7-7 волны 7). Снимается `// ВРЕМЕННО до МР-11` (вкладка `stickers`).

**Отступление ВМ-5.** Методы менеджера стикеров — наши: `getRecentStickersStickers` → `recent()`,
`getAllStickers` → `mySets()`, `getStickerSet` → `getStickerSet()`, `getStickersByEmoticon` →
`searchByEmoji()`, `searchStickers` → `searchSets()` (`core/managers/stickersManager.ts:107-168`).
Модель данных и воркер спека не трогает (§ 11). `getPremiumStickers` — ОМ-4.

**Тесты:** (а) секции «Недавние» и наборы в порядке `mySets`; (б) поиск по эмодзи зовёт
`searchByEmoji`; (в) клик добавляет слой стикера 200×200 (`finalRender/constants.ts`) в центр;
(г) анимированный стикер + `canImageResultInGIF: true` → результат `isVideo: true` через
`renderToVideoGIF` (60 fps); при `false` — статичный кадр; (д) стикер в режиме аватара — статичный
(`canImageResultInGIF: false`, `avatarEdit.ts:223`). **Мутация:** игнорировать
`canImageResultInGIF` → (д) краснеет. **Стенд:** lottie, webm и webp стикеры на фото; фото с
анимированным стикером уходит MP4; числа — время `renderToVideoGIF`.
**Оценка:** 6 дней. **Зависимости:** МР-10 (слои), МР-7 (кодировщик MP4).

---

## Этап 4 — медиа при отправке, истории, снос React-редактора

### Задача МР-12: попап отправки медиа зовёт порт

**Врезка:** `messages/SendMediaPopup.tsx` (React, до порта `newMedia.tsx` — О-8 волны 7) вместо
`<MediaEditor>` (`:412-425`) зовёт `openMediaEditorFromMedia({source, rect, animatedCanvasSize,
mediaType, mediaSrc, getMediaBlob, managers, imageType: 'image/jpeg', imageQuality, onEditFinish,
editingMediaState, onClose, canImageResultInGIF})` — набор tweb `newMedia.tsx:1531-1554`. Условие
кнопки — как tweb `:1510-1513`: не GIF, видео только при `supportsVideoEncoding()` и размере
`≤ MAX_EDITABLE_VIDEO_SIZE`.

**Временная мера (до О-8 волны 7).** Попап tweb хранит `MediaEditorFinalResult` в `params.editResult`
и отправляет через `prepareEditedFileForSending` (`newMedia.tsx:891`). Наш попап держит `File[]`.
Поэтому адаптер у строки вызова (`// ВРЕМЕННО до О-8 волны 7`) делает три вещи:
`onEditFinish → await result.getResult() → new File([blob], имя, {type})`; хранит
`editingMediaState` для повторного редактирования; поднимает хост редактора над React `Popup` (4090).
Способ подъёма — обёртка-хост с `z-index` на время открытия, а не правка `mediaEditor.scss`.

**Тесты:** (а) кнопка «Изменить» открывает оверлей порта, React-редактор не импортируется
(`lazyChunks` пин); (б) «Готово» заменяет файл по месту, повторное «Изменить» передаёт
`editingMediaState`; (в) отмена не меняет файл; (г) видео 150 МБ — кнопки нет.
**Мутация:** не передавать `editingMediaState` → (б) краснеет.
**Стенд:** ME-01, ME-02, ME-03, ME-05, ME-11 до и после. **Оценка:** 2 дня.
**Зависимости:** этапы 2 и 3.

### Задача МР-13: создание истории зовёт порт

**Отступление ВМ-2.** В tweb `812502980` создания историй нет, редактор его не обслуживает
(`components/stories/*` — только просмотр). Создание истории — наш продукт
(`core/hooks/useSidebarStories.tsx`, `AddStorySheet.tsx`, `storiesManager.post`). Поэтому
редактор зовётся как у `getFileAndOpenEditor`: `openMediaEditorFromMediaRaw({mediaType, mediaSrc,
getMediaBlob, canFinishWithoutChanges: true, canImageResultInGIF: true, onEditFinish})`. Результат
уходит через `getResult()` в `media.upload`. Комментарий `// Отступление ВМ-2` у вызова.

**Файлы:** изменить `core/hooks/useSidebarStories.tsx` (`:14`, `:37-53`, `:66-71`) (+ тест). Если к
этому моменту волна 7 (задача 2-6) перенесла ряд историй в `StoriesList`, вызов переезжает туда же.
**Тесты:** (а) выбор файла открывает оверлей порта; (б) «Готово» → `media.upload` с blob результата
→ открывается `AddStorySheet`; (в) отмена — лист не открывается. **Мутация:** грузить исходный
`file`, а не результат → (б) краснеет. **Стенд:** LS-11. **Оценка:** 1 день.
**Зависимости:** этапы 2 и 3.

### Задача МР-14: снос React-редактора и его следов

**Удалить:** `components/mediaEditor/MediaEditor.tsx`, `MediaEditor.module.scss`, `sceneRender.ts`,
`enhanceGL.ts`, `editorMath.ts`, `stickerAssets.ts`, `videoExport.ts`, `StickerPicker.tsx`,
`editorHistory.ts`, `videoMath.ts`, `stickerLayer.ts`, `videoSupport.ts` и их 8 тестов; пин
`lazyChunks.test.ts:140`; 12 лишних ключей `MediaEditor.*` (список — Global Constraints) и переводы;
`@fontsource/*` из `package.json`, если `git grep -n "@fontsource" web-client/src` после сноса пуст;
проп `zIndex` в `popups/indexTsx.solid.tsx` (2C О-3: «медиаредактор на порядке DOM»). Если
`git grep` показывает, что он нужен только редактору, — удалить с тестом, иначе оставить с новой
причиной. Отступление ВМ-4 снято.

**Порт теста:** tweb `e2e/accessibilityMediaEditor.spec.ts` (107) → Playwright-набор (ME-16).

**Тесты:** скан «ни один файл не импортирует `mediaEditor/MediaEditor`»; полный vitest.
**Мутация:** вернуть импорт в `SendMediaPopup.tsx` — скан краснеет.
**Стенд:** P0-01…P0-10, ME-01, ME-11, ME-14…ME-17, LS-11. Числа: размер ленивого чанка до и после,
число `.tsx` с `from 'react'`.
**Готово когда:** `git grep -n "MediaEditor.tsx\|AvatarCropper\|z-index: 4200" web-client/src` пуст;
`git grep -n "ВРЕМЕННО до МР-" web-client/src` пуст; спека § 8 — строка программы помечена
«закрыта». **Оценка:** 2 дня. **Зависимости:** МР-12, МР-13.

---

## Отступления программы (объявленные, с номером у строки)

| № | Что | Почему | Где |
|---|---|---|---|
| ВМ-1 | `AvatarEditPayload.file`/`video` — id медиа (`managers.media.upload`), а не `InputFile` | провод адресует медиа числовым id, `InputFile` программа TL не копирует (`tl-program.md:72-80`) | МР-5, МР-8 |
| ВМ-2 | Редактор в создании истории | у tweb `812502980` создания историй нет; это наш продукт | МР-13 |
| ВМ-3 | `openMediaEditor` без `HotReloadGuardProvider`, прямые импорты вместо `useHotReloadGuard` | `lib/solidjs/hotReloadGuard` у нас нет; прецедент — `lottieAnimation.solid.tsx:26-30` | МР-2, МР-9, МР-11 |
| ВМ-4 | Две копии редактора с МР-2 по МР-14 (исключение из DoD 14) | попап отправки и истории пользуются вкладками этапов 2–3; замена раньше ухудшила бы функцию | снимает МР-14 |
| ВМ-5 | Имена методов менеджера стикеров — наши | модель воркера не трогается (спека § 11) | МР-11 |

Временные меры (`// ВРЕМЕННО до МР-n`, `// ВРЕМЕННО до О-8 волны 7`) — не отступления: у каждой есть
задача, которая её снимает.

## Отложено — с предметом (DoD 13)

| № | Что | Почему | Что разблокирует |
|---|---|---|---|
| ОМ-1 | Правка медиа отправленного сообщения через редактор (`chat/input.ts:5542-5655`, `chat/editMessageMedia.ts:60-90`) | правка сообщения на бэкенде — только текст и сущности (`chat_handler.go:691-696`); вызывающий — `ChatInput` (этап 7 волны 7) | правка медиа 1:1 |
| ОМ-2 | Фото для скрытых (`fallback`, `privacy/profilePhoto.tsx:94`, режим `'fallback'` `avatarEdit.ts:118-120`) | на бэкенде нет `fallback`-фото | правило приватности «фото профиля» 1:1 |
| ОМ-3 | Медиа в опросе (`createPoll/mediaAttachment.tsx:148`, `:325`) | нет медиа у опросов на бэкенде | опрос с медиа |
| ОМ-4 | Премиум-стикеры во вкладке стикеров (`stickersTab.tsx:273`) | нет ручки премиум-стикеров | вкладка стикеров 1:1 |
| ОМ-5 | Аватар форума (`isEditingForumAvatar` из `editChat`/создания форума) | форумные аватары зависят от вкладок форума (волна 7, 1-6/0б-1); флаг и маска портированы в МР-4 | — (снимается, когда вкладка форума передаст `isForum`) |

## Открытые вопросы пользователю

| № | Вопрос | Варианты | Рекомендация |
|---|---|---|---|
| **В-1** | Срез этапа 1: у tweb в режиме аватара видны все пять вкладок | А — этап 1 = «Настройки» + «Кроп», вкладки «Текст», «Кисть», «Стикеры» скрыты `// ВРЕМЕННО до МР-9/10/11` (21 день до потребителей); Б — этап 1 включает кисти и текст (≈ 31 день), скрыты только «Стикеры»; В — все пять сразу (≈ 37 дней, зависит от В-2) | **А**: семь потребителей аватара разблокируются на 10–16 дней раньше; вкладки потом доезжают внутрь редактора, потребители не меняются |
| **В-2** | Вкладке стикеров нужны `SuperStickerRenderer`, `EmoticonsSearch`, `wrapStickerSetThumb` из `emoticonsDropdown/` — его у нас нет (React `EmojiDropdown`) | А — портировать эти три файла (522 строки) в МР-11 по путям tweb, `EmoticonsDropdown` (7-7) подберёт их; Б — ждать 7-7 волны 7 | **А**: файлы листовые, путь tweb тот же; ожидание 7-7 сдвинуло бы МР-11 и снос React-редактора в конец волны 7 |
| **В-3** | «Установить фото» из предложения: tweb открывает редактор и ставит результат своим фото (`bubbles.ts:8239`), у нас есть серверная ручка `POST /photo_suggestions/{id}/accept`, которой UI не пользуется | А — 1:1 с tweb (редактор + `POST /me/photos`), ручку accept и `acceptPhotoSuggestion` удалить как мёртвые; Б — tweb-кнопка зовёт серверный accept без редактора (Отступление) | **А**: DoD 2a, у ручки нет потребителя в UI |
| **В-4** | Попап отправки медиа: tweb `newMedia.tsx` (2328) — О-8 волны 7 | А — наш React `SendMediaPopup` зовёт порт с адаптером `// ВРЕМЕННО до О-8 волны 7` (МР-12, 2 дня); Б — порт `newMedia.tsx` внутри этой программы (+≈ 12 дней), редактор сразу получает родной вызывающий | **А**: попап — другая подсистема (композер, альбомы, спойлеры, платные медиа), его порт логичнее рядом с `ChatInput` (этап 7 волны 7) |
| **В-5** | Создание истории — у tweb его нет | А — оставить наш флоу, редактор зовётся функцией (ВМ-2); Б — убрать создание историй | **А**: продуктовая функция, работающая сейчас; расхождение сводится к одной строке вызова |

## Риски

- **WebGL и WebCodecs в тестах.** happy-dom не даёт ни того, ни другого. Смягчение: `fakeWebGL`
  (МР-1), фейки кодировщиков, вынос пиксельной проверки на стенд и в Playwright (ME-14…ME-17). Остаток:
  ошибку шейдера на реальном драйвере ловит только стенд, поэтому шаг стенда в МР-3 обязателен.
- **Производительность.** Видео кодируется в реальном времени (`requestVideoFrameCallback`), 1080p на
  слабой машине может не успевать. У tweb то же поведение, числа на стенде фиксируются в МР-7.
  Без WebCodecs (старый Safari) видео не редактируется: `supportsVideoEncoding()` прячет кнопку, как
  у tweb.
- **Коллизия имени** `mediaEditor.tsx`/`MediaEditor.tsx` на APFS — снята суффиксом `.solid.tsx`
  (Global Constraints). Без него git на macOS молча смешал бы файлы.
- **Слои над React-попапом (4090)** до О-8 — временная мера МР-12. Фокус-трап редактора и фокус
  React-попапа могут спорить. Проверить Tab/Esc в ME-16 при открытии из попапа.
- **Параллельные врезки с волной 7.** Если 0а-3 вольют раньше МР-5, в `main` окажется временный
  `avatarEdit.ts`. МР-5 заменяет его целиком. Метки `ВРЕМЕННО до 2D-27` нужно переименовать в
  `ВРЕМЕННО до МР-5` в PR 0а-3 (сообщить исполнителю 0а-3).
- **Размер чанка.** `mediaEditor.scss` 1466 строк и шрифты — в ленивом чанке, как у tweb; TTF
  подгружаются браузером только при использовании (`font-display: swap`).

## DoD программы

Спека § 9, пункты 9–14, плюс предметно:

- [ ] `vite build` живой; `vitest run`, `tsc --noEmit`, `oxlint --type-aware` зелёные из `web-client/`;
  `go test`/`go vet` зелёные для МР-Б1.
- [ ] `components/mediaEditor/**` — порт tweb файлами (`.solid.tsx` у JSX); `scss-parity` по
  `mediaEditor.scss` и `videoControls.module.scss` — только объявленные расхождения.
- [ ] `AvatarEdit`, `getFileAndOpenEditor`, `pickAvatarAndUpload`, `editAndSetOwnAvatar`,
  `openAvatarEditorWithFile` — у всех потребителей аватара; `AvatarCropper` удалён.
- [ ] Видео-аватар: обрезка ≤ 10 с, обложка, `video_start_ts` на проводе, видео играет у второго
  аккаунта; `backend/backlogs/profile-video-avatar-wire.md` удалён.
- [ ] `MediaEditor.tsx` и 10 соседних React-модулей удалены; `git grep -n "ВРЕМЕННО до МР-"
  web-client/src` пуст; `z-index: 4200` нет.
- [ ] E2E: ворота всех этапов, ME-14…ME-17 в каталоге и зелёные.
- [ ] `docs/tweb/media-editor.md` заведён и держит актуальную секцию «у нас»; спека § 8 отмечает
  программу закрытой.
