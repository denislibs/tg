import type { RestClient } from '../net/restClient'
import type { UserReal } from '../peers/peer'
import { getPeerId, type Peer } from '../peers/peerId'

// Боты (демо-бот @demobot). Реальных ботов нет — есть один демо-бот, который
// авто-отвечает на сервере; клиент рендерит его клавиатуры и шлёт callback.

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
/** `botInlineResult` — строка выдачи на проводе. `emoji` — наш параметр
 *  (у схемы иконку даёт `thumb:WebDocument`, то есть настоящий файл). */
interface BotInlineResultWire {
  _: 'botInlineResult'
  id: string
  type: string
  title?: string
  description?: string
  emoji?: string
  send_message: { _: 'botInlineMessageText'; message: string }
}

/** `messages.botResults` — контейнер выдачи. Подсказка поля ввода рядом НЕ
 *  едет: у оригинала это параметр самого бота
 *  (`user.bot_inline_placeholder`), и карточка бота приезжает здесь же. */
interface MessagesBotResults {
  _: 'messages.botResults'
  query_id: number
  results: BotInlineResultWire[]
  cache_time: number
  users: UserReal[]
}

export function newBotsManager({ rest }: { rest: Pick<RestClient, 'get' | 'post'> }) {
  return {
    async commands(botId: number): Promise<BotCommand[]> {
      // Ответ — сам ВЕКТОР строк `botCommand`, а не список под именем поля.
      const r = await rest.get<(BotCommand & { _: 'botCommand' })[]>(`/bots/${botId}/commands`)
      return r ?? []
    },
    // Нажатие callback-кнопки: возвращает всплывающий ответ (toast/alert).
    //
    // `data` — поле `keyboardButtonCallback.data` кнопки БЕЗ преобразований, как
    // в оригинале (`callbackButtonClick` кладёт `button.data` прямо в запрос,
    // tweb `appInlineBotsManager.ts:225-232`). В схеме этот параметр — `bytes`,
    // на JSON-проводе фазы 0 байты едут base64-строкой, и ручка принимает ровно
    // ту же `bytes` (`bot_handler.go::BotCallback`): одна форма байтов на всём
    // пути, разворачивает их сервер. Развернуть здесь значило бы завести на
    // витрине вторую форму того же значения и переделывать это место на фазе 2.
    async callback(botId: number, peerId: number, data: string, messageId?: number): Promise<CallbackAnswer> {
      // Ответ — конструктор `messages.botCallbackAnswer`. «Показать плашкой»
      // это ФЛАГ: его ОТСУТСТВИЕ и есть «тостом».
      const r = await rest.post<{ _: 'messages.botCallbackAnswer'; pFlags?: { alert?: true }; message?: string }>(
        `/bots/${botId}/callback`, { peer_id: peerId, message_id: messageId ?? 0, data })
      return { text: r.message ?? '', alert: !!r.pFlags?.alert }
    },
    // Кнопка-меню mini-app бота (пусто — не задана).
    async menuButton(botId: number): Promise<{ text: string; url: string }> {
      const r = await rest.get<{ _: 'botMenuButton'; text: string; url: string }>(`/bots/${botId}/menu_button`)
      return { text: r.text, url: r.url }
    },
    // Inline-режим: результаты + плейсхолдер поля ввода.
    async inline(botId: number, query: string): Promise<{ results: InlineResult[]; placeholder: string }> {
      const r = await rest.get<MessagesBotResults>(`/bots/${botId}/inline?q=${encodeURIComponent(query)}`)
      // Подсказка поля ввода — параметр САМОГО бота: карточка приехала
      // вектором `users` того же контейнера. Прежде она ехала вторым ключом
      // рядом с результатами, то есть жила в двух местах сразу.
      return {
        results: (r.results ?? []).map((x) => ({
          id: x.id,
          title: x.title ?? '',
          description: x.description,
          emoji: x.emoji,
          messageText: x.send_message?.message ?? '',
        })),
        placeholder: r.users?.find((u) => u.id === botId)?.bot_inline_placeholder ?? '',
      }
    },
    // Deep link t.me/<bot>?start=<payload>: открыть чат и послать /start.
    // Ответ — КОНСТРУКТОР ключа, как у создания приватного чата.
    async start(botId: number, payload: string): Promise<number> {
      return getPeerId(await rest.post<Peer>(`/bots/${botId}/start`, { payload }))
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
