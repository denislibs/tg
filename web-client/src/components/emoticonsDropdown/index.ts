// Порт tweb `src/components/emoticonsDropdown/index.ts` (812502980, 753 строки) —
// `EmoticonsDropdown`: панель эмодзи, стикеров и GIF над строкой ввода (`div.emoji-dropdown`,
// стили — `styles/tweb/_emojiDropdown.scss`). Открытие по наведению/клику на кнопку
// `.toggle-emoticons` строки ввода (`DropdownHover`, `helpers/dropdownHover.ts`), нижний ряд
// вкладок (поиск · эмодзи · стикеры · GIF · стереть), права на стикеры и GIF по чату, переход
// к поиску стикеров/GIF правой колонки (лупа ряда, `:298-308`), стирание символа перед кареткой,
// прокрутка к категории (`menuOnClick`), отправка стикера/GIF (`onMediaClick`/`sendDocId`).
// Синглтон — `emoticonsDropdown` (default), автономные копии (выбор статуса) — `new
// EmoticonsDropdown({tabsToRender})`.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Права: у нас одно `send_media` на стикеры и GIF (`core/peers/rights.ts`) вместо
//     `send_stickers`/`send_gifs`; спрашивает `chat.canSend`, а не `canSendToPeer`.
//  2. Очередь `lazyLoadQueue` — наша `core/lazyLoadQueue` (потолок и «видимые вперёд»), без
//     `lock`/`unlockAndRefresh`: на время анимации открытия запираются только наблюдатели
//     видимости (`animationIntersector`, очереди `addLazyLoadQueueRepeat`).
//  3. `onMediaClick(e, getDocument)` берёт документ ячейки у вкладки (`getDocument`), а
//     `sendDocId` — сам документ (стикер или GIF), не id: наш
//     `ChatInput.sendMessageWithDocument` принимает объект (у tweb — id, документ достаёт менеджер).
//     Отправленный стикер встаёт в «Недавние» событием `sticker_updated` (у tweb его объявляет
//     `appStickersManager.saveRecentSticker` из `sendMessageWithDocument`, `input.ts:4826`).
//  4. `init`-однократность — флаг `inited` базы (расхождение `helpers/dropdownHover.ts`).
import I18n, { type LangPackKey } from '@lib/langPack'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import appImManager from '@lib/appImManager'
import rootScope from '@lib/rootScope'
import animationIntersector, { type AnimationItemGroup } from '@components/animationIntersector'
import { horizontalMenu } from '@components/horizontalMenu'
import { createLazyLoadQueue } from '@core/lazyLoadQueue'
import type Scrollable from '@components/scrollable'
import type { ScrollableX } from '@components/scrollable'
import appSidebarRight from '@components/sidebarRight'
import StickyIntersector from '@components/stickyIntersector'
import EmojiTab, { type EmojiTabCategory } from '@components/emoticonsDropdown/tabs/emoji'
import GifsTab from '@components/emoticonsDropdown/tabs/gifs'
import StickersTab from '@components/emoticonsDropdown/tabs/stickers'
import { MOUNT_CLASS_TO } from '@config/debug'
import { AppGifsTab, AppStickersTab } from '@components/solidJsTabs/tabs'
import findUpClassName from '@helpers/dom/findUpClassName'
import findUpTag from '@helpers/dom/findUpTag'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import whichChild from '@helpers/dom/whichChild'
import cancelEvent from '@helpers/dom/cancelEvent'
import DropdownHover from '@helpers/dropdownHover'
import type { Managers } from '@/client/bootstrap'
import { startClient } from '@/client/bootstrap'
import { attachClickEvent, simulateClickEvent } from '@helpers/dom/clickEvent'
import overlayCounter from '@helpers/overlayCounter'
import { getAppWindow, getOverlayRoot } from '@helpers/appWindow'
import noop from '@helpers/noop'
import { FocusDirection, type ScrollOptions } from '@helpers/fastSmoothScroll'
import BezierEasing from '@lib/spoiler/bezierEasing'
import RichInputHandler from '@helpers/dom/richInputHandler'
import { getCaretPosF } from '@helpers/dom/getCaretPosNew'
import ListenerSetter from '@helpers/listenerSetter'
import type { ChatRights } from '@core/peers/rights'
import { toastNew } from '@components/toast'
import type ChatInput from '@components/chat/input'
import { POSTING_NOT_ALLOWED_MAP } from '@components/chat/input'
import Tabs from '@components/tabs.solid'
import type StickersTabCategory from '@components/emoticonsDropdown/category'
import type { Middleware } from '@helpers/middleware'
import type LazyLoadQueueRepeat from '@components/lazyLoadQueueRepeat'
import type { Sticker } from '@core/managers/stickersManager'
import type { GifItem } from '@core/gifs'
import type { IconName } from '@core/tgico-icons'
import { type Accessor, createSignal, type Setter } from 'solid-js'

