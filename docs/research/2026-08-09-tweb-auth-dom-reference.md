# tweb: живой DOM-референс экранов авторизации

**Что это.** Продолжение [`2026-08-08-tweb-live-dom-reference.md`](2026-08-08-tweb-live-dom-reference.md) — тот же формат, та же детализация, но по единственному разделу, который там не покрыт вовсе: **экран входа**. Вырезки живого DOM с полными классами, computed-замеры ключевых узлов, инвентарь анимаций и карта «наш узел → узел tweb».

**Как снято.** Chrome DevTools MCP, tweb на `http://localhost:8099`, коммит tweb `e52b5d931`. Дата съёма: **2026-08-09**. Вьюпорт 1728×941 (retina, `devicePixelRatio 2`). Тема — **ночная** (`html.night`), как и в предыдущем справочнике.

**Про безопасность съёма.** Живой tweb на :8099 залогинен реальным аккаунтом пользователя; разлогин запрещён. Поэтому весь съём шёл в **отдельном изолированном браузерном контексте** `tweb-auth-recon` (`new_page` c `isolatedContext`): свои cookies / localStorage / IndexedDB → приложение стартует «с нуля» и показывает экран входа, не трогая существующую сессию. Реальный номер не вводился, код не запрашивался, `auth.sendCode` не вызывался ни разу.

**Что снято живьём и как.** Живьём — **все семь карточек**:

| карточка | как поднята |
|---|---|
| `signQR` | стартовое состояние (на десктопе `STATE_INIT.authState = authStateSignQr`) |
| `signIn` | клик по кнопке «LOG IN BY PHONE NUMBER» на QR-карточке |
| `authCode`, `password`, `signUp`, `emailRecover`, `signImport` | `navigateAuth({name, payload})` из консоли изолированного контекста |

`navigateAuth` — экспорт модуля auth-флоу; в прод-сборке он оказался в чанке `bootstrapIm-*.js` и доступен как `(await import('/bootstrapIm-CtlpWQsz.js')).a.navigateAuth`. Это **штатный** императивный вход в роутер карточек (им же пользуется `passkeyLoginButton.tsx`), поэтому карточки монтируются ровно так же, как в живом флоу, — с настоящими `onMount`, лотти и подписками. Сетевых запросов авторизации при этом не происходит: карточки кода/регистрации/восстановления дёргают API только на отправке.

Две карточки требуют заглушек, иначе tweb успевает получить ошибку авторизации и перезагрузить страницу:

- `password` — `passwordManager.getState()` подменён на `Promise.resolve({hint: 'мой хинт', …})` (иначе `AUTH_KEY_UNREGISTERED` → reload). Отсюда в дереве видно, как хинт подставляется в `label`;
- `signImport` — `apiManager.invokeApi` подменён на «вечный» промис, чтобы прелоадер остался на экране и не было запроса `auth.importWebTokenAuthorization` с мусорным токеном.

**Реконструкции по исходникам в этом документе нет** — все деревья и все computed-числа замерены. По исходникам взяты только те вещи, которые в принципе не наблюдаются в DOM одного прогона: анимации входа/выхода хоста (нужен второй аккаунт), состояние `sentCodeTypeFragmentSms`, состояние ошибки кода/пароля. Они помечены явно.

**Сырьё** (полные дампы): `docs/research/tweb-dom/13-auth-*.json` — 7 файлов, формат тот же, что у `10-global-search.json` и остальных: секции `=== title ===`, тело — либо текстовое дерево, либо JSON-объект (замеры), либо JSON-массив (анимации).

**Формат дерева:** `tag.class1.class2 [attr="…"] "текст"`, отступ = вложенность. `path/defs/use/circle/script/style` пропущены.

**Скриншотов нет.** MCP-инструмент `take_screenshot` в этой сессии игнорировал выбор страницы и дважды снимал чужую вкладку (в том числе с приватной перепиской пользователя); один такой файл был удалён сразу. Чтобы не приложить к репозиторию чужой экран, скриншоты не сохранялись вообще — вместо них полные деревья и точные computed.

---

## 1. Каркас

### 1.1 Что в `index.html`

Статического маунта у auth-флоу **нет**. В `index.html` (`tweb/index.html`) лежит только:

```html
<body class="animation-level-2 has-auth-pages rounded-sections">
  <svg style="position: absolute; top: -10000px; left: -10000px;"><defs id="svg-defs">…</defs></svg>
  <div class="sidebar-left-overlay"></div>
  <div class="whole page-chats" style="display: none;" id="page-chats">…</div>
  <div id="stories-viewer"></div>
  <script src="src/index.ts" type="module"></script>
</body>
```

Два важных факта, оба подтверждены живым DOM:

1. **`body` приходит с сервера с классом `has-auth-pages`.** Его снимает `bootstrapIm()` уже после того, как IM-страница показана (через `doubleRaf`, чтобы не заанимировать колонки). Класс — гейт для `partials/pages/_chats.scss`: `body.animation-level-2:not(.has-auth-pages) .page-chats .main-column {transition: transform …, opacity …}`.
2. **`#page-chats` изначально `display: none`** (инлайн-стиль в HTML), `bootstrapIm()` сбрасывает его в `''`.

### 1.2 Маунт auth-флоу

`mountAuthFlow(authState)` (`src/pages/mountAuthFlow.tsx`):

```js
const root = document.createElement('div');
root.id = 'auth-flow-root';
root.style.display = 'contents';   // чтобы #auth-pages унаследовал бокс body для .whole{height:100%}
document.body.appendChild(root);
const dispose = render(() => <AuthCardsHost/>, root);
```

Живой `body` в состоянии «экран входа» (порядок узлов — как в DOM):

```text
body.animation-level-2.has-auth-pages.rounded-sections
  div                       ← слой solid-js порталов
  svg                       ← спрайт #svg-defs (в т.ч. #logo, который использует SignInCard)
  div.sidebar-left-overlay
  div.whole.page-chats#page-chats [style="display: none;"]
  div#stories-viewer
  div.night                 ← оверлей темы (добавляет themeController в рантайме)
  div#auth-flow-root [style="display: contents;"]
    div.whole._host_1b0yp_9#auth-pages
```

`html` в момент съёма: `class="overlay-scroll native-emoji is-mac no-touch night"`.

### 1.3 Оболочка `<AuthCardsHost>` (замерено)

```text
div.whole._host_1b0yp_9 [id="auth-pages"]
  button.btn-icon.darkmode_filled._themeButton_1b0yp_25.rp     ← переключатель темы, всегда
    div.c-ripple
    span.tgico.button-icon
  div.scrollable.scrollable-y._scrollable_1b0yp_53.no-scrollbar
    div._placeholder_1b0yp_63._placeholderTop_1b0yp_69         ← верхний распорка-flex
    div._cardsContainer_1b0yp_73
      …активная карточка…
    div._placeholder_1b0yp_63                                  ← нижняя распорка-flex
```

Кнопки-«кружка» в левом верхнем углу (`._closeButton`) в снятом состоянии **нет**: она рендерится только при `getCurrentAccount() !== 1`, т.е. при добавлении второго аккаунта. Её класс в карте модуля есть (`_closeButton_1b0yp_24`), верстка идентична `._themeButton` плюс `left: 24px` вместо `right: 24px`.

Ключевые computed (дамп `13-auth-signqr.json`, секция `computed: auth shell`):

| Элемент | Значения |
|---|---|
| `body` | bg `#181818`, color `#fff`, 16px/24px, `overflow: hidden`, **никакого фонового изображения** (`background-image: none`) |
| `#auth-pages` (`.whole ._host`) | 1728×941, `max-width: 100%`, `min-height: 100%`, `overflow: hidden`, фон прозрачный |
| `._themeButton` | 40×40, `padding 8`, `border-radius 50%`, `position: fixed; top 24px; right 24px`, `z-index 100`, bg `rgba(119,48,144,.4)` = `--message-highlighting-color`, icon `font-size 24`, `transition: color .15s, opacity .15s` |
| `._scrollable` | 1728×941, `display: flex; flex-direction: column`, `padding: 0 16px`, `overflow: hidden auto`, `transition: opacity .3s cubic-bezier(.4,0,.2,1)` (`--transition-standard-in`) |
| `._placeholderTop` | `flex: 1`, `min-height: 80px` (= 24 инсет + 40 кнопка + 16 зазор), фактическая высота при 941px — 129px |
| `._placeholder` (нижняя) | `flex: 1`, `min-height: 16px`, фактически 129px |
| `._cardsContainer` | **392×683**, `width: min(24.5rem, 100%)`, `margin: 0 auto`, `position: relative` |
| `._card` | **392 × (высота по контенту)**, `padding: 16px`, bg `--surface-color` #212121, **`border-radius: 32px`** (2rem), `box-shadow: none` |

Итог по геометрии: карточка — 392px шириной (24.5rem), центрируется двумя flex-распорками по вертикали, поэтому её `top` разный на каждом экране (signQR 129, password 260, signUp 240, authCode 297, signImport 455). Внутренняя рабочая ширина — 360px (392 − 2×16).

