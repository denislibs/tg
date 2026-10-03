// Порт tweb `src/components/emoticonsDropdown/tabs/stickers.ts` (812502980, 617 строк) — вкладка
// стикеров: «Избранные», «Недавние» (с очисткой), установленные наборы (обложка в ряду
// категорий), поиск по эмодзи/ключевому слову, отправка по клику (`onMediaClick`), живые
// установка/удаление наборов и изменения недавних/избранных.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Набор стикеров группы (`GroupSetController`, `initGroupSet`/`renderGroupSet`/`onPeerChanged`)
//     — нет своего набора у чатов на бэкенде (Б-132).
//  2. Группы поиска (`groupFetcher`: группы эмодзи и `emojiGroupPremium`) — Б-131.
//  3. Поиск: `searchStickers` (`appStickersManager`, `:930`) у нас — эмодзи запроса
//     (`splitSearchQuery`: эмодзи в строке либо подбор по ключевым словам) → `stickers.searchByEmoji`
//     по первым `SEARCH_EMOTICONS_LIMIT` эмодзи без повторов; локального индекса установленных
//     наборов (`includeOurStickers`) нет — ручка ищет и по ним.
//  4. Лимит «Избранных» (`apiManager.getLimit('favedStickers')`, `app_config`) — ручки лимитов нет,
//     держит сервер; лимит «Недавних» — 20, как у оригинала.
//  5. События `stickers_top`/`stickers_order` и `choosing_sticker` (`setTyping`) — не объявляются у
//     нас никем: порядок наборов не меняется на лету, «выбирает стикер» не отправляется (Б-133).
//  6. Премиум-стикеры (`getStickerEffectThumb` при скрытом Premium) — их нет на бэкенде.
//  7. Удаление одного недавнего стикера (`saveRecentSticker(unsave)`) — ручки нет; пункт меню не
//     показывается (`helpers/dom/createStickersContextMenu.ts`, расхождение 4).
import mediaSizes from '@helpers/mediaSizes'
import type { MyDocument } from '@core/media/messageMedia'
import type { StickerSet } from '@core/managers/stickersManager'
import type { Managers } from '@/client/bootstrap'
import { EmoticonsDropdown } from '@components/emoticonsDropdown'
import findUpClassName from '@helpers/dom/findUpClassName'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import parseEntities from '@lib/richtext/parseEntities'
import rootScope from '@lib/rootScope'
import appEmojiManager from '@lib/appManagers/appEmojiManager'
import lottieLoader from '@lib/lottie/lottieLoader'
import { putPreloader } from '@components/putPreloader'
import showStickersPopup from '@components/popups/stickers.bridge'
import findAndSplice from '@helpers/array/findAndSplice'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import noop from '@helpers/noop'
import ButtonIcon from '@components/buttonIcon'
import { confirmationPopup } from '@components/popups/popupPeer'
import VisibilityIntersector, { type OnVisibilityChangeItem } from '@components/visibilityIntersector'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import forEachReverse from '@helpers/array/forEachReverse'
import StickersTabCategory, { EmoticonsTabStyles } from '@components/emoticonsDropdown/category'
import EmoticonsTabC from '@components/emoticonsDropdown/tab'
import { i18n } from '@lib/langPack'
import { onCleanup } from 'solid-js'
import type SuperStickerRenderer from '@components/emoticonsDropdown/tabs/SuperStickerRenderer'

const SEARCH_EMOTICONS_LIMIT = 10

type StickersTabItem = { element: HTMLElement, document: MyDocument }
type StickersCategory = StickersTabCategory<StickersTabItem>

export default class StickersTab extends EmoticonsTabC<StickersCategory, MyDocument[]> {
  private stickerRenderer!: SuperStickerRenderer

