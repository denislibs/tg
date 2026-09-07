// Порт tweb `src/components/appSearchSuper.ts` (2843) — ЯДРО класса: разметка
// подсистемы, полоса вкладок, слайдер содержимого, ПАМЯТЬ ПОЗИЦИИ СКРОЛЛА,
// свайп между вкладками, очистка и смена пира.
//
// Разбор подсистемы с адресами — `docs/tweb/shared-media.md` § 1.3, § 1.4, § 1.9;
// план этапа — `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`,
// задача 5. Эталон разметки — живой дамп Telegram
// `docs/tweb/dom/dumps/07-right-sidebar.json:121-308` (дамп — ОДНА физическая
// строка JSON; здесь и ниже нумерация по РАЗВЁРНУТОМУ тексту, где первая
// строка — первая, `json.load(...).split('\n')`).
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ ЕЩЁ НЕ ЖИВЁТ (и почему это не заглушки, а пропуски)
//
// Класс в оригинале — один файл на всю подсистему, и портируется он этапами
// (задачи 5→14 плана). Всё, что относится к загрузке данных, рендеру элементов,
// выделению и контекстному меню, в этом файле ОТСУТСТВУЕТ ЦЕЛИКОМ — ни полей,
// ни пустых методов: заглушка, которую никто не зовёт, — мёртвый код
// (`CLAUDE.md`). Места, где оригинал зовёт ещё не приехавшее, помечены
// комментарием со ссылкой на строку tweb и номер задачи; когда задача приедет,
// вызов встанет ровно туда.
//
//  • `load`/`loadType`/`historyStorage`-рендер, `nextRates`, `loadPromises`,
//    `loaded`, `firstLoad`, `setCounter`/`counters` — задача 6 (`tweb:2181-2577`);
//  • `processXFilter`, медиавьювер по клику — задачи 7-9 (`tweb:826-1283`, `:716-777`);
//  • `loadFirstTime`, предикаты `canView*` — задача 10 (`tweb:2362-2529`);
//  • `SortedUserList`/участники — задача 11 (`tweb:1525-1758`);
//  • `SearchSelection`, `SearchContextMenu` — задача 14 (`tweb:156-345`,
//    `chat/selection.ts:583-763`).
//
// ─────────────────────────────────────────────────────────────────────────────
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//
//  1. `Tabs.MenuGradient` (`tweb/src/components/tabs.tsx:71-95`) не заводится
//     отдельным модулем: у нас нет `components/tabs.tsx`, а у фабрики
//     единственный потребитель — этот класс. Два узла градиента собираются
//     здесь же с ТЕМИ ЖЕ классами, что отдаёт фабрика (сверено с дампом
//     `07-right-sidebar.json:122-123`). Собственных стилей у
//     `menu-horizontal-gradient*` нет ни у нас, ни в tweb — во всём
//     `tweb/src` эти классы встречаются только в самой `tabs.tsx`; видимое
//     правило одно, и оно наше: `.search-super-tabs-gradient-container`
//     (`styles/tweb/_searchSuper.scss:92-98`).
//  2. `createRoot` вокруг `Section` (`tweb:567-576`) у нас ВОЗВРАЩАЕТ dispose,
//     и `destroy()` его зовёт. В оригинале корень не утилизируется никогда —
//     у нас `destroy()` обязан не оставлять следов (DoD 5 спеки волны 3).
//  3. `lazyLoadQueue.lock()`/`unlockAndRefresh()` под `useHeavyAnimationCheck`
//     (`tweb:793-795`) не портированы: наш `core/lazyLoadQueue.ts` — сокращённый
//     порт (`push`/`clear`), ручек паузы у него нет. Гасить очередь на время
//     тяжёлой анимации станет нечем до тех пор, пока очередь не дорастёт; на
//     ядро это не влияет — задачи в неё кладёт рендер (задачи 7-9).
//  4. `searchGroupMedia.clear()` в `cleanupHTML` (`tweb:2791`) пропущен:
//     `searchGroup.tsx` — часть ЛЕВОЙ колонки (`docs/tweb/shared-media.md` § 1.2),
//     в правой этот узел не создаётся и у нас не портирован.
//  5. `slider`/`appSidebarRight` (поле `tweb:432`, опция `:450`, дефолт `:453`)
//     не в опциях: поле нужно только вкладкам «участники»/«похожие каналы»
//     для открытия подэкранов (задачи 11-12).
//  6. `managers` (поле `tweb:419`, опция `:448`) не в опциях: ядро не ходит в
//     сеть. Приедет с задачей 6 вместе с первым обращением к менеджерам.
//  7. ВЛАДЕНИЕ СКРОЛЛЕРОМ. Правило у нас такое: скроллер уничтожается только
//     если создан и принадлежит классу. Оригинал ему удовлетворяет даром —
//     `this.scrollable.destroy()` (`tweb:2831`) там роняет скроллер, который
//     создан владельцем класса (вкладка сайдбара `SliderSuperTab`) и умирает
//     вместе с ним, третьих читателей у него нет. У нас (задача 13 плана) тот
//     же скроллер будет ОБЩИМ с шапкой профиля и переживёт подсистему, а строка
//     скопирована дословно — то есть ПРАВИЛО СЕЙЧАС НЕ СОБЛЮДЕНО, и это
//     ловушка: `Scrollable.destroy()` лишь снимает слушателей и обнуляет
//     колбэки (`components/scrollable.ts:227-232`) — ни исключения, ни записи
//     в консоль; панель просто перестанет реагировать на прокрутку. Развилка
//     («класс заводит свой скроллер» ИЛИ «уничтожение уходит») закрывается
//     задачей 13 плана, там же предупреждение.
//  8. `destroy()` дополнительно СНИМАЕТ контейнер из DOM (`container.remove()`),
//     чего в оригинале нет вовсе: там узел снимает владелец вместе со своим
//     экраном, у нас его обязан убрать сам класс (DoD 5 — «после destroy() узлов
//     класса в документе нет»). Обратная сторона того же расхождения: `selectTab`
//     мы НЕ обнуляем, хотя оригинал обнуляет (`tweb:2837`) — поле объявлено
//     `selectTab!: SelectTab` и под `strictNullChecks` (в tweb он выключен)
//     присвоение `undefined` не проходит по типу; после `destroy()` вызов
//     `selectTab` безопасен — слушатели сняты, а переключение уже мёртвого
//     дерева ничего не наблюдает.
import Scrollable, { ScrollableX } from '@components/scrollable'
import { horizontalMenu } from '@components/horizontalMenu'
import type { SelectTab } from '@components/horizontalMenu'
import { createLazyLoadQueue, type LazyLoadQueue } from '@core/lazyLoadQueue'
import { putPreloader } from '@components/putPreloader'
import ripple from '@components/ripple'
import Section from '@components/section.solid'
import { i18n, type LangPackKey } from '@lib/langPack'
import findUpClassName from '@helpers/dom/findUpClassName'
import { getMiddleware } from '@helpers/middleware'
import ListenerSetter from '@helpers/listenerSetter'
import type SwipeHandler from '@core/dom/swipeHandler'
import handleTabSwipe from '@helpers/dom/handleTabSwipe'
import lockTouchScroll from '@helpers/dom/lockTouchScroll'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import safeAssign from '@helpers/object/safeAssign'
import type { ScrollStartCallbackDimensions } from '@helpers/fastSmoothScroll'
import { createRoot } from 'solid-js'

