// Порт tweb `src/components/chat/stickersHelper.ts` (812502980) — лента стикеров
// над строкой ввода, когда в поле набран ровно один эмодзи. Выбор отправляет
// стикер и очищает поле. Пачка П-6, Б-34. Стили — `styles/tweb/_chatStickersHelper.scss`.
//
// Расхождения с оригиналом:
//  1. Выбор — `chat.input.emoticonsDropdown.onMediaClick({target}, getDocument)`: документ
//     ячейки — из карты выдачи `docs` (у tweb `onMediaClick` берёт его у `appDocsManager`),
//     ожидания готовности ячеек (`loadPromises`) нет — `renderSticker` их не собирает.
//  2. Выдача — `stickers.searchByEmoji` (`GET /stickers/search?emoji=`), у tweb —
//     `appStickersManager.getStickersByEmoticon({includeOurStickers,
//     includeServerStickers})`: настройку «предлагать: все/мои» (`stickers.suggest`)
//     ручка не различает — `none` гасит хелпер в `checkAutocomplete`, `installed`
//     и `all` дают одну выдачу (Б-137). `preloadAnimatedEmojiSticker` и событие
//     `choosing_sticker` («выбирает стикер» собеседнику) — без предмета (Б-137).
import type { Managers } from '@/client/bootstrap'
import ListenerSetter from '@helpers/listenerSetter'
import mediaSizes from '@helpers/mediaSizes'
import { createLazyLoadQueue } from '@core/lazyLoadQueue'
import type { MyDocument } from '@core/media/messageMedia'
import Scrollable from '@components/scrollable'
import attachStickerViewerListeners from '@components/stickerViewer'
import SuperStickerRenderer from '@components/emoticonsDropdown/tabs/SuperStickerRenderer'
import AutocompleteHelper from './autocompleteHelper'
import type AutocompleteHelperController from './autocompleteHelperController'
import type Chat from './chat'

export default class StickersHelper extends AutocompleteHelper {
  private scrollable!: Scrollable
  private onChangeScreen?: () => void
  private listenerSetter?: ListenerSetter
  /** документы выдачи по `data-doc-id` — у tweb `onMediaClick` берёт их у `appDocsManager` */
  private docs: Map<string, MyDocument> = new Map()

  constructor(
    appendTo: HTMLElement,
    controller: AutocompleteHelperController,
    private chat: Chat,
    private managers: Managers,
  ) {
    super({
      appendTo,
      controller,
      listType: 'xy',
      onSelect: async(target) => {
        return !(await this.chat.input.emoticonsDropdown.onMediaClick({ target }, (docId) => this.docs.get(docId)))
      },
      waitForKey: ['ArrowUp', 'ArrowDown'],
    })

    this.container.classList.add('stickers-helper')

    this.addEventListener('visible', () => {
      setTimeout(() => { // it is not rendered yet
        this.scrollable.scrollPosition = 0
      }, 0)
    })

    this.addEventListener('hidden', () => {
      if(this.onChangeScreen) {
        mediaSizes.removeEventListener('changeScreen', this.onChangeScreen)
        this.onChangeScreen = undefined

        this.listenerSetter!.removeAll()
        this.listenerSetter = undefined
      }
    })
  }

  public checkEmoticon(emoticon: string) {
    const middleware = this.getMiddleware()

    void this.managers.stickers.searchByEmoji(emoticon).catch(() => [] as MyDocument[]).then((stickers) => {
      if(!middleware()) {
        return
      }

      if(this.init) {
        this.init()
        this.init = null
      }

      const container = this.list.cloneNode() as HTMLElement

      if(stickers.length) {
        const lazyLoadQueue = createLazyLoadQueue()
        const superStickerRenderer = new SuperStickerRenderer({
          regularLazyLoadQueue: lazyLoadQueue,
          group: this.chat.animationGroup,
        })
        this.docs = new Map()
        stickers.forEach((sticker) => {
          this.docs.set('' + sticker.id, sticker)
          container.append(superStickerRenderer.renderSticker(sticker))
        })

        middleware.onClean(() => {
          lazyLoadQueue.clear()
          setTimeout(() => superStickerRenderer.destroy(), 500) // * fix video flick
        })
      }

      this.list.replaceWith(container)
      this.list = container

      if(!this.onChangeScreen) {
        this.onChangeScreen = () => {
          const width = (this.list.childElementCount * mediaSizes.active.esgSticker.width) + (this.list.childElementCount - 1 * 1)
          this.list.style.width = width + 'px'
        }
        mediaSizes.addEventListener('changeScreen', this.onChangeScreen)

        this.listenerSetter = new ListenerSetter()
        attachStickerViewerListeners({ listenTo: this.container, listenerSetter: this.listenerSetter })
      }

      this.onChangeScreen()

      this.toggle(!stickers.length)
      this.scrollable.scrollPosition = 0
    })
  }

  public init: (() => void) | null = () => {
    this.list = document.createElement('div')
    this.list.classList.add('stickers-helper-stickers', 'super-stickers')

    this.container.append(this.list)

    this.scrollable = new Scrollable(this.container)
  }
}
