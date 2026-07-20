# Bot API

Telegram-подобный HTTP-интерфейс для ботов-сервисов. Бот получает апдейты
(long-poll или webhook) и отвечает вызовом методов.

## Базовый адрес

```
<API_BASE>/bot/<token>/<method>
```

- `API_BASE` — база API за nginx, например `https://localhost:38443/api`
  (в проде — ваш домен + `/api`).
- `<token>` — токен от [@BotFather](creating-bots.md).
- Метод вызывается **GET или POST**. Параметры — в JSON-теле (`Content-Type:
  application/json`) или в query-строке.
- Аутентификация — по токену в пути. Заголовок `Authorization` не нужен.

> Путь — `/bot/<token>/<method>` (со слэшем после `bot`), в отличие от слитного
> `/bot<token>/` у оригинального Telegram.

## Формат ответа

Успех:

```json
{ "ok": true, "result": <...> }
```

Ошибка:

```json
{ "ok": false, "error_code": 401, "description": "Unauthorized: bad token" }
```

## Апдейты

Апдейт (`Update`) — это объект с полем `update_id` и **одним** из:

### message — пользователь написал боту

```json
{
  "update_id": 42,
  "message": {
    "message_id": 1314,
    "from": { "id": 4, "is_bot": false, "first_name": "Денис", "username": "denis228" },
    "chat": { "id": 91, "type": "private" },
    "date": 1750000000,
    "text": "/start"
  }
}
```

### callback_query — нажата inline callback-кнопка

```json
{
  "update_id": 43,
  "callback_query": {
    "id": "e3b0c44298fc1c149afbf4c8",
    "from": { "id": 4, "is_bot": false, "first_name": "Денис" },
    "message": { "message_id": 1315, "chat": { "id": 91, "type": "private" } },
    "data": "like"
  }
}
```

### inline_query — пользователь набрал `@bot запрос`

```json
{
  "update_id": 44,
  "inline_query": {
    "id": "7d865e959b2466918c9863",
    "from": { "id": 4, "is_bot": false, "first_name": "Денис" },
    "query": "pizza",
    "offset": ""
  }
}
```

> **Важно:** на `callback_query` и `inline_query` нужно ответить
> (`answerCallbackQuery` / `answerInlineQuery`) в течение **~6 секунд** — клиент
> ждёт ответа синхронно. Не ответите — пользователь увидит пустой результат.

## Получение апдейтов

### Вариант A — long-poll (`getUpdates`)

Бот сам опрашивает сервер. Держите `offset` = `update_id` последнего
обработанного апдейта **плюс один** — так подтверждаются обработанные апдейты.

```
POST /bot/<token>/getUpdates
{ "offset": 0, "limit": 100, "timeout": 25 }
```

- `timeout` (сек, ≤30) — сколько держать соединение, если апдейтов нет
  (long-poll). Вернёт раньше, как только появится апдейт.
- Ответ: `{ "ok": true, "result": [ <Update>, ... ] }`.

Цикл:

```js
let offset = 0
for (;;) {
  const { result } = await api('getUpdates', { offset, timeout: 25 })
  for (const u of result) {
    offset = u.update_id + 1
    // обработать u.message / u.callback_query / u.inline_query
  }
}
```

### Вариант B — webhook

Сервер сам POST'ит каждый `Update` (JSON-тело) на ваш URL.

```
POST /bot/<token>/setWebhook   { "url": "https://your-service.example/hook" }
POST /bot/<token>/deleteWebhook
```

Ваш обработчик:

```js
http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const update = JSON.parse(body)   // { update_id, message | callback_query | inline_query }
    handle(update)
    res.end('ok')
  })
})
```

URL должен быть доступен серверу мессенджера. Локально (Docker) — например
`http://host.docker.internal:<port>/hook`.

Можно задать webhook И параллельно вызывать getUpdates — апдейты кладутся в
очередь в любом случае.

## Методы

### getMe
```
GET /bot/<token>/getMe
→ result: { "id": 777123, "is_bot": true, "first_name": "Мой бот", "username": "my_shop_bot" }
```

### sendMessage
Отправить сообщение в чат (бот должен быть участником — т.е. пользователь ему писал).
```
POST /bot/<token>/sendMessage
{
  "chat_id": 91,
  "text": "Привет!",
  "reply_markup": { ... }        // необязательно, см. ниже
}
→ result: { "message_id": 1316, "chat": { "id": 91, "type": "private" }, "text": "Привет!" }
```

