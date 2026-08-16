# tweb: типы баблов сообщений и их разметка (структурный референс)

Снято 2026-08-16 с исходников tweb `/Users/denisurevic/Documents/tweb`.
Ядро — `src/components/chat/bubbles.ts` (11 812 строк), `bubbleGroups.ts` (881), `messageRender.ts` (594).

> Важно: локальный tweb — форк. В нём есть не-оригинальные вещи (admin-logs как баблы,
> guest-chat, read-metrics, suggested posts, TON-дайсы) — они помечены «форк» и для порта
> вторичны. Основная механика баблов совпадает с оригинальным Telegram Web K.

Смежные доки (здесь НЕ дублируются):

- живые DOM-дампы и computed-стили — [`dom/live-dom.md`](dom/live-dom.md);
- канальные баблы (сторона, views, beside-forward) — [`channels.md`](channels.md) §2;
- комментарии/`replies-element` (футер поста) — [`comments.md`](comments.md) §3.

Структура дока:

1. Жизненный цикл: пайплайн рендера, `safeRenderMessage` → `renderMessage`, батчинг.
2. Полная карта классов бабла (что и от чего зависит).
3. DOM-дерево бабла: контент-обёртки, time, хвост, аватар, beside-buttons.
4. Все типы контента и их разметка.
5. Группировка (`bubbleGroups.ts`) и date-группы.
6. Wrappers (сигнатуры и роль).
7. SCSS-карта.
8. «У нас»: главные структурные расхождения web-client.

---

# 1. Жизненный цикл бабла

## 1.0 Каркас ленты — `constructBubbles()` (bubbles.ts:1439–1458)

```
div.bubbles.scrolled-down                     → this.container
  ├ div.bubbles-remover-container
  │   └ div.bubbles-remover.bubbles-inner     → this.remover (анимация удаления баблов)
  ├ scrollable.container                      → Scrollable (внутри его контента живёт chatInner)
  │   └ div.bubbles-inner                     → this.chatInner (все date-группы)
  └ div.bubbles-floating-separators-container → плавающие сепараторы (форк)
```

Плюс `paddingTop`/`paddingBottom` (bubbles.ts:519–520) — распорки для «прижатия» истории вниз.

## 1.1 Пайплайн рендера (главная последовательность)

```
getHistory / renderNewMessage(message)                       bubbles.ts:4528
  └ performHistoryResult({history}, reverse)                 bubbles.ts:10037
      └ для каждого сообщения:
          message.pFlags.local → processLocalMessageRender   bubbles.ts:10745 (бот-описание и т.п.)
          иначе → safeRenderMessage({message, reverse})      bubbles.ts:6271
              ├ создаёт div (newBubble) + dataset            bubbles.ts:6317–6321
              ├ renderMessage({message, bubble, middleware}) bubbles.ts:6568  ← вся разметка
              └ renderMessagesQueue(promise)                 bubbles.ts:5961 → batchProcessor.addToQueue
  ...батч копится, потом:
processBatch(loadQueue)                                      bubbles.ts:5808
  ├ groupBubbles(items)                                      bubbles.ts:5974
  │   ├ bubbleGroups.prepareForGrouping(bubble, message)     bubbleGroups.ts:739
  │   ├ bubbleGroups.groupUngrouped()                        bubbleGroups.ts:750
  │   └ group.createAvatar(...) если isAvatarNeeded          bubbles.ts:6008–6014
  ├ await Promise.all(details.promises + setUnreadDelimiter) bubbles.ts:5890
  ├ prepareToSaveScroll(...) → scrollSaver.save()            bubbles.ts:10004
  ├ ejectBubbles() (замещённые баблы физически удаляются)    bubbles.ts:5965
  ├ bubbleGroups.mountUnmountGroups(groups)                  bubbleGroups.ts:426  ← вставка в DOM
  └ restoreScroll()
```

Ключевое отличие от «наивного» рендера: **бабл собирается вне DOM**, все медиа-промисы
(`loadPromises`) дожидаются в батче, и только потом группы монтируются в date-контейнеры
одним проходом с сохранением скролла. Аватар, `is-group-first/last`, позиция в группе —
всё это происходит на этапе mount, а не в `renderMessage`.

`renderNewMessage` (bubbles.ts:4537–4628): скипает, если низ не догружен (`loadedAll.bottom`),
не тот тред, не проходит saved-reaction-фильтр или бабл уже есть; после рендера, если были
внизу — `scrollToEnd()`/`scrollToBubbleEnd()`.

## 1.2 `safeRenderMessage` (bubbles.ts:6271–6380)

- Guard: `renderingMessages` (Set по fullMid) + существующий бабл без явного `bubble` → выход (6287).
- Каждому баблу — свой `middlewareHelper` (аналог AbortController), кладётся прямо на элемент:
  `newBubble.middlewareHelper = middlewareHelper` (6318).
- Dataset: `data-mid`, `data-peer-id`, `data-timestamp` (6319–6321).
- **Перерендер существующего бабла** (edit/статус): передаётся старый `bubble` → старый
  уничтожается (`middlewareHelper.destroy()`), попадает в `bubblesToEject`, новый — в
  `bubblesToReplace` (Map new→old), группе сообщают `changeBubbleByBubble` (6331–6338).
  Физическая подмена в DOM — в `processBatch` (5910–5930), где scrollSaver ещё и
  `replaceSaved(oldBubble, bubble)`.
- `this.bubbles[fullMid] = newBubble` — реестр всех баблов (6341).
- Если `renderMessage` вернул `undefined` (сообщение не рендерится) — fullMid попадает в
  `skippedMids` (6368).
- Форк: не-Message (`AdminLog`) уходит в `renderLog` (6347, реализация 6477–6566).

## 1.3 `renderMessage` — общий скелет (bubbles.ts:6568–9779)

Порядок работы (нумерация = фактический порядок кода):

1. **Альбом**: если `grouped_id` и это не Pinned-чат — рендерится только «главное» сообщение
   группы (`getMainGroupedMessage`), остальные скипаются (6600–6606). `maxBubbleMid` =
   максимальный mid группы, кладётся на элемент (6608–6609).
2. Создаются три узла: `messageDiv = div.message.spoilers-container`,
   `contentWrapper = div.bubble-content-wrapper`, `bubbleContainer = div.bubble-content`;
   `bubble.append(contentWrapper)`, `contentWrapper.append(bubbleContainer)` (6618–6629).
3. Создаётся `context: BubbleContext` (bubble, bubbleContainer, middleware, loadPromises,
   canHaveTail, isStandaloneMedia, attachmentDiv, messageMedia, messageMessage…) и кладётся
   в `this.contexts` (6631–6644).
4. **Сервисная ветка** (см. §4.18): `messageService` (кроме `SERVICE_AS_REGULAR`) или
   «regular-as-service» (story mention, самоуничтожившееся медиа) → `bubble.className =
   'bubble service'`, внутрь `div.service-msg`, ранний `return` (6708–7303).
5. Текст: подсчёт big-emoji, `wrapRichText`/`TranslatableMessage` → `setInnerHTML(messageDiv, richText)` (7320–7567).
6. `timeSpan = MessageRender.setTime(...)`; `appendBubbleTime(bubble, messageDiv, cb)` —
   время вставляется в конец `messageDiv` + `clearfix` (7616–7643).