/**
 * tweb `:111` — фильтр сообщений (`inputMessagesFilterPhotoVideo` и т.п.).
 * В оригинале это алиас `MyInputMessagesFilter` из слоя MTProto; у нас слоя нет,
 * поэтому союз выписан явно теми значениями, которые реально ходят через
 * вкладки правой колонки (`sharedMedia.tsx:604-648`).
 */
export type SearchSuperType =
  'inputMessagesFilterEmpty' |
  'inputMessagesFilterPhotoVideo' |
  'inputMessagesFilterDocument' |
  'inputMessagesFilterUrl' |
  'inputMessagesFilterMusic' |
  'inputMessagesFilterRoundVoice'

/** tweb `:112-124`. `nextRate`/`chatType` приедут с задачей 6 (пагинация). */
export type SearchSuperContext = {
  peerId: string
  inputFilter: { _: SearchSuperType | undefined }
  query?: string
  maxId?: number
  folderId?: number
  threadId?: number
  date?: number
  minDate?: number
  maxDate?: number
}

/** tweb `:126-128` — 16 логических вкладок. */
export type SearchSuperMediaType = 'stories' | 'members' | 'media' |
  'files' | 'links' | 'music' | 'chats' | 'voice' | 'groups' | 'similar' |
  'savedDialogs' | 'saved' | 'channels' | 'apps' | 'gifts' | 'posts'

