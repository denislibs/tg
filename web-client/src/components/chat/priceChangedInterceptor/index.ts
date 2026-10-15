// Порт tweb `src/components/chat/priceChangedInterceptor/index.ts` (812502980,
// 156 строк) — перехватчик «цена за сообщение изменилась». Отправка в платный чат
// без достаточного согласия отвергается `ALLOW_PAYMENT_REQUIRED_<N>`; воркер заводит
// запрос на повторную оплату (`messages/repayRequestHandler.ts`) и объявляет
// `insufficent_stars_for_message`. Перехватчик чата показывает плашку «Цена
// изменилась» с «Отправить снова»; по согласию (`prepareStarsForPayment` на сумму
// всех запросов) повторяет каждый запрос через `confirmRepayRequest`.
//
// ОТЛИЧИЯ ОТ ОРИГИНАЛА
//  1. Чат запроса — `peerId` события: воркер знает пир отправки, а `invokeApiArgs`
//     (из которого оригинал достаёт `peer`/`to_peer`) у нас нет.
//  2. Цена — из самого отказа (`starsAmount` события = N / число сообщений), запасной путь —
//     `getStarsAmount(peerId)` из зеркала пиров (`core/peerCache.ts`): у
//     личек стоимости нет (бэкенд её не производит), для групп карточка свежая —
//     смену платы сервер объявляет кадром чата. `getStarsAmountForUser`/
//     `updateCachedUserFullStarsAmount`/`chat.updateStarsAmount` не нужны: поля
//     `Chat.starsAmount` у нас нет (расхождение 2 шапки `chat/paidMessagesInterceptor.ts`).
//  3. Резерва звёзд (`setReservedStars`, `reservedStars`) нет — отложенной оплаты нет
//     (расхождение 1 той же шапки).
import accumulate from '@helpers/array/accumulate'
import type ListenerSetter from '@helpers/listenerSetter'
import rootScope from '@lib/rootScope'
import { getStarsAmount } from '@core/peerCache'
import type { Managers } from '@/client/bootstrap'
import type Chat from '@components/chat/chat'
import { PAYMENT_REJECTED } from '@components/chat/paidMessagesInterceptor'
import showPriceChangedTooltip from './priceChangedTooltip.solid'

type PendingRequest = {
  id: number
  messageCount: number
}

type ConstructorArgs = {
  managers: { messages: Pick<Managers['messages'], 'confirmRepayRequest'> }
  chat: Pick<Chat, 'peerId' | 'input'>
  listenerSetter: ListenerSetter
}

type OpenedTooltip = {
  close: (() => void) | undefined // * assigned right after showPriceChangedTooltip returns
  withStarsAmount: number
}

type OpenTooltipArgs = {
  starsAmount: number
  messageCount: number
  requestId: number
}

class PriceChangedInterceptor {
  private chat: ConstructorArgs['chat']
  private listenerSetter: ListenerSetter
  private managers: ConstructorArgs['managers']

  private pendingRequests: PendingRequest[] = []

  private openedTooltip?: OpenedTooltip

  constructor(args: ConstructorArgs) {
    this.chat = args.chat
    this.listenerSetter = args.listenerSetter
    this.managers = args.managers
  }

  init() {
    this.listenerSetter.add(rootScope)('insufficent_stars_for_message', ({ requestId, messageCount, peerId, starsAmount }) => {
      if(peerId !== this.chat.peerId) return

      this.handleNewRepayRequest({
        // цена — из самого отказа сервера; зеркало пиров может отстать от него
        starsAmount: starsAmount || getStarsAmount(peerId) || 0,
        requestId,
        messageCount,
      })
    })

    this.listenerSetter.add(rootScope)('fulfill_repaid_message', ({ requestId }) => {
      this.pendingRequests = this.pendingRequests.filter(r => r.id !== requestId)
      if(!this.pendingRequests.length) this.closeTooltip()
    })
  }

  private handleNewRepayRequest({ starsAmount, messageCount, requestId }: OpenTooltipArgs) {
    if(this.openedTooltip && this.openedTooltip.withStarsAmount !== starsAmount) {
      this.closeTooltip()
    }

    if(!this.openedTooltip) this.openTooltip(starsAmount)

    this.pendingRequests.push({
      id: requestId,
      messageCount,
    })
  }

  private openTooltip(starsAmount: number) {
    const onResend = () => {
      void this.confirmResend([...this.pendingRequests], starsAmount)
    }

    const entry: OpenedTooltip = this.openedTooltip = {
      close: undefined,
      withStarsAmount: starsAmount,
    }

    const { hide } = showPriceChangedTooltip({
      starsAmount,
      onResend,
      // the docked toast can go away on its own (peer change, or a newer toast taking
      // the dock) - drop our reference so the next repay request opens a fresh one
      onHide: () => {
        if(this.openedTooltip === entry) this.openedTooltip = undefined
      },
    })

    entry.close = hide
  }

  private closeTooltip() {
    this.openedTooltip?.close?.()
    this.openedTooltip = undefined
  }

  private async confirmResend(pendingRequests: PendingRequest[], starsAmount: number) {
    const messageCount = accumulate(pendingRequests.map(r => r.messageCount), 0)

    const preparedPaymentResult = await this.chat.input.paidMessageInterceptor.prepareStarsForPayment(messageCount, starsAmount || undefined)

    if(preparedPaymentResult === PAYMENT_REJECTED) return

    await Promise.all(pendingRequests.map(({ id }) => this.managers.messages.confirmRepayRequest(id, preparedPaymentResult)))
  }

  cleanup() {
    this.pendingRequests = []
    this.closeTooltip()
  }
}

export default PriceChangedInterceptor
