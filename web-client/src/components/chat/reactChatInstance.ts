// ВРЕМЕННО до К-3: инстанс стека `appImManager.chats` — React-остров `Chat.tsx`
// (правило 2 плана `docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`:
// «React внутри класса», а не наоборот). У tweb на этом месте класс `Chat`
// (`components/chat/chat.ts`); здесь — ровно те его члены, которые зовёт
// `appImManager` на К-2 (таблица «Центр на К-2» плана), и `pop`/
// `toggleChatIfMedium` (`chat.ts:1662-1675`) для стрелки «назад» шапки.
//
// Остров монтируется лениво — на первом `setPeer` с пиром — через
// `shared/react/mountReact.tsx`, а сам `Chat.tsx` грузится динамическим импортом:
// `appImManager` (и всё, что импортирует его ради `setInnerPeer`) не тянет за
// собой React-дерево центра.
//
// Расхождения с `Chat` tweb:
//  1. `setPeer` разрешается `{cached: true}` сразу после рендера острова: ждать
//     первой страницы ленты нечем (её грузит `ChatBubbles` внутри острова), а
//     `appImManager.setPeer` по `cached` лишь решает, ждать ли `promise`.
//  2. `peer_changed` объявляется после каждого `setPeer` с пиром (у tweb — из
//     `finishPeerChange`, `chat.ts:1252`, тоже на каждый вызов), без
//     `isMainChat`: инстансов вне стека у нас нет.
//  3. Прыжок к сообщению (`lastMsgId`) — `requestMessageJump` до рендера: лента
//     потребляет его при монтировании (у tweb — `bubbles.setPeer({lastMsgId})`).
//  4. `input` — то, что `Chat.tsx` отдаёт наружу, пока он активен
//     (`sendMessageWithDocument` для вкладок поиска стикеров и GIF, tweb
//     `chat.input`, `input.ts:4341`).
import { createElement, useMemo, useSyncExternalStore, type ComponentType } from 'react'
import { mountReact, type ReactIsland } from '@shared/react/mountReact'
import useMediaQuery from '@shared/lib/useMediaQuery'
import type { Managers } from '@/client/bootstrap'
import type { Chat as ChatEntity } from '@/data'
import type { GifItem } from '@core/gifs'
import type { Sticker } from '@core/managers/stickersManager'
import { ChatInstanceProvider } from '@core/chat/chatInstanceContext'
import { resolveChatEntity } from '@core/chatEntity'
import { useChatList } from '@core/hooks/useChatList'
import { usePeers } from '@core/hooks/usePeers'
import { requestMessageJump } from '@core/messageLink'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import appNavigationController from '@core/navigation/appNavigationController'
import { isUser, NULL_PEER_ID } from '@core/peers/peerId'
import { loadPresence, useChatsStore } from '@stores/chatsStore'
import appSidebarRight from '@components/sidebarRight'
import type { ThreadInfo } from '@components/Chat'
import type { AppImManager, ChatSetPeerOptions } from '@lib/appImManager'
import { ChatType } from './chatType'

/** Расхождение 4 шапки. Ответ — «ушло ли» (tweb `Promise<boolean>`). */
export type ReactChatInput = {
  sendMessageWithDocument(options: { document: Sticker | GifItem, target?: HTMLElement }): boolean | Promise<boolean>
}

type ChatViewProps = { chat: ChatEntity, thread?: ThreadInfo, onBack?: () => void }

type IslandProps = {
  instance: ReactChatInstance,
  ChatView: ComponentType<ChatViewProps>,
  peerId: PeerId,
  thread?: ThreadInfo
}

function ReactChatIsland({ instance, ChatView, peerId, thread }: IslandProps) {
  const isActive = useSyncExternalStore(instance.subscribeActive, instance.getIsActive)
  const chatList = useChatList()
  // пир без диалога: карточку в зеркало приносит объявленный пробел (`usePeers`)
  usePeers(useMemo(() => [peerId], [peerId]))
  // стрелка «назад» шапки — только на узкой раскладке (как прежний `App.tsx`)
  const narrow = useMediaQuery('(max-width:900px)')
  if(!peerId) {
    return null
  }

  const chat = resolveChatEntity({ peerId, thread }, chatList)
  return createElement(
    ChatInstanceProvider,
    { value: { instance, isActive } },
    createElement(ChatView, { chat, thread, onBack: narrow ? instance.pop : undefined }),
  )
}

