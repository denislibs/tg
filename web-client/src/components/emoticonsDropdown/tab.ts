// Порт tweb `src/components/emoticonsDropdown/tab.ts` (812502980, 539 строк) — база вкладки
// эмодзи-дропдауна (`EmoticonsTabC`): ряд категорий (`.emoticons-menu-wrapper`), прокрутка
// содержимого (`.emoticons-content`), поиск (`EmoticonsSearch`, сдвиг панели `is-searching`),
// категории (`createCategory`/`createLocalCategory`/`positionCategory`/`deleteCategory`),
// отложенные до закрытия панели события (`postponedEvent`), просмотр стикера по зажатию и
// контекстное меню (`attachHelpers`), обложка набора в ряду (`renderStickerSetThumb`) и
// рендерер стикеров (`createStickerRenderer`).
//
// Расхождения:
//  1. Группы эмодзи поиска (`groupFetcher`, `group`/`grouping`, `:66`, `:146-187`) не
//     переносились — групп нет на бэкенде (Б-131); `processSearchResult` получает
//     `grouping: false`.
//  2. `attachStickerViewerListeners` без `getTextColor` — наш просмотрщик не перекрашивает
//     свои эмодзи (`stickerViewer.ts`, расхождение 3 шапки).
//  3. `createStickersContextMenu` без `canHaveEmojiTimer` (расхождение 1 его шапки).
//  4. `renderStickerSetThumb` — наш `wrapStickerSetThumb` (`managers`, без `textColor`/`autoplay`).
//  5. Однократность `init` — флаг `initialized` (у tweb наследник обнуляет метод:
//     `this.init = undefined`/`null`, в строгом TS так нельзя).
import { EMOTICONSSTICKERGROUP, EMOJI_TEXT_COLOR, type EmoticonsDropdown, type EmoticonsTab } from '@components/emoticonsDropdown'
import createStickersContextMenu from '@helpers/dom/createStickersContextMenu'
import positionElementByIndex from '@helpers/dom/positionElementByIndex'
import type { IgnoreMouseOutType } from '@helpers/dropdownHover'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import Animated from '@helpers/solid/animations.solid'
import type { StickerSet } from '@core/managers/stickersManager'
import type { Managers } from '@/client/bootstrap'
import lottieLoader from '@lib/lottie/lottieLoader'
import { i18n, type LangPackKey } from '@lib/langPack'
import { createSignal, createMemo, createResource, createEffect, untrack } from 'solid-js'
import { render, Portal } from 'solid-js/web'
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import Scrollable, { ScrollableX } from '@components/scrollable'
import attachStickerViewerListeners from '@components/stickerViewer'
import type VisibilityIntersector from '@components/visibilityIntersector'
import StickersTabCategory, { type StickersTabStyles } from '@components/emoticonsDropdown/category'
import Tabs from '@components/tabs.solid'
import EmoticonsSearch from '@components/emoticonsDropdown/search.solid'
import wrapStickerSetThumb from '@components/wrappers/stickerSetThumb'
import SuperStickerRenderer from '@components/emoticonsDropdown/tabs/SuperStickerRenderer'
import type { AnimationItemGroup } from '@components/animationIntersector'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tweb `AnyFunction`
type AnyFunction = (...args: any[]) => void
export type MenuOnClickResult = ReturnType<typeof EmoticonsDropdown.menuOnClick>

export default class EmoticonsTabC<Category extends StickersTabCategory<{ element: HTMLElement }, Record<string, HTMLElement>>, T = unknown> implements EmoticonsTab {
  public content: HTMLElement
  public menuScroll?: ScrollableX
  public container: HTMLElement
  public menuWrapper?: HTMLElement
  public menu?: HTMLElement
  public emoticonsDropdown?: EmoticonsDropdown

  protected categories: { [id: string]: Category }
  protected categoriesMap: Map<HTMLElement, Category>
  protected categoriesByMenuTabMap: Map<HTMLElement, Category>
  protected categoriesIntersector!: VisibilityIntersector
  protected categoriesContainer: HTMLElement
  protected localCategories: Category[]

