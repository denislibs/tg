// Порт tweb `src/components/rangeSelector.ts` — базовый класс 1:1 (слайдер на
// `input[type=range]` + собственный grab-трекинг): разметка
// `div.progress-line > div.progress-line__filled + input.progress-line__seek`,
// `setListeners`/`removeListeners`, `scrub` (клик/драг по треку →
// value + onScrub), `setProgress`/`addProgress`/`setFilled`. Первый
// потребитель — зум-слайдер медиавьювера (Task 12); `MediaProgressLine`/
// `VolumeSelector` плеера (наследники) приедут в Task 15 — поэтому портирован
// именно весь базовый класс, включая их опции (`useTransform`/`useProperty`/
// `vertical`/`offsetAxisValue`) и `snapValue`-параметр `scrub`.
//
// Адаптации (поведение не менялось):
//   • RTL-отражение оси (`I18n.getIsRTL()` в getValueByEvent) не портировано —
//     RTL-локалей у нас нет (как и `icon-reflect` в mediaViewer/base.ts)
//   • строгий tsconfig (в tweb `strict` выключен): поля, заполняемые
//     `safeAssign`, — с инициализаторами или `!`; `rect` — `!` (задан в
//     onMouseDown до первого чтения в scrub); `_removeListeners` — `| null`
import attachGrabListeners, { type GrabEvent } from '@helpers/dom/attachGrabListeners'
import clamp from '@helpers/number/clamp'
import safeAssign from '@helpers/object/safeAssign'

export default class RangeSelector {
  public container: HTMLDivElement
  protected filled: HTMLDivElement
  protected seek: HTMLInputElement

  public mousedown = false
  protected rect!: DOMRect
  protected _removeListeners: (() => void) | null = null

  private events: Partial<{
    onMouseDown: RangeSelector['onMouseDown'],
    onMouseUp: RangeSelector['onMouseUp'],
    onScrub: (value: number) => void
  }> = {}

  protected decimals: number

  protected step!: number
  protected min!: number
  protected max!: number
  protected withTransition = false
  protected useTransform = false
  protected useProperty = false
  protected vertical = false
  protected offsetAxisValue = 0

  constructor(
    options: {
      step: RangeSelector['step'],
      min?: RangeSelector['min'],
      max?: RangeSelector['max'],
      withTransition?: RangeSelector['withTransition'],
      useTransform?: RangeSelector['useTransform'],
      vertical?: RangeSelector['vertical'],
      useProperty?: RangeSelector['useProperty'],
      offsetAxisValue?: RangeSelector['offsetAxisValue']
    },
    value = 0,
  ) {
    safeAssign(this, options)

    this.container = document.createElement('div')
    this.container.classList.add('progress-line')

    // transition вместе с transform смысла не имеет — тот обновляется каждый кадр
    if (this.useTransform) {
      this.container.classList.add('use-transform')
    } else if (this.withTransition) {
      this.container.classList.add('with-transition')
    }

    this.filled = document.createElement('div')
    this.filled.classList.add('progress-line__filled')

    const seek = this.seek = document.createElement('input')
    seek.classList.add('progress-line__seek')
    seek.type = 'range'
    seek.step = '' + this.step
    this.setMinMax(this.min, this.max)
    seek.value = '' + value

    if (value) {
      this.setProgress(value)
    }

    const stepStr = '' + this.step
    const index = stepStr.indexOf('.')
    this.decimals = index === -1 ? 0 : stepStr.length - index - 1

    this.container.append(this.filled, seek)
  }

  public setMinMax(min?: number, max?: number) {
    this.min = min ?? (this.min ??= 0)
    this.max = max ?? (this.max ??= 0)
    this.seek.min = '' + min
    this.seek.max = '' + max
  }

  get value() {
    return +this.seek.value
  }

  public setHandlers(events: RangeSelector['events']) {
    this.events = events
  }

  protected onMouseMove = (event: GrabEvent) => {
    this.scrub(event)
  }

  protected onMouseDown = (event: GrabEvent) => {
    this.rect = this.container.getBoundingClientRect()
    this.mousedown = true
    this.scrub(event)
    this.container.classList.add('is-focused')
    // в tweb `this.events?.onX && this.events.onX(...)` — здесь и ниже
    // опциональный вызов (oxlint no-unused-expressions)
    this.events?.onMouseDown?.(event)
  }

  protected onMouseUp = (event: GrabEvent) => {
    this.mousedown = false
    this.container.classList.remove('is-focused')
    this.events?.onMouseUp?.(event)
  }

  public setListeners() {
    this.seek.addEventListener('input', this.onInput)
    this._removeListeners = attachGrabListeners(this.container, this.onMouseDown, this.onMouseMove, this.onMouseUp)
  }

  public onInput = () => {
    const value = +this.seek.value
    this.setFilled(value)
    this.events?.onScrub?.(value)
  }

  public setProgress(value: number) {
    this.seek.value = '' + value
    this.setFilled(+this.seek.value) // clamp
  }

  public addProgress(value: number) {
    this.seek.value = '' + (+this.seek.value + value)
    this.setFilled(+this.seek.value) // clamp
  }

  public setFilled(value: number) {
    let percents = (value - this.min) / (this.max - this.min)
    percents = clamp(percents, 0, 1)

    // scaleX и width и в vertical-режиме — контейнер поворачивается целиком
    if (this.useTransform) {
      this.filled.style.transform = `scaleX(${percents})`
    } else if (this.useProperty) {
      this.container.style.setProperty('--progress', '' + percents)
    } else {
      this.filled.style.width = (percents * 100) + '%'
    }
  }

  /**
   * Убедиться, что rect выставлен
   * @returns value [0..1]
   */
  protected getValueByEvent(event: GrabEvent) {
    let rectMax = this.vertical ? this.rect.height : this.rect.width

    if (this.offsetAxisValue) {
      rectMax -= this.offsetAxisValue
    }

    const offsetAxisValue = clamp(
      this.vertical ?
        -(event.y - this.rect.bottom) :
        event.x - this.rect.left - this.offsetAxisValue / 2,
      0,
      rectMax,
    )

    // RTL-отражение tweb (`I18n.getIsRTL()`) не портировано — см. шапку

    return offsetAxisValue / rectMax
  }

  protected scrub(event: GrabEvent, snapValue?: (value: number) => number) {
    let value = this.min + (this.getValueByEvent(event) * (this.max - this.min))

    if ((value - this.min) < ((this.max - this.min) / 2)) {
      value -= this.step / 10
    }

    value = +value.toFixed(this.decimals)
    value = clamp(value, this.min, this.max)
    if (snapValue) value = snapValue(value)

    this.setProgress(value)
    this.events?.onScrub?.(value)

    return value
  }

  public removeListeners() {
    if (this._removeListeners) {
      this._removeListeners()
      this._removeListeners = null
    }

    this.seek.removeEventListener('input', this.onInput)

    this.events = {}
  }
}
