# tweb: живой DOM-референс (снято с работающего клиента)

**Что это.** Вырезки живого DOM-дерева Telegram Web K (tweb) с полными классами, computed styles ключевых элементов и инвентарём анимаций — эталон для программы «наш клиент 1:1 с tweb».

**Как снято.** Chrome DevTools MCP, залогиненный tweb на `http://localhost:8099` (isolated context `tweb-verify-j`), коммит tweb `e52b5d931`. Дата съёма: 2026-08-08. Вьюпорт 1728×941 (retina). Тема на момент съёма: **ночная** (`night`-палитра).

**Сырьё** (полные дампы + скриншоты): `docs/research/tweb-dom/` (не коммитить; MCP не мог писать в scratchpad вне workspace root).

**Формат дерева:** `tag.class1.class2 [attr="…"] "текст"`, отступ = вложенность. `path/defs/style/script` пропущены.

**Важный контекст:** этот билд tweb — редизайн с классами на `body`: `animation-level-2 rounded-sections is-left-column-shown has-horizontal-folders` — «плавающие» скруглённые колонки (радиус 24px, отступы 16px от краёв окна), а не классическая сплошная раскладка.

---

## 1. Каркас приложения

Скриншот: `tweb-dom/01-skeleton.jpeg`. Полный дамп: `tweb-dom/01-skeleton.json`.

```text
body.animation-level-2.rounded-sections.is-left-column-shown.has-horizontal-folders
  div > div._Layer_1kj7f_2                ← слой solid-js порталов
  svg [position:absolute; top:-10000px]   ← спрайт #svg-defs (message-tail-clip, story-item-clip и т.п.)
  div.sidebar-left-overlay
  div.whole.page-chats#page-chats
    div.tabs-container#main-columns
      div.folders-sidebar.sidebar-left-common#folders-sidebar        ← вертикальные папки (скрыт при has-horizontal-folders)
      div.tabs-tab.chatlist-container.sidebar.sidebar-left.main-column.sidebar-left-common.can-menu-have-z-index#column-left
        div.sidebar-slider.tabs-container
          div.tabs-tab.sidebar-slider-item.item-main.active
            div.sidebar-header.main-search-sidebar-header.can-have-forum.is-input-the-last-child
            div.stories-list
            div.sidebar-content.transition.zoom-fade.can-have-forum
              div.transition-item.active.has-filters               ← чатлист (#chatlist-container)
              div.transition-item.sidebar-search                   ← выдача поиска (#search-container)
              button.btn-new-menu.btn-circle.rp.btn-corner.z-depth-1.btn-menu-toggle.animated-button-icon   ← FAB (#new-menu)
              div.btn-circle.rp.btn-corner.z-depth-1.btn-update.is-hidden "UPDATE"
            div.topics-slider
        div.sidebar-resize-handle.sidebar-resize-handle-left
      div.tabs-tab.main-column#column-center [--page-chats-padding: 16px]
        div.chats-container.tabs-container
          div.chat.tabs-tab.active
        div.pinned-container.pinned-call > …topbar-call-center…
        div.pinned-container.pinned-audio > …progress-line…
      div.tabs-tab.sidebar.sidebar-right.main-column#column-right
        div.sidebar-content.sidebar-slider.tabs-container
        div.sidebar-resize-handle.sidebar-resize-handle-right
  div.night [display:none]                ← ночной оверлей темы
  div.emoji-animation-container
```

### Computed (ключевое)

| Элемент | Значения |
|---|---|
| `body` | bg `#181818`, color `#fff`, font 16px/24px, `transition: background-color .2s`, overflow hidden |
| `#main-columns` | flex row, min-width 100%, `transition: opacity .3s cubic-bezier(.4,0,.2,1)` |
| `#folders-sidebar` | width 72px, border-radius 24px, absolute top/left/bottom 16px, z-index 1 (пустой при горизонтальных папках) |
| `#column-left` | **360×909**, margin `16px 0 16px 16px`, **border-radius 24px**, box-shadow `0 0 4px rgba(0,0,0,.24)`, overflow hidden, z-index 1, `transition: transform .2s ease-in-out, opacity .2s ease-in-out` |
| `#column-center` | absolute inset 16px, `transform: translateX(188px)` (сдвиг под открытый чатлист: 360+16+12), `transition: transform .25s cubic-bezier(.4,0,.2,1)` |
| `#column-right` | 360×909, border-radius 24px, box-shadow как у левой, absolute right 16, z-index 3, спрятан через `transform: translateX(376px)` |
| `.sidebar-resize-handle-left` | width 5px, bg `--primary-color` #8774e1, opacity 0 (до hover), z-index 3 |

### CSS-переменные (:root, night)

`--right-column-width: 360px`, `--surface-color: #212121`, `--background-color: #181818`, `--primary-color: #8774e1`, `--message-out-background-color: #8774e1`. Переменных `--border-radius*` на :root нет (радиусы захардкожены в правилах секций).

---

## 2. Чат-лист (левая колонка)

Скриншот: `tweb-dom/01-skeleton.jpeg`. Полный дамп: `tweb-dom/02-chatlist.json`.

### Шапка сайдбара

```text
div.sidebar-header.main-search-sidebar-header.can-have-forum.is-input-the-last-child   ← 360×56, padding 0 8px 0 16px, flex/space-between
  div.sidebar-header-search-trigger
    button.btn-icon.rp > div.c-ripple + span.tgico.button-icon
  div.sidebar-header__btn-container.left-sidebar-burger
    div.animated-menu-icon                                   ← бургер↔стрелка (CSS-морф)
    button.btn-icon.rp.btn-menu-toggle.sidebar-tools-button.is-visible
      div.c-ripple
      span.badge.badge-20.badge-primary.is-badge-empty.sidebar-tools-button-notifications
    div.btn-icon.sidebar-back-button
  div.input-search.old-style                                 ← 280×44, margin 0 8px
    input.input-field-input.is-empty.input-search-input.with-focus-effect [type=text placeholder=" "]
    div.input-field-border
    span.tgico.input-search-part.input-search-icon.will-animate
    button.btn-icon.input-search-clear.input-search-part.input-search-button
    span.i18n.input-search-placeholder.will-animate "Search"
```

- `input`: height 44, **border-radius 22px**, padding `0 49px`, bg `--background-color` #181818 (в этом редизайне поле темнее поверхности), `transition: background-color .2s ease-in-out, border-color .2s ease-in-out`, border 1px solid transparent.
- Кнопка бургера: 40×40, border-radius 50%, padding 8, icon font-size 24, color #aaa, `transition: color .15s, opacity .15s`.

### Stories-ряд

Есть в DOM даже без активных сторис — схлопнут translateY:

```text
div.stories-list
  div._ListContainer_176w2_77.disable-hover [transform: translateY(-69px); --progress: 1]   ← solid-css-module
    div.scrollable.scrollable-x
      div._List_176w2_1._space-evenly_176w2_5
```

Родительский `transition-item` несёт `--stories-scrolled: 92px`.

### Табы папок (горизонтальные, `has-horizontal-folders`)

```text
div.menu-horizontal-div#folders-tabs                       ← height 48, padding 4px 0, bg --surface-color #212121
  div.menu-horizontal-div-item.active [data-filter-id="0"] ← height 40, padding 0 16, margin 0 4, border-radius 20, font 500 16/21, color --primary
    i.menu-horizontal-div-item-background                  ← «пилюля» фона активного таба
    div.menu-horizontal-div-item-span
      span.text-super > span.i18n "All"
      div.badge.badge-20.badge-primary.is-badge-empty "0"  ← бейдж есть всегда, пустой = класс is-badge-empty
  div.menu-horizontal-div-item [data-filter-id="2"] …      ← остальные папки аналогично
```

Обёртки: `div.menu-horizontal-gradient-container.folders-tabs-gradient-container` (градиентные края) + `div.menu-horizontal-scrollable.folders-tabs-scrollable > div.scrollable.scrollable-x`.

**Внимание:** в этом редизайне табы НЕ подчёркивание-стиль (`menu-horizontal-div-item` — пилюли с `i.menu-horizontal-div-item-background`), список чатов лежит в **карточке** `ul.chatlist` с bg `--surface-color` #212121, margin `0 8px`.

### Контейнер списка

```text
div.transition-item.active.has-filters [--stories-scrolled: 92px]      ← #chatlist-container
  div.connection-status-bottom [--chatlist-overlay-height: 296px]
    div.chatlist-overlay                                                ← нотисы + табы папок (скроллятся вместе)
  div.tabs-container
    div.scrollable.scrollable-y.tabs-tab.chatlist-parts.folders-scrollable.scrolled-start.scrollable-y-bordered.active [data-filter-id="0"]
      div.chatlist-top                                                  ← тут ul.chatlist
      div.chatlist-bottom
    …по одному scrollable на каждую папку (неактивные пустые)
```

### Строка диалога (полное дерево)

Обычная (с draft):

```text
a.row.no-wrap.row-with-padding.row-clickable.hover-effect.rp.chatlist-chat.chatlist-chat-bigger.row-big._Item_5idej_1
    [data-peer-id="444077753" href="#444077753" style="top: 0px"]      ← виртуализация: absolute top
  div.c-ripple
  div.row-row.row-subtitle-row.dialog-subtitle.has-multiple-badges
    div.row-subtitle.no-wrap.dialog-subtitle-flex
      span.dialog-subtitle-span.dialog-subtitle-span-overflow
        span.danger > span.i18n "Draft"
      span.dialog-subtitle-span.dialog-subtitle-span-overflow.dialog-subtitle-span-last
  div.row-row.row-title-row.dialog-title
    div.row-title.no-wrap.user-title
      span.peer-title [data-peer-id="444077753"] "123 123"
    div.row-title.row-title-right.row-title-right-secondary.dialog-title-details
      span.message-status.sending-status.hide
      span.message-time > span.i18n "16:11"
  div.avatar.avatar-like.avatar-54.avatar-gradient.dialog-avatar.row-media.row-media-bigger [data-peer-id]
    img.avatar-photo
```