### answerCallbackQuery
Ответ на нажатие callback-кнопки — всплывающий тост или алерт.
```
POST /bot/<token>/answerCallbackQuery
{ "callback_query_id": "e3b0...", "text": "Готово!", "show_alert": false }
```

### answerInlineQuery
Ответ на inline-запрос — список результатов (тип `article`).
```
POST /bot/<token>/answerInlineQuery
{
  "inline_query_id": "7d86...",
  "results": [
    {
      "type": "article",
      "id": "1",
      "title": "Отправить pizza",
      "description": "как есть",
      "input_message_content": { "message_text": "pizza" }
    }
  ]
}
```
Выбор результата отправит `input_message_content.message_text` в чат.

### setMyCommands
```
POST /bot/<token>/setMyCommands
{ "commands": [ { "command": "start", "description": "запустить" } ] }
```

### setChatMenuButton
Кнопка-меню mini-app у поля ввода (см. [Mini-Apps](mini-apps.md)).
```
POST /bot/<token>/setChatMenuButton
{ "menu_button": { "type": "web_app", "text": "Открыть", "web_app": { "url": "https://.../app.html" } } }
```

### setWebhook / deleteWebhook / getMe
См. выше.

## reply_markup

Передаётся в `sendMessage`. Поддержаны три вида (как в Telegram).

### Inline-клавиатура (кнопки под сообщением)
```json
{
  "inline_keyboard": [
    [ { "text": "👍 Лайк", "callback_data": "like" },
      { "text": "🌐 Сайт", "url": "https://telegram.org" } ],
    [ { "text": "🚀 Mini-app", "web_app": { "url": "https://.../app.html" } } ]
  ]
}
```
Ровно одно из `callback_data` / `url` / `web_app` на кнопку:
- `callback_data` → придёт `callback_query`, ответьте `answerCallbackQuery`;
- `url` → откроется ссылка;
- `web_app` → откроется [mini-app](mini-apps.md).

### Reply-клавиатура (кнопки над полем ввода)
```json
{ "keyboard": [ [ "Кнопка A", "Кнопка B" ], [ "/help" ] ], "resize_keyboard": true, "one_time_keyboard": false }
```
Нажатие кнопки отправляет её текст обычным сообщением.

### Убрать reply-клавиатуру
```json
{ "remove_keyboard": true }
```

## Полный пример (long-poll)

```js
const TOKEN = process.env.BOT_TOKEN
const BASE = process.env.API_BASE || 'https://localhost:38443/api'
if (BASE.startsWith('https://localhost')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const api = (method, params) =>
  fetch(`${BASE}/bot/${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  }).then((r) => r.json()).then((j) => j.result)

async function onMessage(m) {
  if (m.text === '/start') {
    await api('sendMessage', {
      chat_id: m.chat.id,
      text: `Привет, ${m.from.first_name}!`,
      reply_markup: { inline_keyboard: [[{ text: '👍', callback_data: 'like' }]] },
    })
  } else {
    await api('sendMessage', { chat_id: m.chat.id, text: `Эхо: ${m.text}` })
  }
}

async function main() {
  console.log('bot:', (await api('getMe')).username)
  let offset = 0
  for (;;) {
    const updates = (await api('getUpdates', { offset, timeout: 25 })) || []
    for (const u of updates) {
      offset = u.update_id + 1
      if (u.message) await onMessage(u.message)
      else if (u.callback_query)
        await api('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: 'Спасибо!', show_alert: true })
      else if (u.inline_query)
        await api('answerInlineQuery', {
          inline_query_id: u.inline_query.id,
          results: [{ type: 'article', id: '1', title: u.inline_query.query, input_message_content: { message_text: u.inline_query.query } }],
        })
    }
  }
}
main()
```

Готовый вариант с mini-app-кнопкой: [`examples/bot/demo-bot.mjs`](../../examples/bot/demo-bot.mjs).

## Не реализовано

Пока вне подмножества (в оригинальном Telegram есть): медиа-методы
(`sendPhoto`/`sendDocument`/…), `editMessageText`/`deleteMessage`, платежи и
инвойсы, `getChat*`, опросы через Bot API. Callback/inline рассчитаны на
синхронный ответ (таймаут ~6с), а не на отложенную обработку.
