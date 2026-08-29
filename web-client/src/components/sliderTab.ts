/**
 * Порт tweb `src/components/sliderTab.ts` — вкладка левого/правого сайдбара:
 * шапка (кнопка «назад» + заголовок) + прокручиваемый контент, с чётко
 * определённым порядком открытия/закрытия и разрушения.
 *
 * ── Раунд 1 ревью ──────────────────────────────────────────────────────────
 *
 * КРИТИЧНО — `init` вернулся к прототипному методу (tweb :97-99:
 * `public init(...args: any[]): Promise<any> | any {}`). Раунд 0 объявлял его
 * ПОЛЕМ (`public init = function() {}`), а не методом: инициализатор поля
 * базового класса создаёт СОБСТВЕННОЕ свойство на инстансе во время
 * выполнения конструктора базы — оно шадоуит прототипный метод подкласса,
 * если тот определяет `init` именно методом (`class T extends SliderSuperTab
 * { init(...args) {...} }`), а не полем. В tweb так объявляют `init` ВСЕ
 * вкладки без исключения: классов, наследующих `SliderSuperTab`/
 * `SliderSuperTabEventable`, там ровно 10 (`grep -rn "extends SliderSuperTab"
 * src/`, минус сам базовый `SliderSuperTabEventable` и generic-упоминания в
 * сигнатурах), и все 10 объявляют `init` методом — 8 именованных
 * (`sidebarLeft/tabs/changeLoginEmail.tsx:13,46`,
 * `sidebarRight/tabs/statistics.tsx:1062`, `boosts.tsx:396`,
 * `pollResults.tsx:21`, `sharedMediaTab.tsx:64`, `savedMusic.tsx:709`,
 * `forumTab/forumTab.ts:73`) и 2 анонимных из фабрики
 * (`solidJsTabs/scaffoldSolidJSTab.tsx:38`, `:108`). Прежняя редакция этого
 * абзаца называла «39 мест» — это все `init(` в `src/components/` целиком, из
 * которых большинство к вкладкам отношения не имеет (`loader.ts`,
 * `dotRenderer.ts`, `mediaEditor/*`, `emoticonsDropdown/*`); цифра неверна и
 * отнесена была не к тому. Раунд 0 сломал бы КАЖДУЮ вкладку волны,
 * портированную в этой самой распространённой форме. Тест из брифа шага
 * (`init = init`, тоже ПОЛЕ) эту дыру не видел — иллюстрация брифа слабее
 * реального контракта оригинала.
 *
 * Починка (по решению ревью): `init` — прототипный метод, `open()` гасит его
 * присваиванием `this.init = null as any`. Наш строгий tsconfig не даёt
 * типизировать метод с сигнатурой `(...args) => any` как nullable
 * (`Type 'null' is not assignable`), поэтому именно в точке присваивания
 * стоит точечный `as any` — та же вольность, которую в tweb даёт выключенный
 * `strict`, а не общий `@ts-ignore` на весь файл. Это ЕДИНСТВЕННОЕ место,
 * где типы отпущены: сама сигнатура метода осталась честной.
 *
 * ВАЖНО-1/2 — порядок и полнота разрушения `onCloseAfterTimeout` (tweb
 * :105-113) не были запинены: раунд 0 разворачивал порядок или вырезал
 * `scrollable.destroy()`/`slider.deleteTab()` — 8/8 тестов оставались
 * зелёными. Добавлен журнал вызовов (`sliderTab.test.ts`, тест «порядок
 * разрушения»), который фиксирует ТОЧНУЮ последовательность
 * `deleteTab → container.remove → scrollable.destroy → listenerSetter.removeAll
 * → middlewareHelper.destroy` и красит и перестановку, и любое выпадение
 * звена. То же для `SliderSuperTabEventable.onCloseAfterTimeout` (tweb
 * :137-144): отдельный журнал ловит выпадение `dispatchResultableEvent
 * ('destroy')`, `dispatchEvent('destroyAfter', …)` или `eventListener.cleanup()`.
 *
 * ВАЖНО-3 — `slider.getMiddleware().create()` (tweb :47) делает миддлварь
 * вкладки РЕБЁНКОМ миддлвари слайдера: `destroy()` слайдера обязан каскадно
 * гасить миддлварь всех его вкладок (`MiddlewareHelper.clean()` рекурсивно
 * гасит `details.inner`). Мутация на плоский `getMiddleware()` (без
 * `.create()`) проходила зелёной — тестовый стаб слайдера строил middleware
 * из АНОНИМНОГО одноразового корня и не мог отличить потомка от корня. Стаб
 * (`createSliderStub`) переделан: корневой `MiddlewareHelper` теперь
 * ПЕРЕДАЁТСЯ явно и доступен тесту как `sliderStub.rootMiddleware` — новый
 * тест разрушает именно его и проверяет каскад.
 *
 * ВАЖНО-4 — `managers` (tweb :36, `public managers: AppManagers`) оказался
 * НЕ пустой опцией: `slider.ts:270` (`createTab`) проставляет его вкладке
 * ПОСЛЕ конструктора (`tab.managers = this.managers`, не аргументом
 * конструктора — поэтому поле опционально и не участвует в `_constructor`),
 * а вкладка «Устройства» (`sidebarLeft/tabs/activeSessions.tsx:73,118`) зовёт
 * `tab.managers.appAccountManager.resetAuthorizations()`/
 * `resetAuthorization(hash)`. У нас нет реестра `AppManagers` дословно, но
 * есть его прямой структурный аналог — `Managers` (`client/bootstrap.ts`,
 * тот же принцип: один DI-объект с ручками ко всем менеджерам воркера,
 * инжектируется, а не импортируется). Наша вкладка «Устройства»
 * (`sidebarLeft/tabs/activeSessions.solid.tsx`, шаг 7 плана волны 2) зовёт
 * `tab.managers.sessions.terminate(id)`/`terminateOthers()`
 * (`core/managers/sessionsManager.ts`) — прямой аналог `resetAuthorization`/
 * `resetAuthorizations`. Долг закрыт с обеих сторон: слайдер проставляет поле
 * в `createTab` (`slider.ts::createTab`, tweb :270), вкладка читает вкладочное
 * `tab.managers`, а не тянет менеджеры своим путём мимо базового класса.
 *
 * МИНОР-1 — `slider` теперь `slider?: SliderSuperTabSlider` (а не
 * `slider!:` с скрытым допущением непустоты). В tweb `slider.ts:269`
 * (`createTab`) буквально зовёт `new ctor(doNotAppend ? undefined : this,
 * destroyable)` — слайдер осознанно передаёт `undefined`. Раунд 0 объявлял
 * параметр непустым, из-за чего ветки `slider ? … : getMiddleware()` (:47) и
 * `this.slider?.addTab(this)` были недостижимы ПО ТИПАМ — мёртвый код,
 * который выглядел как живой guard. `close()`/`open()` по-прежнему зовут
 * `this.slider!.closeTab/selectTab` без guard'а — дословно как в оригинале
 * (там тоже без проверки), поэтому ненулевое утверждение на вызове, а не
 * смена контракта.
 *
 * МИНОР-2 (#112) — вторая, независимая от `ButtonIcon`, реализация иконочной
 * кнопки — `components/mediaViewer/base.ts:207-214` (`btnIcon`, её же докблок
 * называет «порт tweb `ButtonIcon()` в объёме вьювера»). Осознанно НЕ сведено
 * в этом коммите: вьювер — отдельная, уже принятая подсистема
 * (`web-client/CLAUDE.md`: «правило изменений ядра — сначала tweb, порт 1:1»),
 * трогать её файл вне периметра шага 4 плана волны 2 — расширение изменяемых
 * путей сверх согласованного списка. Технически своп ОДНОСТРОЧНЫЙ —
 * `btnIcon(icon, {onlyMobile})` → `ButtonIcon(icon, {noRipple: true,
 * onlyMobile})` даёт тот же DOM (класс `btn-icon`, `only-handhelds`,
 * `span.tgico.button-icon`, `.c-ripple` не создаётся ни там, ни там).
 *
 * ── Прямая зависимость довезена вместе с самим шагом: `components/buttonIcon.ts`
 * (порт tweb `components/buttonIcon.ts` — в проекте не было эквивалента до
 * MINOR-2 выше; React-кнопки `shared/ui/IconButton` не годятся, это другой
 * рендерер).
 *
 * ── `Scrollable` (tweb :66-67) — сигнатура совпала без правок. Наш
 * `components/scrollable.ts` — тот же порт tweb 1:1, включая мёртвую ветку
 * `withPaddingContainer` (закомментирована уже в оригинале): вызов
 * `new Scrollable(this.content, undefined, undefined, true)` передаёт `true`
 * четвёртым параметром ровно как в tweb — параметр читается, но ни на что не
 * влияет ни там, ни здесь.
 *
 * ── `SliderSuperTabSlider` — временный контракт вместо `SidebarSlider`
 * (`@components/slider`, шаг 5 плана этой же волны — на момент этого порта
 * файл не существует). Прецедент — `components/row.ts` (шаг 2), который по той
 * же причине целиком опустил опцию `navigationTab`; здесь опустить нечего —
 * слайдер это первый параметр конструктора и предмет всего класса. Решение:
 * узкий интерфейс, повторяющий РОВНО те 5 методов, которые вкладка реально
 * зовёт на своём слайдере (`getMiddleware`/`addTab`/`deleteTab`/`closeTab`/
 * `selectTab` — сверено построчно с тем, что использует `sliderTab.ts` в
 * оригинале: :47, :71/:107/:138, :77, :94). Когда появится настоящий
 * `SidebarSlider` (`tweb/src/components/slider.ts`, тот же набор методов +
 * `createTab`/`onCloseBtnClick`/`onTabsCountChange`), он удовлетворит этот
 * интерфейс СТРУКТУРНО, без обратного импорта из этого файла — направление
 * зависимости останется как в оригинале (`slider.ts` → `sliderTab.ts`, а не
 * наоборот).
 *
 * ── Адаптации под наш стек ─────────────────────────────────────────────────
 *  • `LangPackKey` + `i18n(key)` (tweb :115-117) → строка-ключ через
 *    `useI18nStore.getState().t` + `i18nSpan` (#109 — тот же приём и то же
 *    расхождение, что в `row.ts`/`button.ts`/`settingSection.ts`: наш словарь
 *    это ключ→строка, а не `langPack` оригинала).
 */