  protected listenerSetter: ListenerSetter

  public scrollable: Scrollable
  protected mounted = false
  protected menuOnClickResult?: MenuOnClickResult

  public tabId!: number
  /** расхождение 5 — `init` уже звали */
  protected initialized = false

  protected postponedEvents: { cb: AnyFunction, args: unknown[] }[]

  public getContainerSize?: Category['getContainerSize']

  public middlewareHelper: MiddlewareHelper
  private disposeSearch?: () => void

  public managers: Managers
  protected noMenu?: boolean
  protected additionalStickerViewerClass?: string
  // * returning the results directly (not a promise) renders them without a repaint gap
  protected searchFetcher?: (value: string) => T | Promise<T>
  protected processSearchResult?: (result: { data: T | undefined, searching: boolean, grouping: boolean }) => Promise<HTMLElement | undefined>
  protected searchNoLoader?: boolean
  protected searchPlaceholder?: LangPackKey
  protected searchType?: Parameters<typeof EmoticonsSearch>[0]['type']
  protected searchDebounceTime?: number
  protected searchVerifyDebounce?: Parameters<typeof EmoticonsSearch>[0]['verifyDebounce']

  constructor(options: {
    managers: Managers
    noMenu?: boolean
    additionalStickerViewerClass?: string
    searchFetcher?: EmoticonsTabC<Category, T>['searchFetcher']
    processSearchResult?: EmoticonsTabC<Category, T>['processSearchResult']
    searchNoLoader?: boolean
    searchPlaceholder?: LangPackKey
    searchType?: Parameters<typeof EmoticonsSearch>[0]['type']
    searchDebounceTime?: number
    searchVerifyDebounce?: EmoticonsTabC<Category, T>['searchVerifyDebounce']
  }) {
    this.managers = options.managers
    this.noMenu = options.noMenu
    this.additionalStickerViewerClass = options.additionalStickerViewerClass
    this.searchFetcher = options.searchFetcher
    this.processSearchResult = options.processSearchResult
    this.searchNoLoader = options.searchNoLoader
    this.searchPlaceholder = options.searchPlaceholder
    this.searchType = options.searchType
    this.searchDebounceTime = options.searchDebounceTime
    this.searchVerifyDebounce = options.searchVerifyDebounce
    this.categories = {}
    this.categoriesMap = new Map()
    this.categoriesByMenuTabMap = new Map()
    this.localCategories = []
    this.postponedEvents = []

    this.listenerSetter = new ListenerSetter()
    this.middlewareHelper = getMiddleware()

    this.container = document.createElement('div')
    this.container.classList.add('tabs-tab', 'emoticons-container')

    if(this.noMenu) {
      this.container.classList.add('no-menu')
    } else {
      this.createMenu()
    }

    this.content = document.createElement('div')
    this.content.classList.add('emoticons-content')

    this.container.append(...[this.menuWrapper, this.content].filter(Boolean) as HTMLElement[])

    this.scrollable = new Scrollable(this.content, 'STICKERS')

    this.categoriesContainer = document.createElement('div')
    this.categoriesContainer.classList.add('emoticons-categories-container')

    if(!this.noMenu) {
      this.scrollable.container.classList.add('emoticons-will-move-up')
      this.categoriesContainer.classList.add('emoticons-will-move-down')
    }

    if(options.searchFetcher) {
      this.createSearch()
    } else {
      this.scrollable.append(this.categoriesContainer)
    }
  }

  public textColor = () => {
    return this.emoticonsDropdown?.textColor?.() || EMOJI_TEXT_COLOR
  }

  private createMenu() {
    this.menuWrapper = document.createElement('div')
    this.menuWrapper.classList.add('menu-wrapper', 'emoticons-menu-wrapper', 'emoticons-will-move-up')

    this.menu = Tabs.Menu({ class: 'no-stripe justify-start emoticons-menu' }) as HTMLElement

    this.menuWrapper.append(this.menu)
    this.menuScroll = new ScrollableX(this.menuWrapper)
  }

