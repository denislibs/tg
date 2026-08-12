// Порт tweb `helpers/dom/controlsHover.ts` 1:1 — база автоскрытия контролов
// плеера: класс `show-controls` на элементе, таймер скрытия 3000 мс, событие
// `toggleControls` наружу, `lockControls` (заперто-скрытые контролы + класс
// `disable-hover` на время зума/поворота вьювера). Десктоп — mousemove/enter/
// leave (уход курсора на плавающий хром из showOnLeaveToClassName панель не
// прячет), тач — тап мимо ignoreClickClassName переключает панель.
//
// Строгий tsconfig (в tweb `strict` выключен): поля, заполняемые `safeAssign`
// в setup, — опциональные/`!`; `lockControls(visible?)` — tweb зовёт его и с
// undefined (снятие лока).
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import EventListenerBase from '@helpers/eventListenerBase'
import type ListenerSetter from '@helpers/listenerSetter'
import safeAssign from '@helpers/object/safeAssign'
import findUpClassName from '@helpers/dom/findUpClassName'

export default class ControlsHover extends EventListenerBase<{
  toggleControls: (show: boolean) => void
}> {
  protected hideControlsTimeout: number
  protected controlsLocked?: boolean

  protected canHideControls?: () => boolean
  protected canShowControls?: () => boolean
  protected element!: HTMLElement
  protected listenerSetter!: ListenerSetter
  protected showOnLeaveToClassName?: string | string[]
  protected ignoreClickClassName?: string

  constructor() {
    super(false)
    this.hideControlsTimeout = 0
  }

  public setup(options: {
    element: HTMLElement,
    listenerSetter: ListenerSetter,
    canHideControls?: () => boolean,
    canShowControls?: () => boolean,
    showOnLeaveToClassName?: string | string[],
    ignoreClickClassName?: string
  }) {
    safeAssign(this, options)

    const { listenerSetter, element } = this

    if (IS_TOUCH_SUPPORTED) {
      listenerSetter.add(element)('click', (e: MouseEvent) => {
        if (this.ignoreClickClassName && findUpClassName(e.target as HTMLElement, this.ignoreClickClassName)) {
          return
        }

        this.toggleControls()
      })
    } else {
      listenerSetter.add(element)('mousemove', () => {
        this.showControls()
      })

      listenerSetter.add(element)('mouseenter', () => {
        this.showControls(false)
      })

      listenerSetter.add(element)('mouseleave', (e: MouseEvent) => {
        // Уход на плавающий хром (caption/топбар) не должен запускать скрытие —
        // эти элементы живут вне плеера, скрытие выдернуло бы их из-под курсора
        // и зациклило mouseenter↔mouseleave (комментарий tweb)
        const showOnLeaveClassNames = Array.isArray(this.showOnLeaveToClassName) ? this.showOnLeaveToClassName : [this.showOnLeaveToClassName]
        if (e.relatedTarget && showOnLeaveClassNames.some((className) => className && findUpClassName(e.relatedTarget as HTMLElement, className))) {
          this.showControls(false)
          return
        }

        this.hideControls()
      })
    }
  }

  public hideControls = (setHideTimeout = false) => {
    if (setHideTimeout) {
      if (!this.hideControlsTimeout) {
        this.hideControlsTimeout = window.setTimeout(this.hideControls, 3e3)
      }

      return
    }

    clearTimeout(this.hideControlsTimeout)
    this.hideControlsTimeout = 0

    const isShown = this.element.classList.contains('show-controls')
    if (this.controlsLocked !== false) {
      if ((this.canHideControls ? !this.canHideControls() : false) || !isShown || this.controlsLocked) {
        return
      }
    } else if (!isShown) {
      return
    }

    this.dispatchEvent('toggleControls', false)
    this.element.classList.remove('show-controls')
  }

  public showControls = (setHideTimeout = true) => {
    if (!(this.canShowControls?.() ?? true)) return

    if (this.hideControlsTimeout) {
      clearTimeout(this.hideControlsTimeout)
      this.hideControlsTimeout = 0
    } else if (!this.element.classList.contains('show-controls') && this.controlsLocked !== false) {
      this.dispatchEvent('toggleControls', true)
      this.element.classList.add('show-controls')
    }

    if (!setHideTimeout || this.controlsLocked) {
      return
    }

    this.hideControlsTimeout = window.setTimeout(this.hideControls, 3e3)
  }

  public toggleControls = (show?: boolean) => {
    const isShown = this.element.classList.contains('show-controls')

    if (show === undefined) {
      if (isShown) this.hideControls()
      else this.showControls()
    } else if (show === isShown) return
    else if (show === false) this.hideControls()
    else this.showControls()
  }

  public lockControls(visible?: boolean) {
    if (this.controlsLocked === visible) {
      return
    }

    this.controlsLocked = visible
    this.element.classList.toggle('disable-hover', visible === false)
    this.toggleControls(visible)
  }
}