Замьюченный канал добавляет на `a`: `.is-muted.forwards`; в титуле — `span.tgico.dialog-muted-icon`; titled-peer с эмодзи-статусом: `span.peer-title.with-icons > span.peer-title-inner + span.emoji-status.media-sticker-wrapper > canvas.lottie`. Превью медиа в сабтайтле: `div.dialog-subtitle-media.media-container.no-background > img.media-photo`. Кастом-эмодзи в превью: `custom-emoji-renderer-element.custom-emoji-renderer > canvas.custom-emoji-canvas` + `custom-emoji-element.custom-emoji.media-sticker-wrapper`.

**Порядок детей в DOM: subtitle → title → avatar** (визуальный порядок задаёт CSS, не DOM!).

### Computed строки

| Элемент | Значения |
|---|---|
| `a.chatlist-chat` | 344×72, padding `0 12px 0 72px`, **border-radius 16px**, absolute (virtual list, `style="top: Npx"`), flex column center |
| hover | `html.no-touch .chatlist-chat:hover … { --background: var(--light-filled-secondary-text-color) }`; общий `html.no-touch .hover-effect:hover { background-color: var(--light-secondary-text-color) }` |
| `ul.chatlist` | bg #212121 (карточка), margin 0 8px, flex column |
| аватар `.avatar-54` | 54×54, border-radius 50%, top/left 9px, font 500 20px, bg linear-gradient персональный |
| `.user-title` | font 400 16/22 |
| `.dialog-subtitle` | margin-top 2px, height 22, color вторичный |
| `span.message-time` | справа в `.dialog-title-details` |

### FAB (#new-menu)

```text
button.btn-new-menu.btn-circle.rp.btn-corner.z-depth-1.btn-menu-toggle.animated-button-icon
  span.tgico.animated-button-icon-icon.animated-button-icon-icon-first    ← карандаш
  span.tgico.animated-button-icon-icon.animated-button-icon-icon-last     ← крест (для морфа)
  div.c-ripple
```

Computed: **54×54**, border-radius 50%, bg `--primary-color`, right/bottom 20px, z-index 1, `transition: transform .2s cubic-bezier(0.34, 1.56, 0.64, 1)` (пружинка).

**Нет данных:** бейдж unread (`.dialog-subtitle-badge-unread`) и иконка пина — в аккаунте все диалоги прочитаны и нет запиненных со значком.

---

## 3. Открытый чат

Скриншот: `tweb-dom/03-chat-123.jpeg`. Дампы: `tweb-dom/03-chat-topbar.json`, `03-bubbles-123.json`, `03-chat-overview.json`. Чат: приватный «123 123».

### Структура .chat

```text
div.chat.tabs-tab.active.forwards.can-click-date.is-helper-active [--chat-input-height-surplus: 48px; --pinned-floating-height:]
  div.sidebar-header.topbar.has-avatar
    div.chat-info-container
    div.topbar-floating-plates.hide            ← pinned message / requests / actions / translation / sponsored
  div.bubbles.scrolled-down.has-groups.has-sticky-dates
    div.bubbles-remover-container > div.bubbles-remover.bubbles-inner
    div.scrollable.scrollable-y.bubbles-scrollable
      div.bubbles-padding.bubbles-padding-top [height: 72px]
      div.bubbles-inner.has-rights
      div.bubbles-padding.bubbles-padding-bottom [height: 112px]
    div.bubbles-floating-separators-container
  div.bubbles-viewport.disable-hover
  div.chat-input.chat-input-main
    div.chat-input-container.chat-input-main-container
```

### Топбар (в этом редизайне — плавающая «пилюля»!)

```text
div.sidebar-header.topbar.has-avatar        ← 696×48, border-radius 24px, bg #212121, box-shadow 0 1px 5px -1px rgba(0,0,0,.21),
                                              position absolute, центрирован, max-width 696px, z-index 2,
                                              transition: transform .3s cubic-bezier(.4,0,.2,1), margin-bottom, background-color .3s
  div.chat-info-container
    button.btn-icon.sidebar-close-button > span.tgico + span.badge.badge-20.badge-primary.is-badge-empty.back-unread-badge
    div.chat-info
      div.person
        div.avatar.avatar-like.avatar-40.avatar-gradient.person-avatar [data-peer-id] > img.avatar-photo   ← 40×40
        div.content
          div.top > div.user-title > span.peer-title "123 123"
          div.bottom > div.info > span.i18n "last seen recently"
    div.chat-utils                            ← набор button.btn-icon.rp (часть .hide), последний .btn-menu-toggle (⋮)
  div.topbar-floating-plates.hide
    div.pinned-container.pinned-message.hide
      button.btn-icon.rp.btn-menu-toggle.pinned-message-menu
      div.pinned-container-wrapper.pinned-message-wrapper.hover-primary-effect.rp
        div.c-ripple
        div.pinned-message-border > div.pinned-message-border-wrapper-1
        div.pinned-container-content.pinned-message-content
          div.animated-super.pinned-message-media-container
          div.pinned-container-title.pinned-message-title > span.i18n "Pinned Message" + div.animated-counter
          div.pinned-container-subtitle.pinned-message-subtitle > div.animated-super
      div.pinned-message-action > button.btn-icon.pinned-message-unpin.rp
    div.pinned-container.pinned-requests.hide | .pinned-actions.hide | .pinned-live.hide | .pinned-translation.hide | .pinned-remove-fee.hide | .pinned-sponsored.hide
```

### Лента: обёртки

- `.bubbles-inner`: flex column, justify-content flex-end, **max-width 696px**, absolute, `transition: transform .25s cubic-bezier(.4,0,.2,1)` (сдвиг при открытии правого сайдбара — тут transform `translateX(-348px)`).
- `section.bubbles-date-group` → внутри: `div.bubble.service.is-date` (+ дубль `.is-fake` для sticky-механики), `div.sticky_sentinel.sticky_sentinel--top`, затем `div.bubbles-group` (первая — `.bubbles-group-first`, последняя — `.bubbles-group-last`).
- Сообщения одной минуты группируются в один `.bubbles-group`; внутри бабблы получают `.is-group-first` / `.is-group-last`.

### Классы баблов (инвентарь из этого чата)

```
bubble service is-date [is-fake|is-sticky]
bubble hide-name is-out can-have-tail is-read is-group-first is-group-last          ← текст исходящий
bubble hide-name is-in can-have-tail is-group-first is-group-last                   ← текст входящий
bubble voice-message min-content is-single-document hide-name is-out can-have-tail is-read|is-sent …
bubble channel-post with-beside-button forwarded must-have-name is-out …            ← форвард из канала
bubble emoji-big can-have-big-emoji sticker sticker-animated is-message-empty has-floating-time just-media …
bubble hide-name photo has-plain-media-tail is-message-empty has-floating-time is-out …
```

`is-read` → тик прочитано; `is-sent` → один тик. Статусы только на is-out.

### Бабл: текст исходящий (mid 21335, с реакцией)

```text
div.bubble.hide-name.is-out.can-have-tail.is-read.is-group-first.is-group-last [data-mid data-peer-id data-timestamp]
  div.bubble-content-wrapper                       ← flex column, max-width min(100%, 480px)
    div.bubble-content                             ← bg --message-out-background-color #8774e1, border-radius 15px 15px 0 (хвост справа-снизу), box-shadow 0 1px 2px rgba(16,35,47,.15), min-width 56px
      div.message.spoilers-container               ← margin 4px 8px 5px, font 16/21
        span.clearfix
        reactions-element.reactions.reactions-block.reactions-like-block
          reaction-element.reaction.reaction-block.reaction-like-block.is-last.is-chosen.forwards
            div.reaction-sticker.is-regular.media-sticker-wrapper > img.media-sticker
            div.stacked-avatars [--avatar-size: 24px]
              div.stacked-avatars-avatar-container.is-first.is-last
                div.avatar.avatar-like.avatar-24.avatar-gradient.stacked-avatars-avatar [data-peer-id] "Д"
          span.time > span.tgico.time-sending-status + span.i18n "09:32" + div.time-inner (дубликат)
      svg.bubble-tail > use [href="#message-tail-filled"]
```

- `span.time`: font 12/12, margin `2px 0 0 3px`, внутри **дубликат** содержимого в `div.time-inner` (для фона-плашки).
- Входящий (mid 21395): то же, `bubble-content` bg `--surface-color` #212121, border-radius `15px 15px 15px 0`, есть `span.translatable-message "текст"`, у входящих нет `time-sending-status`. На бабле inline-переменные `--peer-color-rgb: var(--peer-0-color-rgb); --peer-border-bac…`.

### Бабл: голосовое (mid 21397)

