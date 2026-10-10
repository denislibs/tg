/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/requests.tsx` (812502980, 179 строк) — плашка заявок
// на вступление под шапкой: стек лиц последних заявителей, «N заявок» (открывает
// вкладку заявок `AppChatRequestsTab`) и крестик, скрывающий плашку.
// Показывается, когда в полной карточке чата есть `recent_requesters` (зрителю с
// `invite_users`), обновляется событием `chat_requests` (`topbar.ts`), скрытие —
// ключ `hideChatJoinRequests` State (его снимает кадр заявок в воркере).
//
// РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. `managers.acknowledged.appProfileManager.getProfileByPeerId` (подтверждённого
//     вызова у нас нет) — зеркало полных карточек (`cachedPeerFull`): лежит —
//     `cached: true`, нет — ожидание карточки в зеркале (`subscribeChatFullMirror`;
//     в сеть за ней ходит `chat.fullPeer` — `useFullPeer` на смене пира).
//     Ожидание прошлого пира снимается новым `setPeerId`.
//  2. `chat.setAppState`/`chat.appState` — `setAppState`/`useAppStateStore`
//     (`stores/appState.ts`); `appSidebarRight` — у шапки (`topbar.appSidebarRight`).
//  3. `StackedAvatars` берёт `managers` (аватарка читает зеркало пиров, шапка
//     `components/stackedAvatars.ts`); `lazyLoadQueue` нет.
import { createEffect, createSignal, Show, type Accessor } from 'solid-js'
import type Chat from '@components/chat/chat'
import type ChatTopbar from '@components/chat/topbar'
import I18n from '@lib/langPack'
import StackedAvatars from '@components/stackedAvatars'
import { AppChatRequestsTab } from '@components/solidJsTabs/tabs'
import { ONE_DAY } from '@helpers/date'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import TopbarPlate, { createTopbarPlate, type TopbarPlateController } from '@components/chat/topbarPlate.solid'
import { cachedPeerFull, subscribeChatFullMirror, type PeerFull } from '@core/chatFullCache'
import { setAppState, useAppStateStore } from '@stores/appState'
import { toChatId, toPeerId } from '@core/peers/peerId'

/** Matches the plate's buttons — the stack mirrors the close button's slot. */
const AVATAR_SIZE = 40

type RequestData = {
  peerId: PeerId
  avatars: StackedAvatars
  avatarsMiddleware: MiddlewareHelper
  length: number
}

/** Ответ `setPeerId` — форма подтверждённого вызова оригинала (расхождение 1). */
export type RequestsAcked = {
  cached: boolean
  result: Promise<() => void>
}

export type ChatRequestsPlate = TopbarPlateController & {
  set: (peerId: PeerId, peerIds: PeerId[], length: number) => Promise<() => void>
  unset: (peerId: PeerId) => void
  setPeerId: (peerId: PeerId) => RequestsAcked
}

function RequestsPlateBody(props: {
  data: Accessor<RequestData | undefined>
  onOpen: () => void
  onClose: () => void
}) {
  const titleElement = new I18n.IntlElement({
    key: 'Chat.Header.RequestToJoin',
    args: [0],
  })
  // The plate is a fixed 48px — a large pending count has to ellipsize
  // instead of wrapping the label onto a second line.
  titleElement.element.classList.add('text-overflow-no-wrap')

  // The label lives outside the `Show`, so it is updated from an effect — every
  // `set()` writes a fresh `RequestData`, including while the plate is already
  // on screen (`chat_requests` fires on every pending-count change).
  createEffect(() => {
    const d = props.data()
    if(d) titleElement.compareAndUpdate({ key: 'Chat.Header.RequestToJoin', args: [d.length] })
  })

  return (
    <>
      {/* `keyed` so a new `RequestData` swaps the stack: a plain `Show` only
          re-runs its child when `when` flips truthiness, which would leave the
          previous requesters' faces on a visible plate. */}
      <Show when={props.data()} keyed>
        {(d) => d.avatars.container}
      </Show>
      <TopbarPlate.PrimaryButton onClick={props.onOpen}>
        {titleElement.element}
      </TopbarPlate.PrimaryButton>
      <TopbarPlate.CloseButton onClick={props.onClose} />
    </>
  )
}

/** Полная карточка из зеркала — сразу или когда приедет (расхождение 1). */
function waitForFullPeer(peerId: PeerId, signal: { cancelled: boolean }): Promise<PeerFull | undefined> {
  return new Promise((resolve) => {
    const unsubscribe = subscribeChatFullMirror(() => {
      if(signal.cancelled) {
        unsubscribe()
        resolve(undefined)
        return
      }

      const full = cachedPeerFull(peerId)
      if(full) {
        unsubscribe()
        resolve(full)
      }
    })
  })
}

export default function createChatRequestsPlate(
  topbar: ChatTopbar,
  chat: Chat,
): ChatRequestsPlate {
  const [data, setData] = createSignal<RequestData | undefined>()

  let currentPeerId: PeerId | undefined
  let waiting: { cancelled: boolean } | undefined

  const onOpen = async() => {
    const appSidebarRight = topbar.appSidebarRight
    if(appSidebarRight.isTabExists(AppChatRequestsTab)) return
    const tab = appSidebarRight.createTab(AppChatRequestsTab)
    await tab.open(toChatId(chat.peerId))
    void appSidebarRight.toggleSidebar(true)
  }

  const onClose = () => {
    if(currentPeerId !== undefined) {
      setAppState('hideChatJoinRequests', {
        ...useAppStateStore.getState().hideChatJoinRequests,
        [currentPeerId]: Date.now(),
      })
    }
    unset(currentPeerId!)
  }

  const plate = createTopbarPlate({
    modifier: 'requests',
    height: 48,
    onVisibilityChange: () => topbar.setFloating(),
    render: () => <RequestsPlateBody data={data} onOpen={() => void onOpen()} onClose={onClose} />,
  })

  const unset = (peerId: PeerId) => {
    currentPeerId = peerId
    const prev = data()
    if(prev) prev.avatarsMiddleware.destroy()
    setData(undefined)
    plate.setHidden(true)
  }

  const set = async(peerId: PeerId, peerIds: PeerId[], length: number) => {
    if(!peerIds.length) {
      return () => unset(peerId)
    }

    const avatarsMiddleware = getMiddleware()
    const avatars = new StackedAvatars({ avatarSize: AVATAR_SIZE, middleware: avatarsMiddleware.get(), managers: chat.managers })
    const loadPromises: Promise<unknown>[] = []
    void avatars.render(peerIds, loadPromises)
    await Promise.all(loadPromises)

    return () => {
      const prev = data()
      currentPeerId = peerId
      setData({ peerId, avatars, avatarsMiddleware, length })
      plate.setHidden(false)
      if(prev) prev.avatarsMiddleware.destroy()
    }
  }

  const fromFull = (peerId: PeerId, peerFull: PeerFull | undefined) => {
    const recentRequesters = peerFull?._ === 'channelFull' ? peerFull.recent_requesters : undefined
    const hidden = useAppStateStore.getState().hideChatJoinRequests[peerId]
    // tweb `components/chat/requests.tsx:139` буквально: `hidden` — `Date.now()`
    // при закрытии (мс), `ONE_DAY` — 86400 (`helpers/date.ts:9`, секунды).
    if(recentRequesters && (!hidden || (Date.now() - hidden) >= ONE_DAY)) {
      return set(
        peerId,
        recentRequesters.slice(0, 3).map((userId) => toPeerId(userId, false)),
        (peerFull as Extract<PeerFull, { _: 'channelFull' }>).requests_pending ?? 0,
      )
    }

    return set(peerId, [], 0)
  }

  const setPeerId = (peerId: PeerId): RequestsAcked => {
    if(waiting) waiting.cancelled = true
    waiting = undefined

    const cached = cachedPeerFull(peerId)
    if(cached) {
      return { cached: true, result: fromFull(peerId, cached) }
    }

    const signal = waiting = { cancelled: false }
    return { cached: false, result: waitForFullPeer(peerId, signal).then((full) => fromFull(peerId, full)) }
  }

  return {
    ...plate,
    set,
    unset,
    setPeerId,
    destroy: () => {
      if(waiting) waiting.cancelled = true
      const prev = data()
      if(prev) prev.avatarsMiddleware.destroy()
      plate.destroy()
    },
  }
}
