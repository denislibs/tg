// ВРЕМЕННО до К-5: React-корень вкладки №0 правой колонки (`reactProfileTab.ts`) —
// панель профиля `UserInfoPanel` для пира вкладки. До К-3 её монтировал
// `Chat.tsx` (`:1534-1547`) и отдавал ей пропы экрана чата; теперь их собирает
// корень вкладки, ровно как tweb `AppSharedMediaTab` получает пир через
// `setPeer(peerId, threadId)` (`sharedMediaTab.tsx:68-83`) и дальше всё берёт сам.
//
// Отличия от прежних пропов `Chat.tsx`:
//  - активность вкладки — `appImManager.chat?.sharedMediaTab === tab` по
//    `chat_changing`/`peer_changed` (прежде — контекст инстанса чата);
//  - переход к сообщению из shared media — `appImManager.setInnerPeer({peerId,
//    lastMsgId})`, как у tweb (`appSearchSuper.ts:1569`), а не прыжок ленты
//    напрямую: тот же пир — тот же инстанс, `setPeer` прыгает сам;
//  - пересылку, удаление и «скачать» из меню элемента shared media класс
//    `AppSearchSuper` зовёт сам (П-5), хосту передавать нечего.
import { useMemo, useSyncExternalStore } from 'react'
import type { OpenPeer } from '@/data'
import { useChatList } from '@core/hooks/useChatList'
import { usePeers } from '@core/hooks/usePeers'
import { isDialogChat, resolveChatEntity } from '@core/chatEntity'
import type { SearchSuperActions } from '@core/hooks/useSearchSuper'
import appImManager from '@lib/appImManager'
import UserInfoPanel from '@components/UserInfoPanel'
import { AppEditContactTab } from '@components/solidJsTabs/tabs'
import appSidebarRight from './index'
import type AppReactProfileTab from './reactProfileTab'

export type ReactProfileTabViewProps = {
  tab: AppReactProfileTab
  peerId: PeerId
  threadId?: number
}

const onOpenPeer = (peer: OpenPeer) => { void appImManager.setInnerPeer({ peerId: peer.id }) }

const searchSuperActions: SearchSuperActions = {
  setInnerPeer: ({ peerId, lastMsgId, threadId }) => { void appImManager.setInnerPeer({ peerId, lastMsgId, threadId }) },
}

const subscribeActive = (callback: () => void) => {
  appImManager.addEventListener('chat_changing', callback)
  appImManager.addEventListener('peer_changed', callback)
  return () => {
    appImManager.removeEventListener('chat_changing', callback)
    appImManager.removeEventListener('peer_changed', callback)
  }
}

export default function ReactProfileTabView({ tab, peerId }: ReactProfileTabViewProps) {
  const isActive = useSyncExternalStore(subscribeActive, () => appImManager.chat?.sharedMediaTab === tab)
  const chatList = useChatList()
  usePeers(useMemo(() => [peerId], [peerId]))
  const chat = resolveChatEntity({ peerId }, chatList)
  const canAddMembers = isDialogChat(chat) && chat.type === 'group'

  return (
    <UserInfoPanel
      profileTab={tab}
      isActive={isActive}
      chat={chat}
      onOpenPeer={onOpenPeer}
      canAddMembers={canAddMembers}
      // ВРЕМЕННО до 3-1 — карандаш профиля tweb (`sharedMedia.tsx:675-686`):
      // вкладка «Изменить контакт» в тот же слайдер правой колонки.
      onEditContact={() => { void appSidebarRight.createTab(AppEditContactTab).open(Number(chat.id)) }}
      searchSuperActions={searchSuperActions}
    />
  )
}