```text
div.bubble.voice-message.min-content.is-single-document.hide-name.is-out.can-have-tail.is-read.is-group-last
  div.bubble-content-wrapper
    div.bubble-content                             ← 299×64; в группе (не first): border-radius 15px 5px 0 15px
      div.bubble-content-background
      div.message.spoilers-container
        span.clearfix
        div.document-container.is-first.is-last [data-mid data-peer-id]
          div.document-wrapper
            audio-element.is-out.audio.is-unread.is-voice.can-transcribe [data-mid data-peer-id]
              div.audio-toggle.audio-ico
                div.audio-play-icon > div.part.one + div.part.two     ← CSS-морф play/pause
              div.audio-waveform-container
                div.audio-waveform.audio-waveform-background > svg.audio-waveform-bars > rect.audio-waveform-bar ×N
                div.audio-waveform.audio-waveform-fake      > svg.audio-waveform-bars > rect ×N   ← прогресс-копия
              div.audio-time "0:01"
              div.audio-to-text-button > span.tgico
              span.time (как у текста, с time-inner)
              span.clearfix
      svg.bubble-tail > use [href="#message-tail-filled"]
```

### Бабл: форвард из канала (mid 21341)

```text
div.bubble.channel-post.with-beside-button.forwarded.must-have-name.is-out.can-have-tail.is-read.is-group-first.is-group-last
    [style="--peer-color-rgb: var(--message-out-primary-color-rgb); --pe…"]
  div.bubble-content-wrapper
    div.bubble-content
      div.name.floating-part.next-is-message
        span.i18n.bubble-name-forwarded
          br.hide-ol
          div.avatar.avatar-like.avatar-20.avatar-gradient.bubble-name-forwarded-avatar [data-peer-id] "к"
          span.peer-title "канал"
      div.message.spoilers-container
        span.time > span.tgico.time-sending-status + span.post-views "5" + span.tgico.time-icon.time-part.time-icon-views + span.i18n "23:04" + div.time-inner(дубль)
        span.clearfix
      div.bubble-beside-button.with-hover.forward > span.tgico     ← круглая кнопка «переслать» сбоку
      svg.bubble-tail > use [href="#message-tail-filled"]
```

### Бабл: большой анимированный эмодзи (mid 21391)

```text
div.bubble.emoji-big.can-have-big-emoji.sticker.sticker-animated.is-message-empty.has-floating-time.just-media.hide-name.is-out.is-read…
    [style="--emoji-size: 96px; --peer-color-rgb: var(--message-empty-pr…"]
  div.bubble-content-wrapper
    div.bubble-content [min-width/min-height 112px; max-width min(100%, 11…)]
      div.attachment.media-sticker-wrapper [width/height 112px] > canvas.lottie
      span.time.is-floating > …time-sending-status + i18n + div.time-inner
```

### Бабл: фото (mid 21393, с реакцией)

```text
div.bubble.hide-name.photo.has-plain-media-tail.is-message-empty.has-floating-time.is-out.can-have-tail.is-read…
  div.bubble-content-wrapper
    div.bubble-content [max-width: min(100%, 277px)]     ← 277×400, border-radius 15px 15px 0
      div.attachment.media-container.no-background [width 277px; height 400px] > img.media-photo   ← border-radius 15px, border 1px solid цвета бабла, max-width min(420px, 100%)
      span.time.is-floating > …
      svg.bubble-tail > use [href="#message-tail-filled"]
    reactions-element.reactions.reactions-block.reactions-like-block   ← у media-бабла реакции СНАРУЖИ bubble-content
      reaction-element.reaction.reaction-block.reaction-like-block.is-last.is-chosen.forwards …
```

### Сервисный бабл (дата)

```text
div.bubble.service.is-date
  div.bubble-content                       ← border-radius 14px, центрирован margin auto
    div.service-msg "July 19"              ← padding 4.5px 10px, border-radius 14px, font 500 15/20, bg rgba(119,48,144,.4) (полупрозрачный от темы)
```

### Computed баблов (сводка)

| Что | Значение |
|---|---|
| `.bubble` | margin-bottom 6px (между группами), flex; is-out → `flex-direction: row-reverse`, z-index 1 |
| `.bubble-content-wrapper` | flex column, `max-width: min(100%, 480px)` |
| `.bubble-content` out | bg #8774e1, radius `15px 15px 0` (у group-middle: `15px 5px 0 15px`), shadow `0 1px 2px rgba(16,35,47,.15)`, min-width 56px |
| `.bubble-content` in | bg #212121, radius `15px 15px 15px 0` |
| `.message` | margin `4px 8px 5px`, font 16px/21px |
| `span.time` | 12px/12px, margin `2px 0 0 3px`, дубль в `.time-inner` |
| хвост | `svg.bubble-tail > use href="#message-tail-filled"` (спрайт в глобальном svg) |
| анимации открытия чата | новых CSSAnimation на баблах не было (transition-driven); при открытии чата center-колонка едет `transform .25s cubic-bezier(.4,0,.2,1)` |

---

## 3b. Дополнительные типы баблов (каналы/группы)

Дампы: `tweb-dom/03-album-channel.json` (альбом, канал «Доллхаус 18+»), `03-video-poll.json` (видео + sponsored, «Секспедиция»), `03-service-round.json` (сервисный + кружок, «канал»), `03-document.json` (файл, форум «тестовая»→General).

### Альбом (канал, с реакциями и комментами)

```text
div.bubble.channel-post.with-beside-button.with-replies.hide-name.photo.is-album.is-grouped.is-in.can-have-tail.is-group-first.is-group-last
    [data-mid data-peer-id data-timestamp style="--peer-color-rgb: var(--peer-2-color-rgb); --peer-border-bac…"]
  div.bubble-content-wrapper
    div.bubble-content [max-width: min(100%, 420px)]        ← radius 15px 15px 15px 0, bg #212121
      div.attachment.no-brb [width 420px; height 539px]     ← radius 15px 15px 0 0, border 1px solid цвета бабла
        div.album-item.grouped-item [data-mid style="width:100%; height:49.9072%; top:0%; left:0%; border-sta…"]   ← раскладка инлайн-процентами!
          div.album-item-media.media-container.no-background > img.media-photo
        …×5 (проценты по сетке, у угловых inline border-radius)
      div.message.spoilers-container.mt-shorter             ← подпись ПОД альбомом
        span.translatable-message > strong / a.anchor-url / span.emoji.emoji-native …
        span.clearfix
        reactions-element.reactions.reactions-block.reactions-like-block
          reaction-element.reaction.reaction-block.reaction-like-block.is-paid       ← платная (звёзды)
            div.reaction-sticker > svg.currency-star-icon
            div.sparkles-container > div.sparkles-sparkle [--sparkle-tx/--sparkle-ty/--sparkle-scale] "✦" ×11
          reaction-element.reaction.reaction-block.reaction-like-block               ← обычная
            div.reaction-sticker.is-regular.media-sticker-wrapper > img.media-sticker
            span.reaction-counter "57"
          reaction-element … div.reaction-sticker.is-custom > custom-emoji-element > video.media-sticker   ← кастом-эмодзи-реакция
          custom-emoji-renderer-element.custom-emoji-renderer.reactions-renderer > canvas.custom-emoji-canvas.reactions-renderer-canvas
          span.time > i.time-edited.time-part.i18n "edited" + span.post-views "16K" + span.tgico.time-icon.time-icon-views + span.i18n + div.time-inner(дубль)
      div.bubble-beside-button.with-hover.forward > span.tgico
      replies-element.replies.replies-footer
        div.stacked-avatars.replies-footer-avatars [--avatar-size: 30px] > div.stacked-avatars-avatar-container.is-first|is-last > div.avatar.avatar-30…
        span.replies-footer-text > span.i18n "29 Comments"
        span.tgico.replies-footer-icon.replies-footer-icon-next
        div.rp > div.c-ripple
      svg.bubble-tail > use[#message-tail-filled]
```

`album-item`: absolute, inline width/height/top/left в процентах, own border-radius по углам, фон-заглушка = сервисный полупрозрачный rgba.

### Видео (одиночное, с подписью)

```text
div.bubble.channel-post.with-beside-button.with-replies.hide-name.video.is-in.can-have-tail…
  div.bubble-content-wrapper
    div.bubble-content [max-width: min(100%, 320px)]
      div.attachment.media-container.media-container-fitted.no-brb.no-background [width 320; height 400]
        span.video-time > span.tgico.video-time-icon         ← 18px высота, radius 18px, bg rgba(0,0,0,.35), font 12, top/left 3px, z 2, transition opacity .3s
        canvas.canvas-thumbnail.thumbnail.media-photo
        div.media-container-aspecter [width 300; height 400] > img.media-photo + video.media-video
      div.message.spoilers-container.mt-shorter …подпись + reactions + time…
      div.bubble-beside-button.with-hover.forward
      replies-element.replies.replies-footer …
      svg.bubble-tail
```

В `translatable-message` разметка: `strong`, `em`, `a.anchor-url [href]`, `span.emoji.emoji-native`, `custom-emoji-element.custom-emoji.media-sticker-wrapper > svg.lottie-vector.media-sticker.thumbnail` (+ единый `custom-emoji-renderer-element` с canvas на бабл).

### Sponsored-бабл (реклама в канале)

```text
div.bubble.is-sponsored.invert-media.has-webpage.single-media.photo.is-square-photo.with-beside-button.hide-name.is-in.can-have-tail.is-group-last.is-group-first.avoid-selection [data-mid="-1" data-timestamp="0"]
  div.bubble-content-wrapper > div.bubble-content
    div.bubble-beside-button.bubble-beside-button-top.bubble-sponsored-hide > span.tgico
    div.message.spoilers-container.margin-bigger
      a.webpage.quote-like.quote-like-hoverable.has-square-photo.rp
        div.c-ripple
        div.webpage-quote.quote-like-border
          div.webpage-content
            div.webpage-preview-resizer > div.media-container.webpage-preview.no-background [48×48] > img.media-photo
            div.webpage-name > strong > span.i18n.text-capitalize "ad"
            div.webpage-title > strong "Ava Louise"
            div.webpage-text "Official Account"
            div.webpage-footer.is-button "SEND MESSAGE"
    svg.bubble-tail
```