7. `bubbleContainer.prepend(messageDiv)` (7645).
8. Beside-кнопки, reply-markup, статусы isOutgoing (7671–7764).
9. **Медиа-switch** по `message.media._` (7873–9259) — см. §4. Создаёт `attachmentDiv =
   div.attachment` и вставляет его до (`messageDiv.before`) или после (`invert_media`) текста
   (9244–9254). Ширина attachment ограничивает `bubbleContainer.style.maxWidth` (9250–9253).
10. `is-message-empty` / floating time / `just-media` (9261–9281).
11. Имя/форвард/via/reply-заголовок (9337–9649) — см. §4.19–4.20.
12. `is-out`/`is-in` (9669), replies-footer (9682–9701), реакции (9703–9705).
13. Хвост: `can-have-tail` + `bubbleContainer.append(generateTail())` (9707–9712).
14. Статус отправки `setBubbleSendingStatus` (9714–9724), `no-forwards`, message-effects,
    спойлер-оверлей текста (9770–9776).

Возвращает `{bubble, promises: loadPromises, message, reverse}`.

---

# 2. Полная карта классов бабла

Все классы вешаются на корневой `div.bubble`. `[Ф]` — форк-специфика.

## 2.1 Базовые/направление

| Класс | Условие | Где |
|---|---|---|
| `bubble` | всегда | bubbles.ts:6627 |
| `is-out` / `is-in` | `chat.isOutMessage(message)` — сторона рендера (не `pFlags.out`!) | bubbles.ts:9669 |
| `service` | сервисное сообщение (вся ветка `bubble.className = 'bubble service'`) | bubbles.ts:6723 |
| `is-date` | дата-пилюля (`bubble service is-date`) | bubbles.ts:4801 |
| `is-fake` | дублёр даты внутри date-группы (не sticky) | bubbles.ts:4833 |
| `is-sticky` | sticky-дата в текущий момент (ставит StickyIntersector) | bubbles.ts:2865+ |

## 2.2 Группа/хвост

| Класс | Условие | Где |
|---|---|---|
| `is-group-first` | верхний бабл группы (или единственный) | bubbleGroups.ts:221,225 |
| `is-group-last` | нижний бабл группы (или единственный) | bubbleGroups.ts:221,238 |
| `is-group-last` (форс) | сервисный `pFlags.is_single`; thread-starter | bubbles.ts:7273, 9657 |
| `can-have-tail` | `context.canHaveTail && !isRound`; сбрасывают: sticker (6099), big-emoji (7533), invoice без текста (9038), story/geo без текста (9129, 9096); поднимает replies-footer (9694) | bubbles.ts:9707 |
| `with-media-tail` | фото/видео с «врезанным» в медиа хвостом; **мёртвая ветка**: `USE_MEDIA_TAILS = false` | bubbles.ts:262, 7909, 8547 |
| `has-plain-media-tail` | медиа без текста (или invert) и без replies → хвост цветом медиа | bubbles.ts:9256–9258 |
| `is-forced-rounded` | fake-service (дайс с исходом, admin-log обёртка) — полные радиусы | bubbles.ts:7280, 9178 |

CSS-механика: хвост виден только на `is-group-last.can-have-tail` (см. §7).

## 2.3 Имя/шапка

| Класс | Условие | Где |
|---|---|---|
| `hide-name` | имя не нужно: медиа со скрытым именем (`canHideNameIfMedia`, 7785–7789), либо вообще нет needName/fwd/reply | bubbles.ts:7886, 8527, 8855, 9516, 9648 |
| `must-have-name` | via-бот / story-форвард / forwarded с аватаркой | bubbles.ts:9644–9646 |
| `forwarded` | форвард (кроме saved messages от себя и forward-from-channel) | bubbles.ts:9410–9414 |
| `hidden-profile` | форвард от скрытого юзера (`fwd_from.from_name` без from_id) | bubbles.ts:9365 |
| `is-reply` | есть reply-заголовок (ставит `MessageRender.setReply`); также сервисные poll/todo-append экшены | messageRender.ts:590; bubbles.ts:7162 |
| `channel-post` | `message.views` есть | bubbles.ts:7673 |
| `invert-media` | `pFlags.invert_media` — attachment после текста | bubbles.ts:7794 |

`canHideNameIfMedia` (bubbles.ts:7785–7789): `!viaBotId && (fromId === myId || !pFlags.out)
&& (!post_author || !fwd_from) && !isForwardOfForward`.

## 2.4 Тип контента (подробно в §4)

| Класс | Тип |
|---|---|
| `photo` | фото; также webpage/game/invoice/geo/story c картинкой (bubbles.ts:7889, 8185, 8236, 8445, 8987, 9048, 9115) |
| `video` | видео/gif, в т.ч. внутри webpage/game/invoice (8100, 8408, 8530, 8973) |
| `round` | круглое видео (8097, 8530) |
| `is-album is-grouped` | альбом ≥2 медиа (7892, 8532); invoice-альбом — `is-album photo` (8941) |
| `sticker` (+`sticker-animated`) | стикер (bubbles.ts:6098, 6104) |
| `emoji-big` + `can-have-big-emoji` | целиком эмодзи-сообщение (7531, 7537) |
| `has-webpage single-media` | webpage-превью (8069) |
| `has-webpage game` | игра (8391) |
| `story` | story-медиа (8236, 9115); `is-expired-story` (9107) |
| `<type>-message` + `min-content` | документ-ветка: `voice-message`/`audio-message`/`document-message`… (8634–8639) |
| `is-single-document` / `is-multiple-documents is-grouped` | один док / альбом доков (8641–8643; groupedDocuments.ts:154) |
| `call-message` | звонок (8700) |
| `contact-message` | контакт (8751) |
| `poll-message` | опрос (8811) |
| `is-invoice` | инвойс/paid media (9040) |
| `is-giveaway` | розыгрыш (9155) |
| `gift` | webpage со star gift (8277) |
| `is-square-photo` / `is-vertical-photo` | форма превью webpage (8190, 8202) |
| `is-message-empty` | нет текста → время «плавает» (9264) |
| `has-floating-time` | время поверх медиа (9274); timeSpan получает `is-floating` (9273) |
| `just-media` | standalone-медиа (стикер/big-emoji/round): нет фона бабла (9280) |

## 2.5 Состояние/прочее

| Класс | Условие | Где |
|---|---|---|
| `is-sending` / `is-error` / `is-sent` / `is-read` | статус исходящего; иконки в `.time` меняются | bubbles.ts:6382–6408 |
| `is-outgoing` | `pFlags.is_outgoing` (ещё не подтверждено сервером) | bubbles.ts:7760 |
| `is-first-unread` | первый непрочитанный (разделитель «Unread messages» — чистый CSS `::before`) | bubbles.ts:11609 |
| `with-replies` / `with-beside-replies` | есть комментарии; beside — для sticker/emoji-big/round | bubbles.ts:7775, 9696 |
| `with-beside-button` | есть круглая кнопка рядом с баблом (forward/goto/sponsored/summarize) | bubbles.ts:7680, 7729, 9305, 9666 |
| `with-reply-markup` | inline-клавиатура под баблом | bubbles.ts:7742 (и сервисные 6884, 6902) |
| `no-forwards` | пересылка запрещена (реактивно через Solid-effect) | bubbles.ts:9731 |
| `is-sponsored` | реклама | bubbles.ts:7642 |
| `is-thread-starter` | стартовое сообщение треда | bubbles.ts:9657 |
| `has-fake-service` | над баблом «прилеплен» сервисный текст (дайс-исход, admin-log) | bubbles.ts:7280, 9178 |
| `has-service-before` [Ф] | клон `bubble-content` с premium-gift до основного контента | bubbles.ts:6734, 6968 |
| `is-highlighted` | подсветка при переходе к сообщению | bubbles.ts:4765+ |
| `is-selected` | режим выделения (ChatSelection) | selection.ts |
| `is-guest-chat`, `is-similar-channels`, `has-service-description`, `has-chat-thread-separator` [Ф] | форк-фичи | bubbles.ts:9673, 7029, 6898; bubbleGroups.ts:442 |