  private createSearch() {
    const searchContainer = document.createElement('div')
    searchContainer.classList.add('emoticons-search-container')
    if(!this.noMenu) searchContainer.classList.add('emoticons-will-move-down')
    this.scrollable.append(searchContainer)
    this.categoriesContainer.classList.add('emoticons-has-search')
    const searchFetcher = this.searchFetcher!
    const processSearchResult = this.processSearchResult!
    this.disposeSearch = render(() => {
      const [query, setQuery] = createSignal('')
      const [focused, setFocused] = createSignal(false)
      const searching = createMemo(() => !!query())

      const [loadedData, setLoadedData] = createSignal<T>()
      const [data] = createResource(query, (value) => searchFetcher(value))
      const [element] = createResource(() => {
        return {
          data: loadedData(),
          grouping: false,
          searching: untrack(searching),
        }
      }, processSearchResult)

      const loading = this.searchNoLoader ? undefined : createMemo(() => searching() && element.loading)
      const shouldMoveSearch = createMemo(() => focused() || searching())
      const shouldUseContainer = createMemo(() => element() || this.categoriesContainer)

      Portal({
        mount: this.scrollable.container,
        get children() {
          return Animated({
            type: 'cross-fade',
            get children() {
              return shouldUseContainer()
            },
          })
        },
      })

      createEffect(() => {
        if(data.loading) {
          return
        }

        // * reading a rejected resource throws, which would abort this effect before it
        // * ever sets the data - the previous query's results would stay on screen with no
        // * spinner and no error, making every following query look like it never ran
        setLoadedData(() => data.error === undefined ? data() : undefined)
      })

      createEffect(() => {
        this.container.classList.toggle('is-searching', shouldMoveSearch())
      })

      return EmoticonsSearch({
        type: this.searchType!,
        placeholder: this.searchPlaceholder,
        debounceTime: this.searchDebounceTime,
        verifyDebounce: this.searchVerifyDebounce,
        loading,
        onValue: setQuery,
        onFocusChange: setFocused,
      })
    }, searchContainer)
  }

  public getCategoryByContainer(container: HTMLElement) {
    return this.categoriesMap.get(container)
  }

  public getCategoryByMenuTab(menuTab: HTMLElement) {
    return this.categoriesByMenuTabMap.get(menuTab)
  }

  public createCategory({
    stickerSet,
    id,
    title,
    isLocal,
    noMenuTab = !stickerSet && !id,
    styles,
  }: {
    stickerSet?: StickerSet
    /**
     * Overrides the key the category is filed under. The group's own set needs one of these:
     * keyed by the set id it would fight for the slot with the same set installed by the user,
     * and with the events (install / delete / reorder) that address installed sets by id.
     */
    id?: string
    title?: HTMLElement | DocumentFragment
    isLocal?: boolean
    noMenuTab?: boolean
    styles: StickersTabStyles
  }) {
    if(this.noMenu) {
      noMenuTab = true
    }

    const categoryId = id ?? '' + stickerSet?.id
    const category = new StickersTabCategory({
      id: categoryId,
      title,
      overflowElement: this.content,
      getContainerSize: () => {
        let width: number, height: number | undefined
        if(this.getContainerSize) {
          const size = this.getContainerSize()
          width = size.width
          height = size.height
        } else {
          const element = this.emoticonsDropdown!.getElement()
          const propertyWidth = element.style.getPropertyValue('--width')
          width = propertyWidth ? parseInt(propertyWidth) : element.offsetWidth
        }

        return { width: width - styles.padding, height }
      },
      styles,
      noMenuTab,
      middleware: this.middlewareHelper.get(),
    }) as unknown as Category

    if(styles.itemsClassName) {
      category.elements.items.classList.add(styles.itemsClassName)
    }

    const container = category.elements.container
    container.classList.add('hide')

    if(stickerSet || id) {
      category.set = stickerSet
      this.categories[categoryId] = category
      this.categoriesMap.set(container, category)
      this.categoriesIntersector.observe(container)
    }

    if(!noMenuTab) {
      this.categoriesByMenuTabMap.set(category.elements.menuTab, category)
      this.menuOnClickResult!.stickyIntersector.observeStickyHeaderChanges(container)
      if(!isLocal) category.elements.menuTab.classList.add('not-local')
    }

    return category
  }