/**
 * tweb `:129-139` — описание вкладки. Существенное: вкладка НЕСЁТ СВОИ УЗЛЫ и
 * СВОЮ ЗАПОМНЕННУЮ ПОЗИЦИЮ СКРОЛЛА (`scroll`), поэтому переключение вкладок
 * ничего не размонтирует и ничего не теряет.
 */
export type SearchSuperMediaTab = {
  inputFilter?: SearchSuperType
  name: LangPackKey
  type: SearchSuperMediaType
  contentTab?: HTMLElement
  itemsTab?: HTMLElement
  menuTab?: HTMLElement
  menuTabName?: HTMLElement
  scroll?: { scrollTop: number, scrollHeight: number }
  hideOn?: HTMLElement
}

/**
 * tweb `:545-553` — типы, которым НЕ нужна карточка `Section`: они рисуют свою
 * разметку целиком (грид медиа, Solid-вкладки историй/подарков, чатлисты).
 */
const NO_SECTION_TYPES: Set<SearchSuperMediaType> = new Set([
  'stories',
  'media',
  'gifts',
  'chats',
  'channels',
  'apps',
  'posts',
])

export type AppSearchSuperOptions = {
  mediaTabs: SearchSuperMediaTab[]
  /** скроллер приходит СНАРУЖИ: весь профиль скроллится одним контейнером (tweb `:406`) */
  scrollable: Scrollable
  hideEmptyTabs?: boolean
  onChangeTab?: (mediaTab: SearchSuperMediaTab) => void
  scrollOffset?: number
}

export default class AppSearchSuper {
  /** tweb `:357` — «фильтр → узел списка»; по нему рендер ищет, куда класть элементы. */
  public tabs: Partial<Record<SearchSuperType, HTMLElement>> = {}

  public mediaTab!: SearchSuperMediaTab

  public container: HTMLElement
  public nav: HTMLElement
  public navScrollableContainer: HTMLElement
  public tabsContainer: HTMLElement
  public navScrollable: ScrollableX
  private tabsMenu: HTMLElement
  private prevTabId = -1

  private lazyLoadQueue: LazyLoadQueue = createLazyLoadQueue()
  public middleware = getMiddleware()

  /**
   * tweb `:372-373`. Кэш сообщений по фильтру ЖИВЁТ СНАРУЖИ класса (владелец —
   * обвязка правой колонки, `sharedMedia.tsx:33-36`) и переживает и `cleanup()`,
   * и смену пира; класс лишь держит ссылку и помечает, сколько он из кэша уже
   * отрисовал.
   */
  public historyStorage: Partial<Record<SearchSuperType, { mid: number, peerId: string }[]>> = {}
  public usedFromHistory: Partial<Record<SearchSuperType, number>> = {}

  public searchContext!: SearchSuperContext

  public selectTab!: SelectTab
  public mediaTabsMap: Map<SearchSuperMediaType, SearchSuperMediaTab> = new Map()

  private skipScroll?: boolean

  // * arguments
  public mediaTabs!: SearchSuperMediaTab[]
  public scrollable!: Scrollable
  public hideEmptyTabs? = true
  public onChangeTab?: (mediaTab: SearchSuperMediaTab) => void
  public scrollOffset?: number

  /** tweb `:416` — назначается потребителем (`sharedMedia.tsx:682-684`). */
  public scrollStartCallback?: (dimensions: ScrollStartCallbackDimensions) => void