Инлайновые переменные на бабле: `--emoji-size` (big-emoji, 7381), `--peer-color-rgb` +
`--peer-border-background` через `setPeerColorToElement` (9313–9321; peerColors.ts:20,60) —
ставится для входящих и форвардов, от него цвет имени/reply/квота.

---

# 3. DOM-дерево бабла

## 3.1 Обычное текстовое сообщение (входящее, в группе)

```
section.bubbles-date-group                        ← одна на календарный день
  ├ div.bubble.service.is-date                    ← sticky дата
  ├ div.bubble.service.is-date.is-fake
  ├ (sticky sentinels, STICKY_OFFSET = 3)         bubbles.ts:306
  └ div.bubbles-group                             ← серия одного автора
      ├ div.bubbles-group-avatar-container        ← только если isAvatarNeeded (группы)
      │   └ avatar.bubbles-group-avatar.user-avatar (size 40, position:sticky)
      └ div.bubble.is-in.is-group-first.is-group-last.can-have-tail  data-mid data-peer-id data-timestamp
          └ div.bubble-content-wrapper
              └ div.bubble-content
                  ├ div.name.floating-part[.colored-name] data-peer-id   ← имя (группы)
                  ├ div.reply.quote-like.quote-like-hoverable.quote-like-border  ← reply-заголовок
                  ├ div.message.spoilers-container
                  │   ├ (rich-text ноды: text, a, em, .spoiler-text, custom-emoji…)
                  │   ├ span.time → …куски… → div.time-inner (клон кусков)
                  │   └ span.clearfix
                  └ svg.bubble-tail (viewBox 0 0 11 20) > use[href="#message-tail-filled"]
```

- Хвост: `generateTail()` — utils.ts:43–63. SVG 11×20 с `<use href="#message-tail-filled">`;
  спрайт-символ определён в чат-фоне/шаблоне страницы. Всегда добавляется, если
  `context.canHaveTail || isRound`; видимость — CSS по `is-group-last`.
- `.name` получает `floating-part`; для standalone-медиа имя+reply заворачиваются в отдельный
  `div.name-with-reply.floating-part`, который кладётся ПЕРЕД `.message` (bubbles.ts:9577–9594)
  и плавает над медиа.
- `next-is-message` вешается на name/reply, если следующий сиблинг — `.message` (9571–9575).

## 3.2 time / time-inner (messageRender.ts:209–393)

`MessageRender.setTime()` возвращает `span.time`, куда по порядку кладутся «части», и
**дубликат всех частей** внутрь `div.time-inner` (title = полная дата). Двойной рендер нужен,
чтобы `.time` занимал место в потоке текста, а `.time-inner` абсолютно позиционировался.

Части (все с классом `time-part` где применимо):

| Элемент | Условие |
|---|---|
| `span.time-dice` + Icon `ton` [Ф] | дайс с исходом |
| `span.post-views` + Icon `channelviews.time-icon.time-icon-views` | `message.views` |
| `span.time-post-author` (+ `.time-post-author-comma`) | подпись автора поста |
| `i.time-edited` («edited») | `edit_date && !edit_hide` (unshift — в начало) |
| Icon `pinnedchat_filled.time-pinned` | закреплено |
| `span.time-effect` data-effect-id | message effect (иконка-стикер 12×12) |
| `span.inline-stars.bubble-meta-inline-stars` | платные сообщения |
| `span.time-repeat` | расписание повтора (scheduled) |
| текст времени `HH:MM` (или «edited at …» при `message_primary_edited_date`) | всегда, последним |

Динамические части, добавляемые позже в **оба** узла (`.time, .time-inner`):

- `Icon.time-sending-status` (sending/sendingerror/check/checks) — `setBubbleSendingStatus`
  (bubbles.ts:6382–6408), prepend;
- `span.time-replies` (число ответов + Icon `reply_filled.time-replies-icon.time-icon`) —
  `setBubbleRepliesCount` (bubbles.ts:6410–6431), prepend, только вне треда.

`appendBubbleTime(bubble, element, callback)` (bubbles.ts:468–471): регистрирует «аппендер» в
`bubble.timeAppenders` (unshift) и вызывает callback. Время физически ОДНО, но точка вставки
меняется: конец `.message` → конец подписи документа → `.reply`-address гео → низ
`bubble-content` при floating → внутрь reactions-element (9855). RTL: `time.is-block`, если
строка кончается RTL-текстом (7634–7636).

## 3.3 Beside-кнопки (`div.bubble-beside-button` внутри `bubble-content`)

| Вариант | Классы | Условие | Где |
|---|---|---|---|
| Быстрый форвард | `.with-hover.forward` + Icon `forward_filled` | пост канала (`message.views`), не Pinned | bubbles.ts:7676–7681 |
| Перейти к оригиналу | `.with-hover.goto-original` + Icon `arrow_next` | Pinned-чат / saved_from | bubbles.ts:9661–9666 |
| Комментарии beside | `replies-element.bubble-beside-button` | sticker/emoji-big/round с комментариями | replies.ts:133 |
| Спонсорские close/menu | `.bubble-beside-button-top` (+`.bubble-sponsored-buttons`) | sponsored | bubbles.ts:9283–9308 |
| Суммаризация [Ф] | `.summarize` в `div.summarize-container` | `summary_from_language` | bubbles.ts:7694–7730 |

Отдельно `div.bubble-hover-reaction > .bubble-hover-reaction-sticker` — quick-reaction по
ховеру, добавляется лениво в `onBubblesMouseMove` (bubbles.ts:2708+).

---

# 4. Типы контента

Медиа-switch — bubbles.ts:7878–9242. Общие правила:

- почти каждый тип создаёт `context.attachmentDiv = div.attachment` (7874–7875); типы,
  живущие в тексте (webpage, контакт, звонок, опрос…), выставляют `noAttachmentDivNeeded = true`
  и `mediaRequiresMessageDiv = true` (не давать `is-message-empty`);
- attachment вставляется `messageDiv.before()` (или `after()` при `invert-media`), и получает
  `no-brb`/`no-brt` (обнуление радиусов на стыке с текстом), а `.message` — `mt-shorter`/`mb-shorter` (9247–9268);
- спойлер-медиа: `wrapMediaSpoiler` поверх attachment (DotRenderer-канвас) — bubbles.ts:6034–6067.

## 4.1 Текст (+entities)

- `wrapRichText(message, {entities: totalEntities, passEntities, maxMediaTimestamp,
  textColor: 'primary-text-color'…})` → fragment в `.message` (7495–7541).
- У альбома текст берётся из единственного сообщения группы с текстом
  (`getGroupedText(groupedMessages)`, 7324), бабл получает `data-text-mid` (7390).
- Стикер и опрос обнуляют текст (7339, 7346); документы (кроме video/gif) не сетят HTML в
  `.message` напрямую — текст уходит в подпись документа (7341, `wrapGroupedDocuments`).
