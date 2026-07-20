// Пример внешнего бота-сервиса для нашего Bot API (аналог Telegram Bot API).
// Long-poll getUpdates + sendMessage/answerCallbackQuery/answerInlineQuery.
//
// Запуск:
//   BOT_TOKEN=<токен от @BotFather> node examples/bot/demo-bot.mjs
// Опции окружения:
//   API_BASE   — базовый URL Bot API (по умолчанию https://localhost:38443/api)
//   WEBAPP_URL — URL mini-app для webapp-кнопки (по умолчанию /webapp-demo.html)
//
// Токен создаётся в приложении через @BotFather: /newbot → имя → username.

const TOKEN = process.env.BOT_TOKEN
if (!TOKEN) {
  console.error('Укажите BOT_TOKEN (получите у @BotFather через /newbot)')
  process.exit(1)
}
const BASE = process.env.API_BASE || 'https://localhost:38443/api'
const WEBAPP_URL = process.env.WEBAPP_URL || '/webapp-demo.html'
// Локальный self-signed cert стенда — отключаем проверку TLS для примера.
if (BASE.startsWith('https://localhost')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

async function api(method, params) {
  const res = await fetch(`${BASE}/bot/${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  })
  const json = await res.json()
  if (!json.ok) console.error(`${method} failed:`, json.description)
  return json.result
}

async function onMessage(m) {
  const text = (m.text || '').trim()
  if (text === '/start') {
    await api('sendMessage', {
      chat_id: m.chat.id,
      text: `Привет, ${m.from.first_name || 'друг'}! Я внешний бот-сервис на Bot API 🤖`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '👍 Лайк', callback_data: 'like' }, { text: '🌐 Сайт', url: 'https://telegram.org' }],
          [{ text: '🚀 Открыть mini-app', web_app: { url: WEBAPP_URL } }],
        ],
      },
    })
    return
  }
  if (text === '/help') {
    await api('sendMessage', { chat_id: m.chat.id, text: 'Команды: /start, /photo — фото, /help. Ещё: inline «@<username> запрос», mini-app с CloudStorage и sendData.' })
    return
  }
  if (text === '/photo' || text.startsWith('/start ')) {
    // sendPhoto по URL (сервер сам скачает и положит в хранилище).
    await api('sendPhoto', {
      chat_id: m.chat.id,
      photo: 'https://picsum.photos/600/400',
      caption: text.startsWith('/start ') ? `Deep-link payload: ${text.slice(7)}` : 'Случайная картинка 🖼️',
    })
    return
  }
  // web_app_data: данные из mini-app (sendData) дошли до бота.
  if (m.web_app_data) {
    await api('sendMessage', { chat_id: m.chat.id, text: `Из mini-app получено: «${m.web_app_data.data}»` })
    return
  }
  // эхо
  await api('sendMessage', {
    chat_id: m.chat.id,
    text: `Вы написали: «${text}»`,
    reply_markup: { inline_keyboard: [[{ text: '🔁 Повторить', callback_data: 'again' }]] },
  })
}

async function onCallback(cq) {
  // Демонстрируем editMessageText: по «like» правим само сообщение (в т.ч. клавиатуру).
  if (cq.data === 'like' && cq.message) {
    await api('editMessageText', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      text: 'Вам понравилось ❤️ (сообщение отредактировано ботом)',
      reply_markup: { inline_keyboard: [[{ text: '↩️ Вернуть', callback_data: 'again' }]] },
    })
    await api('answerCallbackQuery', { callback_query_id: cq.id, text: 'Спасибо за лайк! ❤️', show_alert: true })
    return
  }
  const map = { again: { text: 'Готово 🙂' } }
  const a = map[cq.data] || { text: cq.data }
  await api('answerCallbackQuery', { callback_query_id: cq.id, text: a.text, show_alert: !!a.show_alert })
}

async function onInline(q) {
  const query = q.query || ''
  const results = query
    ? [
        { type: 'article', id: 'echo', title: query, description: 'Отправить как есть', input_message_content: { message_text: query } },
        { type: 'article', id: 'shout', title: query.toUpperCase() + '!', description: 'Громко', input_message_content: { message_text: query.toUpperCase() + '!' } },
      ]
    : [{ type: 'article', id: 'hi', title: 'Поздороваться', description: 'Отправить привет', input_message_content: { message_text: 'Привет! 👋' } }]
  await api('answerInlineQuery', { inline_query_id: q.id, results })
}

async function main() {
  const me = await api('getMe')
  if (!me) process.exit(1)
  console.log(`Бот @${me.username} (id ${me.id}) запущен. Жду апдейты…`)
  let offset = 0
  for (;;) {
    const updates = (await api('getUpdates', { offset, timeout: 25 })) || []
    for (const u of updates) {
      offset = u.update_id + 1
      try {
        if (u.message) await onMessage(u.message)
        else if (u.callback_query) await onCallback(u.callback_query)
        else if (u.inline_query) await onInline(u.inline_query)
      } catch (e) {
        console.error('handler error:', e)
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
