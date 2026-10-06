/**
 * Порт tweb `src/components/sidebarRight/tabs/chatRemovedUsersSource.ts:1-75`
 * (812502980) — источник вкладки «Удалённые» для чата (0б-7 волны 7).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Карточка чата — из зеркала (`cachedChat`/`isBroadcast`), а не RPC.
 *  2. ВРЕМЕННО до 2C-16: выбор, кого удалить (`showPickUserPopup`, :49-64), —
 *     вкладка выбора участников `AppAddMembersTab` (`channelParticipantsPeerId`),
 *     как у источника админов; удаляет `groups.kickFromChat` по ключу пира.
 *  3. Меню участника — колбэками (шапка `createParticipantContextMenu.ts`).
 */
import type AppSelectPeers from '@components/appSelectPeers.solid'
import createParticipantContextMenu from '@helpers/dom/createParticipantContextMenu'
import { AppAddMembersTab, openUserPermissionsTab } from '@components/solidJsTabs/tabs'
import type SidebarSlider from '@components/slider'
import appImManager from '@lib/appImManager'
import { hasRights } from '@core/peers/rights'
import { isBroadcast as isBroadcastChat } from '@core/peers/predicates'
import { cachedChat } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import type { Middleware } from '@helpers/middleware'
import { createSelectorForParticipants } from './participantsSelector'
import {
  isRemovedParticipant,
  type RemovedUsersSelectorOptions,
  type RemovedUsersSource,
  type RemovedUsersTab,
} from './removedUsersSource'

export default function createChatRemovedUsersSource(options: {
  tab: RemovedUsersTab,
  chatId: ChatId,
  middleware: Middleware
}): RemovedUsersSource {
  const { tab, chatId, middleware } = options
  const peerId = toPeerId(chatId as number, true)
  const slider = tab.slider as SidebarSlider
  const managers = tab.managers!
  // расхождение 1
  const chat = cachedChat(peerId)
  const isBroadcast = isBroadcastChat(chat)

  return {
    canChangePermissions: hasRights(chat, 'change_permissions'),
    caption: isBroadcast ? 'NoBlockedChannel2' : 'NoBlockedGroup2',
    createSelector: (selectorOptions: RemovedUsersSelectorOptions) => {
      return createSelectorForParticipants({
        ...selectorOptions,
        peerId,
        channelParticipantsFilter: (q) => ({
          _: 'channelParticipantsKicked',
          q,
        }),
        channelParticipantsUpdatePeerId: peerId,
        channelParticipantsUpdateFilter: isRemovedParticipant,
      })
    },
    openAddParticipant: () => {
      // расхождение 2 — ВРЕМЕННО до 2C-16
      void slider.createTab(AppAddMembersTab).open({
        type: 'channel',
        title: 'RemovedUsers',
        placeholder: 'SearchPlaceholder',
        channelParticipantsPeerId: peerId,
        skippable: false,
        takeOut: (peerIds) => {
          const chosen = peerIds[0]
          if(chosen !== undefined) {
            return managers.groups.kickFromChat(chatId, chosen)
          }
        },
      })
    },
    attachSelectorBehavior: (currentSelector: AppSelectPeers) => {
      // расхождение 3
      createParticipantContextMenu({
        chatId: chatId as number,
        listenTo: currentSelector.scrollable.container,
        participants: currentSelector.participants,
        managers,
        middleware,
        openPeer: (peerId) => void appImManager.setInnerPeer({ peerId }),
        openUserPermissions: (participant, isAdmin) => openUserPermissionsTab(slider, chatId, participant, isAdmin),
      })
    },
  }
}
