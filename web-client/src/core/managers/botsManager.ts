import type { RestClient } from '../net/restClient'

// Боты (демо-бот @demobot). Реальных ботов нет — есть один демо-бот, который
// авто-отвечает на сервере; клиент рендерит его клавиатуры и шлёт callback.

export interface InlineButton {
  text: string
  callback?: string
  url?: string
  webapp?: string
}
export interface ReplyMarkup {
  inline?: InlineButton[][]
  keyboard?: string[][]
  resize?: boolean
  oneTime?: boolean
}
export interface BotCommand {
  command: string
  description: string
}
export interface CallbackAnswer {
  text: string
  alert: boolean
}
// Элемент выдачи inline-режима (@bot query). MVP: article — эмодзи + заголовок +
// описание; выбор шлёт messageText в чат.
export interface InlineResult {
  id: string
  title: string
  description?: string
  emoji?: string
  messageText: string
}
interface RawInlineResult {
  id: string
  title: string
  description?: string
  emoji?: string
  message_text: string
}

interface RawMarkup {
  inline?: InlineButton[][]
  keyboard?: string[][]
  resize?: boolean
  one_time?: boolean
}
export const mapReplyMarkup = (r: RawMarkup): ReplyMarkup => ({
  inline: r.inline, keyboard: r.keyboard, resize: r.resize, oneTime: r.one_time,
})

export function newBotsManager({ rest }: { rest: Pick<RestClient, 'get' | 'post'> }) {
  return {
    async commands(botId: number): Promise<BotCommand[]> {
      const r = await rest.get<{ commands: BotCommand[] }>(`/bots/${botId}/commands`)
      return r.commands ?? []
    },
    // Нажатие callback-кнопки: возвращает всплывающий ответ (toast/alert).
    async callback(botId: number, chatId: number, data: string, messageId?: number): Promise<CallbackAnswer> {
      return rest.post<CallbackAnswer>(`/bots/${botId}/callback`, { chat_id: chatId, message_id: messageId ?? 0, data })
    },
    // Кнопка-меню mini-app бота (пусто — не задана).
    async menuButton(botId: number): Promise<{ text: string; url: string }> {
      return rest.get<{ text: string; url: string }>(`/bots/${botId}/menu_button`)
    },
    // Inline-режим: результаты + плейсхолдер поля ввода.
    async inline(botId: number, query: string): Promise<{ results: InlineResult[]; placeholder: string }> {
      const r = await rest.get<{ results: RawInlineResult[]; placeholder?: string }>(`/bots/${botId}/inline?q=${encodeURIComponent(query)}`)
      return {
        results: (r.results ?? []).map((x) => ({
          id: x.id, title: x.title, description: x.description, emoji: x.emoji, messageText: x.message_text,
        })),
        placeholder: r.placeholder ?? '',
      }
    },
    // Deep link t.me/<bot>?start=<payload>: открыть чат и послать /start.
    async start(botId: number, payload: string): Promise<{ chat_id: number }> {
      return rest.post<{ chat_id: number }>(`/bots/${botId}/start`, { payload })
    },
    // sendData из mini-app → боту-владельцу (web_app_data).
    async sendWebAppData(botId: number, data: string, buttonText: string): Promise<void> {
      await rest.post(`/bots/${botId}/webapp_data`, { data, button_text: buttonText })
    },
    // CloudStorage mini-app (ключ-значение на пару бот+пользователь).
    async cloudGet(botId: number, keys: string[]): Promise<Record<string, string>> {
      const r = await rest.post<{ values: Record<string, string> }>(`/bots/${botId}/cloud/get`, { keys })
      return r.values ?? {}
    },
    async cloudSet(botId: number, key: string, value: string): Promise<void> {
      await rest.post(`/bots/${botId}/cloud/set`, { key, value })
    },
    async cloudRemove(botId: number, keys: string[]): Promise<void> {
      await rest.post(`/bots/${botId}/cloud/remove`, { keys })
    },
    async cloudKeys(botId: number): Promise<string[]> {
      const r = await rest.get<{ keys: string[] }>(`/bots/${botId}/cloud/keys`)
      return r.keys ?? []
    },
  }
}
