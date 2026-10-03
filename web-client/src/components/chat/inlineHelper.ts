// Порт tweb `src/components/chat/inlineHelper.ts` (812502980) — выдача инлайн-бота
// над строкой ввода, когда поле начинается с `@бот запрос`. Выбор отправляет
// результат и очищает поле. Пачка П-6, Б-34. Стили — `styles/tweb/_chatInlineHelper.scss`.
//
// Расхождения с оригиналом (у бэкенда — только статьи демо-бота, Б-139):
//  1. Только списочный режим: галереи (`botResults.pFlags.gallery` — `GifsMasonry`,
//     `SuperStickerRenderer`, `wrapPhoto`), миниатюр (`item.thumb` — `inputWebFileLocation`)
//     и кнопок `switch_pm`/`switch_webview` нет — ручка `GET /bots/{id}/inline`
//     отдаёт статьи без них. Иконку статьи у нас даёт поле `emoji` результата
//     (замена `thumb`, см. `core/managers/botsManager.ts`): превью рисует его, без
//     него — первую букву заголовка, как оригинал.
//  2. Отправка: ручки `messages.sendInlineBotResult` нет — выбор шлёт текст
//     статьи (`send_message.message`) обычным сообщением через
//     `ChatInput.sendMessageWithForward` (без `via_bot_id`), затем
//     `onMessageSent(true, true)` — как у tweb после `sendInlineResult`.
//     `getReadyToSend` (отложенная отправка, Б-32) не зовётся; эфемерного
//     режима (`isEphemeralComposerMode`) и гостевых ботов (`bot_guestchat`) нет.
//  3. Право `send_inline` — наш `send_messages` (расхождение 5 `input.ts`), текст
//     запрета — ключ tweb `GlobalAttachInlineRestricted`.
import type { Managers } from '@/client/bootstrap'
import debounce, { type DebounceReturnType } from '@helpers/schedulers/debounce'
import type { InlineResult } from '@core/managers/botsManager'
import type { User } from '@core/peers/peer'
import Scrollable from '@components/scrollable'
import setInnerHTML from '@helpers/dom/setInnerHTML'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import wrapRichText from '@lib/richtext/wrapRichText'
import { i18n } from '@lib/langPack'
import mediaSizes from '@helpers/mediaSizes'
import AutocompleteHelper from './autocompleteHelper'
import type AutocompleteHelperController from './autocompleteHelperController'
import type Chat from './chat'

export default class InlineHelper extends AutocompleteHelper {
  private scrollable!: Scrollable
  private onChangeScreen?: () => void
  public checkQuery: DebounceReturnType<InlineHelper['_checkQuery']>
  /** выдача последнего запроса по `data-result-id` (расхождение 2) */
  private results: Map<string, InlineResult> = new Map()

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
      waitForKey: ['ArrowUp', 'ArrowDown'],
      onSelect: (target) => {
        if(!target) return false // can happen when there is only button
        const result = this.results.get((target as HTMLElement).dataset.resultId!)
        if(!result) return false
        const input = this.chat.input
        void input.sendMessageWithForward({
          value: result.messageText,
          entities: [],
          sendingParams: input.getMessageSendingParams(),
        })

        input.onMessageSent(true, true)
      },
    })

    this.container.classList.add('inline-helper')

    this.addEventListener('visible', () => {
      setTimeout(() => { // it is not rendered yet
        this.scrollable.scrollPosition = 0
      }, 0)
    })

    this.checkQuery = debounce(this._checkQuery, 200, true, true)

    this.addEventListener('hidden', () => {
      if(this.onChangeScreen) {
        mediaSizes.removeEventListener('changeScreen', this.onChangeScreen)
        this.onChangeScreen = undefined
      }
    })
  }

  public _checkQuery = async(peerId: PeerId, username: string, query: string, canSendInline: boolean) => {
    const middleware = this.controller!.getMiddleware()

    const peer = await this.managers.peers.resolveUsername(username)
    if(!middleware()) {
      throw 'PEER_CHANGED'
    }

    if(peer._ !== 'user' || !peer.pFlags?.bot) {
      throw 'NOT_A_BOT'
    }

    if(!canSendInline) {
      if(!middleware()) {
        throw 'PEER_CHANGED'
      }

      if(this.init) {
        this.init()
        this.init = null
      }

      this.container.classList.add('cant-send')
      this.toggle(false)
      throw 'NO_INLINES'
    }

    const botId = peer.id

    const renderPromise = this.managers.bots.inline(botId, query).then((botResults) => {
      if(!middleware()) {
        throw 'PEER_CHANGED'
      }

      if(this.init) {
        this.init()
        this.init = null
      }

      const list = this.list.cloneNode() as HTMLElement
      list.dataset.peerId = '' + peerId
      list.dataset.botId = '' + botId

      this.results = new Map()
      for(const item of botResults.results) {
        this.results.set(item.id, item)

        const container = document.createElement('div')
        container.classList.add('inline-helper-result')
        container.dataset.resultId = item.id

        const preview = document.createElement('div')
        preview.classList.add('inline-helper-result-preview')

        container.append(preview)

        list.append(container)

        preview.classList.add('empty')
        // * расхождение 1: `emoji` статьи вместо миниатюры `thumb`
        setInnerHTML(preview, wrapEmojiText(item.emoji || Array.from(item.title.trim())[0] || ''))

        const title = document.createElement('div')
        title.classList.add('inline-helper-result-title')
        setInnerHTML(title, wrapEmojiText(item.title))

        const description = document.createElement('div')
        description.classList.add('inline-helper-result-description')
        // * у tweb ещё `noCommands`: у нашего `wrapRichText` команд ботов нет вовсе
        setInnerHTML(description, wrapRichText(item.description ?? '', {
          noLinks: true,
        }))

        container.append(title, description)

        const separator = document.createElement('div')
        separator.classList.add('inline-helper-separator')

        list.append(separator)
      }

      list.classList.toggle('is-gallery', false)
      list.classList.toggle('super-stickers', false)
      this.container.classList.toggle('is-gallery', false)

      const parent = this.list.parentElement!
      parent.textContent = ''
      parent.append(this.list = list)
      this.container.classList.remove('cant-send')

      if(!this.onChangeScreen) {
        this.onChangeScreen = () => {
          this.list.style.width = ''
        }
        mediaSizes.addEventListener('changeScreen', this.onChangeScreen)
      }

      this.onChangeScreen()

      this.toggle(!botResults.results.length)
      this.scrollable.scrollPosition = 0
    })

    return { user: peer as User, renderPromise }
  }

  public init: (() => void) | null = () => {
    this.list = document.createElement('div')
    this.list.classList.add('inline-helper-results')

    this.container.append(this.list)

    this.scrollable = new Scrollable(this.container)

    // * расхождение 3: у tweb `POSTING_NOT_ALLOWED_MAP['send_inline']`
    const span = i18n('GlobalAttachInlineRestricted')
    span.classList.add('inline-helper-cant-send')
    this.container.append(span)
  }
}
