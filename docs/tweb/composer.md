# Композер tweb — рабочая спека для порта (2026-08-09)

Документ-разведка для волны «перестроить `web-client/src/components/Composer.tsx` на DOM-дерево
и глобальные классы tweb». Всё, что здесь написано, подтверждено ссылкой на **файл:строка**
в `/Users/denisurevic/Documents/tweb/src` либо на дамп живого DOM в
`docs/tweb/dom/dumps/`. Там, где источник не найден, стоит явная пометка **«не найдено»** —
догадок в документе нет.

Сокращения путей:

| Префикс | Полный путь |
|---|---|
| `T/` | `/Users/denisurevic/Documents/tweb/src/` |
| `W/` | `/Users/denisurevic/Documents/messenger-denis/web-client/src/` |
| `D/` | `/Users/denisurevic/Documents/messenger-denis/docs/tweb/dom/dumps/` |

Основные источники:

- `D/04-composer-rest.json` — полное дерево композера в покое + computed;
- `D/04-emoji-dropdown.json`, `D/04-attach-menu.json`;
- `docs/tweb/dom/live-dom.md` §4;
- `T/components/chat/input.ts` (5233 строки — главный файл);
- `T/components/inputFieldAnimated.ts`, `T/components/inputField.ts`;
- `T/components/chat/{replyContainer,dragAndDrop,sendContextMenu,selectedEffect,controlPlate,markupTooltip}.ts(x)`;
- `T/components/chat/recording/`, `T/components/chat/voiceRecording/`;
- `T/components/chat/{autocompleteHelper,autocompletePeerHelper,emojiHelper,stickersHelper,inlineHelper,commandsHelper,mentionsHelper,botCommands}.ts`;
- `T/scss/partials/{_chat,_chatVariables,_voiceRecordingPanel,_videoRecordingPanel,_chatDrop,_autocompleteHelper,_autocompletePeerHelper,_chatEmojiHelper,_chatStickersHelper,_chatInlineHelper,_chatBotCommands,_emojiDropdown,_chatMarkupTooltip}.scss`, `T/scss/base.scss`, `T/scss/variables.scss`.

> **Важно про версию tweb.** Локальный чекаут — это *редизайн*: скрепка стоит **слева**,
> `.rows-wrapper` имеет `border-radius: 24px`, есть `voice-recording-panel`, `video-recording-stage`,
> `chat-input-plate`. Старые скриншоты/статьи про tweb с круглой кнопкой-скрепкой справа —
> **не наш референс**. Референс = локальные исходники + дампы.

---

## 0. Ключевые CSS-переменные и SCSS-переменные

Без них нельзя правильно прочитать ни одно правило ниже.

| Имя | Значение | Источник |
|---|---|---|
| `--chat-input-height` | `3rem` (48px) | `T/scss/base.scss:160` |
| `--chat-input-border-radius` | `$border-radius-big` = **24px** | `T/scss/base.scss:156`, `T/scss/variables.scss:4` |
| `--chat-input-max-width` | `var(--chat-width)` | `T/scss/base.scss:157` |
| `--chat-input-btn-send-margin` | `$btn-send-margin` = `.5rem` | `T/scss/base.scss:158`, `T/scss/variables.scss:27` |
| `--chat-input-background` | `var(--surface-color)` | `T/scss/partials/_chat.scss:485` (блок `.chat`) |
| `--button-size` (внутри `.chat-input-wrapper`) | `2.5rem` (40px) | `T/scss/partials/_chat.scss:545` |
| `--button-horizontal-margin` | `.25rem` | `T/scss/partials/_chat.scss:546` |
| `--padding-vertical` / `--padding-horizontal` (в `.chat-input-wrapper`) | `.25rem` / `.25rem` | `T/scss/partials/_chat.scss:542-543` |
| `--transition-standard-easing` | `cubic-bezier(.4, .0, .2, 1)` | `T/scss/base.scss:39` |
| `--transition-standard-in` | `.3s cubic-bezier(.4,0,.2,1)` | `T/scss/base.scss:42` |
| `--transition-standard-out` | `.25s cubic-bezier(.4,0,.2,1)` | `T/scss/base.scss:43` |
| `--btn-menu-transition` / `--esg-transition` | `.2s cubic-bezier(.4,0,.2,1)` | `T/scss/base.scss:61-62` |
| `$chat-helper-size` | `3rem` (48px) — высота reply-плашки | `T/scss/partials/_chatVariables.scss:4` |
| `$chat-input-box-shadow` | `0px 1px 8px 1px rgb(0 0 0 / 12%)` | `T/scss/partials/_chatVariables.scss:5` |
| `$input-transition-time` | `.2s` | `T/scss/partials/_chatVariables.scss:7` |
| `$input-half-transition-time` | `.1s` | `T/scss/partials/_chatVariables.scss:8` |
| `$background-transition-time` | `.05s` | `T/scss/partials/_chatVariables.scss:9` |
| `$border-radius` / `-medium` / `-big` | `12px` / `16px` / `24px` | `T/scss/variables.scss:2-4` |
| `$hover-alpha` | `.08` | `T/scss/variables.scss:6` |

---

## 1. Полное DOM-дерево композера

### 1.1 Дерево в покое (снято с живого клиента)

Дословно из `D/04-composer-rest.json` (чат «123 123», в черновике уже был reply-хелпер).
Отступ = вложенность. Пометки `[ВСЕГДА]` / `[ДИНАМ.]` — мои, обоснование в §1.3.

```text
div.chat-input.chat-input-main                                             [ВСЕГДА]  T/components/chat/input.ts:465-467
└ div.chat-input-container.chat-input-main-container                       [ВСЕГДА]  input.ts:468-470
  ├ div.rows-wrapper-wrapper                                               [ВСЕГДА]  input.ts:471-473
  │ └ div.rows-wrapper.chat-input-wrapper.chat-input-main-wrapper
  │   .chat-rows-wrapper                                                   [ВСЕГДА]  input.ts:474-482
  │   ├ div.autocomplete-helper.z-depth-1.autocomplete-peer-helper
  │   │   .bot-commands                                                    [ВСЕГДА]  input.ts:927 (ChatBotCommands)
  │   ├ (div.reply-keyboard — только если у пира есть reply-markup)        [ДИНАМ.]  input.ts:912-921
  │   ├ div.reply-wrapper.rows-wrapper-row                                 [ВСЕГДА]  input.ts:625-626, монтаж 1286
  │   │ └ div.reply-wrapper-content
  │   │     [style="--peer-color-rgb: var(--peer-0-color-rgb); --peer-border-background: …"]
  │   │   ├ button.btn-icon.<type>.reply-icon                              [ЗАМЕНА]  input.ts:631, replaceWith 4866-4867
  │   │   │ └ span.tgico.button-icon
  │   │   ├ div.reply.quote-like.quote-like-hoverable.quote-like-border.rp [ЗАМЕНА]  wrappers/reply.ts:30-33
  │   │   │   [style="--peer-color-rgb: …; --peer-border-background: …"]
  │   │   │ ├ div.c-ripple
  │   │   │ └ div.reply-content                                            divAndCaption.ts:17-18
  │   │   │   ├ (div.reply-media)      ← prepend только если есть медиа    replyContainer.ts:286-291
  │   │   │   ├ div.reply-title
  │   │   │   │ └ span.i18n > span.peer-title[data-peer-id] "Дн"
  │   │   │   └ div.reply-subtitle
  │   │   │     └ span > span.i18n "Voice message"
  │   │   └ button.btn-icon.reply-cancel                                   [ВСЕГДА]  input.ts:632
  │   │     └ span.tgico.button-icon
  │   ├ div.autocomplete-helper.z-depth-1.stickers-helper                  [ВСЕГДА]  input.ts:1288
  │   ├ div.autocomplete-helper.z-depth-1.emoji-helper                     [ВСЕГДА]  input.ts:1289
  │   ├ div.autocomplete-helper.z-depth-1.autocomplete-peer-helper
  │   │   .commands-helper                                                 [ВСЕГДА]  input.ts:1294
  │   ├ div.autocomplete-helper.z-depth-1.autocomplete-peer-helper
  │   │   .mentions-helper                                                 [ВСЕГДА]  input.ts:1295
  │   ├ div.autocomplete-helper.z-depth-1.inline-helper                    [ВСЕГДА]  input.ts:1296
  │   └ div.new-message-wrapper.rows-wrapper-row                           [ВСЕГДА]  input.ts:1012-1013, монтаж 1297
  │     ├ (div.new-message-bot-commands …)  ← botCommandsToggle           [ДИНАМ.]  input.ts:2712/2726-2728
  │     ├ attach-menu-button.btn-menu-toggle.attach-file
  │     │   ._Container_bns2b_1.btn-icon.rp                                [ВСЕГДА]  input.ts:1196, класс 1256
  │     │ ├ div.c-ripple
  │     │ └ span.tgico._Icon_bns2b_9.button-icon
  │     ├ div.input-message-container                                      [ВСЕГДА]  input.ts:1028
  │     │ ├ div.input-message-input.is-empty.scrollable.scrollable-y
  │     │ │   .no-scrollbar.forwards
  │     │ │   [data-peer-id contenteditable="true"
  │     │ │    style="max-height: 440px; transition-duration: 0ms; height: 37px;"]
  │     │ ├ span.input-field-placeholder.i18n.is-empty "Message"
  │     │ └ div.input-message-input.is-empty.scrollable.scrollable-y
  │     │     .input-field-input-fake [contenteditable="true"]
  │     ├ button.btn-icon.btn-scheduled.float.hide.show                    [ВСЕГДА]  input.ts:~890
  │     ├ button.btn-icon.toggle-reply-markup.float.hide.show              [ВСЕГДА]
  │     ├ button.btn-icon.hide.rp     ← btnSuggestPost                     [ВСЕГДА]  input.ts:1258
  │     ├ button.btn-icon.hide.rp     ← btnAutoDeletePeriod                [ВСЕГДА]  input.ts:1263
  │     ├ button.btn-icon.toggle-send-gift.float.hide.show                 [ВСЕГДА]  input.ts:1023
  │     ├ button.btn-icon.toggle-emoticons                                 [ВСЕГДА]
  │     ├ input[type=file][multiple][style="display:none"]                 [ВСЕГДА]  input.ts:1268-1271
  │     ├ div.voice-recording-panel.voice-recording-panel--recording       [ВСЕГДА]  chatRecording.ts:112
  │     │   … (полное дерево — §6.1)
  │     └ div.btn-send-container                                           [ВСЕГДА]  input.ts:1301-1302, монтаж 1372
  │       ├ span.btn-send-stars-badge.stars-badge-base                     input.ts:4020-4034
  │       │ ├ span.tgico.stars-badge-base__icon
  │       │ └ span
  │       ├ button.btn-icon.rp.btn-circle.btn-send.animated-button-icon.record
  │       │ ├ div.c-ripple
  │       │ ├ span.tgico.animated-button-icon-icon.btn-send-icon-send
  │       │ ├ span.tgico.animated-button-icon-icon.btn-send-icon-schedule
  │       │ ├ span.tgico.animated-button-icon-icon.btn-send-icon-edit
  │       │ ├ span.tgico.animated-button-icon-icon.btn-send-icon-record
  │       │ ├ span.tgico.animated-button-icon-icon.btn-send-icon-record-video
  │       │ └ span.tgico.animated-button-icon-icon.btn-send-icon-forward
  │       ├ div.btn-send-effect-container                                  selectedEffect.tsx:57
  │       └ div.btn-menu.menu-send.top-left                                sendContextMenu.ts:83-85
  │         └ div.btn-menu-item.rp-overflow ×5
  │           ├ span.tgico.btn-menu-item-icon
  │           └ span.i18n.btn-menu-item-text
  ├ div.fake-wrapper.fake-rows-wrapper                                     [ВСЕГДА]  input.ts:484-485
  ├ div.fake-wrapper.fake-selection-wrapper                                [ВСЕГДА]  input.ts:487-488
  ├ button.btn-circle.btn-corner.z-depth-1.bubbles-corner-button
  │   .chat-secondary-button.bubbles-go-down.rp                            [ВСЕГДА]  input.ts:615-616
  │ ├ div.c-ripple
  │ ├ span.tgico.button-icon
  │ └ span.badge.badge-24.badge-primary.is-badge-empty
  ├ div.chat-input-control.chat-input-wrapper                              [ВСЕГДА]  input.ts:566-568
  │ └ div.chat-input-plate.rows-wrapper-row                                controlPlate.tsx:35-41
  │   ├ div.chat-input-plate-side
  │   │ └ button.btn-icon.rp.hide            ← directControlBtn            input.ts:1517
  │   ├ div.chat-input-plate-center                                        input.ts:1536-1550
  │   │ ├ button…chat-input-plate-button.rp.hide  > span.i18n "START"
  │   │ ├ button…chat-input-plate-button.rp       > span.i18n "Unblock"
  │   │ ├ button…btn-color-primary…rp.hide        > span.i18n "JOIN"
  │   │ ├ button…rp.hide                          > span.i18n "Unmute"
  │   │ ├ button…rp.hide                          > span.i18n > peer-title + br + a "Learn more..."
  │   │ ├ button…rp.hide > span.chat-input-frozen-text
  │   │ │   ├ span.i18n.danger "Your Account is Frozen"
  │   │ │   └ span.i18n.secondary.chat-input-frozen-text-subtitle "Click to view details"
  │   │ ├ button…rp.hide > span.i18n "Unpin All Messages"
  │   │ └ button…rp.hide > span.i18n "Open Chat"
  │   └ div.chat-input-plate-side
  │     └ button.btn-icon.rp.hide            ← giftControlBtn              input.ts:1527
  ├ (div.reply-in-topic-overlay.hide)                                      [ВСЕГДА, если форум] input.ts:1016-1019, 1554
  └ button.btn-circle.btn-corner…bubbles-go-mention.bubbles-go-reaction.rp ×3  [ВСЕГДА]
    ├ div.c-ripple
    ├ span.tgico.button-icon
    └ span.badge.badge-24.badge-primary.is-badge-empty
```

Computed корневых узлов (из дампа, тёмная тема, ширина чата 696px):

| Узел | Размер / ключевое |
|---|---|
| `.chat-input` | 696×96, `position: absolute`, `bottom: 0`, `z-index: 2`, `max-width: 696`, `transition: transform .25s cubic-bezier(.4,0,.2,1)`, `transform: translate3d(0, var(--translateY), 0)` |
| `.chat-input-container` | 696×96, flex row, `align-items: flex-end`, `justify-content: center`, `position: relative` |
| `.rows-wrapper` | 696×96, `border-radius: 24px`, `background-color: #212121` (= `--surface-color`), `box-shadow: 0 1px 8px 1px rgba(0,0,0,.12)`, `z-index: 3`, flex column, `min-height: 3rem`, `max-height: 30rem` |
| `.new-message-wrapper` | 696×48, `padding: 4px`, flex row, `align-items: flex-end`, `justify-content: space-between`, `gap: 4px`, `border-radius: inherit` |
| `.input-message-container` | 548×40, flex row, `align-items: center`, `overflow: hidden`, `position: relative`, `width: 1%`, `flex: 1 1 auto` |
| `.input-message-input` | 548×37, `padding: 8px 0`, `line-height: 21px`, `font-size: 16px`, `transition: height`, `overflow: hidden auto` |
| `.btn-send-container` | 48×40, flex, center |
| `.btn-send` | 48×40, `border-radius: 20px`, `min-width: 48px`, `font-size: 24px`, `background: var(--primary-color)`, `color: #fff`, `z-index: 3`, `overflow: hidden`, `transition: opacity .2s` |
| attach btn | 40×40 |
| `.reply-wrapper` | 696×48 (при `is-helper-active`), `padding: 0 4px`, `overflow: hidden`, `transition: height .25s cubic-bezier(.4,0,.2,1)` |

### 1.2 Состояния

Ключевой принцип tweb: **почти всё живёт в DOM постоянно**, состояния — только классы.
Ниже — что меняется в каждом состоянии.

#### (а) Пустой инпут

- `.input-message-input` и `.input-field-placeholder` имеют `is-empty` (`inputField.ts:776-780`).
- `.btn-send` = `record` (или `record-video`) — `input.ts:3991`.
- `.btn-scheduled`, `.toggle-reply-markup`, `.toggle-send-gift` получают `show` (`input.ts:4003/4007/4011`).
- `.input-message-input` inline `height: 37px` (одна строка) — `inputFieldAnimated.ts:72`.

#### (б) Есть текст

- `is-empty` снимается с обоих узлов; плейсхолдер уезжает (`opacity 0` + `translateX(1rem)`).
- `.btn-send` = `send` (или `schedule` в scheduled-чате) — `input.ts:3990`.
- `show` снимается с `.btn-scheduled` / `.toggle-reply-markup` / `.toggle-send-gift`.
- Inline `height` на `.input-message-input` пересчитывается + inline `transition-duration`.
- Иконки `.btn-send-icon-*` проигрывают `grow-icon` / `hide-icon` 400ms (см. §3).

#### (в) Reply / Edit / Forward / Suggested / Webpage

Не отдельные узлы — **одна и та же** `.reply-wrapper.rows-wrapper-row`:

- на `.chat.container` (родитель всего чата, НЕ композера!) добавляется `is-helper-active` →
  CSS раскрывает `.reply-wrapper` с `height: 0` до `height: 3rem` (`_chat.scss:783-787`);
- `button.reply-icon` **пересоздаётся** и `replaceWith`-ится, класс иконки = имя типа:
  `reply` | `edit` | `forward` | `suggested` | `link` (для `webpage`) — `input.ts:4866-4867`;
- `div.reply…` пересоздаётся через `wrapReply()` и заменяет старый (`input.ts:4877-4881`);
- на `.reply-wrapper-content` ставится `--peer-color-rgb` / `--peer-border-background`
  (`input.ts:4877`, реализация `peerColors.ts:60-61`).

Подробности — §4.

#### (г) Запись голоса

- на `.chat-input`: `is-shrinking` + `is-recording` (через `SetTransition`, 200ms) —
  `chatRecording.ts:792` → `input.ts:3630-3638`; и `is-locked` — `chatRecording.ts:946`;
- `.voice-recording-panel` получает `--recording` (`voiceRecordingPanel.ts:127`) и по CSS
  `.chat-input.is-recording .voice-recording-panel` становится видимой:
  `opacity: 1; visibility: visible; pointer-events: auto` (`_voiceRecordingPanel.scss:167-174`);
- **остальные узлы строки НЕ прячутся классами** — панель просто накрывает их непрозрачным
  оверлеем: `position: absolute; inset: 0; inset-inline-end: calc(var(--chat-input-height) + .5rem);
  background-color: var(--surface-color); border-radius: inherit; z-index: 2`
  (`_voiceRecordingPanel.scss:7-22`). Вырез справа оставляет открытой кнопку send;
- `.attach-file` при `.is-recording.forwards` гасится: `opacity: 0; pointer-events: none`
  (`_chat.scss:227-238`);