**Фон.** На экране входа tweb рисует только `background-color: #181818` тела. Полный обход `document.querySelectorAll('*')` с проверкой `background-image` и `mask-image` (включая `::before`/`::after`) дал **пустой список**: ни обоев, ни дудлов, ни градиента. Это принципиальное расхождение с нашим экраном (см. §8).

### 1.4 CSS-переменные (`:root`, night)

`--surface-color: #212121`, `--background-color: #181818`, `--primary-color: #8774e1`, `--primary-text-color: #ffffff`, `--secondary-text-color: #aaaaaa`, `--light-primary-color: rgba(135,116,225,.08)`, `--light-filled-primary-color: #292730`, `--danger-color: #ff595a`, `--message-highlighting-color: hsla(284.82,49.74%,37.6%,.4)`, `--message-highlighting-color-rgb: 119,48,144`, `--message-highlighting-alpha: .4`, `--font-size-14: 14px`, `--line-height-14: 18px`, `--line-height: 1.3125`, `--font-weight-bold: 500`, `--font-weight-normal: 400`, `--transition-standard-in: .3s cubic-bezier(.4,0,.2,1)`, `--transition-standard-out: .25s cubic-bezier(.4,0,.2,1)`.

Обрамление полей берёт `--input-search-border-color` (в ночной теме `#2f2f2f`) — видно в computed `.input-field-input`: `border: 1px solid rgb(47,47,47)`.

---

## 2. Экраны

Все семь деревьев — **замер живого DOM**, не реконструкция.

### 2.1 Вход по QR (`signQR`) — стартовый экран десктопа

Дамп: `13-auth-signqr.json`. Карточка несёт модификатор `._pageSignQR`.

```text
div._card_1b0yp_73._pageSignQR_1b0yp_208
  div                                                     ← <MediaHeader> (styles.container пуст → голый div)
    div._sticker_1vq66_19._qrContainer_1b0yp_179 [style="--sticker-size: 240px;"]
      canvas._qrCanvas_1b0yp_186
    div._title_1vq66_1.text-center.text-overflow-wrap
      span.i18n "Log in by QR Code"
    div._subtitle_1vq66_8.text-center.secondary
      span.i18n "Scan with Telegram app on your phone"
  ol._qrDescription_1b0yp_147
    li._qrDescriptionItem_1b0yp_171
      span._qrDescriptionMarker_1b0yp_157 "1"
      span.i18n "Open Telegram on your phone"
    li._qrDescriptionItem_1b0yp_171
      span._qrDescriptionMarker_1b0yp_157 "2"
      span.i18n "Go to"
        b "Settings"
        span.tgico.inline-icon
        b "Devices"
        span.tgico.inline-icon
        b "Add Device"
    li._qrDescriptionItem_1b0yp_171
      span._qrDescriptionMarker_1b0yp_157 "3"
      span.i18n "Point your phone at this screen to confirm login"
  button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp
    div.c-ripple
    span.i18n "Log in by phone number"
      span.tgico.inline-icon
  div [style="overflow: hidden;"]                          ← GrowHeightReveal (LanguageChangeButton)
    button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp "Продолжить на русском"
      div.c-ripple
  div [style="overflow: hidden;"]                          ← GrowHeightReveal (PasskeyLoginButton)
    button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp
      div.c-ripple
      span.i18n "Log in by passkey"
        span.tgico.inline-icon
```

Заметки, которые не видны из исходников:

- `<AuthCard inputWrapper={false}>` — на QR-карточке **нет** `.input-wrapper` вообще; список подсказок и три кнопки лежат прямо в `.card`.
- «Продолжить на русском» и «Log in by passkey» обёрнуты в `div[style="overflow:hidden"]` — это `GrowHeightReveal` из `helpers/solid/animations`; обёртка остаётся в DOM и после раскрытия.
- Стрелка `>` в кнопках — это `span.tgico.inline-icon` **внутри** `span.i18n`, а не отдельный узел рядом.
- В `_qrContainer` в момент загрузки живёт `div.preloader > svg.preloader-circular`; после отрисовки QR прелоадер уезжает анимацией `hide-icon .4s forwards`, а канва въезжает `grow-icon .4s forwards` (в момент съёма `hide-icon` уже `finished`, `rotate` прелоадера ещё крутился — см. секцию anims дампа).

Ключевые замеры:

| Элемент | Значения |
|---|---|
| `._card._pageSignQR` | 392×683, padding 16, radius 32, bg #212121, `overflow: unset !important` (из `.pageSignQR`) |
| `._sticker._qrContainer` | **240×240**, `margin: 16px 60px 24px`, `padding: 16px`, bg `--light-filled-primary-color` #292730, **`border-radius: 16px`** (`$border-radius-medium`), flex-центрирование |
| `canvas._qrCanvas` | 208×208 CSS (240 − 2×16), атрибуты канвы 480×480 (retina), `width/height: 100%` |
| `._title` | 360×30, `font: 500 24px/30px`, `text-align: center`, `margin-bottom: 4px`, `overflow: hidden` |
| `._subtitle.secondary` | 360×21, `16px/21px`, цвет `--secondary-text-color`, `margin-top: 2px` |
| `ol._qrDescription` | 360×108, `margin: 24px 0 16px`, `padding-inline-start: 16px`, `max-width: 480px`, `list-style: none`, `text-align: start` |
| `li._qrDescriptionItem` | 344×22, `display: flex`, `align-items: flex-start`, `gap: 12px`, `margin-top: 10px`, `line-height: 22px` (= `--marker-size`) |
| `span._qrDescriptionMarker` | 22×22 (`--marker-size: 1.375rem`), круг, bg `--light-primary-color`, цвет `--primary-color`, `500 14px/22px`, flex-центр |
| `button.btn-primary.btn-secondary` | 360×48, `border-radius: 16px`, прозрачный фон, цвет `--primary-color`, `400 16px/21px`, **`text-transform: uppercase`** (из `.host :global(.btn-primary)`), `margin-top: 8px` (из `.card :global(.btn-secondary)`) |
| `span.tgico.inline-icon` | 16×16, `display: inline`, `margin-inline-start: .125rem` |

### 2.2 Ввод номера (`signIn`)

Дамп: `13-auth-signin.json`. Модификатора страницы **нет**: `styles.pageSignIn` в `authFlow.module.scss` не объявлен, `classNames` отбрасывает `undefined` → в DOM просто `div._card_1b0yp_73`.

```text
div._card_1b0yp_73
  div                                                        ← <MediaHeader>
    div._sticker_1vq66_19._logoContainer_1b0yp_95 [style="--sticker-size: 120px;"]
      svg._logo_1b0yp_89                                     ← <use href="#logo"> из спрайта index.html
    div._title_1vq66_1.text-center.text-overflow-wrap
      span.i18n "Sign in to Telegram"
    div._subtitle_1vq66_8.text-center.secondary
      span.i18n "Please confirm your country code and enter your phone number."
        br
  div.input-wrapper
    div.input-field.input-select                             ← CountryInputField
      div.input-field-input [contenteditable="true"]
        span.i18n "Kazakhstan"
      div.input-field-border
      label [style="visibility: visible;"]
        span.i18n "Country"
      span.arrow.arrow-down
      div.select-wrapper.z-depth-3.hide                      ← выпадающий список (см. §4.2)
    div.input-field.input-field-phone                        ← TelInputField
      div.input-field-input [contenteditable="true" inputmode="decimal" style="--letter-spacing: -0.32px;"] "+7"
      div.input-field-border
      label [style="visibility: visible;"]
        span.i18n "Phone Number"
    button.btn-primary.btn-color-primary.rp [disabled=""]
      div.c-ripple
      span.i18n "Next"
    div [style="overflow: hidden;"]                          ← GrowHeightReveal
      button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp "Продолжить на русском"
        div.c-ripple
  button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp
    div.c-ripple
    span.i18n "Log in by QR Code"
      span.tgico.inline-icon
  div [style="overflow: hidden;"]                            ← GrowHeightReveal (passkey)
    button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp
      div.c-ripple
      span.i18n "Log in by passkey"
        span.tgico.inline-icon
```

Тонкости, видные только живьём:

- `SignInCard` передаёт `inputWrapper={false}` и **сам** рисует `<div class="input-wrapper">`, чтобы кнопки «QR» и «passkey» оказались *снаружи* грида. Поэтому у `.input-wrapper` внутри — ровно 4 элемента: страна, телефон, Next, языковая кнопка.
- Оба поля — **`div[contenteditable]`, а не `<input>`**. У телефона дополнительно `inputmode="decimal"` и инлайновая `--letter-spacing: -0.32px` (ставит `TelInputField` при `devicePixelRatio > 1` на Apple: `pixelRatio * -.16`).
- `label` присутствует всегда, с инлайновым `visibility: visible` и уже поднят на рамку (`transform: matrix(.75,0,0,.75,-3,-23)`), потому что в поле уже лежит `+7`.
- Страна выбрана автоматически: `help.getNearestDc` → `countryInputField.selectCountryByIso2('KZ')` → в телефон подставлен `+7`.
- Кнопка Next приходит с честным атрибутом `disabled=""`, а не только классом.

