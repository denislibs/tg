# Фронтовый паритет с tweb — полный per-file аудит

**Дата:** 2026-08-07
**Задача:** зафиксировать все расхождения фронта нашего клона (`web-client/`) с референсом tweb (Telegram Web K), как рабочий бэклог для доведения до «1:1 из tweb» (мандат `CLAUDE.md`).
**Метод:** 6 параллельных разведок по UI-поверхностям (композер, лента/пузыри, сайдбар/поиск, медиа/редактор/сторис, настройки/профиль, звонки); чтение обеих кодовых баз, а не по памяти.

**Базовые пути:**
- Наш фронт: `/Users/denisurevic/Documents/messenger-denis/web-client/src/`
- Референс tweb: `/Users/denisurevic/Documents/tweb/src/`

**Легенда категорий:**
- **(A)** — фичи нет вовсе.
- **(B)** — есть, но упрощено / ведёт себя иначе.
- **(C)** — отсебятина: сделано не так, как в tweb (в оригинале иначе или отсутствует).

> Примечание: `file:line` — снимок на дату аудита; строки могут сдвинуться. Проверять по символу/контексту, не по номеру.

---

## Оглавление
1. [Композер / инпут](#1-композер--инпут)
2. [Лента сообщений / пузыри](#2-лента-сообщений--пузыри)
3. [Сайдбар / список / поиск](#3-сайдбар--список--поиск)
4. [Медиа-вьюер / редактор / сторис / плеер](#4-медиа-вьюер--редактор--сторис--плеер)
5. [Настройки / профиль / приватность](#5-настройки--профиль--приватность)
6. [Звонки](#6-звонки)
7. [Сквозная отсебятина (сводка C)](#7-сквозная-отсебятина-сводка-c)
8. [Приоритеты](#8-приоритеты)

---

## 1. Композер / инпут

Наши: `components/Composer.tsx` (+ `composer/`, `MarkupTooltip.tsx`, `RichText.tsx`, `core/richtext/markdown.ts`, `*Helper.tsx`, `core/hooks/useVoiceRecorder.ts`, `emoji/EmojiDropdown.tsx`, `SchedulePopup.tsx`).
tweb: `components/chat/input.ts` (+ `markupTooltip.ts`, `commandsHelper.ts`, `botCommands.ts`, `inlineHelper.ts`, `mentionsHelper.ts`, `recording/chatRecording.ts`, `emoticonsDropdown/`, `helpers/dom/markdown.ts`, `helpers/dom/isSendShortcutPressed.ts`, `paidMessagesInterceptor.ts`).

### Форматирование текста
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Web-page link-preview + опции | нет упоминаний webPage в `Composer.tsx`/`core/hooks/useComposerDraft.ts`; ссылка уходит текстом/entity без превью | `input.ts:3180 processWebPage()`, `willSendWebPage`, `webPageOptions`, `invertMedia`, `noWebPage`, меню опций `input.ts:769 constructWebPageElements` (above/below, larger/smaller, remove) |
| A | Авто-детект entity на отправке | `core/richtext/markdown.ts parseMarkdown` разбирает только явные маркеры `** __ ~~ \|\| \` ``` [](…)`; авто-линковка URL/@/# только на рендере `RichText.tsx:9-26` | `input.ts:3125,3460 mergeEntities(parseMarkdown, parseEntities(value))` — URL/email/phone/@mention/#hashtag//command → entity на сервер |
| A | Markup-тип `date` (self-destruct timestamp) | `MarkupTooltip.tsx:16-25 TOOLS` — только bold/italic/underline/strike/code/spoiler/blockquote/text_link | `markupTooltip.ts:74` кнопка `date` → `showDatePicker()` → `applyMarkdown({type:'date'})` |
| B | Collapsible blockquote | `markdown.ts:330` — просто `span.md-quote`, без collapsed | `input.ts:3016-3022` разворот/сворачивание цитаты (`can-send-collapsed`, `data-collapsed`, тосты), collapsed в entity |
| B | Подсветка тулбара partly/fully | `markdown.ts:257 activeTypes()` — `queryCommandState` + предок; без partly/fully | `markupTooltip.ts:319 getMarkupInSelection` + `DISPLAY_MARKUP_PARTLY` |
| B | Link-editor валидация/префилл | `MarkupTooltip.tsx:132-148` — поле + Enter, без валидации/подсветки, без префилла href при активной ссылке | `markupTooltip.ts:116-138` live-валидация (`matchUrl`, класс error/is-valid), префилл href, back-кнопка |
| C | Ctrl+K из инпута | `Composer.tsx:510-518` — `window.prompt(t('Enter URL'))` | `markdown.ts:515` `KeyK` → `MarkupTooltip.showLinkEditor()` инлайн |
| C | Кастом-эмодзи в инпуте | `Composer.tsx:536-551`, `markdown.ts:309-318` — `span.md-custom-emoji` со статичным глифом (даёт entity, но не анимируется) | `CustomEmojiRendererElement`/`CustomEmojiElement` — анимированный документ |

> Хоткеи B/I/U/S/M/P совпадают 1:1: `helpers.ts:13` == `markdown.ts:499`.

### Панель эмодзи / стикеров / GIF
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Suggest кастом-эмодзи к обычному эмодзи | `composer/useComposerAutocomplete.ts checkEmojiAutocomplete` — только по слову `searchEmojisByWord` | `emojiHelper.ts:181 checkEmoticon()` + `input.ts:3475 getCustomEmojiSuggestionEmoticon` |
| B | Настройки suggest не учитываются | эмодзи/стикер-саджесты включены всегда | `input.ts:3475,3490` гейт `appSettings.emoji.suggest`/`stickers.suggest` |
| B | Права send_stickers/send_gifs | `StickersHelper` без проверки прав; `canSendMedia` гейтит только attach/микрофон | `input.ts:3491 canSend('send_stickers')`, `input.ts:4312 sendMessageWithDocument` маппинг + тост |

> Сама панель `EmojiDropdown.tsx` (search/emoji/stickers/gifs, recent, custom sets через `useCustomEmojiSets`) — ближе всего к tweb `emoticonsDropdown/tabs/*`. OK.

### Автокомплит (@ / :emoji: / стикеры / команды / inline)
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Автокомплит бот-команд `/` + панель команд бота | ветки только emoji/inline/mentions; `/`-команд и кнопки списка нет | `commandsHelper.ts CommandsHelper` + `botCommands.ts ChatBotCommands` + `input.ts:927-990 botCommandsToggle`; ветка `/` в `input.ts:3514` |
| B | Mentions без сервера/global/guest | `useComposerAutocomplete.checkMentionAutocomplete:110` — фильтр локального массива участников, без себя | `mentionsHelper.ts:37 getMentions(...)`, `globalMentions`, guest-bots `input.ts:3504-3510` |
| B | Стикер-саджест по эмодзи | `StickersHelper.tsx:14 stickerSuggestEmoji` — `emojiOnlyCount===1 && len<=8` по textContent; кастом-эмодзи не триггер | `input.ts:3488-3497` — по entity `messageEntityEmoji`/`messageEntityCustomEmoji`, покрывающей весь ввод |
| B | Inline без switch_pm/webview/галереи/guest | `InlineResultsHelper.tsx` — только list-режим, debounce 200мс | `inlineHelper.ts` — галерея masonry, `switch_pm`/`switch_webview` `:273`, guest `:99`, «send_inline not allowed» `:335` |
| B | Триггер @/ и навигация списков | mention через `caretWord()` `/(?:^\|\s)(\S+)$/`; inline `^@user\s…$`; стрелки/Enter/Tab вручную в `Composer.onEditorKeyDown:426-487`, приоритет захардкожен в JSX `:594-605` | единый `AUTO_COMPLETE_REG_EXP`; общий `attachListNavigation` + `AutocompleteHelperController` |

### Реплай / цитата в композере
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Reply-to богатые типы | `ReplyState` (`Composer.tsx:53`): `msgId,name,text,color,quote,chatId,snapshot*`; нет story/poll-option/другого peer/monoforum | `ChatInputReplyTo` (`input.ts:194`): `replyToMsgId,replyToQuote,replyToPollOption,replyToStoryId,replyToPeerId,replyToMonoforumPeerId` |
| A | Custom reply keyboard (бот) | нет | `input.ts:913-923 btnToggleReplyMarkup` + `replyKeyboard.tsx` |
| C | Форвард-плашка | `ForwardBar` (`Composer.tsx:56,966-1009`) — своё оформление меню show/hide sender+caption | `input.ts:285 forwarding` `{[fromPeerId]:number[]}` + `forwardElements.hideSender/isDroppingCaptions` `input.ts:4239` |

### Вложения
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Attach-menu боты (mini-apps) | `onOpenAttach(rect)` — обычное меню | `input.ts:1195-1205 getAttachMenuBots()` |
| B | Drag&drop overlay-зоны | `Composer.onDrop:417-424` — просто `dataTransfer.files`, без визуальной зоны и различения media/file | `dragAndDrop.ts` — SVG-outline контейнер, зоны «как файл»/«как медиа» |
| C | Paste текста (анти-фриз) | `Composer.tsx:352-406` — один text-node через Range + `htmlToRich` санитайз + сверка richLen==plainLen (осознанно) | `input.ts:3327 insertRichTextAsHTML` |

> Multi-file / альбомы / media-preview popup / подписи в нашем клоне живут вне `Composer.tsx` (через `onPasteFiles`/`onOpenAttach`); в tweb attach-flow завязан на `input.ts`.

### Голосовые / видео-кружки
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Waveform в отправляемом голосовом | `useVoiceRecorder.ts` — `VoiceResult={secs,blob,mime,mode}`, waveform не считается (bars только live) | `recording/chatRecording.ts:208-234 VoiceWaveformAnalyser.finish()` → waveform+duration в voice-note |
| A | Slide-to-lock записи | запись сразу «locked-подобная» (`Composer.tsx:711-749`), слайд-жеста нет | `chatRecording.ts:179,247 is-locked`, slide-to-lock/cancel |
| B | Формат/пайплайн записи | голос `audio/webm;opus` (`useVoiceRecorder.ts:161`); кружок `video/webm;vp9/vp8,opus`, 400×400@30, cap 60с | `opusDecodeController`, `NativeVideoRecorder` (mp4/avc1+aac), пауза с compressed-peaks-плейбеком |
| C | Авто-send кружка на 60с | `useVoiceRecorder.ts:92` — `secs>=60` → `stop(true)` авто-отправка | `chatRecording.ts:86-89` — на лимите paused-preview, не авто-send |

### Отправка
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Настройка sendShortcut Enter/Ctrl+Enter | `Composer.tsx:501` — жёстко Enter шлёт, Shift+Enter перенос | `helpers/dom/isSendShortcutPressed.ts` + `config/state.ts:55,412 sendShortcut` |
| C | Эффекты сообщений | `helpers.ts:19 EFFECT_CHOICES` (🎉/🎆/❤️…) → `core/effects/emojiEffects.ts playEmojiEffect` (свои конфетти) | `input.ts:300 effect:Accessor<DocId>` + `selectedEffect.tsx` — реальный анимированный docId-эффект |
| B | Silent | `Composer.tsx:922-927` — «Send Without Sound» разово | tweb + постоянный silent-тоггл для каналов + иконка |
| B | Schedule popup | `SchedulePopup.tsx` — нативные `input date/time` | `input.ts:22 showScheduleSendingPopup` — datePicker с ограничениями, встроенный «Send When Online», редактирование времени |
| A | Paid messages flow | `Composer.tsx:609-616` — только плашка «стоит N⭐» | `input.ts:134,570 PaidMessagesInterceptor` + `paidMessagesInterceptor.ts` (`prepareStarsForPayment`, подтверждение) |
| A | Прочие кнопки инпута | нет | `btnSendGift` `input.ts:1023`, `btnAutoDeletePeriod` `:243`, inline-`btnPreloader` `:3558`, suggestedPost |
| B | Send-as | `SendAsButton.tsx` + `useSendAs.ts` — аватар + попап при peers>1 | `sendAs.ts ChatSendAs` (`input.ts:387 sendAsPeerId`) — кэш/резолв, каналы/анонимный админ |

### Инлайн-редактирование
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Правка media-caption / удаление при очистке | `EditState={msgId,text,entities}` (`Composer.tsx:54`) — только текст | `input.ts:4272-4292 editMessage(...,{entities,noWebPage,webPage,invertMedia})`; пустой текст + нет media → `PopupDeleteMessages` |
| — | ArrowUp=edit last / Ctrl+ArrowUp=reply prev | `Composer.tsx:491-498` — совпадает по идее | tweb аналогично |

---

## 2. Лента сообщений / пузыри

Наши: `components/messages/{ChatFeed,MessageRow,MessageContent,AlbumGrid}.tsx`, `bubbleParts/{richBubbles,primitives,mediaBubbles}.tsx`, `components/conversation/{MessageContextMenu,SelectionBar,PinnedBar,ScrollDownFab}.tsx`, `core/hooks/{useChatScroll,useMessageActions}.tsx`.
tweb: `components/chat/{bubbles,bubbleGroups,contextMenu,selection,reaction,reactions,input,pinnedMessage}.ts(x)`, `components/wrappers/{album,groupedDocuments}.ts`, `scss/partials/{_chatBubble,_chat}.scss`.

### Группировка пузырей
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Критерий склейки | `ChatFeed.tsx:99-114 groupBreak` — автор+день+Δ≤121000мс | `bubbleGroups.ts:585-598 canItemsBeGrouped` (`newGroupDiff=121`) — те же пороги + ломает по `post_author`/`viaBotId`/`suggested_post`/forum threadId/guest |
| B | Группировка по имени, не по id | аватар-ран по `gm.sender !== m.sender` (имя, `ChatFeed.tsx:250-252`) — тёзки склеятся | строго по `fromId` |

> Аватар/хвостик совпадают: sticky `bottom:72px` (`ChatFeed.module.scss:114-119`) ≈ `_chatBubble.scss:48-51`; `BubbleTail` — порт `#message-tail-filled` (`primitives.tsx:87-108`); радиусы 15/5 совпадают.

### Альбомы
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Grouped-документы (файлы/аудио) | `ChatFeed.tsx:120 isAlbumMedia` — только photo/video; группа документов развалится | `groupedDocuments.ts` + `bubbles.ts:108` — вертикальный список по `grouped_id` |
| B | Ширина грида | `AlbumGrid.tsx:19 MAX_W=320` | `mediaSizes.album=420` на десктопе |
| B | Подпись/время сводного пузыря | `ChatFeed.tsx:139-154 albumMsgOf` — подпись из первого с текстом, время из последнего; `invert_media` нет | tweb `wrapAlbum` с invert-media |

> Сам `Layouter` (`core/dom/groupedLayout.ts`) — порт tdesktop, как в tweb. OK.

### Реакции
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Аватары реагировавших на чипе | чип — только эмодзи+счётчик (`MessageRow.tsx:110-133`) | `reaction.ts:1060-1083 renderAvatars` (`StackedAvatars`) |
| A | Lottie appear/select/around | CSS scale-подскок (задокументировано `MessageContextMenu.tsx:6-9`); счётчик меняется скачком | `reaction.ts:274,675,1182-1260 around_animation`+`flight`; `CounterAnimation` |
| B | Tooltip «кто реагировал» | только по right-click/long-press `useMessageActions.tsx:396-403 showReactedUsers`; hover нет | hover-tooltip + `contextMenu.ts:1586 getMessageReactionsListAndReadParticipants` |
| B | Быстрая реакция / двойной клик | двойного клика нет; реакция только через чип/меню | `bubbles.ts:1498` двойной клик = reply; быстрая реакция отдельно |
| B | Полоска реакций над меню | захардкожен `['❤️','👍','👎','🔥','🥰','👏','😁']` (`MessageContextMenu.tsx:22`) | available/top reactions с сервера, сортировка, premium/платные |

### Сервисные сообщения
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Типизированные сервис-пузыри | пилюля с готовым текстом (`ChatFeed.tsx:191-204`) + спец-случаи (фото профиля, ServicePhoto) | `chat/bubbles/service.tsx` — `serviceMediaBubble`, `suggestBirthday`, `starGift`, `premiumGift`, `unknownUser`, `botforumNewTopic`, `chatThreadSeparator`, `suggestedPostActionContent` с кнопками/медиа |
| C | Hover-затемнение сервис-msg | `ChatFeed.module.scss:73-75` `color-mix(#000 12%)` на hover | в tweb hover-подсветки у service-msg нет |

### Разделители дат / непрочитанные
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Дата-разделитель | `<section>` на день + sticky-пилюля с инлайн `top` (`ChatFeed.tsx:67-71,264-272`) | единый плавающий sticky с `is-sticky` появлением/затуханием (`_chatBubble.scss:480-517`, `bubbleGroups.ts:316`) |
| B | Метка «непрочитанные» | `unreadDivider` (`ChatFeed.tsx:177-184`), `unreadScrolled` один раз за открытие (`useChatScroll.ts:248-279`); без динамики | `is-first-unread` + управление `historyMaxId`/`readMaxId`, переустановка/скрытие |

### Ответы / пересланные
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Highlight цитаты/варианта опроса при переходе | `jumpToSeq(m.reply.seq)` центрирует весь пузырь + мигание (`useChatScroll.ts:165-191`) | `bubbles.ts:4765 highlightBubble` по quote-offset; `bubbles.ts:11788 highlightBubblePollAnswer` |
| B | Reply-preview | `MessageContent.tsx:471-494` — полоса+имя+текст+`ReplyThumb`, иконка `quote_outline` при quote | `replyContainer.ts` — story mention, media от другого peer |
| B | Fwd header | `MessageContent.tsx:463-470` — «Forwarded from»+имя | `bubbles.ts:7783-7789` — `isForwardOfForward`, `post_author`, `viaBotId`, скрытая атрибуция, ссылка на пост, PSA, `canHideNameIfMedia`; клик к источнику + «via @bot» |

### Закреплённые
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Pinned-бар | `PinnedBar.tsx` — плашка, `PinnedBorder`-сегменты, счётчик `#N`, `onFollow` | `pinnedMessage.tsx` + мини-тумба медиа закрепа + карусельная анимация смены |

### Контекстное меню
Наш набор (`useMessageActions.tsx:484-571`): Reply, Reply in Another Chat, Edit, Copy, Translate, Pin/Unpin, Save GIF, Download, Retract/Stop Poll, React with Stars, Forward, Select, Viewers/Read-date, Statistics, Add/Edit/Delete Fact Check, Report, Delete; error-меню Resend/Copy/Delete.

| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Copy Message Link | нет | `contextMenu.ts:1129 MessageContext.CopyMessageLink1` |
| A | Явный пункт Quote | цитата неявно из выделения при open (`useMessageActions.tsx:113-121`) | `contextMenu.ts:940 Quote` |
| A | View Replies / тред | нет | `contextMenu.ts:967,983 ViewReplies/ViewAllReplies` |
| A | Copy/Search Selected text | нет | `contextMenu.ts:1039,1044` |
| A | Copy username/hashtag/option link | нет | `contextMenu.ts:1081,1089,1412` |
| A | Send Now / Reschedule | нет (отложенных в ленте нет) | `contextMenu.ts:910,924` |
| A | Saved-tags: Filter/Rename/Remove tag | `SavedTagsPanel` есть, пунктов меню нет | `contextMenu.ts:744,750,776` |
| C | React with Stars отдельным пунктом | пункт в меню | в tweb ставится из полоски реакций |

### Множественное выделение
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Набор действий + анимация | `SelectionBar.tsx` — счётчик/Forward/Delete/Clear; чекбокс `MessageRow.tsx:225-229` | `selection.ts` (41КБ) + `contextMenu.ts:1190-1239` — Download/Copy/Send Now/Reschedule/Clear + слайд пузырей `translateX(2.5rem)` (`_chat.scss:1181-1204`) |

### invert_media / via bot / post_author
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Поля модели | `ConvMsg` не имеет `invertMedia`/`viaBot`/`postAuthor`/`signature` (grep пуст) → подпись всегда под медиа, нет «via @bot», нет подписи автора поста | `bubbles.ts:7791` invert_media; via-bot header; post_author |

### Прочее
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Спойлеры | `RichText.tsx:84-90 Spoiler` — click-to-reveal blur; без частиц/растворения | эффект точечного шума + плавное растворение |
| B | «edited» | всегда `edited HH:MM` при `m.edited` (`MessageContent.tsx:504`) | уважает `edit_hide` (у постов канала скрывается) |
| A | go-mention / go-reaction FAB | только `ScrollDownFab.tsx` | `input.ts:821-870 constructMentionButton` — переход к непрочитанным @/реакциям + «Read all» |
| A | Sponsored сообщения | grep пуст | `topbarSponsored`, `is-sponsored` пузырь (`_chatBubble.scss:120`) |
| A | Просмотры: post_author | `ViewsMeta`/`ForwardsMeta` есть (`MessageContent.tsx:60-78`); подписи автора нет | `messageRender` с post_author |
| C | GeoBubble live-текст | захардкожен рус. «Трансляция окончена»/«Остановить»/«обновлено N мин назад» (`richBubbles.tsx:248-263`) в обход `useT` | локализован |
| C | EffectReplayButton | эмодзи-глифы `🎆🎉❤️👍💩🎂` (`MessageContent.tsx:82-105`) — суррогат эффектов | серверные стикер-анимации |

> Виртуализация: у нас рендерится всё окно реальными нодами (`ChatFeed`+`useChatScroll.ts`); `core/dom/scrollSaver.ts` — крошечный (764Б) против полноценного tweb-`ScrollSaver`; восстановление позиции через `pendingRestore`+ResizeObserver (`useChatScroll.ts:222-241`). Работает, проще. jump-to-message/unread — OK.

---

## 3. Сайдбар / список / поиск

Наши: `components/{Sidebar,ChatListItem,ArchiveRow,SearchView,ContactsView,MainMenu,FolderTabs}.tsx`, `components/folders/{ChatFoldersSettings,FolderEditor,FoldersSidebar}.tsx`, `core/{dialogToChat,folderFilter}.ts`, `core/hooks/useSidebarFolders.tsx`.
tweb: `lib/appDialogsManager.ts`, `components/wrappers/messageForReply.ts`, `components/dialogsContextMenu.ts`, `components/foldersTabs.tsx`, `components/sidebarLeft/{index.ts,tabs/chatFolders.tsx,tabs/editFolder.tsx,foldersSidebarContent/index.tsx}`, `components/appSearchSuper.ts`, `helpers/dom/createFolderContextMenu.ts`.

### Строка диалога
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Типы медиа в превью | `core/dialogToChat.ts:43-68 mediaLabel()` — ~18 типов | `messageForReply.ts:150-344` + dice/venue/geoLive/invoice/paidMedia/story-mention/todo/album (`grouped_id`→"Album")/self-destruct |
| A | Эмодзи стикера перед «Стикер» | `dialogToChat.ts:52` — просто «Стикер» | `messageForReply.ts:215-233` — `stickerEmojiRaw + ' ' + AttachSticker` |
| A | Бейдж непрочитанных poll-votes | нет | `appDialogsManager.ts:2389-2393 unread_poll_votes_count` |
| A | Иконка `storyreply` | только `forward_filled` (`ChatListItem.tsx:213-220`) | `appDialogsManager.ts:2092-2094 messageReplyStoryHeader` |
| A | Бейджи scam/fake | модель `Chat` (`data.ts:141-143`) — только verified/premium/emojiStatus; `ChatListItem.tsx:166-170` | имя через `PeerTitle` (`appDialogsManager.ts:306`) с scam/fake |
| A | Иконка sending (часы) | `Chat.sent/read` → только check/checks (`ChatListItem.tsx:175-177`) | `appDialogsManager.ts:2352 setSendingStatus` — часы/✓/✓✓ |
| B | Префикс «Вы:» | `dialogToChat.ts:94-95` — рус. литерал в обход i18n, sender-имя только для `type==='group'` | `appDialogsManager.ts:2154-2176 i18n('FromYou')`, sender для любого `peerId!==fromId` |
| B | Mention-бейдж | `ChatListItem.tsx:229` — «@» всегда при unreadMentions>0 + отдельный unread-бейдж | `appDialogsManager.ts:2377,2427-2429` — при unread==1 сам бейдж → «@» |
| B | Галочка в «Избранном» | `dialogToChat.ts:132` — ✓ рисуется | `appDialogsManager.ts:2301` — не рисуется (peerId===myId) |
| B | Цвет «Черновик:» | `ChatListItem.tsx:208` — `style color:#ff595a` | `appDialogsManager.ts:2150-2152` класс `.danger` (тема) |
| B | Превью-миниатюра | `dialogToChat.ts:134` — только photo | `appDialogsManager.ts:2102-2144` — photo/video/gif/round + play-иконка + спойлер + sensitive |
| B | Mute-иконка | статичная `muted` (`ChatListItem.tsx:174`) | `nosound` (`appDialogsManager.ts:2336`) с transition |

### Сортировка / пины / архив
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Архив | `ArchiveRow.tsx` строка + отдельный оверлей (`Sidebar.tsx:188-217`); без свайпа/меню | `archiveDialog.tsx` + `archiveDialogContextMenu.ts` — dialog index 0 + свайп + меню |
| B | Пины по папкам | единый `chat.pinned` (`dialogToChat.ts:124`) | у фильтра свой `pinnedPeerIds` (`dialogsContextMenu.ts:168-190`) |

### Папки
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Muted-цвет бейджа таба | `FolderTabs.tsx:28-42` + `Tabs.tsx:139` — всегда primary | `foldersTabs.tsx:40-46` — `muted?'gray':'primary'` |
| A | «Mark all as read» в меню таба | `useSidebarFolders.tsx:87-107` — нет | `createFolderContextMenu.ts:52-57` |
| A | Серверные рекомендации + drag-reorder | `ChatFoldersSettings.tsx:24-41` — SUGGESTED статичны, без сортировки | `chatFolders.tsx:157-191 getSuggestedDialogsFilters()`; `:296-315 new Sortable(...)` |
| A | Подзаголовок «All Contacts/Groups/…» + тип Bots | `core/folderFilter.ts:31-40` + `folders/labels.ts:30-39` — числовые счётчики, bots нет | `chatFolders.tsx:60-88` — «FilterAllContacts/Groups/Channels/Bots» |
| A | Emoji/иконка в названии + множественные инвайты | `FolderEditor.tsx:236-245` — `input maxLength=24`; `FolderShareSection` одна ссылка | `editFolder.tsx:305-316 EditFolderInput` (rich); `:565+` список `chatlistInvite` |
| A | Кнопка «Add chats» у пустой папки (verti-sidebar) | `FoldersSidebar.tsx` — только бургер/список/equalizer | `foldersSidebarContent/index.tsx:180-194 plus «AddChat»` |
| B | Тип фильтра bots | `folderFilter.ts:14` — только contacts/nonContacts/groups/broadcasts | + bots |
| B | Счётчик «Все» vs папки | `useSidebarFolders.tsx:48-54` — у «Все» только незамьюченные, у папок все (несогласованно) | единообразно `notifications.count`/`muted` |

### Поиск
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Таб Apps (мини-приложения) | `SearchView.tsx:33 TABS` — без Apps | `sidebarLeft/index.ts:1129-1163` mediaTabs `type:'apps'` |
| A | Таб Posts / hashtag-поиск | нет | `type:'posts'` + `globalPostsSearch.tsx` |
| A | Ряд top-peers | нет | `sidebarLeft/index.ts:1101 searchGroups.people` (scrollableX) |
| A | «Недавние» из recentSearch | `SearchView.tsx:38-46` — localStorage peerId | `searchGroups.recent` из состояния клиента/сервера |
| B | Локальные совпадения | `SearchView.tsx:157-159` — по имени диалогов; без username/контактов-без-диалога | `searchGroups.contacts SearchAllChatsShort` |
| B | Highlight сниппета | `SearchView.tsx:60-71 Highlighted` — первое вхождение | `messageForReply.ts:384-397 messageEntityHighlight` — все вхождения с entity |

### Бургер-меню
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| C | Лишние пункты | `MainMenu.tsx:167-178` — Calls, Close Friends, Wallet, Telegram Premium | `sidebarLeft/index.ts:683-725` — этих пунктов НЕТ |
| A | Archived Chats | нет | `sidebarLeft/index.ts:646-657 btnArchive` |
| A | Create New сабменю (collapsed) | только `ComposeFab` (`Sidebar.tsx:245-251`) | `sidebarLeft/index.ts:673-681 newSubmenu` |
| A | Side-menu attach-боты | нет | `sidebarLeft/index.ts:734-760 show_in_side_menu` |
| B | Позиция аккаунтов | вверху меню (`MainMenu.tsx:141-165`) | «Add Account» первый + отдельный switcher |

> Сабменю «More» (`MainMenu.tsx:107-131`) ≈ `createMoreSubmenu` (`index.ts:892-956`). OK.

### Контекст-меню диалога
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Add to Folder | `ChatListItem.tsx:106-129` — нет | `dialogsContextMenu.ts:143-153 createSubmenuTrigger` |
| A | Mark as read (рабочий) | только «Mark as unread» **без onClick** (`ChatListItem.tsx:109`) | `dialogsContextMenu.ts:133-142` — MarkAsUnread/MarkAsRead с `onUnreadClick` |
| A | Форум/Saved: View as messages/topics, Close/Restart topic, Hide | нет | `dialogsContextMenu.ts:113-132,217-237` |
| A | Charge/Remove fee (платные) | нет | `dialogsContextMenu.ts:238-247` |
| B | «Open in new tab»/«Preview» | `ChatListItem.tsx:107-108` — заглушки без onClick | `dialogsContextMenu.ts:99-112 openDialogInNewTab`/`showChatPreviewPopup` |
| B | Delete-лейбл | `ChatListItem.tsx:104-105` — фикс по типу | `dialogsContextMenu.ts:70-77 getDeleteButtonText` + `checkIfCanDelete()` |

> `ContactsView.tsx:31-39` — контакты из существующих диалогов (только private), без контактов-без-диалога и сортировки по онлайну; tweb `contacts.tsx` грузит полный список.

---

## 4. Медиа-вьюер / редактор / сторис / плеер

### 4.1 Медиа-вьюер
Наш: `components/messages/MediaLightbox.tsx` (484 стр.), `core/hooks/useLightbox.ts`, `messages/VideoControls.tsx`.
tweb: `components/mediaViewer/base.ts` (3006 стр.) + `index.ts` (`AppMediaViewer`), `static.ts`, `avatar.ts`.

| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Caption под медиа | `LightboxItem` без поля caption (`MediaLightbox.tsx:34-48`, `useLightbox.ts:46-58`) | `index.ts:304 setCaption()` — rich-text со спойлерами/скроллом/timestamps (`index.ts:112-142,304-355`) |
| A | Forward из вьюера | тулбар: pip/rotate/zoomin/download/close (`MediaLightbox.tsx:390-398`) | `index.ts:146-151,256 onForwardClick` (даже `static.ts:38-40`) |
| A | Delete из вьюера | нет | `index.ts:156-159,222 onDeleteClick` (+ deleteAsChatPhoto) |
| A | Download-progress + качество | `<a download>` по готовому blob (`MediaLightbox.tsx:358-371`) | `appDownloadManager.downloadToDisc` + прогресс-кольцо + меню качеств (`base.ts:237,448-456`) |
| A | Zoom-slider/zoomout/pinch | пошаговый zoomin, +/-, колесо, дабл-клик до 2.5 (`MediaLightbox.tsx:270,355,418`) | `RangeSelector` + btnOut/In (`base.ts:367-396`), pinch `SwipeHandler`, zoom-в-точку (`base.ts:625-708`), инерция/bounce |
| A | Swipe-to-close | только кнопка/Esc/back/клик-фон | `base.ts:526-558,590-660 onSwipe` (порог .2/125px) с резинкой |
| A | Серверный paging медиа | `items` = загруженное окно (`useLightbox.ts:46-58`) | `SearchListLoader` (`base.ts:2382 shouldLoadMore`, `:2998 load`) |
| A | Клик по автору → к сообщению | статичный текст (`MediaLightbox.tsx:382-389`) | `media-viewer-author` кликабелен |
| A | Тап по медиа → toggle хрома (mobile) | нет | `base.ts:1078-1081` |
| B | Навигация по краям | `nav()` кольцует `(i+dir+len)%len` (`MediaLightbox.tsx:271-275`) | не кольцует, стрелки скрываются (`base.ts:2387-2388,440-441`) |
| B | Видео-контролы | `VideoControls.tsx` — play/seek+буфер/громкость/время/скорость/fullscreen/авто-скрытие; нет спиннера буфера/качества/дорожек/встроенного PiP | ckin-плеер `lib/mediaPlayer` — всё это + взаимное скрытие caption/preview (`base.ts:2656-2714`) |
| C | Поворот по `r`/`к` | `MediaLightbox.tsx:345` | в tweb rotate только кнопкой |

### 4.2 Медиа-редактор (самый близкий к оригиналу)
Наш: `components/mediaEditor/MediaEditor.tsx` (1661 стр.) + `editorMath/sceneRender/enhanceGL/stickerLayer/videoExport/videoMath/editorHistory`.
tweb: `components/mediaEditor/` (tabs/canvas/webgl/finalRender).

Совпадает почти 1:1: **adjustments** (11 ключей/uniforms `editorMath.ts:51-62` == `adjustments.ts:9-65`), **crop/rotate/flip** (`MediaEditor.tsx:1105-1171,1300-1303`), **кисти** pen/arrow/marker/neon/blur/eraser (`:77-89,1269-1274`), **текст** (`:1590-1632`), **экспорт видео** WebCodecs/mediabunny (`:864-919`, `videoExport.ts`).

| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Undo/redo покрытие | только штрихи + add/remove текста/стикера (`MediaEditor.tsx:120,697-705,742-750,1045-1051`); enhance/crop/transform — не в истории | `HistoryItem` покрывает все операции |
| B | Экспорт фото | всегда JPEG 0.92 на белом (`MediaEditor.tsx:851-857`) — теряется альфа | `finalRender/renderToImage.ts` сохраняет формат/альфу |
| B | Пикер стикеров | recent+faved+наборы, без поиска (`StickerPicker.tsx:26-28`) | `stickersTab.tsx:36 search` + `SuperStickerRenderer` + кастом-эмодзи |
| B | Enhance CSS-fallback | при отсутствии WebGL → CSS-фильтр (`MediaEditor.tsx:351-362,403-416`) | строго WebGL |
| C | `blurRadiusFor`=сторона/150 | `MediaEditor.tsx:89` — блюр масштабируется от размера | фикс 10px на канвасе |

### 4.3 Аудио-плеер
Наш: `core/audio/mediaPlaybackController.ts` (202 стр.), `stores/audioStore`, `components/NowPlayingBar.tsx`.
tweb: `components/appMediaPlaybackController.ts`, `.pinned-audio`.

| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | mediaSession / lockscreen | нет обращений к `navigator.mediaSession` | `appMediaPlaybackController.ts:180-194,1003-1004` (метаданные + prev/next хендлеры) |
| A | Догрузка очереди из чата | фикс `queue[]`, `next()` упирается в конец (`mediaPlaybackController.ts:168-182`) | `MediaListLoader` (`appMediaPlaybackController.ts:129-130,772-798,977-985`) |
| A | Loop/repeat | нет | `public loop`+`round` с персистом (`:143-150,227-228`) |
| A | Per-type скорость | одна общая `rate` (`:147-155`) | `playbackRates: Record<PlaybackMediaType,number>` (`:152,256-257`) |
| A | Voice-boost громкости | единый volume 0..1 (`:161-167`) | отдельный `boost` для voice/round через WebAudio gain до 200% (`:132-141,235-249,322-326`) |
| B | prev/next для внешнего элемента | видео-кружок — просто перемотка в начало (`:168-172`) | перескок между кружками/голосовыми в истории |

> PiP (`core/pip.ts`) ≈ tweb `clientPip.tsx` (`moveAppToWindow`); отличие — tweb ре-рендерит wallpaper-canvas после переноса (`clientPip.tsx:94-96`), у нас нет. Не мискоответствие.

### 4.4 Сторис
Наш: `components/StoryViewer.tsx` (464 стр.) + `core/hooks/useStoryViewer.ts` (259 стр.), `StoryMediaAreas.tsx`, `StoriesRow.tsx`, `AddStorySheet.tsx`, и др.
tweb: `components/stories/viewer.tsx` (3509 стр.), `list.tsx`.

| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Индикатор приватности во вьювере | на создании есть (`AddStorySheet.tsx:25-31,63`), во вьювере нет | `viewer.tsx:2257-2312 privacyIconMap/getStoryPrivacyType` |
| A | Mute/громкость видео-стори | видео жёстко `muted` (`StoryViewer.tsx:136`) | `viewer.tsx:1792-1811,1210 muteButton` + `stories.muted` |
| A | Media-area channelPost/weather | только geo/venue/reaction/url (`StoryMediaAreas.tsx:47-100`) | `viewer.tsx:614-767 mediaAreaChannelPost`/`mediaAreaWeather` + venue |
| A | Buffering видео | нет | `viewer.tsx:229,1182 stories.buffering` |
| A | Timestamp стори в шапке | только имя (`StoryViewer.tsx:169-191`) | `viewer.tsx:46,982,1257-1264,1958-2004 formatDateAccordingToTodayNew` |
| B | Пауза по зажатию | Space toggle / оверлей / статистика (`useStoryViewer.ts:104,113`); тап-зоны только листают | `viewer.tsx:193,661-662,709-710` — pointerdown-hold |
| B | Переход между авторами | `next()` на последней просто закрывает (`useStoryViewer.ts:91-98`) | перелистывание на соседнюю группу/peer |
| B | Viewers-лист | плоский аватар+имя (`StoryViewer.tsx:365-404`, `useStoryViewer.ts:162-166`) | `viewer.tsx:2341-2347 getStoryViewsList` — поиск/сортировка/дата/реакция |
| B | Реакции | фикс 7 эмодзи + ❤ (`StoryViewer.tsx:31,301-361`) | `viewer.tsx:67,536-595 ChatReactionsMenu` + кастом + around |
| B | Caption разворот | статична (`StoryViewer.tsx:281-286`) | `viewer.tsx:1928-1938 ViewerStoryCaption` сворачивается |
| B | Ответ на стори | обычный DM (`useStoryViewer.ts:189-197`) | `viewer.tsx:480-481 input.setReplyTo({replyToStoryId})` |
| B | StoriesRow контекст-меню | кольцо+сворачивание (`StoriesRow.tsx:14,82`); архив отдельным sheet | `list.tsx:336-423` — mute/unmute, hide, archive из строки |

> Совпадает: прогресс-бары+авто-переход (`StoryViewer.tsx:150-166`), stealth, репост (`:193-208,452-459`), закреп/удаление/редактирование, share, статистика, close-friends на создании.

---

## 5. Настройки / профиль / приватность

Наши: `components/settings/*`, `UserInfoPanel.tsx`, `userInfo/SharedMedia.tsx`, `SettingsView.tsx`, `EditProfile.tsx`.
tweb: `components/sidebarLeft/tabs/*`, `components/sidebarRight/tabs/*`, `peerProfile.tsx`, `sharedMedia.tsx`.

### 5.1 Инфо-панель профиля (`UserInfoPanel.tsx` vs `peerProfile.tsx`)
Заголовок/аватар/статус/действия/notifications-toggle — близко к tweb (свёрнутый аватар→разворот, пейджер фото, залив шапки, per-chat mute). Расхождения в строках:

| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Location группы/канала | нет | `PeerProfile.Location` (icon location + ChatLocation) |
| A | Личный t.me Link для юзера | Link только для групп (invite) | `peerProfile.tsx:1019 PeerProfile.Link` |
| A | Business Hours/Location | нет | `peerProfile.tsx:1082-1170 BusinessHours/BusinessLocation` |
| A | Personal Channel карточка | нет | `peerProfile.tsx:477+ PersonalChannel` |
| A | Bot: AddToChat/PrivacyPolicy/OpenApp+ToS | нет | `peerProfile.tsx:1050-1073,1480+ BotAddToChat/BotPrivacyPolicy/BotMainApp` |
| A | Bot emoji-status/location toggles | нет | `peerProfile.tsx:1308-1347` |
| A | ContactNote | нет | `peerProfile.tsx:852 ContactNote` |
| A | Доп. usernames | один username | `peerProfile.tsx:86-95,725 UsernameAlso` |
| A | Story-превью-кружки в шапке | закреп-истории отдельным блоком, кружков нет | `peerProfile.tsx:1455+ profile-story-previews` |
| B | Копирование Phone/Username/Bio | статичные `Row` без клика (`UserInfoPanel.tsx:483-514`) | клик = copy + toast + контекст-меню Copy |
| B | AnonymousNumber подпись | всегда `Phone` | `peerProfile.tsx:687` различает AnonymousNumber/Phone |

> Encryption Key (секретный чат) — есть у обоих. OK.

### 5.2 Shared media (`userInfo/SharedMedia.tsx` vs `sharedMedia.tsx`)
Наш `SHARED_TABS` (`SharedMedia.tsx:35`): Media, Files, Links, Music, Voice + Members/Chats/Gifts.
tweb `mediaTabs` (`sharedMedia.tsx:605-648`): savedDialogs, stories, members, media, gifts, saved, files, links, music, voice, groups, similar.

| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Stories tab | нет | `type:'stories'` |
| A | Saved tab (в чате) | нет | `inputMessagesFilterEmpty`/`SavedMessagesCount` |
| A | Groups in common | нет | `ChatList.Filter.Groups`/`CommonGroups` |
| A | Similar channels | нет | `SimilarChannels` |
| A | Кнопка-меню таба (Gifts view-as / Stories menu) | нет | `sharedMedia.tsx:411-426 profileStarGiftsButtonMenu/profileStoriesButtonMenu` |

> Media/Files/Links/Music/Voice/Members/Gifts — есть, липкий таб-ряд/слайд/счётчики близко. GIF нет у обоих (в tweb — `sidebarRight/tabs/gifs.tsx`). OK.

### 5.3 Приватность (`PrivacySecuritySettings.tsx`+`PrivacyRule.tsx` vs `privacyAndSecurity.tsx`+`privacy/*`)
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Active Web Sessions | нет (только Active Sessions устройств) | `websitesRow` → `AppActiveWebSessionsTab` (`activeWebSessions.tsx`) |
| A | Login-email row | нет | `privacyAndSecurity.tsx:235-246,354 emailRow` + `wrapEmailPattern` |
| A | Clear Payment & Shipping Info | нет | `privacyAndSecurity.tsx:114-138 PrivacyClearPayment` |
| A | Gifts privacy правило | нет | `privacy/gifts.tsx` (`inputPrivacyKeyStarGiftsAutoSave`) |
| A | Saved Music privacy | нет | `privacy/savedMusic.tsx` |
| A | Calls P2P подсекция | `Calls` = одна секция | `privacy/calls.tsx` — `inputPrivacyKeyPhoneCall` + `inputPrivacyKeyPhoneP2P` |
| A | Last Seen премиум-секция | нет | `premiumSection` в `lastSeen.tsx` |
| A | Profile Photo public fallback | нет | `privacy/profilePhoto.tsx:120-143 SetPublicPhoto/RemovePublicPhoto` |
| B | Voices/Messages premium-gated | оба — обычные everybody/contacts/nobody | tweb: Voices `premiumOnly`, Messages = платные (`new_noncontact_peers_require_premium`) |
| C | «Delete My Account» | секция + confirm + `managers.auth.deleteAccount()` (`PrivacySecuritySettings.tsx:190-211`) | UI удаления аккаунта в tweb нет (grep пуст) |
| C | «Read Time» отдельным правилом | псевдо-3-вариант (`PrivacyRule.tsx:79-84`) | булев под-раздел Last Seen (`privacy/lastSeen.tsx:42-46 hide_read_marks`) |

> Радио + Always/Never allow + added_by_phone под Nobody — сделано верно (`PrivacyRule.tsx:116-119,157`). OK.

### 5.4 2FA (`TwoStepVerification.tsx` vs `2fa/*`)
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Email confirmation кодом | email сохраняется без кода | `2fa/emailConfirmation.tsx` |
| A | Forgot password / recovery | в `unlock` только «Invalid password» | `2fa/forgotPasswordLink.ts` + recovery в enterPassword |
| B | Анимированный стикер 🔐 | статичная `TgIcon lock` (`TwoStepVerification.tsx:60-63`) | `wrapStickerEmoji('🔐',168)` (`2fa/index.tsx:16-22`) |

> Смена пароля/hint/disable-confirm/passwordSet — близко. OK.

### 5.5 Активные сессии (`ActiveSessions.tsx` vs `activeSessions.tsx`)
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Confirm-попапы | terminate сразу без диалога (`ActiveSessions.tsx:34-50`) | `TerminateSessionText`/`AreYouSureSessions` (`activeSessions.tsx:84,127`) |
| B | Детали устройства | схлопнуто «Telegram Web» + name + location/ip·when (`ActiveSessions.tsx:15-19,52-77`) | `device_model, system_version` + `ip - country` + дата (`:33-40`) |
| A | Клик по сессии (детали) | нет | есть |

### 5.6 Уведомления (`NotificationsSettings.tsx` vs `notifications.tsx`)
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Stories notifications | нет | `notifications.tsx:108 StoriesNotifySection` |
| A | Reactions notifications | нет | `notifications.tsx:233 ReactionsNotifySection` |
| A | Other → «Contact joined» | нет | `notifications.tsx:345-369 OtherSection` |
| A | «All accounts» | нет | `notifications.tsx:450 MultiAccount.AllAccounts` |

> Sound+volume+тест, Sound Effects «Message Sent», per-type enabled/preview — близко. OK.

### 5.7 Тема / обои (`GeneralSettings.tsx`+`ChatWallpaper.tsx` vs `generalSettings.tsx`+`background.tsx`/`backgroundColor.tsx`)
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Accent-color picker | 4 хардкод-темы без выбора акцента | `generalSettings.tsx:195-233 AccentPickerRow` + `applyAccentPreset` |
| A | Distance Units (км/мили) | нет | `generalSettings.tsx:274 DistanceUnitsSection` |
| A | Gradient/color builder + паттерн + интенсивность | «Set a Color» = `input type=color` (`ChatWallpaper.tsx:54-59`), один цвет | `backgroundColor.tsx AppBackgroundColorTab` |
| A | Цвета имён (name-color) | нет | есть |
| B | Тема-пикер живые превью | 4 статичных градиент-карточки `THEME_CARDS` + эмодзи 🏠🐤⛄💎 | `SharedThemePicker` — настоящий `<ChatBackground>` (`generalSettings.tsx:157-177`) |
| B | Реальные server-обои | хардкод `WALLPAPER_PRESETS` (CSS-градиенты + один `pattern.svg`) (`ChatWallpaper.tsx:82-102`) | набор `WallPaper` + `<ChatBackground>` canvas (blur/pattern/intensity) |
| B | Time format живое время | статичные «10:00 PM»/«22:00» | обновляется каждую минуту (`generalSettings.tsx:325 eachMinute`) |
| B | Lite Mode / Power Saving | хардкод value «Disabled» (`GeneralSettings.tsx:82`) | Row + статус Enabled/Disabled |

### 5.8 Язык (`LanguageSettings.tsx` vs `language.tsx`)
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| B | Список языков | хардкод 32 строки, реально 6 кодов (`LanguageSettings.tsx:15-48`) | серверный `LanguageListSection` (`language.tsx:101+`) с radio + native_name |
| A | «Show Translate Chat Button» | только `Show Translate Button` (для сообщения) | `language.tsx:74 ShowTranslateChatButton` |
| A | «Do Not Translate» пикер | нет | `language.tsx:76-89 DoNotTranslate` |
| A | Поиск по языкам | нет (фикс-список) | серверный + фильтр |

### 5.9 Данные и память (наиболее полный домен)
`DataStorageSettings.tsx` ≈ tweb `dataAndStorage/*`+`autoDownload/*`+`storageQuota.tsx`: Auto-Download (общий + Photos/Videos/Files × 4 типа + слайдер value⁴ + Reset), Storage quota (подсчёт по типам, Clear, TTL/лимит слайдеры). Существенных расхождений нет. OK.

### 5.10 Общие / прочее
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A/C | Send by Enter / Ctrl+Enter | `HotkeysSettings.tsx:102` — статичная read-only таблица; `Composer.tsx:499` жёстко Enter | `keyboardShortcuts.tsx:95-125 SendShortcutRow` (InlineSelect) + `NewLineRow`, `appSettings.sendShortcut` |
| B/A | Stickers & Emoji | `StickersSettings.tsx` — только Loop + наборы | `stickersAndEmoji.tsx` — SuggestStickers, LoopAnimated, QuickReaction, EmojiPrediction, BigEmoji, DynamicPackOrder |
| B | Edit Profile в корне | иконка-карандаш в шапке (`SettingsView.tsx:100`) | первой строкой (`settings.tsx:126`) |
| A | Stars/TON баланс строки | нет в главном меню (есть `stars/StarsPopup`) | `settings.tsx:271-284 MenuTelegramStars/Ton` |
| B | Devices счётчик сессий | без счётчика | `settings.tsx:246-251 authCount` в titleRight |
| A | EditProfile: Personal Channel picker | нет | `editProfile.tsx:94-160 openPersonalChannelPicker` |
| A | EditProfile: multi-username | один username | `editProfile.tsx:15,25 UsernamesSection` + Fragment purchase |
| C | EditProfile: «кто видит телефон» | вшито `EditProfile.tsx:270-282` | в tweb только в `privacy/phoneNumber.tsx` |

---

## 6. Звонки

Наши: `components/{CallScreen,GroupCallScreen,LivestreamScreen,CallsView,StreamSettingsPopup}.tsx`, `call/{CallOverlay,CallProvider}.tsx`, `settings/SpeakersCamera.tsx`, `core/calls/{callEngine,groupCallEngine,livestreamEngine}.ts`, `managers/{callsManager,livestreamManager}.ts`, `core/pip.ts`.
tweb: `components/call/`, `components/groupCall/`, `components/conferenceCall/`, `components/rtmp/`, `appCallsManager`, `appGroupCallsManager`, `topbarCall.tsx`, `chat/topbarLive/topbarLive.tsx`.

### 1:1 звонок
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Топбар-плашка + сворачивание/movable | `CallScreen.tsx` — фикс-фуллскрин портал, без свернуть/перетащить (`CallOverlay.tsx` только show/hide) | `topbarCall.tsx` плашка над чатом + `call/index.ts:229-256 MovablePanel` + fullscreen |
| A | In-call настройки/выбор устройств/динамик | 4 кнопки: mute/camera/screenshare/end (`CallScreen.tsx`); динамик только через `SpeakersCamera.tsx`, применяется пассивно `setSinkId` (`:57-60`) | `call/index.ts:180 btnSettings` → `settingsPopup.tsx` (динамики/микрофон+уровень/шумодав/камера) |
| A | Fullscreen | нет | `call/index.ts:186-193,465-487` |
| A | Weak-signal индикатор | 2 градиента (`CallScreen.tsx:82-84`); grace-таймер есть, UI нет | `call/index.ts:35-40` палитра `weak` |
| A | Свап big/small видео | remote на весь экран + local фикс-угол (`CallScreen.tsx:148-158`), без свапа | `call/index.ts:489-519,637-660 resizeVideoContainers` |
| A | Блюр-подложка за видео | нет | `call/index.ts:513-516 callVideoCanvasBlur` |
| B | Фон-градиент | CSS linear-gradient + анимация (`CallScreen.tsx`) | iOS-swirl `ChatBackgroundGradientRenderer` 3 canvas кроссфейд (`call/index.ts:146-385`) |
| B/C | Emoji-верификация (SAS) | чип в углу + клик-пояснение (`CallScreen.tsx:115-144`); свой ECDH поверх WS (`callEngine.ts:68-95,336-338,545`) | центр хедера, 4 эмодзи (`call/index.ts:134,628-632`), без пояснения; MTProto |
| B | «Микрофон собеседника выкл» | текст «Microphone is off» (`CallScreen.tsx:160-164`) | `call/index.ts:200-214,571-578 partyMutedState` + имя + анимир. mic |
| B | Статусы | incoming/outgoing/connecting/active/ended (`CallScreen.tsx:74-79`); нет Requesting/Exchanging keys | `call/description.ts` — Ringing/Calling/Requesting/ExchangingKeys/Connecting/Ended/Failed |
| B | Формат длительности | `m:ss` (`CallScreen.tsx:19`) — баг после 60 мин («75:00») | `toHHMMSS(...,true)` (`call/description.ts:43`) |
| B | Гейт screen-share | кнопка всегда видна (`CallScreen.tsx:221-229`) | `IS_SCREEN_SHARING_SUPPORTED` → hide (`call/index.ts:411-414`) |
| B | Зеркалирование video | всегда (`CallScreen.tsx:153`, `SpeakersCamera.tsx:89`) | `shouldMirrorVideoTrack` только фронталка (`cameraSection.tsx:105-108`) |
| C | Журнал звонков CallsView | `CallsView.tsx` (группировка по дням, направление, пропущенные, перезвон) из своего `/calls` | в референс-файлах call-компонентов tweb такого нет |

### Групповой звонок
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Контекст-меню участника | строки с mic-иконкой без меню (`GroupCallScreen.tsx:107-122`) | `groupCall/participants.ts:28-166` — Mute/Unmute (админ), MuteForMe, OpenProfile, RemovePeer |
| A | Raise hand | нет в `stores/groupCallStore.ts:8-12` | `GROUP_CALL_PARTICIPANT_MUTED_STATE.HAND`, `changeRaiseHand` (`groupCall/index.tsx:35-107,392-401`) |
| A | Speaking-индикатор по звуку | только listening/muted из `media_state.muted` (`GroupCallScreen.tsx:113-120`) | `groupCall/participantStatus.ts:30-43 is-speaking` |
| A | Приглашение | нет | `btnInvite` + `ShareInviteLink` (`groupCall/index.tsx:164`, `settingsPopup.tsx:167-189`) |
| A | «Mute new participants» | нет | `settingsPopup.tsx:148-160 toggleGroupCallSettings({joinMuted})` |
| A | Настройки группового звонка | нет кнопки настроек (`GroupCallScreen.tsx:125-135`) | `groupCall/index.tsx:403-406 showCallSettingsPopup({mode:'groupCall'})` |
| A | Movable/resizable + fullscreen + правая колонка | фикс-плавающее окно (`GroupCallScreen.tsx:75-81`) | `MovablePanel` + fullscreen + toggle right-column (`groupCall/index.tsx:149-243,437-492`) |
| A | Подтверждение выхода / «для всех» | мгновенно (`GroupCallScreen.tsx:132`, `groupCallEngine.ts:112-120`) | `PopupPeer` end-video-chat + чекбокс (`groupCall/index.tsx:408-431`) |
| A | Conference e2e-fingerprint бейдж | нет | `conferenceCall/fingerprintBadge.tsx` (`groupCall/index.tsx:284-313`) |
| B | Гранулярность mute-статусов | бинарно muted/listening | UNMUTED/MUTED/MUTED_FOR_ME/MUTED_BY_ADMIN/HAND (`groupCall/index.tsx:45-90`) |
| B | Раскладка видео/пиннинг | flex-грид `VideoTile` ≤4 без пиннинга (`GroupCallScreen.tsx:91-95,33-47`) | `participantVideos` + big-layout ≥680 (`groupCall/index.tsx:204-214,456-488`) |
| B | Анимир. mic-кнопка + hand | статичный `TgIcon`-тумблер (`GroupCallScreen.tsx:129-131`) | `GroupCallMicrophoneIcon` lottie + `data-micState` (`groupCall/index.tsx:341,517-519`) |
| B/C | Self-строка «Я» | хардкод «Я» отдельной строкой (`GroupCallScreen.tsx:99-106`) | часть общего sorted-list |

### Livestream / RTMP
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A/C | Реальный просмотр потока | плейсхолдер «The stream is live» (`LivestreamScreen.tsx:43-48`); `livestreamEngine.ts:1-8` признаёт «нет ingest» | `AppMediaViewerRtmp` + `rtmpCallsController` (buffering/playing) |
| A | Запись трансляции | нет | `rtmp/recordPopup.tsx` |
| A | Выбор устройства вывода | нет | `rtmp/outputDevicePopup.tsx` |
| B | Счётчик зрителей | считает участников группового звонка (`LivestreamScreen.tsx:20,38`), простой replace | `participants_count` через `numberThousandSplitterForWatching` (`rtmp/description.ts:24-31`) |
| B | Топбар-плашка трансляции | только in-chat баннер «Join» (`ConversationView.tsx:1184-1193`) | `chat/topbarLive/topbarLive.tsx` — LIVE + title + watching + action |
| B | RTMP-креды | `StreamSettingsPopup.tsx` близкий порт (URL/ключ маска/глаз/копия/revoke/START-END); revoke всегда строкой | `rtmp/adminPopup.tsx:38-49` — revoke в ⋮-меню когда не active |

### Сквозное
| Кат | Что | У нас | В tweb |
|-----|-----|-------|--------|
| A | Единая топбар-плашка активного звонка | НЕТ ни для одного типа; только in-chat «Join»-баннеры (`ConversationView.tsx:1173-1193`, `stores/{groupCallStore,livestreamStore}`) | `topbarCall.tsx` — одна плашка P2P/group/rtmp (mic/end, аватары, title, live), клик → попап, `body.is-calling` |
| A | Шумоподавление в настройках | `SpeakersCamera.tsx` тумблера нет | `settingsPopup.tsx:264-275 NoiseSuppression` |

> Уровень микрофона в настройках — паритет (`SpeakersCamera.tsx:47-87` ≈ `microphoneLevelMeter.tsx`), но у tweb метр ещё и в in-call popup. Application PiP (`core/pip.ts`) со звонками не связан.

**Итог по звонкам:** движки (WebRTC/ECDH/сигналинг) местами богаче ожидаемого, но **UI-слой заметно урезан** — нет активной топбар-плашки/сворачивания, in-call настроек и выбора устройств, weak-signal, свапа видео; в групповом — raise hand, speaking, admin-mute/меню, приглашения; livestream — плейсхолдер без реального проигрывания/записи.

---

## 7. Сквозная отсебятина (сводка C)

1. **Эффекты сообщений** — свои canvas-конфетти вместо серверных docId-эффектов Telegram: в композере (`helpers.ts:19`, `core/effects/emojiEffects.ts`), в пузыре (`MessageContent.tsx:82-105 EffectReplayButton`), фикс эмодзи-набор.
2. **Русский хардкод в обход i18n:** GeoBubble live-текст (`richBubbles.tsx:248-263`), префикс «Вы:» (`dialogToChat.ts:94-95`), цвет «Черновик» (`ChatListItem.tsx:208`).
3. **Лишние пункты бургер-меню:** Calls / Close Friends / Wallet / Telegram Premium (`MainMenu.tsx:167-178`) — в tweb их там нет.
4. **«Delete My Account»** (`PrivacySecuritySettings.tsx:190-211`) — UI удаления аккаунта в tweb отсутствует.
5. **«Read Time» отдельным 3-вариантным правилом** (`PrivacyRule.tsx:79-84`) — в tweb булев под-раздел Last Seen.
6. **Секция видимости телефона в EditProfile** (`EditProfile.tsx:270-282`) — в tweb только в `privacy/phoneNumber.tsx`.
7. **Ctrl+K → `window.prompt`** (`Composer.tsx:510-518`); **авто-send видео-кружка на 60с** (`useVoiceRecorder.ts:92`); **поворот по `r`/`к` во вьювере** (`MediaLightbox.tsx:345`); **закольцованная навигация вьювера** (`MediaLightbox.tsx:271-275`).
8. **Хранение «недавних» поиска в localStorage** (`SearchView.tsx:38-46`); **статичные пресеты рекомендованных папок** (`ChatFoldersSettings.tsx:24-41`).
9. **Hover-затемнение сервис-сообщения** (`ChatFeed.module.scss:73-75`); **`blurRadiusFor`=сторона/150** в редакторе (`MediaEditor.tsx:89`).

---

## 8. Приоритеты

**Дёшево + заметно (быстрые победы):**
- Caption под медиа во вьювере + кнопки Forward/Delete (§4.1 A).
- Copy Message Link в контекст-меню (§2 A).
- Настройка send-shortcut Enter/Ctrl+Enter (§1 B, §5.10) — раскоммутировать `Composer.tsx:499`.
- Ширина альбома 320→420 (§2 B).
- Вычистить i18n-хардкоды и лишние пункты бургера (§7).
- Формат длительности звонка `m:ss`→HHMMSS (§6 B, баг).
- Кликабельные Phone/Username/Bio с copy (§5.1 B).

**Крупные функциональные дыры (отдельные спеки):**
- Топбар-плашка активного звонка + сворачивание (§6 A) — сквозной, крупнейший в звонках.
- In-call настройки/выбор устройств + групповой raise-hand/speaking/admin-mute (§6 A).
- Livestream реальный ingest/проигрывание (§6 A) — сейчас плейсхолдер.
- Web-page link-preview в композере (§1 A) + авто-детект entity на отправке.
- go-mention/go-reaction FAB (§2 A); grouped-документы (§2 A); highlight цитаты при переходе (§2 A).
- Медиа-вьюер: серверный paging + zoom-slider/pinch + swipe-to-close (§4.1 A).
- Настройки: реальные server-обои с паттернами + accent-picker + цвета имён (§5.7 A).

**Средние (по мере надобности):**
- Автокомплит бот-команд `/` (§1 A); mentions с сервера (§1 B).
- Сервисные пузыри типизированные (§2 B); аватары реагировавших на чипе (§2 A).
- Сторис: пауза по зажатию + переход между авторами + индикатор приватности (§4.4 A/B).
- Аудио: mediaSession + loop + per-type rate + догрузка очереди (§4.3 A).
- Профиль: Location/Business/Personal Channel/ContactNote/доп.usernames (§5.1 A); shared-media вкладки Stories/Saved/Common groups (§5.2 A).
- Приватность: Web Sessions + Gifts/Saved-Music + Calls-P2P (§5.3 A); 2FA email-confirmation/recovery (§5.4 A).
- Папки: серверные рекомендации + drag-reorder + тип bots (§3 A/B); поиск Apps/Posts/top-peers (§3 A).

---

*Аудит основан на чтении кода на 2026-08-07; редактор медиа и «Данные и память» — самые близкие к оригиналу домены; медиа-вьюер, аудио-плеер и UI-слой звонков отстают сильнее всего.*
