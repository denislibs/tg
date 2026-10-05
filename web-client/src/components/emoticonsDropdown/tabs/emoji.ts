// Порт tweb `src/components/emoticonsDropdown/tabs/emoji.ts` (812502980, 1298 строк) — вкладка
// эмодзи: категории юникод-эмодзи (`config/emoji.ts`), «Недавние» и «Недавние свои», наборы своих
// эмодзи (`stickerSet.pFlags.emojis`), поиск по ключевым словам, выбор тона кожи по ПКМ, вставка
// в поле ввода (`ChatInput.onEmojiSelected`) и замок своих эмодзи без Premium (`canUseEmoji`).
// `appendEmoji`/`getEmojiFromElement` — общие с автокомплитом эмодзи (как у оригинала).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Набор своих эмодзи группы (`GroupSetController`, `groupSet.ts`/`groupSetSection.ts`, вызовы
//     `initGroupSet`/`renderGroupSet`/`onPeerChanged`) не портирован — у чатов нет своего набора
//     (`channelFull.emojiset`) на бэкенде (Б-132).
//  2. Группы поиска (`groupFetcher`, `searchCustomEmoji`) — нет групп эмодзи на бэкенде (Б-131).
//  3. Опции без потребителя у нас не переносились: `additionalSets`, `additionalLocalStickerSet`
//     (`renderLocalStickerSet`), `searchFetcher` снаружи, `noSearchGroups`, `canHaveEmojiTimer`,
//     `canUsePremiumEmojiAlways`, `additionalStickerViewerClass` — их задают реакции, статус с
//     документом и прочие вызывающие tweb, которых у нас нет.
//  4. Рендерер своих эмодзи — без общего холста (`lib/customEmoji/renderer.ts`, расхождение 1):
//     ветки `clearCanvas`, `setDimensionsFromRect`/`ignoreSettingDimensions` (`toggleRenderers`)
//     и `forceRender` после перестановки нет — медиа живёт в самом узле.
//  5. `stickers_top` (`continueInit`) — события нет: порядок наборов приходит только списком.
//  6. Ссылка «Подробнее» тоста без Premium открывает наш попап Premium
//     (`settingsPopups.showPremiumPopup`), а не бот (`appImManager.openPremiumBot`).
//  7. `showLocks` (замок поверх своих эмодзи без Premium) не задаётся никем — не перенесён.
import type { MyDocument } from '@core/media/messageMedia'
import type { StickerSet } from '@core/managers/stickersManager'
import type { Managers } from '@/client/bootstrap'
import { EmoticonsDropdown } from '@components/emoticonsDropdown'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import { fastRaf } from '@helpers/schedulers'
import pause from '@helpers/schedulers/pause'
import { i18n, type LangPackKey } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import { emojiFromCodePoints } from '@vendor/emoji'
import { putPreloader } from '@components/putPreloader'
import { ScrollableX } from '@components/scrollable'
import IS_EMOJI_SUPPORTED from '@environment/emojiSupport'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import Emoji from '@config/emoji'
import fixEmoji from '@lib/richtext/fixEmoji'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import wrapSingleEmoji from '@lib/richtext/wrapSingleEmoji'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import VisibilityIntersector, { type OnVisibilityChangeItem } from '@components/visibilityIntersector'
import mediaSizes from '@helpers/mediaSizes'
import findAndSplice from '@helpers/array/findAndSplice'
import findAndSpliceAll from '@helpers/array/findAndSpliceAll'
import positionElementByIndex from '@helpers/dom/positionElementByIndex'
import showStickersPopup from '@components/popups/stickers.bridge'
import { hideToast, toastNew } from '@components/toast'
import liteMode from '@helpers/liteMode'
import CustomEmojiElement from '@lib/customEmoji/element'
import { CustomEmojiRendererElement } from '@lib/customEmoji/renderer'
import type { CustomEmojiElements } from '@lib/customEmoji/element'
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import anchorCallback from '@helpers/dom/anchorCallback'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import { onCleanup } from 'solid-js'
import StickersTabCategory, { EmoticonsTabStyles } from '@components/emoticonsDropdown/category'
import Tabs from '@components/tabs.solid'
import EmoticonsTabC from '@components/emoticonsDropdown/tab'
import { useChatsStore } from '@stores/chatsStore'
import appEmojiManager from '@lib/appManagers/appEmojiManager'
import {
  type EmojiSkinTone,
  getEmojiSkinTone,
  getEmojiSkinToneVariants,
} from '@helpers/emojiSkinTone'
import showEmojiTonePicker from '@components/emoticonsDropdown/emojiTonePicker.solid'