  constructor(managers: Managers) {
    super({
      managers,
      searchFetcher: async(value) => {
        if(!value) return []
        return this.searchStickers(value)
      },
      processSearchResult: async({ data: stickers, searching, grouping }) => {
        if(!stickers || (!searching && !grouping)) {
          return
        }

        if(!stickers.length) {
          const span = i18n('NoStickersFound')
          span.classList.add('emoticons-not-found')
          return span
        }

        const container = this.categoriesContainer.cloneNode(false) as HTMLElement
        const category = this.createCategory({ styles: EmoticonsTabStyles.Stickers })
        const promise = StickersTab.categoryAppendStickers(
          this,
          this.stickerRenderer,
          stickers.length,
          category,
          stickers,
        )
        container.append(category.elements.container)

        let cleaned = false
        onCleanup(() => {
          cleaned = true
          category.middlewareHelper.destroy()
          this.clearCategoryItems(category, true)
        })

        await promise

        if(!cleaned) {
          StickersTab._onCategoryVisibility(category, true)
        }

        return container
      },
      searchPlaceholder: 'SearchStickers',
      searchType: 'stickers',
    })

    this.container.classList.add('stickers-padding')
    this.content.id = 'content-stickers'
  }

  /** tweb `appStickersManager.searchStickers` + `splitSearchQuery` (`:911-935`), расхождение 3 */
  private async searchStickers(query: string) {
    query = query.trim()
    if(!query) {
      return []
    }

    const emojiEntities = parseEntities(query)
    .filter((entity) => entity._ === 'messageEntityEmoji')
    .map((entity) => query.slice(entity.offset, entity.offset + entity.length))

    let emojis: string[] = emojiEntities
    if(!emojis.length) {
      emojis = (await appEmojiManager.prepareAndSearchEmojis({ q: query, limit: 200, minChars: 1 })).map(({ emoji }) => emoji)
    }

    const results = await Promise.all(emojis.slice(0, SEARCH_EMOTICONS_LIMIT).map((emoji) => {
      return this.managers.stickers.searchByEmoji(emoji).catch(() => [] as MyDocument[])
    }))

    const seen = new Set<number>()
    return results.flat().filter((doc) => !seen.has(doc.id) && (seen.add(doc.id), true))
  }

  public static _onCategoryVisibility = (category: StickersTabCategory<{ element: HTMLElement }>, visible: boolean) => {
    category.elements.items.replaceChildren(...(!visible ? [] : category.items.map(({ element }) => element)))
    if(visible) {
      // remounting detaches+reattaches the cells - transferred placeholder
      // canvases lose their displayed frame until the next worker commit
      lottieLoader.nudgePresentWithin(category.elements.items)
    }
  }

  private onCategoryVisibility = ({ target, visible }: OnVisibilityChangeItem) => {
    const category = this.categoriesMap.get(target)
    // the set's documents resolve asynchronously, so this can fire for a category that was
    // already deleted
    if(!category) {
      return
    }

    StickersTab._onCategoryVisibility(category, visible)
  }

  /** документ ячейки для `onMediaClick` (расхождение 3 `emoticonsDropdown/index.ts`) */
  private getDocument = (docId: string) => {
    for(const category of this.categoriesMap.values()) {
      const item = category.items.find((item) => '' + item.document.id === docId)
      if(item) return item.document
    }

    return this.searchDocuments.get(docId)
  }

  private searchDocuments: Map<string, MyDocument> = new Map()