- Спойлер-оверлей текста: `createMessageSpoilerOverlay` поверх `.message`, если есть
  `.spoiler-text` (9781–9800, не Firefox).

## 4.2 Big-emoji / анимированные эмодзи (7357–7538)

- Сообщение состоит только из эмодзи (`emojiStrLength === strLength`) → `bigEmojis = min(7, n)`;
  размеры `BIG_EMOJI_SIZES = {1:96, 2:90, 3:84, 4:72, 5:60, 6:48, 7:36}` px (bubbles.ts:319–327),
  ставится `--emoji-size`.
- Если это ОДИН обычный эмодзи и на него есть анимированный стикер
  (`getAnimatedEmojiSticker`) — медиа подменяется на этот стикер-документ (7512–7520) →
  дальше обычный путь стикера.
- Иначе rich-text кладётся не в `.message`, а в `div.attachment.spoilers-container` (7522–7527).
- Классы: `emoji-big`, `can-have-big-emoji`; `isMessageEmpty = true`, `canHaveTail = false`,
  `isStandaloneMedia = true`.

## 4.3 Фото / видео / gif (7880–7933, 8507–8587)

- `bubble.classList.add('photo')` / `'video'`; `hide-name` при `canHideNameIfMedia`.
- `wrapPhoto({photo, message, container: attachmentDiv, withTail: false, isOut, lazyLoadQueue,
  middleware, loadPromises, autoDownloadSize})` (7910–7920);
- `wrapVideo({doc, container, message, boxWidth/boxHeight: mediaSizes.active.regular, group:
  animationGroup, observer, onLoad: onVideoLoad, setShowControlsOn: bubble, …})` (8549–8577).
- Спойлер: `pFlags.spoiler || sensitive` → `wrapMediaSpoiler` поверх (7922–7930, 8579–8586).
- `canHavePlainMediaTail = isMessageEmpty || invertMedia` → класс `has-plain-media-tail` (7867, 9256).

## 4.4 Альбомы (grouped media)

- ≥2 медиа: `is-album is-grouped` + `wrapAlbum({messages: groupedMessages, attachmentDiv,
  isOut: our, chat, loadPromises, autoDownload, spoilered})` (7891–7906, 8531–8544).
- Раскладку считает `prepareAlbum` (см. §6); каждый элемент — `.album-item` с `data-mid`.
- Реакции/время всегда относятся к «главному» сообщению группы (`getMainGroupedMessage`).
- Альбом документов/аудио — другой путь: `wrapGroupedDocuments` (см. §4.7).

## 4.5 Стикер (`ChatBubbles.wrapSticker`, bubbles.ts:6069–6165)

- Классы: `sticker`, при анимированном — `sticker-animated`; `canHaveTail = false`,
  `isStandaloneMedia = true` → `just-media` (нет фона/паддингов бабла).
- Размер: `mediaSizes.active.staticSticker | animatedSticker | emojiSticker` (для emoji-big);
  `setAttachmentSize` задаёт width/height контейнера, они же — min-width/min-height
  `bubble-content` (6110–6119).
- Дальше глобальный `wrapSticker({doc, div: attachmentDiv, play, loop, emoji, withThumb,
  liteModeKey: 'stickers_chat', scrollable, …})`.
- Премиум-эффекты/эмодзи-эффекты: observer `stickerEffectObserverCallback` на баблe (6158–6161).

## 4.6 Круглое видео (round)

- `doc.type === 'round'` → `isRound = true`, `isStandaloneMedia = true`, класс `round`
  (8515–8530). Хвост: `can-have-tail` НЕ ставится, но `generateTail()` добавляется (9707–9712) —
  у round свой хвост через CSS.
- `wrapVideo(...searchContext: inputMessagesFilterRoundVoice)`; после — `wrapRoundVideoBubble
  ({bubble, message, globalMediaDeferred, searchContext})` (bubbleParts/roundVideoBubble.ts,
  вызов 9741–9748) — прогресс-кольцо, время/unread-точка.

## 4.7 Voice / audio / документ (`wrapGroupedDocuments`, 8588–8646)

- Всё, что не sticker/video/gif/round → `wrapGroupedDocuments({message, bubble, messageDiv,
  richTextFragment: richText, …})` — строит внутри `.message` контейнеры:
  `div.document-container[.is-first][.is-last][.grouped-item] > div.document-wrapper >
  (.document|.audio) + div.document-message (подпись)` (groupedDocuments.ts:85–102,138).
- Бабл: `bubble-content` получает prepend `div.bubble-content-background` (8616–8618);
  классы `voice-message`/`audio-message`/`document-message`/`pdf → document-message` +
  `min-content` (кроме document), `is-single-document` либо `is-multiple-documents is-grouped`
  (8634–8643; groupedDocuments.ts:154).
- Время переезжает в конец `.document-message` / `.document`/`.audio` (8624–8631).
- Voice/audio: `searchContext` с `inputMessagesFilterRoundVoice`/`Music`, транскрипция
  (`canTranscribeVoice: true`).

## 4.8 Webpage-превью (8069–8377)

- Классы: `has-webpage single-media` (+ `photo`/`video`/`round`/`gift`/`story` по медиа).
- Разметку строит Solid-компонент `WebPageBox` (props: name {site name, «what is this»-tip},
  title, text, media {content, position top|bottom, photoSize square|vertical, hasDocument},
  footer {Instant View / «OPEN …» по `webPageTypes`-карте}); box вставляется **в `.message`
  перед `timeSpan`** (8352–8358), при `invert-media` — prepend + `mt-bigger`.
- Корень бокса — `a.webpage.quote-like…` (кликабельный, `data-callback`/`href`, safe/masked-URL
  логика 7989–8067); фон — peer-color-паттерн (`wrapPeerColorPattern`, canvas
  `webpage-background-canvas`, 8364–8371).
- Медиа-варианты: большая картинка (`wrapPhoto` в `mediaSizes.active.webpage`), квадрат 48×48
  (`is-square-photo`), вертикальная (`is-vertical-photo`), видео/gif (`wrapVideo`), документ
  (`wrapDocument` + `media.hasDocument`), story (`wrapStory`, класс `story`), star gift
  (`gift`, 240×240), грид стикерсета `webpage-stickerset-grid` из ячеек
  `webpage-stickerset-cell` (8307–8338).
- Instant View: footer «INSTANT VIEW» + клик → `openInstantViewInAppBrowser` (7990–8014).
- Fact-check использует тот же `WebPageBox` (7825–7864, `bubble-fact-check.quote-like`).
- Sponsored: `WebPageBox` с кнопкой-футером и观察ателем views (8020–8039).

## 4.9 Игра (`messageMediaGame`, 8380–8505)

`has-webpage game` — тот же `WebPageBox`: name «Game», title/description, медиа
(фото `mediaSizes.active.webpage` или видео/gif), footer «Play». Клик → `playGame` (8480–8492).

## 4.10 Контакт (8706–8755)

```
div.message > div.contact data-peer-id
  ├ avatar (size 54)
  └ div.contact-details > div.contact-name + div.contact-number
```
Классы: `contact-message`; `mediaRequiresMessageDiv = true`.

## 4.11 Звонок (`messageMediaCall` — синтезируется из `messageActionPhoneCall`, 7349–7354, 8651–8704)

