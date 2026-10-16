// src/core/managers/messages/ctx.ts
//
// Общие внутренности messagesManager, которые под-модули (polls/translations/…)
// получают как ctx. Ядро истории/кэша (slices/msgsByChat/put/…) остаётся в
// messagesManager; наружу под-модулям нужны лишь rest, точечный патч SSOT и meId.
import type { RestClient } from '../../net/restClient'
import type { MyMessage } from '../../models'
import type { MessageOp } from '../../realtime/messageOps'
import type { UserReal } from '../../peers/peer'
import type { MediaReadEvt } from '../../realtime/events'
import type { ScheduledUpdates } from '../messagesManager'
import type { RepayRequestHandler } from './repayRequestHandler'

/** Точечно обновить одно сообщение чата в SSOT + персист (см. messagesManager.patchMsg). */
export type PatchMsg = (peerId: number, match: (m: MyMessage) => boolean, upd: (m: MyMessage) => MyMessage | null) => void

export interface MessagesCtx {
  rest: RestClient
  patchMsg: PatchMsg
  /** id текущего пользователя (для деривации `mine`) — лениво, геттер. */
  getMeId?: () => number | null
  /** Лимит «сколько реакций ставит один пользователь на сообщении» — ключ
   *  `reactions_user_max_default`/`_premium` конфига приложения, ветка по подписке
   *  внутри (порт `getLimit('reactions')`, tweb appReactionsManager.ts:694).
   *  Опционален: юнит-тесты кэш-методов собирают под-модули одним `rest`. Не
   *  вернул число (конфига нет) — локального вытеснения нет, сервер вытеснит сам. */
  getReactionsLimit?: () => Promise<number | undefined>
  /** Ключи ВСЕХ окон чата, где сообщение сейчас видно (см. messagesManager.opWindowsFor) —
   * нужно под-модулям, которые сами порождают операции patch/remove (Stage 1B.3, Task 4). */
  opWindowsFor: (peerId: number, msgId: number) => string[]
  /** Объявить операции окна ВСЕМ вкладкам (`rt:message_op`).
   *
   * Нужен под-модулям, чьё изменение окна приходит НЕ кадром воронки, а ответом
   * ручки (свой клик по реакции, свой голос в опросе, своя отметка в чек-листе,
   * ⭐-реакция): у кадра ops возвращаются наружу и их рассылает `dispatch`
   * (workerCore), а у RPC-пути возвращать некому — владелец обязан объявить сам.
   * Пустой список не объявляем: «ничего не изменилось» это не событие. */
  emitOps: (ops: MessageOp[]) => void
  /** Чтение одного сообщения из SSOT: для решений, зависящих от уже известного
   *  состояния (кадр реакций несёт абсолютный агрегат без «моего» и без
   *  счётчиков — сравнивать есть с чем только владельцу окна). */
  readMsg: (peerId: number, msgId: number) => MyMessage | undefined
  /** Владелец карточек пиров: витрина ⭐-реакции несёт ССЫЛКИ на отправителей,
   *  а карточки едут вектором `users` того же контейнера и обязаны попасть в
   *  зеркало — иначе доска рисует их фолбэком. Опционален по той же причине,
   *  что `getMeId`: часть тестов собирает под-модули одним `rest`. */
  peers?: { saveApiPeers(o: { users?: UserReal[] }): void }
  /** Счётчики «@» и ❤ того, что tweb называет `getAnyDialog(peerId, threadId)`:
   *  темы форума (`threadId`) или диалога — их владельцы `forumTopicsStorage` и
   *  `dialogsManager`. Нужны `readMessages` гейтами `hadUnreadMentions`/
   *  `hadUnreadReactions` (tweb appMessagesManager.ts:9564-9566): сбрасывать на
   *  сервере нечего, если бейджа нет. Опционален по той же причине, что
   *  `getMeId`: без него сброс не уходит никогда. */
  getUnreadBadge?: (peerId: number, threadId?: number) => { mentions: number; reactions: number } | undefined
  /** Обнулить счётчик «@» (`isReaction = false`) или ❤ у `getAnyDialog(peerId,
   *  threadId)` — ответ `readMentions` (tweb :9636-9644). Родителя темы не трогает. */
  clearUnreadBadge?: (peerId: number, threadId: number | undefined, isReaction: boolean) => void
  /** Ответ `affectedHistory` двигает курсор журнала как местный `updatePts`
   *  (tweb :9626-9630) — владелец воронка (`GlobalFunnel.applyLocalPts`). */
  applyLocalPts?: (pts: number, ptsCount: number) => void
  /** `messages.readMessageContents` — WS `read_media` с СЕРВЕРНЫМИ номерами
   *  (владелец транспорта — connectionManager). */
  markMediaRead?: (peerId: number, serverIds: number[]) => void
  /** Местный `updateReadMessagesContents` (tweb `processLocalUpdate`, :9593):
   *  прочитанные упоминания гасят точку и бейдж сразу, не дожидаясь кадра
   *  сервера. Применяет воркер тем же путём, что и серверный кадр. */
  applyLocalMediaRead?: (frame: MediaReadEvt) => void
  /** Тема форума, в которой лежит сообщение (`getMessageThreadId` с видом чата
   *  форума), либо `undefined` вне форума — tweb `readMessages` берёт её из
   *  увиденного сообщения (appMessagesManager.ts:9549-9555). */
  forumThreadIdOf?: (m: MyMessage) => number | undefined
  /** Ответ отложенной отправки — `Updates` (tweb `processUpdateMessage`): кадры
   *  ленты отложенных применяет её владелец (messagesManager). Опционален по
   *  той же причине, что `getMeId`. */
  applyScheduledUpdates?: (r: ScheduledUpdates | undefined) => void
  /** Запросы на повторную оплату (tweb `RepayRequestHandler`): отказ
   *  `ALLOW_PAYMENT_REQUIRED_<N>` у опроса/чек-листа/пересылки заводит запрос,
   *  а не бросается. Опционален — без него отказ бросается как раньше. */
  repay?: RepayRequestHandler
  /** Отказ HTTP-пути отправки (пересылка, опрос, чек-лист) → событие
   *  `rt:message_send_error` (tweb `onMessagesSendError`, :5822). Опционален. */
  reportSendError?: (peerId: number, err: unknown) => void
}
