# Дельта tweb e52b5d931 → 812502980, часть 1 (52 коммита)

Источник списка — `commits-part-1.txt` (хронологически). tweb: `/Users/denisurevic/Documents/tweb`.
Наш код сверялся по `origin/main` = `0a1fbba4` (ворктри `tweb-delta`; локальный `main` отстал на
`7eb40362`). Пути «у нас» — от `web-client/src/`, если не сказано иное. Размер — для нас.

Легенда действий: **PORT** переносить · **DOC** только доки/комментарии · **SKIP** не переносить ·
**BLOCKED** нужна ручка бэкенда/модели.

## Таблица

| коммит | заголовок | подсистема / наш док § | суть для нас | у нас | действие | размер | пересечение с программой | примечание |
|---|---|---|---|---|---|---|---|---|
| afb5587c8 | Authenticate peer g_a before it can drive the call emoji SAS | звонки (MTProto DH) / — | `g_a` присваивается только после сверки commitment+fingerprint; иначе MITM подбирает ~33 бита SAS. | `core/calls/callEngine.ts` (WebRTC + ECDH через сигналинг, SAS из `secret/fingerprint.ts`) | SKIP | — | — | Порт невозможен: у нас другой протокол. **Но та же дыра у нас есть в худшем виде**: commitment (`g_a_hash`) нет вообще, сервер может подменить оба ключа и подобрать совпадающие эмодзи. В security-бэклог: commit-reveal (hash(pubA) до обмена ключами). |
| 8d06fbc9c | Stop the service worker stream endpoint from echoing an attacker's Content-Type | SW-стриминг / media §5.3 | `/stream/`: mime из URL — только video/audio/image, иначе octet-stream; `nosniff`; навигации отклоняются. | `public/sw-stream.js:164,196` — `mime` из query пишется в `Content-Type` как есть; `public/sw.js:115` | PORT | S | медиа-модель (DNP-стрим) | Та же XSS-поверхность: `/dnp-stream/…?mime=text/html`. Живёт только при DNP-мосте (флаг в проде OFF), но код в SW. Allowlist + `X-Content-Type-Options: nosniff` + `request.mode === 'navigate'` → 403. |
| 65c6ea8f8 | Keep the passcode-derived key out of localStorage | passcode / state-and-layout §3.4 | Ключ AES-GCM из пасскода передаётся через `window.sessionStorage` (keyHandoff), не через localStorage. | `core/passcode.ts` — только хеш PBKDF2 для проверки, хранилище ключом не шифруется | SKIP | — | — | Ключа, который можно утечь, у нас нет. В §3.4 дописать новый `lib/passcode/keyHandoff.ts`. |
| b2287f1ca | Fix arbitrary file read/delete in snapshot-server | тулинг tweb | Path traversal в dev-сервере снапшотов. | нет | SKIP | — | — | Тулинг tweb. |
| 85e5e90cb | Cap .tgv gzip decompression | загрузка файлов / media §4.2 | Лимит 8 МБ на распаковку .tgv (паттерн обоев) — защита от gzip-бомбы. | tgv нет | SKIP | — | tlottie | **Сопутствующий долг:** лимит на TGS (f3733adc2, уже был в e52b5d931) мы не перенесли: `core/stickers/tgs.ts:15` и `lib/lottie/lottieLoader.ts:180` распаковывают `DecompressionStream` без лимита. Отдельная задача S: считать байты в потоке и обрывать на 8 МБ. |
| c437187ae | Validate resPQ pq and bound Brent-Pollard factorization | MTProto auth | Отклонять pq > 8 байт, бюджет итераций факторизации. | нет (Noise/DNP, не MTProto auth) | SKIP | — | TL-провод | Протокольная специфика. |
| c28d7dad2 | Validate dcId before it reaches a transport URL | MTProto транспорт | dcId — целое 1..5 до подстановки в wss-URL. | DC нет | SKIP | — | — | — |
| 010effed9 | Never log a message-port task payload | SuperMessagePort / state-and-layout §1.1 | В логах только id/тип/метод, без payload (там бывает пароль SRP). | `rpc/superMessagePort.ts` — payload не логируется вовсе | SKIP | — | — | Уже безопасно. |
| 31ba61df5 | Size the DH secret exponent from a constant, not the server's prime length | крипто DH/SRP | Длина экспоненты — константа, циклы генерации ограничены. | нет (WebCrypto ECDH в секретных чатах и звонках) | SKIP | — | — | — |
| 508acd4f5 | Add full-size media clipboard copying | контекстное меню, медиавьювер, shared media / message-interactions §1.4, media §8, popups §4.1 | Пункт «Копировать» (`MediaViewer.Context.Copy`, `keepOpen`, прелоадер в иконке пункта `setButtonMenuItemLoading`) в меню сообщения, кнопка в шапке вьювера и пункт в `SearchContextMenu`; копируется полноразмерный оригинал через `copyMediaToClipboard`, тосты `MediaCopied`/`MediaCopyFailed`. | `components/chat/contextMenu.ts` (в шапке :112 сказано, что в tweb такого пункта нет, — теперь неверно), `components/mediaViewer/appMediaViewer.ts:87` (кнопки `delete\|forward`), `helpers/clipboard.ts`; `SearchContextMenu` не портирован | PORT | M | shared media — задача 14 (`SearchContextMenu`) | Порядок: `helpers/copyMediaToClipboard` + `canvasToBlob`/`scaleMediaElement` → `setButtonMenuItemLoading` (+ `_button.scss`) → меню чата → вьювер → в задаче 14 сразу с пунктом. В `lang.ts:710` лежит ключ-самоделка `MediaViewer.Context.CopyMedia`: заменить на `MediaViewer.Context.Copy`. |
| 16de60dc5 | Add emoji skin tone picker | эмодзи-дропдаун / composer §8 | Долгое нажатие / ПКМ на эмодзи с тонами открывает пикер тонов (`emojiTonePicker.tsx`, стили в `_chatMarkupTooltip.scss`); выбранный тон хранится в state (`emoji_variant`) и применяется ко всей сетке и «Недавним»; таблица `config/emojiSkinTone.ts`. | `components/emoji/EmoticonsTab.tsx`, `emojiData.ts` — тонов нет вовсе | PORT | M | — | Бэкенд не нужен: вариант живёт в локальном state (у нас — settings-стор). Вместе с 1d98f721f и 31620b1e9. |
| 10314758c | Strengthen agent workflow instructions | AGENTS.md | — | — | SKIP | — | — | Тулинг tweb. |
| 1faad1d59 | Fix round video progress ring sizing | кружки / media §6.3, bubbles §4.6 | Размер кольца = `min(doc.w, round.width)`: старые кружки меньше текущего размера; `createProgressRing` получает `setSize`, глобальный `roundVideoCircumference` убран. | `components/wrappers/video.ts:154-182,760`, `components/progressRing.ts` — старая схема 1:1 | PORT | S | — | — |
| 79b9c44c1 | Fix album drag multiselection | выделение / message-interactions §8.1–8.2, chat-feed §8.1 | Drag-выделение по альбому раскрывает диапазон по элементам альбома (`selectionRange.ts`: `expandAlbumSelectionRange`); `toggleByElement(el, selected)` вместо `toggleByMid`; `getElementsBetween` стал protected-методом. | `components/chat/selection.ts:302,368` (порт старой версии) | PORT | M | shared media — задача 14 (`SearchSelection.toggleByElement`, `toggleByMid` удалён) | Порт вместе с d064fdb85. |
| 2488f2cf0 | Add bot reporting | топбар, профиль / right-sidebar §3 | «Пожаловаться» в меню топбара для лички теперь **только с ботом** (`canReportBot`: bot && !support && не бот кодов); в профиле бота строка `BotReport` в MainSection. | `components/HeaderMenu.tsx:97-137` — для лички «Report» у всех, кроме сервисного; `components/peerProfile.solid.tsx` (MainSection) | PORT | S | — | Боты у нас есть (`docs/bots`). Сейчас пункт лишний у обычных пользователей, т.е. расходимся уже со старым tweb. |
| 1d98f721f | Fix emoji skin tone in sticker viewer | просмотр стикеров / media (stickerViewer) | Подпись и `wrapSticker({emoji})` во вьювере берут эмодзи с тоном из `dataset.stickerEmoji`. | `components/stickers/StickerViewer.tsx:58` — `stickerEmojiRaw` | PORT | S | — | После 16de60dc5. |
| 41d9adb14 | Fix overlapping unread and mention buttons | угловые кнопки ленты / chat-feed §4.5 | `.bubbles-go-down { --translateY: 0 }` и `transform: translateY(var(--translateY)) translateY(-surplus)` у `.bubbles-corner-button`, иначе кнопки наезжают друг на друга. | `styles/tweb/_chat.scss:1435` (старая строка) | PORT | S | — | Копия партиала — правка 1:1. |
| 7082e1a18 | Fix iOS theme transition positioning | тема (view transition) / — (вне docs/tweb, программа web-css) | Масштаб клипа = DPR везде, кроме iOS (там 1). | `core/hooks/useThemeToggle.ts:39-45` — DPR не учитываем **вовсе** (в e52b5d931 уже был), длительность захардкожена 450 мс | PORT | S | — | Переносить вместе с пропущенным ранее масштабом DPR и `getTransition` из `themeController.ts`. |
| 1b1844e6c | Trigger PWA scope revalidation in Chrome 150 | SW / media §5.2 | `.webmanifest` убран из кэш-гейта SW; theme_color манифеста → `#fffffe`. | манифеста нет; `public/sw.js:139` цитирует старый regex с `webmanifest?` | DOC | — | — | Поправить цитату в `sw.js` и §5.2. |
| b85527091 | Fix custom emoji panel flickering | эмодзи-дропдаун / composer §8 (:1768) | Панель непрозрачная: убраны `backdrop-filter` и полупрозрачный фон (мигание из-за канвасов). | `styles/tweb/_emojiDropdown.scss:34` | PORT | S | — | Правка партиала 1:1; в composer.md §8 убрать `backdrop-filter`. |
| 2117883fd | Implement ephemeral messages | лента, композер, менеджер сообщений (+1377 строк) / bubbles, composer, chat-feed | Эфемерные сообщения ботов (видит один получатель, свой диапазон id, `updateNew/Edit/DeleteEphemeralMessage`, `inputReplyToEphemeralMessage`), бейдж, особый порядок в `bubbleGroups` (`compareBubbleTimelineMessages`). | нет | BLOCKED | L | — | Бэкенд: модель EphemeralMessage + Bot API-метод + апдейты. Боты есть, но фича не в плане → низкий приоритет. **Сдвигает адреса** в `bubbles.ts` (+360), `input.ts` (+306), `contextMenu.ts` (+85), `bubbleGroups.ts` (появилась ветка compare-функций) — см. сводку по докам. |
| 50c02018d | Update AGENTS.md for the ESLint → oxlint migration | тулинг | — | — | SKIP | — | — | — |
| 15de983de | Implement object URL lifecycle, disabled in production for now | медиа-модель / media §4.3, §5.5, §7.2; state-and-layout §3.5 | LRU воркера вытесняет и отзывает общие blob:-URL (через 30 с после вытеснения); долгоживущие потребители (играющее видео/аудио, MediaSession, CSS-фон) держат `pinObjectURL`; одноразовые вкладочные URL — через `ObjectURLScope`; реестр `mainWorker/objectUrlRegistry.ts` + зеркало `reconcileObjectURLMirrorValue`. | `core/managers/mediaManager.ts:199-215` (воркер минтит blob:), `core/mediaCache.ts` (зеркало), 27 мест `createObjectURL` / 18 `revokeObjectURL` | PORT | L | медиа-модель («супер аналогично» tweb) | Наша модель та же (URL минтит воркер, вкладка зеркалит), значит и утечка та же. Порт вместе с 85f27ea3c. Правило пинов — дословно из tweb AGENTS.md. |
| e7aeb0e8b | Implement chat automation | Business: подключённые боты / left-sidebar (настройки) | Вкладка «Автоматизация чатов», сессии подключённых ботов, плашка-ревью подключения. | Business нет | SKIP | — | — | Попутно: `rowTsx` получил `role/tabIndex/aria-*` и активацию по Enter/Space, `section.tsx` пробрасывает rest-пропы. Мелочь для `rowTsx.solid.tsx`/`section.solid.tsx`, можно подхватить при случае. |
| 7a52f3631 | Fix avatar viewer opening animation | медиавьювер / media §8, right-sidebar §3 | В мувере ветки `<img>/<video>` проверяются раньше `DIV/findUpAvatar`; рефлоу-барьер `void mover.offsetLeft` перед `fastRaf` с `.active`; `openAvatarViewer` получает готовое фото. | `components/mediaViewer/base.ts:1809-1850` (барьера перед `fastRaf` нет; `findUpAvatar` отложен), `components/peerProfileAvatars.ts` (у нас общий `openMediaViewer`) | PORT | S | — | Нужен барьер; порядок веток важен, когда вернётся `findUpAvatar`. |
| 9173dd8dc | Fix incoming star gift attribution | сервисные сообщения, подарки | Текст подарка: отправитель берётся из `action.from_id` (кроме prepaid_upgrade), направление self/outgoing/incoming. | подарок в ванильной ленте не рисуется (`components/chat/bubbles.ts:1906-1911`) | SKIP | — | — | Учесть при порте `PremiumGiftBubble` (`getStarGiftMessageTextDetails`). |
| 553143f1e | Add photo and video filters to shared media | shared media / right-sidebar §4 | ⋮-меню шапки с чекбоксами «Фото/Видео» (`createButtonMenuCheckboxFilters`); вкладка Media переключает `inputFilter` Photos/Video/PhotoVideo через «staging»-контейнер без мигания; подзаголовок «N фото, M видео» по отдельным счётчикам; видимость btnMenu = есть видимые пункты. Попутно: `onMediaClick` выходит, если цель отцепилась; фикс `idx !== -1` в удалении из истории. | `components/appSearchSuper.ts` (только `PhotoVideo`), `core/hooks/useSearchSuper.ts:67`, `components/userInfo/helpers.ts::countLabel`; ⋮-меню шапки нет | BLOCKED | M | shared media (после задачи 14) | Бэкенд: у `mediaFilterCond` (`backend/.../postgres/messagesrepo.go:520`) только `media` = photo+video; нужны фильтры `photos`/`videos` в `MediaHistory` и `SearchCounters`. Попутные мелочи сразу: guard `isConnected` (PORT S); фикс `idx` у нас уже есть (`components/sharedMediaHistories.ts:28-31,179` — «расхождение 2» снять, теперь 1:1). |
| eedb2b74e | Fix avatar offset for multi-row bot keyboards | баблы / bubbles §4.22, §5.4 | Отступ аватара под inline-клавиатуру считается по числу рядов (`--reply-markup-row-count`, grid в `::before`), а не фиксированные 43px; `filterReplyMarkupRows`. | `components/chat/bubbleGroups.ts:290`, `styles/tweb/_chat.scss:1495` | PORT | S | — | SCSS-переменные `$reply-markup-*` в `_chatVariables.scss`. |
| 1577b3231 | Add configurable main tabs to shared media | shared media / right-sidebar §4 | Главная вкладка профиля (`profile.main_tab`) идёт первой и выбирается при открытии; ПКМ по вкладке → «Сделать главной» (своя / Избранное / канал с `change_info`), тост `ProfileTab.OrderChanged`. | нет `main_tab` ни в модели, ни на бэке | BLOCKED | M | shared media | Бэкенд: `main_tab` в UserFull/ChannelFull + `account.setMainProfileTab` / `channels.setMainProfileTab`. |
| 4c678d0ab | Add sticky dates to shared media | shared media / right-sidebar §4, §5.4; chat-feed §6.3 | Плашка даты `bubble service is-date.search-super-scroll-date` (sticky под меню вкладок) на Media/Stories во время скролла, гаснет через 1 с; у плиток `data-timestamp`; `createDateBubble` вынесен в `chat/dateBubble.ts`. | `components/appSearchSuper.ts`; хук — в месте вызова `isSharedMediaReached` (`components/userInfo/helpers.ts`, `UserInfoPanel.tsx`); наш аналог `createDateBubble` — `components/chat/serviceMessage.ts` | PORT | M | shared media | Бэкенд не нужен. |
| d8d9ac8c8 | Fix TON transaction row visibility | Stars/TON | — | нет | SKIP | — | — | TON/Gram-платежи. |
| 72c50bfef | Fix notifications settings without Web Notifications API | настройки уведомлений / left-sidebar (таб notifications) | `IS_NOTIFICATION_SUPPORTED` (есть `Notification.requestPermission`); без API плашка-предложение скрыта / клик её закрывает, в настройках — тост `Notifications.Restricted`. | `components/settings/NotificationsSettings.tsx:37-49` (молча `return`), `components/sidebarLeft/notificationsSuggestion.tsx:28,65` | PORT | S | — | — |
| a6956b43d | Rename TON currency display to Gram | Stars/TON | — | нет | SKIP | — | — | — |
| acf69141f | Fix image document orientation in media viewer | медиавьювер / media §8 | Для документа-картинки с EXIF-поворотом размер берётся «перевёрнутым», если так совпадает пропорция самого большого thumb. | вьювер не открывает документы-картинки (`base.ts:2423` — `isDocument` только у видео) | SKIP | — | медиа-модель | Вернуться при порте фото-документов. |
| 5b1636d61 | Fix bot commands button behavior | композер / composer §1–2 | Клик по `.new-message-bot-commands` работает только при `has-offset` commands forwards; `--commands-size` 2.5rem, padding .75rem, иконка без scale(.875); ширина = текст + 24 + 20 + 6. | `components/Composer.tsx:285-291` (+22), `styles/tweb/_chat.scss:857` | PORT | S | — | — |
| 6ce2cafba | Fix chat padding during tag search | лента / chat-feed §1.4 | При `.chat.is-search-active` резерв плавающих плашек = 0 (и в `--pinned-floating-height`, и в паддинге ленты). | `components/Chat.tsx:466-470,1219` — резерв всегда `platesHeight` | PORT | S | — | — |
| 49842c597 | Fix peer profile without Fragment prefixes | профиль / right-sidebar §3 (:263) | `fragment_prefixes?.some(...) ?? false`. | `fragment_prefixes` не портирован (`peerProfile.solid.tsx:883`) | DOC | — | — | Уточнить в §3, что поле опционально. |
| b1f87b5c9 | Fix XSS via forged Electron helpers in message links | rich-text, Instant View | Electron-ссылки без `javascript:`, id от Temml в пространстве имён. | electron-ветки нет (`lib/richtext/wrapRichText.ts:32`), Temml нет | SKIP | — | — | — |
| c4618cc17 | Fix Instant View math never rendering | Instant View | Temml грузится ассетом (`?url`), а не бандлом. | математики в IV нет | SKIP | — | — | — |
| 4c5a2373a | Handle postMessage clone failures in SuperMessagePort | RPC / state-and-layout §1.1 | Все отправки через `sendTask`: неклонируемый батч повторяется по одной задаче, результат/ack, который нельзя клонировать, превращается в явную `DATA_CLONE_ERROR`, invoke без адресата реджектится; в `awaiting` хранится имя/метод. | `rpc/superMessagePort.ts:99,211` — неклонируемый payload в `invoke` бросает синхронно и оставляет запись в `awaiting` (с таймером); `emit` бросает у вызывающего | PORT | S | — | Результат у нас случайно защищён try/catch в `onMessage`. |
| 701e811fc | Fix join button label for channels with join requests | композер (join) / channels §3, composer §2 | Сначала `type === 'request'` → «Request to Join», затем broadcast → «Subscribe», иначе «Join». | `components/conversation/ChatInputControl.tsx:117,149-150` — кнопка-заглушка (`take(false)`, всегда `ChannelJoin`) | DOC | — | каналы/комментарии | Обновить строку «Subscribe vs Join» в channels §3; порядок учесть, когда появится состояние «не подписан». |
| 088d69006 | Support guard-bot joins through their WebView (layer 228) | вход по инвайту, mini-apps | Вход по ссылке через guard-бота: `messages.requestChatJoinWebView`, WebView → `updateJoinChatWebViewDecision` (approved/declined/queued); `WebApp.destroy` идемпотентен. | инвайты с `request_needed` и mini-apps есть; guard-ботов нет | BLOCKED | M | — | Бэкенд: guard_bot, join-request query к боту, requestChatJoinWebView, апдейт решения. Низкий приоритет. |
| 2d2f188e1 | Implement Telegram Communities | новый тип пира, чатлист, поиск, профиль, редактирование чата | Сообщества (+~10 тыс. строк). | нет | SKIP | — | **папки, глобальный поиск, shared media, виртуальный список** | Фичу не берём, но коммит перекраивает то, что мы портируем: `appDialogsManager.ts` (+364/−: `DialogElement.setBadgeState/setMuted`, подписи → `wrappers/dialogSubtitle.ts`), `sidebarLeft/index.ts` (initSearch: `communityId`, счётчик архива через `getFolderUnreadCount`; в slider `closeTabsNaturallyUntil`), `appSearchSuper.setQuery({communityId})`, `sortedDialogList.ts`, `editChat.tsx` (переписан), `userPermissions` → `chatUserPermissions.tsx`. Попутный PORT S: `horizontalMenu.selectTarget` выходит, если `target` не найден после `onClick` (у нас `components/horizontalMenu.ts`, используют `tabs.solid.tsx` и `appSearchSuper`). |
| 6619fdb57 | Support guard bots end to end | права админа, тип чата / channels §6–7 | Админская сторона guard-бота: право «Обрабатывать заявки», `toggleJoinRequest(guard_bot)`, у каналов появилась секция одобрения заявок (`ChannelSettingsJoinRequestChannel`). | вкладки «тип чата» с тумблерами заявок у нас нет; заявки — только список в профиле (`core/managers/groupsManager.ts:573-577`) | BLOCKED | M | каналы | Тот же бэкенд, что у 088d69006. |
| 62c3ad60a | Support stars_spend_topup_invoice_disabled | Stars | Не предлагать пополнение Stars, если трата идёт боту/каналу и appConfig запрещает. | зачатки Stars (`components/stars/StarsPopup.tsx`), appConfig нет | SKIP | — | — | Stars-платежи. |
| d73711ab1 | Build | сборка | — | — | SKIP | — | — | — |
| 229ee6194 | Support stars_purchase_blocked | Stars | Покупка Stars запрещена → алерт, без вариантов пополнения. | зачатки Stars | SKIP | — | — | — |
| 31620b1e9 | Fix sticker viewer not looping stickers | стикеры / bubbles §4.2, media (wrapSticker) | Решение «не зацикливать» убрано из `wrapSticker` и перенесено в вызов для big-emoji в `bubbles.ts` (`loop: isEmoji ? false : loop`). | `components/wrappers/sticker.ts:164-167` — старое правило `!emoji && loop` | PORT | S | tlottie | Иначе после 1d98f721f стикер во вьювере перестанет крутиться. |
| d064fdb85 | Fix a drag selection starting inside an album | выделение / message-interactions §8 | Первый move с `first === last` даёт пустой диапазон; сгруппированный бабл — одна единица drag, диапазон только item→item внутри. | `components/chat/selection.ts` | PORT | S | shared media — задача 14 (общий `AppSelection`) | Вместе с 79b9c44c1, после него. |
| 4126377c0 | Fix an ordinary forum opening as a navigation tab | чатлист (сообщества) | `isCommunityChat(chat)` вместо «любой chat». | — | SKIP | — | папки | Фикс кода Communities. |
| 85f27ea3c | Enable the object URL lifecycle in production | медиа-модель | Снят PROD-гейт отзыва blob:-URL; откат — `?noObjectUrlRevoke=1`. | — | PORT | S | медиа-модель | Часть 15de983de (переносить сразу включённым). |
| 08d07c2b4 | Fix a forum row rendering two '@' badges for one mention | чатлист / left-sidebar (Chatlist §4 «Бейджи») | `getDialogMentionBadgeState`: непрочитанный бейдж превращается в «@», только если непрочитанное — одно упоминание; отдельный бейдж упоминаний — при `mentions>1 \|\| messages>1` и никогда вместе с «@». | `components/ChatListItem.tsx:234-239` — «@» при любом `unreadMentions` плюс число рядом | PORT | S | виртуальный список диалогов / папки | Мы расходимся и со старым tweb (unread=1+mention → у них «@», у нас «@» и «1»). |