  private listenerSetter: ListenerSetter
  private swipeHandler?: SwipeHandler

  /**
   * tweb `:437` — узел градиента (тот, что `Tabs.MenuGradient` отдаёт наружу,
   * то есть КОНТЕЙНЕР, а не внутренний слой: `tabs.tsx:77-93`). Читается при
   * первом показе вкладок: когда доступна ровно одна вкладка, ряд получает
   * `is-single`, а градиент — `hide` (`tweb:2509-2511` и `:2523-2525`).
   * Обе точки приезжают задачей 10; поле заводится здесь, потому что узел
   * создаётся здесь.
   *
   * `public`, а не `private` как в оригинале: у нас включён `noUnusedLocals`
   * (`web-client/tsconfig.json:32`, в tweb выключен), и приватное поле, которое
   * пока только пишется, но ещё не читается, — ошибка TS6133. Соседние узлы
   * подсистемы (`container`, `nav`, `navScrollableContainer`, `tabsContainer`)
   * и так публичные.
   */
  public menuGradient: HTMLElement

  /** см. расхождение 2 в шапке файла */
  private disposeSections: (() => void)[] = []

  constructor(options: AppSearchSuperOptions) {
    safeAssign(this, options)

    this.container = document.createElement('div')
    this.container.classList.add('search-super')

    this.listenerSetter = new ListenerSetter()

    // tweb `:462-472` — липкий ряд вкладок в горизонтальном скроллере.
    const navScrollableContainer = this.navScrollableContainer = document.createElement('div')
    navScrollableContainer.classList.add('search-super-tabs-scrollable', 'menu-horizontal-scrollable', 'sticky')

    const navScrollable = this.navScrollable = new ScrollableX(navScrollableContainer)
    navScrollable.container.classList.add('search-super-nav-scrollable')

    const nav = this.nav = document.createElement('nav')
    nav.classList.add('search-super-tabs', 'menu-horizontal-div')
    this.tabsMenu = nav

    navScrollable.container.append(nav)

    // tweb `:474-493` — по вкладке на строку: подчёркивание (`i`) идёт ПЕРВЫМ,
    // название — вторым (дамп `07-right-sidebar.json:128-130`: ripple, i, span).
    for(const mediaTab of this.mediaTabs) {
      const menuTab = document.createElement('div')
      menuTab.classList.add('menu-horizontal-div-item')
      const span = document.createElement('span')
      span.classList.add('menu-horizontal-div-item-span')
      const i = document.createElement('i')
      i.classList.add('menu-horizontal-div-item-background')

      span.append(mediaTab.menuTabName = i18n(mediaTab.name))

      menuTab.append(i, span)

      ripple(menuTab)

      this.tabsMenu.append(menuTab)

      this.mediaTabsMap.set(mediaTab.type, mediaTab)

      mediaTab.menuTab = menuTab
    }

    this.tabsContainer = document.createElement('div')
    this.tabsContainer.classList.add('search-super-tabs-container', 'tabs-container')

    // tweb `:498-542` — свайп между вкладками. `unlockScroll` объявлен ЗДЕСЬ,
    // а снимается в `onTransitionEnd` слайдера (`tweb:701-704`): замок держится
    // ровно до конца анимации перехода.
    let unlockScroll: ReturnType<typeof lockTouchScroll> | undefined
    if(IS_TOUCH_SUPPORTED) {
      this.swipeHandler = handleTabSwipe({
        element: this.tabsContainer,
        onSwipe: (xDiff) => {
          xDiff *= -1

          const prevId = this.selectTab.prevId()
          const children = Array.from(this.tabsMenu.children) as HTMLElement[]

          // tweb `:508-515` — у вкладок `gifts`/`stories` своя горизонтальная
          // навигация (коллекции/альбомы), и она перехватывает свайп первой.
          // Обе вкладки приезжают задачами 11-12 вместе со своими `*Actions`.

          // Соседняя СКРЫТАЯ вкладка пропускается: `hide` на строке ряда значит
          // «в этом чате такой вкладки нет» (`tweb:517-531`).
          let idx: number | undefined
          if(xDiff > 0) {
            for(let i = prevId + 1; i < children.length; ++i) {
              if(!children[i].classList.contains('hide')) {
                idx = i
                break
              }
            }
          } else {
            for(let i = prevId - 1; i >= 0; --i) {
              if(!children[i].classList.contains('hide')) {
                idx = i
                break
              }
            }
          }

          if(idx !== undefined) {
            unlockScroll = lockTouchScroll(this.tabsContainer)
            this.selectTab(idx)
          }
        },
        verifyTouchTarget: (e) => {
          return !findUpClassName(e.target, 'scrollable-x')
        },
      })
    }

    // tweb `:554-594` — содержимое вкладок (сам набор `noSectionTypes`,
    // `tweb:545-553`, у нас поднят в модульную константу `NO_SECTION_TYPES`).
    for(const mediaTab of this.mediaTabs) {
      const container = document.createElement('div')
      container.classList.add('search-super-tab-container', 'search-super-container-' + mediaTab.type, 'tabs-tab')

      const content = document.createElement('div')
      content.classList.add('search-super-content-container', 'search-super-content-' + mediaTab.type)

      container.append(content)

      const useSection = !NO_SECTION_TYPES.has(mediaTab.type)
      let itemsContainer = content
      if(useSection) {
        const items = document.createElement('div')
        // Карточка секции создаётся СКРЫТОЙ (`class: 'hide'`) и открывается
        // первым же отрисованным элементом; она же — `mediaTab.hideOn`.
        this.disposeSections.push(createRoot((dispose) => {
          Section({
            noDelimiter: true,
            class: 'hide',
            ref: (ref: HTMLDivElement) => {
              content.append(mediaTab.hideOn = ref)
            },
            children: [items],
          })
          return dispose
        }))
        itemsContainer = items
      } else if(mediaTab.type === 'media') {
        const grid = document.createElement('div')
        grid.classList.add('search-super-content-media-grid')
        content.append(grid)
        itemsContainer = grid
      }

      this.tabsContainer.append(container)

      const { inputFilter } = mediaTab
      if(inputFilter) {
        this.tabs[inputFilter] = itemsContainer
      }

      mediaTab.contentTab = content
      mediaTab.itemsTab = itemsContainer
    }

    // tweb `:596-600` — узел градиента и создаётся, и запоминается в поле прямо
    // в `append`.
    this.container.append(
      this.menuGradient = this.createMenuGradient(),
      navScrollableContainer,
      this.tabsContainer,
    )

    // * construct end

    // tweb `:616-621` — `scrollable.onScrolledBottom` → `this.load(true, undefined, 'bottom')`;
    // догрузка приезжает задачей 6 вместе с самим `load`.

    this.selectTab = horizontalMenu({
      tabs: this.tabsMenu,
      content: this.tabsContainer,
      // tweb `:624-691`
      onClick: (id, _tabContent, animate) => {
        if(this.prevTabId === id && !this.skipScroll) {
          this.scrollToStart()
          return
        }

        const newMediaTab = this.mediaTabs[id]
        this.onChangeTab?.(newMediaTab)

        const fromMediaTab = this.mediaTab
        this.mediaTab = newMediaTab

        if(this.prevTabId !== -1 && animate) {
          this.onTransitionStart()
        }

        if(this.skipScroll) {
          this.skipScroll = false
        } else {
          const offsetTop = this.container.offsetTop - (this.scrollOffset || 0)
          let scrollTop = this.scrollable.scrollPosition
          if(scrollTop < offsetTop) {
            this.scrollToStart()
            scrollTop = offsetTop
          }

          fromMediaTab.scroll = { scrollTop: scrollTop, scrollHeight: this.scrollable.scrollSize }

          if(newMediaTab.scroll === undefined) {
            // Первый заход на вкладку: её «позиция» — не ноль, а расстояние от
            // верха контейнера подсистемы до верха его родителя, иначе новая
            // вкладка улетела бы вверх мимо шапки профиля (`tweb:653-661`).
            const rect = this.container.getBoundingClientRect()
            const rect2 = this.container.parentElement!.getBoundingClientRect()
            const diff = rect.y - rect2.y

            if(scrollTop > diff) {
              newMediaTab.scroll = { scrollTop: diff, scrollHeight: 0 }
            }
          }

          if(newMediaTab.scroll) {
            const diff = fromMediaTab.scroll.scrollTop - newMediaTab.scroll.scrollTop

            if(diff) {
              // Главный трюк подсистемы (`tweb:673`): физически скролл ещё стоит
              // там, где его оставила УХОДЯЩАЯ вкладка, поэтому приходящую на
              // время анимации сдвигают инлайновым `translateY` на разницу
              // позиций — визуально она «стоит на своём месте». Настоящий
              // `scrollPosition` выставляется по концу перехода (`:693-707`).
              newMediaTab.contentTab!.style.transform = `translateY(${diff}px)`
            }
          }
        }

        // tweb `:686-689` — вкладка пуста и это не первый показ → `this.load(true)`;
        // загрузка приезжает задачей 6.

        this.prevTabId = id
      },
      // tweb `:693-707`
      onTransitionEnd: () => {
        this.scrollable.onScroll()

        if(this.mediaTab.scroll !== undefined) {
          this.mediaTab.contentTab!.style.transform = ''
          this.scrollable.scrollPosition = this.mediaTab.scroll.scrollTop
        }

        if(unlockScroll) {
          unlockScroll()
          unlockScroll = undefined
        }

        this.onTransitionEnd()
      },
      scrollableX: navScrollable,
      listenerSetter: this.listenerSetter,
    })

    // tweb `:709-714` — перехват клика при активном выделении; выделение
    // приезжает задачей 14 вместе с `SearchSelection`.
    // tweb `:716-777` — открытие медиавьювера по клику в грид/по документу;
    // приезжает задачей 7 вместе с рендером элементов.

    this.mediaTab = this.mediaTabs[0]

    // tweb `:793-797` — пауза `lazyLoadQueue` на время тяжёлой анимации;
    // см. расхождение 3 в шапке файла.
  }