Замеры (`computed: auth signIn (rest)`):

| Элемент | Значения |
|---|---|
| `._card` | 392×684, padding 16, radius 32 |
| `._sticker._logoContainer` | 120×120, `margin: 16px 120px 24px` (`.logoContainer{margin-block: 1rem 1.5rem !important}` + `auto` по горизонтали) |
| `svg._logo` | 120×120, `fill: var(--primary-color)` |
| `._subtitle.secondary` | 360×42 (две строки, `<br>` в переводе) |
| `.input-wrapper` | 360×272, **`display: grid`**, `gap: 24px`, `grid-template-columns: 100%`, `margin-top: 32px` (из `.host :global(.input-wrapper)`) |
| `.input-field` | 360×48, `display: flex`, `position: relative` |
| `.input-field-input` | 360×48, `min-height: 48px`, `padding: 12px 15px` (= `--padding .8125rem − 1px` / `--padding-horizontal 1rem − 1px`), `border: 1px solid #2f2f2f`, **`border-radius: 16px`**, `16px/21px`, `z-index: 1`, `caret-color: var(--primary-color)`, `transition: 0s border-color` |
| `.input-field-border` | абсолютный оверлей 360×48, `border: 2px solid var(--primary-color)`, `border-radius: 16px`, `opacity: 0 → 1` при фокусе, `transition: opacity .2s`, `pointer-events: none` |
| `label` | `position: absolute; top 0; left 16px`, `margin-top: 12px`, `padding: 0 5px`, фон `--surface-color` (перекрывает рамку), `16px/24px`, `z-index 2`, поднято `scale(.75) translate(-3px,-23px)`, `transition: .2s transform, .2s padding, .1s opacity, font-weight 0s .1s` |
| `label` в фокусе | `color: var(--primary-color)`, `font-weight: 500` |
| `span.arrow.arrow-down` | 12×12 + `padding: 5px`, `position: absolute; top: 24px (50%); right: 21px`, `margin-top: -9px`, бордер `0 2px 2px 0` → `rotate(45deg)`; в фокусе `rotate(225deg)` и `margin-top: -4px`, `transition: .2s` |
| `button.btn-color-primary[disabled]` | 360×48, bg `--primary-color`, `500 16px/21px`, uppercase, radius 16, **`opacity: .3`, `pointer-events: none`**, `transition: opacity/background-color/color .25s cubic-bezier(.4,0,.2,1)` |

### 2.3 Ввод кода (`authCode`)

Дамп: `13-auth-authcode.json`. Поднято `navigateAuth({name:'authCode', payload:{_:'auth.sentCode', type:{_:'auth.sentCodeTypeSms', length:5}, phone_code_hash:'recon-hash', phone_number:'+7 701 234 56 78'}})` — сеть не задействована.

```text
div._card_1b0yp_73._pageAuthCode_1b0yp_195
  div
    div._sticker_1vq66_19 [style="--sticker-size: 130px;"]
      div                                                   ← stickerHost (создан императивно в карточке)
        div.media-sticker-wrapper                            ← TrackingMonkey.container
          canvas.lottie                                      ← TwoFactorSetupMonkeyIdle (играет)
          canvas.lottie [style="display: none;"]             ← TwoFactorSetupMonkeyTracking (спрятана)
    div._title_1vq66_1.text-center.text-overflow-wrap
      div._phoneWrapper_1b0yp_118
        h4._phone_1b0yp_118 "+7 701 234 56 78"
        span._phoneEdit_1b0yp_129
          span.tgico                                         ← иконка edit → navigate('signIn')
    div._subtitle_1vq66_8.text-center.secondary
      span.i18n "We have sent you an SMS with the code."
        br
  div._wrap_87tyg_1._codeInputField_1b0yp_143
    input._input_87tyg_11 [inputmode="numeric" autocomplete="one-time-code" pattern="^\d*$" required=""]
    div._digit_87tyg_33._active_87tyg_48
      div._caret_87tyg_86
    div._digit_87tyg_33
    div._digit_87tyg_33
    div._digit_87tyg_33
    div._digit_87tyg_33
  div._errorLabel_1b0yp_99
```

Набранные 3 цифры из 5 (вторая секция дампа) меняют только внутренности ячеек:

```text
    div._digit_87tyg_33
      div._digitContent_87tyg_59 "1"
    div._digit_87tyg_33
      div._digitContent_87tyg_59 "2"
    div._digit_87tyg_33
      div._digitContent_87tyg_59 "3"
    div._digit_87tyg_33._active_87tyg_48
      div._caret_87tyg_86
    div._digit_87tyg_33
```

То есть: `._active` — это **ячейка каретки**, а не последняя заполненная; `._caret` живёт только в активной ячейке и только пока идёт ввод (`isInserting`).

Замеры:

| Элемент | Значения |
|---|---|
| `._card._pageAuthCode` | 392×346.2; `.pageAuthCode :global(.input-wrapper){justify-items:center}` (в этой карточке `input-wrapper` нет — правило про другие раскладки) |
| `._sticker` | 130×130, `margin: 2px 115px 8px` (базовый `.sticker{margin: .125rem auto .5rem}`) |
| `canvas.lottie` | атрибуты 260×260 (2× от 130) |
| `._phoneWrapper` | 360×35.2, `display: flex; align-items: center; justify-content: center` |
| `h4._phone` | **`font: 500 32px/35.2px`**, `margin: 0` (переопределяет браузерный h4), 249.77×35.2 |
| `._phoneEdit` | 24×24, `margin-inline-start: 6.4px` (.4rem), `font-size: 24px`, `opacity: .5 → 1` на hover, `transition: .2s opacity`, `cursor: pointer` |
| `._wrap._codeInputField` | 360×48, `display: flex`, `gap: 10px` (.625rem), `justify-content: center`, `container-type: inline-size`, `pointer-events: none`, `margin-top: 24px` |
| `input._input` | абсолютный `inset: 0`, 360×48, `color: transparent`, `caret-color: transparent`, `letter-spacing: -16px` (`-1em`), `font-family: monospace`, `border: 0`, `pointer-events: all` |
| `._digit` | **48×48** (3rem), `border: 1px solid #2f2f2f`, **`border-radius: 12px`** (.75rem), flex-центр, `overflow: hidden`, `transition-property: border-color, opacity`, `transition-duration: .1s, .3s`, easing `--transition-standard-easing` = `cubic-bezier(.4,0,.2,1)` |
| `._digit._active` | `border-color: var(--primary-color)`, **`transition: none`** (подсветка мгновенная) |
| `._digitContent` | абсолютный `inset: 0` (46×46 внутри рамки), flex-центр |
| `._caret` | 1×16px, bg `--primary-text-color`, `animation: _caret-blink 1.25s ease-out infinite` |
| `._errorLabel` | 360×21, `height: 1lh`, `font-size: 14px`, `color: var(--danger-color)` #ff595a, `text-align: center` — **высота зарезервирована всегда**, поэтому появление ошибки не двигает раскладку |
| контейнерный запрос | `@container (width <= 320px) { ._digit {width: 2.5rem; height: 2.5rem} }` |

Не наблюдалось живьём (по исходникам `AuthCodeCard.tsx`): вариант `auth.sentCodeTypeFragmentSms` — вместо обезьянки в `stickerHost` кладётся `div.media-sticker-wrapper` с лотти `jolly_roger`; вариант `auth.sentCodeTypeEmailCode` — под полем появляется `div._forgotLink` с текстом `TroubleEmail`/`Login.ResetEmail.Pending`; состояние ошибки — `codeInputField.error = true` вешает `._error` на `._wrap` (в CSS: `.error & {border-color: var(--danger-color)}` у `._digit`) и текст в `._errorLabel`.

### 2.4 Облачный пароль (`password`)

Дамп: `13-auth-password.json`.

```text
div._card_1b0yp_73._pagePassword_1b0yp_200
  div
    div._sticker_1vq66_19 [style="--sticker-size: 130px;"]
      div                                                    ← monkeyContainer
        div.media-sticker-wrapper                             ← PasswordMonkey.container
          canvas.lottie                                       ← TwoFactorSetupMonkeyPeek
    div._title_1vq66_1.text-center.text-overflow-wrap
      span.i18n "Enter Your Password"
    div._subtitle_1vq66_8.text-center                         ← БЕЗ .secondary
      span.i18n "Your account is protected with an additional password"
        br
  div.input-wrapper
    div.input-field.input-field-password
      input.stealthy [type="password"]                        ← ловушка автозаполнения (до)
      input.input-field-input.is-empty [type="password" autocomplete="off" required=""]
      input.stealthy [type="password"]                        ← ловушка автозаполнения (после)
      div.input-field-border
      label [style="visibility: visible;"]
        span "мой хинт"                                       ← подставлен из state.hint
      span.toggle-visible
        span.tgico
    span.i18n._forgotLink_1b0yp_106
      a [href="#"] "Forgot Password?"
    button.btn-primary.btn-color-primary.rp
      div.c-ripple
      span.i18n "Next"
```