## Сводка части

**Счётчики (52):** PORT — 22 · DOC — 3 · SKIP — 22 · BLOCKED — 5.

### Группы, которые портировать вместе (в этом порядке)

1. **Тоны эмодзи:** 16de60dc5 (пикер + state) → 1d98f721f (вьювер берёт эмодзи с тоном) →
   31620b1e9 (зацикливание решает место вызова big-emoji). Третий обязателен: без него после второго
   стикеры во вьювере перестанут крутиться.
2. **Drag-выделение альбомов:** 79b9c44c1 → d064fdb85. Здесь же сигнатура `toggleByElement(el, selected)`,
   на неё опирается задача 14 shared media.
3. **Копирование медиа:** 508acd4f5 целиком (helpers → пункт меню с прелоадером → меню чата → вьювер →
   `SearchContextMenu` в задаче 14).
4. **Жизненный цикл object URL:** 15de983de + 85f27ea3c (сразу без PROD-гейта).
5. **Shared media:** 4c678d0ab (sticky-дата, без бэка) — сразу; 553143f1e и 1577b3231 — после ручек
   бэкенда (фильтры photos/videos, `main_tab`). Порядок в tweb: 553143f1e → 1577b3231 → 4c678d0ab; они
   правят одни и те же места `appSearchSuper.ts`/`sharedMedia.tsx`, поэтому при раздельном порте сверяться с
   финальной версией файла.
