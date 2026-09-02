/**
 * Порт tweb `src/components/slider.ts` — `SidebarSlider`, владелец вкладок
 * колонки и их истории. Структура класса, порядок вызовов и имена методов
 * дословные; расходится ровно одно — способ хождения в историю браузера.
 *
 * ── НАВИГАЦИЯ: теперь дословно, через appNavigationController (#108) ───────
 *
 * Раньше здесь лежало отображение семантики контроллера на два наших механизма
 * (`navigationStack.pushLayer` для Back + `hotkeys.pushEsc` для Esc), а
 * `navigationType` исчезал как опция — потому что список записей был полем
 * ЭКЗЕМПЛЯРА слайдера и дискриминатор не различал бы ничего.
 *
 * Контроллер портирован (`core/navigation/appNavigationController.ts`), список
 * записей снова ОДИН и глобальный, и вместе с ним вернулся `navigationType` —
 * не как украшение, а как единственный способ выбрать из общей очереди СВОИ
 * записи: `findItemByType` / `back(type)` / `removeByType(type, true)`. Ровно
 * этим левая и правая колонки оригинала и разделяют одну очередь.
 *
 * `canAnimate` тоже перестал быть мёртвым: его источник — edge-свайп «назад» в
 * мобильном Safari (`isSwipingBackSafari` → `manual = false`), и он честно
 * доезжает до `closeTab(undefined, canAnimate, true)`, как в оригинале
 * (`:105`). Своя анимация поверх системной там не нужна.
 *
 * ── ЕДИНЫЙ КРИТЕРИЙ МЁРТВОГО КОДА ДЛЯ ПОРТОВ ────────────────────────────────
 * Волна применяет его в обе стороны, поэтому он выписан один раз здесь и
 * второй раз — у `popups/popupElement.ts` (`appendSolid`), где даёт
 * ПРОТИВОПОЛОЖНЫЙ результат.
 *
 * Потребитель ищется НЕ в текущем срезе репозитория, а на дорожной карте
 * порта (`docs/tweb/roadmap.md`). Метод остаётся, если его вызывающие в tweb
 * принадлежат подсистеме, которую мы портируем; снимается, если вызывающие —
 * функциональность, которой у нас нет и не планируется. Иначе критерий
 * «сегодня некому звать» вырезал бы у класса ровно те методы, которые
 * понадобятся следующему же шагу, и порт пришлось бы дописывать обратно.
 *
 * По этому критерию три метода ниже ОСТАЮТСЯ, хотя вызывающих у них здесь
 * сегодня нет: все их вызывающие в tweb — обе колонки, то есть этап 3
 * дорожной карты («слайдер табов: профиль, настройки, edit-экраны»):
 *  • `closeAllTabsNaturally` — `sidebarLeft/index.ts:506`;
 *  • `sliceTabsUntilTab` — `solidJsTabs/tabs.ts:27`, `2fa/index.tsx:34`,
 *    `2fa/passwordSet.tsx:23`, `2fa/emailConfirmation.tsx:44,109`,
 *    `2fa/forgotPasswordLink.ts:103,108`, `changeLoginEmail.tsx:30`,
 *    `passcodeLock/mainTab.tsx:98,221`;
 *  • `isTabExists` — `chat/requests.tsx:69`, `chat/topbar.ts:855`,
 *    `pollMessageContent/PollMessageContent.tsx:374`,
 *    `emoticonsDropdown/index.ts:297,301`.
 *
 * ── Адаптации под наш стек ──────────────────────────────────────────────────
 *  • `TransitionSlider({content, type:'navigation', transitionTime})` (:41-45)
 *    → `createNavigationTransition(container, time)` из
 *    `core/dom/navigationTransition.ts` — тот же порт `transition.ts`, второго
 *    движка анимации не заведено;
 *  • `TRANSITION_TIME = 250` (:11) → `NAVIGATION_TRANSITION_TIME` оттуда же —
 *    константа уже была портирована, дублировать её числом нельзя (разъедутся
 *    с CSS по отдельности);
 *  • `AppManagers` → наш `Managers` (`client/bootstrap.ts`), тот же реестр
 *    ручек к воркеру. В tweb `SidebarSliderOptions` его не объявляет —
 *    подмешивает подкласс (`sidebarLeft/settingsSliderPopup.ts:7-10`) поверх
 *    `safeAssign`; у нас строгие типы, поэтому опция объявлена явно, чтобы
 *    хосту слайдера не пришлось заводить подкласс на одно поле;
 *  • `tab?.isConfirmationNeededOnClose` / `tab?.onOpen` — оптиональная цепочка
 *    там, где оригинал обращается напрямую (:91, :131): `this.tabs.get(id)` по
 *    типам даёт `SliderSuperTab | undefined`. Достижимая ветка та же (для
 *    зарегистрированного id вкладка есть), обращение к полю несуществующей
 *    вкладки в оригинале просто бросило бы.
 */