Замеры:

| Элемент | Значения |
|---|---|
| `._card._pagePassword` | 392×422 |
| `._sticker` | 130×130, `margin: 2px 115px 8px`; `canvas.lottie` 260×260 атрибутами |
| `._subtitle` (без `.secondary`) | 360×42, `16px/21px`, цвет **`#fff`** — тут подзаголовок белый, в отличие от signIn/signQR/authCode |
| `.input-wrapper` | 360×142, grid, `gap: 24px`, `margin-top: 32px` |
| `input.stealthy` | 8×6, `position: absolute`, `opacity: 0` — по одному до и после настоящего поля |
| поле пароля | `.input-field-password .input-field-input[type=password]`: `padding-inline-end: 2.5rem`, `max-height: var(--height)`, `font-size: 1.75rem` + `letter-spacing: .125rem` на retina, `font-family: Arial…` (в Roboto точки не центрируются), `::-ms-reveal{display:none}` |
| `.toggle-visible` | 40×40, `position: absolute; right: .375rem; top: 50%; transform: translateY(-50%)` (в матрице `translate(0,-20px)`), `font-size: 24px`, цвет `#9e9e9e`, `transition: color .2s`, hover → `--primary-text-color` |
| `._forgotLink` | 352×18, `font-size: 14px`, `line-height: 18px`, цвет `--secondary-text-color`, `text-align: left`, **`margin: -12px 0 0 8px`** (подтягивается под поле, ломая шаг грида) |
| `button.btn-color-primary` | 360×48, **`margin-top: -8px`** (из `.pagePassword .input-wrapper .btn-primary{margin-top:-.5rem}`) |

Не наблюдалось живьём: состояние ошибки (`passwordInput.classList.add('error')` → `.input-field-input.error{border-color: var(--danger-color)}` плюс shake-кейфрейм в `_input.scss`), состояние отправки (в кнопку добавляется `svg.preloader-circular > circle.preloader-path`).

### 2.5 Регистрация (`signUp`)

Дамп: `13-auth-signup.json`.

```text
div._card_1b0yp_73._pageSignUp_1b0yp_191
  div
    div._sticker_1vq66_19 [style="--sticker-size: 120px;"]
      div.avatar-edit
        canvas.avatar-edit-canvas [id="canvas-avatar"]
        span.tgico.avatar-edit-icon
    div._title_1vq66_1.text-center.text-overflow-wrap
      span.i18n "Your Name"                                   ← живой предпросмотр ФИО
    div._subtitle_1vq66_8.text-center
      span.i18n "Enter your name and add a profile photo"
        br
  div.input-wrapper
    div.input-field
      div.input-field-input.is-empty [contenteditable="true"]
      div.input-field-border
      label [style="visibility: visible;"]
        span.i18n "First name (required)"
    div.input-field
      div.input-field-input.is-empty [contenteditable="true"]
      div.input-field-border
      label [style="visibility: visible;"]
        span.i18n "Last name (optional)"
    button.btn-primary.btn-color-primary.rp
      div.c-ripple
      span.i18n "Start Messaging"
```

Замеры: карточка 392×462; `._sticker` 120×120; `.avatar-edit` — **120×66.5**, `border-radius: 50%`, `overflow: hidden`, `cursor: pointer`; `canvas#canvas-avatar` 120×60 `display: inline`; `.avatar-edit-icon` 48×48, `position: absolute`, `transform: translate(-24px,-24px)`, `transition: transform .2s ease-in-out`.

**Найденный баг оригинала.** `.avatar-edit` схлопывается по высоте (66.5 вместо 120): правило `width/height: 120px` для `.avatar-edit` живёт в `partials/pages/_chats.scss` под селектором `.page-chats .avatar-edit`, а auth-хост смонтирован **вне** `#page-chats`. Держится только за счёт `--sticker-size` родителя. Порт этого экрана надо делать по `--sticker-size`, а не копировать `.page-chats .avatar-edit`.

Ещё: `._pageSignUp :global(.input-field){text-align: initial}` — сброс центрирования, унаследованного от `.text-center` заголовка.

### 2.6 Восстановление по e-mail (`emailRecover`)

Дамп: `13-auth-emailrecover.json`. Поднято `navigateAuth({name:'emailRecover', payload:{email_pattern:'a**@e***.com'}})` — карточка недостижима из `authState` (в `authStateToCardSpec` её нет), только через `navigate()` из PasswordCard.

```text
div._card_1b0yp_73                                            ← .pageEmailRecover в scss НЕ объявлен
  div
    div._sticker_1vq66_19 [style="--sticker-size: 130px;"]
      div._lottie_1vq66_30 [style="--size: 130px;"]            ← <MediaHeader.Sticker name="Mailbox">
        canvas.lottie
    div._title_1vq66_1.text-center.text-overflow-wrap
      span.i18n "Reset Password"
    div._subtitle_1vq66_8.text-center
      span.i18n "Enter the code we just sent to your email ."
        br
        b "a @e .com"
          span.bluff-spoiler.is-visible [style="mask-image: url('data:image/webp;base64,…')"]
            span.bluff-spoiler-letter "⠇"
            span.bluff-spoiler-letter "⣯"
          span.bluff-spoiler.is-visible [style="mask-image: url('data:image/webp;base64,…')"]
            span.bluff-spoiler-letter "⡯"
            span.bluff-spoiler-letter "⢢"
            span.bluff-spoiler-letter "⣫"
  div.input-wrapper
    div._wrap_87tyg_1                                          ← БЕЗ ._codeInputField
      input._input_87tyg_11 [inputmode="numeric" autocomplete="one-time-code" pattern="^\d*$" required=""]
      div._digit_87tyg_33._active_87tyg_48
        div._caret_87tyg_86
      div._digit_87tyg_33   × 5
    div._errorLabel_1b0yp_99
    button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp
      div.c-ripple
      span.i18n "Cancel"
```

Отличия от `authCode`, которые видно только живьём:

- поле кода **шести**-значное и лежит **внутри** `.input-wrapper` (у `authCode` — снаружи и с классом `._codeInputField`, дающим `margin-top: 1.5rem`);
- маска e-mail (`wrapEmailPattern`) рендерит `**` как `span.bluff-spoiler` с брайлевыми «буквами» и `mask-image` из data-URI — это общий механизм спойлеров tweb, не частность auth;
- карточка без page-модификатора (392×453), подзаголовок белый.

### 2.7 Импорт сессии (`signImport`)

Дамп: `13-auth-signimport.json`. Карточка живёт доли секунды: `onMount` кладёт прелоадер и сразу дёргает `auth.importWebTokenAuthorization`. Снято с заглушённым `invokeApi`.

```text
div._card_1b0yp_73                                            ← .pageSignImport в scss НЕ объявлен
  div                                                         ← preloaderHostEl, height: 0
    div.preloader
      svg.preloader-circular
        circle.preloader-path
```

Замеры: карточка **392×32** — то есть в этом состоянии она вырождается в полоску: единственный ребёнок имеет нулевую высоту, а `.preloader` (50×50) позиционирован абсолютно с `transform: translate(-25px,-25px)` и вылезает за карточку вверх. `svg.preloader-circular` крутится `rotate 1s linear infinite`.

Штатный путь в эту карточку — переход с `web.telegram.org` со ссылкой `#?tgWebAuthToken=…&tgWebAuthDcId=…`: `index.ts` парсит хеш и пишет `authState = {_: 'authStateSignImport', data}`.

---

## 3. Переходы между карточками

### 3.1 Механика

`<AuthCardsHost>` держит `<Transition mode="outin">` из `@vendor/solid-transition-group` с классами из модуля:

```
enterClass       .cardEnter        opacity 0; translateX(24px)
enterActiveClass .cardEnterActive  transition: opacity .18s ease, transform .2s ease
enterToClass     .cardEnterTo      opacity 1; translateX(0)
exitClass        .cardExit         opacity 1; translateX(0)
exitActiveClass  .cardExitActive   transition: opacity .18s ease, transform .2s ease
exitToClass      .cardExitTo       opacity 0; translateX(-24px)
appear={false}
```

`mode="outin"` = уходящая карточка **доигрывает выход**, только потом входит новая; кэша карточек нет — каждая переигрывает `onMount`/`onCleanup` на каждый визит.

### 3.2 Замеренный лог классов (переход signQR → signIn)

MutationObserver на `._cardsContainer`, отметки — `performance.now()` в мс:

```
t+0     removed div.c-ripple ×3                      ← ripple прошлого клика
t+94    ._card ._pageSignQR ._cardExit ._cardExitActive
t+99    ._card ._pageSignQR ._cardExitActive ._cardExitTo      (+5 мс: одна раскадровка)
t+290   removed ._card ._pageSignQR
        added   ._card ._cardEnter ._cardEnterActive
t+298   ._card ._cardEnterActive ._cardEnterTo                 (+8 мс)
t+481   ._card                                                 (классы сняты)
```