- `.btn-send` = `send` (потому что `this.recording` истинно — `input.ts:3990`);
- пауза: `.voice-recording-panel--paused` вместо `--recording` (`voiceRecordingPanel.ts:126`).

#### (д) Запись кружка (video note)

- всё то же самое, что (г) — **та же** `.voice-recording-panel` с корзиной/волной/таймером/паузой
  (комментарий `videoRecordingPanel.tsx:6-9`);
- **дополнительно** в `<body>` (не в композер!) монтируется полноэкранный оверлей превью:
  `getOverlayRoot().append(this.videoRecordingPanel.element)` — `chatRecording.ts:123`,
  `getOverlayRoot()` = `activeWindow.document.body` (`helpers/appWindow.ts:33-35`);
- `.btn-send` в состоянии `record-video` только **до** старта записи; во время записи — `send`.

#### (е) Выделение сообщений

- `ChatSelection` создаёт **новый** узел и аппендит его в `.chat-input-container`:
  `div.chat-input-wrapper.selection-wrapper` (`selection.ts:1043-1044`), внутрь —
  `ChatInputPlate({class: 'selection-container', left, center, right})` (`selection.ts:1121-1126`);
- монтаж с reflow-трюком: `style.opacity='0'` → append → `void offsetLeft` → `style.opacity=''`
  (`selection.ts:1129-1134`); размонтаж — `selectionInputWrapper.remove()` (`selection.ts:1162`);
- `_center()` уводит `.rows-wrapper` в `fakeSelectionWrapper` (`input.ts:1899-1901`);
- слоты: left = `ButtonIcon('delete danger selection-container-delete')`,
  center = `Button('btn-primary btn-transparent text-bold chat-input-plate-button')` со счётчиком,
  right = `ButtonIcon('forward selection-container-forward')` либо
  `ButtonIcon('send2 selection-container-send')` для scheduled (`selection.ts:1085/1101/1109`);
- **это единственный узел композера, который реально монтируется/размонтируется** (кроме
  `botCommandsToggle` и drop-зон).

#### (ж) Плашка-замена инпута (`.chat-input-control`)

Узел **всегда в DOM** (`input.ts:566-568`), по умолчанию `opacity: 0; visibility: hidden`
(`_chat.scss:561-570`, `:646-649`). Внутри — `.chat-input-plate` с **восемью** кнопками в центре,
семь из которых имеют `.hide`. Показывается через `_center()` +
`.rows-wrapper-wrapper.is-centering-to-control.forwards ~ .chat-input-control { opacity: 1; visibility: visible }`
(`_chat.scss:684-694`).

Список кнопок и условия — §2.4.

### 1.3 Что монтируется/размонтируется (критично для React-порта)

**Всегда в DOM, скрывается только классами:**

- вся цепочка `.chat-input` → `.chat-input-container` → `.rows-wrapper-wrapper` → `.rows-wrapper`;
- `.fake-rows-wrapper`, `.fake-selection-wrapper` (`input.ts:484-490`);
- `.chat-input-control` со всеми восемью кнопками (`input.ts:566-568`, `1536-1552`);
- `.new-message-wrapper` и все её кнопки (`input.ts:1273-1284`);
- `.input-message-container` + реальный инпут + плейсхолдер + фейк-инпут (`input.ts:2936`);
- `.reply-wrapper` (`input.ts:1286`) — но её содержимое (`.reply-icon`, `.reply`) заменяется;
- все шесть `.autocomplete-helper` (`input.ts:1288-1296` + `927`);
- `.voice-recording-panel` (`chatRecording.ts:112`);
- `.btn-send-container` со всеми 6 иконками (`input.ts:1301-1314`, `1372`);
- `.btn-menu.menu-send` (`input.ts:1361-1363`) — но пересоздаётся при каждом закрытии
  (`sendContextMenu.ts:140-147`).

**Реально монтируется/размонтируется:**

| Узел | Монтаж | Размонтаж |
|---|---|---|
| `botCommandsToggle` (`.new-message-bot-commands`) | `input.ts:2726-2728` `prepend` | `input.ts:2434`, `2712` `remove()` |
| `.selection-wrapper` | `selection.ts:1131` | `selection.ts:1162` |
| `.drop` / `.drops-container` | `dragAndDrop.ts:53`, `appImManager.ts:2398` | `dragAndDrop.ts:74-80` |
| `.video-recording-stage` | `chatRecording.ts:123` (в `<body>`) | — (живёт всю сессию, скрыт `opacity/visibility`) |
| `.reply-icon`, `div.reply` внутри reply-плашки | `input.ts:4866-4881` `replaceWith` | там же |
| `.btn-menu.menu-send` | `sendContextMenu.ts:85`, пересоздание `:146` | `setTimeout(() => element.remove(), 400)` `:147` |
| `.emoji-dropdown` | `dropdownHover.ts:214` `style.display=''` | `style.display='none'` через 200 ms `:250` |

**Узел, который создан, но НЕ вставлен в DOM:** `btnCancelRecord` (`input.ts:1299`, явный
комментарий `input.ts:1370-1371`). CSS для `.btn-record-cancel` (`_chat.scss:45-64`) — мёртвый
в этом редизайне.

---

## 2. Таблица классов-переключателей

### 2.1 На корне `.chat-input`

| Класс | Ставится/снимается | Что делает |
|---|---|---|
| `hide` | add `input.ts:466` (старт), `2198` (cleanup); `toggle(chat.noInput)` `2394`; remove `2398` | `display: none !important` (`_global.scss:98-100`) |
| `chat-input-main` (className2) | add `input.ts:466` | `position: absolute; bottom: 0; z-index: 2; transition: transform var(--transition-standard-out)` (`_chat.scss:307-315`) |
| `can-pin` | `toggle(canPinMessage)` `input.ts:2406` | только для `ChatType.Pinned` |
| `is-hidden` | `toggle(!canSend)` `input.ts:2835` | скрывает строку ввода |
| `no-transition` | add `input.ts:2833`, reflow `void offsetLeft`, remove `2836` | мгновенная смена без анимации |
| `is-shrinking` (+ `forwards`/`animating`) | `SetTransition` в `setShrinking()` `input.ts:3630-3637`, duration 200 | кросс-фейд вторичных кнопок (`_chat.scss:206-224`) |
| `is-recording` | `setShrinking(active, ['is-recording'])` — `chatRecording.ts:792` | разблокирует `.btn-send`, гасит `.attach-file` (`_chat.scss:227-238`); показывает `.voice-recording-panel` (`_voiceRecordingPanel.scss:167-186`) |
| `is-locked` | add `chatRecording.ts:946`, `1073`; remove `179`, `247`, `962`, `1054`, `1103` | `pointer-events: none` на всё + `opacity: var(--disabled-opacity)` на `.btn-icon` (`_chat.scss:197-204`) |
| `is-focused`, `is-private` | извне, `components/stories/viewer.tsx:386, 439, 459` | только для stories |
| `is-selecting` | **в `input.ts` не найдено**; читается в `_autocompleteHelper.scss:32` (`.chat-input:not(.is-selecting) &.is-visible.forwards`) — ставится в `selection.ts` |

### 2.2 На дочерних узлах композера

| Узел | Класс | Ставится | Эффект |
|---|---|---|---|
| `.chat-input-container` | `is-centering` (+`forwards`/`animating`) | `SetTransition` `input.ts:1750-1755` | скрывает `.new-message-wrapper` (`opacity: 0`), схлопывает `.reply-wrapper` (`height: 0 !important`), `transform: scale(0)` на `.btn-send` (`_chat.scss:313-345`) |
| `.rows-wrapper-wrapper` | `is-centering-to-control` | `SetTransition` `input.ts:1756-1761` | показывает `.chat-input-control` (`opacity: 1; visibility: visible`) — `_chat.scss:684-694` |
| `.rows-wrapper` | inline `style.transform`, `style.borderRadius` | `input.ts:1762-1763` | морф в ширину/радиус целевой плашки |
| `.new-message-wrapper` | `data-offset="as" \| "commands"` | `input.ts:2628-2632` | выбирает `--offset-translateX` |
| `.new-message-wrapper` | `has-offset` (+`forwards`/`animating`) | `SetTransition`, duration 300 — `input.ts:2639-2644` | сдвигает `.attach-file` и `.input-message-container` вправо, показывает send-as/bot-commands (`_chat.scss:981-1022`) |
| `.new-message-wrapper` | CSS-переменная `--commands-size` | `input.ts:2718-2724` | ширина bot-menu кнопки |
| `.chat.container` (родитель чата) | `is-helper-active` | add `input.ts:4886-4890`, remove `4784-4791` | раскрывает `.reply-wrapper` до `3rem` (`_chat.scss:783-787`) |
| `.chat.container` | `is-toggling-helper` | `SetTransition`, duration 150 — `input.ts:4797-4807` | вспомогательный флаг на время анимации |
| `.input-message-input` + `.input-field-placeholder` | `is-empty` | `inputField.ts:776-780` (`setEmpty`) | плейсхолдер `opacity: 1` + `translateX(0)` (`_input.scss:246-251`) |
| `.input-message-input` | `is-changing-height` | `SetTransition` `inputFieldAnimated.ts:87-97` | на время анимации высоты |
| `.btn-send` | `send`/`record`/`record-video`/`edit`/`schedule`/`forward` | `classList.toggle` `input.ts:3993-3995` | выбирает видимую иконку (`_chat.scss:180-187`) |
| `.btn-send` | `disabled` | `inputState/useDirectMessages.ts:23` | `pointer-events: none; background: var(--secondary-color)` (`_chat.scss:167-170`) |
| `.btn-send-stars-badge` | `btn-send-stars-badge--active` | `inputState/useStarsState.ts:17` | показ бейджа звёзд |
| `.btn-send-effect-container` | `is-visible` | реактивно `selectedEffect.tsx:57` | `opacity: 1` (`_chat.scss:1486-1488`) |
| `.btn-scheduled` / `.toggle-reply-markup` / `.toggle-send-gift` | `show` | `input.ts:4003/4007/4011` | вместе с `.float` даёт `display: flex !important` при `.chat-input:not(.is-recording)` (`_chat.scss:109-113`) |
| `.btn-scheduled` | `hide` | remove `input.ts:898`; `toggle(!value.length)` `907` | нет отложенных — прячем |
| `.toggle-reply-markup` | `active` | `input.ts:922-923` | `color: var(--primary-color)` (`_chat.scss:1042-1044`) |
| `.toggle-emoticons` | `active` | `input.ts:1942` (не-тач); на тач — `replaceButtonIcon` `1944` | подсветка |
| `.attach-file` | `menu-open` | `ButtonMenuToggle` | `color: primary; background: light-primary` (`_chat.scss:707-713`) |
| `.attach-file` | `btn-disabled` | `input.ts:2586` | `opacity: var(--disabled-opacity)` |
| `.reply-in-topic-overlay` | `hide` | `toggle(!good)` `input.ts:2518` | оверлей «отвечать в теме» |
| `.autocomplete-helper` | `is-visible` (+`forwards`/`backwards`/`animating`) | `SetTransition` `autocompleteHelper.ts:179-188`, duration 300 | `display: none` без класса; fade-in/out 0.2s (`_autocompleteHelper.scss:20-43`) |
| `.inline-helper` | `is-gallery`, `cant-send` | `inlineHelper.ts:114`, `293`, `302` | grid-режим / заглушка |
| `.voice-recording-panel` | `--recording` / `--paused` | `voiceRecordingPanel.ts:126-127` | см. §6.2 |
| `.voice-recording-panel` | `--playing` | `voiceRecordingPanel.ts:140` | свап play↔pause иконки |
| `.video-recording-stage` | `--recording` / `--paused` / `--playing` | реактивно `videoRecordingPanel.tsx:36-41` | `opacity`/`visibility` оверлея |
| `.emoji-dropdown` | `active` | `dropdownHover.ts:216` / remove `:242` | `opacity: 1; transform: scale(1)` (`_emojiDropdown.scss:70-73`) |
| `.emoji-dropdown` | `is-under` | `toggle(!shouldBeTop)` `input.ts:1390` | инлайн-режим под инпутом (мобилка) |
| `.drop` | `is-dragover` | `dragAndDrop.ts:61` / `:66` | `color: var(--primary-color)`, анимация пунктира |
| `.drops-container` | `is-visible` | `SetTransition` `appImManager.ts:2402-2418`, duration 200 | fade 0.2s linear |
| `.markup-tooltip` | `hide` / `is-visible` / `is-link` / `no-transition` / `night` | `markupTooltip.ts:294/451/227/441/421` | см. §11.4 |
| `body` | `is-dragging` | (в `appImManager.ts`) | гасит pointer-events в `.page-chats` (`_chatDrop.scss:117-125`) |

### 2.3 Классы, которых в `input.ts` НЕТ

Проверено grep: `type-…`, `is-selecting` — **не найдено** в `input.ts` (последний читается,
но не ставится: `input.ts:1900` `this.chat.selection?.isSelecting`). Отдельной функции
`setSendBtnState` **не найдено** — только `updateSendBtn()`.

### 2.4 Кнопки `.chat-input-control` и условия их показа

Создание — `input.ts:1454-1507`:

```ts
1454 const makeControlButton = (langKey, filled?) => {
1455   const button = Button(`btn-primary ${filled ? 'btn-color-primary' : 'btn-transparent'} text-bold chat-input-control-button chat-input-plate-button`);
1456   button.append(langKey instanceof HTMLElement ? langKey : i18n(langKey));
1457   return button;
1458 };
```

Цепочка `haveSomethingInControl` в `finishPeerChange` (`input.ts:2445-2567`) — первая
сработавшая ветка «съедает» флаг:

| Порядок | Кнопка | Условие `good` | Строка `classList.toggle('hide', !good)` |
|---|---|---|---|
| 1 | `frozenBtn` | `appConfig.freeze_since_date && !canSend` | `input.ts:2452` |
| 2 | `joinBtn` (filled) | `showJoin` = `!!getJoinButtonType() \|\| (cantPost && channel.pFlags.left)` | `input.ts:2470` |
| 2b | `channelMuteBtn` | `showMute` = `(cantPost && !channel.pFlags.left) \|\| isRepliesChat` | `input.ts:2480` |
| 2c | `directControlBtn` (левый слот) | `channel.linked_monoforum_id` | `input.ts:2491` |
| 2d | `giftControlBtn` (правый слот) | `isBroadcast` | `input.ts:2492` |
| 3 | `pinnedControlBtn` | `chat.type === ChatType.Pinned`; лейбл `canPinMessage ? 'Chat.Input.UnpinAll' : 'Chat.Pinned.DontShow'` | `input.ts:2498` |
| 4 | `openChatBtn` | `chat.type === ChatType.Saved` | `input.ts:2512` |
| 5 | `replyInTopicOverlay` | `isForum && !isForumTopic && type === Chat` | `input.ts:2518` |
| 6 | `onlyPremiumBtn` | `!isBot && peerId.isUser() && isPremiumRequired` | `input.ts:2527` |
| 7 | `unblockBtn` | `!isBot && peerId.isUser()` | `input.ts:2533` |
| 8 | `botStartBtn` (START) | fallback: `toggle('hide', haveSomethingInControl)` | `input.ts:2567` |

Показывать ли плашку вообще — решает `getNeededFakeContainer()` (`input.ts:1899-1918`):

```ts
1899 public async getNeededFakeContainer(startParam = this.startParam) {
1900   if(this.chat.selection?.isSelecting) return this.fakeSelectionWrapper;
1901   else if(
1905     this.chat.type === ChatType.Pinned ||
1906     (this.chat.type === ChatType.Saved && this.chat.threadId !== this.chat.peerId) ||
1907     await this.chat.isStartButtonNeeded() ||
1908     this.isReplyInTopicOverlayNeeded() ||
1909     (this.chat.peerId.isUser() && (this.chat.isUserBlocked || this.chat.isPremiumRequired)) ||
1910     this.getJoinButtonType() ||
1911     await this.isChannelControlNeeded() ||
1912     this.isRepliesChat() ||
1913     (this.frozenBtn && this.chat.appConfig.freeze_since_date && !(await this.chat.canSend()))
1914   ) return this.controlContainer;
1915 }
```

Анимация подмены — `_center()` (`input.ts:1703-1777`): считает `scale = widthTo / widthFrom`,
`initTranslateX = (widthFrom - widthTo) / 2`, `transform = translateX(…) scaleX(scale)`,
`borderRadius = 16 + 16 * (1 - scale)` px при `scale < 1`, `duration = animate ? 200 : 0`.

---

## 3. Морф кнопки отправки

### 3.1 Создание (`input.ts:1301-1318`)

```ts
1301 this.btnSendContainer = document.createElement('div');
1302 this.btnSendContainer.classList.add('btn-send-container');
1303
1304 this.btnSend = this.createButtonIcon();
1305 this.btnSend.classList.add('btn-circle', 'btn-send', 'animated-button-icon');
1306 const icons: [Icon, string][] = [
1307   ['logo', 'send'],
1308   ['schedule', 'schedule'],
1309   ['check', 'edit'],
1310   ['microphone_filled', 'record'],
1311   ['recordround', 'record-video'],
1312   ['forward_filled', 'forward']
1313 ];
1314 this.btnSend.append(...icons.map(([name, type]) => Icon(name, 'animated-button-icon-icon', 'btn-send-icon-' + type)));
1315
1316 this.addStarsBadge();
1317
1318 this.btnSendContainer.append(this.btnSend);
```

Порядок иконок в DOM строго фиксирован: **send → schedule → edit → record → record-video → forward**.
Каждая — `span.tgico.animated-button-icon-icon.btn-send-icon-<type>`.

В контейнер дополнительно попадают:

- `span.btn-send-stars-badge.stars-badge-base` — `input.ts:4020-4034`;
- `div.btn-send-effect-container` — `input.ts:1320-1326` (`SelectedEffect`);
- `div.btn-menu.menu-send.top-left` — `input.ts:1361-1363` (`SendMenu.onRef`).

Монтаж: `this.newMessageWrapper.append(this.btnSendContainer)` — `input.ts:1372` (последний узел строки).

### 3.2 Логика выбора состояния — `updateSendBtn()` (`input.ts:3983-4018`)

```ts
3983 public updateSendBtn() {
3984   let icon: ChatSendBtnIcon;
3985
3986   const isInputEmpty = this.isInputEmpty();
3987
3988   if(this.chat.type === ChatType.Stories && isInputEmpty && !this.freezedFocused && this.canForwardStory) icon = 'forward';
3989   else if(this.editMsgId) icon = 'edit';
3990   else if(!this.recordingController?.hasVoiceRecorder() || this.recording || !isInputEmpty || this.forwarding || this.suggestedPost?.hasMedia) icon = this.chat.type === ChatType.Scheduled ? 'schedule' : 'send';
3991   else icon = this.recordingController.getActiveRecordingMediaType() === 'video' ? 'record-video' : 'record';
3992
3993   ['send', 'record', 'record-video', 'edit', 'schedule', 'forward'].forEach((i) => {
3994     this.btnSend.classList.toggle(i, icon === i);
3995   });
   …
4002   if(this.btnScheduled)         this.btnScheduled.classList.toggle('show', isInputEmpty && this.chat.type !== ChatType.Scheduled);
4006   if(this.btnToggleReplyMarkup) this.btnToggleReplyMarkup.classList.toggle('show', isInputEmpty && this.chat.type !== ChatType.Scheduled);
4010   if(this.btnSendGift)          this.btnSendGift.classList.toggle('show', isInputEmpty);
4017   this.onUpdateSendBtn?.(icon === 'record-video' ? 'record' : icon);
4018 }
```

