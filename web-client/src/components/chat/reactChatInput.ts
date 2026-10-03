// ВРЕМЕННО до К-4: композер инстанса чата — React-остров с нашим `Composer.tsx`
// внутри класса `Chat` (правило 2 плана
// `docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`: «React внутри
// класса», а не наоборот). У tweb на этом месте класс `ChatInput`
// (`components/chat/input.ts`); здесь — ровно те его члены, которые зовут `Chat`
// (`chat.ts:618-648`, `:850`, `:876`, `:1010`, `:1223`) и соседи: лента и её
// жесты (`initMessageReply`, `getChatInputReplyToFromMessage`, `canSendPlain`),
// контекстное меню (`messageInput`, `initMessageEditing`), вкладки поиска
// стикеров и GIF (`sendMessageWithDocument`). Таблица членов — контракт К-3.
//
// Остров монтируется в `chatInput` (`.chat-input.chat-input-main`, его `Chat`
// кладёт в `container`, `chat.ts:643`) через `shared/react/mountReact.tsx` на
// первом `finishPeerChange`; дерево — `reactChatInputView.tsx`, грузится
// динамическим импортом: `chat.ts` (а с ним `appImManager` и всё, что
// импортирует его ради `setInnerPeer`) не тянет за собой React-композер.
//
// Расхождения с `ChatInput` tweb:
//  1. Состояние ввода (ответ, правка, черновик) живёт в React-дереве
//     (`useChatSend`, `useComposerDraft`), поэтому методы класса — ручки,
//     которые дерево отдаёт острову при монтировании (`handle`). До монтирования
//     ручек нет: вызовы — без эффекта, `canSendPlain()` — `false`.
//  2. `initMessageReply` по номеру собирает плашку из окна зеркала
//     (`core/draftReply.ts::windowReplyState`), а не запросом сообщения
//     (`input.ts:5108-5112`): вне окна ответа нет.
//  3. Излишек высоты (`chat.updateChatInputHeight`, tweb `input.ts:3100`)
//     считается по высоте `chatInput` наблюдателем размера: высоту меняет
//     React-композер, а не `onMessageInput`.
//  4. Плашка ответа, правки и пересылки при `finishPeerChange` не
//     восстанавливается из черновика классом — это делает дерево
//     (`reactChatInputView.tsx`, ответ черновика).
//  5. `initMessagesForward` (`input.ts:4462`), `inputContainer` и `center`
//     (`input.ts:1963`) — члены, которые зовут попап пересылки и панель
//     выделения (П-5, `popups/forward.bridge.ts`, `chat/selection.ts`).
//     Пересылка, пришедшая до монтирования дерева, ждёт его в `forwarding`
//     (tweb хранит её там же); морф строки ввода в панель выделения делает
//     дерево (`useChatInputCenter`, цель `'selection'`).
import { mountReact, type ReactIsland } from '@shared/react/mountReact'
import type { Managers } from '@/client/bootstrap'
import type { GifItem } from '@core/gifs'
import type { MyMessage } from '@core/models'
import type { Sticker } from '@core/managers/stickersManager'
import type { AppImManager } from '@lib/appImManager'
import type { ChatRights } from '@core/peers/rights'
import type { ChatType } from './chatType'
import type { ReactChatInputViewProps } from './reactChatInputView'

/** tweb `ChatInput.forwarding` — `{[fromPeerId]: mids}` (`input.ts:4462`) */
export type ChatInputForwarding = { [fromPeerId: PeerId]: number[] }

/** tweb `ChatInputReplyTo` в объёме, у которого есть предмет: цитаты, истории
 *  и варианта опроса в ответе у нас нет. */
export type ChatInputReplyTo = {
  replyToMsgId: number
  replyToPeerId?: PeerId
}

/** Срез `Chat` (`components/chat/chat.ts`), который читает остров. */
export interface ReactChatInputHost {
  peerId: PeerId
  threadId?: number
  type: ChatType
  container: HTMLElement
  /** tweb `chat.ts:1340` — права на запись (текст, медиа) */
  canSend(action?: ChatRights): Promise<boolean>
  /** tweb `chat.ts:283` */
  updateChatInputHeight(surplus: number): void
  /** tweb `bubbles.ts:3852` — кнопка «вниз» (`input.ts:648`) */
  bubbles?: { onGoDownClick(): void }
  /** tweb `input.ts:1899-1918` (`getNeededFakeContainer`) — идёт ли выделение */
  selection?: { isSelecting: boolean }
}

/** Ручки, которые дерево острова отдаёт классу (расхождение 1 шапки). */
export interface ReactChatInputHandle {
  canSendPlain(): boolean
  initMessageReply(replyTo: ChatInputReplyTo): void
  initMessageEditing(mid: number): void
  sendDocument(document: Sticker | GifItem): boolean
  clearHelper(): void
  initMessagesForward(fromPeerIdsMids: ChatInputForwarding): void
  center(): void
}

