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
  }
}