Это же — образец webpage-превью (`a.webpage.quote-like` + `webpage-quote.quote-like-border`).

### Кружок (video note)

```text
div.bubble.channel-post.with-beside-button.round.is-message-empty.has-floating-time.just-media.hide-name.is-in…
  div.bubble-content-wrapper
    div.bubble-content [max-width: min(100%, 400px)]        ← 280×280, radius 15px, БЕЗ фона
      div.attachment.media-container.no-background [width 400; height 400 inline → фактич. 280×280]
        div.media-round.z-depth-1.is-paused [data-mid]
          canvas.video-round-canvas
          span.video-time > span.tgico.video-time-icon
          svg.progress-ring [transform: rotate(-90deg)] > circle.progress-ring__circle [stroke-dasharray/offset]
          video.media-video
        img.media-photo
      div.bubble-beside-button.with-hover.forward
      span.time.is-floating …
      svg.bubble-tail
      div.bubble-beside-button.bubble-beside-button--transcribe.with-hover.bubble-beside-button--lifted > span.tgico
      div.message [display:none] > audio-element.audio.is-voice…audio-with-thumb …   ← скрытый аудио-плеер для дорожки кружка
    reactions-element… (снаружи bubble-content, как у медиа)
```

### Файл/документ

```text
div.bubble.document-message.is-single-document.hide-name.is-out.can-have-tail.is-sent.is-group-first.is-group-last
  div.bubble-content-wrapper
    div.bubble-content                          ← 315×70
      div.bubble-content-background
      div.message.spoilers-container
        span.clearfix
        div.document-container.is-first.is-last [data-mid data-peer-id]
          div.document-wrapper
            div.document.ext-pdf.downloaded     ← padding-left 66px, margin 8px 0, flex column center
              div.document-ico                  ← 54×54, radius 6px, bg #df3f40 (цвет по ext), absolute left, padding-top 25px
                span.document-ico-text "pdf"
              div.document-name > middle-ellipsis-element "_Оферта_Марке…с_ЭЦП (1).pdf"   ← font 500 16/22.4
              div.document-size "311 KB"        ← font 14/18 (+ скрытый дубль для measure)
              span.time …
              span.clearfix
      svg.bubble-tail
```

### Сервисный экшен

```text
div.bubble.service.is-group-first.is-group-last [data-mid data-peer-id data-timestamp]
  div.bubble-content-wrapper? — НЕТ: сразу
  div.bubble-content > div.service-msg > span.i18n "Channel created"
```

`service-msg`: padding 4.5px 10px, radius 14px, font 15/20 (у is-date — font-weight 500, у экшена 400), bg полупрозрачный `rgba(119,48,144,.4)` (зависит от обоев).

### Reply-бабл (ответ на сообщение) — дамп `03-reply-audio.json`

```text
div.bubble.is-reply.hide-name.is-out.can-have-tail.is-group-first.is-sent [data-mid data-peer-id data-timestamp]
  div.bubble-content-wrapper
    div.bubble-content                                ← у group-first с продолжением: radius 15px 15px 5px
      div.reply.quote-like.quote-like-hoverable.quote-like-border.rp.mb-shorter
          [style="--peer-color-rgb: var(--message-out-primary-color-rgb); --pe…"]
          ← цитата ВНУТРИ bubble-content, ПЕРЕД .message: 120×42, margin 8px 8px −2px,
            border-radius 4px, bg rgba(255,255,255,.1) (от peer-color), font 14/18
        div.c-ripple
        div.reply-content
          div.reply-title > span.peer-title "Дн"       ← 14px/18
          div.reply-subtitle > span > span.i18n "Voice message"
      div.message.spoilers-container > span.time (…) + span.clearfix
      svg.bubble-tail > use[#message-tail-filled]
```

Та же структура `quote-like`, что и в reply-баре композера и webpage-превью — цветная полоска слева делается бордером `quote-like-border` (через `--peer-border-bac…`-переменные).

### Аудио-трек (песня) — дамп `03-reply-audio.json`

```text
div.bubble.audio-message.min-content.is-single-document.hide-name.is-out.can-have-tail.is-sent
  div.bubble-content-wrapper
    div.bubble-content                                ← 335×64; в группе: radius 15px 5px 5px 15px
      div.bubble-content-background
      div.message.spoilers-container
        span.clearfix
        div.document-container.is-first.is-last [data-mid data-peer-id]
          div.document-wrapper
            audio-element.is-out.audio.is-outgoing.audio-show-progress [data-mid data-peer-id]   ← padding-left 57, margin 8px 0
              div.audio-toggle.audio-ico[.playing]     ← 48×48, круг, bg #fff (на out-бабле)
                div.audio-play-icon > div.part.one + div.part.two
              div.audio-details
                div.audio-title > middle-ellipsis-element "я тимлид.mp3"   ← font 500 16/21
                div.audio-subtitle                     ← 14px
                  div.audio-time "1:46"
                  div.progress-line [--progress: 0.76] > div.progress-line__filled [width: N%] + input.progress-line__seek[type=range]
              span.time (+time-inner) + span.clearfix
      svg.bubble-tail
```

Отличия от voice: `audio-message` вместо `voice-message`, `audio-details` (title+subtitle+progress-line) вместо waveform, при загрузке исходящего — классы `is-outgoing.audio-show-progress`.

### Плашка Pinned Message в топбаре — дамп `03-pinned-plate.json`

