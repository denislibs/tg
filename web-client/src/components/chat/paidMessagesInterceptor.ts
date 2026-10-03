// Порт tweb `src/components/chat/paidMessagesInterceptor.ts` (812502980, 235 строк) —
// перехват отправки в чат с платой за сообщение: хватает ли звёзд, подтверждение
// «Confirm Payment» с «Больше не спрашивать». Владелец инстанса — `ChatInput`
// (`paidMessageInterceptor`, врезка — Б-37); вне чата — статический
// `PaidMessagesInterceptor.prepareStarsForPayment({peerId, messageCount})`.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Отложенной оплаты с «Отменить» нет: у tweb подтверждённые без вопроса сообщения
//     (`UserConfirmationResult.Skipped`, от 100 звёзд или от 3 сообщений) копятся в
//     очереди `appMessagesManager` и уходят по таймеру `SEND_PAID_WITH_STARS_DELAY`
//     (`sendQueuedPaidMessages`/`cancelQueuedPaidMessages`), а тост
//     `showUndoablePaidTooltip` даёт их отменить; резерв звёзд — `setReservedStars`.
//     У нас бэкенд списывает плату сам в момент отправки
//     (`backend/internal/usecase/chat/stars.go::chargePaidMessage`, нехватка — NACK
//     `paid_required`), очереди нет — поэтому `canUndo` всегда `false`, и вместе с
//     предметом не перенесены `pendingUndoableMessage`, `MIN_UNDO_SENDING_PARAMS`,
//     `canUndoMessageSending`, `triggerUndoableMessages`, `dispose` и `managers`
//     конструктора (их читала только очередь).
//  2. Плата за сообщение — `getStarsAmount(peerId)` из зеркала пиров (`core/peerCache.ts`,
//     правило `appChatsManager.getStarsAmount`), а не поле `chat.starsAmount`: у нашего
//     `Chat` его нет (расхождение 2 шапки `chat/chat.ts`). Статический путь у tweb
//     спрашивает `appPeersManager.getStarsAmount` — то же правило.
//  3. Нехватка звёзд: попапа покупки (`showStarsPopup({spendPurposePeerId})`, tweb
//     `popups/stars.tsx`) у нас нет — есть только React-попап «Звёзды» настроек, звать
//     React-экран из класса нельзя (правило 2 плана волны 7). Вместо попапа — тост
//     `Stars.Subscription.MissingBalance`.
//  4. Баланс — ключ `starsBalance` состояния (`stores/starsStore.ts`), а не
//     `useStars()`; список «не спрашивать» читается из зеркала состояния на вкладке
//     (`useAppStateStore`), а не `appStateManager.getState()` воркера.
//  5. Имя пира в описании — узел `PeerTitle` (`chat/peerTitle.ts`) вместо
//     `wrapPeerTitle`; его middleware гасится, когда попап закрыт.
import { i18n } from '@lib/langPack'
import { getMiddleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import { startClient } from '@/client/bootstrap'
import { getStarsAmount } from '@core/peerCache'
import { setAppState, useAppStateStore } from '@stores/appState'
import { confirmationPopup } from '@components/popups/popupPeer'
import { toastNew } from '@components/toast'
import PeerTitle from '@components/chat/peerTitle'
import type Chat from '@components/chat/chat'

type PassedDownArgs = {
  peerId: PeerId
  messageCount: number
  starsAmount: number
}

enum UserConfirmationResult {
  /**
   * In case 'Don't show again' was checked previously
   */
  Skipped,

  Confirmed,
  Rejected,
}

export type ConfirmedPaymentResult = {
  starsAmount: number
  canUndo: boolean
}

export const PAYMENT_REJECTED = Symbol('Payment rejected')

/**
 * `undefined` if no stars are needed, or a PAYMENT_REJECTED symbol if the users cancels the payment / doesn't have enough balance
 */
export type PreparedPaymentResult = undefined | typeof PAYMENT_REJECTED | ConfirmedPaymentResult

export default class PaidMessagesInterceptor {
  public static PaymentRejectedSymbol: typeof PAYMENT_REJECTED = PAYMENT_REJECTED

  constructor(private chat: Pick<Chat, 'peerId'>) {}

  // расхождение 4 шапки
  private static get starsBalance() {
    return +(useAppStateStore.getState().starsBalance ?? 0)
  }

  /**
   * The starsAmount better be provided by this interceptor and then passed manually to the send method
   * to make sure we don't accidentally send stars in a case that might have not been handled
   */
  public async prepareStarsForPayment(messageCount: number): Promise<PreparedPaymentResult> {
    const { peerId } = this.chat
    const starsAmount = getStarsAmount(peerId) // расхождение 2 шапки

    if(!starsAmount) return

    const totalStarsAmount = messageCount * starsAmount

    if(PaidMessagesInterceptor.starsBalance < totalStarsAmount) {
      showStarsPopup()
      return PAYMENT_REJECTED
    }

    const userConfirmation = await PaidMessagesInterceptor.checkIfUserReallyWantsToPay({ peerId, messageCount, starsAmount, withDontShowAgain: true })
    if(userConfirmation === UserConfirmationResult.Rejected) return PAYMENT_REJECTED

    // расхождение 1 шапки
    return { starsAmount, canUndo: false }
  }

  /**
   * Static method - to be used outside a chat instance
   *
   * The starsAmount better be provided by this interceptor and then passed manually to the send method
   * to make sure we don't accidentally send stars in a case that might have not been handled
   */
  public static async prepareStarsForPayment(args: { messageCount: number, peerId: PeerId }): Promise<PreparedPaymentResult> {
    const { peerId, messageCount } = args

    const starsAmount = getStarsAmount(peerId)

    if(!starsAmount) return

    const totalStarsAmount = messageCount * starsAmount

    if(PaidMessagesInterceptor.starsBalance < totalStarsAmount) {
      showStarsPopup()
      return PAYMENT_REJECTED
    }

    const userConfirmation = await PaidMessagesInterceptor.checkIfUserReallyWantsToPay({ peerId, messageCount, starsAmount, withDontShowAgain: false })

    if(userConfirmation === UserConfirmationResult.Rejected) return PAYMENT_REJECTED

    return { starsAmount, canUndo: false }
  }

  private static async checkIfUserReallyWantsToPay({ peerId, messageCount, starsAmount, withDontShowAgain }: PassedDownArgs & { withDontShowAgain: boolean }) {
    const totalStarsAmount = starsAmount * messageCount

    let onNotShowAgain = noop

    if(withDontShowAgain) {
      const { dontShowPaidMessageWarningFor } = useAppStateStore.getState()
      const shouldShowWarning = !dontShowPaidMessageWarningFor.includes(peerId)

      if(!shouldShowWarning) return UserConfirmationResult.Skipped

      onNotShowAgain = () => {
        setAppState('dontShowPaidMessageWarningFor', [...dontShowPaidMessageWarningFor, peerId])
      }
    }

    // расхождение 5 шапки
    const middlewareHelper = getMiddleware()
    try {
      const dontShowAgain = await confirmationPopup({
        titleLangKey: 'ConfirmPayment',
        descriptionLangKey: messageCount > 1 ?
          'PaidMessages.UserChargesForMultipleMessageWarning' :
          'PaidMessages.UserChargesForOneMessageWarning',
        descriptionLangArgs: [
          new PeerTitle({ peerId, onlyFirstName: true, middleware: middlewareHelper.get(), managers: startClient().managers }).element,
          i18n('Stars', [starsAmount]),
          i18n('Stars', [totalStarsAmount]),
          ...(messageCount > 1 ? [messageCount] : []),
        ],
        checkbox: withDontShowAgain ? {
          text: 'DontAskAgain',
        } : undefined,
        button: {
          langKey: 'PaidMessages.PayForMessages',
          langArgs: [messageCount],
        },
      })

      if(withDontShowAgain && dontShowAgain) onNotShowAgain()
    } catch {
      return UserConfirmationResult.Rejected
    } finally {
      middlewareHelper.destroy()
    }

    return UserConfirmationResult.Confirmed
  }
}

/** Расхождение 3 шапки: на месте `showStarsPopup({spendPurposePeerId})` — тост. */
function showStarsPopup() {
  toastNew({ langPackKey: 'Stars.Subscription.MissingBalance' })
}
