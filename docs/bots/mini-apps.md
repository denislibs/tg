# Mini-Apps

Mini-app — это ваша веб-страница, которая открывается **внутри приложения** в
iframe и общается с ним через мост `window.Telegram.WebApp` (протокол 1:1 с
Telegram Web Apps). Тема, главная кнопка, отправка данных боту, попапы, ссылки —
всё через этот мост.

## Точки входа

Пользователь может открыть mini-app двумя способами:

### 1. Inline web_app-кнопка (под сообщением)

Бот в `sendMessage` кладёт кнопку `web_app`:

```json
{
  "chat_id": 91,
  "text": "Откройте магазин:",
  "reply_markup": { "inline_keyboard": [[ { "text": "🚀 Открыть", "web_app": { "url": "https://.../app.html" } } ]] }
}
```

### 2. Кнопка-меню у поля ввода

Задаётся один раз — через @BotFather (`/setmenubutton`) или методом
`setChatMenuButton`:

```
POST /bot/<token>/setChatMenuButton
{ "menu_button": { "type": "web_app", "text": "Открыть", "web_app": { "url": "https://.../app.html" } } }
```

После этого в чате с ботом слева от поля ввода появляется пилюля с этим текстом,
открывающая mini-app.

### Именованный mini-app (`/newapp`)

`/newapp` у @BotFather заводит именованное приложение (название + короткое имя +
URL) и даёт прямую ссылку вида `t.me/<bot>/<app>`.

## Как устроен мост

Страница загружается в iframe. Обмен — строками JSON `{ eventType, eventData }`
через `postMessage` в обе стороны:

- **mini-app → приложение:** `window.parent.postMessage(JSON.stringify({eventType, eventData}), '*')`
- **приложение → mini-app:** приходит `message`-событие с таким же JSON.

Вам **не нужно** реализовывать это вручную — используйте объект
`window.Telegram.WebApp` (shim). Полный готовый shim — в
[`telegram-ui-clone/public/webapp-demo.html`](../../telegram-ui-clone/public/webapp-demo.html);
скопируйте `<script>` оттуда в свою страницу.

## API `Telegram.WebApp` (поддерживаемое подмножество)

| Метод / поле | Описание |
|---|---|
| `ready()` | Сообщить, что страница загрузилась (скрывает лоадер) |
| `close()` | Закрыть mini-app |
| `expand()` | Развернуть (no-op — окно и так во всю площадь) |
| `sendData(data)` | Отправить строку боту и закрыть mini-app |
| `openLink(url)` | Открыть внешнюю ссылку |
| `themeParams` | Объект цветов темы (см. ниже) |
| `enableClosingConfirmation()` / `disableClosingConfirmation()` | Спрашивать подтверждение при закрытии |
| `showPopup(params, cb)` | Нативный попап; `cb(button_id)` по нажатию |
| `HapticFeedback.impactOccurred()` | Вибрация |
| `MainButton` | Главная кнопка снизу |
| `BackButton` | Кнопка «назад» в шапке |
| `CloudStorage` | Ключ-значение на пару бот+пользователь (см. ниже) |
| `showScanQrPopup(p, cb)` / `closeScanQrPopup()` | Сканер QR (камера + BarcodeDetector) |
| `requestContact(cb)` | Запрос телефона у пользователя (подтверждение) |
| `openInvoice(url, cb)` | Оплата (в текущей версии — подтверждение, статус paid/cancelled) |

**CloudStorage:** `.setItem(key, value, cb)`, `.getItem(key, cb)`, `.getKeys(cb)`,
`.removeItem(key, cb)`. Хранится на сервере per (бот, пользователь); лимиты как в
Telegram (ключ ≤128, значение ≤4096, до 1024 ключей). Под капотом — Telegram
`web_app_invoke_custom_method` (`saveStorageValue`/`getStorageValues`/…).

**Сенсоры:** `Accelerometer` / `Gyroscope` / `DeviceOrientation` проброшены на
DeviceMotion/DeviceOrientation браузера (работают на устройстве с датчиками; на
десктопе события не приходят). `requestWriteAccess` — подтверждение записи.