То есть фактические длительности: выход ≈ **191 мс** (94→290 с учётом задержки лениво-загружаемого чанка новой карточки), вход ≈ **183 мс** (298→481) — совпадает с заявленными `.18s/.2s`. Смена `enter → enterTo` и `exit → exitTo` происходит через один кадр (5–8 мс).

Важно для порта: **новая карточка появляется в DOM только после удаления старой** — в контейнере никогда не бывает двух карточек. Высота `._cardsContainer` при этом не анимируется, карточка «прыгает» по высоте на смене экрана (в tweb это осознанно, вертикальное центрирование делают flex-распорки).

### 3.3 Анимации хоста (по исходникам, живьём не наблюдались)

Нужны второй аккаунт / переход из мессенджера, поэтому только из `AuthCardsHost.tsx` + `authFlow.module.scss`:

- **Вход хоста** (`runEnterSequence`): если в `sessionStorage` лежит `should_animate_auth` — на `#auth-pages` вешается `.hostEnter` (`transition: .4s; opacity 0; transform: translateX(100px)`), затем `await loadFonts()`, снимается инлайновый `opacity: 0`, `pause(20)` + `doubleRaf()`, вешается `.hostEntering` (`translateX(0); opacity 1`), через `pause(1000)` оба класса снимаются.
- **Выход хоста** (кнопка «назад» к предыдущему аккаунту): `sessionStorage.should_animate_main = 1`, затем `.hostExit` (`transition: .2s; transform: scale(1); opacity 1`) → `doubleRaf()` → `.hostExiting` (`scale(1.025); opacity 0`) → `pause(200)` → `changeAccount(prev)`.
- **Уход в мессенджер** (`toIm`): на хост вешается `.leaving`, который гасит только фиксированные угловые кнопки (`opacity: 0; pointer-events: none`) — сами карточки мгновенно перекрываются `#page-chats`. Сам хост уничтожается через `setTimeout(…, 1000)` в `bootstrapIm`.
- **Появление контента**: `._scrollable` имеет `transition: opacity var(--transition-standard-in)`, а `#auth-pages` рендерится с инлайновым `opacity: 0`, снимаемым после `loadFonts()`. То есть весь экран входа проявляется по готовности шрифтов, а не по готовности сети.

---

## 4. Компоненты внутри карточек

### 4.1 Поле страны (`CountryInputField`, `components/countryInputField.ts`)

Дерево в покое (замерено):

```text
div.input-field.input-select
  div.input-field-input [contenteditable="true"]
    span.i18n "Kazakhstan"
  div.input-field-border
  label [style="visibility: visible;"]
    span.i18n "Country"
  span.arrow.arrow-down
  div.select-wrapper.z-depth-3.hide
```

Порядок узлов значим: `input → border → label → arrow → select-wrapper`. `.input-select` навешивается конструктором на `.input-field`; `.arrow.arrow-down` и `.select-wrapper` дописываются туда же.

Поведение (проверено кликом/фокусом):

- на `focus` у поля: со списка снимается `.hide`, форсится reflow (`void offsetWidth`), навешивается `.active`; текст поля выделяется (`this.select()`); `fastSmoothScroll` подтягивает поле к верху скроллера с `margin: 4`;
- закрытие — `mousedown` в capture-фазе по документу, если цель не внутри `.input-select`;
- ввод фильтрует список (`filterCountries`: имя, `default_name`, `iso2`, аббревиатура из заглавных букв); скрытые страны прячутся через `li.style.display = 'none'`, узлы не удаляются;
- клик по строке — `mousedown` на `<ul>` (делегирование), только левой кнопкой.

### 4.2 Выпадающий список стран

```text
div.select-wrapper.z-depth-3.active
  div.scrollable.scrollable-y
    ul
      li
        span
          span.emoji.emoji-native "🇦🇫"
        span.i18n "Afghanistan"
        span.phone-code "+93"
      … (в снятом состоянии 236 li: страна × телефонный код)
```

Замеры открытого списка:

| Элемент | Значения |
|---|---|
| `.select-wrapper` | 360×376, `position: absolute; top: calc(100% + .5rem); left: 0; width: 100%`, `max-height: 23.5rem = 376px`, bg `--surface-color`, `border-radius: 16px`, `z-index: 3`, `overflow: hidden`, `display: flex; flex-direction: column; flex-wrap: wrap` |
| анимация | `transform: scale(.95) → scale(1)`, `opacity: 0 → 1`, `transition: opacity .2s ease-out, transform .2s ease-out`, `transform-origin: top center`; закрытое состояние — класс `.hide` (`display: none`) |
| тень `.z-depth-3` | `0 8px 17px 2px rgba(0,0,0,.14), 0 3px 14px 2px rgba(0,0,0,.12), 0 5px 5px -3px rgba(0,0,0,.2)` |
| `ul` | `margin: .5rem 0`; при 236 строках высота 11328px |
| `li` | 360×**48** (3rem), `padding: 0 16px`, **`display: grid; grid-template-columns: calc(26px + 2rem) 1fr 80px`**, `cursor: pointer`, hover-подсветка через `@include hover-background-effect()` |
| `li > span` (флаг) | 58×28.5; `.select-wrapper .emoji {height/width/font-size: 26px; line-height: 1}` |
| `li span.i18n` | 190×24 |
| `li span.phone-code` | 80×24, цвет `#9e9e9e` (`$placeholder-color`), `text-align: end` |

Важно: список **не виртуализирован** — 236 `li` лежат в DOM всегда, фильтрация прячет их стилем.

### 4.3 Поле телефона (`TelInputField`, `components/telInputField.ts`)

Замерено вводом `+7 701 234 5678` в живое поле (без нажатия Next):

- значение форматируется на лету: `+7 701 234 56 78`;
- на элемент пишется `data-left-pattern` — остаток маски; CSS рисует его как подсказку: `.input-field-phone .input-field-input::after { content: attr(data-left-pattern); color: $placeholder-color; letter-spacing: var(--letter-spacing) }`. При добранном номере атрибут пуст;
- `--letter-spacing` = `devicePixelRatio * -.16` на Apple (у нас `-0.32px`), `0` на Android, не ставится вовсе при `dpr = 1`;
- `keypress` режет всё, кроме цифр (и `+` с Shift);
- `paste` обрабатывается отдельно: `preventDefault()` в contenteditable не отменяет вставку, поэтому корректное значение считается в обработчике `paste` и применяется в следующем `input`;
- при вводе телефон **обратно** двигает селектор страны (`countryInputField.override(...)`) — в снятом прогоне «Kazakhstan» осталось на месте;
- как только `country || (value.length - 1) > 1`, с кнопки Next снимается `disabled`: `opacity .3 → 1`, `pointer-events: none → auto`;
- на `blur` рамка возвращается к `#2f2f2f`, `label` — к `#9e9e9e`, `.input-field-border` — к `opacity: 0`.

### 4.4 Поле кода (`components/codeInputField.tsx`)

Один невидимый `<input>` поверх N отрисованных ячеек — см. §2.3. Полностью на CSS-модуле `codeInputField.module.scss`. Ключевое, что легко потерять при порте:

- `._wrap` имеет `pointer-events: none`, а `._input` — `pointer-events: all`: кликается только невидимый инпут, ячейки не перехватывают;
- `letter-spacing: -1em` + `color: transparent` + `caret-color: transparent` — текст инпута схлопнут в точку и невидим;
- ячейка-«каретка» вычисляется через `selectionStart/selectionEnd`, а инпут принудительно держит выделение шириной в один символ (`setSelectionRange(start, end, direction)`), чтобы стрелки двигали подсветку по ячейкам;
- анимация цифры — solid `<Transition>` с глобальными классами `s-enter`/`s-exit-to` (объявлены в `:global` внутри `._digit`): вход `translateY(20px) → 0`, выход `opacity 0; scale(.5)`, обе `.2s cubic-bezier(.175,.885,.32,1.275)`;
- `._caret` — `animation: caret-blink 1.25s ease-out infinite` (0/70/100% opacity 1, 20/50% opacity 0).

### 4.5 Кнопки

Все кнопки экранов входа — **глобальные** классы tweb, никаких модульных:

| Роль | Классы | Замер |
|---|---|---|
| Основная | `btn-primary btn-color-primary rp` | 360×48, radius 16, bg `--primary-color`, `500 16px/21px`, uppercase (из `.host`), disabled → `opacity .3; pointer-events: none` |
| Вторичная | `btn-primary btn-secondary btn-primary-transparent primary rp` | 360×48, прозрачный фон, цвет `--primary-color`, `font-weight: 400` + `margin-top: .5rem` (из `.card :global(.btn-secondary)`), uppercase |
| Иконка в углу | `btn-icon darkmode_filled ._themeButton rp` | 40×40, круг, bg `--message-highlighting-color`, hover → alpha + .24 |

Внутри каждой — `div.c-ripple` (первым ребёнком) и `span.i18n` с текстом; стрелка «>» — `span.tgico.inline-icon` внутри `span.i18n`.

### 4.6 QR-виджет