```
div.message > div.bubble-call data-type=video|voice
  ├ Icon phone|videocamera .bubble-call-icon
  ├ div.bubble-call-title      («Outgoing/Incoming (Video) Call»)
  └ div.bubble-call-subtitle[.is-reason] > Icon arrow_next.bubble-call-arrow-(green|red) + длительность/причина + time
```
Класс `call-message`. Это единственный `SERVICE_AS_REGULAR`-экшен (bubbles.ts:275–279).

## 4.12 Опрос / чек-лист (8757–8838)

- Poll: Solid-компонент `PollMessageContent` в `div.poll-message-content`, prepend в
  `.message`; класс `poll-message`; текст сообщения обнуляется. Live-обновления — через
  `updateLocalOnEdit`-Map (8793–8808).
- ToDo (`messageMediaToDo`): `ChecklistBubble` в `div.checklist-content` (8817–8838).

## 4.13 Гео / venue / live (9045–9099)

Класс `photo`; `wrapGeo({attachmentDiv, messageMedia, peerId, date, onLiveExpire…})`
(wrappers/geo.tsx) — карта в attachment, для venue/live футер/адрес в `.message`, время в
address; live до истечения прячет `timeSpan` (`hide`).

## 4.14 Инвойс / paid media (8840–9043)

- Класс `is-invoice`; paid media дополнительно `single-media` (+`hide-name`).
- Медиа: одиночное фото/видео или альбом (`wrapAlbum` со `spoilered: !isAlreadyPaid`);
  непокупленное — превью из `messageExtendedMediaPreview` + DotRenderer + бейдж
  `span.extended-media-buy` (Icon `premium_lock`, «Unlock for ⭐N»), `attachment.is-buy` (8898);
- Цена/`PaymentInvoice`-лейбл — `.video-time`-бейджем в attachment (8990–8996);
  title инвойса — `div.bubble-primary-color` в `.message` (9022–9027).
- Непокупленные extended-media поллятся интервалом (`extendedMediaMessages`, 9001–9007).

## 4.15 Story (9101–9143)

`photo story`; размеры 9:16 (`setStoryContainerDimensions`, 9874+); `wrapStory` в attachment.
Просроченная story → reply-контейнер в `.message` + классы `is-expired-story`,
`expired-story-message is-empty` (9105–9112). Story mention — сервисный бабл (см. §4.18).

## 4.16 Giveaway (9146–9172)

`is-giveaway`; Solid `Giveaway` в контейнер перед `.message`, плюс кнопка
`makeViewButton({text: 'BoostingHowItWork'})`. У результатов розыгрыша reply скрывается (9151).

## 4.17 Дайс (9174–9223)

`wrapDice(context)` (wrappers/dice.ts) в attachment; standalone. Форк: исход дайса добавляет
над баблом `div.service-msg` + классы `has-fake-service is-forced-rounded`.

## 4.18 Сервисные сообщения (6708–7303)

Общий вид: `bubble.className = 'bubble service'`; внутри `bubble-content-wrapper >
bubble-content > div.service-msg` с текстом от `wrapMessageActionTextNew({message})`.
Реакции у сервисных возможны (`pFlags.reactions_are_possible`) — reactions-element
аппендится в `bubble-content-wrapper` (9849–9850).

Особые случаи:

| Кейс | Разметка |
|---|---|
| `IGNORE_ACTIONS` (bubbles.ts:266–272) | не рендерится вовсе: historyClear, chatCreate(out), migrate from/to, contactSignUp |
| Смена фото чата / suggested photo (`PHOTO_BUBBLE_ACTIONS`, 286–296) | `wrapServiceMediaBubble` — фото инлайн в service-msg (`bubble-service-media-avatar-container`), кнопка «Set photo»/просмотр (6909–6958) |
| Gift premium / gift code / gift stars / TON [Ф] | текст в `service-msg` + отдельный клон `bubble-content.has-service-before` с Solid `PremiumGiftBubble` (стикер+титул+кнопка) ПОСЛЕ основного (6966–7027) |
| Star gift | `div.bubble-star-gift-container` после `bubble-content`, Solid `StarGiftBubble` (7123–7160) |
| Story mention | `service-msg.bubble-story-mention-wrapper`: аватар 100 со story-кольцом + превью story + текст + `button.bubble-service-button.bubble-story-mention-button` (7189–7260) |
| Самоуничтожающееся медиа | `wrapMessageForReply` текст в service-msg (7262–7269) |
| Channel joined → similar channels [Ф] | `is-similar-channels`, разворачиваемый `div.bubble-similar-channels` (7028–7122) |
| `pFlags.is_single` | + `is-group-last` (7272–7274) |

**Дата-пилюля** (`createDateBubble`, 4780–4813): `div.bubble.service.is-date >
div.bubble-content > div.service-msg > (i18n-дата)`. Заметь: у даты НЕТ
`bubble-content-wrapper`. В каждой date-группе их две — sticky + `is-fake`.

**Unread divider**: отдельного DOM-узла нет — класс `is-first-unread` на первом
непрочитанном бабле (`setUnreadDelimiter`, 11568–11614), полоса «Unread messages» рисуется
CSS `::before` (текст из i18n через CSS-переменную).

## 4.19 Reply-заголовок (`MessageRender.setReply`, messageRender.ts:418–593)

Условие рендера: `reply_to_mid` есть и ≠ threadId/reply_to_top_id, либо story-reply, либо
`reply_from` (кросс-чат) — bubbles.ts:9372–9405. Вставка: `nameContainer.prepend(container)`.

Разметка (`wrapReply` → `ReplyContainer('reply')` → `DivAndCaption`, reply.ts:29–74,
divAndCaption.ts:11–29):

```
div.reply.quote-like.quote-like-hoverable.quote-like-border[.quote-like-icon.reply-multiline][.is-media][.mb-shorter][.floating-part]
  └ div.reply-content
      ├ div.reply-media[.is-round]        ← превью 32×32, prepend только если setMedia
      ├ div.reply-title > span.peer-title (или fragment с Icon channel/group/private для reply_from)
      └ div.reply-subtitle                ← текст оригинала / квота / «Story» / «Deleted message»
```

- Цвет: `setPeerColorToElement` + канвас-паттерн `reply-background-canvas` по peerId автора
  оригинала (reply.ts:48–66).
- Квота (`pFlags.quote`) → классы `quote-like-icon reply-multiline` (иконка кавычки через CSS).
- **Ответ НА стикер**: превью в `.reply-media` рендерит `wrapReplyMedia` — для
  `document.type === 'sticker'` вызывается `wrapSticker` 32×32 (replyContainer.ts:83–94);
  subtitle — `wrapMessageForReply` даёт «🖼 Sticker»-подобный текст. Round-видео — превью
  `is-round` (круглое, replyContainer.ts:113,256).
- **Стикер с ответом** (reply на бабле-стикере): `isStandaloneMedia` → reply получает
  `floating-part` и живёт в `name-with-reply.floating-part` над медиа
  (bubbles.ts:9577–9596), цвет — highlighting (полупрозрачная подложка,
  `useHighlightingColor: true`, messageRender.ts:571).
- Оригинал недоступен → «Loading» + `fetchMessageReplyTo`, бабл встаёт в очередь
  `needUpdate`; при приходе оригинала reply заменяется (`updateMessageReply`, bubbles.ts:2626).
- Poll-option reply: иконка `checkround_filled` + текст ответа (replyContainer.ts:195–204).

## 4.20 Имя / forwarded / via-бот (bubbles.ts:9323–9649)

- `needName` (9331–9335): `(fromId !== myId || !isOut) && chat.isLikeGroup`, либо viaBot,
  story-форвард и пр. Если ничего не нужно → `hide-name`.