import SliderSuperTab, { type SliderSuperTabConstructable } from '@components/sliderTab'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import safeAssign from '@helpers/object/safeAssign'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import { createNavigationTransition, NAVIGATION_TRANSITION_TIME } from '@core/dom/navigationTransition'
import appNavigationController, { type NavigationItem, type NavigationItemType } from '@core/navigation/appNavigationController'
import type { Managers } from '../client/bootstrap'

export { SliderSuperTab }

/**
 * tweb (:15-20) описывает опции индексным доступом к полям класса
 * (`SidebarSlider['tabs']` и т.п.); у нас три из четырёх полей
 * protected/private, а строгий TS запрещает читать их тип снаружи класса —
 * поэтому типы выписаны, а не выведены. Набор полей тот же.
 */
export type SidebarSliderOptions = {
  sidebarEl: HTMLElement,
  tabs?: Map<any, SliderSuperTab>,
  canHideFirst?: boolean,
  /** tweb :19 — чем слайдер отличает СВОИ записи в общей очереди навигации. */
  navigationType: NavigationItemType,
  managers?: Managers
}

/**
 * Жизненные хуки вкладки объявлены `protected` (`sliderTab.ts:240-252`, как и в
 * оригинале), но зовёт их слайдер — снаружи класса. tweb обходит это `@ts-ignore`
 * на каждом вызове (:130, :134, :228, :234); мы — одной точечной проекцией:
 * так `@ts-ignore` не глушит заодно и опечатку в имени хука.
 */
type SliderTabHooks = {
  onOpen?: () => void,
  onOpenAfterTimeout?: () => void,
  onClose?: () => void,
  onCloseAfterTimeout?: () => void
}

const tabHooks = (tab: SliderSuperTab) => tab as unknown as SliderTabHooks

export default class SidebarSlider {
  protected _selectTab!: ReturnType<typeof createNavigationTransition>
  protected historyTabIds: (number | SliderSuperTab)[] = [] // * key is any, since right sidebar is ugly now
  protected tabsContainer!: HTMLElement
  public sidebarEl!: HTMLElement
  protected tabs!: Map<any, SliderSuperTab> // * key is any, since right sidebar is ugly now
  private canHideFirst = false
  private navigationType!: NavigationItemType
  protected managers?: Managers
  protected middlewareHelper!: MiddlewareHelper
  /**
   * Снимок собственной миддлвари, взятый В КОНСТРУКТОРЕ, — «слайдер ещё жив».
   * Именно снимок, а не `getMiddleware()` по месту: `destroy()` гасит хелпер,
   * а `MiddlewareHelper.clean()` тут же заводит СВЕЖИЙ `details`
   * (`helpers/middleware.ts:39`), поэтому повторный `get()` после смерти
   * отдаёт снова живую миддлварь и ничего не различает.
   */
  private middleware!: Middleware
  public onOpenTab?: () => void | Promise<void>
  public onTabsCountChange?: () => void

  constructor(options: SidebarSliderOptions) {
    safeAssign(this, options)

    this.tabs ??= new Map()

    // Разметка колонки обязана содержать `.sidebar-slider` (tweb
    // `scss/partials/_slider.scss`) — без него слайдеру некуда класть вкладки.
    this.tabsContainer = this.sidebarEl.querySelector('.sidebar-slider') as HTMLElement
    this._selectTab = createNavigationTransition(this.tabsContainer, NAVIGATION_TRANSITION_TIME)
    if(!this.canHideFirst) {
      this._selectTab(0)
    }

    this.middlewareHelper = getMiddleware()
    this.middleware = this.middlewareHelper.get()
  }

  public getMiddleware() {
    return this.middlewareHelper.get()
  }