  /**
   * Градиент, растворяющий содержимое под липким рядом вкладок.
   * Классы — те же, что отдаёт `Tabs.MenuGradient({color: 'background',
   * className: 'search-super-tabs-gradient'})` (`tweb/src/components/tabs.tsx:71-95`),
   * сверено с дампом `07-right-sidebar.json:122-123`. Почему не через фабрику —
   * расхождение 1 в шапке файла.
   */
  private createMenuGradient() {
    const container = document.createElement('div')
    container.classList.add('menu-horizontal-gradient-container', 'search-super-tabs-gradient-container')

    const gradient = document.createElement('div')
    gradient.classList.add(
      'menu-horizontal-gradient',
      'menu-horizontal-gradient-color-background',
      'search-super-tabs-gradient',
    )

    container.append(gradient)
    return container
  }

  /** tweb `:800-807` */
  private scrollToStart() {
    // `void` — наша правка под oxlint (`no-floating-promises`); обещание
    // доводки скролла в оригинале так же никем не ожидается.
    void this.scrollable.scrollIntoViewNew({
      element: this.container,
      position: 'start',
      startCallback: this.scrollStartCallback,
      getElementPosition: this.scrollOffset ?
        ({ elementPosition }) => elementPosition - this.scrollOffset! :
        undefined,
    })
  }

