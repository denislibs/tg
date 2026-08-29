/**
 * Порт tweb `src/components/sliderTab.ts` — вкладка левого/правого сайдбара:
 * шапка (кнопка «назад» + заголовок) + прокручиваемый контент, с чётко
 * определённым порядком открытия/закрытия и разрушения.
 *
 * ── Прямая зависимость довезена вместе с задачей: `components/buttonIcon.ts`
 * (порт tweb `components/buttonIcon.ts`, см. разрешение ведущего в брифе
 * задачи 4, п.1 — в проекте не было эквивалента; React-кнопки `shared/ui/
 * IconButton` не годятся, это другой рендерер).
 *
 * ── `Scrollable` — сигнатура совпала без правок (брифа п.2: свериться и
 * описать расхождение, если оно есть — расхождения нет). Наш
 * `components/scrollable.ts` — тот же порт tweb 1:1, включая мёртвую ветку
 * `withPaddingContainer` (закомментирована уже в оригинале): вызов
 * `new Scrollable(this.content, undefined, undefined, true)` передаёт `true`
 * четвёртым параметром ровно как в tweb — параметр читается, но ни на что не
 * влияет ни там, ни здесь.
 *
 * ── Порядок разрушения в `onCloseAfterTimeout` — дословный (брифа п.3):
 * `deleteTab` → `container.remove()` → `scrollable.destroy()` →
 * `listenerSetter.removeAll()` → `middlewareHelper.destroy()`. Миддлварь
 * гасится ПОСЛЕДНЕЙ: асинхронные потребители (например, недошедший `await`
 * внутри `init`) обязаны узнать об отмене через мидлварь уже после того, как
 * DOM и слушатели сняты, а не раньше.
 *
 * ── `SliderSuperTabSlider` — временный контракт вместо `SidebarSlider`
 * (`@components/slider`, задача 5 этой же волны — на момент этого порта файл
 * не существует). Прецедент — `components/row.ts` (задача 2), который по той
 * же причине целиком опустил опцию `navigationTab`; здесь опустить нечего —
 * слайдер это первый параметр конструктора и предмет всего класса. Решение:
 * узкий интерфейс, повторяющий РОВНО те 5 методов, которые вкладка реально
 * зовёт на своём слайдере (`getMiddleware`/`addTab`/`deleteTab`/`closeTab`/
 * `selectTab` — сверено построчно с тем, что использует `sliderTab.ts` в
 * оригинале). Когда появится настоящий `SidebarSlider`
 * (`tweb/src/components/slider.ts`, тот же набор методов + `createTab`/
 * `onCloseBtnClick`/`onTabsCountChange`), он удовлетворит этот интерфейс
 * СТРУКТУРНО, без обратного импорта из этого файла — направление зависимости
 * останется как в оригинале (`slider.ts` → `sliderTab.ts`, а не наоборот).
 *
 * ── Опущено (не объявлено в типе) ─────────────────────────────────────────
 *  • `managers: AppManagers` — у нас нет реестра `AppManagers`
 *    (`@lib/managers` в tweb), команды к бэку идут через `core/managers/*`
 *    без единого реестра-инъекции на вкладку. Поле без предмета не заводится;
 *    появится вместе с тем, что реально станет читать его на вкладке.
 *
 * ── Адаптации под наш стек ─────────────────────────────────────────────────
 *  • `LangPackKey` + `i18n(key)` → строка-ключ через `useI18nStore.getState().t`
 *    + `i18nSpan` (тот же приём, что в `row.ts`/`button.ts`/`settingSection.ts`);
 *  • `init` — в оригинале прототипный метод, тело `open()` затем присваивает
 *    ему `null`, чтобы вкладка инициализировалась ровно один раз даже при
 *    повторных `open()`. Под наш строгий tsconfig метод с сигнатурой
 *    `(...args) => any` не типизируется как `null`-совместимый, поэтому поле
 *    объявлено как `((...args: any[]) => any) | null` — та же семантика
 *    (переопределяемое инстанс-поле, значение `null` глушит повторный вызов),
 *    только явно nullable-тип вместо неявного `any` tweb (`strict` там
 *    выключен).
 */
import EventListenerBase, { type EventListenerListeners } from '@helpers/eventListenerBase'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import noop from '@helpers/noop'
import i18nSpan from '@helpers/dom/i18nSpan'
import ButtonIcon from '@components/buttonIcon'
import Scrollable from '@components/scrollable'
import { useI18nStore } from '../i18n'