export default class ReactChatInstance {
  public container: HTMLDivElement
  public peerId: PeerId = NULL_PEER_ID
  public threadId?: number
  public monoforumThreadId?: PeerId
  public type: ChatType = ChatType.Chat
  public inited?: boolean
  /** мета треда — опция `setInnerPeer` (расхождение 10 шапки `appImManager`) */
  public thread?: ThreadInfo
  /** расхождение 4 шапки */
  public input?: ReactChatInput

  private island?: ReactIsland<IslandProps>
  private destroyed = false

  constructor(public appImManager: AppImManager, public managers: Managers) {
    this.container = document.createElement('div')
    this.container.classList.add('chat', 'tabs-tab')
  }

  public subscribeActive = (callback: () => void) => {
    this.appImManager.addEventListener('chat_changing', callback)
    this.appImManager.addEventListener('peer_changed', callback)
    return () => {
      this.appImManager.removeEventListener('chat_changing', callback)
      this.appImManager.removeEventListener('peer_changed', callback)
    }
  }

  public getIsActive = () => this.appImManager.chat === this

  /** tweb `chat.ts:1035-1196` в объёме острова — расхождения 1–3 шапки. */
  public async setPeer(options: ChatSetPeerOptions): Promise<{ cached: boolean, promise: Promise<void> } | undefined> {
    const { peerId, threadId, monoforumThreadId, type = ChatType.Chat } = options
    if(!peerId) {
      this.inited = undefined
    } else if(!this.inited) {
      this.inited = true
    }

    const samePeer = this.appImManager.isSamePeer(this, { peerId, threadId, monoforumThreadId, type })
    if(!samePeer) {
      this.appImManager.dispatchEvent('peer_changing', this)
      this.peerId = peerId || NULL_PEER_ID
      this.threadId = threadId
      this.monoforumThreadId = monoforumThreadId
    }

    if(!peerId) {
      this.peerId = NULL_PEER_ID
      this.thread = undefined
      void appSidebarRight.toggleSidebar(false)
      this.island?.update({ peerId: NULL_PEER_ID, thread: undefined })
      this.appImManager.dispatchEvent('peer_changed', this)
      return
    }

    this.type = type
    this.thread = options.thread
    if(options.lastMsgId) {
      requestMessageJump(peerId, options.lastMsgId)
    }

    // человек без диалога — присутствие для шапки (бывший `openPeer`)
    if(!samePeer && isUser(peerId) && !useChatsStore.getState().dialogs.some((d) => d.peerId === peerId)) {
      void loadPresence(this.managers, [peerId])
    }

    await this.renderIsland()
    if(this.destroyed) {
      return
    }

    this.container.dataset.type = this.type === ChatType.Search ? 'chat' : this.type
    this.appImManager.dispatchEvent('peer_changed', this)
    return { cached: true, promise: Promise.resolve() }
  }

  private async renderIsland() {
    const props = { peerId: this.peerId, thread: this.thread }
    if(this.island) {
      this.island.update(props)
      return
    }

    const { default: ChatView } = await import('../Chat')
    if(this.destroyed) {
      return
    }

    if(this.island) { // * второй `setPeer`, пока грузился модуль
      (this.island as ReactIsland<IslandProps>).update({ peerId: this.peerId, thread: this.thread })
      return
    }

    this.island = mountReact<IslandProps>(this.container, ReactChatIsland, {
      instance: this,
      ChatView,
      peerId: this.peerId,
      thread: this.thread,
    }, this.managers)
  }

  /** tweb `chat.ts:837-841` — ленте (`ChatBubbles`) чистить нечего до К-3. */
  public beforeDestroy() {}

  /** tweb `chat.ts:843-869` */
  public destroy() {
    this.destroyed = true
    this.island?.unmount()
    this.island = undefined
    this.container.remove()
  }

  /** tweb `chat.ts:1662-1669` */
  public toggleChatIfMedium() {
    if(mediaSizes.activeScreen === ScreenSize.medium && document.body.classList.contains('is-left-column-shown')) {
      void this.appImManager.setPeer({ peerId: this.peerId })
      return true
    }

    return false
  }

  /** tweb `chat.ts:1671-1676` */
  public pop = () => {
    if(this.toggleChatIfMedium()) return

    const isFirstChat = this.appImManager.chats.indexOf(this) === 0
    appNavigationController.back(isFirstChat ? 'im' : 'chat')
  }
}