Тип — `input.ts:193`: `type ChatSendBtnIcon = 'send' | 'record' | 'record-video' | 'edit' | 'schedule' | 'forward';`

**Таблица приоритетов:**

| # | Условие | icon |
|---|---|---|
| 1 | Stories + пусто + `!freezedFocused` + `canForwardStory` | `forward` |
| 2 | `this.editMsgId` | `edit` |
| 3 | нет рекордера **или** `this.recording` **или** есть текст **или** `this.forwarding` **или** `suggestedPost.hasMedia` | `schedule` (если `ChatType.Scheduled`), иначе `send` |
| 4 | иначе | `record-video` (если `getActiveRecordingMediaType() === 'video'`), иначе `record` |

`schedule` — **не отдельная ветка**, а вариант ветки «send» в scheduled-чате.
`record-video` берётся из persist-настройки: `chatRecording.ts:899-905`
(`this.input.chat?.appSettings?.recordingMediaType ?? 'voice'`).

Вызовы `updateSendBtn()`: `input.ts:600, 1430, 2867, 3177, 3644, 3856, 3889, 3915, 4103, 4908` +
`chatRecording.ts:793`.

### 3.3 CSS-морф иконок

Базовое состояние всех шести иконок — `T/scss/partials/_animatedIcon.scss:159-170`:

```scss
.animated-button-icon {
  &-icon {
    position: absolute;
    height: 1.5rem;
    line-height: 1.5rem;
    animation: hide-icon .4s forwards ease-in-out;

    @include animation-level(0) {
      visibility: hidden;
      animation: none !important;
    }
  }
}
```

Активная иконка — `T/scss/partials/_chat.scss:180-188`:

```scss
&.send .btn-send-icon-send,
&.record .btn-send-icon-record,
&.record-video .btn-send-icon-record-video,
&.edit .btn-send-icon-edit,
&.schedule .btn-send-icon-schedule,
&.forward .btn-send-icon-forward {
  visibility: visible !important;
  animation: grow-icon .4s forwards ease-in-out !important;
}
```

Keyframes — `T/scss/base.scss:1082-1108`:

```scss
@keyframes grow-icon {
  0%   { transform: scale(.5);  opacity: .8; }
  50%  { transform: scale(1.1); opacity: 1;  }
  100% { transform: scale(1); }
}

@keyframes hide-icon {
  from { transform: scale(1);  opacity: .4; }
  to   { transform: scale(.5); opacity: 0;  }
}
```

**Длительность 400 ms, easing `ease-in-out`, `fill-mode: forwards`.** В дампе анимаций
(`D/04-emoji-dropdown.json`, секция `anims`) для всех шести иконок видно
`duration: 400, easing: "linear"` — это потому, что DevTools показывает `linear` для
composited-анимаций без явного `animation-timing-function` внутри keyframes; в SCSS явно
указан `ease-in-out`. **Брать `ease-in-out` из SCSS.**

### 3.4 Стили самой кнопки (`_chat.scss:137-190`)

```scss
.btn-send {
  color: #fff !important;
  background-color: var(--primary-color) !important;
  z-index: 3;
  opacity: 1 !important;
  min-width: 3rem;          /* 48px */
  border-radius: 1.25rem !important;   /* 20px */
  height: 2.5rem !important;           /* 40px */
  margin: 0 !important;

  .is-rtl & { transform: scaleX(-1); }
  @include hover() { background-color: var(--dark-primary-color) !important; }
  &.disabled { pointer-events: none; background-color: var(--secondary-color) !important; }

  .btn-send-icon-edit { font-size: 2rem; font-weight: var(--font-weight-bold); }
  .btn-send-icon-send { margin-inline-start: -3px; margin-bottom: -1px; }
}
.btn-record-cancel, .btn-send { font-size: 1.5rem; line-height: 1.5rem; }
```

Контейнер (`_chat.scss:114-135`): `position: relative; flex: 0 0 auto; display: flex;
align-items: center; justify-content: center`.

### 3.5 Клик и long-press

```ts
1450 attachClickEvent(this.btnSend, this.onBtnSendClick, {listenerSetter: this.listenerSetter, touchMouseDown: true});
```

```ts
3728 private onBtnSendClick = async(e: Event) => {
3729   cancelEvent(e);
3733   if(this.recordingController.consumeLongPressSuppression()) return;
3737   const isInputEmpty = this.isInputEmpty();
3738   const hasAnyRecorder = this.recordingController.hasAnyRecorder();
3739   if(this.chat.type === ChatType.Stories && isInputEmpty && !this.freezedFocused && this.canForwardStory) {
3740     this.forwardStoryCallback?.(e as MouseEvent);
3742   } else if(!hasAnyRecorder || this.recording || !isInputEmpty || this.forwarding || this.editMsgId || this.suggestedPost?.hasMedia) {
3743     if(this.recording) this.recordingController.handleSendButtonClick();
3746     else this.sendMessage();
3748   } else {
3752     this.recordingController.startActive();
3753   }
3754 };
```

**Запись НЕ по удержанию.** Обычный клик по пустому инпуту стартует запись.
Long-press (**400 ms**, только ЛКМ, только не-тач) открывает контекст-меню выбора voice/video:

```ts
885 this.input.listenerSetter.add(this.input.btnSend)('mousedown', (e: MouseEvent) => {
886   this.recordModeLongPressed = false;
887   if(e.button !== 0 || !this.canSwitchRecordingMode()) return;
888   clearPressTimer();
889   pressTimer = window.setTimeout(() => {
890     pressTimer = 0;
891     this.recordModeLongPressed = true;
892     contextMenu.open(e);
893   }, 400);
894 });
895 this.input.listenerSetter.add(this.input.btnSend)('mouseup', clearPressTimer);
896 this.input.listenerSetter.add(this.input.btnSend)('mouseleave', clearPressTimer);
```
(`T/components/chat/recording/chatRecording.ts:855-896`; `consumeLongPressSuppression()` — `:799-806`.)

### 3.6 Send-меню (`sendContextMenu.ts`)

Дерево: `div.btn-menu.menu-send.top-left` > `div.btn-menu-item.rp-overflow` ×5, внутри
`span.tgico.btn-menu-item-icon` + `span.i18n.btn-menu-item-text`.

Кнопки (`sendContextMenu.ts:42-70`):

| icon | langKey | verify |
|---|---|---|
| `mute` | `Chat.Send.WithoutSound` | `type === 'schedule'` |
| `schedule` | `Chat.Send.ScheduledMessage` | `type === 'schedule' && !isPaid` |
| `schedule` | `Chat.Send.SetReminder` | `type === 'reminder'` |
| `online` | `Schedule.SendWhenOnline` | `schedule && await canSendWhenOnline() && !isPaid` |
| `crossround` (`danger: true`) | `Effect.Remove` | `!!this.options.effect?.()` |

`type = params.peerId === rootScope.myId ? 'reminder' : 'schedule'` (`sendContextMenu.ts:38`).

Открытие — `attachContextMenuListener({element: this.btnSend})` (`input.ts:1344`), гейт в
`onOpen` (`input.ts:1345-1352`): только если
`chat.type !== ChatType.Scheduled && (recording || !isInputEmpty() || forwarding) && !editMsgId`.
Перед каждым открытием пункты перепроверяются: `button.element.classList.toggle('hide', !result)`
(`sendContextMenu.ts:97`). При закрытии меню **пересоздаётся целиком**, старый узел удаляется
через `setTimeout(…, 400)` (`sendContextMenu.ts:146-147`).

Позиционирование — `_chat.scss:36-39`: `.menu-send { top: auto; bottom: calc(100% + .5rem); }`.

### 3.7 Бейдж эффекта (`selectedEffect.tsx`)

```
div.btn-send-effect-container[.is-visible]     selectedEffect.tsx:57
└ <Animated type="cross-fade">
  └ div.btn-send-effect                        selectedEffect.tsx:28  (внутри wrapSticker 20×20)
```

CSS (`_chat.scss:1465-1491`): контейнер `position: absolute; width/height: 1.375rem;
inset-inline-end: -.25rem; z-index: 3; background: var(--surface-color); border-radius: 50%;
opacity: 0; transition: opacity var(--transition-standard-in)`; `.is-visible { opacity: 1 }`.
Сам стикер `.btn-send-effect { width/height: .875rem }`.

---

## 4. Плашка reply / edit / forward

### 4.1 Одна плашка на все типы

Контейнер строится один раз в `constructReplyElements()` (`input.ts:624-638`):

```
div.reply-wrapper.rows-wrapper-row                      input.ts:625-626
└ div.reply-wrapper-content                             input.ts:628-629
  ├ button.btn-icon.<type>.reply-icon                   input.ts:631  (noRipple)
  ├ div.reply.quote-like.quote-like-hoverable.quote-like-border.rp
  └ button.btn-icon.close.reply-cancel                  input.ts:632
```

`content.append(iconBtn, cancelBtn)` (`input.ts:634-635`), `container.append(content)`
(`input.ts:635`), монтаж — `this.rowsWrapper.append(this.replyElements.container)` (`input.ts:1286`).

**Порядок узлов в DOM и визуальный порядок различаются** — визуальный задаётся `order`:
`.reply-icon { order: 0 }` (`_chat.scss:797`), `.reply { order: 1 }` (`_chat.scss:790`),
`.reply-cancel { order: 2 }` (`_chat.scss:802`). Сам `div.reply` физически вставляется
**между** иконкой и кнопкой отмены (`replyParent.lastElementChild.before(container)`).

### 4.2 Переиспользование — `setTopInfo()` (`input.ts:4831-4906`)

```ts
4863 const replyParent = this.replyElements.content;
4864 const oldReply = replyParent.lastElementChild.previousElementSibling;
4865 const haveReply = oldReply.classList.contains('reply');
4866 this.replyElements.iconBtn.replaceWith(this.replyElements.iconBtn =
4867   this.createButtonIcon((type === 'webpage' ? 'link' : type) + ' reply-icon', {noRipple: true}));
4868 const {container} = wrapReply({title, subtitle, setColorPeerId, animationGroup: …, message,
4869                                textColor: 'secondary-text-color', quote});
4877 setPeerColorToElement({peerId: setColorPeerId, element: replyParent});
4879 if(haveReply) oldReply.replaceWith(container);
4881 else replyParent.lastElementChild.before(container);
```

Имя иконки = имя типа: `reply` | `edit` | `forward` | `suggested` | `link` (для `webpage`).
Кнопка отмены — иконка `close` (`input.ts:632`).

**Тексты по типам:**

| type | title | subtitle | Источник |
|---|---|---|---|
| `edit` | `i18n('AccDescrEditing')` | `wrapMessageForReply({message, usingMids: [mid]})` | `input.ts:4407-4414` |
| `reply` | `i18n('ReplyToQuote' \| 'ReplyTo', [title])` | subtitle + `quote` | `input.ts:4630`, `4654-4662` |
| `forward` | `i18n('Chat.Accessory.Forward' \| 'Chat.Accessory.Hidden', [length])` | senderTitles + `': '` + replyFragment, либо `Chat.Accessory.Forward.From` | `input.ts:4517-4518`, `4541-4565` |
| `suggested` | `i18n('SuggestedPosts.SuggestAPost')` / `i18n('SuggestedPosts.SuggestChanges')` | `createSuggestedPostSubtitle(payload)` | `input.ts:4933-4939`, `4444-4451` |

Заголовок forward-плашки переписывается на лету при переключении Show/Hide sender:
находится `.reply-title`, берётся `I18n.IntlElement`, меняется `i.key` (`input.ts:732-740`).

Сброс — `clearHelper()` (`input.ts:4745-4794`).

### 4.3 Внутреннее дерево `div.reply` (из `DivAndCaption`)

```
div.reply                        divAndCaption.ts:11-12
├ div.reply-border               divAndCaption.ts:14-15  ← удаляется в wrapReply (reply.ts:36)
└ div.reply-content              divAndCaption.ts:17-18
  ├ div.reply-media              replyContainer.ts:269-271, prepend только если есть медиа
  ├ div.reply-title
  └ div.reply-subtitle
```

Дополнительные классы:

| Класс | Где ставится |
|---|---|
| `quote-like quote-like-hoverable quote-like-border` | `wrappers/reply.ts:33` |
| `quote-like-icon`, `reply-multiline` | `wrappers/reply.ts:40-41` (при `isQuote`) |
| `is-media` на `.reply` | `replyContainer.ts:286` |
| `is-round` на `.reply-media` | `replyContainer.ts:256` |
| `is-expired-story` | `replyContainer.ts:283` |
| `reply-no-subtitle` (+ удаление `.reply-subtitle`) | `wrappers/reply.ts:69-70` |

### 4.4 Анимация height 0 → 3rem

CSS (`_chat.scss:758-788`):

```scss
.reply-wrapper {
  justify-content: flex-start;
  align-items: flex-end;
  height: 0;
  width: 100%;
  padding: 0 var(--padding-horizontal);   /* 0 4px */
  user-select: none;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
  background: none;
  border-radius: unset;

  &-content {
    display: flex;
    align-items: center;
    width: 100%;
    gap: inherit;              /* = --button-horizontal-margin = 4px */
    margin-bottom: .25rem;
  }

  @include animation-level(2) {
    transition: height var(--transition-standard-out);   /* .25s cubic-bezier(.4,0,.2,1) */
  }

  .chat.is-helper-active & {
    pointer-events: unset;
    height: 3rem;              /* $chat-helper-size, _chatVariables.scss:4 */
    opacity: 1;
  }
}
```

**Триггер раскрытия** — `setTopInfo()` (`input.ts:4886-4891`):

```ts
if(!this.chat.container.classList.contains('is-helper-active')) {
  this.chat.container.classList.add('is-helper-active');
  this.helperVisible = true;
  this.notifyChatInputHeight();
  this.t();
}
```

Обратное — `clearHelper()` (`input.ts:4783-4791`): `classList.remove('is-helper-active')` + `t()`.
`t()` (`input.ts:4796-4807`) вешает `is-toggling-helper` на `chat.container` через `SetTransition`
на **150 ms**.

При «центрировании» инпута плашка схлопывается принудительно (`_chat.scss:331-335`):
`.is-centering.forwards .reply-wrapper { height: 0 !important; opacity: 0 !important; pointer-events: none; }`.

### 4.5 Стили `.reply` внутри композера (`_chat.scss:789-830`)

```scss
.reply {
  --border-radius: .5rem;
  order: 1;
  flex: 1 1 auto;
  min-height: 2.5rem;

  &-content { padding-block: .125rem; }

  &-icon, &-cancel { color: rgb(var(--peer-color-rgb, var(--primary-color-rgb))); }
  &-cancel { @include hover() { background-color: rgba(var(--peer-color-rgb, var(--primary-color-rgb)), .08); } }
  &-icon   { order: 0; pointer-events: none; }
  &-cancel { order: 2; }
  &-subtitle {
    color: var(--secondary-text-color) !important;
    height: 1.125rem;
    .formatted-date { color: inherit; }
  }
  .peer-title { font-weight: var(--font-weight); }
}
```

### 4.6 Откуда берётся `--peer-color-rgb`

Инлайн-стиль ставит `setPeerColorToElement()` (`T/components/peerColors.ts:7-62`):

```ts
20 const colorProperty = '--peer-color-rgb';
21 const borderBackgroundProperty = '--peer-border-background';
…
60 element.style.setProperty(colorProperty, peerColorRgbValue);
61 element.style.setProperty(borderBackgroundProperty, peerBorderBackgroundValue);
```

Значение — **не сырой rgb, а ссылка на переменную темы**:

- обычный пир: `var(--peer-${colorIndex}-color-rgb)` (`peerColors.ts:56-57`);
- `messageHighlighting` / `colorAsOut`: `var(--message-empty-primary-color-rgb)` /
  `var(--message-out-primary-color-rgb)` (`peerColors.ts:36-37`);
- collectible-цвет: реальный `"r, g, b"` из `getRgbColorFromTelegramColor(accentColor).join(', ')`
  (`peerColors.ts:46-47`);
- `colorIndex === -1`: свойства **удаляются** через `removeProperty` (`peerColors.ts:51-52`).

Вызовы для reply — **два**:

1. на `.reply` (сам блок) — `wrappers/reply.ts:49-55`, если задан `options.setColorPeerId`;
2. на `.reply-wrapper-content` (родитель, чтобы покрасить иконки) — `input.ts:4877`.

Фолбэк — `T/scss/base.scss:182`: `--peer-color-rgb: var(--primary-color-rgb);`.

Дополнительно рядом вызывается `wrapPeerColorPattern` с `canvasClassName: 'reply-background-canvas'`
(`wrappers/reply.ts:57-65`).

---

## 5. Инпут

### 5.1 Дерево

```
div.input-message-container                                     input.ts:1028
├ div.input-message-input.is-empty.scrollable.scrollable-y.no-scrollbar.forwards
│   [contenteditable="true" data-peer-id="…"
│    style="max-height: 440px; transition-duration: 0ms; height: 37px;"]
├ span.input-field-placeholder.i18n.is-empty "Message"           inputField.ts:650-657
└ div.input-message-input.is-empty.scrollable.scrollable-y.input-field-input-fake
    [contenteditable="true" tabIndex="-1"]                       inputFieldAnimated.ts:37-41
```

Монтаж — `input.ts:2936`:
```ts
this.inputMessageContainer.append(this.messageInputField.input, this.messageInputField.placeholder, this.messageInputField.inputFake);
```
При смене пира — `replaceWith` для всех трёх (`input.ts:2932-2935`).

Классы `input-field-input` → `input-message-input` переименовываются на месте (`input.ts:2916-2917`):
```ts
input.classList.replace('input-field-input', 'input-message-input');
inputFake.classList.replace('input-field-input', 'input-message-input');
```

Классы `scrollable scrollable-y no-scrollbar` приходят от `Scrollable`, `forwards` — от `SetTransition`.

### 5.2 CSS

`.input-message-container` (`_chat.scss:1040-1058`):

```scss
.input-message-container {
  --imc-padding-inline-start: 0px;
  --imc-padding-inline-end: 0px;
  width: 1%;
  max-height: inherit;
  flex: 1 1 auto;
  position: relative;
  overflow: hidden;
  align-self: center;
  min-height: calc(var(--chat-input-height) - var(--padding-vertical) * 2);  /* 48 - 8 = 40px */
  display: flex;
  align-items: center;
  padding-inline: var(--imc-padding-inline-start) var(--imc-padding-inline-end);

  .scrollable { position: relative; }
}
```