  public positionCategory(category: Category, prepend?: boolean) {
    const { menuTab, container } = category.elements
    const posItems = prepend ? this.localCategories.filter((category) => category.mounted).length : 0xFFFF
    let foundMenuScroll = false
    const posMenu = prepend ? this.localCategories.filter((category) => {
      if(category.menuScroll && !foundMenuScroll) {
        foundMenuScroll = true
        return true
      }

      return category.mounted && !category.menuScroll && category.elements.menuTab
    }).length : 0xFFFF
    positionElementByIndex(container, this.categoriesContainer, posItems)
    if(menuTab && this.menu) positionElementByIndex(menuTab, this.menu, posMenu)
    // the DOM move blanks transferred placeholder canvases inside - re-present
    lottieLoader.nudgePresentWithin(container)
  }

  public isCategoryVisible(category: Category) {
    return this.categoriesIntersector.isVisible(category.elements.container)
  }

  protected toggleLocalCategory(category: Category, visible: boolean) {
    if(!visible) {
      category.elements.menuTab?.remove()
      category.elements.container.remove()
    } else {
      const idx = this.localCategories.indexOf(category)
      const sliced = this.localCategories.slice(0, idx)
      let notMountedItems = 0, notMountedMenus = 0
      sliced.forEach((category) => {
        if(!category.mounted) {
          ++notMountedItems
          ++notMountedMenus
        } else if(!category.elements.menuTab || category.menuScroll) {
          ++notMountedMenus
        }
      })
      const itemsIdx = idx - notMountedItems, menuIdx = idx - notMountedMenus
      if(category.elements.menuTab && this.menu) positionElementByIndex(category.elements.menuTab, this.menu, menuIdx)
      positionElementByIndex(category.elements.container, this.categoriesContainer, itemsIdx)
    }

    category.mounted = visible
  }

  protected createLocalCategory({
    id,
    title,
    icon,
    noMenuTab,
    styles,
  }: {
    id?: string
    title: LangPackKey | ''
    icon?: IconName | ''
    noMenuTab?: boolean
    styles: StickersTabStyles
  }) {
    if(this.noMenu) {
      noMenuTab = true
    }

    const hasId = id !== undefined

    const category = this.createCategory({
      stickerSet: hasId ? { id } as unknown as StickerSet : undefined,
      title: title ? i18n(title) : undefined,
      isLocal: true,
      noMenuTab,
      styles,
    })
    category.local = true
    if(hasId) this.localCategories.push(category)
    if(category.elements.title) {
      category.elements.title.classList.add('disable-hover')
    }

    if(category.elements.menuTab) {
      if(icon) {
        category.elements.menuTab.append(Icon(icon))
      }

      category.elements.menuTabPadding.remove()
    }

    this.toggleLocalCategory(category, false)
    return category
  }

  protected onLocalCategoryUpdate(category: Category) {
    category.setCategoryItemsHeight()
    this.toggleLocalCategory(category, !!category.items.length)
  }

  protected resizeCategories = () => {
    for(const category of this.categoriesMap.values()) {
      category.setCategoryItemsHeight()
    }
  }

  protected deleteCategory(category: Category | undefined) {
    if(category) {
      category.elements.container.remove()
      category.elements.menuTab?.remove()
      this.categoriesIntersector.unobserve(category.elements.container)
      // mirrors the observe in createCategory; without it the sticky observer keeps
      // reporting a container that no longer resolves to a category
      this.menuOnClickResult?.stickyIntersector?.unobserve(category.elements.container)
      delete this.categories[category.id]
      this.categoriesMap.delete(category.elements.container)
      this.categoriesByMenuTabMap.delete(category.elements.menuTab)
      category.middlewareHelper.destroy()

      return true
    }

    return false
  }

