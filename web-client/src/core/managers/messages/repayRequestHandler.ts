// src/core/managers/messages/repayRequestHandler.ts
//
// Порт tweb `lib/appManagers/utils/repayRequestHandler.ts` (812502980): запрос
// на ПОВТОРНУЮ оплату отправки. Сервер отвечает 403/NACK `ALLOW_PAYMENT_REQUIRED_<N>`,
// когда подтверждённая сумма (`allow_paid_stars`) меньше цены запроса — например,
// админ поднял плату, пока пользователь собирался отправить. Обработчик держит
// замыкание повтора, объявляет вкладкам `insufficent_stars_for_message`
// (имя tweb, с опечаткой) и по `confirmRepayRequest(id, результат)` повторяет
// отправку с новой суммой.
//
// ОТЛИЧИЯ ОТ ОРИГИНАЛА
//  1. Ошибка приходит строкой причины (`reason`) — NACK WS даёт её без объекта
//     `ApiError`, а HTTP-путь берёт `HttpError.type`. tweb сверяет `error.code === 403`
//     и префикс `error.type`; у нас префикс уникален и код сверять негде.
//  2. `invokeApiArgs` в событии нет — замыкание повтора держит вызывающий (запись
//     pending или метод менеджера), а подсказка узнаёт чат по `peerId` события.
//  3. `reservedStars` нет: отложенной оплаты (`canUndo`) у нас нет — расхождение 1
//     шапки `components/chat/paidMessagesInterceptor.ts`.
import { HttpError } from '../../net/restClient'
import type { MessageSendingParams } from './sendingParams'

const INSUFFICIENT_STARS_FOR_MESSAGE_PREFIX = 'ALLOW_PAYMENT_REQUIRED_'

/** Результат подтверждения оплаты — `starsAmount` это цена ОДНОГО сообщения. */
export type ConfirmedPaymentResult = NonNullable<MessageSendingParams['confirmedPaymentResult']>

/** tweb `RepayRequest` — то, что остаётся на неудавшемся сообщении окна. */
export type RepayRequest = { id: number; messageCount: number }

/** `undefined` — платить больше не нужно (цена стала нулевой): tweb `prepareStarsForPayment`
 *  тогда отвечает `undefined`, и повтор уходит без суммы. */
type RepayCallback = (confirmedPaymentResult: ConfirmedPaymentResult | undefined) => void

export type RepayDispatch = (event: 'insufficent_stars_for_message' | 'fulfill_repaid_message', payload: unknown) => void

/** tweb `canHandleError`: отказ из-за недостаточного согласия на плату. */
export function canHandleRepayReason(reason: string | undefined | null): boolean {
  return !!reason && reason.startsWith(INSUFFICIENT_STARS_FOR_MESSAGE_PREFIX) &&
    !Number.isNaN(requiredStarsOf(reason)) && reason.length > INSUFFICIENT_STARS_FOR_MESSAGE_PREFIX.length
}

function requiredStarsOf(reason: string): number {
  return +reason.slice(INSUFFICIENT_STARS_FOR_MESSAGE_PREFIX.length)
}

export type TryRegisterArgs = {
  reason: string | undefined | null
  /** чат, где отправка не удалась — подсказка показывается только в нём */
  peerId: number
  messageCount: number
  repay: RepayCallback
}

export function newRepayRequestHandler({ dispatch }: { dispatch: RepayDispatch }) {
  let seed = 0
  const requests = new Map<number, RepayCallback>()

  const remove = (id: number) => {
    if (requests.delete(id)) dispatch('fulfill_repaid_message', { requestId: id })
  }

  return {
    /** tweb `tryRegisterRequest` (:57-83); `undefined` — отказ не про оплату. */
    tryRegisterRequest({ reason, peerId, messageCount, repay }: TryRegisterArgs): RepayRequest | undefined {
      if (!canHandleRepayReason(reason)) return undefined
      const id = ++seed
      requests.set(id, repay)
      dispatch('insufficent_stars_for_message', { requestId: id, messageCount, peerId })
      return { id, messageCount }
    },

    /** tweb `confirmRepayRequest` (:98-104). */
    confirmRepayRequest(id: number, confirmedPaymentResult: ConfirmedPaymentResult | undefined): void {
      const repay = requests.get(id)
      remove(id)
      repay?.(confirmedPaymentResult)
    },

    /** tweb `cancelRepayRequest` (:106-108). */
    cancelRepayRequest(id: number): void {
      remove(id)
    },
  }
}

export type RepayRequestHandler = ReturnType<typeof newRepayRequestHandler>

/**
 * Путь по REST (пересылка, опрос, чек-лист): отказ приходит `HttpError` 403 с
 * типом `ALLOW_PAYMENT_REQUIRED_<N>` (tweb: `error.code === 403 && error.type`).
 * `true` — запрос на повторную оплату заведён, вызывающий ошибки не бросает
 * (подсказка о смене цены и «Resend» — по событию); `false` — отказ не про оплату.
 */
export function registerHttpRepay(repay: RepayRequestHandler | undefined, err: unknown, a: Omit<TryRegisterArgs, 'reason'>): boolean {
  if (!repay || !(err instanceof HttpError) || err.status !== 403) return false
  return !!repay.tryRegisterRequest({ ...a, reason: err.type })
}