- Обычное имя: `div.name.floating-part[.colored-name] data-peer-id > span.peer-title`
  (+ scam/fake иконка); `colored-name` — только для чужих (9498–9514).
- **Forwarded**: `div.name >` `span.bubble-name-forwarded` = i18n «Forwarded from %1»
  с вложенными: `br.hide-ol` + `avatar.bubble-name-forwarded-avatar` (20px) + `span.peer-title`;
  вариант с post_author — «ForwardedFromAuthor» (9421–9495). В Saved Messages/от канала —
  просто `colored-name` без «Forwarded from». Форвард-форварда — вторая строка
  `div.name-first-line` (9476–9495).
- **via-бот**: `span.is-via > i18n(ViaBot) + span.peer-title(@username)` аппендится в name
  (9520–9532).
- Ранг админа/подпись: `wrapTitleAndRank` добавляет справа от имени (9600–9633).
- topic-кнопка (форумы): `div.topic-name-button-container` в name либо floating над медиа
  (7647–7669, 9553–9565).

## 4.21 Реакции (`appendReactionsElementToBubble`, bubbles.ts:9822–9872)

- Элемент — custom element `reactions-element` (reactions.ts:87,449), классы
  `reactions reactions-block reactions-like-block` (block) / `reactions-inline`;
  тип Tag — для Saved Messages. Внутри — custom elements `reaction-element.reaction.
  reaction-block[.is-chosen][.is-paid]` с `div.reaction-sticker` и `span.reaction-counter`
  (reaction.ts:34–35, 739–1032). Размер стикера: block/tag 22, inline 14; аватары
  реагировавших до 3-х, счётчик — с 4-х (reaction.ts:43–51).
- Куда вставляется: floating-time или service → в `bubble-content-wrapper`; multiple
  documents → в `.document-message` последнего дока; иначе — в конец `.message` (9849–9870).
  При этом `timeSpan` переезжает ВНУТРЬ reactions-element (`appendBubbleTime`, 9855).
- `USER_REACTIONS_INLINE = false` (bubbles.ts:260) — inline-режим в личках выключен, всегда block.

## 4.22 Inline reply-markup (клавиатура под баблом)

`createInlineReplyMarkup({rows, chat, message})` (bubbleParts/inlineReplyMarkup.ts) →
контейнер `.reply-markup` с рядами `.reply-markup-row > button.reply-markup-button.rp >
span.reply-markup-button-text` — аппендится в `bubble-content-wrapper` (СИБЛИНГ
`bubble-content`), бабл получает `with-reply-markup` (7732–7745).

## 4.23 Replies-футер (комментарии)

`MessageRender.renderReplies` (messageRender.ts:395–416): custom element
`replies-element.replies.replies-footer[.is-unread]` в конце `bubble-content`
(аватары-стек 30px | Icon comments, `span.replies-footer-text` «N Comments», Icon next,
ripple). Для sticker/emoji-big/round — `replies-beside` + `bubble-beside-button`
(replies.ts:44,133). Футер возвращает `canHaveTail = true` (9693–9694). Детали и живой
DOM — в доке про комментарии.

---

# 5. Группировка: `bubbleGroups.ts`

## 5.1 Модель

- `GroupItem` (bubbleGroups.ts:27–39): `{bubble, fromId, mid, groupMid, timestamp,
  dateTimestamp (мс, начало суток), mounted, single, group, message, reverse}`.
- `BubbleGroup` (58–339): `container = div.bubbles-group`; `items` отсортированы по убыванию
  (`items[0]` — самый новый); `offset` 0|1 — сдвиг из-за аватара; свой middleware.
- `BubbleGroups` (356–881): `itemsArr` (все items чата, desc), `itemsMap` (bubble→item),
  `groups` (desc). Сорт-ключи: обычный чат `mid`/`lastMid`, Scheduled —
  `timestamp`/`lastTimestamp`, Search — без сортировки (366–372).

## 5.2 `canItemsBeGrouped(item1, item2)` — bubbleGroups.ts:573–598

Не группируются никогда: admin-log записи; сообщения verification-бота; `suggested_post`.
Дальше конъюнкция:

1. одинаковый `fromId`;
2. одинаковый guest-chat-visitor [Ф];
3. **один календарный день** (`dateTimestamp` равны);
4. **|Δ timestamp| ≤ `newGroupDiff` = 121 секунда** (bubbleGroups.ts:360);
5. оба не `single` — `single = true` у всех сервисных, кроме `SERVICE_AS_REGULAR`
   (только `messageActionPhoneCall`) (689–690);
6. одинаковый out/in (`chat.isOutMessage`);
7. одинаковый threadId для forum/botforum/monoforum;
8. anonymous-sending: out-сообщения группируются только если `fromId === myId`;
9. одинаковый `peerId` и одинаковый `post_author`.

## 5.3 Классы от группы

`BubbleGroup.updateClassNames()` (201–240): единственный бабл — оба `is-group-first` +
`is-group-last`; иначе верхний (самый старый, `items[length-1]`) — `is-group-first`,
нижний (`items[0]`) — `is-group-last`, у средних оба снимаются. На контейнерах групп:
`bubbles-group-first`/`bubbles-group-last` — крайние группы ленты
(`updateGroupsClassNames`, 651–656). Также на аватар: `avatar-for-reply-markup` /
`avatar-for-suggested-reply-markup` (168–175) — приподнять аватар над клавиатурой.

## 5.4 Аватар группы

- Решение — `ChatBubbles.isAvatarNeeded(message)` (bubbles.ts:11689–11707):
  `chat.isLikeGroup && !isOutMessage` (плюс verification-бот и guest-chat [Ф]).
- `group.createAvatar(message)` (bubbleGroups.ts:129–166): `div.bubbles-group-avatar-container >
  avatarNew(size 40)` с классами `bubbles-group-avatar user-avatar`; контейнер аппендится в
  `.bubbles-group`, а `offset = 1` сдвигает индексы баблов при `positionElementByIndex`
  (bubbleGroups.ts:138, 163, 291). Аватар `position: sticky` — «едет» вдоль группы (§7.2).
  peerId для форвардов в Replies-чате — `fwdFromId` (83–117).
- Создаётся один раз на ГРУППУ (по firstItem) в `groupBubbles` (bubbles.ts:6002–6016).

## 5.5 Date-группы и монтирование

- `getDateContainerByTimestamp` (bubbles.ts:4823–4874): `section.bubbles-date-group`,
  внутри sticky-дата + `is-fake`-дубль; контейнеры вставляются в `chatInner` по сортировке
  timestamp. `STICKY_OFFSET = 3` — число служебных детей до групп.
- `BubbleGroup.onItemMount` (bubbleGroups.ts:305–320): `positionElementByIndex(container,
  dateContainer.container, STICKY_OFFSET + idx…)`. Пустые date-группы удаляются
  (`deleteEmptyDateGroups`, bubbles.ts:11616+).
- Удаление бабла: `removeAndUnmountBubble` (379–424) — при этом соседние группы, ставшие
  совместимыми, «склеиваются» и перемонтируются.
- Перерендер (edit): `changeBubbleByBubble` подменяет DOM-узел item'а без перегруппировки
  (558–571); смена mid при отправке — `changeBubbleMessage` (539–556).

---

# 6. Wrappers (сигнатуры и роль)