  /** tweb `:809-811` — `sliding` снимает `max-height` с подсистемы на время перехода. */
  private onTransitionStart = () => {
    this.container.classList.add('sliding')
  }

  /** tweb `:813-815` */
  private onTransitionEnd = () => {
    this.container.classList.remove('sliding')
  }

  /**
   * tweb `:2714-2754`. Помечает всё загруженное недействительным, НО САМ КЭШ
   * СООБЩЕНИЙ НЕ ТРЁТ: `usedFromHistory[filter] = -1` значит «из кэша ничего не
   * отрисовано», а не «кэша нет» — вернувшись к тому же пиру, вкладки
   * нарисуются без сети (`tweb:2239-2276`).
   *
   * Не портировано (нечего сбрасывать до своих задач): `loadPromises`/`loaded`/
   * `loadedChats`/`nextRates`/`firstLoad`/`loadFirstTimePromise`/`counters`
   * (`:2715-2721`, `:2745`) — задачи 6 и 10; отмена выделения (`:2735-2737`) —
   * задача 14; состояние участников (`:2749-2753`) — задача 11.
   */
  public cleanup() {
    this.prevTabId = -1

    this.lazyLoadQueue.clear()

    this.mediaTabs.forEach((mediaTab) => {
      const { inputFilter } = mediaTab
      if(!inputFilter) {
        return
      }

      this.usedFromHistory[inputFilter] = -1
    })

    this.middleware.clean()
    this.cleanScrollPositions()
  }

