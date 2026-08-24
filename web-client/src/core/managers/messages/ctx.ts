// src/core/managers/messages/ctx.ts
//
// Общие внутренности messagesManager, которые под-модули (polls/translations/…)
// получают как ctx. Ядро истории/кэша (slices/msgsByChat/put/…) остаётся в
// messagesManager; наружу под-модулям нужны лишь rest, точечный патч SSOT и meId.
import type { RestClient } from '../../net/restClient'
import type { MyMessage } from '../../models'
import type { UserReal } from '../../peers/peer'

/** Точечно обновить одно сообщение чата в SSOT + персист (см. messagesManager.patchMsg). */
export type PatchMsg = (peerId: number, match: (m: MyMessage) => boolean, upd: (m: MyMessage) => MyMessage | null) => void

export interface MessagesCtx {
  rest: RestClient
  patchMsg: PatchMsg
  /** id текущего пользователя (для деривации `mine`) — лениво, геттер. */
  getMeId?: () => number | null
  /** Ключи ВСЕХ окон чата, где сообщение сейчас видно (см. messagesManager.opWindowsFor) —
   * нужно под-модулям, которые сами порождают операции patch/remove (Stage 1B.3, Task 4). */
  opWindowsFor: (peerId: number, msgId: number) => string[]
  /** Чтение одного сообщения из SSOT: для решений, зависящих от уже известного
   *  состояния (кадр реакций несёт абсолютный агрегат без «моего» и без
   *  счётчиков — сравнивать есть с чем только владельцу окна). */
  readMsg: (peerId: number, msgId: number) => MyMessage | undefined
  /** Владелец карточек пиров: витрина ⭐-реакции несёт ССЫЛКИ на отправителей,
   *  а карточки едут вектором `users` того же контейнера и обязаны попасть в
   *  зеркало — иначе доска рисует их фолбэком. Опционален по той же причине,
   *  что `getMeId`: часть тестов собирает под-модули одним `rest`. */
  peers?: { saveApiPeers(o: { users?: UserReal[] }): void }
}