Медиа-подсистема — отдельный док (`media.md`,
полный разбор wrappers там). Здесь — только то, что нужно знать со стороны бабла:

| Функция | Файл | Вызов из бабла | Роль / корневой DOM |
|---|---|---|---|
| `wrapPhoto({photo, message, container, boxWidth, boxHeight, withTail, isOut, lazyLoadQueue, middleware, loadPromises, autoDownloadSize, size?, noBlur?, withoutPreloader?})` | `wrappers/photo.ts` | bubbles.ts:7910, 8220, 8446, 8975; replyContainer.ts:116 | ставит размеры контейнера через `setAttachmentSize`, кладёт `img.media-photo` (+ thumb-канвас/blur) в переданный `container` (= `.attachment`) |
| `wrapVideo({doc, container, message, boxWidth, boxHeight, withTail, isOut, group, observer, onLoad, setShowControlsOn, searchContext?, noInfo?, videoSize?})` | `wrappers/video.ts` | bubbles.ts:8103, 8409, 8549, 8956 | `video.media-video`/gif + `.video-time`, прелоадер, автоплей по observer; для round — круглая обёртка |
| `wrapSticker({doc, div, middleware, lazyLoadQueue, group, play, loop, emoji?, withThumb, liteModeKey, scrollable, width?, height?})` | `wrappers/sticker.ts` | через `ChatBubbles.wrapSticker` (bubbles.ts:6069) и напрямую (реплаи 32×32, webpage-грид) | rlottie-канвас/статика внутри `div`; ветка animated-emoji — по `emoji`-параметру |
| `wrapAlbum({messages | media, attachmentDiv, isOut, chat, loadPromises, autoDownload, spoilered?, videoTimes?})` | `wrappers/album.ts` | bubbles.ts:7893, 8534, 8942 | раскладывает элементы `.album-item[data-mid]` в `.attachment`; внутри каждого — wrapPhoto/wrapVideo |
| `prepareAlbum({container, items: {w,h}[], maxWidth, minWidth, spacing, maxHeight?})` | `components/prepareAlbum.ts` (движок — `Layouter` из `components/groupedLayout.ts`) | из wrapAlbum (album.ts:53) | телеграмный album-layout: `Layouter.layout()` даёт геометрию, каждый элемент — `div.album-item.grouped-item` с процентными width/height/top/left (prepareAlbum.ts:35–40) |
| `wrapDocument({message, autoDownloadSize, sizeType, searchContext, fontSize, canTranscribeVoice})` | `wrappers/document.ts` | bubbles.ts:8121, 8427; из groupedDocuments | `.document.ext-*` (иконка/превью, имя, размер) либо `.audio` для voice/audio |
| `wrapGroupedDocuments({message, bubble, messageDiv, richTextFragment, ...})` | `wrappers/groupedDocuments.ts` | bubbles.ts:8589 | см. §4.7 — контейнеры `.document-container > .document-wrapper` внутри `.message` |
| `wrapRichText(text, {entities, passEntities, customEmojiSize, maxMediaTimestamp, textColor, ...})` | `lib/richTextProcessor/wrapRichText.ts` | bubbles.ts:7497 и всюду | DocumentFragment: `a`, `em/strong/del/code/pre`, `span.spoiler-text`, `custom-emoji-element`, timestamps-ссылки |
| `wrapMessageForReply({message, ...})` | `wrappers/messageForReply.ts` | messageRender (subtitle), self-destruct service | однострочный текст-представление сообщения («🖼 Photo», «Sticker …») |
| `wrapReply(options)` / `ReplyContainer` | `wrappers/reply.ts`, `chat/replyContainer.ts` | MessageRender.setReply | см. §4.19 |
| `wrapMessageActionTextNew({message, ...})` | `wrappers/messageActionTextNew.ts` | сервисная ветка (bubbles.ts:6960) | i18n-текст сервисного экшена с peer-title-ссылками |
| `wrapGeo(...)`, `wrapDice(context)`, `wrapMediaSpoiler(...)`, `wrapStory(...)` | `wrappers/geo.ts`, `chat/bubbleParts/dice.ts:10`, `wrappers/mediaSpoiler.ts`, story через `wrapStoryMedia` | §4.13, §4.17, §4.3, §4.15 | — |
| `wrapPeerColorPattern({peerId, container, canvasClassName})` | `wrappers/peerColorPattern.ts` | reply (reply.ts:57), webpage (bubbles.ts:8365) | канвас-паттерн эмодзи peer-цвета за квотой/боксом |

---

# 7. SCSS-карта

Все пути — `src/scss/partials/`. Главный файл — `_chatBubble.scss` (4236 строк; наш порт
`web-client/src/styles/tweb/_chatBubble.scss` — те же 4236).

## 7.1 Файлы

| Файл | За что отвечает |
|---|---|
| `_chatVariables.scss` | константы: `$bubble-margin: .125rem`, `$bubble-margin-big: .375rem`, `$bubble-border-radius-medium: 5px`, `$bubble-border-radius-big: 15px`, `$message-padding-top/bottom/horizontal: 4/5/8px`, `$time-margin-left` |
| `_chat.scss` | каркас колонки: `.bubbles`, `.bubbles-inner`, `.bubbles-go-down`, фон, паддинги ленты |
| `_chatBubble.scss` | ВСЁ про бабл: date-группы, группы, сам `.bubble` и все модификаторы, service, webpage, geo, reply-markup, beside-кнопки, placeholder-баблы |
| `_quote.scss` | «квотоподобные» блоки: `.quote-like` (reply, webpage-бокс, fact-check) — рамка-полоса, hover, иконка кавычки |
| `_reactions.scss` / `_reaction.scss` | `reactions-element` (block/inline/tag) и `reaction-element` (стикер, счётчик, аватары, paid) |
| `_audio.scss` / `_document.scss` | `.audio` (voice/music: волна, play, транскрипция) / `.document` (иконка ext, имя, размер) |
| `_poll.scss` | `poll-element` |
| `_replyKeyboard.scss` | reply-keyboard композера (НЕ inline-markup бабла — тот в `_chatBubble.scss:3675`) |
| `base.scss` | палитра `--message-*`: `--message-primary-color`, `--message-out-background-color`, `--message-highlighting-color`, `--message-out-*` (base.scss:325–359) |

## 7.2 Ключевые места `_chatBubble.scss`

