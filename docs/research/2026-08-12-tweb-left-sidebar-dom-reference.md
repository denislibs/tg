# tweb: левая колонка — живой DOM-референс (поиск + настройки)

Снято 2026-08-12 с **боевого** `web.telegram.org/k` через расширение Chrome.
Дополняет [`2026-08-08-tweb-live-dom-reference.md`](2026-08-08-tweb-live-dom-reference.md),
где левая колонка была снята только на уровне списка чатов, а из настроек — три экрана.

Дампы: `tweb-dom/14-left-*.json`. Формат тот же, что у остальных дампов
(`tag.class1.class2 [attr="v"] "текст"`, отступ 2 пробела на уровень), поэтому они
разбираются `scripts/domdiff/parseDump.js` наравне со снятыми ранее.

## Как это снималось и что вырезано

Клиент под настоящим аккаунтом, поэтому режим работы — **только чтение**: навигация,
открытие экранов, ввод в поле поиска. Ничего не отправлялось, не переключалось и не
удалялось. Дамп собирает **структуру, а не содержимое**:

- текст берётся только у UI-узлов (`i18n`, `tgico`, `row-title`, `checkbox-caption`,
  `range-setting-selector-*`, …) — имена чатов (`peer-title`) и превью сообщений в дамп не попадают;
- `data-peer-id` заменён на `peer`, URL/blob/data — на `<url>`/`<blob>`/`<data>`;
- телефоны → `+N`, юзернеймы → `@username`, почта → `mail@example.com`,
  модель устройства и город в «Active Sessions» → `Устройство, ОС` / `City, Country`;
- подряд идущие однотипные соседи схлопнуты: показаны первые 3–4, дальше строка
  `… ещё N таких же` (списки чатов, гриды медиа, языки).

Технически дамп уезжал на диск через iframe на `127.0.0.1` (service worker tweb глушит
cross-origin `fetch`, а вывод js-инструмента режется на ~1.2 КБ). Скрипт-приёмник —
одноразовый, в репозиторий не входит.

---

## 1. Список чатов целиком — `14-left-01-chatlist.json`

```text
div.tabs-tab.chatlist-container.sidebar.sidebar-left.main-column.sidebar-left-common.can-menu-have-z-index   ← #column-left
  div.sidebar-slider.tabs-container
    div.tabs-tab.sidebar-slider-item.item-main.active
      div.sidebar-header.main-search-sidebar-header.can-have-forum.is-input-the-last-child
        div.sidebar-header-search-trigger > button.btn-icon.rp > .c-ripple + span.tgico.button-icon
        div.sidebar-header__btn-container.left-sidebar-burger.appear-animated
          div.animated-menu-icon
          button.btn-icon.rp.btn-menu-toggle.sidebar-tools-button.is-visible
            div.c-ripple + span.badge.badge-20.badge-primary.is-badge-empty.sidebar-tools-button-notifications
          div.btn-icon.sidebar-back-button                      ← бургер↔стрелка живут РЯДОМ, а не подменяются
        div.input-search.old-style
          input.input-field-input.input-search-input.with-focus-effect.is-empty
          div.input-field-border
          span.tgico.input-search-part.input-search-icon.will-animate
          button.btn-icon.input-search-clear.input-search-part.input-search-button
          span.i18n.input-search-placeholder.will-animate "Search"
      div.stories-list                                          ← height: 0 (см. ниже)
        div._ListContainer_176w2_77.disable-hover > .scrollable.scrollable-x > div._List_176w2_1._space-evenly_176w2_5
      div.sidebar-content.transition.zoom-fade.can-have-forum
        div.transition-item.has-filters.active
          div.connection-status-bottom                          ← ЭТОТ узел двигает список под ряд историй
            div.chatlist-overlay
              div._container_1nmtq_1
              div.undefined > div._suggestionContainer_19lnd_5   ← плашка «Enable notifications»
                div.rp.row.row-clickable.hover-effect._suggestion_19lnd_1._secondary_19lnd_18
                  .c-ripple + button.btn-icon.close._close_19lnd_40.rp
                  div.row-title > span.text-bold._suggestionTitle_19lnd_15
                  div.row-subtitle > span._suggestionSubtitle_19lnd_1
              div.menu-horizontal-gradient-container.folders-tabs-gradient-container
              div.menu-horizontal-scrollable.folders-tabs-scrollable > .scrollable.scrollable-x > div.menu-horizontal-div
                div.menu-horizontal-div-item.active > i.menu-horizontal-div-item-background + span…
              ul.chatlist.virtual-chatlist
                a.row…chatlist-chat.chatlist-chat-bigger.row-big._Item_5idej_1
```