/** См. докблок файла — временный контракт вместо `SidebarSlider` (задача 5). */
export interface SliderSuperTabSlider {
  getMiddleware(): Middleware
  addTab(tab: SliderSuperTab): void
  deleteTab(tab: SliderSuperTab): void
  closeTab(tab: SliderSuperTab, animate?: boolean, isNavigation?: boolean): unknown
  selectTab(tab: SliderSuperTab): unknown
}

export interface SliderSuperTabConstructable<T extends SliderSuperTab = any> {
  new(slider: SliderSuperTabSlider, destroyable: boolean): T
}

export interface SliderSuperTabEventableConstructable {
  new(slider: SliderSuperTabSlider, destroyable: boolean): SliderSuperTabEventable
}

export default class SliderSuperTab {
  public static getInitArgs?(...args: any[]): any
  public static noSame?: boolean

  public container!: HTMLElement

  public header!: HTMLElement
  public closeBtn!: HTMLElement
  public title!: HTMLElement

  public content!: HTMLElement
  public scrollable!: Scrollable

  public slider!: SliderSuperTabSlider
  public destroyable!: boolean
  public listenerSetter!: ListenerSetter

  public middlewareHelper!: MiddlewareHelper

  // should return boolean instantly or `Promise` from `confirmationPopup`
  public isConfirmationNeededOnClose?: () => void | boolean | Promise<any>

  public init: ((...args: any[]) => Promise<any> | any) | null = function(this: SliderSuperTab) {}

  constructor(slider: SliderSuperTabSlider, destroyable?: boolean) {
    this._constructor(slider, destroyable)
  }

  public _constructor(slider: SliderSuperTabSlider, destroyable = true): any {
    this.slider = slider
    this.middlewareHelper = slider ? slider.getMiddleware().create() : getMiddleware()
    this.destroyable = destroyable

    this.container = document.createElement('div')
    this.container.classList.add('tabs-tab', 'sidebar-slider-item')

    // * Header
    this.header = document.createElement('div')
    this.header.classList.add('sidebar-header')

    this.closeBtn = ButtonIcon('left sidebar-close-button', { noRipple: true })
    this.title = document.createElement('div')
    this.title.classList.add('sidebar-header__title')
    this.header.append(this.closeBtn, this.title)

    // * Content
    this.content = document.createElement('div')
    this.content.classList.add('sidebar-content')

    this.scrollable = new Scrollable(this.content, undefined, undefined, true)
    this.scrollable.attachBorderListeners(this.container)

    this.container.append(this.header, this.content)

    this.slider?.addTab(this)

    this.listenerSetter = new ListenerSetter()
  }

  public close() {
    return this.slider.closeTab(this)
  }

  public async open(...args: Parameters<NonNullable<typeof this['init']>>) {
    if (this.init) {
      try {
        const result = this.init(...args)
        this.init = null

        if (result instanceof Promise) {
          await result
        }
      } catch (err) {
        console.error('open tab error', err)
      }
    }

    this.slider.selectTab(this)
  }

  protected onOpen() {}
  protected onOpenAfterTimeout() {}
  protected onClose() {}

  protected onCloseAfterTimeout() {
    if (this.destroyable) { // ! WARNING, пока что это будет работать только с самой последней внутренней вкладкой !
      this.slider?.deleteTab(this)
      this.container.remove()
      this.scrollable.destroy()
      this.listenerSetter?.removeAll()
      this.middlewareHelper?.destroy()
    }
  }

  protected setTitle(key: string) {
    this.title.replaceChildren(i18nSpan(useI18nStore.getState().t(key)))
  }
}

export class SliderSuperTabEventable<T extends EventListenerListeners = {}> extends SliderSuperTab {
  public eventListener: EventListenerBase<{
    destroy: () => void | Promise<any>,
    destroyAfter: (promise: Promise<void>) => void,
    close: () => void
  } & T>

  constructor(slider: SliderSuperTabSlider) {
    super(slider)
    this.eventListener = new EventListenerBase()
  }

  onClose() {
    // @ts-ignore — та же типовая дыра, что в оригинале: `dispatchEvent` не
    // выводит `'close'` из объединения `{...} & T` при произвольном `T`.
    this.eventListener.dispatchEvent('close')
  }

  onCloseAfterTimeout() {
    // @ts-ignore
    const results = this.eventListener.dispatchResultableEvent('destroy')
    // @ts-ignore
    this.eventListener.dispatchEvent('destroyAfter', Promise.all(results).then(noop, noop))
    this.eventListener.cleanup()
    return super.onCloseAfterTimeout()
  }
}