| Строки | Что |
|---|---|
| 20–43 | `.bubbles-date-group` |
| 45–88 | `.bubbles-group`: `position: relative`; `&-avatar` — `position: sticky !important; top: 0; bottom: calc(var(--chat-padding-bottom) + …)`; `&-avatar-container` — absolute на всю группу, `flex-direction: column-reverse` (аватар прижат к низу) |
| 90–107 | `.bubble`: локальные переменные (`--primary-color`→`--message-primary-color`, `--peer-color-rgb`, `--max-width: 100%`), `margin: 0 auto $bubble-margin`, `display: flex; flex-wrap: wrap` |
| 118, 138–143 | `--max-width`: 80%−beside-кнопка; handhelds — 85%/100%−margin |
| 193–236 | `is-highlighted`/`is-selected` — `:after`-подложка цветом `--message-highlighting-color` |
| 238–266 | `is-first-unread::before` — плашка «Unread messages»: `content: var(--unread-messages-text)` (текст задаёт JS через CSS-переменную), высота 30px, ширина 200vw |
| 291, 1435, 3639 | `is-multiple-documents` |
| 469–642 | `.bubble.service` (+`.is-date`): центрирование, пилюля `--message-time-background`, `max-width: var(--chat-width)` |
| 643–680 | `is-group-last` / `is-group-first` — межгрупповые отступы |
| 681–1058 | медиа: `photo/video`, `emoji-big` (688–758), `just-media`, `sticker` (776–796), `round` (797+), `is-album` (908+), `is-square-photo` (1027+) |
| 1226–1650 | документные: `audio-message`, `voice-message`, `min-content`, `document-message`, `contact-message`, `call-message`, `poll-message` |
| 1653–1699 | `is-message-empty`, `with-reply-markup`, `with-replies .attachment`, `with-beside-replies` |
| 1866–1938 | позиционирование `.time`/`.is-floating` (has-webpage, sticker, show-controls) |
| 2089–2106 | **хвост**: `.bubble-tail { display: none }`; показывается только на `.can-have-tail.is-group-last` (или `is-forced-rounded`): absolute, bottom 0, 11×20, `fill: var(--message-background-color)`, `scaleX(var(--reflect))` |
| 2093–2276 | `can-have-tail`, `photo/video .attachment { border: 1px solid var(--message-background-color) }`, `is-thread-starter`, `is-invoice` |
| 2695–2949 | `.webpage` (бокс превью: has-square-photo, no-text) |
| 2960+ | `.geo` |
| 3226–3352 | `.bubble-content-wrapper`; service/fake-service общие правила |
| 3354–3437 | **`.bubble.is-in`**: радиусы через `--border-*-radius`; база medium/big; `is-group-first` → start-start big; `is-group-last.can-have-tail` → `--border-end-start-radius: 0` + `.bubble-tail { margin-inline-start: -8.4px }`; `has-plain-media-tail .attachment` — скругление возвращается |
| 3438–3674 | **`.bubble.is-out`**: `--message-background-color: var(--message-out-background-color)` (3440–3442), зеркальные радиусы, `is-error`, `is-sending poll-element` |
| 3675–3775 | `.reply-markup` (inline-клавиатура) |
| 3776–3835 | `.bubble-beside-button`, `.bubble-service-button`, `.bubble-primary-color`, `.inline-stars` |
| 3884+, 4061+ | `.empty-bubble-placeholder` (пустой чат, «no messages») |

Механика радиусов: четыре кастом-переменные `--border-start-start-radius` и т.д.
объявляются на `.bubble.is-in`/`.is-out` и потребляются `bubble-content`/`attachment`;
группа и хвост лишь переопределяют переменные — это то, что надо портировать 1:1
вместо ручных `border-radius` на каждом типе.

---

# 8. У нас (web-client): структура и главные расхождения

## 8.1 Карта файлов

| Путь | Роль |
|---|---|
| `web-client/src/components/Chat.tsx:1390–1442` | хост ленты: дерево `.bubbles > .scrollable > .bubbles-padding-top + .bubbles-inner + .bubbles-padding-bottom`, скролл, sticky-даты |
| `src/components/messages/ChatFeed.tsx` | каркас: секции по дням, сервисные баблы, группировка, аватар, пре-пасс альбомов |
| `src/components/messages/MessageRow.tsx` | один бабл: `.bubble` + модификаторы, wrapper/content, хвост, beside-button, quick-reaction |
| `src/components/messages/bubbleClasses.ts` | чистая функция модификаторов бабла (порт мест `classList.add` из tweb) + тест |
| `src/components/messages/MessageContent.tsx` | выбор контента по `m.type` (один каскад тернарников ~15 типов) |
| `src/components/messages/bubbleParts/*` | `Time.tsx` (порт setTime, 6 режимов), `primitives.tsx` (радиусы, BubbleTail), `mediaBubbles/richBubbles` |
| отдельные типы | `RealMediaBubble`, `AlbumGrid`, `VoiceMessage`, `PollBubble`, `ChecklistBubble`, `GiftBubble`, `GiveawayBubble`, `MessageReactions`, `InlineKeyboard`, `CommentsBar` |
| стили | глобальный порт `src/styles/tweb/_chatBubble.scss` (4236 строк) + `_quote/_reaction/_audio/_document/_spoiler`; остатки SCSS-модулей `MessageRow.module.scss` и др. |

DOM бабла у нас уже близок к tweb: `div.bubble.is-in|is-out…` → `bubble-content-wrapper` →
`bubble-content` → контент + `svg.bubble-tail`; time с двойным рендером (`.time` +
`.time-inner`) воспроизведён точно.

## 8.2 Главные структурные расхождения

1. **React + memo vs императивный DOM.** tweb собирает бабл вне DOM, батчит и монтирует
   через `BubbleGroups`; у нас декларативное дерево с ключами и мемоизацией — нет реюза
   узлов и нет батч-монтажа со scrollSaver.
2. **Группировка — на каждом рендере, а не в модели.** У tweb объектная модель
   `BubbleGroups` с переносом баблов; у нас линейный `groupBreak()` в `ChatFeed.tsx:133–148`
   (порог 121 000 мс совпадает). Обёртка `.bubbles-group` создаётся ТОЛЬКО для входящих
   серий в группах — в tweb в неё попадает каждая серия, включая исходящие и в личках.
3. **Гибрид классов.** Каркас — глобальные tweb-классы, но медиа-контент (фото/альбом),
   forwarded-шапка и имя — свои SCSS-модули (`s.media`, `s.forward`, `s.name`) с инлайновыми
   радиусами; `div.attachment`/`media-container` из tweb не воспроизведён (TODO в
   `MessageRow.module.scss:38–40`).
4. **Каскад тернарников вместо диспетчера wrappers.** `MessageContent.tsx:307–617` — один
   файл на все типы; в tweb — набор wrapper-функций по `message.media._`.
5. **Альбом — синтетический `ConvMsg`**, собираемый пре-пассом фида, а не `grouped_id`-модель;
   альбомы документов (`is-multiple-documents`) не поддержаны — файлы отдельными баблами.
6. Не реализовано: `invert-media` (класс не ставится), `has-webpage` (не ставится),
   sponsored (`is-sponsored`), story-reply, topic-кнопки, свайп-ответ на баблах.
7. **Sticky-дата** — класс `is-sticky` приходит пропом из `Chat` (React стёр бы
   императивный класс), в tweb — императивно из `StickyIntersector`.
8. Unread-divider: как в tweb — модификатор `is-first-unread` + CSS `::before`.

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Входящий и исходящий бабл: `is-in` / `is-out`, хвост `bubble-tail` только у последнего в серии.
- [ ] Серия из трёх сообщений подряд: `is-group-first` / `is-group-last`, аватар один на группу, отступы внутри серии меньше межгрупповых.
- [ ] Время и галочки в `time-inner`; на медиа — поверх с подложкой, а не под ним.
- [ ] Reply-заголовок: имя, превью, клик прыгает к оригиналу и подсвечивает его; вариант с квотой.
- [ ] Альбом 2, 3 и 5 фото: сетка и скругления углов совпадают с дампом.
- [ ] По одному баблу каждого типа: стикер, круглое видео, голосовое, документ, опрос, гео, контакт, webpage-превью.
- [ ] Сервисное сообщение по центру, unread-разделитель на месте, sticky-дата меняется при скролле.
- [ ] Реакции под баблом и replies-футер в канале не ломают хвост и группировку.

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 03-bubbles-123, 03-album-channel, 03-document, 03-reply-audio, 03-service-round, 03-video-poll, 03c-sticker-poll-video.