  /**
   * tweb `:2756-2760`. Зовётся СНАРУЖИ при выходе из полноэкранного режима
   * shared media (`sharedMedia.tsx:515`): геометрия поменялась, и запомненные
   * позиции больше ни о чём не говорят.
   */
  public cleanScrollPositions() {
    this.mediaTabs.forEach((mediaTab) => {
      mediaTab.scroll = undefined
    })
  }

  /**
   * tweb `:2762-2793`. Возвращает разметку в состояние «ещё ничего не
   * показывали»: списки пусты, карточки секций снова скрыты, у вкладок без
   * кэша крутится прелоадер, скролл — в начало.
   *
   * `searchGroupMedia.clear()` (`:2791`) пропущен — расхождение 4 в шапке.
   */
  public cleanupHTML() {
    this.mediaTabs.forEach((tab) => {
      tab.itemsTab!.replaceChildren()

      if(tab.hideOn) {
        tab.hideOn.classList.add('hide')
      }

      if(this.hideEmptyTabs) {
        this.container.classList.add('hide')
        this.container.parentElement?.classList.add('search-empty')
      }

      if(tab.type === 'chats') {
        return
      }

      if(tab.inputFilter && !this.historyStorage[tab.inputFilter]) {
        const parent = tab.contentTab!.parentElement!
        if(!parent.querySelector('.preloader')) {
          putPreloader(parent, true)
        }

        const empty = parent.querySelector('.content-empty')
        empty?.remove()
      }
    })

    this.scrollable.scrollPosition = 0
  }

  /**
   * tweb `:2803-2826`. Пересобирает контекст поиска, ПОДМЕНЯЕТ кэш на
   * переданный снаружи (кэш принадлежит обвязке и живёт по пирам) и зовёт
   * `cleanup()`. Загрузку НЕ запускает — это ответственность вызывающего.
   */
  public setQuery({ peerId, query, threadId, historyStorage, folderId, minDate, maxDate }: {
    peerId: string
    query?: string
    threadId?: number
    historyStorage?: AppSearchSuper['historyStorage']
    folderId?: number
    minDate?: number
    maxDate?: number
  }) {
    this.searchContext = {
      peerId,
      query: query || '',
      inputFilter: { _: this.mediaTab.inputFilter },
      threadId,
      folderId,
      minDate,
      maxDate,
    }

    this.historyStorage = historyStorage ?? {}

    this.cleanup()
  }

  /**
   * tweb `:2828-2843`.
   *
   * `this.scrollable.destroy()` — дословно как в оригинале (`:2831`), НО у нас
   * скроллер чужой: см. расхождение 7 в шапке файла (правило «уничтожается
   * только если создан и принадлежит классу» сейчас НЕ соблюдено, развилка —
   * задача 13 плана). `container.remove()` и несброшенный `selectTab` —
   * расхождение 8.
   */
  public destroy() {
    this.cleanup()
    this.listenerSetter.removeAll()
    this.scrollable.destroy()
    this.swipeHandler?.removeListeners()

    // Расхождение 2 в шапке: корни Solid-секций утилизируются, чтобы
    // `destroy()` не оставлял следов.
    this.disposeSections.forEach((dispose) => dispose())
    this.disposeSections.length = 0

    this.container.remove()

    this.scrollStartCallback =
      this.onChangeTab =
      this.swipeHandler =
        undefined
  }
}