`.input-message-input` (`_chat.scss:1060-1085`):

```scss
.input-message-input {
  --custom-emoji-size: var(--messages-custom-emoji-size);
  background: none;
  border: none;
  width: 100%;
  padding: .5rem 0;
  overflow-y: none;
  resize: none;
  outline: none;
  font-size: var(--messages-text-size);
  line-height: var(--line-height);

  pre { display: inline; margin: 0; }
  .formatted-date { cursor: text; }

  @include animation-level(2) {
    transition: height $input-half-transition-time;   /* .1s */
  }
}
```

**Важно:** SCSS задаёт `transition: height .1s`, но JS перебивает длительность инлайном
(`transition-duration`), см. §5.4.

Есть также inline-плейсхолдер по data-атрибуту (`_chat.scss:844-848`):
```scss
.input-message-input[data-inline-placeholder]:after {
  content: attr(data-inline-placeholder);
  color: var(--input-message-placeholder-color);
  pointer-events: none;
}
```

### 5.3 Плейсхолдер

Создание (`inputField.ts:650-657`):
```ts
if(placeholder) {
  this.placeholder = document.createElement('span');
  this.placeholder.classList.add('input-field-placeholder');
  this.container.append(this.placeholder);
  _i18n(this.placeholder, placeholder, undefined);
}
```

Это **сиблинг** инпута, всегда в DOM. Класс `is-empty` вешается **и на инпут, и на плейсхолдер**
одновременно (`inputField.ts:776-780`):

```ts
private setEmpty = (empty = this.isEmpty()) => {
  [this.input, this.placeholder].filter(Boolean).forEach((el) => {
    el.classList.toggle('is-empty', empty);
  });
};
```

CSS (`T/scss/partials/_input.scss:230-252`):

```scss
&-placeholder {
  color: var(--input-placeholder-color);
  display: block;
  pointer-events: none;
  position: absolute;
  opacity: 0;
  max-width: 100%;
  padding-inline-end: 0.5rem;
  inset-inline-start: var(--padding-horizontal);
  z-index: 1;
  @include text-overflow(true);

  @include animation-level(2) {
    transform: translateX(calc(1rem * var(--reflect)));
    transition: opacity var(--input-placeholder-transition) .01s,
                transform var(--input-placeholder-transition) .01s;
  }

  &.is-empty {
    opacity: 1;
    @include animation-level(2) { transform: translateX(0); }
  }
}
```

Переопределение для чата (`_chat.scss:835-837`): `.input-field-placeholder { inset-inline-start: unset; }`.

> Значение `--input-placeholder-transition` в прочитанных файлах **не найдено** — искать
> отдельно перед реализацией.

### 5.4 Фейковый инпут и расчёт высоты

Создание (`T/components/inputFieldAnimated.ts:37-41`):

```ts
this.inputFake = document.createElement('div');
this.inputFake.contentEditable = 'true';
this.inputFake.tabIndex = -1;
this.inputFake.className = this.input.className + ' input-field-input-fake';
```

Класс-лист = **полный класс-лист реального инпута** плюс `input-field-input-fake`.

CSS (`T/scss/partials/_input.scss:210-224`):

```scss
&-input-fake {
  opacity: 0;
  pointer-events: none;
  position: absolute !important;
  top: 0;
  bottom: auto !important;
  inset-inline: var(--imc-padding-inline-start) var(--imc-padding-inline-end) !important;
  width: auto !important;
  height: auto !important;
  z-index: -3;
}
```

**Зачем нужен:** реальный инпут имеет фиксированную `height`, поэтому его `scrollHeight`
не показывает «сколько нужно». Фейк содержит тот же HTML (`updateInnerHTML()`,
`inputFieldAnimated.ts:100-110`), но `height: auto` — его `scrollHeight` и есть целевая высота.

Расчёт (`inputFieldAnimated.ts:51-98`):

```ts
51 public onFakeInput(setHeight = true, noAnimation?: boolean) {
52   const {scrollHeight} = this.inputFake;
53   const newHeight = this.maxHeight !== undefined ? Math.min(scrollHeight, this.maxHeight) : scrollHeight;
54
55   noAnimation ??= !this.input.isContentEditable;
56
57   const currentHeight = +this.input.style.height.replace('px', '');
58   if(currentHeight === newHeight) return;
59
62   const TRANSITION_DURATION_FACTOR = 50;
63   const transitionDuration = noAnimation ? 0 : Math.round(
64     TRANSITION_DURATION_FACTOR * Math.log(Math.abs(newHeight - currentHeight))
65   );
68   this.input.style.transitionDuration = `${transitionDuration}ms`;
70   if(setHeight) {
71     this.onChangeHeight?.(newHeight);
72     this.input.style.height = newHeight ? newHeight + 'px' : '';
73     (this.input as any).oldHeight = (this.input as any).newHeight;
74     (this.input as any).newHeight = newHeight;
76     Array.from(this.input.querySelectorAll('.quote-like')).forEach((element) => {
82       const lines = (scrollHeight - paddingTop - paddingBottom) / lineHeight;
83       element.classList.toggle('can-send-collapsed', lines > 3);
84     });
85   }
87   const className = 'is-changing-height';
88   SetTransition({element: this.input, className, forwards: true, duration: transitionDuration, …});
```

**Формула длительности:** `duration = round(50 * ln(|newHeight − currentHeight|))` мс.
Примеры: дельта 21px (одна строка) → `round(50 * 3.045)` = **152 ms**; дельта 42px → 187 ms;
дельта 400px → 300 ms. При `noAnimation` (по умолчанию `!input.isContentEditable`) → `0`.

**Max-height** — считается в `input.ts:2876-2899`:

```ts
2880 private static MESSAGE_INPUT_MAX_HEIGHT_DEFAULT = 440;  // 27.5rem
2881 private static MESSAGE_INPUT_MAX_HEIGHT_MOBILE = 160;   // 10rem
2882 private static MESSAGE_INPUT_MAX_HEIGHT_MIN = 36;
2883 private static SHORT_VIEWPORT_HEIGHT = 480;             // 30rem
2884 private static SHORT_VIEWPORT_RESERVED = 160;           // 10rem
2885
2886 private computeMessageInputMaxHeight() {
2887   if(mediaSizes.isMobile) return ChatInput.MESSAGE_INPUT_MAX_HEIGHT_MOBILE;
2888   if(windowSize.height <= ChatInput.SHORT_VIEWPORT_HEIGHT) {
2891     const available = windowSize.height - 2 * 16 - ChatInput.SHORT_VIEWPORT_RESERVED;
2892     return Math.max(ChatInput.MESSAGE_INPUT_MAX_HEIGHT_MIN, available);
2893   }
2894   return ChatInput.MESSAGE_INPUT_MAX_HEIGHT_DEFAULT;
2895 }
```

Ставится как inline `style.maxHeight = value + 'px'` через `setMaxHeight`
(`inputFieldAnimated.ts:44-49`), пересчитывается на `mediaSizes` `resize` (`input.ts:2924`).

**Публикация высоты наверх** (`input.ts:2870-2873`, `2909-2913`):

```ts
2870 private notifyChatInputHeight() {
2871   const helperPx = this.helperVisible ? 48 : 0;
2872   this.chat.updateChatInputHeight(this.inputHeightDelta + helperPx);
2873 }
2909 const DEFAULT_INPUT_HEIGHT = 37;
2910 this.messageInputField.onChangeHeight = (newHeight) => {
2911   this.inputHeightDelta = Math.max(0, newHeight - DEFAULT_INPUT_HEIGHT);
2912   this.notifyChatInputHeight();
2913 };
```

Базовая высота одной строки = **37px** (в дампе inline `height: 37px` подтверждается).

---

## 6. Панель записи голоса и кружка

### 6.1 Дерево панели голоса

Строится целиком в конструкторе `VoiceRecordingPanel`
(`T/components/chat/voiceRecording/voiceRecordingPanel.ts:60-122`).
**Условных узлов нет вообще** — всё создаётся один раз, переключение только через CSS `display`.

```
div.voice-recording-panel[.voice-recording-panel--recording | --paused][.--playing]   :61-62
├ button.btn-icon.voice-recording-cancel.danger.rp                                     :64
│ ├ div.c-ripple
│ └ span.tgico.voice-recording-cancel-icon               (иконка 'delete')             :65
├ div.voice-recording-pill                                                             :91-93
│ ├ div.voice-recording-lead                                                           :67-68
│ │ ├ div.voice-recording-dot                                                          :70-71
│ │ └ button.btn-icon.voice-recording-play.rp                                          :73
│ │   ├ div.c-ripple
│ │   ├ span.tgico.voice-recording-play-icon.voice-recording-play-icon--play           :74
│ │   └ span.tgico.voice-recording-play-icon.voice-recording-play-icon--pause          :75
│ ├ canvas.voice-recording-waveform                       (LiveWaveform)  liveWaveform.ts:47-48
│ └ span.voice-recording-timer  "0:00,0"                                               :82-84
└ button.btn-icon.voice-recording-pause-toggle.rp                                       :86
  ├ div.c-ripple
  ├ span.tgico.voice-recording-pause-icon.voice-recording-pause-icon--pause             :87
  └ span.tgico.voice-recording-pause-icon.voice-recording-pause-icon--mic               :88
```

Порядок append: `leadEl.append(dot, btnPlayToggle)` (`:78`),
`pillEl.append(lead, waveform.element, timer)` (`:93`),
`element.append(btnCancel, pill, btnPauseToggle)` (`:95-99`).

Монтаж — **перед** `btn-send-container` внутри `new-message-wrapper`:
```ts
this.input.newMessageWrapper.insertBefore(this.voiceRecordingPanel.element, this.input.btnSendContainer);
```
(`chatRecording.ts:112`; подтверждение комментарием `input.ts:1375-1378`).

### 6.2 Классы-состояния

| Класс | Ставится | Что делает |
|---|---|---|
| `voice-recording-panel--recording` | `voiceRecordingPanel.ts:127` `toggle(…, mode === 'recording')` | **Правил в SCSS нет** — маркер для JS |
| `voice-recording-panel--paused` | `voiceRecordingPanel.ts:126` | `_voiceRecordingPanel.scss:24-37`: `.voice-recording-dot { display: none }`, `.voice-recording-play { display: flex }`, `--pause`-иконка правой кнопки `display: none`, `--mic` `display: inline-flex` |
| `voice-recording-panel--playing` | `voiceRecordingPanel.ts:140` `setPlaying()` | `_voiceRecordingPanel.scss:39-46`: `--play` скрыт, `--pause` показан |

`setMode('recording')` дополнительно вызывает `setPlaying(false)` и `waveform.setProgress(undefined)`
(`voiceRecordingPanel.ts:128-131`). Первичный вызов — в конце конструктора (`:121`).
Кто зовёт `setMode`: `chatRecording.ts:253, 361, 380, 403, 418, 987, 1117`.

### 6.3 Стили панели (`_voiceRecordingPanel.scss`, полностью значимое)

```scss
.voice-recording-panel {
  position: absolute;
  inset: 0;
  inset-inline-end: calc(var(--chat-input-height) + .5rem);   /* вырез под кнопку send */
  display: flex;
  align-items: center;
  gap: .25rem;
  padding: 0;
  padding-inline-start: inherit;
  padding-inline-end: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity .15s ease, visibility 0s linear .15s;
  background-color: var(--surface-color);
  border-radius: inherit;
  z-index: 2;
}

.voice-recording-cancel        { flex: 0 0 auto; font-size: 1.5rem; width: 2.5rem; height: 2.5rem; }
.voice-recording-pill          { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px;
                                 background-color: var(--light-primary-color); border-radius: 24px;
                                 padding-block: 6px; padding-inline-start: .5rem; padding-inline-end: .75rem; }
.voice-recording-lead          { flex: 0 0 auto; position: relative; display: flex; align-items: center; justify-content: center; }
.voice-recording-dot           { width: 10px; height: 10px; background-color: var(--danger-color);
                                 border-radius: 50%; margin-inline: .4375rem;
                                 @include animation-level(2) { animation: recordBlink 1.25s infinite; } }
.voice-recording-play          { width: 24px !important; height: 24px !important; border-radius: 50%;
                                 background-color: var(--primary-color); color: #fff !important;
                                 display: none; align-items: center; justify-content: center;
                                 font-size: 1rem !important; padding: 0;
                                 @include hover() { background-color: var(--dark-primary-color); } }
.voice-recording-waveform      { flex: 1 1 auto; min-width: 0; height: 1.75rem; display: block; }
.voice-recording-timer         { flex: 0 0 auto; font-variant-numeric: tabular-nums;
                                 color: var(--primary-text-color); font-size: .875rem; line-height: 1;
                                 min-width: 3rem; text-align: end; user-select: none; }
.voice-recording-pause-toggle  { flex: 0 0 auto; font-size: 1.5rem; width: 2.5rem; height: 2.5rem; position: relative; }

.chat-input.is-recording {
  .voice-recording-panel {
    opacity: 1; visibility: visible; pointer-events: auto;
    transition: opacity .15s ease, visibility 0s linear 0s;
  }
  /* .is-locked глушит все .btn-icon — возвращаем интерактивность трём кнопкам панели */
  .voice-recording-cancel, .voice-recording-play, .voice-recording-pause-toggle {
    opacity: 1 !important; pointer-events: auto;
  }
}
```

### 6.4 `recordBlink`

Keyframes — `T/scss/partials/_chat.scss:395-407`:

```scss
@keyframes recordBlink {
  0%   { opacity: 1;  }
  50%  { opacity: .2; }
  100% { opacity: 1;  }
}
```

Применение — `_voiceRecordingPanel.scss:94-96`: `animation: recordBlink 1.25s infinite;`
на `.voice-recording-dot`, внутри `@include animation-level(2)` (селектор `body.animation-level-2 &`,
`T/scss/mixins/_animationLevel.scss:1-6`).

**Easing не задан → браузерный дефолт `ease`.** Дамп показывает `linear` (та же особенность
DevTools, что и с `grow-icon`). Брать из SCSS: длительность **1250 ms**, `infinite`.

### 6.5 Канвас волны (`liveWaveform.ts`)

Константы (`:7-10`): `BAR_WIDTH = 3`, `BAR_GAP = 3`, `BAR_RADIUS = 1.5`, `MIN_BAR_HEIGHT = 3` (CSS-px).

**Размеры.** `new LiveWaveform()` вызывается без опций (`voiceRecordingPanel.ts:80`), реальный
размер берётся замером `getBoundingClientRect()` в `measureAndResize()` (`:79-94`).
CSS даёт `flex: 1 1 auto; height: 1.75rem` = 28px. `dpr = window.devicePixelRatio || 1` (`:85`),
буфер `element.width = round(cssWidth * dpr)`, `element.height = round(cssHeight * dpr)` (`:86-87`),
в `draw()` — `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` (`:162`). Пересчёт — `ResizeObserver`
на самом канвасе (`:56-60`).

**Количество баров:** `capacity = max(1, floor((cssWidth + BAR_GAP) / (BAR_WIDTH + BAR_GAP)))`
= `floor((w + 3) / 6)` (`:88`). Лишние старые пики срезаются (`:91-93`, `:101-103`).

**Отрисовка** (`draw()`, `:156-205`):

- `stride = BAR_WIDTH + BAR_GAP` = 6 (`:167`); `totalWidth = peaks.length * stride − BAR_GAP` (`:168`);
- `startX = max(0, w − totalWidth)` — **бары прижаты к правому краю**, живая запись растёт справа (`:170`);
- цвет: `getComputedStyle(canvas).getPropertyValue('--primary-color').trim() || computed.color` (`:173-175`);
- «непроигранные» бары — `globalAlpha = 0.3` (`:193`). Опция `inactiveColorVar` (`--secondary-color`,
  `:51`) объявлена, но в `draw()` **не используется**;
- высота бара: `max(3, min(h, peak * h))`, центрируется по `midY = h / 2` (`:190-191`);
- форма: `ctx.roundRect(x, y, 3, barH, 1.5)` + `fill()`, фолбэк `fillRect` (`:195-201`).

**Источник амплитуд:**

- голос — `LiveWaveformAnalyser` на `recorder.sourceNode`, `onpeak → panel.pushPeak(peak)`
  (`chatRecording.ts:1029-1032`);
- кружок — тот же анализатор на **клоне** аудиотрека (`chatRecording.ts:1180-1204`);
- анализатор — `ScriptProcessorNode` с буфером **2048** сэмплов (~43 ms при 48 кГц), пик =
  `max(|sample|)` по буферу (`T/helpers/voiceRecorder/liveWaveformAnalyser.ts:7, 20-39`).
  То есть **~23 пика/сек**, один пик = один бар;
- нормализация в `pushPeak` (`liveWaveform.ts:96-105`): `maxPeak` — пожизненный максимум
  (стартово `0.05`), `normalized = min(1, value / max(maxPeak, 0.02))`;
- на паузе буфер заменяется целиком `setPeaks()` (`:109-133`): даунсемплинг «max в бакете»
  до `capacity` + перенормировка на локальный максимум.

**Частота обновления:** не таймер и не постоянный rAF-цикл — `scheduleDraw()` с флагом
`rafScheduled` коалесцирует все вызовы в **один** `requestAnimationFrame` (`:147-154`).

**Seek:** клик по канвасу → `progress = clamp(x / rect.width)` → `onSeek` (`:65-72`),
активен только при `setSeekable(true)`, который добавляет `cursor: pointer` (`:74-77`).

### 6.6 Таймер

- узел `span.voice-recording-timer`, начальный текст **`'0:00,0'`** (`voiceRecordingPanel.ts:84`);
- рантайм-формат — `formatRecordingTimer` (`chatRecording.ts:741-745`):
  ```ts
  return toHHMMSS(seconds) + ',' + ('00' + Math.round(ms / 10)).slice(-2);
  ```
  то есть `M:SS,CC` с **двумя** знаками сотых (`0:03,47`); часы добавляются только при наличии.
  Стартовая статическая строка `'0:00,0'` формату не соответствует — живёт до первого тика;
- частота — **покадрово**, цикл `startRecordingTimerLoop()` через `fastRaf`
  (`chatRecording.ts:748-761`); цикл сам себя не перепланирует при `!active || recordPaused` (`:751`);
- для кружка — отдельный цикл `startVideoRecordingTimerLoop()` (`chatRecording.ts:571-586`),
  он же двигает progress ring и на **60 000 ms** вызывает `reachVideoLimit()`;
- `setTimer` пишет в DOM только при изменении строки (`voiceRecordingPanel.ts:156`).

### 6.7 Кнопки панели

Все три — `attachClickEvent` с общим `ListenerSetter`, `preventDefault` + `stopPropagation`
(`voiceRecordingPanel.ts:101-117`).

