// Порт tweb `src/components/chat/emojiHelper.ts` (812502980) — горизонтальная
// полоска эмодзи-подсказок над строкой ввода: по `:запросу` или по слову у
// каретки. Выбор зовёт `ChatInput.onEmojiSelected` — эмодзи заменяет набранный
// запрос. Пачка П-6, Б-34. Стили — `styles/tweb/_chatEmojiHelper.scss`.
//
// Расхождения с оригиналом:
//  1. Своих эмодзи нет (Б-74, Б-138): `renderEmojis` не строит
//     `CustomEmojiRendererElement`, фильтра `canUseEmoji` без Premium и
//     `checkEmoticon` (свои варианты к набранному эмодзи, `searchCustomEmoji`)
//     нет — их предмет появится с кастомными эмодзи.
//  2. Поиск — `appEmojiManager.prepareAndSearchEmojis` главного потока (у tweb — менеджер
//     воркера, `appEmojiManager.ts:200-268`); `appendEmoji`/`getEmojiFromElement` —
//     `emoticonsDropdown/tabs/emoji.ts` (порт Б-35). Ключевые слова — локальный пакет
//     `config/emojiKeywords.ts` (нет `messages.getEmojiKeywordsDifference`, Б-131/Б-138).
import type { Managers } from '@/client/bootstrap'
import { ScrollableX } from '@components/scrollable'
import type { Middleware } from '@helpers/middleware'
import appEmojiManager from '@lib/appManagers/appEmojiManager'
import { appendEmoji, getEmojiFromElement } from '@components/emoticonsDropdown/tabs/emoji'
import AutocompleteHelper from './autocompleteHelper'
import type AutocompleteHelperController from './autocompleteHelperController'
import type StickersHelper from './stickersHelper'
import type ChatInput from './input'

/** tweb `AppEmoji` — глобальный тип (`global.d.ts`); реэкспорт для `ChatInput`. */
export default class EmojiHelper extends AutocompleteHelper {
  private scrollable!: ScrollableX
  private innerList?: HTMLElement

  constructor(
    appendTo: HTMLElement,
    controller: AutocompleteHelperController,
    private chatInput: ChatInput,
    // * у tweb — `appEmojiManager` воркера; у нас — главного потока (расхождение 2)
    _managers: Managers,
  ) {
    super({
      appendTo,
      controller,
      listType: 'x',
      onSelect: (target) => {
        const emoji = getEmojiFromElement(target as HTMLElement)
        if(emoji) this.chatInput.onEmojiSelected(emoji, true)
      },
      getNavigationList: () => this.innerList,
    })

    this.container.classList.add('emoji-helper')
  }

  public init: (() => void) | null = () => {
    this.list = document.createElement('div')
    this.list.classList.add('emoji-helper-emojis', 'super-emojis')

    this.container.append(this.list)

    this.scrollable = new ScrollableX(this.container)

    this.addEventListener('visible', () => {
      setTimeout(() => { // it is not rendered yet
        this.scrollable.scrollPosition = 0
      }, 0)
    })
  }

  private renderEmojis(emojis: AppEmoji[]) {
    const container = this.list.cloneNode() as HTMLElement
    const inner = this.innerList = document.createElement('span')
    container.append(inner)

    emojis.forEach((emoji) => {
      inner.append(appendEmoji(emoji))
    })

    return container
  }

  public render(emojis: AppEmoji[], waitForKey: boolean, middleware: Middleware) {
    if(this.init) {
      if(!emojis.length) {
        return
      }

      this.init()
      this.init = null
    }

    if(!emojis.length) {
      this.toggle(true)
      return
    }

    emojis = emojis.slice(0, 80)

    const container = this.renderEmojis(emojis)
    if(!middleware()) {
      return
    }

    this.list.replaceWith(container)
    this.list = container
    this.waitForKey = waitForKey ? ['ArrowUp', 'ArrowDown'] : undefined

    this.toggle(false)
    this.scrollable.scrollPosition = 0
  }

  public checkQuery(query: string, firstChar: string) {
    const middleware = this.getMiddleware()
    const q = query.replace(/^:/, '')
    void appEmojiManager.prepareAndSearchEmojis({ q, addCustom: true }).then((emojis) => {
      if(!middleware()) {
        return
      }

      this.render(emojis, firstChar !== ':', middleware)
    })
  }

  // * the two helpers can both be visible. emoji helper overlays on top of the stickers helper
  // * via DOM order; we still need to hide it when the user scrolls the stickers panel so the
  // * stickers underneath the strip are reachable
  public attachStickersHelper(stickersHelper: StickersHelper) {
    stickersHelper.container.addEventListener('scroll', this.onStickersScroll, { passive: true, capture: true })
  }

  private onStickersScroll = () => {
    // * fromController=true so the cascade in toggle() doesn't also hide the stickers panel
    if(!this.hidden) {
      this.toggle(true, true)
    }
  }
}