/** Базовая строка ввода — 3rem; всё выше неё — излишек (`chat.ts:283`). */
const INPUT_BASE_HEIGHT = 48

export default class ReactChatInput {
  /** tweb `input.ts:231` */
  public chatInput!: HTMLElement
  /** ручки дерева — пишет и снимает `reactChatInputView.tsx` */
  public handle?: ReactChatInputHandle
  /** tweb `input.ts:285` — пересылка, ждущая дерева (расхождение 5) */
  public forwarding?: ChatInputForwarding

  private island?: ReactIsland<ReactChatInputViewProps>
  private resizeObserver?: ResizeObserver
  private surplus = -1
  private destroyed = false

  constructor(
    public chat: ReactChatInputHost,
    public appImManager: AppImManager,
    public managers: Managers,
    private className = 'chat-input-main',
  ) {}

  /** tweb `input.ts:487` в объёме узла строки ввода. */
  public construct() {
    this.chatInput = document.createElement('div')
    this.chatInput.classList.add('chat-input', this.className)

    this.resizeObserver = new ResizeObserver(() => this.onResize())
    this.resizeObserver.observe(this.chatInput)
  }

  /** tweb `input.ts:1055` — помощники пира рисует дерево острова. */
  public constructPeerHelpers() {}

  /** tweb `input.ts:215` — поле ввода композера, пока он смонтирован. */
  public get messageInput(): HTMLElement | undefined {
    return this.chatInput?.querySelector<HTMLElement>('.input-message-input:not(.input-field-input-fake)') ?? undefined
  }

  /** tweb `input.ts:2522`: пир уже выставлен на `Chat`, остров догоняет его. */
  public async finishPeerChange(_options?: unknown): Promise<() => void> {
    const { default: ReactChatInputView } = await import('./reactChatInputView')
    const props: ReactChatInputViewProps = {
      input: this,
      peerId: this.chat.peerId,
      threadId: this.chat.threadId,
    }

    return () => {
      if(this.destroyed) return
      if(this.island) {
        this.island.update(props)
        return
      }

      this.island = mountReact(this.chatInput, ReactChatInputView, props, this.managers)
    }
  }

  /** tweb `input.ts:2390` */
  public cleanup(_helperToo = true) {}

  /** tweb `input.ts:5265` */
  public clearHelper() {
    this.forwarding = undefined
    this.handle?.clearHelper()
  }

  /** tweb `input.ts:227` — `.chat-input-container`, его рисует дерево */
  public get inputContainer(): HTMLElement | undefined {
    return this.chatInput?.querySelector<HTMLElement>('.chat-input-container') ?? undefined
  }

  /** tweb `input.ts:1963` — морф строки ввода в плашку (расхождение 5) */
  public async center(_animate = false) {
    this.handle?.center()
  }

  /** tweb `input.ts:4462` — плашка пересылки (расхождение 5) */
  public initMessagesForward(fromPeerIdsMids: ChatInputForwarding) {
    if(this.handle) {
      this.forwarding = undefined
      this.handle.initMessagesForward(fromPeerIdsMids)
    } else {
      this.forwarding = fromPeerIdsMids
    }
  }

  /** tweb `input.ts:2365` */
  public destroy() {
    this.destroyed = true
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined
    this.island?.unmount()
    this.island = undefined
    this.handle = undefined
  }

  /** tweb `input.ts:3330` */
  public canSendPlain() {
    return this.handle?.canSendPlain() ?? false
  }

  /** tweb `input.ts:5082` */
  public getChatInputReplyToFromMessage(message: MyMessage): ChatInputReplyTo {
    return { replyToMsgId: message.id }
  }

  /** tweb `input.ts:5099` — расхождение 2 шапки. */
  public initMessageReply(replyTo: ChatInputReplyTo) {
    this.handle?.initMessageReply(replyTo)
  }

  /** tweb `input.ts:4859` */
  public initMessageEditing(mid: number) {
    this.handle?.initMessageEditing(mid)
  }

  /** tweb `input.ts:4749`: ответ — «ушло ли». */
  public async sendMessageWithDocument({ document }: { document: Sticker | GifItem, target?: HTMLElement }): Promise<boolean> {
    return this.handle?.sendDocument(document) ?? false
  }

  private onResize() {
    const surplus = Math.max(0, Math.round(this.chatInput.offsetHeight) - INPUT_BASE_HEIGHT)
    if(surplus === this.surplus) return
    this.surplus = surplus
    this.chat.updateChatInputHeight(surplus)
  }
}
