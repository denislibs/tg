// Порт tweb `helpers/contextMenuController.ts` — 1:1.
//
// Синглтон-владелец ОДНОГО открытого корневого меню (`div.btn-menu`) плюс стека
// подменю. Кто его зовёт:
//   • открытие — `openBtnMenu(element, onClose?, triggerElement?)`: вешает
//     `active`/`was-open` на меню и `menu-open` на триггер, поднимает оверлей
//     базы (`OverlayClickHandler`), на десктопе включает слежку за мышью;
//   • закрытие — `close()`: сам оверлей по клику мимо, `mediaSizes 'resize'`,
//     уход курсора дальше 100 px (40 px для подменю) и каждый пункт меню
//     (`components/buttonMenu.ts`).
//
// Отступлений от tweb в самом файле нет; всё, что адаптировано, лежит в базе —
// см. шапку `helpers/overlayClickHandler.ts`. Закомментированный черновик из
// конструктора tweb (:22-28, лог позиции меню на ресайзе) не перенесён.
//
// Правки под строгий tsconfig (в tweb `strict` выключен):
//   • `menuOpenTarget` честно `| undefined` (tweb пишет туда `undefined`),
//     `this.element.parentElement` (`| null`) приводится к `undefined`;
//   • в `addAdditionalMenu` закрытие зовёт `onClose?.()` — в tweb там голый
//     `onClose()` при опциональном параметре.
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import findUpClassName from '@helpers/dom/findUpClassName'
import mediaSizes from '@helpers/mediaSizes'
import OverlayClickHandler from '@helpers/overlayClickHandler'
import overlayCounter from '@helpers/overlayCounter'
import pause from '@helpers/schedulers/pause'

type AdditionalMenuItem = {
  level: number,
  element: HTMLElement,
  triggerElement: HTMLElement | undefined,
  close: () => void,
}

class ContextMenuController extends OverlayClickHandler {
  protected additionalMenus: AdditionalMenuItem[] = []
  protected menuOpenTarget?: HTMLElement

  constructor() {
    super('menu', true)

    mediaSizes.addEventListener('resize', () => {
      if(this.element) {
        this.close()
      }
    })
  }

  public isOpened() {
    return !!this.element
  }

  private onMouseMove = (e: MouseEvent) => {
    const allMenus: AdditionalMenuItem[] = [
      ...[...this.additionalMenus].reverse(),
      {
        triggerElement: undefined,
        level: 0,
        element: this.element!,
        close: () => this.close(),
      },
    ]

    function isFartherThan(element: HTMLElement, distance: number) {
      const { clientX, clientY } = e

      const rect = element.getBoundingClientRect()

      const diffX = clientX >= rect.right ? clientX - rect.right : rect.left - clientX
      const diffY = clientY >= rect.bottom ? clientY - rect.bottom : rect.top - clientY

      return diffX >= distance || diffY >= distance
    }

    for(const item of allMenus) {
      if(item.triggerElement && !isFartherThan(item.triggerElement, 40)) break

      if(isFartherThan(item.element, item.level === 0 ? 100 : 40)) {
        this.closeAndRemoveMenu(item)
      } else {
        break
      }
    }
  }

  protected closeAndRemoveMenu(item: AdditionalMenuItem) {
    item.close()
    const idx = this.additionalMenus.indexOf(item)
    if(idx > -1) {
      for(let i = idx + 1; i < this.additionalMenus.length; i++) {
        this.additionalMenus[i].close()
      }
      this.additionalMenus.splice(idx)
    }
  }

  public closeMenusByLevel(level: number) {
    this.additionalMenus.filter((menu) => menu.level >= level).forEach((item) => {
      item.close()
    })

    this.additionalMenus = this.additionalMenus.filter((menu) => menu.level < level)
  }

  public close(e?: MouseEvent | TouchEvent) {
    if(e && (e.target as HTMLElement).classList.contains('btn-menu')) {
      return
    }

    if(this.element) {
      this.element.classList.remove('active')
      this.menuOpenTarget?.classList.remove('menu-open')
      this.menuOpenTarget = undefined

      if(this.element.classList.contains('night')) {
        const element = this.element
        setTimeout(() => {
          if(element.classList.contains('active')) {
            return
          }

          element.classList.remove('night')
        }, 400)
      }
    }

    this.additionalMenus.forEach((menu) => {
      menu.close()
    })

    this.additionalMenus = []

    super.close()

    if(!IS_TOUCH_SUPPORTED) {
      this.realmWindow.removeEventListener('mousemove', this.onMouseMove)
    }
  }

  protected shouldApplyNight(triggerElement?: HTMLElement) {
    if(overlayCounter.isDarkOverlayActive) return true
    const nightAncestor = triggerElement && findUpClassName(triggerElement, 'night')
    return !!nightAncestor && nightAncestor !== document.documentElement
  }

  public openBtnMenu(element: HTMLElement, onClose?: () => void, triggerElement?: HTMLElement) {
    if(this.shouldApplyNight(triggerElement)) {
      element.classList.add('night')
    }

    super.open(element)

    this.element!.classList.add('active', 'was-open')
    this.menuOpenTarget = triggerElement ?? this.element!.parentElement ?? undefined
    this.menuOpenTarget?.classList.add('menu-open')

    if(onClose) {
      this.addEventListener('toggle', onClose, { once: true })
    }

    if(!IS_TOUCH_SUPPORTED) {
      this.realmWindow.addEventListener('mousemove', this.onMouseMove)
    }
  }

  public addAdditionalMenu(element: HTMLElement, triggerElement: HTMLElement, level: number, onClose?: () => void) {
    if(!this.element) return

    this.closeMenusByLevel(level)

    this.additionalMenus.push({
      element,
      triggerElement,
      level,
      close: () => {
        element.classList.remove('active')
        void pause(400).then(() => element.remove())
        onClose?.()
      },
    })
    if(this.shouldApplyNight(triggerElement)) {
      element.classList.add('night')
    }
    element.classList.add('active', 'was-open')

    if(onClose) {
      this.addEventListener('toggle', onClose, { once: true })
    }
  }
}

const contextMenuController = new ContextMenuController()
export default contextMenuController