| Кнопка | Обработчик | Что делает |
|---|---|---|
| `.voice-recording-cancel` | `onCancel` → `chatRecording.onCancelRecordClick` (`:103`, реализация `:317-329`) | `recordCanceled = true`, `stopPlayback()`, `stopVideoPlayback()`, `getActiveRecorder()?.stop()`, для голоса `opusDecodeController.setKeepAlive(false)` |
| `.voice-recording-play` | `onPlayToggle` → `onPlayToggleClick` (`:426-439`) | только при `active && recordPaused`; для видео → `onVideoPlayToggleClick()`; иначе pause/resume `playbackAudio`, либо `startPlaybackFromSnapshot()` (декод opus-снапшота, `:663-676`) |
| `.voice-recording-pause-toggle` | `onPauseToggle` → `onPauseToggleClick` (`:343-384`) | **resume**: `stopPlayback()`, `recorder.resume()`, `recordStartTime = Date.now()`, `setMode('recording')`, `setSeekable(false)`, `startRecordingTimerLoop()`. **pause**: `recordAccumulatedMs += Date.now() − recordStartTime`, `setPeaks(analyser.getCurrentPeaks())`, `setMode('paused')`, `setPlaybackProgress(undefined)`, `setSeekable(true)`, `recorder.pause()` |

Клик по волне → `onSeek` → `onPlaybackSeek` (`chatRecording.ts:644-661`).

### 6.8 Панель записи кружка

`T/components/chat/recording/videoRecordingPanel.tsx` (Solid). Дерево (`:33-64`), все узлы безусловны:

```
div.video-recording-stage[.--recording | .--paused][.--playing]         :36-41
└ div.video-recording-circle  [style="width:360px; height:360px"]        :43-46
  ├ video.video-recording-preview  (muted, autoplay, playsInline)        :47-55
  └ svg.progress-ring.video-recording-progress-ring                      :56-61
    └ circle.progress-ring__circle
```

`STAGE_SIZE = 360` (`:19`), инлайн-стиль на `.video-recording-circle` (`:45`);
`ProgressRing size={360} strokeOpacity={0.9}` (`:56-60`), внутри `strokeWidth = 3.5`,
радиус `size/2 − strokeWidth*2`, `transform: rotate(-90deg)` (`T/components/progressRing.tsx:27-33, 42-56`).

Монтаж — **в `<body>`**: `getOverlayRoot().append(this.videoRecordingPanel.element)`
(`chatRecording.ts:123`).

CSS — `T/scss/partials/_videoRecordingPanel.scss` целиком:

```scss
.video-recording-stage {
  position: fixed;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity .2s ease, visibility 0s linear .2s;

  &--recording, &--paused {
    opacity: 1;
    visibility: visible;
    transition: opacity .2s ease, visibility 0s linear 0s;
  }
}

.video-recording-circle {
  position: relative;
  border-radius: 50%;
  overflow: hidden;
  background-color: #000;
  box-shadow: 0 8px 40px rgba(0, 0, 0, .6), 0 0 0 1px rgba(255, 255, 255, .04);
  max-width: 90vw;
  max-height: 70vh;
  pointer-events: auto;
}

.video-recording-preview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);              /* фронталка зеркалится */
}

.video-recording-stage--playing .video-recording-preview {
  transform: none;                    /* превью проигрывается как снято */
}

.video-recording-progress-ring {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
```

**У кружка нет собственных кнопок** — корзина, волна, таймер, пауза и отправка остаются в
`VoiceRecordingPanel` + `.btn-send` (комментарий `videoRecordingPanel.tsx:6-9`).
Рекордер: 400×400 @30fps, 1.2 Мбит/с видео + 64 кбит/с аудио (`chatRecording.ts:310-314`),
лимит `VIDEO_RECORD_MAX_MS = 60_000` (`chatRecording.ts:46`).

### 6.9 Прочие эффекты записи

- `blurActiveElement()` при старте (`chatRecording.ts:947` / `1074`);
- пуш `NavigationItem` типа `'voice'` с popup-подтверждением на «назад» (`chatRecording.ts:1016-1025`);
- `mousedown`-guard в capture-фазе на `document.body`: клик вне `.chat-input` показывает
  `PopupPeer 'popup-cancel-record'` (`chatRecording.ts:1006-1012`); для кружка исключение —
  клик по `.video-recording-stage` не считается «снаружи» (`chatRecording.ts:1154`).

---

## 7. Хелперы автокомплита

### 7.1 Базовое дерево и место в DOM

Базовый класс создаёт **только** контейнер (`T/components/chat/autocompleteHelper.ts:50-53`):

```ts
this.container = document.createElement('div');
this.container.classList.add('autocomplete-helper', 'z-depth-1');
options.appendTo.append(this.container);
```

Внутренности создаёт каждый наследник в своём `init()`. Общего класса `.autocomplete-helper-list`
**не найдено** — у каждого хелпера свой.

`.scrollable` появляется не вручную, а через `new Scrollable(container)` / `new ScrollableX(container)`:
`ScrollableBase` создаёт `div.scrollable`, **переносит в него всех уже существующих детей** и
аппендит в `el` (`T/components/scrollable.ts:104-112`); `Scrollable` добавляет `scrollable-y`
(`:410`), `ScrollableX` — `scrollable-x` (`:464`).

**Физическое место** — все хелперы получают `this.rowsWrapper` (`input.ts:1287-1297`):

```ts
1286 if(this.replyElements?.container) this.rowsWrapper.append(this.replyElements.container);
1287 this.autocompleteHelperController = new AutocompleteHelperController();
1288 this.stickersHelper = new StickersHelper(this.rowsWrapper, …);
1289 this.emojiHelper   = new EmojiHelper(this.rowsWrapper, …);
1292 this.emojiHelper.addSibling(this.stickersHelper);
1293 this.emojiHelper.attachStickersHelper(this.stickersHelper);
1294 if(!this.excludeParts.commandsHelper) this.commandsHelper = new CommandsHelper(this.rowsWrapper, …);
1295 this.mentionsHelper = new MentionsHelper(this.rowsWrapper, …);
1296 this.inlineHelper   = new InlineHelper(this.rowsWrapper, …);
1297 this.rowsWrapper.append(this.newMessageWrapper);
```

**Итоговый порядок детей `.rows-wrapper`:**
`replyKeyboard` (`input.ts:912-921`, вызов `1048`) → `bot-commands` (`input.ts:927`, вызов `1052`)
→ `reply-wrapper` → `stickers-helper` → `emoji-helper` → `commands-helper` → `mentions-helper`
→ `inline-helper` → `new-message-wrapper`.

Порядок важен: emoji-helper идёт **после** stickers-helper в DOM и потому перекрывает его
(комментарий `emojiHelper.ts:165-167`).

Позиционирование работает потому, что `.chat-input-wrapper` имеет `position: relative`
(`_chat.scss:556`).

### 7.2 Показ / скрытие

Класс — **`is-visible`** (+ служебные `forwards` / `backwards` / `animating`).
Класса `.hide` или `.active` на контейнере хелпера **нет**.

```ts
127 // определение текущего состояния
this.container.classList.contains('is-visible') && !this.container.classList.contains('backwards')
…
179 SetTransition({
      element: this.container,
      className: 'is-visible',
      forwards: !hide,
      duration: liteMode.isAvailable('animations') && !skipAnimation ? 300 : 0,
      useRafs: this.controller || hide ? 0 : 2
    });
```
(`autocompleteHelper.ts:125-189`; `useRafs` — `:173`.)

События: `visible` (`:144`, `:159`), `hiding` (`:176`), `hidden` (`:185`).
Каскад: при показе прячутся все остальные хелперы, кроме self + siblings
(`autocompleteHelper.ts:152-158` → `autocompleteHelperController.ts:37-47`).

SCSS (`T/scss/partials/_autocompleteHelper.scss:20-43`):

```scss
&:not(.is-visible) { display: none; }
&.is-visible { visibility: hidden; }

@include animation-level(2) {
  &.is-visible {
    animation: fade-out-opacity .2s ease-in-out forwards;
    transition: visibility 0s .2s;
  }
}

.chat-input:not(.is-selecting) &.is-visible.forwards,
#stories-viewer &.is-visible.forwards {
  visibility: visible;
  @include animation-level(2) {
    animation-name: fade-in-opacity;
    transition: visibility 0s 0s;
  }
}
```

Keyframes `fade-in-opacity` / `fade-out-opacity` — `T/scss/base.scss:685-703` (чистый opacity 0↔1).

> **Расхождение, которое надо перенести как есть:** CSS-анимация **0.2s**, а JS-таймаут
> `SetTransition` — **300 ms**.

Базовые стили контейнера (`_autocompleteHelper.scss:3-19`, `:45-47`):

```scss
.autocomplete-helper {
  --border-radius: 16px;                  /* $border-radius-medium */
  position: absolute !important;
  bottom: calc(100% + .5rem);
  inset-inline-start: 0;
  overflow: hidden;
  padding: 0 !important;
  border-radius: var(--border-radius) !important;
  max-width: 100%;
  width: auto !important;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--surface-color);
  color: var(--primary-text-color);

  @media (max-width: 319px) { max-width: calc(100vw - var(--padding-horizontal) * 4); }
}
```

Тень — от `z-depth-1` (`T/scss/components/_global.scss:57-61`):
`box-shadow: 0 2px 2px 0 rgba(0,0,0,.14), 0 3px 1px -2px rgba(0,0,0,.12), 0 1px 5px 0 rgba(0,0,0,.2);`

`toggleListNavigation(enabled)` — `autocompleteHelper.ts:70-76`, контроллер прогоняет по всем
хелперам (`autocompleteHelperController.ts:17-21`), вызов на смене чата — `input.ts:1596-1598`.

### 7.3 Клавиатурная навигация

Файл — `T/helpers/dom/attachListNavigation.ts` (функция, не класс; «ListLoader» **не найден**).

- активный класс — **`active`** (`ACTIVE_CLASS_NAME = 'active'`, `:9`), применяется в
  `setCurrentTarget` (`:55`, `:60`);
- событие — `keydown` на `document` в **capture-фазе** (`:8`, `:166`, `:176`);
- клавиши: `ArrowUp/ArrowDown` для типа `y`, `ArrowLeft/ArrowRight` для `x`, все четыре для `xy`
  (`:11-12`, `:41`); `Enter` — выбор; `Tab` — выбор только для `x`/`y` (`:112-115`);
- мышь: `mousemove` подсвечивает (`:132-139`), клик выбирает (`:141-151`), через
  `findUpAsChild(e.target, list)`;
- списку добавляется класс `navigable-list` (`:130`); стиль активного —
  `T/scss/base.scss:1406-1411`: `.navigable-list .active { background-color: var(--light-secondary-text-color); border-radius: inherit; }`;
- скролл к активному: `fastSmoothScroll` с `position: 'center'`, `forceDuration: 100` (`:62-70`);
- `waitForKey` — режим «ждать первого нажатия стрелки» (`:188-201`).

Подключение из хелпера — `AutocompleteHelper.onVisible` (`autocompleteHelper.ts:78-119`,
`once: true`); на `hidden` — `list.replaceChildren()` + `detach()` (`:106-118`).

**Типы навигации:**

| Хелпер | `listType` | `waitForKey` | Источник |
|---|---|---|---|
| mentions / commands / bot-commands | `'y'` | — | `autocompletePeerHelper.ts:24` |
| emoji | `'x'` | динамически в `render()` | `emojiHelper.ts:32`, `:141` |
| stickers | `'xy'` | `['ArrowUp','ArrowDown']` | `stickersHelper.ts:29`, `:33` |
| inline | `'xy'` | `['ArrowUp','ArrowDown']` | `inlineHelper.ts:50-51` |

### 7.4 Специфика каждого хелпера

#### `AutocompletePeerHelper` (база для mentions / commands / bot-commands)

`T/components/chat/autocompletePeerHelper.ts`:
`BASE_CLASS = 'autocomplete-peer-helper'` (`:11`),
`BASE_CLASS_LIST_ELEMENT = 'autocomplete-peer-helper-list-element'` (`:12`).
`init()` (`:31-44`): `div.autocomplete-peer-helper-list.<className>-list` → append → `new Scrollable(container)`.

```
div.autocomplete-helper.z-depth-1.autocomplete-peer-helper.<className>
└ div.scrollable.scrollable-y
  └ div.autocomplete-peer-helper-list.<className>-list.navigable-list
    └ div.autocomplete-peer-helper-list-element.<className>-list-element [data-peer-id]   :90-92
      ├ <avatar 30px>.autocomplete-peer-helper-list-element-avatar.<className>-…-avatar   :94-100
      ├ div.autocomplete-peer-helper-list-element-name.<className>-…-name                 :102-113
      └ div.autocomplete-peer-helper-list-element-description.<className>-…-description   :117-122 (опц.)
```

SCSS (`_autocompletePeerHelper.scss`):
`.scrollable { position: relative; max-height: 232px; }` (`:4-7`);
`&-list { padding: .5rem 0; }` (`:10`);
`&-list-element { height: 3.125rem; display: flex; padding-inline: .75rem 2.125rem; align-items: center; cursor: pointer; position: relative; }` (`:12-21`), на handhelds `padding-right: .75rem` (`:23-25`);
`-name { margin-inline-start: .875rem; font-weight: var(--font-weight-bold); }` (`:29-34`);
`-description { margin-inline-start: .5625rem; color: var(--secondary-text-color); }` (`:36-40`).

- **MentionsHelper**: `className = 'mentions-helper'` (`mentionsHelper.ts:18`),
  `description = '@' + usernames[0]` (`:59`). Отдельного SCSS **не найдено**
  (в `_autocompletePeerHelper.scss:54-56` есть только закомментированное `width: 320px !important`).
- **CommandsHelper**: `className = 'commands-helper'` (`commandsHelper.ts:16`).
  Отдельного SCSS **не найдено**.
- **ChatBotCommands**: `CLASS_NAME = 'bot-commands'` (`botCommands.ts:8, 17`), контроллер
  **не передаётся** (`:17` → `undefined`), поэтому он не участвует в каскаде `hideOtherHelpers`.
  Высота задаётся из JS: `height = filtered.length * 50 + 8 + 24`, пишется как `--height` (`:38-42`).

  SCSS (`_chatBotCommands.scss:4-81`) почти полностью переопределяет базу:
  `--offset: .5rem`; `bottom: calc(100% - var(--chat-input-height) / 2)`;
  `right/left: calc(var(--offset) * -1)`; `max-height: 20rem`;
  `border-radius: 24px 24px 0 0 !important`; `background-color: transparent !important`;
  `box-shadow: none` (гасит `z-depth-1`); `pointer-events: none`; `padding: .5rem .5rem 0 !important`;
  `animation: none !important; visibility: visible !important; transition: none !important`.
  Внутренний `.scrollable` (`:27-40`) получает `background-color: var(--surface-color)`,
  `box-shadow: 0px 1px 8px 1px rgb(0 0 0 / 12%)`, `max-height: 207px !important`, `pointer-events: all`;
  стартовое состояние при animation-level 2 — `opacity: 0; transform: translateY(var(--height))`.
  **Анимация появления — слайд снизу вверх** (`:42-55`), а не fade:
  `transition: transform var(--transition-standard-in), opacity var(--transition-standard-in)`
  (= `.3s cubic-bezier(.4,0,.2,1)`).

#### `EmojiHelper`

`emojiHelper.ts:39` — `container.classList.add('emoji-helper')`;
`init()` (`:42-55`): `div.emoji-helper-emojis.super-emojis` → append → `new ScrollableX(container)`.

```
div.autocomplete-helper.z-depth-1.emoji-helper
└ div.scrollable.scrollable-x
  └ div.emoji-helper-emojis.super-emojis
    ├ (custom-emoji-renderer)                            prepend, :93
    └ span (innerList, :60-61) .navigable-list           getNavigationList → innerList (:36)
      ├ span.super-emoji.super-emoji-custom              emoticonsDropdown/tabs/emoji.ts:54
      └ span.super-emoji.super-emoji-regular             emoticonsDropdown/tabs/emoji.ts:64
```

Размер рендерера кастом-эмодзи: `width = emojis.length * 42 + 8`, `height = 42` (`:95-98`),
лимит 80 эмодзи (`:132`).

SCSS (`_chatEmojiHelper.scss`): `.emoji-helper { height: 50px; padding: .25rem 0 !important; }` (`:4-5`);
`> .scrollable { position: relative; width: auto; }` (`:8-11`);
`.super-emojis { display: block; white-space: nowrap; }` + `:before/:after` шириной `.25rem` (`:13-27`);
`.super-emoji.active { background-color: var(--primary-color) !important; border-radius: var(--border-radius); }`
(`:39-42`) — **переопределяет** общий `.navigable-list .active`.
База `.super-emoji` — `T/scss/base.scss:1439-1448`: `padding: .25rem; border-radius: 12px;
width/height: var(--esg-emoji-total-size)` (`= 2.125rem + .5rem`, `base.scss:1413-1424`).

#### `StickersHelper`

`stickersHelper.ts:36` — `container.classList.add('stickers-helper')`;
`init()` (`:129-136`): `div.stickers-helper-stickers.super-stickers` → `new Scrollable(container)`.

```
div.autocomplete-helper.z-depth-1.stickers-helper
└ div.scrollable.scrollable-y
  └ div.stickers-helper-stickers.super-stickers.navigable-list
    └ div.grid-item.super-sticker                    SuperStickerRenderer.ts:62
```

Ширина списка считается в JS (`:112-113`):
`(childElementCount * mediaSizes.active.esgSticker.width) + (childElementCount − 1 * 1)`.

SCSS (`_chatStickersHelper.scss:4-22`):
`.stickers-helper > .scrollable { position: relative; max-height: 13.75rem; min-height: var(--esg-sticker-size); padding: .4375rem; }`;
`--esg-sticker-size: 72px` (`base.scss:116`), на узких — `68px` (`base.scss:213`);
`.super-stickers` — grid `repeat(auto-fill, var(--esg-sticker-size))`, `justify-content: space-between`
(`base.scss:994-1000`).

#### `InlineHelper`

`inlineHelper.ts:67` — `container.classList.add('inline-helper')`;
`init()` (`:321-338`): `div.inline-helper-results` → append → `new Scrollable(container)` →
затем **после** `.scrollable` добавляется `span.inline-helper-cant-send` (`:335-337`).

```
div.autocomplete-helper.z-depth-1.inline-helper[.is-gallery][.cant-send]
├ div.scrollable.scrollable-y
│ ├ (button.btn-primary.btn-secondary.btn-primary-transparent.primary)   switch_pm/switch_webview, :274-290
│ └ div.inline-helper-results[.is-gallery][.super-stickers].navigable-list
│     [data-peer-id][data-bot-id][data-query-id]                          :132-134
│   ├ (списочный режим) div.inline-helper-result [data-result-id]         :145-181
│   │ ├ div.inline-helper-result-preview[.empty]
│   │ ├ div.inline-helper-result-title
│   │ └ div.inline-helper-result-description
│   ├ div.inline-helper-separator
│   └ (галерея) div.inline-helper-result.grid-item[.no-border-radius][.super-sticker]  :180, :195, :232
└ span.inline-helper-cant-send                                            :335-337
```

