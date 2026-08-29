/**
 * Порт tweb `src/components/slider.ts` — `SidebarSlider`, владелец вкладок
 * колонки и их истории. Структура класса, порядок вызовов и имена методов
 * дословные; расходится ровно одно — способ хождения в историю браузера.
 *
 * ── НАВИГАЦИЯ: чем заменён appNavigationController ──────────────────────────
 *
 * tweb держит вкладки в ГЛОБАЛЬНОМ `appNavigationController` и разбирает свои
 * записи по полю `type` (`navigationType`: 'left' | 'right' | 'settings-popup'):
 * `pushItem` / `findItemByType` / `back(type)` / `removeByType(type, true)`.
 * Этого контроллера у нас нет, и заводить третий способ навигации запрещено —
 * есть ровно два: `core/navigation/navigationStack.ts` (`pushLayer`/
 * `removeLayer` + очередь мутаций истории) и `core/hotkeys.pushEsc`.
 *
 * Отображение один-в-один:
 *  • `pushItem(navigationItem)`      → `pushLayer(onPop)` + `pushEsc` (у
 *                                      оригинала обе кнопки, Back и Escape,
 *                                      обслуживает ОДИН контроллер —
 *                                      `appNavigationController.ts:216-219`;
 *                                      у нас механизма два), оба хэндла
 *                                      кладутся в `this.navigationItems` (:112);
 *  • `findItemByType(type)`          → верхний элемент `this.navigationItems`
 *                                      (:62, :275);
 *  • `back(type)`                    → прямой вызов `item.onPop()` (:64), внутри
 *                                      которого и снимается слой;
 *  • `removeByType(type, true)`      → снять ОДИН верхний свой слой (:220);
 *  • `removeItem(navigationItem)`    → `removeLayer` конкретного слоя (:95).
 *
 * `navigationType` при этом ИСЧЕЗАЕТ как опция, и это не упрощение: тип нужен
 * оригиналу только чтобы выбрать СВОИ записи из общей глобальной очереди. У нас
 * список слоёв — поле экземпляра (`navigationItems`), то есть роль
 * дискриминатора играет сам слайдер; строка-тип не различала бы ничего и была
 * бы мёртвой опцией. (Иллюстрация в брифе задачи её передаёт — это её
 * расхождение с портом, не наоборот.)
 *
 * ПОРЯДОК внутри `onPop` намеренно ОБРАТЕН оригиналу. tweb (:355-365,
 * `backByItem`) сначала выкидывает запись (`spliceItems` → `history.back()`), а
 * если `onPop` вернул `false` — вставляет обратно (`onItemAdded` → `pushState`).
 * То есть на ВЕТО оригинал успевает сделать пару back+push. У нас эта пара —
 * ровно тот источник дефектов, ради которого заведена очередь мутаций истории
 * (`navigationStack.ts`, докблок): `history.back()` асинхронна, `pushState`
 * синхронен. Поэтому спрашиваем `onPop` ПЕРВЫМ и трогаем историю, только когда
 * закрытие действительно состоялось. Наблюдаемое поведение то же, пары
 * back+push нет вовсе.
 *
 * Ветка реального Back (браузерная/аппаратная кнопка) идёт через
 * `navigationStack` штатно: `handlePop` снимает ВЕРХНИЙ слой и зовёт его
 * `onPop`; `false` — вето, стек возвращает слой И его запись истории на место
 * (`navigationStack.ts:98-108`, порт `appNavigationController.handleItem`
 * :290-303). Именно поэтому `isConfirmationNeededOnClose` работает и на Back:
 * пока пользователь не подтвердил, слой остаётся и следующий Back снова
 * достаётся вкладке, а не чату под ней.
 *
 * `removeLayer` вызывается в ОБЕИХ ветках безусловно: после реального Back слой
 * уже снят стеком, и повторный вызов — no-op (`navigationStack.ts:160-161`).
 * Своего `history.back()` в этом файле нет и быть не должно — прямой `back()`
 * мимо очереди дал два боевых дефекта волны 1.
 *
 * ── canAnimate: почему его у нас НЕТ вовсе ──────────────────────────────────
 * tweb передаёт в `onPop` признак `canAnimate` — `!this.manual ? false :
 * undefined` (`appNavigationController.ts:291`). Одного этого выражения мало,
 * чтобы понять, когда бывает `false`: `manual` ставится строкой
 * `this.manual = !this.isPossibleSwipe` (:209) в обработчике popstate, а
 * `isPossibleSwipe` взводится ТОЛЬКО на edge-свайпе iOS Safari
 * (`onTouchStart` :229-236, `isSwipingBackSafari`). То есть в оригинале
 * обычный браузерный/аппаратный Back даёт `manual === true` и закрывает
 * вкладку С АНИМАЦИЕЙ, ровно как кнопка «назад» в шапке; `false` — это
 * исключительно свайп, у которого анимацию ведёт палец пользователя.
 *
 * Детектора свайпа (`isSwipingBackSafari`) у нас не портировано, поэтому
 * ЕДИНСТВЕННОГО источника `false` не существует — параметр был бы всегда
 * `undefined`, то есть мёртвой веткой. Закрытие идёт с анимацией всегда:
 * `closeTab(undefined, undefined, true)`. Когда свайп приедет, `false`
 * возвращается ровно сюда, в замыкание, отданное `pushLayer`.
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
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import { createNavigationTransition, NAVIGATION_TRANSITION_TIME } from '@core/dom/navigationTransition'
import { pushLayer, removeLayer, type Layer } from '@core/navigation/navigationStack'
import { pushEsc } from '@core/hotkeys'
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
  managers?: Managers
}

/**
 * Наш аналог `NavigationItem` (`appNavigationController.ts`): слой в общем
 * стеке + процедура его снятия. `onPop` возвращает `false` — вето, ровно как у
 * оригинала (`slider.ts:101`).
 *
 * `removeEsc` — вторая половина ОДНОЙ записи оригинала. В tweb Escape и Back
 * обслуживает один и тот же контроллер: `onKeyDown` (`appNavigationController
 * .ts:216-219`) на `Escape` берёт ВЕРХНЮЮ запись и закрывает её тем же путём,
 * что и popstate. У нас механизма два (`core/navigation/navigationStack` для
 * Back, `core/hotkeys.pushEsc` для Esc), поэтому запись держит по хэндлу от
 * каждого — так же, как это уже сделано в `components/chat/selection.ts:50-51`
 * и `components/mediaViewer/openMediaViewer.ts:14-15`. Снимаются оба хэндла
 * ВСЕГДА вместе (`dropNavigationItem`): осиротевший Esc-обработчик съедал бы
 * нажатие пользователя в пользу давно закрытой вкладки.
 */
