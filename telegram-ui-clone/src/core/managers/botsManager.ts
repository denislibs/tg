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
    async callback(botId: number, chatId: number, data: string): Promise<CallbackAnswer> {
      return rest.post<CallbackAnswer>(`/bots/${botId}/callback`, { chat_id: chatId, data })
    },
    // Inline-режим: результаты по запросу «@bot query».
    async inline(botId: number, query: string): Promise<InlineResult[]> {
      const r = await rest.get<{ results: RawInlineResult[] }>(`/bots/${botId}/inline?q=${encodeURIComponent(query)}`)
      return (r.results ?? []).map((x) => ({
        id: x.id, title: x.title, description: x.description, emoji: x.emoji, messageText: x.message_text,
      }))
    },
  }
}