export { EMOJI_ELEMENT_SIZE } from '@components/emoticonsDropdown/category'

const loadedURLs: Set<string> = new Set()
export function appendEmoji(_emoji: AppEmoji, unify = false) {
  if(_emoji.docId) {
    const customEmojiElement = CustomEmojiElement.create(_emoji.docId)
    // у tweb его ставит `wrapSticker` по документу (`isCustomEmoji`); наш рендерер документа не
    // знает (расхождение 3 рендерера) — эмодзи известен здесь, а у недавних своих — доставит рендерер
    if(_emoji.emoji) customEmojiElement.dataset.stickerEmoji = _emoji.emoji
    const spanEmoji = document.createElement('span')
    spanEmoji.classList.add('super-emoji', 'super-emoji-custom')
    spanEmoji.dataset.emoji = _emoji.emoji || ''
    spanEmoji.append(customEmojiElement)
    return spanEmoji
  }

  let { emoji } = _emoji
  const spanEmoji = document.createElement('span')
  spanEmoji.classList.add('super-emoji', 'super-emoji-regular')
  spanEmoji.dataset.emoji = emoji

  let el: DocumentFragment
  if(unify && !IS_EMOJI_SUPPORTED) {
    el = wrapSingleEmoji(emoji)
  } else {
    emoji = fixEmoji(emoji)
    el = wrapEmojiText(emoji)
  }

  spanEmoji.append(el)

  if(spanEmoji.children.length > 1) {
    const first = spanEmoji.firstElementChild!
    spanEmoji.replaceChildren(first)
  }

  if(spanEmoji.firstElementChild?.tagName === 'IMG') {
    const image = spanEmoji.firstElementChild as HTMLImageElement

    const url = image.src
    if(!loadedURLs.has(url)) {
      image.setAttribute('loading', 'lazy')
      const placeholder = document.createElement('span')
      placeholder.classList.add('emoji-placeholder')

      if(liteMode.isAvailable('animations')) {
        image.style.opacity = '0'
        placeholder.style.opacity = '1'
      }

      image.addEventListener('load', () => {
        fastRaf(() => {
          if(liteMode.isAvailable('animations')) {
            image.style.opacity = ''
            placeholder.style.opacity = ''
          }

          spanEmoji.classList.remove('empty')

          loadedURLs.add(url)
        })
      }, { once: true })

      spanEmoji.append(placeholder)
    }
  }

  return spanEmoji
}

export function getEmojiFromElement(element: HTMLElement): { docId?: DocId, emoji: string } | undefined {
  const superEmoji = findUpClassName(element, 'super-emoji')
  if(!superEmoji) return

  const firstElementChild = superEmoji.firstElementChild as HTMLElement
  if(firstElementChild && firstElementChild.classList.contains('custom-emoji')) {
    return { emoji: firstElementChild.dataset.stickerEmoji!, docId: firstElementChild.dataset.docId }
  } else {
    if(element.nodeType === element.TEXT_NODE) return { emoji: element.nodeValue! }
    if(element.tagName === 'SPAN' && !element.classList.contains('emoji') && element.firstElementChild) {
      element = element.firstElementChild as HTMLElement
    }

    return { emoji: element.getAttribute('alt') || element.innerText }
  }
}

type EmojiCategoryDescriptor = [LangPackKey | '', IconName | '']

const EMOJI_RECENT_ID: EmojiCategoryDescriptor[0] = 'Emoji.Recent'
const EMOJI_RECENT_CATEGORY: EmojiCategoryDescriptor = [EMOJI_RECENT_ID, 'recent']
const CUSTOM_EMOJI_RECENT_ID: EmojiCategoryDescriptor[0] = ''
const CUSTOM_EMOJI_RECENT_CATEGORY: EmojiCategoryDescriptor = [CUSTOM_EMOJI_RECENT_ID, '']
const EMOJI_CATEGORIES: EmojiCategoryDescriptor[] = [
  ['Emoji.SmilesAndPeople', 'smile'],
  ['Emoji.AnimalsAndNature', 'animals'],
  ['Emoji.FoodAndDrink', 'eats'],
  ['Emoji.TravelAndPlaces', 'car'],
  ['Emoji.ActivityAndSport', 'sport'],
  ['Emoji.Objects', 'lamp'],
  ['Emoji.Flags', 'flag'],
  ['Skin Tones' as LangPackKey, ''],
]