`.cant-send` ставится при запрете inline (`:114`), снимается при успешном рендере (`:293`).
Ширина в галерее — JS (`:302-303`).
`checkQuery` — debounce **200 ms** (`:75`).

SCSS (`_chatInlineHelper.scss`):
`.inline-helper:not(.is-gallery) { min-width: min(20rem, 100%); }` (`:7-9`);
`.scrollable { position: relative; max-height: 232px; }` (`:11-14`);
`&-separator { height: 1px; width: 100%; margin-left: 4rem; background-color: var(--border-color); }` (`:16-25`);
списочный режим: `-result { height: 4rem; padding: .5rem .5rem .5rem 4rem; }`,
`-preview { position: absolute; left: .5rem; width/height: 3rem !important; }`,
`&.empty { color: #fff; text-transform: uppercase; font-size: 1.75rem; background-color: var(--primary-color); border-radius: .375rem; }` (`:32-61`);
галерея: `grid-template-columns: repeat(auto-fill, minmax(var(--esg-sticker-size), 1fr)); grid-gap: 1px;` (`:86-99`);
`-description { font-size: .875rem; color: var(--secondary-text-color); -webkit-line-clamp: 2; white-space: pre-wrap; }` (`:101-121`);
`&.cant-send { width: 100% !important; height: 3rem; .scrollable-y { display: none } .inline-helper-cant-send { display: block } }` (`:129-140`).

---

## 8. Эмодзи-дропдаун

### 8.1 Дерево (из `D/04-emoji-dropdown.json`)

```text
div.emoji-dropdown.active [style=""]                              T/components/emoticonsDropdown/index.ts:71
├ div.emoji-container                                             :72
│ └ div.tabs-container                                            :284
│   ├ div.tabs-tab.emoticons-container.emoji-padding.active.no-border-top
│   │ ├ div.menu-wrapper.emoticons-menu-wrapper.emoticons-will-move-up
│   │ │ └ div.scrollable.scrollable-x
│   │ │   └ nav.menu-horizontal-div.no-stripe.justify-start.emoticons-menu
│   │ │     ├ button.btn-icon.menu-horizontal-div-item.active
│   │ │     └ div.menu-horizontal-inner
│   │ └ div.emoticons-content
│   │   └ div.scrollable.scrollable-y.emoticons-will-move-up
│   │     ├ div.emoticons-search-container.emoticons-will-move-down
│   │     │ └ div.input-search.emoticons-search-input-container "Search Emoji"
│   │     └ div
│   │       └ div.emoticons-categories-container.emoticons-will-move-down
│   │           .emoticons-has-search.animated-item
│   ├ div.tabs-tab.emoticons-container.stickers-padding             (то же дерево, "Search Stickers")
│   └ div.tabs-tab.emoticons-container.no-menu.gifs-padding         (без menu-wrapper, "Search GIFs")
└ div.emoji-tabs.menu-horizontal-div.emoticons-menu.no-stripe      :75
  ├ button.btn-icon.menu-horizontal-div-item.emoji-tabs-search.justify-self-start.hide
  ├ button.btn-icon.menu-horizontal-div-item.emoji-tabs-emoji.active
  ├ button.btn-icon.menu-horizontal-div-item.emoji-tabs-stickers
  ├ button.btn-icon.menu-horizontal-div-item.emoji-tabs-gifs
  └ button.btn-icon.menu-horizontal-div-item.emoji-tabs-delete.justify-self-end
     (каждая содержит span.tgico.button-icon)
```

Кнопки табов создаются как `ButtonIcon(\`${icon} menu-horizontal-div-item emoji-tabs-${className}\`, {noRipple: true})`
(`emoticonsDropdown/index.ts:86`).

### 8.2 Открытие/закрытие — `DropdownHover` (`T/helpers/dropdownHover.ts`)

```ts
13 const KEEP_OPEN = false;
14 const TOGGLE_TIMEOUT = 200;      // задержка hover-открытия
15 const ANIMATION_DURATION = 200;  // длительность анимации
```

`toggle()` (`:189-260`):

```ts
204 const delay = IS_TOUCH_SUPPORTED || !liteMode.isAvailable('animations') ? 0 : ANIMATION_DURATION;
205 if((this.element.style.display && enable === undefined) || enable) {
206   const res = this.dispatchResultableEvent('open');
207   await Promise.all(res);
209   this.element.style.display = '';
210   void this.element.offsetLeft;              // reflow
211   this.element.classList.add('active');
213   this.dispatchEvent('openAfterLayout');
215   appNavigationController.pushItem({type: 'dropdown', onPop: () => this.toggle(false)});
222   this.setTimeout('done', () => { this.forceClose = false; this.dispatchEvent('opened'); }, delay);
   } else {
239   this.dispatchEvent('close');
242   this.element.classList.remove('active');
248   this.setTimeout('done', () => {
249     this.element.style.display = 'none';
250     this.forceClose = false;
251     this.dispatchEvent('closed');
252   }, delay);
   }
```

Открытие по hover: `mouseover` на кнопке → `setTimeout(…, TOGGLE_TIMEOUT = 200)` (`:73-77`).
На тач — по клику (`:56-64`).
Закрытие по out-click — `mousedown` + `click` в capture-фазе на активном окне (`:93-104`),
с `stopImmediatePropagation` при `suppressOutClick`.

### 8.3 Стили и позиционирование (`T/scss/partials/_emojiDropdown.scss:12-77`)

```scss
.emoji-dropdown {
  --width: 23.875rem;    /* 382px */
  --height: 26.25rem;    /* 420px */
  display: flex;
  flex-direction: column;
  width: var(--width);
  height: var(--height);
  background: var(--surface-color);
  overflow: hidden;
  flex: 1 1 auto;
  position: absolute;
  inset-inline-end: 0;
  bottom: calc(var(--chat-input-height) + .5rem);    /* 48 + 8 = 56px */
  max-width: calc(100% - 1rem);
  max-height: 26.25rem;
  box-shadow: 0px 5px 10px 5px rgba(16, 35, 47, .14);
  z-index: 4;
  border-radius: 1.25rem;                            /* 20px */
  transition: transform var(--esg-transition), opacity var(--esg-transition);
                                                     /* .2s cubic-bezier(.4,0,.2,1) */
  transform: scale(.85);
  opacity: 0;
  transform-origin: 100% 100%;
  backdrop-filter: var(--menu-backdrop-filter);      /* blur(50px) */
  background-color: var(--menu-background-color);    /* rgba(surface, .75) в тёмной теме */

  body.animation-level-0 & { transition: none; }
  .is-rtl &                { transform-origin: 0 100%; }

  &.smaller      { --height: 20rem; max-height: 20rem; }
  &.is-standalone {
    transform-origin: calc(9rem * var(--reflect)) 4.625rem;
    transform: scale(.85);
    bottom: auto;
    inset-inline-start: auto;
    top:  min(100vh - var(--height) - .5rem, var(--top));
    left: min(100vw - var(--width) - .5rem, max(.5rem, var(--left)));
  }
  &.is-under {
    --width: 100%;
    --height: min(282px, calc(var(--100vh-inset) - 135px));
    position: relative;
    transform: none;
    inset: unset;
    border-radius: unset;
    max-width: 100%;
    max-height: 100%;
  }

  &.active { opacity: 1; transform: scale(1); }
}
```

`is-under` ставится из `input.ts:1390`: `toggle('is-under', !shouldBeTop)`, где
`shouldBeTop = windowSize.height >= 570 && windowSize.width > 600`.

**Живые computed (из дампа):** 382×420, `border-radius: 20px`,
`background-color: rgba(33,33,33,.75)`, `box-shadow: rgba(16,35,47,.14) 0 5px 10px 5px`,
`transition: transform .2s cubic-bezier(.4,0,.2,1), opacity .2s cubic-bezier(.4,0,.2,1)`,
`bottom: 56px`, `z-index: 4`.
Табы: 382×49, `padding: 0 5px`, `z-index: 4`.
`super-emoji`: 42×42, `padding: 5px 4px`, `border-radius: 12px`, `font-size: 34px`.
Поиск: 366×38, `border-radius: 16px`.

### 8.4 Attach-меню (`D/04-attach-menu.json`)

```text
div.btn-menu.top-right.active.was-open [style="bottom: 68px; left: 708px;"]
├ div.btn-menu-item.rp-overflow > span.tgico.btn-menu-item-icon + span.i18n.btn-menu-item-text "Photo or Video"
├ … "Document"
├ … "Gift Premium"
├ … "Checklist"
└ div.btn-menu-item.rp-overflow
  ├ span.btn-menu-item-icon.is-external.media-container.no-background > img.media-photo
  └ span.btn-menu-item-text "Wallet"
```

Computed: `.btn-menu` 180×168, `padding: 4px 0`, `border-radius: 16px`,
`background-color: rgba(33,33,33,.75)`, `box-shadow: rgba(0,0,0,.15) 0 0 10px 0`, `z-index: 4`,
`min-width: 180px`,
`transition: opacity .2s cubic-bezier(.4,0,.2,1), transform .2s …, visibility .2s …`.
`.btn-menu-item` 172×32, `padding: 4px 12px`, `margin: 0 4px`, `border-radius: 12px`,
`font: 500 14px/18px`, `transition: transform .1s cubic-bezier(.4,0,.2,1)`.

Кнопка-скрепка — кастомный элемент `<attach-menu-button>`
(`defineSolidElement({name: 'attach-menu-button'})`, `attachMenuButton.tsx:21-22`):

```
<attach-menu-button class="{styles.Container} btn-menu-toggle btn-icon rp [{styles.disabled}] [menu-open] attach-file">
├ div.c-ripple                                              ripple(props.element) :25
├ <Show when={!isLoading}>
│ └ span.{styles.Icon}.button-icon        icon = 'attach_edit' | 'attach'   :52-58
└ <Show when={isLoading}>
  └ span.{styles.LoadingContainer}                                          :60-74
    ├ span.{styles.Icon}.{styles.close}.button-icon    (icon='close')
    └ svg.{styles.Loader}                              (ProgressCircleSVG, strokeThickness 1/10)
```

`attachHotClassName(props.element, styles.Container, 'btn-menu-toggle', 'btn-icon')` (`:24`);
`this.attachMenu.classList.add('attach-file')` (`input.ts:1256`).
Меню вешается через `ButtonMenuToggle({container: this.attachMenu, direction: 'top-right', …})`
(`input.ts:1197-1204`); `onOpen` дополнительно закрывает эмодзи-дропдаун:
`this.emoticonsDropdown?.toggle(false)` (`input.ts:1250`).

Модульные стили (`attachMenuButton.module.scss`):
`.Container { position: relative; overflow: hidden; }`, `.disabled { pointer-events: none !important; }`,
`.Icon { transition: opacity 0.2s; } .close { transform: scale(0.8); } .hidden { opacity: 0; }`,
`.Loader { position: absolute; inset: 0; width/height: 100%; animation: rotate 2s linear infinite; }`.

---

## 9. Drop-зона (drag & drop)

### 9.1 Дерево (`T/components/chat/dragAndDrop.ts:18-53`)

```
div.drop.z-depth-1[.has-icon][.is-dragover]              :18-19, has-icon :35
├ div.drop-icon.disable-hover                            :32-33  (только если options.icon)
│ └ <Icon(options.icon)>                                 :34
├ div.drop-header.disable-hover                          :38-39
│ └ i18n(options.header, options.headerArgs)             :40
├ div.drop-subtitle.disable-hover                        :44-45  (только если options.subtitle)
│ └ i18n(options.subtitle)                               :46
└ div.drop-outline-wrapper.disable-hover                 :21-22
  └ svg.drop-outline                                     :24-25
    └ path.drop-outline-path                             :27-28
```

Порядок append строго: `container.append(...[dropIcon, dropHeader, dropSubtitle, outlineWrapper].filter(Boolean))` (`:52`).

### 9.2 Когда монтируется

- монтаж в конструкторе: `appendTo.append(this.container)` (`:53`); родитель — `div.drops-container`
  (создаётся `T/lib/appImManager.ts:2502-2503`, медиа-версия — клон `:2505`);
- `.drops-container` вставляется в `this.chat.container.append(_dropsContainer)` (`appImManager.ts:2398`);
- экземпляры `ChatDragAndDrop` создаются по факту типов перетаскиваемых файлов
  (`appImManager.ts:2358`, `:2373`, `:2386`);
- уничтожение: `destroy()` (`dragAndDrop.ts:74-80`) — `container.remove()` + снятие трёх слушателей;
  зовётся в `onTransitionEnd` у `SetTransition` (`appImManager.ts:2410-2416`);
- показ/скрытие контейнера — `SetTransition({element: _dropsContainer, className: 'is-visible', forwards: mount, duration: 200})` (`appImManager.ts:2402-2418`).

`setPath()` (`:82-96`) считает `viewBox`/`width`/`height` по `outlineWrapper.getBoundingClientRect()`
и строит `d` через `generatePathData(pos, pos, sizeX, sizeY, radius × 4)` с `radius = 10`, `pos = radius/2`.

### 9.3 Стили (`T/scss/partials/_chatDrop.scss`)

```scss
.drops-container {
  --padding: 0px;
  position: absolute !important;
  z-index: 3;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 10px;
  width: auto !important;

  &:not(.is-visible) { display: none; }                              /* :18-20 */
  &.is-visible           { animation: fade-in-opacity .2s linear forwards; }
  &.is-visible.backwards { animation: fade-in-backwards-opacity .2s linear forwards; }   /* :22-28 */
}

.drop {
  --wrapper-padding: -4px;
  background-color: var(--surface-color);
  border-radius: 24px;                       /* $border-radius-big */
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: var(--input-placeholder-color);
  transition: color .2s ease-in-out;
  pointer-events: all;
  flex: 1 1 auto;

  &.is-dragover { color: var(--primary-color); }                     /* :102-104 */
}

.drop-outline-wrapper { position: absolute; inset: var(--wrapper-padding); pointer-events: none; }  /* :49-56 */
.drop-outline-path {
  fill: none;
  stroke-dasharray: 13.5, 11;
  stroke: var(--input-placeholder-color);
  stroke-width: 2;
  stroke-linecap: round;
  transition: stroke .2s ease-in-out;
  stroke-dashoffset: 0;

  .drop.is-dragover & { animation: drop-outline-move .5s linear infinite; stroke: var(--primary-color); }  /* :67-70 */
}

.drop-icon   { font-size: 6rem; }                                    /* :80-82 */
.drop-header { font-weight: var(--font-weight-bold); font-size: 1.25rem; }   /* :84-87 */
.drop.has-icon .drop-header { margin-top: -10px; }                   /* :89-91 */

@media (max-height: 670px) { .drop-icon { font-size: 0 } .drop-header { margin-top: 0 !important } }  /* :93-100 */

@keyframes drop-outline-move { from { stroke-dashoffset: 0 } to { stroke-dashoffset: -24.5 } }  /* :107-115 */

body.is-dragging {
  .page-chats { pointer-events: none; }
  #folders-container .chatlist-chat { pointer-events: all; }
}                                                                    /* :117-125 */
```

Переопределение внутри `.chat` (`_chat.scss:507-517`):
`.drops-container { --padding: 20px; top: calc(56px + var(--pinned-floating-height) + var(--padding)); }`,
на handhelds `--padding: 10px`; `.drop { max-width: 696px; --wrapper-padding: 15px; }`.

### 9.4 Тексты

Тексты приходят из `options.header` / `options.subtitle` в местах создания
(`appImManager.ts:2358`, `:2373`, `:2386`) — конкретные langKey в рамках этой разведки
**не выписаны**; смотреть по месту при реализации.

---

## 10. Тайминги и easing — сводная таблица