type SliderNavigationItem = {
  layer: Layer,
  removeEsc: () => void,
  onPop: () => boolean
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
  // `protected`, а не `private`: в оригинале `navigationType` — ещё и ручка
  // СНАРУЖИ слайдера, массовое снятие своих записей без спроса у вкладок
  // (`sidebarRight/index.ts:95` — `removeByType('right')` в `hide()`, туда же
  // :128 с запросом `findItemByType('right')`, ответ на который у нас даёт
  // `hasTabsInNavigation()`; `sidebarLeft/index.ts:1459` — уже ЧУЖОЙ тип
  // 'global-search', слайдера не касается). Такого потребителя у нас пока нет,
  // и метод «снять все свои слои» здесь был бы мёртвым кодом; подкласс задачи 8
  // при появлении прячущейся колонки допишет его сам поверх этого поля.
  protected navigationItems: SliderNavigationItem[] = []
  protected managers?: Managers
  protected middlewareHelper!: MiddlewareHelper
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
  }

  public getMiddleware() {
    return this.middlewareHelper.get()
  }

  public onCloseBtnClick = () => {
    // tweb :62-64 — `findItemByType(type)` + `back(type)`. Наш «свой верхний
    // слой» — последний в `navigationItems`; `back` разложен на `onPop` +
    // `removeLayer` внутри `popNavigationItem` (см. докблок файла).
    const item = this.navigationItems[this.navigationItems.length - 1]
    if(item) {
      item.onPop()
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

  /**
   * Порт `pushNavigationItem` (:87-115). `onPop` — тело оригинального
   * `NavigationItem.onPop` (:90-108) плюс снятие записи истории через
   * `removeLayer`; зовётся из двух мест: из замыкания, отданного `pushLayer`
   * (реальный Back), и напрямую из `onCloseBtnClick` (кнопка «назад» в шапке).
   * Обе ветки закрывают вкладку С АНИМАЦИЕЙ — см. «canAnimate» в докблоке
   * файла: в оригинале анимацию гасит только edge-свайп iOS, а не Back.
   */
  protected pushNavigationItem(tab: SliderSuperTab | undefined) {
    const item: SliderNavigationItem = {
      // Оба хэндла заполняются сразу после создания записи — замыкание ниже
      // читает их только когда запись уже снимают, то есть всегда позже
      // присваивания.
      layer: undefined as unknown as Layer,
      removeEsc: undefined as unknown as () => void,
      onPop: () => {
        if(tab?.isConfirmationNeededOnClose) {
          const result = tab.isConfirmationNeededOnClose()
          if(result) {
            Promise.resolve(result).then(() => {
              // tweb :95-98 — сначала снять запись навигации, потом закрыть
              // вкладку как «навигационную» (без повторного снятия слоя).
              this.dropNavigationItem(item)
              this.onTabsCountChange?.()

              this.closeTab(undefined, undefined, true)
            }, () => {})

            return false
          }
        }

        this.dropNavigationItem(item)
        this.closeTab(undefined, undefined, true)
        this.onTabsCountChange?.()
        return true
      },
    }

    item.layer = pushLayer(item.onPop)
    // Esc — тот же вход в ту же запись, что и Back (см. `SliderNavigationItem`).
    // Стек Esc'ов LIFO, поэтому попап, открытый ПОВЕРХ вкладки, забирает
    // нажатие себе и вкладку не закрывает — как и в оригинале, где верхней
    // записью навигации в этот момент лежит попап.
    item.removeEsc = pushEsc(() => { item.onPop() })
    this.navigationItems.push(item)
    this.onTabsCountChange?.()
  }

  /** Снять запись навигации целиком — обе её половины разом. */
  protected dropNavigationItem(item: SliderNavigationItem) {
    removeLayer(item.layer)
    item.removeEsc()
    indexOfAndSplice(this.navigationItems, item)
  }

  public async selectTab(id: number | SliderSuperTab) {
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
      // tweb :220 — `removeByType(this.navigationType, true)`: снять РОВНО одну
      // (верхнюю) свою запись навигации.
      const item = this.navigationItems.pop()
      if(item) {
        removeLayer(item.layer)
        item.removeEsc()
      }
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

  public hasTabsInNavigation() {
    return !!this.navigationItems.length
  }
}