Подтверждает механику, из-за которой у нас схлопывался отступ под развёрнутым рядом
историй (PR #193): **высоту ряду отдаёт не `.stories-list`**, а сдвиг
`.connection-status-bottom`; плашка-подсказка, табы папок и сам список лежат внутри
`.chatlist-overlay` под этим сдвигом.

Новое по сравнению с августовским снимком: `div.undefined > ._suggestionContainer_…` —
solid-js-плашка предложения (в нашем клиенте такого блока нет), и класс
`div.undefined` в проде, то есть у tweb там честный баг с неопределённым классом.

---

## 2. Поиск

### 2.1 Пустой запрос — `14-left-02-search-empty.json`

```text
#search-container.transition-item.sidebar-search.active
  div.search-super
    div.menu-horizontal-gradient-container.search-super-tabs-gradient-container
      div.menu-horizontal-gradient.menu-horizontal-gradient-color-background.search-super-…
    div.search-super-tabs-scrollable.menu-horizontal-scrollable.sticky
      div.scrollable.scrollable-x.search-super-nav-scrollable
        nav.search-super-tabs.menu-horizontal-div
          div.menu-horizontal-div-item.rp > i.menu-horizontal-div-item-background + span.menu-horizontal-div-item-span > span.i18n
          (Chats · Channels · Apps · Posts · Media · Links · Files · Music · Voice)
    div.search-super-tabs-container.tabs-container
      div.search-super-tab-container.search-super-container-chats.tabs-tab.active
        div.search-super-content-container.search-super-content-chats
          div.sidebar-left-h2.sidebar-left-section-name        ← «Recent» / «Global search» / «Messages»
          ul.chatlist
```

Табов **девять** — на два больше, чем было в снимке правого сайдбара: добавились
`Apps` и `Posts`. Гриды/списки всех девяти живут в одном `tabs-container`, неактивные
контейнеры пустые (лениво наполняются при активации).

### 2.2 Запрос → таб Chats — `14-left-03-search-chats.json`, `14-left-03b-search-chats-query.json`

Три секции подряд, у каждой свой `sidebar-left-h2.sidebar-left-section-name`:
**Chats** (свои диалоги) → **Global search** (+ ссылка `show more`, первой строкой может
идти рекламная с `Ad`-бейджем) → **Messages** (+ `All Chats`). Строки — те же
`a.row…chatlist-chat`, что и в списке чатов, с `div.row-subtitle.no-wrap` под именем
(юзернейм/телефон/число подписчиков).

`03b` снят по более «богатому» запросу — в нём есть все три секции и рекламная строка;
`03` — по односимвольному.

### 2.3 Остальные табы

| Дамп | Таб | Что внутри |
|---|---|---|
| `14-left-04-search-channels` | Channels | секции «Channels you joined» + «Similar Channels», строки-каналы с числом подписчиков |
| `14-left-05-search-apps` | Apps | **пусто** у этого аккаунта: только `div.search-super-content-apps` |
| `14-left-06-search-posts` | Posts | не результаты, а промо: `span._title_1q924_12` «Global Search» + описание + `Subscribe to Premium` + `._footer_1q924_57` «Global search is a Premium feature» |
| `14-left-07-search-media` | Media | `div.search-super-content-media-grid` → `div.grid-item.media-container.search-super-item` → `img.media-photo.grid-item-media`, у незагруженных — `canvas.canvas-thumbnail.thumbnail.media-photo.grid-item-media` |
| `14-left-08-search-links` | Links | `a.row.row-with-padding.row-clickable.hover-effect.search-super-item`: **сабтайтл идёт ПЕРВЫМ** (`div.row-subtitle` с `a.anchor-url`/`a.anchor-hashtag` и `span.sender-title > span.peer-title`), под ним `div.row-row.row-title-row` с заголовком сайта и `span.sent-time`; справа превью — `div.preview.media-container.no-background.row-media.row-media-big`, а без картинки `div.preview.empty.row-media.row-media-big` |
| `14-left-09-search-files` | Files | `div.document.ext-jpg.document-with-thumb.search-super-item` + `div.preloader-container.manual` с четырьмя svg (`preloader-circular`/`-path-new`/`-close`/`-download`) |
| `14-left-10-search-music` | Music | `audio-element.audio…search-super-item` |
| `14-left-11-search-voice` | Voice | `audio-element.audio.audio-48.search-super-item`, у непрослушанных — `.is-unread`, у кружков — `.audio-with-thumb` |

Пустой таб рисует `div.position-center.text-center.content-empty.no-select` — отдельного
класса под «пусто» нет, это позиционирующая обёртка.

**Важно для порта:** `search-super` в левой колонке — тот же компонент, что и в профиле
справа (те же `menu-horizontal-div-item`-пилюли, `search-super-tab-container`,
`grid-item`/`document`/`audio-element`). Правая колонка добавляет к нему только свои
табы (Stories/Members/Gifts/Similar).

---

## 3. Бургер-меню — `14-left-12-burger-menu.json`

```text
div.btn-menu.bottom-right.active.was-open
  div.btn-menu-item.rp-overflow > div.avatar.avatar-24…btn-menu-item-avatar.active + span.btn-menu-item-text   ← текущий аккаунт
  div.btn-menu-item "Add Account" · hr · "Saved Messages" · "My Stories" · "Contacts" · hr ·
  div.btn-menu-item "Wallet" (img-иконка) · hr · "Settings"
  div.btn-menu-item.rp-overflow.submenu-trigger > span.submenu-label > .submenu-label-text "More" + span.tgico
```

Совпадает с августовским снимком: «Dark Mode» в бургере нет, тема — радио-группой в General Settings.

---

## 4. Настройки

Корень — `14-left-13-settings-root.json`. Контейнер:
`div.tabs-tab.sidebar-slider-item…item-secondary.profile-container.is-collapsed.settings-container.active`,
внутри — `div.profile-content.is-me` с тем же аватар-хедером, что у профиля пира
(`profile-avatars-container.is-single`, `profile-avatars-gradient`, `profile-avatars-info`),
плюс `div.profile-pinned-gifts` / `div.profile-music-container` (у нас не портировано).
В шапке три кнопки: QR, карандаш (Edit Profile) и `btn-menu-toggle`.

Пункты: Notifications and Sounds · Data and Storage · Privacy and Security · General Settings ·
Chat Folders · Stickers and Emoji · Speakers and Camera · Devices · Language · Keyboard Shortcuts,
отдельной секцией — Telegram Premium · Send a Gift.

### Общие приёмы разметки (одинаковы во всех экранах)

- секция = `div.sidebar-left-section-container > .sidebar-left-section > .sidebar-left-section-content`,
  заголовок — `div.sidebar-left-h2.sidebar-left-section-name`, пояснение под секцией —
  `div.sidebar-left-section-content.sidebar-left-section-caption.i18n`;
- строка-переключатель — `label.rp.row.no-subtitle.row-clickable.hover-effect` →
  `div.row-row.row-title-row` → `div.row-title` + `div.row-title.row-title-right` →
  `label.checkbox-field.checkbox-without-caption.checkbox-field-toggle` → `input[type=checkbox]` + `div.checkbox-toggle > div.checkbox-toggle-circle`;
- строка-чекбокс с подписью — `span.checkbox-caption.i18n` вместо `row-title`;
- радио — `input[type=radio]` + `div.radio-field-main.i18n`;
- кнопка-строка — `button.btn-primary.btn-transparent.rp` (опасная — `.danger`, крупная — `.btn-color-primary.btn-large`);
- ползунок — `div.range-setting-selector > .range-setting-selector-details > (.range-setting-selector-name + .range-setting-selector-value) + div.progress-line > .progress-line__filled + input.progress-line__seek[type=range]`;
- сворачиваемый блок — `div.accordion [style="--max-height: …px"]` + `span.tgico.accordion-icon`.

### Экраны

| Дамп | Экран | Чем интересен |
|---|---|---|
| `14-left-14-settings-notifications` | Notifications | тумблеры Web Notifications, кнопка «Enable Notifications», ползунок **Sound Volume** (`range-setting-selector` + `progress-line`) |
| `14-left-15-settings-data-storage` | Data and Storage | чекбокс-заголовок «Auto-Download Media», три строки Photos/Videos/Files, кнопка сброса, секция «Estimated storage quota» со строками `row.row-grid` (размер + `Clear`) |
| `14-left-15b-settings-autodownload-photo` | → Auto-Download Photos | четыре чекбокса: Contacts / Private Chats / Group Chats / Channels |
| `14-left-16-settings-privacy` | Privacy and Security | строки со **сабтайтлом-значением над титулом**; Blocked Users, Connected websites, Auto-delete, Passcode Lock, Two-Step Verification, Login Email, Passkeys; ниже секция Privacy из строк-правил |
| `14-left-16b-settings-blocked-users` | → Blocked Users | список — обычные `a.row…chatlist-chat`, у удалённых аккаунтов `span.tgico.avatar-icon.avatar-icon-deletedaccount` |
| `14-left-16c-settings-passcode` | → Passcode Lock | solid-js `div._Container_xlod8_1 [--size: 100px]` (анимация-замок), `button.btn-primary.btn-color-primary.btn-large` «Turn Passcode On» |
| `14-left-16d-settings-privacy-rule` | → правило приватности | три радио (Everybody / My Contacts / Nobody), вторая радио-группа, секция **Exceptions** («Never Share With» / «Always Share With» + `Add Users`) |
| `14-left-17-settings-general` | General Settings | ползунок Message Text Size, «Chat Wallpaper», «Power Saving Mode»; секция Color theme — `div.scrollable.scrollable-x.themes-container` → `div.theme-container [--primary-color: …]` → `div.background-item-media` + `canvas._CanvasCommon_…._GradientCanvas_…`; радио тем и формата времени |
| `14-left-17b-settings-wallpaper` | → Chat Wallpaper | «Upload Wallpaper», «Set a color», «Reset to Defaults», чекбокс «Blur Wallpaper Image», грид `div.search-super-content-media-grid` → `div.background-item.grid-item` |
| `14-left-17c-settings-power-saving` | → Power Saving | самый насыщенный экран: мастер-тумблер + четыре `div.accordion` (Sticker Animations / Interactive Effects / Chat Animations / Interface Animations) с вложенными чекбоксами |
| `14-left-18-settings-folders` | Chat Folders | `button.btn-primary.btn-color-primary.btn-control` «Create Folder»; строки папок с `span.tgico.row-sortable-icon` (перетаскивание); секция Recommended Folders со строками `row-grid` и кнопкой `Add`; секция «Folders view» с радио |
| `14-left-18b-settings-folder-edit` | → Edit Folder | `div.input-field-input[contenteditable=true]` для имени; секции Included/Excluded Chats; `button.folder-category-button.btn.btn-primary.btn-transparent` для категорий (Contacts / Non-Contacts / Groups / Channels) и обычные строки чатов |
| `14-left-19-settings-stickers-emoji` | Stickers and Emoji | Quick Reaction со стикером в строке (`row-media.row-media-small.media-sticker-wrapper` + `svg.lottie-vector.media-sticker.thumbnail`), тумблеры, секции Emoji / Dynamic Pack Order / Stickers |
| `14-left-20-settings-speakers-camera` | Speakers and Camera | `div.microphone-level-meter` + `__fill [width: 0%]` — индикатор уровня микрофона |
| `14-left-21-settings-devices` | Devices (Active Sessions) | секция «This device» со строкой `row-midtitle` (устройство) + `row-subtitle` (город); `button.btn-primary.btn-transparent.danger` «Terminate All Other Sessions»; ниже «Active sessions» |
| `14-left-22-settings-language` | Language | секция Translate Messages (тумблеры + «Do Not Translate»), затем радио-список языков (`row-subtitle` — самоназвание) |
| `14-left-23-settings-shortcuts` | Keyboard Shortcuts | пять секций (Text Formatting / Messages / Chat / Navigation / Media), строки `row.no-subtitle.row-clickable.row-grid` — подпись слева, комбинация справа |
| `14-left-25-settings-edit-profile` | Edit Profile | `span.tgico.avatar-edit-icon` поверх `avatar-120`; поля `div.input-field-input[contenteditable=true]` (Name / Last Name / Bio) и `input.input-field-input[type=text]` (Username); секции «Username order», «Personal Channel», «Add Birthday» |
| `14-left-26-settings-header-menu` | ⋮ в шапке Settings | ровно один пункт — **Log Out** |
| `14-left-24-premium-popup` | Telegram Premium | не экран слайдера, а `div.popup.popup-premium.active`: радио-тарифы (`label.row…popup-gift…`, «Annual»/«Monthly» с ценой), список фич строками с `div.row-media.row-media-small.premium-promo-tab-icon [background-color]` и бейджем `span.i18n.row-title-badge` «New» |
| `14-left-29-compose-menu` | меню FAB (карандаш) | `div.btn-menu.top-left`: New Channel / New Group / New Private Chat |

---

## 5. Создание группы

Мастер из двух шагов, оба — обычные `sidebar-slider-item` левой колонки.

**Шаг 1, «Add Members»** (`14-left-30-new-group-members.json`) — не список с чекбоксами, а
отдельный компонент-селектор:

```text
div.sidebar-content
  button.btn-circle.btn-corner.z-depth-1.rp.is-visible      ← FAB «дальше» ВНУТРИ экрана, не в шапке
  div.selector.selector-square.selector-left
    div.scrollable.scrollable-y.selector-scrollable
      div.menu-horizontal-gradient-container.selector-search-gradient-container
      div.sidebar-left-section-container.selector-search-section-container
        div.sidebar-left-section.selector-search-section > hr + .sidebar-left-section-content
          div.selector-search-container > .scrollable.scrollable-y > div.selector-search
            div.input-search.selector-search-input-container > input.input-search-input.selector-search-input
      …ниже — список контактов строками chatlist-chat
```

**Выбранный участник** (`14-left-30b-…-selected.json`) — в `div.selector-search` перед полем
ввода появляется чип:

```text
div.selector-user.selector-user-primary.scale-in.is-last
  div.selector-user-avatar-container > div.avatar.avatar-30…selector-user-avatar > img.avatar-photo
  …имя + крестик
```

Классы `scale-in` и `is-last` — анимация появления чипа и маркер последнего в ряду.

**Шаг 2, «New Group»** (`14-left-31-new-group-name.json`):

```text
div.sidebar-left-section-content
  div.avatar-edit > canvas.avatar-edit-canvas + span.tgico.avatar-edit-icon    ← аватар рисуется канвасом
  div.input-wrapper
    div.input-field > div.input-field-input[contenteditable=true] + div.input-field-border + label > span.i18n "Group Name"
    div.input-field.hide > div.input-field-input.is-empty[contenteditable=false]   ← второе поле скрыто (описание — только у канала)
```

Кнопку создания не нажимали: группа с реальным участником создалась бы по-настоящему.
Поэтому пост-создательные экраны (тип группы, ссылка-приглашение) в этот заход не попали.

---

## 6. Правая колонка: канал глазами создателя (`15-right-*.json`)

Снято на свежесозданном канале — это закрывает пробел из
[августовского референса](2026-08-08-tweb-live-dom-reference.md), где справа был только
профиль привата, а все вторичные табы `sidebarRight/tabs/*` отсутствовали.

| Дамп | Экран | Чем интересен |
|---|---|---|
| `15-right-01-channel-profile` | Channel Info | тот же `profile-container`, что у привата, но у пустого канала — `div.profile-content.search-empty`, а в шапке-сабтайтле крутится `transition-item` по счётчикам («4 chats» / «0 photos» / «0 gifts»); все 12 пилюль `search-super` присутствуют и все с `.hide` |
| `15-right-02-edit-channel` | Edit | `avatar-placeholder` с `span.tgico.avatar-edit-icon`, два `div.input-field-input[contenteditable=true]` (Channel name, Description) и строки: Channel Type · Invite Links · Reactions · Direct Messages · Discussion · Recent Actions, затем Administrators · Subscribers · Removed users, затем тумблеры Auto-Translate / Sign Messages |
| `15-right-03-channel-type` | → Channel Type | `label.radio-field.disable-hover` — Private / Public; у приватного `div.row-title` со ссылкой + `button.btn-primary.btn-transparent.danger` «Revoke Link»; у публичного — `input.input-field-input[type=text]` под юзернейм |
| `15-right-04-invite-links` | → Invite Links | секции Invite Link (+`button.btn-primary.btn-color-primary.invite-link-button` «Share Link») / Additional Links (+«Create a New Link») / «Links created by other admins» / Revoked Links (+`danger` «Delete All Revoked Links») |
| `15-right-05-reactions` | → Reactions | мастер-тумблер «Enable Reactions» + список `row-title` с названиями эмодзи (Red Heart, Thumbs Up, …) — то есть реакции здесь строки-роу, а не грид |
| `15-right-06-administrators` | → Administrators | **не список, а тот же селектор**, что в «Add Members» слева, но в правом варианте: `div.selector.selector-round.selector-right` (слева было `selector-square.selector-left`) + `div.selector-height-container` |
| `15-right-07-subscribers` | → Subscribers | тот же `selector-round.selector-right` |
| `15-right-09-removed-users` | → Removed users | тот же селектор + пустое состояние |

Главная находка для порта: **участники/админы/удалённые — это один компонент-селектор**
с двумя модификаторами формы (`selector-square`/`selector-round`) и стороны
(`selector-left`/`selector-right`), а не три разных списка.

---

## Чего в этом заходе снять не удалось

Пункты бургера (**My Stories**, **Contacts**, **Saved Messages**) и **New Channel** из меню
FAB: синтетический клик по `.btn-menu-item` tweb не отрабатывает вообще, а настоящий
попадает уже по закрывшемуся меню — из трёх пунктов FAB воспроизводимо открылся только
«New Group». Сами меню сняты (`14-left-12`, `14-left-29`), не хватает целевых экранов.
Туда же — **Two-Step Verification** и **Auto-delete messages** из Privacy, **архив** и
**Connected websites**.

Экран «New Channel» по коду tweb — это шаг 2 группы плюс видимое второе поле
(`div.input-field` без `.hide` под описание), но **проверено это не было**.

Таб `Apps` снят в пустом состоянии — у аккаунта в нём нечего показывать; это состояние
тоже референс (`content-empty`). Таб `Links` со второго захода снят с содержимым:
в первый раз дамп сняли до того, как приехал список.

## Дальше

Дампы лежат рядом с остальными, но **эталонов из них ещё нет**: `scripts/domdiff/extract-expected.js`
знает только про баблы, полноэкранные поверхности и авторизацию. Чтобы сайдбар стал
сравниваемым (`run.js --actual …`), в экстрактор нужно добавить секции из `14-left-*`.
