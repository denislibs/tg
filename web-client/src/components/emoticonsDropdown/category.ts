// Порт tweb `src/components/emoticonsDropdown/category.ts` (812502980, 138 строк) — категория
// вкладки эмодзи-дропдауна: `div.emoji-category` с заголовком `.category-title`, сеткой
// `.category-items` и кнопкой в ряду категорий (`Tabs.MenuIconTab`). Высота сетки
// закладывается заранее (`setCategoryItemsHeight`) — содержимое невидимой категории снято
// (`VisibilityIntersector` вкладки), а прокрутка не должна прыгать. Расхождений нет.
import { makeMediaSize, type MediaSize } from '@helpers/mediaSize'
import mediaSizes from '@helpers/mediaSizes'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import type { StickerSet } from '@core/managers/stickersManager'
import type { ScrollableX } from '@components/scrollable'
import { attachPickerGrid } from '@helpers/dom/attachListNavigation'
import I18n from '@lib/langPack'
import Tabs from '@components/tabs.solid'

export type StickersTabCategoryItem = { element: HTMLElement }
export type StickersTabStyles = {
  padding: number
  gapX: number
  gapY: number
  getElementMediaSize: () => MediaSize
  itemsClassName: string
}

/** tweb `tabs/emoji.ts` `EMOJI_ELEMENT_SIZE` — здесь, чтобы не замыкать импорт вкладки на категорию */
export const EMOJI_ELEMENT_SIZE = makeMediaSize(42, 42)

export const EmoticonsTabStyles: { [key in 'Stickers' | 'Emoji' | 'GIF']: StickersTabStyles } = {
  Stickers: {
    getElementMediaSize: () => mediaSizes.active.esgSticker,
    padding: 3 * 2,
    gapX: 4,
    gapY: 4,
    itemsClassName: 'super-stickers',
  },
  Emoji: {
    getElementMediaSize: () => EMOJI_ELEMENT_SIZE,
    padding: 16,
    gapX: 4,
    gapY: 0,
    itemsClassName: 'super-emojis',
  },
  GIF: {
    getElementMediaSize: () => makeMediaSize(124, 124),
    padding: 4,
    gapX: 2,
    gapY: 2,
    itemsClassName: 'emoticons-gifs',
  },
}

export type StickersTabCategoryElements = {
  container: HTMLElement
  title: HTMLElement
  items: HTMLElement
  menuTab: HTMLElement
  menuTabPadding: HTMLElement
}

export default class StickersTabCategory<Item extends StickersTabCategoryItem, AdditionalElements extends Record<string, HTMLElement> = Record<never, HTMLElement>> {
  public elements: StickersTabCategoryElements & Partial<AdditionalElements>
  public items: Item[]
  public mounted?: boolean
  public id: string
  public limit?: number

  public getContainerSize: () => { width: number, height?: number }
  private getElementMediaSize: () => MediaSize

  private gapX: number
  private gapY: number

  public set?: StickerSet
  public local?: boolean
  public menuScroll?: ScrollableX

  public middlewareHelper: MiddlewareHelper

  constructor(options: {
    id: string
    title?: HTMLElement | DocumentFragment
    overflowElement: HTMLElement
    styles: StickersTabStyles
    getContainerSize: StickersTabCategory<Item>['getContainerSize']
    noMenuTab?: boolean
    middleware?: Middleware
  }) {
    const container = document.createElement('div')
    container.classList.add('emoji-category')

    const items = document.createElement('div')
    items.classList.add('category-items')

    let title: HTMLElement | undefined
    if(options.title) {
      title = document.createElement('div')
      title.classList.add('category-title')
      title.append(options.title)
    }

    let menuTab: HTMLElement | undefined, menuTabPadding: HTMLElement | undefined
    if(!options.noMenuTab) {
      menuTab = Tabs.MenuIconTab({
        label: title?.textContent || undefined,
        paddingRef: (ref) => menuTabPadding = ref,
      })
    }

    if(title) container.append(title)
    container.append(items)

    // у категории без заголовка/кнопки этих узлов нет — как у tweb (`as any`)
    this.elements = {
      container,
      title,
      items,
      menuTab,
      menuTabPadding,
    } as unknown as StickersTabCategoryElements & Partial<AdditionalElements>
    this.id = options.id
    this.items = []

    this.getContainerSize = options.getContainerSize
    this.getElementMediaSize = options.styles.getElementMediaSize
    this.gapX = options.styles.gapX ?? 0
    this.gapY = options.styles.gapY ?? 0
    this.middlewareHelper = options.middleware ? options.middleware.create() : getMiddleware()
    this.middlewareHelper.onDestroy(attachPickerGrid(
      items,
      '.super-emoji, .super-sticker',
      (item, index) => item.dataset.emoji || I18n.format('AccDescr.StickerNumber', true, [String(index + 1)]),
    ))
  }

  public setCategoryItemsHeight(itemsLength = this.items.length) {
    const { width: containerWidth } = this.getContainerSize()
    const elementSize = this.getElementMediaSize().width

    let itemsPerRow = containerWidth / elementSize
    if(this.gapX) itemsPerRow -= Math.floor(itemsPerRow - 1) * this.gapX / elementSize
    itemsPerRow = Math.floor(itemsPerRow)

    const rows = Math.ceil(itemsLength / itemsPerRow)
    let height = rows * elementSize
    if(this.gapY) height += (rows - 1) * this.gapY

    this.elements.items.style.minHeight = height + 'px'
  }
}