let sorted: Map<EmojiCategoryDescriptor, string[]> | undefined
function prepare() {
  if(sorted) {
    return sorted
  }

  const a: Array<[EmojiCategoryDescriptor, string[]]> = [
    [CUSTOM_EMOJI_RECENT_CATEGORY, []],
    [EMOJI_RECENT_CATEGORY, []],
  ]

  sorted = new Map(a)
  for(const emoji in Emoji) {
    const details = Emoji[emoji]
    const i = '' + details
    const category = EMOJI_CATEGORIES[+i[0] - 1]
    if(!category) continue // maybe it's skin tones

    let s = sorted.get(category)
    if(!s) {
      s = []
      sorted.set(category, s)
    }

    s[+i.slice(1) || 0] = emoji
  }

  sorted.delete(EMOJI_CATEGORIES.pop()!)
  EMOJI_CATEGORIES.unshift(CUSTOM_EMOJI_RECENT_CATEGORY, EMOJI_RECENT_CATEGORY)
  const order = EMOJI_CATEGORIES.map(([id]) => id)
  const entries = [...sorted.entries()].sort((a, b) => order.indexOf(a[0][0]) - order.indexOf(b[0][0]))
  sorted = new Map(entries)

  return sorted
}

const RECENT_MAX_LENGTH = 32

type EmojiTabItem = {
  element: HTMLElement
  baseEmoji?: string
  emoji?: string
  docId?: DocId
}
export type EmojiTabCategory = StickersTabCategory<EmojiTabItem, { renderer: HTMLElement }> & {
  elements: { renderer?: CustomEmojiRendererElement }
}

const isPremium = () => !!useChatsStore.getState().me?.user.pFlags?.premium

export default class EmojiTab extends EmoticonsTabC<EmojiTabCategory, { emojis: AppEmoji[] }> {
  private closeScrollTop?: number
  private menuInnerScroll?: ScrollableX
  private isStandalone?: boolean
  private noRegularEmoji?: boolean
  private mainSets?: () => (Promise<DocId[]> | Array<Promise<DocId[]>>)
  private onClick?: (emoji: EmojiTabItem) => void
  private activeEmoji?: { docId?: DocId, emoji?: string }
  private activeElements: EmojiTabItem[]
  private noPacks?: boolean
  private preloaderDelay?: number
  private freeCustomEmoji: Set<DocId>
  private onReady?: () => void
  private nativeEmojiFadeReady?: boolean
  private emojiVariants: { [emoji: string]: EmojiSkinTone }
  public initPromise?: Promise<void>

  constructor(options: {
    managers: Managers
    isStandalone?: boolean
    noRegularEmoji?: boolean
    mainSets?: EmojiTab['mainSets']
    onClick?: EmojiTab['onClick']
    noPacks?: EmojiTab['noPacks']
    noSearch?: boolean
    preloaderDelay?: EmojiTab['preloaderDelay']
    freeCustomEmoji?: Set<DocId>
    onReady?: EmojiTab['onReady']
  }) {
    super({
      managers: options.managers,
      noMenu: options.noPacks,
      searchFetcher: options.noSearch ? undefined : async(value) => {
        if(!value) return { emojis: [] }

        return { emojis: await appEmojiManager.prepareAndSearchEmojis({ q: value, limit: Infinity, minChars: 1, addCustom: true }) }
      },
      processSearchResult: async({ data, searching, grouping }) => {
        const { emojis } = data || {}
        if(!emojis || (!searching && !grouping)) {
          return
        }

        if(!emojis.length) {
          const span = i18n('NoEmojiFound')
          span.classList.add('emoticons-not-found')
          return span
        }

        const container = this.categoriesContainer.cloneNode(false) as HTMLElement
        const category = this.createCategory({ styles: EmoticonsTabStyles.Emoji })
        this.createEmojiRendererForCategory(category)
        for(const emoji of emojis) {
          this.addEmojiToCategory({
            category: category,
            emoji,
            batch: true,
          })
        }
        category.setCategoryItemsHeight(emojis.length)
        category.elements.container.style.paddingTop = '.5rem'
        category.elements.container.classList.remove('hide')
        this._onCategoryVisibility(category, true)

        container.append(category.elements.container)

        onCleanup(() => {
          category.middlewareHelper.destroy()
        })

        return container
      },
      searchNoLoader: true,
      searchPlaceholder: 'SearchEmoji',
      searchType: 'emoji',
    })

    this.isStandalone = options.isStandalone
    this.noRegularEmoji = options.noRegularEmoji
    this.mainSets = options.mainSets
    this.onClick = options.onClick
    this.noPacks = options.noPacks
    this.preloaderDelay = options.preloaderDelay
    this.onReady = options.onReady
    this.container.classList.add('emoji-padding')
    this.content.id = 'content-emoji'
    this.activeElements = []
    this.freeCustomEmoji = options.freeCustomEmoji ?? new Set()
    this.emojiVariants = {}
  }