export const EMOTICONSSTICKERGROUP: AnimationItemGroup = 'emoticons-dropdown'

export interface EmoticonsTab {
  content: HTMLElement
  scrollable: Scrollable
  menuScroll?: ScrollableX
  tabId: number
  init: () => unknown
  onOpen?: () => void
  onOpened?: () => void
  onClose?: () => void
  onClosed?: () => void
  onPeerChanged?: () => void
}

type EmoticonsTabWithDropdown = EmoticonsTab & {
  container: HTMLElement
  emoticonsDropdown?: EmoticonsDropdown
  destroy?: () => void
  init?: () => unknown
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tweb `EmoticonsTabConstructable`
export type EmoticonsTabConstructable<T extends EmoticonsTab = EmoticonsTab> = abstract new(...args: any[]) => T

/** Вкладка с категориями и рядом категорий — то, что умеет `menuOnClick` (эмодзи и стикеры) */
type CategorizedTab = {
  scrollable: Scrollable
  menuScroll?: ScrollableX
  content: HTMLElement
  container: HTMLElement
  getCategoryByContainer(container: HTMLElement): StickersTabCategory<{ element: HTMLElement }> | undefined
  getCategoryByMenuTab(menuTab: HTMLElement): StickersTabCategory<{ element: HTMLElement }> | undefined
}

const easing = BezierEasing(0.42, 0.0, 0.58, 1.0)
const scrollOptions: Partial<ScrollOptions> = {
  forceDuration: 150,
  transitionFunction: easing,
  maxDistance: 150,
}
const renderEmojiDropdownElement = (): HTMLDivElement => {
  const div = document.createElement('div')
  const d = document.createElement('div')
  d.classList.add('emoji-dropdown')
  d.style.display = 'none'
  const emojiContainer = document.createElement('div')
  emojiContainer.classList.add('emoji-container')
  const tabsContainer = document.createElement('div')
  tabsContainer.classList.add('tabs-container')
  emojiContainer.append(tabsContainer)
  d.append(emojiContainer)
  div.append(d)
  // the first word of `className` names the tab, the rest are extra classes on it
  const a: [string, IconName, number, LangPackKey][] = [
    ['search justify-self-start', 'search', -1, 'Search'],
    ['emoji', 'smile', 0, 'Emoji'],
    ['stickers', 'stickers_face', 1, 'AccDescr.Stickers'],
    ['gifs', 'gifs', 2, 'AccDescr.Gifs'],
    ['delete justify-self-end', 'deleteleft', -1, 'AccDescr.DeleteLastCharacter'],
  ]
  const menu = Tabs.Menu({ class: 'emoji-tabs emoticons-menu no-stripe' }) as HTMLElement
  menu.append(...a.map(([className, icon, tabId, ariaLabel]) => Tabs.MenuIconTab({
    icon,
    class: `emoji-tabs-${className}`,
    tab: tabId,
    label: I18n.format(ariaLabel, true),
  })))
  d.append(menu)
  return d
}

export const EMOJI_TEXT_COLOR = 'primary-text-color'

export class EmoticonsDropdown extends DropdownHover {
  public lazyLoadQueue = createLazyLoadQueue(1)

  private container!: HTMLElement
  private tabsEl!: HTMLElement
  private tabId = -1

  private tabs!: { [id: number]: EmoticonsTabWithDropdown }

  private searchButton!: HTMLElement
  private deleteBtn!: HTMLElement

  private selectTab!: ReturnType<typeof horizontalMenu>

  private savedRange?: Range
  private tabsToRender: EmoticonsTabWithDropdown[] = []
  private managers?: Managers

  private rights: { [action in ChatRights]?: boolean }

  private listenerSetter: ListenerSetter

  private _chatInput?: ChatInput
  public textColor: Accessor<string>
  private _setTextColor: Setter<string>

  public isStandalone: boolean

  public animationGroup: AnimationItemGroup

  constructor(options: {
    customParentElement?: HTMLElement | (() => HTMLElement)
    getOpenPosition?: () => { top: number, left: number }
    tabsToRender?: EmoticonsTabWithDropdown[]
    animationGroup?: AnimationItemGroup
    suppressOutClick?: boolean
  } = {}) {
    super({
      element: renderEmojiDropdownElement(),
      ignoreOutClickClassName: 'input-message-input',
    })
    if(options.tabsToRender) this.tabsToRender = options.tabsToRender
    this.suppressOutClick = options.suppressOutClick

    ;[this.textColor, this._setTextColor] = createSignal(EMOJI_TEXT_COLOR)

    this.listenerSetter = new ListenerSetter()
    this.isStandalone = !!options?.tabsToRender
    this.element.classList.toggle('is-standalone', this.isStandalone)
    this.animationGroup = options.animationGroup || EMOTICONSSTICKERGROUP

    this.rights = {
      send_media: this.isStandalone || undefined,
    }

    this.addEventListener('open', () => {
      if(IS_TOUCH_SUPPORTED) {
        blurActiveElement()
      }

      if(options.getOpenPosition) {
        const rect = options.getOpenPosition()
        this.element.style.setProperty('--top', rect.top + 'px')
        this.element.style.setProperty('--left', rect.left + 'px')
      }

      if(options.customParentElement) {
        const c = options.customParentElement
        const parent = typeof(c) === 'function' ? c() : c
        parent.append(this.element)
      } else if(this.element.parentElement !== this.chatInput.chatInput) {
        this.chatInput.chatInput.append(this.element)
      }

      this.savedRange = this.getGoodRange()

      animationIntersector.lockIntersectionGroup(this.animationGroup)

      const tab = this.tab
      tab.onOpen?.()
    })

    this.addEventListener('opened', () => {
      animationIntersector.unlockIntersectionGroup(this.animationGroup)

      const tab = this.tab
      tab.onOpened?.()
    })

    this.addEventListener('openAfterLayout', () => {
      if(options.getOpenPosition) {
        this.element.style.setProperty('--width', this.element.offsetWidth + 'px')
      }
    })

    this.addEventListener('close', () => {
      // нужно залочить группу и выключить стикеры
      animationIntersector.lockIntersectionGroup(this.animationGroup)
      animationIntersector.checkAnimations(true, this.animationGroup)

      const tab = this.tab
      tab.onClose?.()
    })

    this.addEventListener('closed', () => {
      // теперь можно убрать visible, чтобы они не включились после фокуса
      animationIntersector.unlockIntersectionGroup(this.animationGroup)

      this.savedRange = undefined

      const tab = this.tab
      tab.onClosed?.()
    })
  }

  public canUseEmoji(emoji: AppEmoji, showToast?: boolean) {
    this.ensureInit()
    return this.getTab(EmojiTab)!.canUseEmoji(emoji, undefined, showToast)
  }

  private ensureInit() {
    if(!this.inited) {
      this.inited = true
      this.init()
    }
  }

  public get tab() {
    return this.tabs[this.tabId]
  }

  public get chatInput(): ChatInput {
    return this._chatInput || appImManager.chat?.input
  }

  public set chatInput(chatInput: ChatInput) {
    const changed = this._chatInput !== chatInput
    this._chatInput = chatInput
    if(changed && this.chatInput !== undefined) {
      void this.checkRights()
    }
  }

  public get intersectionOptions(): IntersectionObserverInit {
    return { root: this.getElement() }
  }

  public setTextColor(textColor: string = EMOJI_TEXT_COLOR) {
    this._setTextColor(textColor)
  }

  public getTab<T extends EmoticonsTab>(instance: EmoticonsTabConstructable<T>) {
    return this.tabsToRender.find((tab) => tab instanceof instance) as T | undefined
  }

  public init() {
    this.managers = startClient().managers

    if(!this.tabsToRender.length) {
      this.tabsToRender = [
        new EmojiTab({ managers: this.managers, preloaderDelay: 200 }),
        new StickersTab(this.managers),
        new GifsTab({ managers: this.managers }),
      ]
    }

    this.tabs = {}
    this.tabsToRender.forEach((tab, idx) => {
      tab.emoticonsDropdown = this
      tab.tabId = idx
      this.tabs[idx] = tab
    })

    this.container = this.element.querySelector('.emoji-container .tabs-container') as HTMLDivElement
    this.container.prepend(...this.tabsToRender.map((tab) => tab.container))
    this.tabsEl = this.element.querySelector('.emoji-tabs') as HTMLElement

    this.selectTab = horizontalMenu({
      tabs: this.tabsEl,
      content: this.container,
      onClick: this.onSelectTabClick,
      onTransitionEnd: () => {
        const { tab } = this
        tab.init?.()
        animationIntersector.checkAnimations(false, this.animationGroup)
      },
    })

    this.searchButton = this.element.querySelector('.emoji-tabs-search')!
    this.listenerSetter.add(this.searchButton)('click', () => {
      if(this.tabId === this.getTab(StickersTab)?.tabId) {
        if(!appSidebarRight.isTabExists(AppStickersTab)) {
          void appSidebarRight.createTab(AppStickersTab).open()
        }
      } else {
        if(!appSidebarRight.isTabExists(AppGifsTab)) {
          void appSidebarRight.createTab(AppGifsTab).open()
        }
      }
    })

    this.deleteBtn = this.element.querySelector('.emoji-tabs-delete')!
    attachClickEvent(this.deleteBtn, (e) => {
      cancelEvent(e)
      const input = this.chatInput.messageInput
      let range = RichInputHandler.getInstance().getSavedRange(input)
      if(!range) {
        if(!input.lastChild) {
          return
        }

        range = input.ownerDocument.createRange()
        range.setStartAfter(input.lastChild)
      }

      const newRange = range.cloneRange()
      if(range.collapsed) {
        const { node, offset } = getCaretPosF(input, range.endContainer, range.endOffset)
        let newStartNode: Node | null
        if(offset) {
          newStartNode = node ?? null
        } else {
          newStartNode = node?.previousSibling ?? null
          if(!newStartNode) {
            return
          }

          while(newStartNode && newStartNode.nodeType === newStartNode.TEXT_NODE && !newStartNode.nodeValue && (newStartNode = newStartNode.previousSibling)) {
            // skip empty text nodes
          }

          if(!newStartNode) {
            return
          }

          if(newStartNode.nodeType === newStartNode.ELEMENT_NODE && !(newStartNode as HTMLElement).isContentEditable) {
            return
          }
        }

        if(!newStartNode) {
          return
        }

        if(newStartNode.nodeType === newStartNode.ELEMENT_NODE && (newStartNode as HTMLElement).tagName === 'IMG') {
          newRange.selectNode(newStartNode)
        } else {
          // eslint-disable-next-line typescript/no-misused-spread -- tweb `:400`: по кодпоинтам
          const text = [...(newStartNode.textContent || '')]
          let t: string
          if(offset) {
            let length = 0
            t = text.find((text) => (length += text.length, length >= offset)) || ''
          } else {
            t = text.pop() || ''
          }

          const newOffset = offset ? offset - t.length : (newStartNode.textContent || '').length - t.length
          newRange.setStart(newStartNode, newOffset)
        }
      }

      newRange.deleteContents()

      this.chatInput.messageInputField.simulateInputEvent()
    }, { listenerSetter: this.listenerSetter })

    const INIT_TAB_ID = this.getTab(EmojiTab)?.tabId ?? this.tabsToRender[0]?.tabId ?? 0

    simulateClickEvent(this.tabsEl.children[INIT_TAB_ID + 1] as HTMLElement)
    if(this.tabsToRender.length <= 1) {
      this.tabsEl.classList.add('hide')
    }
    this.tabs[INIT_TAB_ID].init?.() // onTransitionEnd не вызовется, т.к. это первая открытая вкладка

    if(!IS_TOUCH_SUPPORTED) {
      let lastMouseMoveEvent: MouseEvent | undefined, mouseMoveTarget: HTMLElement | undefined
      const onMouseMove = (e: MouseEvent) => {
        lastMouseMoveEvent = e
      }
      this.listenerSetter.add(overlayCounter)('change', (isActive: boolean) => {
        if(isActive) {
          if(!mouseMoveTarget) {
            // Bind to the active app window's body (PiP-aware) and keep the exact reference so the
            // matching remove below targets the same element even if the active window changed.
            mouseMoveTarget = getOverlayRoot()
            this.listenerSetter.add(mouseMoveTarget)('mousemove', onMouseMove)
          }
        } else if(mouseMoveTarget) {
          this.listenerSetter.removeManual(mouseMoveTarget, 'mousemove', onMouseMove)
          mouseMoveTarget = undefined
          if(lastMouseMoveEvent) {
            this.onMouseOut(lastMouseMoveEvent)
          }
        }
      })
    }

    const onPeerChanging = () => {
      if(this._chatInput || this.isStandalone) {
        return
      }

      void this.toggle(false)
    }

    const onPeerChanged = () => {
      // tabs track per-chat content (the group's own sticker set), so they are told
      // about the switch even when the dropdown itself is pinned to one chat input
      this.tabsToRender.forEach((tab) => tab.onPeerChanged?.())

      if(this._chatInput || this.isStandalone) {
        return
      }

      void this.checkRights()
    }

    this.listenerSetter.add(appImManager)('peer_changing', onPeerChanging)
    this.listenerSetter.add(appImManager)('peer_changed', onPeerChanged)
    onPeerChanged()

    return super.init()
  }

  public getElement() {
    return this.element
  }

  public scrollTo(tab: EmoticonsTab, element: HTMLElement) {
    void tab.scrollable.scrollIntoViewNew({
      element: element as HTMLElement,
      axis: 'y',
      position: 'start',
      getElementPosition: tab.scrollable.container === element ? () => -element.scrollTop : undefined,
      ...scrollOptions,
    })
  }

  private onSelectTabClick = (id: number) => {
    if(this.tabId === id) {
      const { tab } = this
      this.scrollTo(tab, tab.scrollable.container as HTMLElement)
      return
    }

    const stickersTab = this.getTab(StickersTab), gifsTab = this.getTab(GifsTab)
    const rights: { [tabId: number]: ChatRights } = {
      ...(stickersTab && { [stickersTab.tabId]: 'send_media' }),
      ...(gifsTab && { [gifsTab.tabId]: 'send_media' }),
    }

    const action = rights[id]
    if(action && !this.rights[action]) {
      toastNew({ langPackKey: POSTING_NOT_ALLOWED_MAP[action]! })
      return false
    }

    animationIntersector.checkAnimations(true, this.animationGroup)

    this.tabId = id
    this.searchButton.classList.toggle('hide', this.tabId === this.getTab(EmojiTab)?.tabId)
    this.deleteBtn.classList.toggle('hide', this.tabId !== this.getTab(EmojiTab)?.tabId)
  }

  private checkRights = async() => {
    const { chat } = this.chatInput

    const actions = Object.keys(this.rights) as ChatRights[]

    const rights = await Promise.all(actions.map((action) => {
      return chat.canSend(action)
    }))

    actions.forEach((action, idx) => {
      this.rights[action] = rights[idx]
    })

    if(!this.inited) {
      return
    }

    const emojiTab = this.getTab(EmojiTab)
    const active = this.tabsEl.querySelector('.active')
    if(emojiTab && active && whichChild(active) !== (emojiTab.tabId + 1) && !this.rights.send_media) {
      this.selectTab(emojiTab.tabId, false)
    }

    emojiTab?.toggleCustomCategory()
  }

  public static menuOnClick = (
    emoticons: CategorizedTab,
    menu: HTMLElement,
    scrollable: Scrollable,
    menuScroll?: ScrollableX,
    prevTab?: StickersTabCategory<{ element: HTMLElement }>,
    listenerSetter?: ListenerSetter,
  ) => {
    let jumpedTo = -1

    const scrollToTab = (tab: StickersTabCategory<{ element: HTMLElement }>, f?: boolean) => {
      const m = tab.menuScroll || menuScroll
      if(m) {
        void m.scrollIntoViewNew({
          element: tab.elements.menuTab,
          position: 'center',
          axis: 'x',
          getElementPosition: f ? ({ elementPosition }) => {
            return elementPosition - 106
          } : undefined,
          ...scrollOptions,
        })
      }
    }

    const setActive = (tab: StickersTabCategory<{ element: HTMLElement }>, scroll = true) => {
      if(tab === prevTab) {
        return false
      }

      let f = false
      if(prevTab) {
        prevTab.elements.menuTab.classList.remove('active')
        if(prevTab.menuScroll && prevTab.menuScroll !== tab.menuScroll) {
          f = true
          // scroll to first
          prevTab.menuScroll.container.parentElement!.classList.remove('active')
          void prevTab.menuScroll.scrollIntoViewNew({
            element: prevTab.menuScroll.firstElementChild as HTMLElement,
            forceDirection: scroll ? undefined : FocusDirection.Static,
            position: 'center',
            axis: 'x',
            ...scrollOptions,
          })
        }
      }

      tab.elements.menuTab.classList.add('active')

      if(tab.menuScroll) {
        tab.menuScroll.container.parentElement!.classList.add('active')
        if(scroll && menuScroll) void menuScroll.scrollIntoViewNew({
          element: tab.menuScroll.container.parentElement!,
          position: 'center',
          axis: 'x',
          ...scrollOptions,
        })
      }

      if(prevTab) {
        scrollToTab(tab, f)
      }

      prevTab = tab

      return true
    }

    const setActiveStatic = (tab: StickersTabCategory<{ element: HTMLElement }>) => {
      if(prevTab?.local) {
        return
      }

      emoticons.scrollable.scrollPosition = tab.elements.container.offsetTop + 1
      const s = emoticons.menuScroll!.container
      const e = tab.elements.menuTab
      s.scrollLeft = e.offsetLeft - s.clientWidth / 2 + e.offsetWidth / 2
      setActive(tab, false)
    }

    let scrollingToContent = false
    const stickyIntersector = new StickyIntersector(scrollable.container, (stuck, target) => {
      if(scrollingToContent) {
        return
      }

      if(Math.abs(jumpedTo - scrollable.scrollPosition) <= 1) {
        return
      } else {
        jumpedTo = -1
      }

      const tab = emoticons.getCategoryByContainer(target)
      // the entry may describe a category deleted since the observer queued it
      if(!tab?.elements.menuTab) {
        return
      }

      const which = whichChild(target)
      if(!stuck && (which || tab.menuScroll)) {
        return
      }

      setActive(tab)
    })

    attachClickEvent(menu, (e) => {
      cancelEvent(e)
      let target = findUpClassName(e.target as HTMLElement, 'menu-horizontal-div-item')
      if(!target) {
        target = findUpClassName(e.target as HTMLElement, 'menu-horizontal-inner')
        if(!target || target.classList.contains('active')) {
          return
        }

        target = target.firstElementChild!.firstElementChild as HTMLElement
      }

      const which = whichChild(target)

      const tab = emoticons.getCategoryByMenuTab(target)
      if(!tab) {
        return
      }

      setActive(tab)

      let offsetTop = 0, additionalOffset = 0
      if(which > 0 || tab.menuScroll) {
        const element = tab.elements.container
        additionalOffset = 1
        offsetTop = element.offsetTop + additionalOffset // * due to stickyIntersector
      }

      jumpedTo = offsetTop

      scrollingToContent = true
      void scrollable.scrollIntoViewNew({
        element: offsetTop ? tab.elements.container : scrollable.firstElementChild as HTMLElement,
        position: 'start',
        axis: 'y',
        getElementPosition: offsetTop ? ({ elementPosition }) => elementPosition + additionalOffset : undefined,
        startCallback: () => {
          if(emoticons instanceof EmojiTab && !emoticons.isCategoryVisible(tab as unknown as EmojiTabCategory)) {
            emoticons._onCategoryVisibility(tab as unknown as EmojiTabCategory, true)
          }
        },
        ...scrollOptions,
      }).finally(() => {
        setActive(tab)
        scrollingToContent = false
      })
    }, { listenerSetter })

    const a = scrollable.onAdditionalScroll ? scrollable.onAdditionalScroll.bind(scrollable) : noop
    scrollable.onAdditionalScroll = () => {
      emoticons.content.parentElement!.classList.toggle('no-border-top',
        scrollable.scrollPosition <= 0 ||
        emoticons.container.classList.contains('is-searching'),
      )
      a()
    }

    emoticons.content.parentElement!.classList.add('no-border-top')

    return { stickyIntersector, setActive, setActiveStatic }
  }

  public onMediaClick = async(e: { target: EventTarget | null }, getDocument: (docId: string) => Sticker | GifItem | undefined) => {
    const target = findUpTag(e.target as HTMLElement, 'DIV')
    if(!target) return false

    const docId = target.dataset.docId
    if(!docId) return false

    const document = getDocument(docId)
    if(!document) return false

    return this.sendDocId({ document, target })
  }

  public async sendDocId(options: { document: Sticker | GifItem, target?: HTMLElement }) {
    if(await this.chatInput.sendMessageWithDocument(options)) {
      if('_' in options.document) {
        rootScope.dispatchEvent('sticker_updated', { type: 'recent', document: options.document, faved: true })
      }

      if(emoticonsDropdown.container) {
        emoticonsDropdown.forceClose = true
        void emoticonsDropdown.toggle(false)
      }

      return true
    } else {
      return false
    }
  }

  public addLazyLoadQueueRepeat(lazyLoadQueue: Pick<LazyLoadQueueRepeat, 'intersector' | 'lock' | 'unlockAndRefresh'>, processInvisibleDiv: (div: HTMLElement) => void, middleware: Middleware) {
    const listenerSetter = new ListenerSetter()
    listenerSetter.add(this)('close', () => {
      lazyLoadQueue.lock()
    })

    listenerSetter.add(this)('closed', () => {
      const divs = lazyLoadQueue.intersector.getVisible()

      // the sweep demolishes hidden cells synchronously: visibility is cleared first
      lazyLoadQueue.intersector.clearVisible()

      for(const div of divs) {
        processInvisibleDiv(div)
      }
    })

    listenerSetter.add(this)('opened', () => {
      lazyLoadQueue.unlockAndRefresh()
    })

    middleware.onClean(() => {
      listenerSetter.removeAll()
    })
  }

  public getSavedRange() {
    return this.getGoodRange() || this.savedRange
  }

  private getGoodRange() {
    const sel = getAppWindow().getSelection()
    if(sel?.rangeCount && getAppWindow().document.activeElement === this.chatInput?.messageInput) {
      return sel.getRangeAt(0)
    }
  }

  public destroy() {
    this.cleanup()
    this.listenerSetter.removeAll()
    this.tabsToRender.forEach((tab) => tab.destroy?.())
    this.element.remove()
  }

  public hideAndDestroy() {
    return this.toggle(false).then(() => {
      return this.destroy()
    })
  }
}

const emoticonsDropdown = new EmoticonsDropdown()
MOUNT_CLASS_TO.emoticonsDropdown = emoticonsDropdown
export default emoticonsDropdown
