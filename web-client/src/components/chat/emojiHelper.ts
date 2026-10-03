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
//  2. `appendEmoji`/`getEmojiFromElement` (tweb `emoticonsDropdown/tabs/emoji.ts:66-151`)
//     и поиск `appEmojiManager.prepareAndSearchEmojis` (`appEmojiManager.ts:200-268`)
//     — ниже, ВРЕМЕННО до Б-35: их дом — порт эмодзи-дропдауна (`emoticonsDropdown/**`,
//     соседняя ветка П-6). Индекс ключевых слов пуст: у бэкенда нет
//     `messages.getEmojiKeywordsDifference` (Б-138), поэтому `:` без слова даёт
//     популярные эмодзи (`POPULAR_EMOJI`, недавних — нет до Б-35), а поиск по слову —
//     пустую выдачу и скрытый хелпер, как у tweb без пакета ключевых слов.
import type { Managers } from '@/client/bootstrap'
import { ScrollableX } from '@components/scrollable'
import type { Middleware } from '@helpers/middleware'
import findUpClassName from '@helpers/dom/findUpClassName'
import SearchIndex from '@lib/searchIndex'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import AutocompleteHelper from './autocompleteHelper'
import type AutocompleteHelperController from './autocompleteHelperController'
import type StickersHelper from './stickersHelper'
import type ChatInput from './input'

/** tweb `AppEmoji` (`appEmojiManager.ts`) — без `docId` своих эмодзи (расхождение 1). */
export type AppEmoji = { emoji: string, docId?: DocId }

// ── ВРЕМЕННО до Б-35 (расхождение 2) ────────────────────────────────────────

/** tweb `appEmojiManager.ts:37` */
const POPULAR_EMOJI = ['😂', '😘', '❤️', '😍', '😊', '😁', '👍', '☺️', '😔', '😄', '😭', '💋', '😒', '😳', '😜', '🙈', '😉', '😃', '😢', '😝', '😱', '😡', '😏', '😞', '😅', '😚', '🙊', '😌', '😀', '😋', '😆', '👌', '😐', '😕']
/** tweb `appEmojiManager.ts:31` */
const RECENT_MAX_LENGTH = 32

/** Пакет ключевых слов (tweb `EmojiLangPack.keywords`) — пуст до Б-138. */
const keywords: { [keyword: string]: string[] } = {}
let index: SearchIndex<string[]> | undefined

/** tweb `appEmojiManager.searchEmojis` (`:200-251`) без своих эмодзи (`addCustom`). */
export function searchEmojis({ q, limit = 40, minChars = 2 }: { q: string, limit?: number, minChars?: number }): AppEmoji[] {
  if(!index) {
    index = new SearchIndex({ minChars: 2, fullWords: true })
    for(const keyword in keywords) {
      index.indexObject(keywords[keyword], keyword)
    }
  }

  q = q.toLowerCase().replace(/_/g, ' ')

  let emojis: string[]
  if(q.trim()) {
    const set = index.search(q, minChars)
    emojis = [...new Set(Array.from(set).flat())]
    emojis.length = Math.min(40, emojis.length)
  } else {
    emojis = POPULAR_EMOJI.slice(0, RECENT_MAX_LENGTH)
  }

  const appEmojis: AppEmoji[] = emojis.map((emoji) => ({ emoji }))
  appEmojis.length = Math.min(limit, appEmojis.length)
  return appEmojis
}

/** tweb `emoticonsDropdown/tabs/emoji.ts:66-134` — ветка обычного эмодзи. */
export function appendEmoji(_emoji: AppEmoji) {
  const { emoji } = _emoji
  const spanEmoji = document.createElement('span')
  spanEmoji.classList.add('super-emoji', 'super-emoji-regular')
  spanEmoji.dataset.emoji = emoji

  spanEmoji.append(wrapEmojiText(emoji))

  if(spanEmoji.children.length > 1) {
    const first = spanEmoji.firstElementChild!
    spanEmoji.replaceChildren(first)
  }

  return spanEmoji
}

/** tweb `emoticonsDropdown/tabs/emoji.ts:136-151` — без ветки своего эмодзи. */
export function getEmojiFromElement(element: HTMLElement): AppEmoji | undefined {
  const superEmoji = findUpClassName(element, 'super-emoji')
  if(!superEmoji) return

  if(element.nodeType === element.TEXT_NODE) return { emoji: element.nodeValue! }
  if(element.tagName === 'SPAN' && !element.classList.contains('emoji') && element.firstElementChild) {
    element = element.firstElementChild as HTMLElement
  }

  return { emoji: element.getAttribute('alt') || element.innerText || element.textContent! }
}

// ─────────────────────────────────────────────────────────────────────────────

export default class EmojiHelper extends AutocompleteHelper {
  private scrollable!: ScrollableX
  private innerList?: HTMLElement

  constructor(
    appendTo: HTMLElement,
    controller: AutocompleteHelperController,
    private chatInput: ChatInput,
    // * у tweb — `appEmojiManager` воркера; у нас поиск ВРЕМЕННО локальный (расхождение 2)
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
    void Promise.resolve(searchEmojis({ q })).then((emojis) => {
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