  public _onCategoryVisibility(category: EmojiTabCategory, visible: boolean) {
    const renderer = category.elements.renderer
    const newChildren: HTMLElement[] = []
    if(renderer) {
      newChildren.push(renderer)
      const customEmojis: Map<DocId, CustomEmojiElements> = new Map()
      if(visible) {
        newChildren.push(...category.items.map(({ docId, element }) => {
          if(!docId) {
            return element
          }

          const customEmojiElement = element.firstElementChild as CustomEmojiElement
          customEmojiElement.clear(false)
          customEmojis.set(customEmojiElement.docId, new Set([customEmojiElement]))
          return element
        }))

        renderer.add({
          addCustomEmojis: customEmojis,
        })
      } else {
        renderer.middlewareHelper.clean()
      }
    } else if(visible) {
      newChildren.push(...category.items.map(({ element }) => element))
    }

    category.elements.items.replaceChildren(...newChildren)

    if(visible && this.nativeEmojiFadeReady) {
      this.fadeInNativeEmojis(newChildren)
    }

    if(renderer && !visible) {
      const customEmojis: Map<DocId, CustomEmojiElements> = new Map()
      category.items.forEach(({ docId, element }) => {
        if(!docId) {
          return
        }

        const customEmojiElement = element.firstElementChild as CustomEmojiElement
        customEmojiElement.clear()
        customEmojis.set(customEmojiElement.docId, new Set([customEmojiElement]))
      })

      renderer.add({
        addCustomEmojis: customEmojis,
        onlyThumb: true,
      })
    }
  }

  private onCategoryVisibility = ({ target, visible }: Pick<OnVisibilityChangeItem, 'target' | 'visible'>) => {
    const category = this.categoriesMap.get(target)
    // the set's documents resolve asynchronously, so this can fire for a category that was
    // already deleted
    if(!category) {
      return
    }

    this._onCategoryVisibility(category, visible)
  }

  private fadeInNativeEmojis(parents: HTMLElement[]) {
    const natives: HTMLElement[] = []
    for(const parent of parents) {
      const child = parent.firstElementChild as HTMLElement | null
      if(child?.classList.contains('emoji-native')) {
        natives.push(child)
      }
    }
    if(!natives.length) return
    natives.forEach((el) => { el.style.opacity = '0' })
    fastRaf(() => natives.forEach((el) => { el.style.opacity = '' }))
  }

  public destroy() {
    super.destroy()
    this.menuInnerScroll?.destroy()
  }

