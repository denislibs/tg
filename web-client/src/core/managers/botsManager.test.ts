// `keyboardButtonCallback.data` в схеме — `bytes`, и байты едут одной формой на
// всём пути: на JSON-проводе фазы 0 это base64-строка и в сообщении, и в теле
// запроса нажатия (`bot_handler.go::BotCallback` принимает `[]byte`, то есть ту
// же base64). Витрина её не разворачивает — иначе у одного значения появилось бы
// две формы, и место пришлось бы переделывать на фазе 2 вместе с кодеком.
// В оригинале ровно так же: `callbackButtonClick` кладёт `button.data` в запрос
// без обработки (tweb appInlineBotsManager.ts:225-232).
import { describe, expect, it, vi } from 'vitest'

import { newBotsManager } from './botsManager'

function fakeRest() {
  const post = vi.fn().mockResolvedValue({ text: 'ок', alert: false })
  return { rest: { get: vi.fn(), post } as never, post }
}

describe('BotsManager.callback', () => {
  it('шлёт data кнопки без преобразований', async () => {
    const { rest, post } = fakeRest()
    // base64('alert') — то, что демо-бот бэкенда сравнивает со своим сценарием
    // (usecase/chat/bot.go: switch data { case "alert": … }) уже после разбора.
    await newBotsManager({ rest }).callback(42, 7, 'YWxlcnQ=', 100)

    expect(post).toHaveBeenCalledWith('/bots/42/callback', { chat_id: 7, message_id: 100, data: 'YWxlcnQ=' })
  })

  it('message_id необязателен — уходит 0, как ждёт ручка', async () => {
    const { rest, post } = fakeRest()
    await newBotsManager({ rest }).callback(1, 2, 'Y2I=')

    expect(post).toHaveBeenCalledWith('/bots/1/callback', { chat_id: 2, message_id: 0, data: 'Y2I=' })
  })
})
