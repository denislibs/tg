// Порт tweb `components/chat/sendContextMenu.ts` (812502980, 154 строки) — меню кнопки
// отправки: «Без звука», «Запланировать»/«Напомнить», «Отправить, когда будет в сети»,
// «Убрать эффект». Пачка П-6, Б-32.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Ряда эффектов (`ChatReactionsMenu({isEffects: true})`, `appendReactionsMenu`,
//     `getAvailableEffects`) нет: эффекты у бэкенда — строки из белого списка
//     (`usecase/chat/sanitize.go::messageEffects`), а не стикеры `availableEffect`, и
//     ручки `messages.getAvailableEffects` нет. Опции `withEffects`/`effect`/`onEffect`
//     приняты: пункт «Убрать эффект» живёт по `effect()`, но выбрать эффект нечем —
//     бэклог Б-125.
import contextMenuController from '@helpers/contextMenuController'
import { attachContextMenuListener } from '@helpers/dom/attachContextMenuListener'
import cancelEvent from '@helpers/dom/cancelEvent'
import ListenerSetter from '@helpers/listenerSetter'
import type { Middleware, MiddlewareHelper } from '@helpers/middleware'
import rootScope from '@lib/rootScope'
import { type ButtonMenuItemOptionsVerifiable, ButtonMenuSync } from '@components/buttonMenu'

export default class SendMenu {
  private type: 'schedule' | 'reminder' = 'schedule'
  private isPaid = false
  private middlewareHelper: MiddlewareHelper

  constructor(private options: {
    onSilentClick: () => void,
    onScheduleClick: () => void,
    onSendWhenOnlineClick?: () => void,
    onRef: (element: HTMLElement) => void,
    middleware: Middleware,
    openSide: string,
    onContextElement: HTMLElement,
    onOpen?: () => boolean,
    onToggle?: (open: boolean) => void,
    canSendWhenOnline?: () => boolean | Promise<boolean>,
    withEffects?: () => boolean,
    effect?: () => string | undefined,
    onEffect?: (effect: string | undefined) => void
  }) {
    this.middlewareHelper = options.middleware.create()
    this.createMenu()
  }

  public setPeerParams(params: { peerId: PeerId, isPaid: boolean }) {
    this.type = params.peerId === rootScope.myId ? 'reminder' : 'schedule'
    this.isPaid = params.isPaid
  }

  private createButtons(): ButtonMenuItemOptionsVerifiable[] {
    return [{
      icon: 'mute',
      text: 'Chat.Send.WithoutSound',
      onClick: this.options.onSilentClick,
      verify: () => this.type === 'schedule',
    }, {
      icon: 'schedule',
      text: 'Chat.Send.ScheduledMessage',
      onClick: this.options.onScheduleClick,
      verify: () => this.type === 'schedule' && !this.isPaid,
    }, {
      icon: 'schedule',
      text: 'Chat.Send.SetReminder',
      onClick: this.options.onScheduleClick,
      verify: () => this.type === 'reminder',
    }, {
      icon: 'online',
      text: 'Schedule.SendWhenOnline',
      onClick: () => this.options.onSendWhenOnlineClick?.(),
      verify: async() => this.type === 'schedule' && !!(await this.options.canSendWhenOnline?.()) && !this.isPaid,
    }, {
      icon: 'crossround',
      text: 'Effect.Remove',
      danger: true,
      onClick: () => this.options.onEffect?.(undefined),
      verify: () => !!this.options.effect?.(),
    }]
  }

  private createMenu() {
    this.middlewareHelper.clean()
    const middleware = this.middlewareHelper.get()

    const listenerSetter = new ListenerSetter()
    middleware.onClean(() => {
      listenerSetter.removeAll()
    })

    const buttons = this.createButtons()
    const element = ButtonMenuSync({ buttons, listenerSetter })
    element.classList.add('menu-send', this.options.openSide)
    this.options.onRef(element)

    attachContextMenuListener({
      element: this.options.onContextElement,
      callback: async(e) => {
        if(this.options.onOpen && !this.options.onOpen()) {
          return
        }

        cancelEvent(e)
        await Promise.all(buttons.map(async(button) => {
          const result = await button.verify!()
          button.element!.classList.toggle('hide', !result)
        }))

        // расхождение 1: ряда эффектов нет (`withEffects`)

        this.options.onToggle?.(true)
        contextMenuController.openBtnMenu(element, () => {
          this.options.onToggle?.(false)
          this.createMenu()
          setTimeout(() => {
            element.remove()
          }, 400)
        })
      },
      listenerSetter,
    })
  }
}