  /**
   * Слайдер отдаёт владение всем, что успел развесить. Метода НЕТ в оригинале
   * (#112): там слайдеры — синглтоны обеих колонок и живут столько же, сколько
   * приложение, поэтому вопрос «а если слайдер умер» у tweb не возникает. У нас
   * слайдер заводится на время жизни React-экрана настроек (шов, см. докблок
   * `sidebarLeft/settingsSliderHost.ts`) и обязан уметь умирать; с переездом
   * корня настроек во вкладку слайдер снова станет вечным, и метод уйдёт вместе
   * со швом.
   *
   * Гасим ИМЕННО `middlewareHelper`, а не заводим отдельный флаг: миддлварь
   * каждой вкладки — его ребёнок (`sliderTab.ts::_constructor`, tweb :47), то
   * есть одно гашение каскадом объявляет недействительным ВСЁ, что вкладки
   * ждут от воркера. Это же и есть признак «слайдер мёртв» для `selectTab`.
   */
  public destroy() {
    this.closeAllTabs()
    this.middlewareHelper.destroy()
  }

  public onCloseBtnClick = () => {
    const item = appNavigationController.findItemByType(this.navigationType)
    if(item) {
      appNavigationController.back(this.navigationType)
      this.onTabsCountChange?.()
    } else if(this.historyTabIds.length) {
      this.closeTab(this.historyTabIds[this.historyTabIds.length - 1])
    }
  }

  public closeTab = (id?: number | SliderSuperTab, animate?: boolean, isNavigation?: boolean) => {
    if(id !== undefined && this.historyTabIds[this.historyTabIds.length - 1] !== id) {
      this.removeTabFromHistory(id)
      return false
    }

    const closingId = this.historyTabIds.pop() // pop current
    this.onCloseTab(closingId, animate, isNavigation)

    const tab = this.historyTabIds[this.historyTabIds.length - 1]
    this._selectTab(tab !== undefined ? (tab instanceof SliderSuperTab ? tab.container : tab) : (this.canHideFirst ? -1 : 0), animate)
    return true
  }

  /** Порт `pushNavigationItem` (:87-115) — теперь дословный. */
  protected pushNavigationItem(tab: SliderSuperTab | undefined) {
    const navigationItem: NavigationItem = {
      type: this.navigationType,
      onPop: (canAnimate) => {
        if(tab?.isConfirmationNeededOnClose) {
          const result = tab.isConfirmationNeededOnClose()
          if(result) {
            Promise.resolve(result).then(() => {
              appNavigationController.removeItem(navigationItem)
              this.onTabsCountChange?.()

              this.closeTab(undefined, undefined, true)
            }, () => {})

            return false
          }
        }

        this.closeTab(undefined, canAnimate, true)
        this.onTabsCountChange?.()
        return true
      },
    }

    appNavigationController.pushItem(navigationItem)
    this.onTabsCountChange?.()
  }

  public async selectTab(id: number | SliderSuperTab) {
    // Единственная воронка открытия — сюда сходятся и `tab.open()`, и прямой
    // вызов. Слайдер мог умереть, пока вкладка ждала свой чанк и данные
    // (`SliderSuperTab.open` держит `await` между `createTab` и этой строкой):
    // показывать её некуда, а её след — узлы мимо колонки, слой навигации и
    // Esc-обработчик — пережил бы свой экран. Разбираем вкладку тем же путём,
    // каким разбирается закрытая (`onCloseTab` → `onCloseAfterTimeout`), и
    // `isNavigation: true`, потому что своей записи навигации у неё нет —
    // `pushNavigationItem` ниже до неё не дошёл. Ветки нет в оригинале по той
    // же причине, что и `destroy()` выше (#112).
    if(!this.middleware()) {
      this.onCloseTab(id, false, true)
      return false
    }

    if(this.historyTabIds[this.historyTabIds.length - 1] === id) {
      return false
    }

    const tab: SliderSuperTab | undefined = id instanceof SliderSuperTab ? id : this.tabs.get(id)
    if(this.onOpenTab) await this.onOpenTab()

    if(tab) {
      const hooks = tabHooks(tab)
      hooks.onOpen?.()

      if(hooks.onOpenAfterTimeout) {
        setTimeout(() => {
          hooks.onOpenAfterTimeout?.()
        }, NAVIGATION_TRANSITION_TIME)
      }
    }

    this.pushNavigationItem(tab)

    this.historyTabIds.push(id)
    this._selectTab(id instanceof SliderSuperTab ? id.container : id)
    return true
  }

  public removeTabFromHistory(id: number | SliderSuperTab) {
    indexOfAndSplice(this.historyTabIds, id)
    this.onCloseTab(id, undefined)
  }

  public closeAllTabs() {
    const hasTabs = this.hasTabsInNavigation()
    for(let i = this.historyTabIds.length - 1; i >= 0; --i) {
      const tabId = this.historyTabIds[i]
      const tab = tabId instanceof SliderSuperTab ? tabId : this.tabs.get(tabId)
      tab?.close()
    }
    return hasTabs
  }

