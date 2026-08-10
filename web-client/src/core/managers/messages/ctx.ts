// src/core/managers/messages/ctx.ts
//
// Общие внутренности messagesManager, которые под-модули (polls/translations/…)
// получают как ctx. Ядро истории/кэша (slices/msgsByChat/put/…) остаётся в
// messagesManager; наружу под-модулям нужны лишь rest, точечный патч SSOT и meId.
import type { RestClient } from '../../net/restClient'
import type { Message } from '../../models'

/** Точечно обновить одно сообщение чата в SSOT + персист (см. messagesManager.patchMsg). */
export type PatchMsg = (chatId: number, match: (m: Message) => boolean, upd: (m: Message) => Message | null) => void

export interface MessagesCtx {
  rest: RestClient
  patchMsg: PatchMsg
  /** id текущего пользователя (для деривации `mine`) — лениво, геттер. */
  getMeId?: () => number | null
  /** Ключи ВСЕХ окон чата, где сообщение сейчас видно (см. messagesManager.opWindowsFor) —
   * нужно под-модулям, которые сами порождают операции patch/remove (Stage 1B.3, Task 4). */
  opWindowsFor: (chatId: number, msgId: number) => string[]
}