**MainButton:** `.setText(t)`, `.show()`, `.hide()`, `.enable()`, `.disable()`,
`.showProgress()`, `.hideProgress()`, `.onClick(cb)`, `.setParams({...})`.

**BackButton:** `.show()`, `.hide()`, `.onClick(cb)`.

### themeParams

Приложение передаёт тему (при загрузке и при её смене). Ключи:

`bg_color`, `text_color`, `hint_color`, `link_color`, `button_color`,
`button_text_color`, `secondary_bg_color`, `header_bg_color`, `accent_text_color`,
`section_bg_color`, `destructive_text_color`.

Значения — CSS-цвета текущей темы приложения (светлой/тёмной). Применяйте их к
своей вёрстке, чтобы mini-app выглядел «родным».

## Минимальный шаблон

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui; padding: 20px;">
  <h1 id="title">Loading…</h1>
  <input id="name" placeholder="Ваше имя">

  <script>
  // --- shim моста (сокращённый; полный — в public/webapp-demo.html) ---
  var handlers = {}
  function post(type, data) { parent.postMessage(JSON.stringify({ eventType: type, eventData: data }), '*') }
  window.addEventListener('message', function (e) {
    var m; try { m = JSON.parse(e.data) } catch (_) { return }
    if (m.eventType === 'theme_changed') applyTheme(m.eventData.theme_params)
    if (m.eventType === 'main_button_pressed' && handlers.main) handlers.main()
  })
  function applyTheme(tp) {
    if (tp && tp.bg_color) document.body.style.background = tp.bg_color
    if (tp && tp.text_color) document.body.style.color = tp.text_color
  }
  var WebApp = {
    themeParams: {},
    ready: function () { post('web_app_ready') },
    close: function () { post('web_app_close') },
    sendData: function (d) { post('web_app_data_send', { data: d }) },
    MainButton: {
      setText: function (t) { this._t = t; return this },
      show: function () { post('web_app_setup_main_button', { is_visible: true, is_active: true, text: this._t || '' }); return this },
      hide: function () { post('web_app_setup_main_button', { is_visible: false }); return this },
      onClick: function (cb) { handlers.main = cb; return this },
    },
  }
  window.Telegram = { WebApp: WebApp }

  // --- ваш код ---
  document.getElementById('title').textContent = 'Demo Mini App'
  var name = document.getElementById('name')
  name.addEventListener('input', function () {
    if (name.value) WebApp.MainButton.setText('Отправить').show()
    else WebApp.MainButton.hide()
  })
  WebApp.MainButton.onClick(function () { WebApp.sendData(name.value) })
  WebApp.ready()
  post('web_app_request_theme')  // запросить тему
  </script>
</body>
</html>
```

Когда пользователь нажмёт главную кнопку, `sendData` пришлёт строку — приложение
покажет тост, **доставит данные боту-владельцу** апдейтом `web_app_data` (см.
[Bot API](bot-api.md)) и закроет mini-app.

## События (справочно)

**mini-app → приложение:** `web_app_ready`, `web_app_request_theme`,
`web_app_setup_main_button`, `web_app_setup_back_button`,
`web_app_setup_closing_behavior`, `web_app_open_link`, `web_app_open_tg_link`,
`web_app_data_send`, `web_app_open_popup`, `web_app_trigger_haptic_feedback`,
`web_app_close`.

**приложение → mini-app:** `theme_changed`, `main_button_pressed`,
`back_button_pressed`, `popup_closed`.

## Требования и ограничения

- Страница должна отдаваться по **https** и быть самодостаточной (в деве можно
  положить в `telegram-ui-clone/public/` — раздаётся тем же nginx, тогда URL
  относительный, например `/my-app.html`).
- Реальный `telegram-web-app.js` с telegram.org **не** загружается — используйте
  свой shim (шаблон выше / `public/webapp-demo.html`, где есть готовые
  CloudStorage/QR/sendData/контакт/инвойс).
- **QR-сканер** работает через нативный `BarcodeDetector` (Chromium); где его нет —
  сканер сообщает о неподдержке.
- **Биометрия** на вебе недоступна: `BiometryManager` отвечает по протоколу
  `available:false` (как в Telegram Web). Платежи (`openInvoice`) — упрощённые
  (подтверждение + статус), без реального платёжного провайдера.