  public init() {
    if(this.initialized) return this.initPromise
    this.initialized = true
    super.init()

    const intersectionOptions: IntersectionObserverInit = {
      root: this.isStandalone ? this.content : this.emoticonsDropdown!.getElement(),
    }

    this.categoriesIntersector = new VisibilityIntersector(this.onCategoryVisibility, intersectionOptions)

    if(this.menu) this.menuOnClickResult = EmoticonsDropdown.menuOnClick(
      this,
      this.menu,
      this.scrollable,
      this.menuScroll,
      undefined,
      this.listenerSetter,
    )

    const preloader = putPreloader(this.content, true)

    let innerScrollWrapper: HTMLElement | undefined

    if(!this.isStandalone && this.menu) {
      const x = this.menuInnerScroll = new ScrollableX(undefined)
      innerScrollWrapper = Tabs.MenuInner({ scroll: x.container }) as HTMLElement
    }

    let preparedMap: ReturnType<typeof prepare>
    prepare()
    if(!this.noRegularEmoji) {
      preparedMap = prepare()
    } else {
      preparedMap = new Map([
        [[CUSTOM_EMOJI_RECENT_CATEGORY[0], 'recent'], []],
      ])

      if(this.menu) {
        preparedMap.set([EMOJI_RECENT_CATEGORY[0], ''], [])
      }
    }

    preparedMap.forEach((emojis, [titleLangPackKey, icon]) => {
      const category = this.createLocalCategory({
        id: titleLangPackKey,
        title: titleLangPackKey,
        icon,
        noMenuTab: !icon,
        styles: EmoticonsTabStyles.Emoji,
      })
      category.elements.container.classList.remove('hide')

      emojis.forEach((unified) => {
        const emoji = emojiFromCodePoints(unified)
        this.addEmojiToCategory({
          category,
          emoji: { emoji },
          batch: true,
        })
      })
    })

    const mainSetsResult = this.mainSets?.()
    const promise = Promise.all([
      !this.preloaderDelay ? undefined : pause(this.preloaderDelay),
      !this.noRegularEmoji ? appEmojiManager.getRecentEmojis('native') : undefined,
      !this.isStandalone ? appEmojiManager.getRecentEmojis('custom') : undefined,
      !this.noPacks ? appEmojiManager.getCustomEmojis() : undefined,
      mainSetsResult && Promise.all(Array.isArray(mainSetsResult) ? mainSetsResult : [mainSetsResult]),
      !this.noRegularEmoji ? appEmojiManager.getEmojiVariants() : undefined,
    ]).then(([_, recent, recentCustom, sets, mainSets, emojiVariants]) => {
      this.emojiVariants = emojiVariants || {}
      this.applySavedEmojiVariants()
      preloader.remove()

      // Native emojis (IS_EMOJI_SUPPORTED === true) have no load event, so without
      // staging they pop in the moment IntersectionObserver inserts them into the
      // DOM. Flip the gate now so that `_onCategoryVisibility` starts applying a
      // JS-driven opacity transition for subsequent insertions, and retroactively
      // fade any category that's already been mounted and populated.
      if(IS_EMOJI_SUPPORTED && liteMode.isAvailable('animations')) {
        this.nativeEmojiFadeReady = true
        for(const category of this.categoriesMap.values()) {
          if(this.isCategoryVisible(category)) {
            this.fadeInNativeEmojis(Array.from(category.elements.items.children) as HTMLElement[])
          }
        }
      }

      const docIdsToCustomEmoji = (docIds: DocId[]): AppEmoji[] => {
        return docIds.map((docId) => {
          return { emoji: '', docId }
        })
      }

      let recentEmojis: AppEmoji[] | undefined, recentCustomEmojis: AppEmoji[] | undefined
      if(mainSets) {
        recentCustomEmojis = docIdsToCustomEmoji(mainSets[0])
        if(mainSets[1]) recentEmojis = docIdsToCustomEmoji(mainSets[1])
      }

      if(!recentEmojis && recent) {
        recentEmojis = recent.map((emoji) => ({ emoji }))
      }

      if(!recentCustomEmojis && recentCustom) {
        recentCustomEmojis = docIdsToCustomEmoji(recentCustom)
      }

      const recentCategory = this.categories[EMOJI_RECENT_ID]
      const recentCustomCategory = this.categories[CUSTOM_EMOJI_RECENT_ID]

      if(!this.noRegularEmoji) {
        const a = [
          recentCategory && [recentCategory, recent] as const,
          recentCustomCategory && [recentCustomCategory, recentCustom] as const,
        ]

        a.forEach((pair) => {
          if(!pair) return
          const [category, recent] = pair
          category.limit = RECENT_MAX_LENGTH
          recent?.splice(RECENT_MAX_LENGTH, recent.length - RECENT_MAX_LENGTH)
        })
      }

      if(recentCategory) {
        this.createEmojiRendererForCategory(recentCategory)
        if(recentEmojis?.length) for(const emoji of recentEmojis) {
          this.addEmojiToCategory({
            category: recentCategory,
            emoji,
            batch: true,
          })
        }
      }

      if(recentCustomCategory) {
        this.createEmojiRendererForCategory(recentCustomCategory)
        if(recentCustomEmojis?.length) for(const emoji of recentCustomEmojis) {
          this.addEmojiToCategory({
            category: recentCustomCategory,
            emoji,
            batch: true,
          })
        }
        recentCustomCategory.elements.container.style.paddingTop = '.5rem'
        if(this.noMenu) {
          recentCustomCategory.elements.container.style.paddingBottom = '.5rem'
        }
      }

      EMOJI_CATEGORIES.forEach(([id]) => {
        const category = this.categories[id]
        if(!category) {
          return
        }

        this.toggleLocalCategory(category, !!category.items.length)

        if(id !== EMOJI_RECENT_ID && id !== CUSTOM_EMOJI_RECENT_ID) {
          category.menuScroll = this.menuInnerScroll
          if(category.elements.menuTab) this.menuInnerScroll?.append(category.elements.menuTab)
        }
      })

      this.resizeCategories()

      if(recentCategory && innerScrollWrapper && recentCategory.elements.menuTab) {
        recentCategory.elements.menuTab.after(innerScrollWrapper)
      }

      sets?.sets.forEach((set) => {
        this.renderEmojiSet(set)
      })

      this.continueInit()
    })

    attachClickEvent(this.content, this.onContentClick, { listenerSetter: this.listenerSetter })

    const recentCategory = this.categories[EMOJI_RECENT_ID]
    const recentCustomCategory = this.categories[CUSTOM_EMOJI_RECENT_ID]
    this.attachHelpers({
      isEmojis: true,
      verifyRecent: (target) => !!(findUpAsChild(target, recentCustomCategory.elements.items) || (recentCategory && findUpAsChild(target, recentCategory.elements.items))),
      onContextMenu: this.onContextMenu,
    })

    return this.initPromise = promise
  }