При наличии пина `div.topbar-floating-plates` теряет `.hide` и висит **второй пилюлей под топбаром** (absolute top 56px, 696×48, radius 24, bg `--border-color` #0f0f0f как «щель», gap 1px, тот же shadow):

```text
div.pinned-container.pinned-message [data-mid="21402"]   ← 696×48, padding 4, bg #212121
  button.btn-icon.rp.btn-menu-toggle.pinned-message-menu
  div.pinned-container-wrapper.pinned-message-wrapper.hover-primary-effect.rp   ← 608×44, radius 8, padding 2px 4px
    div.c-ripple
    div.pinned-message-border > div.pinned-message-border-wrapper-1   ← полоска 3×40, radius 3, bg --primary; сегмент двигается transform: translateY() (мульти-пин)
    div.pinned-container-content.pinned-message-content
      div.animated-super.pinned-message-media-container
      div.pinned-container-title.pinned-message-title    ← font 500 14/18, color --primary, transition transform .2s ease-in-out
        span.i18n "Pinned Message" + div.animated-counter.is-last
      div.pinned-container-subtitle.pinned-message-subtitle ← 14/18; контент через div.animated-super > div.animated-super-row (слайд-смена при переключении пинов)
  div.pinned-message-action > button.btn-icon.pinned-message-unpin.rp   ← 40×40
```

Сервисный бабл о пине: `div.bubble.service > … div.service-msg > span.i18n > span.peer-title "Дн" + i > span…"🎵 …"` (текст «X pinned …» с инлайн-превью).

---

## 3c. Доснятые типы (форум «тестовая» → топик General, данные подготовлены пользователем)

Дамп: `tweb-dom/03c-sticker-poll-video.json`. Скриншот: `03c-testchat.jpeg`.

### Обычный стикер (не emoji-big)

```text
div.bubble.sticker.sticker-animated.is-message-empty.has-floating-time.just-media.hide-name.is-out.is-sent
    [style="--peer-color-rgb: var(--message-empty-primary-color-rgb); --…"]
  div.bubble-content-wrapper
    div.bubble-content [style="min-width: 200px; min-height: 200px; max-width: min(100%, 20…"]   ← 200×200, БЕЗ фона/тени,
                                                                     border-radius в группе 15px 5px 5px 15px (стикеру не виден — фона нет)
      div.attachment.media-sticker-wrapper [width/height 200px] > canvas.lottie
      span.time.is-floating       ← absolute, внизу-справа ПОВЕРХ стикера: 18px высота, padding 0 5px, font 12/12,
                                    transition opacity .3s cb(.4,0,.2,1); фон-плашку даёт .time-inner
        span.tgico.time-sending-status + span.i18n "16:46" + div.time-inner (дубль)
```

Отличие от emoji-big: тот же набор классов минус `emoji-big.can-have-big-emoji` и без `--emoji-size`; бокс **200×200** (у emoji-big 112×112 c `--emoji-size: 96px`). У бабла margin-bottom **2px** (не 6): между just-media в группе зазор меньше.

### Poll-бабл (исходящий, не отвеченный)

Внутренности — **новая solid-js разметка с CSS-модульными классами** (не старый `poll-element`!):

```text
div.bubble.poll-message.hide-name.is-out.can-have-tail.is-group-first.is-sent
  div.bubble-content-wrapper
    div.bubble-content            ← 260×258, bg out, radius 15px 15px 5px
      div.attachment.no-brb
      div.message.spoilers-container.mt-shorter
        div.poll-message-content._container_t24sq_1._outgoing_t24sq_57
          div._header_t24sq_348
            div._headerTitleContainer_t24sq_354
              div._headerTitle_t24sq_354 > span.translatable-message "Секс"       ← вопрос
              div._headerSubtitle_t24sq_363 > span.i18n "Poll"                     ← тип опроса
          div._pollOption_t24sq_8 ×N
            div._clickableArea_t24sq_158._outgoing_t24sq_57 > div.c-ripple
            div._checkContainer_t24sq_246
              div._Checkbox_1jwdw_1._checkbox_t24sq_252._isOutgoing_1asv0_1
                div._Border_1jwdw_33 + div._Background_1jwdw_21 + svg._Check_1jwdw_1 > use[#check]
            div._pollOptionSpacerFirst_t24sq_140
            div._labelRow_t24sq_191 > div._labelText_t24sq_199 > span.translatable-message "Да"
          div [overflow:hidden] > div._pollOption…._isAddOption_t24sq_148._isOutgoing_t24sq_151   ← "Add an Option" (multi-выбор)
            … span.tgico._addOptionPlus_t24sq_397 …
          div._footer_t24sq_301 > div._footerButton_t24sq_308._outgoing_t24sq_57 > span.i18n "Select an option"
        span.time (+time-inner) + span.clearfix
      svg.bubble-tail
```

### Видео исходящее (только что загруженное)

```text
div.bubble.hide-name.video.has-plain-media-tail.is-message-empty.has-floating-time.is-out.can-have-tail.is-group-last.is-sent
  div.bubble-content-wrapper
    div.bubble-content [max-width: min(100%, 420px)]      ← 420×236, radius группы 15px 5px 0 15px
      div.attachment.media-container.no-background [width 420; height 236]   ← border 1px цвета бабла, radius 15px 5px 15px 15px
        span.video-time "17:32"                            ← длительность текстом (без иконки — иконка `video-time-icon` только у стриминга)
        button.btn-circle.video-play.position-center > span.tgico.button-icon   ← круглая кнопка Play по центру (у канального видео её не было — там автоплей)
        img.media-photo
      span.time.is-floating (+time-inner)
      svg.bubble-tail
```

В процессе аплоада бабл имел классы `is-outgoing … is-sending` (вместо `is-sent`) — состояние загрузки живёт на самом бабле.

### Документ #2 (mp4-файл)

Структура идентична §3b (`document.ext-mp4` вместо `ext-pdf`): `div.document-ico` получает **bg #ffffff** (цвет по расширению; у pdf был #df3f40), `middle-ellipsis-element "001 Введение.mp4"`, size "64.5 MB" с невидимым дублем для измерения.

**Unread-бейдж в чат-листе**: у строки этого чата бейджа не оказалось (свои сообщения) — по-прежнему не снят.

**Нет данных:** poll-бабл снят выше (исходящий); входящий канальный poll «Секспедиции» так и выпал из виртуализации.

---

## 4. Композер (chat-input)

Дампы: `tweb-dom/04-composer-rest.json`, `04-emoji-dropdown.json`, `04-attach-menu.json`. Чат «123 123» (в черновике уже был reply-хелпер — снят как есть, не отменялся).

### Полное дерево (в покое, с reply-баром)

```text
div.chat-input.chat-input-main                       ← 696×96, absolute bottom, max-width 696, transition transform .25s cb(.4,0,.2,1)
  div.chat-input-container.chat-input-main-container ← flex, align-items flex-end
    div.rows-wrapper-wrapper
      div.rows-wrapper.chat-input-wrapper.chat-input-main-wrapper.chat-rows-wrapper   ← border-radius 24px, bg #212121, shadow 0 1px 8px 1px rgba(0,0,0,.12), z 3
        div.autocomplete-helper.z-depth-1.autocomplete-peer-helper.bot-commands
        div.reply-wrapper.rows-wrapper-row            ← 48px, padding 0 4px, transition height .25s cb(.4,0,.2,1), overflow hidden
          div.reply-wrapper-content [--peer-color-rgb: var(--peer-0-color-rgb)…]
            button.btn-icon.reply-icon
            div.reply.quote-like.quote-like-hoverable.quote-like-border.rp   ← 600×40, radius 8px, bg rgba(peer,.1), font 14/21
              div.c-ripple
              div.reply-content
                div.reply-title > span.i18n > span.peer-title "Дн"
                div.reply-subtitle > span > span.i18n "Voice message"
            button.btn-icon.reply-cancel
        div.autocomplete-helper.z-depth-1.stickers-helper | .emoji-helper | .commands-helper | .mentions-helper | .inline-helper
        div.new-message-wrapper.rows-wrapper-row      ← 48px, padding 4px, gap 4px, flex align-items flex-end
          attach-menu-button.btn-menu-toggle.attach-file._Container_bns2b_1.btn-icon.rp   ← 40×40 (слева! в отличие от старой раскладки tweb)
          div.input-message-container                 ← flex-grow
            div.input-message-input.is-empty.scrollable.scrollable-y.no-scrollbar.forwards [contenteditable=true style="max-height: 440px; height: 37px"]  ← font 16/21, padding 8px 0
            span.input-field-placeholder.i18n.is-empty "Message"
            div.input-message-input…input-field-input-fake [contenteditable=true]   ← фейк для измерения высоты
          button.btn-icon.btn-scheduled.float.hide.show
          button.btn-icon.toggle-reply-markup.float.hide.show
          button.btn-icon.hide.rp ×2  (звёзды/прочее)
          button.btn-icon.toggle-send-gift.float.hide.show
          button.btn-icon.toggle-emoticons             ← 40×40, СПРАВА перед send
          input [type=file display:none]
          div.voice-recording-panel.voice-recording-panel--recording   ← панель записи (всегда в DOM)
            button.btn-icon.voice-recording-cancel.danger.rp
            div.voice-recording-pill
              div.voice-recording-lead > div.voice-recording-dot + button.voice-recording-play (…--play/--pause иконки)
              canvas.voice-recording-waveform
              span.voice-recording-timer "0:00,0"
            button.btn-icon.voice-recording-pause-toggle.rp (…--pause/--mic)
          div.btn-send-container                      ← 48×40
            span.btn-send-stars-badge.stars-badge-base
            button.btn-icon.rp.btn-circle.btn-send.animated-button-icon.record   ← 48×40, border-radius 20px, bg --primary
              span.tgico.animated-button-icon-icon.btn-send-icon-send | -schedule | -edit | -record | -record-video | -forward   ← 6 иконок, морф классом на btn-send
            div.btn-send-effect-container
            div.btn-menu.menu-send.top-left           ← контекст-меню send (Send Without Sound / Schedule / Reminder / Send When Online / Remove Effect)
    div.fake-wrapper.fake-rows-wrapper
    div.fake-wrapper.fake-selection-wrapper
    button.btn-circle.btn-corner.z-depth-1.bubbles-corner-button.chat-secondary-button.bubbles-go-down.rp  ← кнопка «вниз» + badge.badge-24
    div.chat-input-control.chat-input-wrapper         ← плашка-замена инпута (START/Unblock/JOIN/Unmute/frozen/Unpin/Open Chat — все .hide кроме актуальной)
    button…bubbles-go-mention.bubbles-go-reaction ×3  ← кнопки @-упоминаний/реакций
```

### Состояние «есть текст»

- `.btn-send` меняет класс `record` → `send`; иконки морфят CSS-анимациями **`grow-icon` / `hide-icon`, 400ms linear** (сами кейфреймы делают cubic внутри) — `btn-send-icon-send` растёт, `btn-send-icon-record` прячется.
- `input-message-input` теряет `is-empty` (и плейсхолдер скрывается), высота инпута анимируется `transition: height` (duration ставится инлайн).
- В панели записи постоянно крутится `recordBlink` 1250ms linear (dot), но панель скрыта.

### Emoji-дропдаун (открыт кликом по toggle-emoticons)

```text
div.emoji-dropdown.active            ← 382×420, border-radius 20px, bg rgba(33,33,33,.75) (blur), shadow 0 5px 10px 5px rgba(16,35,47,.14),
                                       absolute bottom 56px, z 4, transition transform .2s + opacity .2s cb(.4,0,.2,1)
  div.emoji-container
    div.tabs-container
      div.tabs-tab.emoticons-container.emoji-padding.active.no-border-top
        div.menu-wrapper.emoticons-menu-wrapper.emoticons-will-move-up
          div.scrollable.scrollable-x > nav.menu-horizontal-div.no-stripe.justify-start.emoticons-menu > button.btn-icon.menu-horizontal-div-item.active + div.menu-horizontal-inner
        div.emoticons-content
          div.scrollable.scrollable-y.emoticons-will-move-up
            div.emoticons-search-container.emoticons-will-move-down > div.input-search.emoticons-search-input-container "Search Emoji"  ← 366×38, radius 16
            div > div.emoticons-categories-container.emoticons-will-move-down.emoticons-has-search.animated-item  ← категории; super-emoji 42×42, radius 12, font 34
      div.tabs-tab.emoticons-container.stickers-padding  (Stickers)
      div.tabs-tab.emoticons-container.no-menu.gifs-padding (GIFs)
  div.emoji-tabs.menu-horizontal-div.emoticons-menu.no-stripe   ← нижние табы: search | emoji.active | stickers | gifs | delete
```

Анимация открытия: **CSSTransition opacity + transform, 200ms cubic-bezier(0.4,0,0.2,1)** на `.emoji-dropdown.active`.

### Attach-меню (кликом по скрепке; закрыто Esc, пункты не кликались)

```text
div.btn-menu.top-right.active.was-open [style="bottom: 68px; left: 708px"]   ← 180×168, padding 4px 0, radius 16px,
                                       bg rgba(33,33,33,.75), shadow 0 0 10px rgba(0,0,0,.15), z 4,
                                       transition opacity/transform/visibility .2s cb(.4,0,.2,1)
  div.btn-menu-item.rp-overflow        ← 32px высотой, padding 4px 12px, margin 0 4px, radius 12px, font 500 14/18, transition transform .1s
    span.tgico.btn-menu-item-icon
    span.i18n.btn-menu-item-text "Photo or Video"
  … "Document", "Gift Premium", "Checklist", "Wallet" (у Wallet иконка span.btn-menu-item-icon.is-external.media-container > img.media-photo)
```

Анимации при открытии: btn-menu opacity/transform/visibility 200ms cb(.4,0,.2,1); ripple на кнопке: `ripple-effect` 700ms linear + fade 350ms ease.

---

## 5. Контекст-меню сообщения (правый клик по своему)

Дамп: `tweb-dom/05-context-menu.json`. Скриншот: `tweb-dom/05-context-menu.jpeg`.

```text
div.btn-menu.contextmenu.has-items-wrapper.center-right.active.was-open [style="min-width: 194px; left: …; top: …"]   ← position fixed, z 4, radius 16px
  div.btn-menu-reactions-container.btn-menu-reactions-container-horizontal.btn-menu-transition.is-visible [--height: 40px]
      ← полоска реакций НАД меню: 290×40, border-radius 40px, bg rgba(33,33,33,.75), margin-top −48px,
        transition opacity/transform/visibility .2s cb(.4,0,.2,1)
    div.btn-menu-reactions-bubble.btn-menu-reactions-bubble-big
    div.btn-menu-reactions
      div.btn-menu-reactions-reaction ×7
        div.btn-menu-reactions-reaction-scale
          div.btn-menu-reactions-reaction-appear.media-sticker-wrapper > canvas.lottie
          div.btn-menu-reactions-reaction-select.hide.media-sticker-wrapper
      button.btn-icon.btn-menu-reactions-more
  div.btn-menu-items.btn-menu-transition
    div.btn-menu-item.rp-overflow  ← «Today at 10:04» (дата сообщения) + hr
    div.btn-menu-item.rp-overflow ×N: Reply / Edit / Copy / Translate / Pin / Forward / Select
    div.btn-menu-item.rp-overflow.danger > span.tgico + span.btn-menu-item-text > context-menu-delete-option-text > span.i18n "Delete"
```

- Пункт: 32px, padding 4px 12px, margin 0 4px, radius 12px, font 500 14/18, `transition: transform .1s cb(.4,0,.2,1)` (scale-press).
- Анимации при открытии: обе части (`btn-menu-reactions-container`, `btn-menu-items`) — CSSTransition **opacity + transform + visibility 200ms cubic-bezier(0.4,0,0.2,1)**; на аватарках/шиммерах `wave` 2000ms linear (`btn-menu-item-loader shimmer`).
- Закрытие — Esc, класс `.active` снимается (та же транзишн-тройка в обратную сторону).

---

## 6. Попапы (Delete confirm, Forward)

Дампы: `tweb-dom/06-delete-popup.json`, `06-forward-popup.json`. Оба закрыты Cancel/Esc, ничего не удалено/не переслано.

### Delete confirm

```text
div.popup.popup-peer.popup-delete-chat.active      ← fixed, весь экран, bg rgba(0,0,0,.3), padding 30px, z 4,
                                                     transition opacity .15s cb(.4,0,.2,1) + visibility
  div.popup-container.z-depth-1.have-checkbox      ← 312×220, radius 40px (!), bg --background-color #181818, padding 12px 8px,
                                                     shadow тройной material (0 2px 2px…/0 3px 1px −2px…/0 1px 5px…),
                                                     transition transform .15s cb(.4,0,.2,1) (scale-in)
    div.popup-header
      div.avatar.avatar-like.avatar-32.avatar-gradient [data-peer-id] > img.avatar-photo
      div.popup-title > span.i18n "Delete message"  ← font 500 20/26
    p.popup-description > span.i18n "Are you sure you want to delete this mes…"
    label.checkbox-field.checkbox-ripple.hover-effect.rp   ← 296×48, radius 16, padding 4px 18px
      div.c-ripple
      input.checkbox-field-input [type=checkbox]
      div.checkbox-box > div.checkbox-box-border + div.checkbox-box-background + svg.checkbox-box-check > use[#check]
      span.checkbox-caption.i18n > span.peer-title "123" ("Also delete for …")
    div.popup-buttons
      button.popup-button.btn.danger.rp > span.i18n "Delete"    ← текст-кнопка 40px, radius 16, font 500 16, color #ff595a
      button.popup-button.btn.primary.rp > span.i18n "Cancel"   ← color --primary
```

Порядок кнопок в DOM: Delete, затем Cancel (визуально Cancel слева — row-reverse/выравнивание).

### Forward («Share with»)

```text
div.popup.popup-forward.active
  div.popup-container.z-depth-1                    ← 420px шириной, radius 40px, bg #181818
    div.popup-header
      button.btn-icon.popup-close > div.animated-close-icon
      div.popup-title > span.i18n "Share with"
    div.popup-body
      div.tabs-container
        div.selector.selector-round.selector-right.selector-multiselect-hidden.tabs-tab.active
          div.scrollable.scrollable-y.selector-scrollable
            div.menu-horizontal-gradient-container.selector-search-gradient-container > …selector-search-gradient
            div.sidebar-left-section-container.selector-search-section-container
              div.sidebar-left-section.selector-search-section > hr + div.sidebar-left-section-content
                div.selector-search-container > div.scrollable.scrollable-y "Search"   ← инпут 370×30, radius 15
            div.sidebar-left-section-container.search-group.search-group-contacts.search-group-people.popup-forward-top-peers.collapsable.search-group-with-scroll
              …div.scrollable.scrollable-x > ul.chatlist    ← топ-пиры ГОРИЗОНТАЛЬНО (ячейка 78×98, аватар сверху)
            div.popup-forward-folder-tabs-container.collapsable [top: 64px]
              …menu-horizontal-div > .menu-horizontal-div-item[data-filter-id] (табы папок внутри попапа!)
            div.selector-height-container
              div.sidebar-left-section-container.is-visible.selector-list-section-container
                …ul.chatlist                                ← вертикальный список диалогов
    div.popup-footer.popup-footer-abitlarger.popup-footer-floating.popup-forward-footer
      div.popup-forward-footer-content.is-hidden
        div.simple-message-input-container.animated-item.popup-forward-footer-item
          button.btn-icon.smile.simple-message-input-emoji
          div.input-message-container.simple-message-input-inputs > div.input-message-input… [contenteditable] + placeholder "Add a caption..." + fake
          button.simple-message-input-confirm.btn-primary.btn-color-primary > …tgico
    div.btn-menu.menu-send.top-left (Send Without Sound / Schedule / Reminder / Send When Online / Remove Effect)
```

---

## 7. Правый сайдбар (профиль пира)

Дампы: `tweb-dom/07-right-sidebar.json` (полное дерево), `07-right-computed.json`. Скриншот: `07-right-sidebar.jpeg`.

### Структура

```text
div.tabs-tab.sidebar.sidebar-right.main-column#column-right      ← 360×909, radius 24, shadow, transition transform .3s cb(.4,0,.2,1)
  div.sidebar-content.sidebar-slider.tabs-container
    div.tabs-tab.sidebar-slider-item.scrolled-start.scrollable-y-bordered.shared-media-container.profile-container.is-collapsed.active
      div.sidebar-header                                          ← 56px, absolute top, z 3, transition background-color .1s
        button.btn-icon.sidebar-close-button > div.animated-close-icon
        div.transition.slide-fade                                 ← два заголовка: "User Info" ↔ "имя + N stories/media" (меняются при скролле)
          div.transition-item.active > div.sidebar-header__title > span.i18n "User Info" + button.btn-icon.rp (edit)
          div.transition-item > div.sidebar-header__rows > __title(peer-title) + __subtitle > div.transition.slide-fade > transition-item ×N ("34 stories"/"1 media file"/"3 gifts"/"0 files"…)
        button.btn-icon.rp.btn-menu-toggle.hide
      div.sidebar-content > div.scrollable.scrollable-y
        div.profile-content
          div.profile-avatars-container.is-single                 ← height 276, transition padding-bottom .3s cb(.4,0,.2,1)
            div.avatar.avatar-120….profile-avatars-avatar-fake
            div.profile-avatars-avatars > div.profile-avatars-avatar.media-container.active > div.avatar.avatar-full… (108×108 в is-collapsed)
            div.profile-avatars-gradient (+ .profile-avatars-gradient-top)
            div.profile-avatars-tabs > div.profile-avatars-tab.active
            div.profile-avatars-arrow (+ .profile-avatars-arrow-next)
            div.profile-avatars-info
              div.profile-name > span.peer-title                  ← font 500 20/24; transition inset-inline-start/transform/color/max-width .3s cb(.4,0,.2,1)
              div.profile-subtitle > .profile-subtitle-rating (stars-rating-icon svg) + .profile-subtitle-text "last seen recently"
            div.profile-pinned-gifts | .profile-music-container | .profile-story-previews-container
          div.profile-content-delimiter
          div.sidebar-left-section-container > .sidebar-left-section.no-delimiter > .sidebar-left-section-content
            div.rp.row.row-with-icon.row-with-padding.row-clickable.hover-effect      ← 312×56, radius 16, padding 7px 16px 7px 72px
              div.c-ripple + div.row-title "+7 707 862 75 13" + div.row-subtitle > span.i18n "Phone" + span.tgico.row-icon
            …row.row-grid (Username, + div.row-right > button.btn-icon.qr.rp)
            label.rp.row.no-subtitle… (Notifications) → label.checkbox-field.checkbox-without-caption.checkbox-field-toggle
              input.checkbox-field-input + div.checkbox-toggle > div.checkbox-toggle-circle   ← трек 31×14, radius 24, bg --primary
        div.search-super
          …search-super-tabs-gradient-container
          div.search-super-tabs-scrollable.menu-horizontal-scrollable.sticky.backwards
            div.scrollable.scrollable-x.search-super-nav-scrollable
              nav.search-super-tabs.menu-horizontal-div            ← те же «пилюли» (высота 48/40, radius 20, bg #212121)
                div.menu-horizontal-div-item.rp[.active|.hide] > .c-ripple + i.menu-horizontal-div-item-background + span…
                  (Chats:hide / Stories / Members:hide / Media / [gifts] / Saved / Files:hide / Links:hide / Music:hide / Voice / Groups:hide / Similar Channels:hide)
            div.search-super-selection-container (для режима выделения)
          div.search-super-tabs-container.tabs-container
            div.search-super-tab-container.search-super-container-stories.tabs-tab.active
              …div.stories-album-wrapper > .stories-album-content > div.grid    ← grid, gap 1px, radius 24
                div.grid-item.search-super-item.media-container.no-background [data-mid data-peer-id] "0:18"  ← ~119×162 (сторис 2:3); у медиа было бы квадратное
            …search-super-container-media|gifts|saved|files|links|music|voice|groups|similar (+ div.preloader > svg.preloader-circular > circle.preloader-path)
  div.sidebar-resize-handle.sidebar-resize-handle-right
```

### Анимация открытия

CSSTransition **transform 300ms cubic-bezier(0.4,0,0.2,1)** одновременно на `#column-center` (сдвиг влево) и `#column-right` (въезд справа).

### Состояния шапки при скролле

- Начально: `.profile-container.is-collapsed.scrolled-start` (у этого пира аватар-хедер сразу компактный: круг 108×108, имя рядом со сдвигом-transform; фото на всю ширину — отдельное «expanded»-состояние, здесь не воспроизвелось).
- После скролла вниз: добавляется **`.header-filled`** (шапка получает фон), `scrolled-start` снимается; обратно — возвращается.
- `profile-name/profile-subtitle`: позиционируются через `left: 164px` + `transform: translateX(…)` с transition .3s — так делается «переезд» имени при коллапсе.

---

## 8. Настройки

Дампы: `tweb-dom/08-burger-menu.json`, `08-settings-root.json`, `08-general-settings.json`, `08-privacy.json`. Ничего не менялось (кроме темы, см. §12, с откатом).

### Бургер-меню

```text
div.btn-menu.bottom-right.active.was-open [style="top: 72px; left: 32px"]
  div.btn-menu-item.rp-overflow > div.avatar.avatar-24…btn-menu-item-avatar.active + span.btn-menu-item-text "Дн"   ← текущий аккаунт
  div.btn-menu-item "Add Account" · hr · "Saved Messages" · "My Stories" · "Contacts" · hr · "Wallet" (img-иконка) · hr · "Settings"
  div.btn-menu-item.rp-overflow.submenu-trigger > … span.submenu-label > .submenu-label-text "More" + span.tgico   ← подменю
```

Пункта «Dark Mode» в бургере этого билда нет — тема переключается радио-группой в General Settings.

### Settings root (слайдер в левой колонке)

```text
div.tabs-tab.sidebar-slider-item…item-secondary.profile-container.is-collapsed.settings-container.active
  div.sidebar-header > btn.sidebar-close-button + __title "Settings" + btn-icon ×2 + btn-menu-toggle
  div.sidebar-content > div.scrollable.scrollable-y
    div.profile-content.is-me
      div.profile-avatars-container.is-single …(как в профиле пира: avatar-full, gradient, info: имя + span.online "online")
      div.sidebar-left-section-container … row Phone / row Username
    div.sidebar-left-section-container > … div.profile-buttons
      div.rp.row.no-subtitle.row-with-icon.row-with-padding.row-clickable.hover-effect × N:
        Notifications and Sounds / Data and Storage / Privacy and Security / General Settings / Chat Folders /
        Stickers and Emoji / Speakers and Camera / Devices (+row-title-right "6") / Language (+right "English") / Keyboard Shortcuts
    div.sidebar-left-section-container … Telegram Premium (row-icon-premium-color) / Send a Gift
```

### General Settings

```text
div.tabs-tab.sidebar-slider-item…item-secondary.active
  div.sidebar-header > back + "General Settings"
  …div.sidebar-left-section-content
    div.sidebar-left-h2.sidebar-left-section-name > span.i18n "Settings"
    div.range-setting-selector                       ← слайдер размера текста
      div.range-setting-selector-details
        div.range-setting-selector-name "Message Text Size" + div.range-setting-selector-value "16"
      div.progress-line > div.progress-line__filled [width: 50%] + input.progress-line__seek [type=range]
    button.btn-primary.btn-transparent.rp "Chat Wallpaper"
    row "Power Saving Mode" (+right "Disabled")
  …секция "Color theme"
    div.scrollable.scrollable-x.themes-container     ← карточки тем
    form > label.rp.row… > label.radio-field > input[type=radio] + div.radio-field-main.i18n: Classic / Night / Day / Dark / System Default
  …секция времени: 12-hour / 24-hour (radio)
```

### Privacy and Security

```text
div.tabs-tab.sidebar-slider-item…item-secondary.dont-u-dare-block-me.active
  header "Privacy and Security"
  rows (row-subtitle НАД row-title в DOM): Blocked Users ("16 users") / Connected websites (hide) /
    Auto-delete messages ("Off") / Passcode Lock ("Off") / Two-Step Verification ("Off") /
    Login Email (значение под span.bluff-spoiler > span.bluff-spoiler-letter ×N — «спойлер»-маскировка) / …
```

Замечено: у строк настроек класс-порядок `row.row-with-icon.row-with-padding.row-clickable.hover-effect.rp`, сабтайтл в DOM стоит ПЕРЕД титулом.

---

## 9. Медиавьюер

Дамп: `tweb-dom/09-media-viewer.json`. Скриншот: `09-media-viewer.jpeg`. Открыт кликом по фото в «123 123», закрыт Esc.

```text
div.media-viewer-whole.active            ← fixed на весь экран, z 4, transition: visibility
  div.zoom-container                     ← кнопки −/+ и progress-line зума
    button.btn-icon + div.progress-line.with-transition > .progress-line__filled [width: N%] + input.progress-line__seek[type=range] + button.btn-icon
  div.overlays                           ← тёмный фон, CSSTransition opacity 200ms ease при открытии
    div.media-viewer
      div.media-viewer-content [padding-top: 80px; padding-bottom: 110px]
        div.media-viewer-container
          div.media-viewer-media [width/height inline]
  div.media-viewer-topbar.media-viewer-appear   ← 56px, absolute top, z 5, transition opacity .2s
    div.media-viewer-topbar-left
      button.btn-icon.rp.only-handhelds
      div.media-viewer-author.no-select
        div.avatar.avatar-44….media-viewer-userpic [data-peer-id]
        div.media-viewer-author-right > .media-viewer-name (peer-title) + .media-viewer-date ("yesterday at 17:49")
    div.media-viewer-buttons               ← 6 × button.btn-icon (в т.ч. .quality-download-options-button-menu.btn-menu-toggle), gap 4
    div.btn-icon.rp.only-handhelds.btn-menu-toggle
  div.media-viewer-movers
    div.media-viewer-switcher.media-viewer-switcher-left.hide  > span.tgico.media-viewer-sibling-button.media-viewer-prev-button
    div.media-viewer-switcher.media-viewer-switcher-right.hide > …next-button
    div.media-viewer-mover-wrapper
      div.media-viewer-mover.center.active [width/height inline; transform: translate3d(-50%,-50%,0)]
          ← transition: transform .2s, border-radius .2s, opacity .2s — «полёт» из бабла в центр
        div.media-viewer-aspecter          ← transition: width .2s, height .2s, transform .2s, border-radius .2s
          img.thumbnail
  div.media-viewer-caption.spoilers-container.hide > div.scrollable.scrollable-y   ← подпись (padding 8px 8px 0, 16/21)
```

Анимации открытия (CSSTransition, все 200ms ease): `opacity` на `.overlays` и `.media-viewer-topbar.media-viewer-appear`; `transform` на `.media-viewer-mover.opening.active` (класс **`.opening`** живёт только в момент полёта); `transform`+`width` на `.media-viewer-aspecter`.

---

## 10. Глобальный поиск

Дамп: `tweb-dom/10-global-search.json` (оба состояния: пустой фокус и запрос «a»).

Фокус в поле → в левой колонке `div.transition-item.sidebar-search` получает `.active` (чатлист-`transition-item` скрывается, транзишн `zoom-fade` контейнера):

```text
div.transition-item.sidebar-search.active     ← #search-container
  div.scrollable.scrollable-y
    div.search-super
      …search-super-tabs-gradient-container
      div.search-super-tabs-scrollable.menu-horizontal-scrollable.sticky
        div.scrollable.scrollable-x.search-super-nav-scrollable
          nav.search-super-tabs.menu-horizontal-div      ← пилюли: Chats(active) / Channels / Apps / Posts / Media / Links / Files / Music / Voice
        div.search-helper.hide
      div.search-super-tabs-container.tabs-container
        div.search-super-tab-container.search-super-container-chats.tabs-tab.active
          div.search-super-content-container.search-super-content-chats
            div.…search-group.search-group-contacts[.hide]      "Chats"       > .sidebar-left-h2 + ul.chatlist
            div.…search-group.search-group-contacts[.hide]      "Global search" > …
            div.…search-group.search-group-messages[.hide]      "Messages" + .sidebar-left-section-name-right "All Chats" > ul.chatlist
            div.…search-group.search-group-people.search-group-with-scroll     ← топ-пиры horizontal scroll (ul.chatlist)
            div.…search-group.search-group-recent.hide          "Recent" + right "clear"
        div.search-super-tab-container.search-super-container-channels|apps|posts|media|links|files|music|voice.tabs-tab
```

С запросом «a»: `.search-group-contacts` (Chats) и `.search-group-messages.forwards` теряют `.hide` и наполняются теми же строками `a.chatlist-chat` (глубже обреза дампа), «Recent»/топ-пиры прячутся. Секции = `.sidebar-left-section-container.search-group` + заголовок `.sidebar-left-h2.sidebar-left-section-name`.

---

## 11. Анимации при загрузке (hard reload)

Дамп-семплы (каждые ~350ms): `tweb-dom/11-load-anims.json`.

Хронология (t от старта документа):

| t | Состояние | Бегущие анимации |
|---|---|---|
| ~0.4s | колонки ещё 0px (каркас не смонтирован) | — |
| ~0.75s | #column-left 360px, #column-center 1696px — раскладка встала | — |
| ~1.1s | появились поиск/FAB | `grow-input` 250ms linear (иконка+плейсхолдер поиска), `grow-icon`/`hide-icon` 400ms linear (FAB-морф) |
| ~1.4s | чатлист-строки + аватарки + открытый чат | `opacity` 300ms ease (`bubble.service.is-date.is-sticky` — sticky-дата), `fade-in-opacity` 200ms linear (`avatar-photo.fade-in`), морфы `btn-send-icon-*` 400ms |
| ~2.1s+ | стабильно | только вечный `recordBlink` 1250ms linear (спрятанная точка записи) |

Выводы: контент появляется «оптом» между 0.75s и 1.4s; собственных стаггеров нет — только fade-in аватарок (200ms) и `grow-*` кейфреймы иконок. Прелоадеры — `svg.preloader-circular > circle.preloader-path` (с `rotate` 1000ms linear, замечен в emoji-дропдауне).

Нюанс: при первом hard-reload tweb сам себя перезагрузил с `?swfix=3` (service-worker fix) — на чистом холодном старте будет двойная навигация.

---

## 12. Тема (night ↔ day)

Дамп: `tweb-dom/12-theme-toggle.json` (полный дифф 107 переменных). Переключено радио в General Settings: System Default → Day → System Default (возврат подтверждён).

- Класс на `body`/`html` НЕ меняется — вся тема на CSS-переменных `:root` (инлайн, ставит themeController).
- Переключение анимируется точечными CSSTransition: `background-color` 200ms ease на `body`, `color` 150ms ease-in-out на btn-icon, `color` 250ms cb(.4,0,.2,1) на btn-primary, бордеры radio 100ms ease — т.е. каждый элемент со своим transition, глобального фейда нет.

Ключевые переменные (night → day):

| Переменная | night | day |
|---|---|---|
| `--background-color` | #181818 | #F4F4F5 |
| `--body-background-color` | #181818 | #FFFFFF |
| `--surface-color` | #212121 | #FFFFFF |
| `--primary-color` | #8774e1 | #2d7ed5 |
| `--message-out-background-color` | #8774e1 | #dfefff |
| `--message-out-primary-color` | #ffffff | #2d7ed5 |
| `--message-background-color` | #212121 | #F0F0F0 |
| `--secondary-text-color` | #aaaaaa | #8C8E91 |
| `--light-filled-secondary-text-color` | #2b2b2b | #f5f5f6 |
| `--light-secondary-text-color` | rgba(170,170,170,.08) | rgba(140,142,145,.08) |
| `--danger-color` | #ff595a | #DF3F40 |
| `--border-color` | #0f0f0f | #DFE1E5 |
| `--scrollbar-color` | rgba(255,255,255,.2) | rgba(0,0,0,.2) |
| `--saved-color` | #8774e1 | #2d7ed5 |

Всего изменившихся переменных: **107** (полный список в дампе).

---

## Неожиданности (живой DOM vs ожидания по исходникам)

1. **Это редизайн-режим tweb**: `body.rounded-sections.has-horizontal-folders` — плавающие колонки с radius 24px и отступами 16px, топбар чата и композер — отдельные «пилюли» (radius 24px) шириной ≤696px по центру, а не сплошные панели. Классическая раскладка из старых исходников не активна.
2. **Табы папок — горизонтальные пилюли** (`menu-horizontal-div-item` + `i.menu-horizontal-div-item-background`), не подчёркнутый стрип; бейджи каунтеров присутствуют всегда (`is-badge-empty`).
3. **Порядок детей строки диалога: subtitle → title → avatar** — визуальный порядок целиком на CSS.
4. **Чатлист виртуализирован** абсолютным позиционированием `style="top: Npx"` на `a.chatlist-chat` (+ CSS-модульные классы solid-js `_Item_5idej_1`), строки живут в карточке `ul.chatlist` с фоном #212121.
5. **`span.time` дублируется**: содержимое повторено в `div.time-inner` (плашка-фон у floating-времени). У видимого media-времени класс `is-floating`.
6. **Реакции у media-баблов лежат вне `bubble-content`** (сиблинг в `bubble-content-wrapper`); у текстовых — внутри `.message`.
7. **Хвост бабла — `svg.bubble-tail > use #message-tail-filled`** из глобального svg-спрайта в `<body>`.
8. **Раскладка альбома — инлайн-проценты** width/height/top/left на `.album-item` (+ инлайн border-radius по углам), не грид.
9. **Кружок (round video)** содержит скрытый `div.message[display:none]` с полноценным `audio-element` (плеер дорожки) + `svg.progress-ring`.
10. **Панель записи голоса всегда в DOM** композера, с вечно бегущей CSS-анимацией `recordBlink` (1250ms) — даже когда скрыта.
11. **Attach-кнопка (скрепка) — СЛЕВА** от инпута (кастом-элемент `attach-menu-button`), смайл — справа; send-кнопка 48×40 с 6 морфящимися иконками (grow-icon/hide-icon 400ms linear).
12. **Меню — btn-menu с blur-фоном** rgba(33,33,33,.75), radius 16, пункты 32px/font 500 14px; открытие всегда тройной transition opacity/transform/visibility 200ms cb(.4,0,.2,1).
13. **Попапы с radius 40px** (`popup-container`) на фоне rgba(0,0,0,.3); кнопки — текстовые, в DOM Delete идёт перед Cancel.
14. **Профиль**: имя/сабтайтл позиционируются `left:164px + translateX()` с transition 300ms (механика коллапса), при скролле добавляется класс `header-filled`; счётчики «34 stories/1 media file» — карусель `transition.slide-fade` в шапке.
15. **Тема без класса на body** — только перезапись 107 CSS-переменных, никакого глобального кроссфейда (каждый элемент анимирует свой transition).
16. **Дропдауны кастом-эмодзи рендерятся одним canvas** (`custom-emoji-renderer-element > canvas.custom-emoji-canvas`) на бабл/блок реакций, поверх которого плейсхолдеры `custom-emoji-element`.
17. **Sponsored-бабл** = обычный `.bubble.is-sponsored` с `a.webpage.quote-like` внутри (`data-mid="-1"`, `data-timestamp="0"`).
18. В бургер-меню **нет «Dark Mode»** — тема в General Settings (radio Classic/Night/Day/Dark/System Default) + карусель `themes-container`.

**Не удалось снять** (нет данных в аккаунте): бейдж unread в чатлисте, развёрнутое фото-хедер профиля (expanded avatar). Досняты по ходу (пользователь готовил данные): reply-бабл, аудио-трек, pinned-плашка (§3b), обычный стикер, poll, видео с play-кнопкой, mp4-документ (§3c).

21. **Poll — новая solid-js разметка** с CSS-модульными классами (`poll-message-content._container_t24sq_1`, `_Checkbox_1jwdw_1`), старого `poll-element` в этом билде нет.
22. **Обычный стикер = 200×200** (emoji-big — 112×112 с `--emoji-size: 96px`), `bubble-content` без фона/тени, время `is-floating` поверх; margin-bottom бабла 2px вместо 6px.
23. **video-time без иконки** у обычного видео (текст-длительность) + `button.btn-circle.video-play.position-center`; иконка `video-time-icon` и автоплей — у канальных видео. Состояние аплоада — классы `is-outgoing`/`is-sending` на бабле.

19. **Reply-цитата — единый паттерн `quote-like`** (бабл, композер, webpage, форвард-попап): `div.reply.quote-like.quote-like-hoverable.quote-like-border` + `--peer-color-rgb`; в бабле radius 4px/bg rgba(peer,.1), в композере radius 8px.
20. **Pinned-плашка — отдельная «пилюля» ПОД топбаром** (`topbar-floating-plates`, top 56px, gap 1px, bg-щель #0f0f0f), сегмент полоски пина ездит `translateY` внутри `pinned-message-border-wrapper-1`; смена контента — `animated-super`/`animated-counter`.

*Съёмка: Chrome DevTools MCP, isolated context `tweb-verify-j`, вкладка своя (page 6); в аккаунте ничего не отправлено/не удалено/не изменено (тема возвращена в System Default, черновики не тронуты).*

