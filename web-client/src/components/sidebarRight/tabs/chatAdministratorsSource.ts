/**
 * Порт tweb `src/components/sidebarRight/tabs/chatAdministratorsSource.ts:1-85`
 * (812502980) — источник вкладки «Администраторы» для чата (0б-7 волны 7).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Карточка чата — из зеркала (`cachedChat`), а не `appChatsManager.getChat`
 *     RPC; `chatFull` и `appConfig` (:27-34) не грузятся: их единственный
 *     потребитель — «Антиспам» (:36-46), а его нет на бэкенде (ни
 *     `channelFull.antispam`, ни `toggleAntiSpam`, ни `telegram_antispam_group_size_min`,
 *     Б-116) — поля `antiSpam` у источника нет.
 *  2. ВРЕМЕННО до 2C-16: выбор нового админа (`showPickUserPopup`, :58-70) —
 *     вкладка выбора участников `AppAddMembersTab` на участниках канала
 *     (`channelParticipantsPeerId`, тот же приём, что у «Заблокированных»,
 *     `blockedUsers.solid.tsx`). Карты участников попапа (`popup.selector
 *     .participants`) у вкладки нет — выбранный отдаётся вкладке прав обычным
 *     участником (`channelParticipant`): права уже назначенного админа она
 *     откроет с нуля.
 *  3. Меню участника — `openUserPermissions`/`openPeer` колбэками (шапка
 *     `helpers/dom/createParticipantContextMenu.ts`), `managers` — параметром.
 *  4. Фильтр `channelParticipantsAdmins` и признак «участник ещё админ»
 *     (`channelParticipantsUpdateFilter`) — те же; живое обновление — по
 *     `chat_update` (расхождение 1 `appSelectPeers.solid.tsx`).
 */
import type AppSelectPeers from '@components/appSelectPeers.solid'
import createParticipantContextMenu from '@helpers/dom/createParticipantContextMenu'
import { AppAddMembersTab, openUserPermissionsTab } from '@components/solidJsTabs/tabs'
import type SidebarSlider from '@components/slider'
import appImManager from '@lib/appImManager'
import { hasRights } from '@core/peers/rights'
import { isParticipantAdmin } from '@core/peers/participant'
import { cachedChat } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import type { Middleware } from '@helpers/middleware'
import { createSelectorForParticipants } from './participantsSelector'
import type {
  AdministratorsSelectorOptions,
  AdministratorsSource,
  AdministratorsTab,
} from './administratorsSource'

export default function createChatAdministratorsSource(options: {
  tab: AdministratorsTab,
  chatId: ChatId,
  middleware: Middleware
}): AdministratorsSource {
  const { tab, chatId, middleware } = options
  const peerId = toPeerId(chatId as number, true)
  const slider = tab.slider as SidebarSlider
  // расхождение 1
  const chat = cachedChat(peerId)

  return {
    canAddAdmins: hasRights(chat, 'add_admins'),
    createSelector: (selectorOptions: AdministratorsSelectorOptions) => {
      return createSelectorForParticipants({
        ...selectorOptions,
        peerId,
        channelParticipantsFilter: (q) => {
          return { _: 'channelParticipantsAdmins', q }
        },
        channelParticipantsUpdateFilter: isParticipantAdmin,
      })
    },
    openAddAdmin: (openPermissions) => {
      // расхождение 2 — ВРЕМЕННО до 2C-16
      void slider.createTab(AppAddMembersTab).open({
        type: 'channel',
        title: 'Administrators',
        placeholder: 'SearchPlaceholder',
        channelParticipantsPeerId: peerId,
        skippable: false,
        takeOut: (peerIds) => {
          const chosen = peerIds[0]
          if(chosen !== undefined) {
            openPermissions({ _: 'channelParticipant', user_id: chosen, date: 0 })
          }
        },
      })
    },
    openPermissions: ({ participant }) => {
      if(participant) {
        openUserPermissionsTab(slider, chatId, participant, true)
      }
    },
    attachSelectorBehavior: (selector: AppSelectPeers) => {
      // расхождение 3
      createParticipantContextMenu({
        chatId: chatId as number,
        listenTo: selector.scrollable.container,
        participants: selector.participants,
        managers: tab.managers!,
        middleware,
        openPeer: (peerId) => void appImManager.setInnerPeer({ peerId }),
        openUserPermissions: (participant, isAdmin) => openUserPermissionsTab(slider, chatId, participant, isAdmin),
      })
    },
  }
}