  private continueInit() {
    this.listenerSetter.add(rootScope)('stickers_installed', (set) => {
      if(!this.categories[set.id] && set.pFlags?.emojis) {
        this.renderEmojiSet(set, true)
      }
    })

    this.listenerSetter.add(rootScope)('stickers_deleted', (set) => {
      const category = this.categories[set.id]
      if(this.deleteCategory(category)) {
        category.elements.renderer?.middlewareHelper.clean()
      }
    })

    this.listenerSetter.add(rootScope)('emoji_variant', ({ baseEmoji, tone }) => {
      this.applyEmojiVariant(baseEmoji, tone)
    })

    const onEmojiRecent = ({ emoji, deleted }: { emoji: AppEmoji, deleted?: boolean }) => {
      const category = this.categories[emoji.docId ? CUSTOM_EMOJI_RECENT_ID : EMOJI_RECENT_ID]
      if(!category) {
        return
      }

      const toneVariants = !emoji.docId && getEmojiSkinToneVariants(emoji.emoji)
      const verify: (item: EmojiTabItem) => boolean = emoji.docId ?
        (item) => item.docId === emoji.docId :
        toneVariants ?
          (item) => item.baseEmoji === toneVariants.baseEmoji :
          (item) => item.emoji === emoji.emoji
      const found = findAndSplice(category.items, verify)
      if(deleted) {
        // a use of this emoji may be waiting in the queue for the panel to hide — deleting it
        // now must not let that put it back
        findAndSpliceAll(this.postponedEvents, (event) => {
          if(event.cb !== onEmojiRecent) {
            return false
          }

          const other = (event.args[0] as { emoji: AppEmoji }).emoji
          return emoji.docId ? other.docId === emoji.docId : other.emoji === emoji.emoji
        })

        if(!found) {
          return
        }

        found.element.remove()
        if(this.isCategoryVisible(category)) {
          this.onLocalCategoryUpdate(category)
        }
      } else if(found) {
        category.items.unshift(found)
        if(this.isCategoryVisible(category)) {
          const { renderer } = category.elements
          positionElementByIndex(found.element, category.elements.items, renderer ? 1 : 0, -1)
        }
      } else {
        this.addEmojiToCategory({
          category,
          emoji,
          batch: false,
          prepend: true,
        })
      }

      if(this.closeScrollTop === 0) {
        this.menuOnClickResult?.setActive(emoji.docId ? this.categories[EMOJI_RECENT_ID] : category)
      }
    }

    const onEmojiRecentPostponed = this.postponedEvent(onEmojiRecent)
    if(!this.noRegularEmoji) this.listenerSetter.add(rootScope)('emoji_recent', (data) => {
      // using an emoji reshuffles the recent row, so it waits for the panel to hide — the panel
      // stays open while typing; deleting one is the user's own doing right there in it and
      // lands at once
      (data.deleted ? onEmojiRecent : onEmojiRecentPostponed)(data)
    })

    this.toggleCustomCategory()

    this.menuOnClickResult?.setActive([
      this.categories[EMOJI_RECENT_ID],
      this.categories[CUSTOM_EMOJI_RECENT_ID],
    ].find((category) => !!category?.elements.menuTab)!)

    this.onReady?.()
  }

  private get peerId() {
    return this.emoticonsDropdown?.chatInput?.chat?.peerId ?? 0
  }