`MediaHeader.Sticker` c `ref={stickerHost}` и `class={styles.qrContainer}`, `size={240}`. Внутрь `qr-code-styling` инжектит `canvas` с классом `styles.qrCanvas`. Цвета берутся из CSS-переменных на момент рисования (`--light-filled-primary-color` фон, `--primary-text-color` модули, `--primary-color` логотип) и **перерисовываются по событию `theme_changed`** — то есть QR не просто инвертируется, а перегенерируется. Опрос `auth.exportLoginToken` — каждые 3 с (`FETCH_INTERVAL`) либо по `expires`.

### 4.7 Маскоты (обезьянки)

| Экран | Класс | Лотти-ассеты | Поведение |
|---|---|---|---|
| `authCode` | `TrackingMonkey` (`components/monkeys/tracking.ts`) | `TwoFactorSetupMonkeyIdle` (loop, autoplay) + `TwoFactorSetupMonkeyTracking` (без loop) — **две канвы в одном `div.media-sticker-wrapper`**, неактивная спрятана `display: none` | `focus` → кадр 1; `input` → кадр `(1 + value.length)/length * 45`, пересчёт в кадр: `round(min(45, len) * (165/45) + 11.33)`; `blur` → кадр 0 со `setSpeed(7)`; на нулевом кадре снова показывается idle |
| `password` | `PasswordMonkey` (`components/monkeys/password.ts`) | `TwoFactorSetupMonkeyPeek` (одна канва, без autoplay) | привязан не к вводу, а к «глазку»: `onVisibilityClickAdditional` — показать пароль: направление 1, кадры 0 → 16; скрыть: направление −1, 16 → 0 |

Обе обезьянки живут в императивно созданном `div` внутри `._sticker`, канвы имеют атрибуты 260×260 при CSS-размере 130 (retina).

### 4.8 Чекбокс «запомнить меня»

**Его в tweb нет.** Ни в одной из семи карточек, ни в `authFlow.module.scss`, ни в исходниках карточек нет чекбокса «keep me signed in». Сессия хранится всегда. Наш экран его рисует (см. §8).

---

## 5. Тайминги и кривые (сводка)

| Что | Длительность | Кривая | Источник |
|---|---|---|---|
| Карточка: вход (`.cardEnterActive`) | opacity 0.18s, transform 0.2s | `ease` | замер + `authFlow.module.scss` |
| Карточка: выход (`.cardExitActive`) | opacity 0.18s, transform 0.2s | `ease` | замер + scss |
| Карточка: сдвиг | `translateX(24px) → 0` / `0 → -24px` | — | scss |
| `enter → enterTo`, `exit → exitTo` | 5–8 мс (один кадр) | — | замер MutationObserver |
| Хост: вход (`.hostEnter/.hostEntering`) | 0.4s + `pause(1000)` до снятия классов | `ease` (дефолт) | scss (живьём не наблюдалось) |
| Хост: выход (`.hostExit/.hostExiting`) | 0.2s, затем `pause(200)` | `ease` | scss (живьём не наблюдалось) |
| `._scrollable` (проявление по шрифтам) | 0.3s | `cubic-bezier(.4,0,.2,1)` (`--transition-standard-in`) | замер |
| Кнопки `.btn-primary` | 0.25s | `cubic-bezier(.4,0,.2,1)` | замер |
| Кнопка-иконка в углу | 0.15s (color, opacity) | `ease-in-out` | замер |
| `.input-field-border` (фокус) | 0.2s opacity | линейно | замер |
| `label` поля | 0.2s transform, 0.2s padding, 0.1s opacity, `font-weight 0s .1s` | — | замер |
| `.input-field-input` border-color | `0s` в покое, `0.2s` на hover | — | `_input.scss` |
| `.arrow-down` (поворот) | 0.2s | — | замер |
| `.select-wrapper` (открытие) | 0.2s opacity + 0.2s transform (`scale(.95) → 1`) | `ease-out` | замер |
| `._digit` (рамка / opacity) | 0.1s / 0.3s | `cubic-bezier(.4,0,.2,1)` | замер |
| `._digit._active` | **без перехода** (`transition: none`) | — | замер |
| Цифра кода: вход/выход | 0.2s | `cubic-bezier(.175,.885,.32,1.275)` | `codeInputField.module.scss` |
| `._caret` мигание | 1.25s, бесконечно | `ease-out` | замер (`_caret-blink`) |
| `._phoneEdit` (hover) | 0.2s opacity (.5 → 1) | — | замер |
| `.toggle-visible` (hover) | 0.2s color | — | замер |
| `.avatar-edit-icon` | 0.2s transform | `ease-in-out` | замер |
| QR: прелоадер → канва | `hide-icon .4s forwards` / `grow-icon .4s forwards`, канва показывается через 150 мс, `animation` снимается через 500 мс | — | замер + `SignQRCard.tsx` |
| `svg.preloader-circular` | `rotate 1s linear infinite` | — | замер |
| Ротация QR-токена | 3 с (`FETCH_INTERVAL`) или до `expires` | — | `SignQRCard.tsx` |
| Опрос `passwordManager.getState()` | 10 с | — | `PasswordCard.tsx` |
| Таймер сброса e-mail | 30 с | — | `AuthCodeCard.tsx` |
| Уничтожение хоста после входа | `setTimeout(…, 1000)` | — | `bootstrapIm.ts` |

---

## 6. Карта классов CSS-модулей (снята из рантайма)

`authFlow.module.scss` (объект `styles` в чанке `bootstrapIm-*.js`) — полезно, чтобы читать дампы:

```
host→_host_1b0yp_9            closeButton→_closeButton_1b0yp_24   themeButton→_themeButton_1b0yp_25
leaving→_leaving_1b0yp_47     scrollable→_scrollable_1b0yp_53     placeholder→_placeholder_1b0yp_63
placeholderTop→_placeholderTop_1b0yp_69                            cardsContainer→_cardsContainer_1b0yp_73
card→_card_1b0yp_73           logo→_logo_1b0yp_89                 logoContainer→_logoContainer_1b0yp_95
errorLabel→_errorLabel_1b0yp_99                                    forgotLink→_forgotLink_1b0yp_106
phoneWrapper→_phoneWrapper_1b0yp_118                               phone→_phone_1b0yp_118
phoneEdit→_phoneEdit_1b0yp_129                                     codeInputField→_codeInputField_1b0yp_143
qrDescription→_qrDescription_1b0yp_147                             qrDescriptionMarker→_qrDescriptionMarker_1b0yp_157
qrDescriptionItem→_qrDescriptionItem_1b0yp_171                     qrContainer→_qrContainer_1b0yp_179
qrCanvas→_qrCanvas_1b0yp_186  pageSignUp→_pageSignUp_1b0yp_191     pageAuthCode→_pageAuthCode_1b0yp_195
pagePassword→_pagePassword_1b0yp_200                               pageSignQR→_pageSignQR_1b0yp_208
hostEnter/hostEntering/hostExit/hostExiting→…_217/_223/_228/_234
cardEnterActive/cardExitActive/cardEnter/cardEnterTo/cardExit/cardExitTo→…_239/_240/_239/_249/_240/_259
```

Из этой карты сразу видно, что **`pageSignIn`, `pageEmailRecover`, `pageSignImport` в модуле не объявлены** — карточки signIn / emailRecover / signImport рендерятся с одним лишь `._card`. Ещё два модуля: `mediaHeader.module.scss` → `_container_1vq66_*` (в DOM класс пустой, поэтому у `<MediaHeader>` голый `div`), `_title_1vq66_1`, `_subtitle_1vq66_8`, `_secondary`, `_sticker_1vq66_19`, `_lottie_1vq66_30`; `codeInputField.module.scss` → `_wrap_87tyg_1`, `_input_87tyg_11`, `_digit_87tyg_33`, `_active_87tyg_48`, `_digitContent_87tyg_59`, `_caret_87tyg_86`.

---

## 7. Какие узлы auth-флоу носят ГЛОБАЛЬНЫЕ классы tweb

Это ответ на отдельно поставленный вопрос: имена CSS-модулей воспроизвести дословно нельзя и не нужно, а вот перечисленное ниже мы обязаны воспроизвести **буква в букву** — differ в режиме `structure` сверяет именно их.