| # | Что анимируется | Длительность | Easing | Источник |
|---|---|---|---|---|
| 1 | `.chat-input-main` — `transform` (сдвиг всего композера) | 250 ms | `cubic-bezier(.4,0,.2,1)` | `_chat.scss:314` (`--transition-standard-out`, `base.scss:43`) |
| 2 | `.reply-wrapper` — `height` 0↔3rem | 250 ms | `cubic-bezier(.4,0,.2,1)` | `_chat.scss:779-781` |
| 3 | `is-toggling-helper` (JS-флаг вокруг #2) | 150 ms | — | `input.ts:4797-4807` |
| 4 | `.btn-send-icon-*` — `grow-icon` (активная иконка) | **400 ms** | `ease-in-out`, `forwards` | `_chat.scss:186`, keyframes `base.scss:1082-1096` |
| 5 | `.btn-send-icon-*` — `hide-icon` (неактивные) | **400 ms** | `ease-in-out`, `forwards` | `_animatedIcon.scss:164`, keyframes `base.scss:1098-1108` |
| 6 | `.btn-send` — `opacity` | 200 ms | (дефолт) | `_chat.scss:130-134` (`.btn-icon { transition: .2s opacity }`) |
| 7 | `.btn-send` — `transform: scale(0)` при центрировании | 200 ms | — | `_chat.scss:357` (`$input-transition-time`) |
| 8 | `.btn-send-effect-container` — `opacity` | 300 ms | `cubic-bezier(.4,0,.2,1)` | `_chat.scss:1484-1486` (`--transition-standard-in`) |
| 9 | `.input-message-input` — `height` (inline) | `round(50 * ln(Δpx))` ms | (CSS-дефолт; SCSS `.1s`) | `inputFieldAnimated.ts:62-68`, `_chat.scss:1082-1084` |
| 10 | `.input-field-placeholder` — `opacity` + `translateX(1rem→0)` | `var(--input-placeholder-transition)` + delay `.01s` | — | `_input.scss:242-244` (значение переменной **не найдено**) |
| 11 | `.autocomplete-helper` — fade-in/out | CSS **200 ms** `ease-in-out`; JS-таймаут **300 ms** | `ease-in-out` | `_autocompleteHelper.scss:25-42`, `autocompleteHelper.ts:181` |
| 12 | `.bot-commands` — slide-up + opacity | 300 ms | `cubic-bezier(.4,0,.2,1)` | `_chatBotCommands.scss:42-55` |
| 13 | `.emoji-dropdown` — `transform: scale(.85→1)` + `opacity` | 200 ms | `cubic-bezier(.4,0,.2,1)` | `_emojiDropdown.scss:30`, `base.scss:61-62`; JS-таймаут `dropdownHover.ts:15` |
| 14 | Hover-открытие эмодзи-дропдауна (задержка) | 200 ms | — | `dropdownHover.ts:14` |
| 15 | `.btn-menu` (attach) — `opacity`/`transform`/`visibility` | 200 ms | `cubic-bezier(.4,0,.2,1)` | дамп `D/04-attach-menu.json` |
| 16 | `.btn-menu-item` — `transform` | 100 ms | `cubic-bezier(.4,0,.2,1)` | дамп `D/04-attach-menu.json` |
| 17 | Ripple `ripple-effect` | 700 ms | `linear` | дамп `D/04-attach-menu.json` |
| 18 | Ripple fade | 350 ms | `ease` | дамп `D/04-attach-menu.json` |
| 19 | `.voice-recording-panel` — `opacity` | 150 ms | `ease` (+ `visibility 0s linear .15s`) | `_voiceRecordingPanel.scss:18`, `:171` |
| 20 | `.voice-recording-dot` — `recordBlink` | **1250 ms** `infinite` | не задан → `ease` | `_voiceRecordingPanel.scss:94-96`, keyframes `_chat.scss:395-407` |
| 21 | `.video-recording-stage` — `opacity` | 200 ms | `ease` (+ `visibility 0s linear .2s`) | `_videoRecordingPanel.scss:12` |
| 22 | Long-press на `.btn-send` (открытие меню записи) | **400 ms** | — | `chatRecording.ts:893` |
| 23 | `.drops-container` — fade | 200 ms | `linear` | `_chatDrop.scss:22-28`; JS `appImManager.ts:2402-2418` |
| 24 | `.drop-outline-path` — `drop-outline-move` | 500 ms `infinite` | `linear` | `_chatDrop.scss:68`, keyframes `:107-115` |
| 25 | `.drop` — `color` / `stroke` | 200 ms | `ease-in-out` | `_chatDrop.scss:41`, `:64` |
| 26 | `_center()` — морф инпут↔плашка | 200 ms | (`SetTransition`) | `input.ts:1749-1761` |
| 27 | `is-shrinking` (кросс-фейд вторичных кнопок) | 200 ms, полуфазы по 100 ms | — | `input.ts:3630-3637`, `_chat.scss:206-224` |
| 28 | `has-offset` (сдвиг под send-as/bot-commands) | **300 ms** | `cubic-bezier(.4,0,.2,1)` | `input.ts:2639-2644`, `_chat.scss:1012-1021` |
| 29 | `.new-message-send-as-avatar` — `transform`+`opacity` | 300 ms | `cubic-bezier(.4,0,.2,1)` | `_chat.scss:940-946` |
| 30 | `.markup-tooltip` — `opacity`/`transform`/`width` | `var(--layer-transition)`; JS-таймаут скрытия **200 ms** | — | `_chatMarkupTooltip.scss:12`, `markupTooltip.ts:296` |
| 31 | `.markup-tooltip` — фокус link-input после показа | задержка 200 ms | — | `markupTooltip.ts:242-245` |
| 32 | `attachListNavigation` — скролл к активному | 100 ms (`forceDuration`) | — | `attachListNavigation.ts:62-70` |
| 33 | `.chat-input-control` — `opacity` при показе | 100 ms + delay 75 ms | — | `_chat.scss:700-712` |
| 34 | `inlineHelper.checkQuery` — debounce | 200 ms | — | `inlineHelper.ts:75` |
| 35 | `sendContextMenu` — удаление старого узла после закрытия | 400 ms | — | `sendContextMenu.ts:147` |
| 36 | `attachMenuButton` `.Loader` — `rotate` | 2000 ms `infinite` | `linear` | `attachMenuButton.module.scss:28-44` |
| 37 | `attachMenuButton` `.Icon` — `opacity` | 200 ms | — | `attachMenuButton.module.scss:10-11` |

> Про easing в дампах: DevTools для CSS-**анимаций** (`CSSAnimation`) показывает `linear`,
> когда timing-function задан на уровне правила `animation:`, а не внутри keyframes.
> Для `grow-icon`/`hide-icon`/`recordBlink` **источник истины — SCSS**, а не дамп.

---

## 11. Что у нас сейчас и что придётся выбросить

### 11.1 Карта соответствия «наш узел → узел tweb»

| Наш узел / класс (`W/components/Composer.tsx`, `Composer.module.scss`) | Узел / класс tweb | Комментарий |
|---|---|---|
| `div.composerBox` (`:591`, scss `:319`) | `div.rows-wrapper-wrapper` | у tweb позиционирующий предок хелперов — сама `.rows-wrapper` (`position: relative`, `_chat.scss:556`); наш дополнительный якорь **не нужен** |
| `div.container` (`:608`, scss `:5`) | `div.rows-wrapper.chat-input-wrapper.chat-input-main-wrapper.chat-rows-wrapper` | radius 24px и box-shadow совпадают; у нас нет `min-height/max-height` (`3rem` / `30rem`) |
| `div.inputRow` (`:710`, scss `:60`) | `div.new-message-wrapper.rows-wrapper-row` | у нас `min-height: var(--chat-plate-height)`, у tweb `min-height: var(--chat-input-height)` = 48px; `padding: 4px`, `gap: 4px` совпадают |
| `div.bar` (`:627/:660/:686`, scss `:24`) ×3 отдельных | **одна** `div.reply-wrapper.rows-wrapper-row` | у нас три независимых `AnimatePresence` + `motion.div height:auto`, у tweb — одна плашка, CSS `height 0→3rem` через `.chat.is-helper-active` |
| `div.barBody` (scss `:40`) | `div.reply.quote-like.quote-like-hoverable.quote-like-border.rp` | у нас inline `bg: ${color}1f` + `box-shadow inset 3px 0 0`; у tweb — `--peer-color-rgb` + `_quote.scss` |
| `<TgIcon reply/edit/forward>` (`:628/:661/:687`) | `button.btn-icon.<type>.reply-icon` | у tweb это **кнопка**, у нас — иконка без интерактивности |
| `<IconButton close>` в баре (`:642/:666/:701`) | `button.btn-icon.close.reply-cancel` | соответствие 1:1 |
| — | `div.reply-wrapper-content` | **у нас нет** промежуточного узла-обёртки, который держит `--peer-color-rgb` |
| — | `div.reply-content` / `div.reply-title` / `div.reply-subtitle` / `div.reply-media` | у нас плоский `barBody > Text + Text` |
| `div.editorWrap` (`:805`, scss `:117`) | `div.input-message-container` | у tweb `width: 1%; flex: 1 1 auto; overflow: hidden; align-self: center; min-height: 40px` |
| `div.editor[contentEditable]` (`:816`, scss `:137`) | `div.input-message-input.is-empty.scrollable.scrollable-y.no-scrollbar.forwards` | у нас `transition: height .12s ease` в CSS, у tweb — inline `transition-duration` по формуле |
| `<Text.placeholder>` (`:807`, scss `:127`) | `span.input-field-placeholder.i18n.is-empty` | у нас условный рендер по `emptyDraft`, у tweb узел всегда есть + класс `is-empty` |
| — | `div.input-message-input…input-field-input-fake` | **у нас нет фейк-инпута**; высота меряется через `height:'auto'` → reflow (`Composer.tsx:202-216`) |
| `motion.div.sendBtn` (`:854`, scss `:206`) | `div.btn-send-container` > `button.btn-icon.rp.btn-circle.btn-send.animated-button-icon.<state>` | размеры 48×40 и radius 20px совпадают; у нас `background: var(--tg-accentGradient)`, у tweb `var(--primary-color)` |
| `AnimatePresence mode="wait"` + `motion.span key='slow'\|'send'\|'mic'` (`:891-899`) | 6 постоянных `span.tgico.animated-button-icon-icon.btn-send-icon-*` + `classList.toggle` | **принципиально другой механизм**: у нас mount/unmount, у tweb — все 6 в DOM + CSS-анимации |
| `span.effectBadge` (`:906`, scss `:228`) | `div.btn-send-effect-container` > `div.btn-send-effect` | у нас эмодзи-символ, у tweb — стикер 20×20 через `wrapSticker` |
| `<IconButton attach>` (`:762`) | `<attach-menu-button class="btn-menu-toggle attach-file …btn-icon rp">` | у tweb это кастомный элемент со своим loading-состоянием |
| `<IconButton smile>` в `span` с `buttonRef` (`:843`) | `button.btn-icon.toggle-emoticons` | tweb добавляет `active` при открытом дропдауне |
| `button.menuBtn` (`:757`, scss `:333`) | `div.new-message-bot-commands` | у tweb это абсолютно позиционированный узел + `has-offset` на строке; у нас inline-кнопка в потоке |
| `<SendAsButton>` (`:754`, `SendAsButton.tsx`) | `.new-message-send-as-container` + `.new-message-send-as-avatar` | у tweb — `position: absolute; transform: scale(0)` + `has-offset[data-offset="as"]` |
| `<IconButton scheduled>` (`:798`) | `button.btn-icon.btn-scheduled.float` | у tweb `.float` + `.show` + красная точка `:after` (`_chat.scss:66-77`) |
| ветка `rec.recording` внутри `.inputRow` (`:711-749`) | `div.voice-recording-panel` — **оверлей**, а не ветка | у tweb остальные узлы не размонтируются; панель накрывает их `position: absolute; inset: 0` |
| `<IconButton delete #ff5a5a>` (`:714`) | `button.btn-icon.voice-recording-cancel.danger.rp` | размер 40×40, `font-size: 1.5rem` |
| `div.recPill` (`:718`, scss `:69`) | `div.voice-recording-pill` | у tweb `background: var(--light-primary-color)`, `radius 24px`, `padding-block: 6px`, `gap: 10px` |
| `div.recDotLive` / `.recDotPaused` (scss `:81/:90`) | `div.voice-recording-dot` + `.voice-recording-play` | у tweb **один** dot + отдельная play-кнопка 24×24, переключение классом `--paused` |
| `div.wave` > `div.waveBar` ×90 (`:733-742`) | `canvas.voice-recording-waveform` | **у нас DOM-бары, у tweb canvas** |
| `<Text tabular-nums>` таймер (`:728`) | `span.voice-recording-timer` | у tweb `min-width: 3rem; text-align: end; font-size: .875rem` |
| `<IconButton pause/mic>` (`:746`) | `button.btn-icon.voice-recording-pause-toggle.rp` с двумя иконками | у tweb обе иконки в DOM, свап по `--paused` |
| `RoundRecordPreview` в портале (`:1079`) | `div.video-recording-stage` в `<body>` | у нас `width: min(360px, 78vw)`, у tweb `360px` фикс + `max-width: 90vw; max-height: 70vh` |
| `<EmojiHelper>` (`EmojiHelper.tsx`) | `div.autocomplete-helper.z-depth-1.emoji-helper` | наш узел монтируется/размонтируется, у tweb — всегда в DOM |
| `<StickersHelper>` | `div.autocomplete-helper.z-depth-1.stickers-helper` | то же |
| `<MentionsHelper>` | `div.autocomplete-helper.z-depth-1.autocomplete-peer-helper.mentions-helper` | то же |
| `<InlineResultsHelper>` | `div.autocomplete-helper.z-depth-1.inline-helper` | то же |
| `<EmojiDropdown>` (`emoji/EmojiDropdown.tsx`) | `div.emoji-dropdown` | у нас уже императивный порт `display:''` → reflow → `.active` (`EmojiDropdown.tsx:250-267`) — **совпадает с tweb** |
| `<AttachMenu>` (рендерит `useChatPopups.tsx:236`) | `div.btn-menu.top-right` | tweb вешает меню на саму кнопку через `ButtonMenuToggle` |
| `<Menu open={sendMenuOpen}>` (`:917`) | `div.btn-menu.menu-send.top-left` внутри `.btn-send-container` | у tweb меню **внутри** контейнера кнопки |
| `<MarkupTooltip>` (`:1020`) | `div.markup-tooltip.z-depth-1` в `getOverlayRoot()` | у tweb — синглтон в body, не в композере |
| — | `div.fake-wrapper.fake-rows-wrapper` / `.fake-selection-wrapper` | **у нас нет** — это измерительные пустышки для `_center()` |
| — | `div.chat-input-control.chat-input-wrapper` > `div.chat-input-plate` | **у нас нет** плашки-замены инпута вообще |
| — | `button…bubbles-go-down` / `bubbles-go-mention` / `bubbles-go-reaction` | у нас живут вне композера |
| — | `div.autocomplete-helper…bot-commands` | **у нас нет** хелпера команд бота |
| — | `div.autocomplete-helper…commands-helper` | **у нас нет** автокомплита `/команд` |
| — | `div.reply-keyboard` | у нас — `s.replyKeyboardBtn` в `Chat.tsx:1245`, вне композера |
| — | `input[type=file][style="display:none"]` | у нас файловый инпут в `AttachMenu`/родителе |
| — | `span.btn-send-stars-badge.stars-badge-base` | у нас платность показана плашкой `.paidBar` |
| — | `div.reply-in-topic-overlay` | у нас нет |
| — | `div.drop` / `.drops-container` | у нас drop обрабатывается прямо на `.editor` (`Composer.tsx:417-424`), без визуальной зоны |

### 11.2 Наши узлы, которым в tweb соответствия НЕТ (выбрасываем или помечаем отступлением)

| Наш узел | Строка | Вердикт |
|---|---|---|
| `div.composerBox` | `Composer.tsx:591`, scss `:319` | **выбросить** — роль берёт `.rows-wrapper` (`position: relative`) |
| `div.paidBar` | `:610-616`, scss `:271` | нет аналога; в tweb — `btn-send-stars-badge`. **Либо переносим на бейдж, либо оставляем с пометкой отступления** |
| `div.effectRow` + 6 хардкодных эмодзи | `:946-963`, `helpers.ts:19-26` | в tweb эффекты — TL-документы из `getAvailableEffects()` + `reactionsMenu` в send-меню (`sendContextMenu.ts:136`). **Наша реализация — отступление** |
| `span.effectBadge` (символ-эмодзи) | `:906-910`, scss `:228` | узел-аналог есть (`.btn-send-effect-container`), но контент другой. **Переименовать классы, контент оставить как отступление** |
| `<Text.counter>` с `${msgCount} 💬` | `:833-842`, scss `:196` | в tweb счётчика символов в композере **не найдено**. Оставить как отступление |
| `span.slowmodeTimer` внутри кнопки send | `:900-901`, scss `:280` | в tweb slowmode-таймер в кнопке **не найден**. Оставить как отступление |
| Мини-подпись TTL в углу кнопки-таймера | `:784-793`, `helpers.ts:40-41` | tweb имеет `btnAutoDeletePeriod` (`ButtonIcon('auto_delete_circle_clock hide')`, `input.ts:1263`) — **без подписи**. Отступление |
| `div.recDotPaused` (отдельный узел) | `:720`, scss `:81` | в tweb пауза = скрытие `.voice-recording-dot` + показ `.voice-recording-play`. **Выбросить**, перейти на схему tweb |
| `div.wave > div.waveBar ×90` | `:733-742`, scss `:99/:109` | tweb рисует `canvas`. **Выбросить DOM-бары** (см. риск R6) |
| `s.roundPreviewWrap` / `.roundPreview` / `.roundProgress` | `RoundRecordPreview.tsx` | аналог — `.video-recording-stage/-circle/-preview/-progress-ring`. **Переименовать под tweb** |
| Ветвление `rec.recording ? A : Б` внутри `.inputRow` | `:711-852` | **выбросить**: у tweb никакого ветвления нет, панель — оверлей |
| `display:contents`-обёртка вокруг lazy `EmojiDropdown` | `:1023` | техническая; оставить как отступление |
| `<DiscardVoiceDialog>` по Escape | `:254-261`, `:1085-1092` | у tweb это `PopupPeer 'popup-cancel-record'` по `NavigationItem` (`chatRecording.ts:1016-1025`) и по клику вне (`:1006-1012`). **Механизм отличается — свести к tweb или пометить** |
| `Ctrl/Cmd+K` через `window.prompt` | `:510-519` | у tweb link-инпут внутри `.markup-tooltip-tools-link`. **Отступление, уже помечено комментарием** |
| `useComposerAutocomplete` как единый хук | `composer/useComposerAutocomplete.ts` | внутренняя организация, DOM не затрагивает — оставить |

### 11.3 Узлы tweb, которых у нас НЕТ (добавляем)

| Узел tweb | Зачем |
|---|---|
| `div.rows-wrapper-wrapper` | нужен для `is-centering-to-control` |
| `div.fake-wrapper.fake-rows-wrapper` + `.fake-selection-wrapper` | измерительные пустышки для `_center()` (морф инпут↔плашка) |
| `div.chat-input-control.chat-input-wrapper` > `div.chat-input-plate` (`-side`/`-center`/`-side`) с 8 кнопками | плашка-замена инпута: START / Unblock / JOIN / Unmute/Mute / Premium / Frozen / Unpin All / Open Chat |
| `div.reply-wrapper-content` | обёртка-носитель `--peer-color-rgb` |
| `div.reply-content` / `.reply-title` / `.reply-subtitle` / `.reply-media` | внутренняя структура reply-плашки |
| `div.input-message-input.input-field-input-fake` | измерение высоты (см. §5.4) |
| 6 постоянных `span.btn-send-icon-*` | морф кнопки отправки |
| `div.btn-send-effect-container` | контейнер бейджа эффекта |
| `div.voice-recording-panel` как **оверлей** с `pill`/`lead`/`canvas`/`timer` | панель записи |
| `canvas.voice-recording-waveform` | волна |
| `div.autocomplete-helper…bot-commands` | список команд бота |
| `div.autocomplete-helper…commands-helper` | автокомплит `/команд` |
| `div.reply-keyboard` внутри `.rows-wrapper` | клавиатура бота (у нас снаружи) |
| `input[type=file][multiple][style="display:none"]` внутри `.new-message-wrapper` | скрытый файловый инпут |
| `span.btn-send-stars-badge.stars-badge-base` | бейдж стоимости сообщения |
| `div.drop` / `div.drops-container` | визуальная drop-зона с пунктирной обводкой |
| `.new-message-bot-commands` как абсолютный узел + `has-offset` на строке | сдвиг инпута под кнопку меню бота |
| `.new-message-send-as-container` / `-avatar` как абсолютный узел + `has-offset[data-offset="as"]` | сдвиг инпута под send-as |
| `button.btn-icon.toggle-reply-markup.float` | тумблер клавиатуры бота |
| `button.btn-icon.toggle-send-gift.float` | кнопка подарка |
| `button.btn-icon` (`suggested`) + (`auto_delete_circle_clock`) | предложить пост / автоудаление |
| `div.reply-in-topic-overlay` | оверлей «отвечать в теме» (форумы) |

### 11.4 Наша ЛОГИКА, которую надо СОХРАНИТЬ, и куда её вешать

| Логика | Где сейчас | Куда вешать в новом дереве |
|---|---|---|
| **Черновики.** Восстановление на маунте (`Composer.tsx:237-246`), сохранение на `onInput` (`:824`), сброс при отправке (`:336`, `:291`, `:304`, `:572`), debounce 2500 ms + сейв при уходе и смене `replyToId` (`core/hooks/useComposerDraft.ts:11, 36-38, 55-58, 64-73`) | `onInput` на `.input-message-input`; сброс — там же, где `sendMessage()`. Ремаунт per-chat (`key={chat.id}`, `Chat.tsx:1267`) сохраняем |
| **Горячие клавиши** (`onEditorKeyDown`, `:426-523`): Escape/стрелки/Enter/Tab для 3 хелперов; `Ctrl+↑` → `onReplyPrev`; `↑` на пустом → `onEditLast`; `Enter` → submit; `Shift+Enter` → перенос; `Ctrl+B/I/U/S/M/P`, `Ctrl+K` | `keydown` на `.input-message-input`. **Навигацию по хелперам заменить** на `attachListNavigation` c классом `active` (§7.3) — иначе клавиатура в хелперах разъедется с tweb |
| **Slowmode.** `slowmodeBlocked` (`:137`), гейт в `submit()` (`:310`), `sendBtnMuted` (`:172`), `span.slowmodeTimer` (`:900`) | гейт — в обработчике `.btn-send`; визуал — **отступление**, вешать поверх `.btn-send` (в tweb такого узла нет) |
| **Платные сообщения.** `chargeStars` (`:120`), `div.paidBar` (`:610-616`) | у tweb — `span.btn-send-stars-badge.stars-badge-base` (`input.ts:4020-4034`) + `setPeerParams({isPaid})` в send-меню (`input.ts:2447`). **Перенести на бейдж** либо оставить плашку с пометкой отступления |
| **TTL секретных чатов.** `secretTtl`, `ttlMenu` (`:179-180`), кнопка-таймер (`:773-795`), `TTL_OPTIONS` (`helpers.ts:29-38`), уходит 3-м аргументом `onSend` (`:331`), не сбрасывается после отправки | вешать на `button.btn-icon` c иконкой `auto_delete_circle_clock` (аналог `btnAutoDeletePeriod`, `input.ts:1263`) в `.new-message-wrapper`, между `.toggle-reply-markup` и `.toggle-send-gift`. Мини-подпись — отступление |
| **Эффекты эмодзи.** `EFFECT_CHOICES` (`helpers.ts:19-26`), `selectedEffect` (`:278`), `div.effectRow` в send-меню (`:946-963`), бейдж (`:906-910`), сброс после отправки (`:332`), движок `core/effects/emojiEffects.ts` | ряд выбора — в `div.btn-menu.menu-send` (аналог `appendReactionsMenu`, `sendContextMenu.ts:136`); бейдж — в `div.btn-send-effect-container` внутри `.btn-send-container`; пункт «Remove Effect» — 5-й `btn-menu-item.danger` (`sendContextMenu.ts:68`) |
| **Счётчик символов.** `MAX_LEN = 4096` (`helpers.ts:10`), `len` по UTF-16 (`:190-197`), `msgCount` (`:188`), показ при `len > MAX_LEN - 256` (`:833`) | аналога в tweb **не найдено**. Оставить как отступление, вешать внутри `.input-message-container` или между ним и `.toggle-emoticons` |
| **Запись голоса/кружка.** `rec: VoiceRecorder` проп, `recordingMediaType` в settings-сторе (`:175-176`), long-press 400 ms (`:865-876`), контекст-меню выбора (`:886`), старт/стоп/пауза (`:858-860`, `:714`, `:746`) | всё вешать на `.btn-send` (long-press 400 ms — **совпадает** с `chatRecording.ts:893`) и на кнопки `.voice-recording-*`. Тип записи — persist, как `appSettings.recordingMediaType` (`chatRecording.ts:899-905`) |
| **Вложения.** `onOpenAttach(rect)` (`:762-770`), тост при `!canSendMedia` (`:765`), меню в `useChatPopups.tsx:236` | вешать на `<attach-menu-button>` через аналог `ButtonMenuToggle` с `direction: 'top-right'`; `onOpen` должен закрывать эмодзи-дропдаун (`input.ts:1250`) |
| **Paste / Drop.** `insertClipboard` (`:395-406`), `htmlToRich` (`helpers.ts:54-62`), `isSafeUrl` (`helpers.ts:44`), `insertPlainText` одним text-node (`:356-372`), `insertFragment` (`:375-388`) | на `.input-message-input`. Drop дополнительно должен поднимать визуальную зону `.drops-container` (сейчас её нет) |
| **Reply / Edit / Forward.** типы `ReplyState`/`EditState`/`ForwardBar` (`:53-56`), эффект фокуса (`:231-233`), заполнение редактора при edit (`:219-228`), `forwardActive → showSend` (`:156-157`), пустой submit при форварде (`:317-321`), forward-меню (`:969-1009`) | всё — на **одну** `.reply-wrapper`; переключение через `is-helper-active` на контейнере чата; иконка = класс типа на `.reply-icon`; forward-меню открывается кликом по `div.reply` |
| **Автокомплит.** `caretWord()` (`useComposerAutocomplete.ts:40-51`), эмодзи (`:54-77`), inline с debounce 200 ms (`:80-100`), mentions лимит 20 (`:110-134`), стикеры через `stickerSuggestEmoji()` (`StickersHelper.tsx:14-18`) + debounce 300 ms (`:27`) | debounce inline 200 ms **совпадает** с `inlineHelper.ts:75`. Показ/скрытие перевести на `is-visible` + `SetTransition` 300 ms (§7.2); каскад «показал один — спрятал остальные» взять из `autocompleteHelperController.ts:37-47` (emoji+stickers — siblings, `input.ts:1292`) |
| **Отправка.** `submit(silent)` (`:309-341`), тихая отправка (`:926`), `submitScheduled` (`:283-293`), `submitWhenOnline` (`:296-307`), `SchedulePopup` (`:1011-1017`), send-as (`SendAsButton.tsx`) | send-меню — `div.btn-menu.menu-send.top-left` внутри `.btn-send-container`; порядок пунктов из `sendContextMenu.ts:42-70`; send-as — `.new-message-send-as-container` + `has-offset[data-offset="as"]` |
| **Кастом-эмодзи.** `insertCustomEmoji` (`:536-551`), `deleteBeforeCaret` (`:553-560`) | на `.input-message-input`; кнопка удаления — `button.emoji-tabs-delete` в `.emoji-tabs` |
| **Live-markdown отсутствует** (сырые маркеры, парсинг на отправке) (`:822-823`) | сохранить — это правило `CLAUDE.md` |
| **`useDropdownHover`** 200 ms + out-click с игнором целей внутри редактора (`emoji/useDropdownHover.ts`, `:143`) | **совпадает** с `dropdownHover.ts:14` (`TOGGLE_TIMEOUT = 200`); игнор целей — через `ignoreOutClickClassName` (`dropdownHover.ts:114`) |
| **`onMouseDown → preventDefault`** на всех кнопках и плашках, чтобы не терять фокус (`:757`, `:866`, `EmojiHelper.tsx:34` и др.) | сохранить на всех новых кнопках; в tweb эквивалент — `attachClickEvent(…, {touchMouseDown: true})` (`input.ts:1450`) и `noRipple` |
| **`autosize()`** (`:202-216`) с cap `30vh` и rAF-трюком | **заменить** на схему tweb: фейк-инпут + `min(scrollHeight, maxHeight)` + inline `transition-duration = round(50*ln(Δ))` (§5.4); cap взять из `computeMessageInputMaxHeight()` (440 / 160 / `max(36, h−32−160)`) |
| **`clearEditor()`** (`:263-275`) с ручным `dispatchEvent(new Event('selectionchange'))` для скрытия MarkupTooltip | сохранить; в tweb тултип прячется по `selectionchange` через `bindActiveWindowListener` (`markupTooltip.ts:523`) |
| **`canSendMedia`** гейт (`:134`, `:170`) | вешать как `.btn-disabled` на `.attach-file` (`input.ts:2586`) и как отсутствие рекордера (`hasVoiceRecorder()`) |

---

## 12. Риски и предлагаемые минимальные отступления

Формат пометки в коде: `// отступление от tweb: <причина>`.

**R1. Морф кнопки send: 6 иконок одновременно в DOM.**
tweb держит все шесть `span.btn-send-icon-*` в DOM с `position: absolute` и `animation: hide-icon`
по умолчанию (`_animatedIcon.scss:159-170`). React-порт естественно тянет к `AnimatePresence`
с одним узлом. **Риск:** при монтировании/размонтировании `animation-fill-mode: forwards` не
отработает, и переход между иконками будет рывком.
*Минимальное отступление:* никакого — рендерить все 6 `<span>` статически, менять только
`className` на `.btn-send`. Это полностью совместимо с React.

**R2. `is-helper-active` живёт на контейнере ЧАТА, а не композера.**
`input.ts:4886` ставит класс на `this.chat.container`, а CSS-селектор — `.chat.is-helper-active &`
(`_chat.scss:783`). У нас композер — изолированный компонент.
*Минимальное отступление:* дублировать класс на корне композера и добавить в наш SCSS вариант
селектора `.chat-input.is-helper-active .reply-wrapper` рядом с оригинальным.
`// отступление от tweb: класс продублирован на .chat-input, т.к. Composer не владеет контейнером чата`

**R3. `_center()` — морф инпута в плашку через `scaleX` + fake-обёртки.**
`input.ts:1703-1777` измеряет два невидимых узла и пишет inline `transform`/`borderRadius`.
Это императивная логика с reflow, плохо ложащаяся на декларативный React.
*Минимальное отступление:* реализовать `_center()` как императивный хук
(`useLayoutEffect` + refs), не через state — иначе будет лишний рендер между измерением и записью.
Fake-обёртки рендерить статически.

**R4. Скролл-обёртки `.scrollable`.**
tweb оборачивает содержимое хелперов в `div.scrollable` **программно**, перенося уже
существующих детей (`scrollable.ts:104-112`). В React нельзя «перенести детей» после рендера.
*Минимальное отступление:* рендерить `div.scrollable.scrollable-y` (или `-x`) сразу в JSX
как обёртку. Визуально идентично.
`// отступление от tweb: .scrollable рендерится в JSX, а не создаётся программно`

**R5. `.reply-icon` и `div.reply` в tweb пересоздаются через `replaceWith`.**
Для React это просто смена `key`. Но порядок узлов в DOM у tweb —
`[reply-icon, reply, reply-cancel]`, а визуальный порядок задаётся `order` (`_chat.scss:790/797/802`).
*Риск:* легко «упростить» и убрать `order`, что сломает RTL и точность.
*Отступление:* нет — сохранять `order` в SCSS как есть.

**R6. Волна записи: canvas vs DOM-бары.**
tweb рисует `canvas` с dpr-скейлом, `BAR_WIDTH=3`, `BAR_GAP=3`, `roundRect(…, 1.5)`,
`globalAlpha=0.3` для непроигранных, обновление через коалесцированный rAF
(`liveWaveform.ts:147-154`). Наши 90 DOM-баров с inline `height`/`opacity` дают другой вид
и другую перф-характеристику.
*Минимальное отступление:* портировать canvas 1:1 — это самодостаточный класс на ~200 строк
без зависимостей от Solid. **Не оставлять DOM-бары.**

**R7. Таймер записи обновляется покадрово.**
`chatRecording.ts:748-761` крутит `fastRaf`-цикл и пишет строку `M:SS,CC` (сотые!).
В React это 60 setState/сек.
*Минимальное отступление:* писать в DOM напрямую через ref (как tweb — `setTimer` пишет
`textContent` только при изменении строки, `voiceRecordingPanel.ts:156`), минуя state.
`// отступление от tweb: нет — но таймер обязан идти мимо React state`

**R8. `--peer-color-rgb` = ссылка на CSS-переменную, а не rgb.**
`peerColors.ts:56-57` пишет `var(--peer-N-color-rgb)`, а не числа. У нас сейчас
`bg: ${reply.color}1f` (hex + альфа) — принципиально другой механизм.
*Минимальное отступление:* завести палитру `--peer-0..N-color-rgb` в токенах и писать ссылку.
Если палитры нет — писать реальный `"r, g, b"` (tweb так делает для collectible-цветов,
`peerColors.ts:46-47`), это легальный вариант в самом tweb.

**R9. `SetTransition` — сквозной механизм tweb (классы `forwards` / `backwards` / `animating`).**
Он используется в 6+ местах композера (`is-shrinking`, `is-centering`, `has-offset`,
`is-visible` хелперов, `is-changing-height`, `drops-container`). Без него множество
CSS-селекторов не сработает (`.is-visible.forwards`, `.is-centering.animating` и т.д.).
*Минимальное отступление:* портировать `SetTransition` как утилиту-хук. Заменять на
framer-motion **нельзя** — тогда придётся переписывать все селекторы.

**R10. `attachListNavigation` слушает `keydown` на `document` в capture-фазе.**
`attachListNavigation.ts:8, 166, 176`. Наш `onEditorKeyDown` — React-обработчик на редакторе.
Порядок обработки будет другим (document-capture раньше React).
*Минимальное отступление:* при портировании сначала навесить `attachListNavigation`
и убрать из `onEditorKeyDown` ветки навигации по хелперам (`Composer.tsx:428-487`),
иначе будет двойная обработка стрелок.

**R11. Расхождение таймингов у хелперов (CSS 200 ms vs JS 300 ms).**
`_autocompleteHelper.scss:26` даёт `.2s`, `autocompleteHelper.ts:181` — `duration: 300`.
Это баг-подобное расхождение в самом tweb.
*Отступление:* повторить как есть (иначе классы `forwards`/`animating` будут сниматься
не в тот момент). Пометить комментарием в SCSS.

**R12. `.btn-menu.menu-send` пересоздаётся при каждом закрытии.**
`sendContextMenu.ts:146-147`: `this.createMenu()` + `setTimeout(() => element.remove(), 400)`.
В React это просто `key`-ремаунт, но задержка 400 ms для удаления старого узла важна —
иначе анимация закрытия оборвётся.
*Минимальное отступление:* `AnimatePresence` с `exit`-задержкой 400 ms либо ручной таймер.

**R13. `.voice-recording-panel` — оверлей поверх строки, а не ветка рендера.**
Наш текущий `rec.recording ? A : Б` (`Composer.tsx:711-852`) размонтирует инпут и все кнопки.
У tweb они остаются в DOM и просто перекрыты (`_voiceRecordingPanel.scss:7-22`).
*Риск:* при переходе в запись у нас теряется фокус, состояние выделения и позиция каретки.
*Отступление:* нет — перейти на схему оверлея.

**R14. `.chat-input-control` держит 8 кнопок одновременно.**
Для React это 8 узлов с `.hide`, из которых видна одна. Соблазн — рендерить условно.
*Риск:* сломается кросс-фейд (`controlPlate.tsx:19-24` — боковые слоты резервируют
симметричное место, чтобы плашки были одинаковой ширины и переключались чистым `opacity`).
*Отступление:* нет — рендерить все 8 статически с `.hide`.

**R15. `attach-menu-button` — кастомный HTML-элемент (`defineSolidElement`).**
В React мы не сможем создать `<attach-menu-button>` с solid-мидлварью.
*Минимальное отступление:* рендерить `<button class="btn-menu-toggle attach-file btn-icon rp">`.
Селекторы `.attach-file`, `.attach-file.menu-open`, `.attach-file.btn-disabled`
(`_chat.scss:707-716`) от тега не зависят.
`// отступление от tweb: <button> вместо кастомного элемента <attach-menu-button>`

**R16. `.video-recording-stage` монтируется в `<body>`, а не в композер.**
У нас уже портал в `document.body` (`Composer.tsx:1079-1082`) — совпадает.
*Риск:* только в классах — переименовать `roundPreviewWrap/roundPreview/roundProgress`
на `video-recording-stage / -circle / -preview / -progress-ring`.

**R17. Фейк-инпут `input-field-input-fake` — второй contenteditable в DOM.**
React будет пытаться синхронизировать его содержимое. tweb копирует HTML вручную
(`inputFieldAnimated.ts:100-110`).
*Минимальное отступление:* рендерить пустой `<div ref>` и заполнять через ref в
`useLayoutEffect` (никогда через JSX-children) — иначе будет двойной рендеринг эмодзи/спойлеров.

**R18. Иконочный шрифт `tgico`.**
Все иконки tweb — `span.tgico` с кодовой точкой шрифта. У нас — `<TgIcon>` (SVG?).
Размеры в CSS завязаны на `font-size` (`.btn-send { font-size: 1.5rem }`,
`.btn-send-icon-edit { font-size: 2rem }`).
*Минимальное отступление:* если у нас SVG — задать явные `width/height` вместо `font-size`
и пометить каждое такое место. Иначе `grow-icon`/`hide-icon` (scale-анимации) будут
масштабировать не то.

**R19. Ripple `div.c-ripple` первым потомком каждой кнопки.**
`ripple.ts:30-43` создаёт узел и класс `rp`. Анимации `ripple-effect 700ms linear` + fade 350ms ease.
*Риск:* если у нас нет ripple, кнопки будут «мёртвыми» на клик по сравнению с tweb.
*Отступление:* при отсутствии ripple — не рендерить `div.c-ripple` и не ставить `rp`
(классы `rp`/`rp-overflow` больше ни на что не влияют), пометить комментарием.

**R20. Что осталось непроверенным (нужно доснять перед реализацией):**

- значение `--input-placeholder-transition` — **не найдено** в прочитанных файлах;
- значение `--layer-transition` (используется во всём `_chatMarkupTooltip.scss`) — **не найдено**;
- конкретные langKey для текстов drop-зоны (`appImManager.ts:2358, 2373, 2386`) — **не выписаны**;
- SCSS для `.mentions-helper` и `.commands-helper` — **не найдено** (стилизуются только базой
  `_autocompletePeerHelper.scss`);
- DOM-дерево `.reply-keyboard` (`input.ts:912-921`) — **не разбиралось** в этой разведке;
- `.stars-badge-base` (внутреннее дерево и стили) — **не разбиралось**;
- живой DOM состояний edit / forward / запись / выделение / плашка-замена — в дампе снят
  **только покой + reply**; остальное восстановлено по исходникам. Если нужна 100% уверенность
  в порядке узлов для этих состояний — доснять с `http://localhost:8099` (только чтение).

---

## Проверка после порта

Прощёлкать на стенде, прежде чем говорить «готово».

- [ ] Морф кнопки: пустой инпут → микрофон, набранный текст → самолётик, режим правки → галочка.
- [ ] Плашка reply / edit / forward: появление, крестик, клик по плашке ведёт к сообщению.
- [ ] Запись голоса и кружка: таймер, отмена свайпом, отправка.
- [ ] Автокомплиты: `@` упоминание, `/` команда, `:` эмодзи, стикер по эмодзи, инлайн-бот.
- [ ] Эмодзи-дропдаун: табы эмодзи / стикеры / гифки, поиск внутри каждого.
- [ ] Drag & drop файла: зона появляется и исчезает, отпускание открывает попап отправки.
- [ ] Markup-тултип по выделению текста: форматирование применяется и снимается.
- [ ] Тайминги переходов совпадают с таблицей §10 — на глаз ничего не «дёргается».

Машинная сверка разметки: снять DOM через `tools/tweb-parity/snapshot-dom.js` и
сравнить с эталоном — `node tools/tweb-parity/dom-parity.mjs <дамп> ours.txt`.
Подходящие дампы: 04-composer-rest, 04-attach-menu, 04-emoji-dropdown, 19-emoticons-01…07.