6. **Guard-боты:** 088d69006 → 6619fdb57 (оба BLOCKED, одна ручка бэкенда).
7. **Одиночные S-правки SCSS/поведения** (независимые): 41d9adb14, b85527091, eedb2b74e, 5b1636d61,
   6ce2cafba, 1faad1d59, 7a52f3631, 7082e1a18, 72c50bfef, 2488f2cf0, 08d07c2b4, 4c5a2373a, 8d06fbc9c.

### Security, которое вскрылось по ходу (у нас, не в самом tweb)

- **SW `/dnp-stream/` отдаёт `Content-Type` из query** (`public/sw-stream.js:196`) — порт 8d06fbc9c, S.
- **SAS звонков без commitment** (`core/calls/callEngine.ts`) — MITM подбирает эмодзи; нужен commit-reveal.
- **Распаковка TGS без лимита** (`core/stickers/tgs.ts:15`, `lib/lottie/lottieLoader.ts:180`) — долг ещё с
  f3733adc2 (он был в e52b5d931).
- `rpc/superMessagePort.ts`: неклонируемый payload роняет invoke синхронно и оставляет висящую запись в
  `awaiting` (4c5a2373a).

### Наши доки, у которых устарели адреса или описания

- **bubbles.md** — адреса `bubbles.ts` сдвинуты целиком (ephemeral +360, communities +39, sticky-дата −34);
  §4.2 (loop big-emoji перенесён в место вызова); §4.22/§5.4 (`avatar-for-reply-markup` →
  `--reply-markup-row-count`, `filterReplyMarkupRows`, `$reply-markup-*`); §5 (в `bubbleGroups` появились
  compare-функции `compareBubbleTimelineMessages`).