  /**
   * Закрыть открытые вкладки сверху вниз ТАК ЖЕ, как это делает стрелка
   * «назад»: каждая вкладка с `isConfirmationNeededOnClose` успевает показать
   * свой попап. Отказ пользователя (промис отклонён) — остановка и `false`;
   * отказавшая вкладка и всё под ней остаются открытыми. В отличие от
   * `closeAllTabs`, который закрывает всё силой и подтверждения не спрашивает.
   */
  public async closeAllTabsNaturally(): Promise<boolean> {
    while(this.historyTabIds.length) {
      const tabId = this.historyTabIds[this.historyTabIds.length - 1]
      const tab = tabId instanceof SliderSuperTab ? tabId : this.tabs.get(tabId)

      const confirmation = tab?.isConfirmationNeededOnClose?.()
      if(confirmation) {
        const confirmed = await Promise.resolve(confirmation).then(() => true, () => false)
        if(!confirmed) {
          return false
        }

        // Пока висел попап, стек мог сдвинуться — пересчитать.
        if(this.historyTabIds[this.historyTabIds.length - 1] !== tabId) {
          continue
        }
      }

      this.closeTab(tabId, undefined, false)
    }

    return true
  }

  public sliceTabsUntilTab(tabConstructor: SliderSuperTabConstructable, preserveTab: SliderSuperTab) {
    for(let i = this.historyTabIds.length - 1; i >= 0; --i) {
      const tab = this.historyTabIds[i]
      if(tab === preserveTab) continue
      else if(tab instanceof tabConstructor) {
        break
      }

      this.removeTabFromHistory(tab)
    }
  }

  public getTab<T extends SliderSuperTab>(tabConstructor: SliderSuperTabConstructable<T>) {
    return this.historyTabIds.find((t) => t instanceof tabConstructor) as T | undefined
  }

  public getHistory() {
    return this.historyTabIds
  }

  public isTabExists(tabConstructor: SliderSuperTabConstructable) {
    return !!this.getTab(tabConstructor)
  }

  // `_animate` не читается — ровно как в оригинале (:218, там параметр тоже
  // объявлен и не используется): анимацией распоряжается `closeTab`, сюда он
  // доезжает только ради единой сигнатуры для переопределений.
  protected onCloseTab(id: number | SliderSuperTab | undefined, _animate?: boolean, isNavigation?: boolean) {
    if(!isNavigation) {
      appNavigationController.removeByType(this.navigationType, true)
      this.onTabsCountChange?.()
    }

    const tab: SliderSuperTab | undefined = id instanceof SliderSuperTab ? id : this.tabs.get(id)
    if(tab) {
      const hooks = tabHooks(tab)
      try {
        hooks.onClose?.()
      } catch(err) {
        console.error('tab onClose error', tab, err)
      }

      if(hooks.onCloseAfterTimeout) {
        setTimeout(() => {
          hooks.onCloseAfterTimeout?.()
        }, NAVIGATION_TRANSITION_TIME + 30)
      }
    }
  }

  public addTab(tab: SliderSuperTab) {
    if(!tab.container.parentElement) {
      this.tabsContainer.append(tab.container)

      if(tab.closeBtn) {
        tab.closeBtn.addEventListener('click', this.onCloseBtnClick)
      }
    }
  }

  public deleteTab(tab: SliderSuperTab) {
    this.tabs.delete(tab)
  }

  public createTab<T extends SliderSuperTab>(
    ctor: SliderSuperTabConstructable<T>,
    destroyable = true,
    doNotAppend?: boolean,
  ) {
    if(
      (ctor as unknown as typeof SliderSuperTab).noSame &&
      this.historyTabIds[this.historyTabIds.length - 1] instanceof ctor
    ) {
      return this.historyTabIds[this.historyTabIds.length - 1] as T
    }

    const tab = new ctor(doNotAppend ? undefined : this, destroyable)
    // tweb :270 — реестр менеджеров приезжает вкладке ПОСЛЕ конструктора; без
    // этой строки вкладка полезла бы к воркеру своим путём мимо базового класса.
    tab.managers = this.managers
    return tab
  }

  /**
   * tweb `sidebarRight/index.ts:128` спрашивает то же самое напрямую —
   * `findItemByType('right')`; метод существует, чтобы вызывающему не надо было
   * знать `navigationType` слайдера.
   */
  public hasTabsInNavigation() {
    return !!appNavigationController.findItemByType(this.navigationType)
  }
}
