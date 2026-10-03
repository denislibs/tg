// Фабрика `Chat` для тестов ленты, меню и выделения (`bubbles.*.test.ts`,
// `contextMenu*.test.ts`, `selection.test.ts`) — не тест сама по себе.
//
// `attachTestSelection` — выделение `Chat` без ленты, на поддельных баблах: им
// пользуются тесты меню, которым лента не нужна (tweb меню читает
// `chat.selection`, а его создаёт `Chat.init`).
//
// С шага К-3 `ChatBubbles`, `ChatContextMenu` и `ChatSelection` получают `Chat`
// (`components/chat/chat.ts`), как у tweb. Поднимать настоящий класс в тесте ленты
// значит тянуть шапку, остров композера и правую колонку; вместо этого здесь — ровно
// те члены `Chat`, которые зовут три класса, с поведением по умолчанию «как в
// личке, куда можно писать». Форму задаёт ОДНО место: класс `Chat` поменял член —
// правится эта фабрика, а не сорок тестов.
//
// `mountTestBubbles` повторяет порядок `Chat.init` (tweb `chat.ts:616-643`): лента,
// меню, выделение, ховер-реакция, `attachContainerListeners`.
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import type { ChatSavedPosition } from '@lib/appImManager'
import type { MyMessage } from '@core/models'
import type { ChatAutoDownload } from '@core/chat/autoDownloadSettings'
import ChatBubbles, { type BubblesManagers } from './bubbles'
import ChatContextMenu, { type ContextMenuManagers, type ContextMenuPopups } from './contextMenu'
import ChatSelection, { type SelectionBubbles, type SelectionManagers } from './selection'
import { ChatType } from './chatType'
import type Chat from './chat'
import type ChatInput from './input'

export type TestChatInput = {
  messageInput?: HTMLElement
  canSendPlain(): boolean
  getChatInputReplyToFromMessage(message: MyMessage): { replyToMsgId: number }
  initMessageReply(replyTo: { replyToMsgId: number }): void
  initMessageEditing(mid: number): void
  sendMessageWithDocument(options: { document: unknown, target?: HTMLElement }): boolean | Promise<boolean>
}

export type TestAppImManager = {
  setInnerPeer(options: { peerId: PeerId, type?: ChatType, threadId?: number, lastMsgId?: number }): unknown
  callUser(userId: PeerId, type: 'voice' | 'video'): void
  getChatSavedPosition(chat: Chat): ChatSavedPosition | undefined
}

export type TestChatOptions = {
  peerId?: PeerId
  threadId?: number
  messagesStorageKey?: string
  type?: ChatType
  isLikeGroup?: boolean
  isAnyGroup?: boolean
  isMegagroup?: boolean
  isBroadcast?: boolean
  isChannel?: boolean
  isBot?: boolean
  isForum?: boolean
  autoDownload?: ChatAutoDownload
  container?: HTMLElement
  bubblesViewport?: HTMLElement
  canSend?: () => boolean | Promise<boolean>
  input?: Partial<TestChatInput>
  appImManager?: Partial<TestAppImManager>
}

const noop = () => {}

/** Фейковый `Chat`: поля — как у класса, методы — безопасные заглушки. */
export function createTestChat(options: TestChatOptions = {}): Chat {
  const peerId = options.peerId ?? 50
  const input: TestChatInput = {
    messageInput: document.createElement('div'),
    canSendPlain: () => true,
    getChatInputReplyToFromMessage: (message) => ({ replyToMsgId: message.id }),
    initMessageReply: noop,
    initMessageEditing: noop,
    sendMessageWithDocument: () => true,
    ...options.input,
  }
  const appImManager: TestAppImManager = {
    setInnerPeer: noop,
    callUser: noop,
    getChatSavedPosition: () => undefined,
    ...options.appImManager,
  }
  const canSend = options.canSend ?? (() => true)

  const chat = {
    peerId,
    threadId: options.threadId,
    monoforumThreadId: undefined,
    type: options.type ?? ChatType.Chat,
    messagesStorageKey: options.messagesStorageKey ?? String(peerId),
    container: options.container ?? document.createElement('div'),
    bubblesViewport: options.bubblesViewport ?? document.createElement('div'),
    animationGroup: 'chat-1',
    isLikeGroup: !!options.isLikeGroup,
    isAnyGroup: !!options.isAnyGroup,
    isMegagroup: !!options.isMegagroup,
    isBroadcast: !!options.isBroadcast,
    isChannel: !!options.isChannel,
    isBot: !!options.isBot,
    isForum: !!options.isForum,
    autoDownload: options.autoDownload,
    input,
    appImManager,
    canSend: () => Promise.resolve(canSend()),
    onChangePeer: () => Promise.resolve(),
    finishPeerChange: () => Promise.resolve(),
    revealPreparedBackground: noop,
    initSearch: noop,
    setMessageId(this: Chat, o: { lastMsgId?: number } = {}) {
      return this.bubbles.setMessageId(o)
    },
  }
  return chat as unknown as Chat
}

/** Поднять ленту на фейковом `Chat` в порядке `Chat.init` (tweb `chat.ts:616-643`). */
export function mountTestBubbles(chat: Chat, managers: BubblesManagers, options: {
  menuManagers?: ContextMenuManagers,
  popups?: ContextMenuPopups,
} = {}): ChatBubbles {
  const bubbles = new ChatBubbles(chat, managers)
  chat.bubbles = bubbles
  chat.contextMenu = new ChatContextMenu(chat, options.menuManagers ?? (managers as unknown as ContextMenuManagers), options.popups)
  chat.selection = new ChatSelection(chat, bubbles, chat.input as unknown as ChatInput, { messages: {} })
  if(!IS_TOUCH_SUPPORTED) {
    bubbles.setReactionsHoverListeners()
  }

  bubbles.attachContainerListeners()
  return bubbles
}

/** Выделение `Chat` поверх поддельных баблов — для тестов меню без ленты. */
export function attachTestSelection(
  chat: Chat,
  bubbles: SelectionBubbles,
  managers: SelectionManagers = { messages: {} },
): ChatSelection {
  chat.selection = new ChatSelection(chat, bubbles, chat.input as unknown as ChatInput, managers)
  return chat.selection
}