- **chat-feed.md** — адреса `bubbles.ts`/`chat.ts`; §4.5 (`--translateY` у go-down / corner-button);
  §6.3 (`createDateBubble` → `chat/dateBubble.ts`); §8.1 (`selectionRange.ts`); §1.4 (резерв плашек при
  `is-search-active`).
- **composer.md** — адреса `input.ts` (+306 ephemeral, +6 bot commands); §1–2 (bot-commands: 2.5rem,
  .75rem, клик только при has-offset); §2 (порядок меток join); §8 (пикер тонов; `backdrop-filter`
  у `.emoji-dropdown` удалён — строка :1768).
- **message-interactions.md** — §1.4 (новый пункт «Копировать», адреса `contextMenu.ts` сдвинуты на
  ~+120); §8.1–8.2 (`getElementsBetween` protected, `toggleByElement(el, selected)`, `toggleByMid` удалён,
  альбом — одна drag-единица).
- **media.md** — §4.3/§5.5/§7.2 (object URL: реестр, LRU, пины, `ObjectURLScope`); §5.2 (webmanifest вне
  кэш-гейта); §5.3 (allowlist mime, nosniff, отказ навигации в `stream.ts`); §6.3 (кольцо кружка по
  `doc.w`, `setSize`); §8 (кнопка copy во вьювере, `documentSize.ts`, порядок веток мувера + рефлоу-барьер).