  protected spliceExceed(category: Category) {
    if(category.limit === undefined) {
      return false
    }

    const { items, limit } = category
    items.splice(limit, items.length - limit).forEach(({ element }) => {
      element.remove()
    })

    this.onLocalCategoryUpdate(category)

    return true
  }

  public init() {
    if(this.emoticonsDropdown) this.listenerSetter.add(this.emoticonsDropdown)('closed', () => {
      this.postponedEvents.forEach(({ cb, args }) => {
        cb(...args)
      })

      this.postponedEvents.length = 0
    })
  }

  public destroy() {
    this.getContainerSize = undefined
    this.postponedEvents.length = 0
    this.categoriesIntersector?.disconnect()
    this.listenerSetter.removeAll()
    this.scrollable.destroy()
    this.menuScroll?.destroy()
    this.menuOnClickResult?.stickyIntersector?.disconnect()
    this.middlewareHelper.destroy()
    this.disposeSearch?.()
  }

  /**
   * Holds an event back until the panel is off screen. The check is `isDisplayed` rather than
   * `isActive`: sending closes the dropdown, which drops the `active` class right away while
   * the panel keeps fading out for another animation frame or two — an update landing in that
   * window would be seen rearranging the panel, which is exactly what postponing avoids.
   */
  protected postponedEvent = <K extends unknown[]>(cb: (...args: K) => void) => {
    return (...args: K) => {
      if(this.emoticonsDropdown?.isDisplayed()) {
        this.postponedEvents.push({ cb: cb as AnyFunction, args })
      } else {
        cb(...args)
      }
    }
  }

  protected attachHelpers({ verifyRecent, isEmojis, isGif, onContextMenu }: {
    verifyRecent?: (target: HTMLElement) => boolean
    isEmojis?: boolean
    isGif?: boolean
    onContextMenu?: Parameters<typeof createStickersContextMenu>[0]['onContextMenu']
  } = {}) {
    attachStickerViewerListeners({
      additionalClass: this.additionalStickerViewerClass,
      listenTo: this.content,
      listenerSetter: this.listenerSetter,
    })

    const type: IgnoreMouseOutType = 'menu'
    const emoticonsDropdown = this.emoticonsDropdown
    if(emoticonsDropdown) createStickersContextMenu({
      listenTo: this.content,
      chatInput: emoticonsDropdown.chatInput,
      verifyRecent,
      isEmojis,
      isGif,
      canViewPack: true,
      onContextMenu,
      onOpen: () => {
        emoticonsDropdown.setIgnoreMouseOut(type, true)
      },
      onClose: () => {
        emoticonsDropdown.setIgnoreMouseOut(type, false)
      },
    })
  }

  protected get animationGroup(): AnimationItemGroup {
    return this.emoticonsDropdown?.animationGroup || EMOTICONSSTICKERGROUP
  }

  // * common methods for tabs

  public renderStickerSetThumb({ set, menuTabPadding, middleware }: {
    set: StickerSet
    menuTabPadding: HTMLElement
    middleware: Middleware
  }) {
    void wrapStickerSetThumb({
      set,
      container: menuTabPadding,
      group: this.animationGroup,
      lazyLoadQueue: this.emoticonsDropdown!.lazyLoadQueue,
      width: 32,
      height: 32,
      managers: this.managers,
      middleware,
    })
  }

  public createStickerRenderer() {
    const superStickerRenderer = new SuperStickerRenderer({
      regularLazyLoadQueue: this.emoticonsDropdown!.lazyLoadQueue,
      group: this.animationGroup,
      intersectionObserverInit: this.emoticonsDropdown!.intersectionOptions,
    })

    const rendererLazyLoadQueue = superStickerRenderer.lazyLoadQueue
    this.emoticonsDropdown!.addLazyLoadQueueRepeat(
      rendererLazyLoadQueue,
      superStickerRenderer.processInvisible,
      this.middlewareHelper.get(),
    )

    return superStickerRenderer
  }
}