  public getCustomCategory() {
    return this.categories[CUSTOM_EMOJI_RECENT_ID]
  }

  public toggleCustomCategory() {
    const category = this.categories[CUSTOM_EMOJI_RECENT_ID]
    const hasPremium = isPremium() || this.peerId === rootScope.myId || !!this.mainSets
    const canSeeCustomCategory = hasPremium || this.isStandalone
    super.toggleLocalCategory(category, !!category.items.length && !!canSeeCustomCategory)
    this.content.classList.toggle('has-premium', hasPremium)
  }

  protected toggleLocalCategory(category: EmojiTabCategory, visible: boolean) {
    if(category.id === CUSTOM_EMOJI_RECENT_ID) {
      this.toggleCustomCategory()
      return
    }

    super.toggleLocalCategory(category, visible)
  }

  protected renderEmojiSet(set: StickerSet, prepend?: boolean) {
    const category = this.createCategory({
      stickerSet: set,
      title: wrapEmojiText(set.title),
      styles: EmoticonsTabStyles.Emoji,
    })
    this.positionCategory(category, prepend)
    const { container, menuTabPadding } = category.elements
    category.elements.items.classList.add('not-local')
    category.elements.container.classList.add('is-premium-set')
    category.elements.title.prepend(Icon('premium_lock', 'category-title-lock'))

    this.createEmojiRendererForCategory(category)

    category.setCategoryItemsHeight(set.count)
    container.classList.remove('hide')

    void this.managers.stickers.getStickerSet({ id: set.id }).then(({ stickers: documents }) => {
      documents.forEach((document: MyDocument) => {
        this.addEmojiToCategory({
          category,
          emoji: { docId: document.id, emoji: document.stickerEmojiRaw || '' },
          batch: true,
        })
      })

      this.onCategoryVisibility({ target: category.elements.container, visible: this.isCategoryVisible(category) })
    }, () => {})

    if(menuTabPadding) this.renderStickerSetThumb({
      set,
      menuTabPadding,
      middleware: category.middlewareHelper.get(),
    })

    return category
  }

  private createEmojiRendererForCategory(category: EmojiTabCategory) {
    const middleware = category.middlewareHelper.get()
    const renderer = CustomEmojiRendererElement.create({
      animationGroup: this.animationGroup,
      customEmojiSize: mediaSizes.active.esgCustomEmoji,
      middleware,
    })

    category.elements.renderer = renderer
    category.elements.items.append(renderer)
  }

  private updateEmojiItemTone(item: EmojiTabItem, tone: EmojiSkinTone) {
    const toneVariants = item.baseEmoji && getEmojiSkinToneVariants(item.baseEmoji)
    if(!toneVariants) {
      return
    }

    const emoji = toneVariants.variants[tone]
    if(item.emoji === emoji) {
      return
    }

    item.emoji = emoji
    const renderedEmoji = appendEmoji({ emoji })
    item.element.replaceChildren(...Array.from(renderedEmoji.childNodes))
  }

  private applySavedEmojiVariants() {
    this.categoriesMap.forEach((category) => {
      category.items.forEach((item) => {
        const tone = item.baseEmoji ? this.emojiVariants[item.baseEmoji] : undefined
        if(tone !== undefined) {
          this.updateEmojiItemTone(item, tone)
        }
      })
    })
  }

  private applyEmojiVariant(baseEmoji: string, tone: EmojiSkinTone) {
    this.emojiVariants[baseEmoji] = tone
    this.categoriesMap.forEach((category) => {
      category.items.forEach((item) => {
        if(item.baseEmoji === baseEmoji) {
          this.updateEmojiItemTone(item, tone)
        }
      })
    })
  }

  private onContextMenu = (event: MouseEvent | TouchEvent) => {
    const target = findUpClassName(event.target as HTMLElement, 'super-emoji')
    const emoji = target && getEmojiFromElement(target.firstElementChild as HTMLElement)
    if(!emoji || emoji.docId) {
      return
    }

    const toneVariants = getEmojiSkinToneVariants(emoji.emoji)
    if(!toneVariants) {
      return
    }

    const { baseEmoji, variants } = toneVariants
    const picker = showEmojiTonePicker({
      event,
      variants,
      selectedTone: this.emojiVariants[baseEmoji] ?? getEmojiSkinTone(emoji.emoji),
      renderEmoji: (emoji) => appendEmoji({ emoji }),
      onSelect: (tone) => {
        this.applyEmojiVariant(baseEmoji, tone)
        void appEmojiManager.saveEmojiVariant(baseEmoji, tone)
      },
    })
    this.emoticonsDropdown?.setIgnoreMouseOut('tooltip', true)
    return {
      cleanup: () => {
        picker.cleanup()
        this.emoticonsDropdown?.setIgnoreMouseOut('tooltip', false)
      },
      onMenuOpen: picker.show,
    }
  }