- **right-sidebar.md** — §3 (`PeerProfile.BotReport`, `fragment_prefixes?`, `openAvatarViewer` с готовым
  фото); §4 (фильтры фото/видео, главная вкладка, sticky-дата, `SearchContextMenu` + copy, guard
  `isConnected`); :689 и §3 btnMenu (видимость = «есть видимые пункты», не «только Saved»); §5.4 (новый
  sticky-элемент `search-super-scroll-date`).
- **left-sidebar.md** — Chatlist §0–§9 (рефакторинг `appDialogsManager.ts` в Communities:
  `DialogElement.setBadgeState/setMuted`, `wrappers/dialogSubtitle.ts`, `getDialogMentionBadgeState`, все
  адреса); поиск §4 (`initSearch` в `sidebarLeft/index.ts` — ветки `communityId`, адреса :1084-1554
  сдвинуты); §3/§5 slider (`closeTabsNaturallyUntil`); таблица настроек (notifications: без Notification API).
- **channels.md** — §3 (строка «Subscribe vs Join»: сначала request); §6 (`editChat.tsx` переписан,
  +819/−); §7 (`chatUserPermissions.tsx`, право «обрабатывать заявки» для guard-бота; у каналов секция
  одобрения заявок).
- **state-and-layout.md** — §1.1 (`sendTask`, `DATA_CLONE_ERROR`, логирование без payload); §3.4
  (`lib/passcode/keyHandoff.ts`, invoke `passcodeKeyHandoff`); §3.5 (зеркало object URL).