  public init() {
    if(this.initialized) return
    this.initialized = true
    super.init()

    const intersectionOptions = this.emoticonsDropdown!.intersectionOptions
    this.categoriesIntersector = new VisibilityIntersector(this.onCategoryVisibility, intersectionOptions)

    this.scrollable.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if(findUpClassName(target, 'category-title')) {
        const container = findUpClassName(target, 'emoji-category')
        const category = container && this.categoriesMap.get(container)
        if(!category || category.local) {
          return
        }

        showStickersPopup({ id: category.set!.id }, false, this.emoticonsDropdown!.chatInput)
        return
      }

      void this.emoticonsDropdown!.onMediaClick(e, this.getDocument)
    })

    this.menuOnClickResult = EmoticonsDropdown.menuOnClick(this, this.menu!, this.scrollable, this.menuScroll)

    const preloader = putPreloader(this.content, true)

    const onCategoryStickers = (category: StickersCategory, stickers: MyDocument[]) => {
      if(category.limit) {
        stickers = stickers.slice(0, category.limit)
      }

      const ids = new Set(stickers.map((doc) => doc.id))
      forEachReverse(category.items, (item) => {
        if(!ids.has(item.document.id)) {
          this.deleteSticker(category, item.document, true)
        }
      })

      this.toggleLocalCategory(category, !!stickers.length)
      forEachReverse(stickers, (doc, idx) => {
        this.unshiftSticker(category, doc, true, idx)
      })
      this.spliceExceed(category)
      category.elements.container.classList.remove('hide')
    }

    const favedCategory = this.createLocalCategory({
      id: 'faved',
      title: 'FavoriteStickers',
      icon: 'savedmessages',
      styles: EmoticonsTabStyles.Stickers,
    })

    const recentCategory = this.createLocalCategory({
      id: 'recent',
      title: 'Stickers.Recent',
      icon: 'recent',
      styles: EmoticonsTabStyles.Stickers,
    })
    recentCategory.limit = 20

    const clearButton = ButtonIcon('close', { noRipple: true })
    recentCategory.elements.title.append(clearButton)
    attachClickEvent(clearButton, () => {
      confirmationPopup({
        titleLangKey: 'ClearRecentStickersAlertTitle',
        descriptionLangKey: 'ClearRecentStickersAlertMessage',
        button: {
          langKey: 'Clear',
        },
      }).then(() => {
        void this.managers.stickers.clearRecent().then(() => {
          rootScope.dispatchEvent('stickers_updated', { type: 'recent', stickers: [] })
        }, noop)
      }, noop)
    })

    const promises = [
      this.managers.stickers.faved().then((stickers) => {
        onCategoryStickers(favedCategory, stickers)
      }),

      this.managers.stickers.recent().then((stickers) => {
        onCategoryStickers(recentCategory, stickers)
      }),

      this.managers.stickers.mySets().then((sets) => {
        for(const set of sets) {
          if(set.pFlags?.emojis) continue
          void StickersTab.renderStickerSet(this, this.stickerRenderer, set, false)
        }
      }),
    ]

    void Promise.race(promises).finally(() => {
      preloader.remove()
    })

    void Promise.allSettled(promises).then(() => {
      this.mounted = true

      const favedCategory = this.categories['faved']
      const recentCategory = this.categories['recent']
      this.menuOnClickResult!.setActive(favedCategory.items.length ? favedCategory : recentCategory)

      this.listenerSetter.add(rootScope)('stickers_installed', (set) => {
        if(!this.categories[set.id] && !set.pFlags?.emojis) {
          void StickersTab.renderStickerSet(this, this.stickerRenderer, set, true)
        }
      })
    })

    this.stickerRenderer = this.createStickerRenderer()

    const onStickerUpdated = ({ type, document, faved }: { type: 'recent' | 'faved', document: MyDocument, faved: boolean }) => {
      const category = this.categories[type === 'faved' ? 'faved' : 'recent']
      if(category) {
        if(faved) {
          this.unshiftSticker(category, document)
        } else {
          this.deleteSticker(category, document)
        }
      }
    }

    const onStickerUpdatedPostponed = this.postponedEvent(onStickerUpdated)
    this.listenerSetter.add(rootScope)('sticker_updated', (data) => {
      // using a sticker reshuffles the recent row, which must not happen under the cursor —
      // that waits for the panel to hide; faving and removing are the user's own doing right
      // there in the panel, so they land at once
      const postpone = data.type === 'recent' && data.faved
      ;(postpone ? onStickerUpdatedPostponed : onStickerUpdated)(data)
    })

    this.listenerSetter.add(rootScope)('stickers_deleted', ({ id }) => {
      const category = this.categories[id]
      this.deleteCategory(category)
    })

    const onStickersUpdated = ({ type, stickers }: { type: 'recent' | 'faved', stickers: MyDocument[] }) => {
      const category = this.categories[type === 'faved' ? 'faved' : 'recent']
      if(category) {
        onCategoryStickers(category, stickers)
      }
    }

    const onStickersUpdatedPostponed = this.postponedEvent(onStickersUpdated)
    this.listenerSetter.add(rootScope)('stickers_updated', (data) => {
      const category = this.categories[data.type === 'faved' ? 'faved' : 'recent']
      const { limit } = category || {}
      const length = limit ? Math.min(limit, data.stickers.length) : data.stickers.length
      // a list that got shorter means something was taken out of it — clearing the recent
      // stickers, un-faving one — and the user has to see that happen; a list of the same
      // length is the reorder that follows using a sticker, which waits for the panel to hide
      const shrunk = category && length < category.items.length
      ;(shrunk ? onStickersUpdated : onStickersUpdatedPostponed)(data)
    })

    this.listenerSetter.add(mediaSizes)('resize', this.resizeCategories)

    this.attachHelpers({
      verifyRecent: (target) => !!findUpAsChild(target, this.categories['recent'].elements.items),
    })
  }

  public deleteCategory(category: StickersCategory | undefined) {
    const ret = super.deleteCategory(category)
    if(ret) {
      this.clearCategoryItems(category!)
    }

    return ret
  }

  private clearCategoryItems(category: StickersCategory, noUnmount?: boolean) {
    if(!noUnmount) category.elements.items.replaceChildren()
    category.items.splice(0, Infinity).forEach(({ element }) => this.stickerRenderer.unobserveAnimated(element))
  }

  public deleteSticker(category: StickersCategory, doc: MyDocument, batch?: boolean) {
    const item = findAndSplice(category.items, (item) => item.document.id === doc.id)
    if(item) {
      item.element.remove()
      this.stickerRenderer.unobserveAnimated(item.element)

      if(!batch) {
        this.onLocalCategoryUpdate(category)
      }
    }
  }

  public unshiftSticker(category: StickersCategory, doc: MyDocument, batch?: boolean, idx?: number) {
    if(idx !== undefined) {
      const i = category.items[idx]
      if(i && i.document.id === doc.id) {
        return
      }
    }

    let item = findAndSplice(category.items, (item) => item.document.id === doc.id)
    if(!item) {
      item = {
        element: this.stickerRenderer.renderSticker(doc, undefined, undefined, category.middlewareHelper.get()),
        document: doc,
      }
    }

    category.items.unshift(item)
    category.elements.items.prepend(item.element)
    // the DOM move blanks a transferred placeholder canvas - re-present
    lottieLoader.nudgePresentWithin(item.element)

    if(!batch) {
      this.spliceExceed(category)
    }
  }

  public onOpened() {
    this.resizeCategories()
  }

  public destroy() {
    this.stickerRenderer?.destroy()
    super.destroy()
  }

  public static categoryAppendStickers(
    tab: StickersTab,
    stickerRenderer: SuperStickerRenderer,
    count: number,
    category: StickersCategory,
    promise: MyDocument[] | Promise<MyDocument[]>,
  ) {
    const { container } = category.elements

    category.setCategoryItemsHeight(count)
    container.classList.remove('hide')

    return Promise.resolve(promise).then((documents) => {
      const isVisible = tab.isCategoryVisible(category)

      const elements = documents.map((document) => {
        tab.searchDocuments.set('' + document.id, document)
        const element = stickerRenderer.renderSticker(document, undefined, undefined, category.middlewareHelper.get())
        category.items.push({ document, element })
        return element
      })

      if(isVisible) {
        category.elements.items.append(...elements)
      }
    })
  }

  public static async renderStickerSet(
    tab: StickersTab,
    stickerRenderer: SuperStickerRenderer,
    set: StickerSet,
    prepend?: boolean,
  ) {
    const category = tab.createCategory({
      stickerSet: set,
      title: wrapEmojiText(set.title),
      styles: EmoticonsTabStyles.Stickers,
    })
    const { menuTabPadding } = category.elements

    const promise = tab.managers.stickers.getStickerSet({ id: set.id })
    void this.categoryAppendStickers(
      tab,
      stickerRenderer,
      set.count,
      category,
      promise.then((stickerSet) => stickerSet.stickers),
    ).catch(noop)

    if(prepend !== undefined) {
      tab.positionCategory(category, prepend)
    }

    tab.renderStickerSetThumb({
      set,
      menuTabPadding,
      middleware: category.middlewareHelper.get(),
    })
  }
}