  public addEmojiToCategory(options: {
    category: EmojiTabCategory
    emoji?: AppEmoji
    element?: HTMLElement
    batch?: boolean
    prepend?: boolean
    active?: boolean
  }) {
    const { category, batch, prepend } = options
    let { emoji } = options
    let element = options.element
    let baseEmoji: string | undefined
    if(emoji && !emoji.docId) {
      const toneVariants = getEmojiSkinToneVariants(emoji.emoji)
      if(toneVariants) {
        baseEmoji = toneVariants.baseEmoji
        const tone = this.emojiVariants[baseEmoji] ?? getEmojiSkinTone(emoji.emoji)
        emoji = {
          ...emoji,
          emoji: toneVariants.variants[tone],
        }
      }
    }

    if(element) {
      const spanEmoji = document.createElement('span')
      spanEmoji.classList.add('super-emoji')
      spanEmoji.append(element)
      element = spanEmoji
    } else {
      element = appendEmoji(emoji!)
    }

    const item: EmojiTabItem = {
      ...(emoji || { emoji: undefined }),
      baseEmoji,
      element,
    }

    if(
      options.active || (
        this.activeEmoji && (
          item.docId ?
            this.activeEmoji.docId === item.docId :
            this.activeEmoji.emoji === item.emoji
        )
      )
    ) {
      this.activeElements.push(item)
      element.classList.add('active')
    }

    category.items[prepend ? 'unshift' : 'push'](item)
    if(!batch && !this.spliceExceed(category)) {
      this.onLocalCategoryUpdate(category)
    }
  }

  public canUseEmoji(emoji: AppEmoji, category?: EmojiTabCategory, showToast?: boolean) {
    if(
      emoji.docId &&
      !isPremium() && (
        this.isStandalone && category ? category.id !== CUSTOM_EMOJI_RECENT_ID : this.peerId !== rootScope.myId
      ) && !this.freeCustomEmoji.has(emoji.docId)
    ) {
      if(showToast) {
        const a = anchorCallback(() => {
          hideToast()
          void import('@components/sidebarLeft/settingsPopups').then((m) => m.showPremiumPopup())
        })
        toastNew({
          langPackKey: 'CustomEmoji.PremiumAlert',
          langPackArguments: [a],
        })
      }

      return false
    }

    return true
  }

  private onContentClick = (e: MouseEvent | TouchEvent) => {
    const target = e.target as HTMLElement
    const container = findUpClassName(target, 'emoji-category')
    if(!container) {
      return
    }

    cancelEvent(e)
    const category = this.categoriesMap.get(container)

    if(findUpClassName(target, 'category-title')) {
      if(!category || category.local) {
        return
      }

      showStickersPopup({ id: category.set!.id }, true, this.emoticonsDropdown?.chatInput)
      return
    }

    const emoji = getEmojiFromElement(target)
    if(!emoji || !this.canUseEmoji(emoji, category, true)) {
      return
    }

    if(this.onClick) {
      this.onClick({
        ...emoji,
        element: findUpClassName(target, 'super-emoji')!.firstElementChild as HTMLElement,
      })
    } else {
      this.emoticonsDropdown!.chatInput.onEmojiSelected(emoji, false)
    }

    if(IS_TOUCH_SUPPORTED) {
      blurActiveElement()
    }
  }

  public setActive(emoji: AppEmoji) {
    if(
      (emoji === this.activeEmoji || emoji?.docId) ?
        emoji.docId === this.activeEmoji?.docId :
        emoji?.emoji === this.activeEmoji?.emoji
    ) {
      return
    }

    this.activeEmoji = emoji

    this.activeElements.forEach((item) => {
      item.element.classList.remove('active')
    })

    this.activeElements.length = 0

    this.categoriesMap.forEach((category) => {
      category.items.forEach((item) => {
        if(emoji.docId ? item.docId === emoji.docId : item.emoji === emoji.emoji) {
          item.element.classList.add('active')
          this.activeElements.push(item)
        }
      })
    })
  }

  public onClose() {
    this.closeScrollTop = this.scrollable.scrollPosition
  }
}