- **popups.md** — §4.1 (`setButtonMenuItemLoading`, `.btn-menu-item-preloader`,
  `createButtonMenuCheckboxFilters`).
- **Комментарии в нашем коде, ставшие неверными:** `components/chat/contextMenu.ts:112-115` (про «Copy Media»
  в tweb), `components/sharedMediaHistories.ts:28-31,179` («расхождение 2» — tweb починил), `public/sw.js:139`
  (цитата regex), `lang.ts:710` (ключ `MediaViewer.Context.CopyMedia`).

### Что задевает идущие программы (по приоритету)

1. **Shared media / AppSearchSuper (задача 14 и дальше) — высокий.** Задачу 14 (`SearchSelection` /
   `SearchContextMenu`) портировать уже по новому tweb: `toggleByElement(el, selected)` без `toggleByMid`
   (79b9c44c1), пункт «Копировать» с `keepOpen` и прелоадером (508acd4f5), общий `AppSelection` с
   альбомной логикой (d064fdb85). Сразу же — sticky-дата (4c678d0ab, M, без бэка) и guard `isConnected` в
   `onMediaClick`. Для фильтров фото/видео и главной вкладки (553143f1e, 1577b3231) заводить ручки бэкенда.
   В `sharedMediaHistories.ts` снять «расхождение 2».