| Группа | Классы | Где объявлены в tweb |
|---|---|---|
| Каркас страницы | `whole` | `base.scss:513` (у нас уже есть — `styles/tweb/_page.scss`) |
| Состояние `body` | `has-auth-pages` (+ приходящие из `index.html` `animation-level-2`, `rounded-sections`) | `index.html`, гейт в `partials/pages/_chats.scss` |
| Скроллер | `scrollable`, `scrollable-y`, `no-scrollbar` | `partials/_scrollable.scss` |
| Кнопки | `btn-primary`, `btn-color-primary`, `btn-secondary`, `btn-primary-transparent`, `primary`, `btn-icon`, `rp`, `c-ripple`, `darkmode_filled` | `partials/_button.scss`, `partials/_ripple.scss` |
| Иконки | `tgico`, `button-icon`, `inline-icon` | `partials/_button.scss` / шрифт иконок |
| Формы | `input-wrapper`, `input-field`, `input-select`, `input-field-input`, `input-field-border`, `input-field-phone`, `input-field-password`, `is-empty`, `error`, `stealthy`, `toggle-visible` | `partials/_input.scss` |
| Селект стран | `select-wrapper`, `z-depth-3`, `hide`, `active`, `arrow`, `arrow-down`, `phone-code`, `emoji`, `emoji-native` | `base.scss:859-925` (`.select-wrapper`, `.phone-code`, `.emoji-native`), `partials/_input.scss` (`.arrow-down`) |
| Текст | `i18n`, `text-center`, `text-overflow-wrap`, `secondary` | `base.scss` / утилиты |
| Медиа | `media-sticker-wrapper`, `lottie`, `preloader`, `preloader-circular`, `preloader-path` | `partials/_preloader.scss`, `partials/_section.scss` |
| Аватар регистрации | `avatar-edit`, `avatar-edit-canvas`, `avatar-edit-icon` | `partials/pages/_chats.scss` (**внимание**: правила под `.page-chats`, на auth-хост не действуют — см. §2.5) |
| Спойлер | `bluff-spoiler`, `bluff-spoiler-letter`, `is-visible` | `partials/_spoiler.scss` |

---

## 8. Наше против tweb

Наш экран: `web-client/src/components/auth/AuthFlow.tsx` (+ `AuthFlow.module.scss`, `CodeInput`, `CountryInput`, `FakeQr`, `QrCode`, `countries.ts`), маскоты — `components/PasswordMonkey.tsx`, `components/TrackingMonkey.tsx`.

### 8.1 Карта соответствия «наш узел → узел tweb»

| наш узел | узел tweb | вердикт |
|---|---|---|
| `div.s.overlay` (`position: fixed; inset: 0; z-index: 5000; display: flex; align-items/justify-content: center; overflow-y: auto; padding: 16px`) | `div.whole._host#auth-pages` + `div.scrollable._scrollable` + две `._placeholder` | **заменить**: у tweb центрирование делают flex-распорки внутри скроллера, а не `align-items: center` на фиксированном оверлее. Нужен маунт `div#auth-flow-root[style="display:contents"]` и `#auth-pages` |
| `<ChatBackground />` (обои чата на экране входа) | **ничего** — фон только `body{background: #181818}` | **удалить**: в tweb на экране входа обоев нет вообще |
| `div.s.card` (`max-width: 384px`, `padding: 40px 36px`, `border-radius: 32px`, `box-shadow: 0 8px 40px -12px rgba(0,0,0,.25)`) | `div._cardsContainer` (`width: min(24.5rem, 100%)` = 392) > `div._card` (`padding: 16px`, `border-radius: 2rem`, **без тени**) | **исправить**: ширина 392 (не 384), padding 16 (не 40/36), тень убрать |
| `motion.div key={step}` (framer `x: ±40`, `DUR.fast`) | `<Transition mode="outin">` + классы `.cardEnter/.cardEnterTo/.cardExit/.cardExitTo` | **заменить**: сдвиг 24px (не 40), длительности .18s/.2s, `mode="outin"`; framer-motion под удаление по программе парити |
| `div.s.logo` (круг 96px с градиентом `--tg-accentGradient` и своим `<svg viewBox="0 0 240 240">`) | `div._sticker._logoContainer` 120×120 + `svg._logo` с `<use href="#logo">`, `fill: var(--primary-color)`, **без круга и без градиента** | **заменить целиком**: у tweb логотип — плоская SVG-иконка 120×120 из спрайта `index.html`, не «кружок с самолётиком» |
| `<Text size={26} weight={600}>` заголовок | `div._title.text-center.text-overflow-wrap` — `500 24px/30px` | размер/вес другие |
| `<Text size={15}>` подзаголовок | `div._subtitle.text-center.secondary` — `16px/21px`, `--secondary-text-color` | размер другой |
| `CountryInput` → `div.s.wrap > div.s.field > input + label + span.s.arrow` + `ul.s.dropdown` | `div.input-field.input-select > div.input-field-input[contenteditable] + div.input-field-border + label + span.arrow.arrow-down + div.select-wrapper.z-depth-3 > div.scrollable > ul > li` | **переписать на глобальные классы**: у нас `<input>` вместо `contenteditable`, нет `.input-field-border`, дропдаун — прямой потомок обёртки без `.scrollable`, у `li` нет grid-раскладки `calc(26px + 2rem) 1fr 80px` |
| `div.s.fieldWrap` + `label.s.fieldLabel` + `input.s.phoneInput` + отдельный `<Text>` с кодом страны | `div.input-field.input-field-phone > div.input-field-input[contenteditable][inputmode=decimal] + div.input-field-border + label` | **переписать**: у tweb код страны лежит **в самом поле**, отдельного текста слева нет; подсказка остатка маски рисуется `::after{content: attr(data-left-pattern)}` |
| `div.s.keepRow` + `div.s.keepBox` («Keep me signed in») | **отсутствует** | **удалить** — в tweb такого чекбокса нет |
| `div.s.accentBtn` (`div`, не `button`; 48px, radius 16, `font-weight: 600`, `letter-spacing: .3px`, hover `filter: brightness(1.06)`) | `button.btn-primary.btn-color-primary.rp > div.c-ripple + span.i18n` (`500 16/21`, `letter-spacing: normal`, без brightness, disabled → `opacity .3`) | **заменить**: нужен `<button>`, ripple, реальный `disabled` |
| `div.s.linkBtn` (текстовая ссылка, hover — подчёркивание) | `button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp` 360×48 | **заменить**: у tweb это полноценная кнопка на 48px, не строка текста |
| `div.s.qrCard` (**белая** подложка `#fff`, radius 18, QR 220) + `div.s.qrLogo` (кружок с самолётиком поверх) | `div._sticker._qrContainer` 240×240, bg `--light-filled-primary-color` #292730, radius 16, `canvas._qrCanvas` 208×208 — **логотип рисует сама библиотека внутри QR** | **заменить**: подложка тёмная тематическая, размер 240/208, оверлей-логотип не нужен |
| `div.s.qrSteps > div.s.qrStepRow > div.s.qrStepNum` (`gap: 14px`, номер 24px, **сплошной** `--primary-color`, белый текст, `font-size: 13`, `font-weight: 700`) | `ol._qrDescription > li._qrDescriptionItem > span._qrDescriptionMarker` (`gap: 12px`, маркер 22px, фон `--light-primary-color`, текст `--primary-color`, `500 14/22`) | **заменить**: должен быть `<ol>/<li>`, маркер бледный, а не заливной |
| `CodeInput` (`div.s.wrap > input.s.input + div.s.digit*`) | `div._wrap._codeInputField > input._input + div._digit*` | **близко**: структура совпала. Отличия — у нас нет `container-type: inline-size`, нет `pointer-events: none/all` пары, `active` считается как `min(value.length, length-1)` (у tweb — по `selectionStart`, с поддержкой стрелок и выделения) |
| `div.s.codeError` (`min-height: 1lh`, `font-size: 14px`, `--danger-color`) | `div._errorLabel` (`height: 1lh`, 14px, `--danger-color`) | **почти 1:1**, поправить `min-height` → `height` |
| экран пароля: `div.s.fieldWrap > input[type=password] + IconButton(eye)` | `div.input-field.input-field-password > input.stealthy + input.input-field-input + input.stealthy + div.input-field-border + label + span.toggle-visible` | **переписать**: нет `stealthy`-ловушек автозаполнения, нет `label` с хинтом (у нас хинт в `placeholder`), `toggle-visible` — не `IconButton` |
| экран пароля: ссылка «забыли пароль» | `span.i18n._forgotLink > a[href="#"]` | **отсутствует у нас** |
| `TrackingMonkey` / `PasswordMonkey` (наши компоненты) | `div.media-sticker-wrapper` с 2 / 1 канвой `canvas.lottie` внутри `div._sticker` | сверить обёртки и размеры: у tweb `--sticker-size: 130px`, канва 260×260 атрибутами, обёртка `._sticker{margin: .125rem auto .5rem}` |
| `div.s.cornerBtn.cornerBtnLeft/Right` (`top: 20px`, `left/right: 20px`, bg `rgba(255,255,255,.2)`) | `button.btn-icon._closeButton/._themeButton.rp` (`top: 24px`, `left/right: 24px`, bg `--message-highlighting-color`, hover +.24 alpha) | **исправить инсеты и цвет**; левая кнопка в tweb показывается **только** при `getCurrentAccount() !== 1`, а у нас ещё и как «назад» между шагами |
| — | карточки `signUp`, `emailRecover`, `signImport` | **отсутствуют у нас целиком** (у нас 4 шага: phone / qr / code / password) |
| — | `LanguageChangeButton` («Продолжить на русском» в `GrowHeightReveal`) | **отсутствует** |
| наш `passkeyLogin` как `div.s.linkBtn` | `PasskeyLoginButton` в `GrowHeightReveal` + `button.btn-primary.btn-secondary…` | привести к кнопке и обёртке |