import EventListenerBase, { type EventListenerListeners } from '@helpers/eventListenerBase'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import noop from '@helpers/noop'
import i18nSpan from '@helpers/dom/i18nSpan'
import ButtonIcon from '@components/buttonIcon'
import Scrollable from '@components/scrollable'
import { useI18nStore } from '../i18n'
import type { Managers } from '../client/bootstrap'

/** См. докблок файла — временный контракт вместо `SidebarSlider` (шаг 5 плана волны 2). */
export interface SliderSuperTabSlider {
  getMiddleware(): Middleware
  addTab(tab: SliderSuperTab): void
  deleteTab(tab: SliderSuperTab): void
  closeTab(tab: SliderSuperTab, animate?: boolean, isNavigation?: boolean): unknown
  selectTab(tab: SliderSuperTab): unknown
}

export interface SliderSuperTabConstructable<T extends SliderSuperTab = any> {
  new(slider?: SliderSuperTabSlider, destroyable?: boolean): T
}

export interface SliderSuperTabEventableConstructable {
  new(slider?: SliderSuperTabSlider, destroyable?: boolean): SliderSuperTabEventable
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

  public slider?: SliderSuperTabSlider
  public destroyable!: boolean
  public listenerSetter!: ListenerSetter

  // Проставляется слайдером ПОСЛЕ конструктора (`slider.ts::createTab` —
  // `tab.managers = this.managers`), не аргумент `_constructor`. См.
  // ВАЖНО-4 в докблоке файла.
  public managers?: Managers

  public middlewareHelper!: MiddlewareHelper

  // should return boolean instantly or `Promise` from `confirmationPopup`
  public isConfirmationNeededOnClose?: () => void | boolean | Promise<any>

  constructor(slider?: SliderSuperTabSlider, destroyable?: boolean) {
    this._constructor(slider, destroyable)
  }

  public _constructor(slider?: SliderSuperTabSlider, destroyable = true): any {
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
    return this.slider!.closeTab(this)
  }

  public async open(...args: Parameters<typeof this['init']>) {
    if (this.init) {
      try {
        const result = this.init(...args)
        this.init = null as any

        if (result instanceof Promise) {
          await result
        }
      } catch (err) {
        console.error('open tab error', err)
      }
    }

    this.slider!.selectTab(this)
  }

  public init(..._args: any[]): Promise<any> | any {

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

  constructor(slider?: SliderSuperTabSlider) {
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