2. **Папки / виртуальный список диалогов — высокий (для доков), средний (для кода).** 2d2f188e1 переписал
   `DialogElement` (бейджи → `setBadgeState`/`setMuted`, подписи → `wrappers/dialogSubtitle.ts`) и
   `appDialogsManager.ts`: следующие этапы порта сверять с 812502980, а не с e52b5d931, и вырезать ветки
   сообществ. 08d07c2b4 — логику «@»-бейджа перенести сразу (сейчас расходимся и со старым tweb). Попутно —
   null-guard в `horizontalMenu.selectTarget` (им пользуется `tabs.solid.tsx`).
3. **Глобальный поиск на AppSearchSuper — средний.** `initSearch` (`sidebarLeft/index.ts`) и
   `appSearchSuper.setQuery` получили ветки `communityId` (2d2f188e1): поведение для нас не меняется, но
   адреса в left-sidebar §4 и в постановках ещё не портированных задач сдвинулись.
4. **Медиа-модель — средний.** 15de983de + 85f27ea3c (L): вытеснение и отзыв blob:-URL с пинами —
   прямое продолжение нашей модели «воркер минтит URL». Сюда же 8d06fbc9c (DNP-стрим).
5. **Каналы / комментарии — низкий.** 701e811fc (метка join, DOC), 6619fdb57 (секция одобрения заявок у
   каналов, BLOCKED), переписанный `editChat.tsx` (адреса channels §6).
6. **tlottie — низкий.** 31620b1e9 (правило loop в `wrapSticker`) и долг с лимитом распаковки TGS.