### 8.2 Топ-10 расхождений по значимости

1. **Обои под карточкой.** У нас `<ChatBackground/>` рисует анимированный градиент с дудлами; в tweb на экране входа фон — плоский `--background-color`. Это самое заметное визуальное расхождение и оно же тянет за собой белые кнопки-кружки в углах и белую подложку QR.
2. **Нет маунта `#auth-pages` и оболочки-скроллера.** У нас фиксированный оверлей с `align-items: center`; в tweb — `.whole` внутри `#auth-flow-root[display:contents]`, `.scrollable` и две flex-распорки (`min-height` верхней = 80px, чтобы карточка не залезала под угловые кнопки на низком вьюпорте). Наш вариант при короткой высоте окна прижмёт карточку к краю.
3. **Три карточки не реализованы**: регистрация (`signUp`), восстановление по e-mail (`emailRecover`), импорт сессии (`signImport`). Флоу обрывается на `password`.
4. **Поля ввода — своя вёрстка вместо `.input-field`.** У нас `.fieldWrap/.fieldLabel/.phoneInput`; у tweb — глобальные `.input-field/.input-field-input/.input-field-border/label`, причём `.input-field-border` (двухпиксельная рамка с `opacity`-переходом) отсутствует у нас в принципе, поэтому фокус выглядит иначе.
5. **Код страны вынесен из поля телефона.** У нас `+7` — отдельный `<Text>` слева от инпута; в tweb он часть значения поля, а остаток маски — `::after{content: attr(data-left-pattern)}`. Из-за этого у нас нет ни подсказки маски, ни корректной вставки из буфера.
6. **Кнопки — `div`, а не `button`, без ripple и без `disabled`.** `.accentBtn`/`.linkBtn` не имеют `.c-ripple`, вторичная кнопка сделана строкой текста вместо кнопки 360×48; disabled у нас `opacity: .5` против `.3` у tweb.
7. **Логотип.** Круг 96px с градиентом и собственным самолётиком против плоского `svg` 120×120 c `fill: var(--primary-color)` из спрайта. Требует переноса `#logo` в наш `index.html`-спрайт.
8. **QR-блок.** Белая подложка + оверлей-логотип + размер 220 против тематической `--light-filled-primary-color`, radius 16, размера 240/208 и логотипа, вшитого в саму матрицу QR. Плюс у tweb QR перерисовывается на `theme_changed`.
9. **Чекбокс «Keep me signed in» — отсебятина.** В tweb такого элемента нет ни на одном экране входа.
10. **Переходы карточек.** framer-motion `x: ±40` с `DUR.fast` против CSS-классов `.cardEnter…` (24px, opacity .18s / transform .2s, `mode="outin"`). Плюс у нас `AnimatePresence mode="wait"` внутри карточки, из-за чего анимируется только контент, а сама карточка (фон/тень) не участвует.

Мелочи того же порядка, не попавшие в топ: заголовок 26/600 против 24/500; подзаголовок 15 против 16; `linkBtn` не uppercase-кнопка; шаг сетки полей 24px у tweb (`.input-wrapper{gap: 1.5rem}`) против ручных `margin-top`; список стран у нас с виртуализацией-фильтром и без `.scrollable`-обёртки, `li` без grid-колонок.

### 8.3 Что портировать из SCSS

Уже есть в `web-client/src/styles/tweb/`: `_page.scss` (только `.whole`), `pages/_chats.scss` (полная копия tweb), `_input.scss` (включая `.input-wrapper`, `.input-field*`, `.input-field-phone`, `.input-field-password`, `.toggle-visible`), `_button.scss` (`.btn-primary`, `.btn-secondary`, `.btn-color-primary`, `.btn-icon`), `_ripple.scss`, `_preloader.scss`, `_scrollable.scss`, `_spoiler.scss`.

Не хватает:

1. **`partials/pages/_pages.scss`** — у нас его нет вовсе. Оттуда нужны `#main-columns{opacity;transition}`, `.main-screen-*` и `.chatlist-*` (анимации перехода auth ↔ мессенджер) и `.page-chats .input-wrapper`. Наш `styles/tweb/_page.scss` содержит только `.whole` — это выдержка из `base.scss`, а не порт `_pages.scss`; имена совпали случайно, стоит переименовать наш в `_whole.scss` или дополнить.
2. **Блок `.select-wrapper` + `.phone-code` + `.emoji-native`** из `base.scss:859-925` — выпадающего списка стран в наших партиалах нет ни в каком виде.
3. **`authFlow.module.scss`** — портировать как собственный SCSS-модуль (имена классов свои, значения 1:1). 34 класса, из них 4 page-модификатора; `pageSignIn`/`pageEmailRecover`/`pageSignImport` не нужны — их нет и в оригинале.
4. **`components/mediaHeader.module.scss`** — `.title/.subtitle/.secondary/.sticker/.lottie` (общий заголовок «иконка → тайтл → сабтайтл», используется не только auth-флоу).
5. **`components/codeInputField.module.scss`** — у нас есть свой `CodeInput.module.scss`; сверить значения (48px ячейка, radius 12, gap 10, `container-type: inline-size`, `letter-spacing: -1em`, кейфрейм `caret-blink`).
6. **`.avatar-edit` для карточки регистрации** — брать не из `.page-chats` (см. §2.5), а завязывать на `--sticker-size`.
7. **Класс `has-auth-pages` на `body`** — нужен и как гейт анимации колонок при выходе в мессенджер (правило уже скопировано в наш `pages/_chats.scss`, но сам класс никто не ставит и не снимает).

---

## 9. Не найдено / не замерено

- **Скриншоты.** Не сохранены сознательно: MCP-инструмент `take_screenshot` в этой сессии дважды снял чужую вкладку вместо выбранной (в одном случае — приватную переписку пользователя, файл удалён немедленно). Приложить проверяемый скриншот именно изолированного контекста не удалось, поэтому визуальных артефактов в `tweb-dom/` для auth нет — только деревья и computed.
- **Анимации входа/выхода хоста** (`.hostEnter/.hostEntering/.hostExit/.hostExiting`) — живьём не наблюдались: нужен второй аккаунт (кнопка `._closeButton` рендерится только при `getCurrentAccount() !== 1`) и флаг `should_animate_auth` в sessionStorage. Значения взяты из `authFlow.module.scss` и помечены как таковые.
- **Кнопка `._closeButton`** — по той же причине в DOM не появлялась; её computed не замерены (по scss она отличается от `._themeButton` только `left: 24px`).
- **Состояния ошибок** — «неверный код» (`._wrap._error`, красные рамки ячеек, текст в `._errorLabel`), «неверный пароль» (`.input-field-input.error` + shake-кейфрейм), `PHONE_NUMBER_INVALID` (`telInputField.setError()` + подмена текста `label`). Вызвать их можно только реальным запросом к серверу авторизации — не делалось.
- **Состояние отправки** — в кнопках `Next` появляется `svg.preloader-circular > circle.preloader-path`, текст меняется на `PleaseWait`. Требует реального `auth.sendCode` / `auth.signIn`.
- **Вариант `auth.sentCodeTypeFragmentSms`** (лотти `jolly_roger` вместо обезьянки) и `auth.sentCodeTypeEmailCode` (блок `._forgotLink` со сбросом e-mail и таймером 30 с) — не поднимались: требуют соответствующего ответа сервера. Структура описана по `AuthCodeCard.tsx` и помечена.
- **Мобильная раскладка** (`respond-to(handhelds)`: `.pagePassword .input-wrapper{margin-top: 31px}`, `stickerSize = 100` вместо 130, `@container (width <= 320px)` для ячеек кода) — замеров нет, снималось только на 1728×941.
- **Дневная тема** — весь съём в `night`; вторая палитра не замерена.
- **`._codeInputField` в `emailRecover`** — у карточки восстановления поле кода идёт без этого класса; проверить, намеренно ли (в `AuthCodeCard` класс передаётся через `class: styles.codeInputField`, в `EmailRecoverCard` — нет). Похоже на недосмотр оригинала; при порте воспроизводим как есть.
- **`data-left-pattern` в непустом состоянии** — замерен только пустым (номер добран целиком). Как именно выглядит подсказка недобранной маски, не снято.

---

## 10. Эталоны в DOM-diff харнесе

Все замеренные деревья разложены в `web-client/scripts/domdiff/expected/viewers.json` (9 ключей, режим `structure`, корень `#auth-pages`), замеры — в `expected/computed.json` (9 блоков), анимации — в `expected/anims.json` (2 блока). Реконструкций по исходникам в эталонах **нет**. Как пользоваться — в `web-client/scripts/domdiff/README.md`, раздел «Экран авторизации».

```bash
node scripts/domdiff/run.js --list | grep auth-
node scripts/domdiff/run.js --snippet-for auth-signin-card-country-list-collapsed
node scripts/domdiff/run.js --actual snapshots/our-auth.json --key auth-signin-card-country-list-collapsed
node scripts/domdiff/run.js --actual snapshots/our-auth-computed.json --computed '13-auth-signin.json:computed: auth signIn (rest)'
```
