// Порт tweb `src/helpers/dom/createParticipantContextMenu.ts` — контекстное
// меню участника чата над строками `.chatlist-chat` (вкладка «Участники» shared
// media, `appSearchSuper.ts:1577-1583`; в tweb также `chatMembers.tsx:97-103`).
//
// Семь пунктов (:40-118) и их `verify` — дословно; права читаются в `onOpen`
// (:127-141), пункт без права НЕ СОЗДАЁТСЯ (`createContextMenu` фильтрует по
// `verify`) — скрыт, а не задизейблен. Эталон — дамп
// `docs/tweb/dom/dumps/15-right-15-member-context-menu.json`.
//
// Адаптации (каждая — из-за отсутствующей у нас подсистемы):
//   • `rootScope.managers.appChatsManager.*` (getChat/isBroadcast/hasRights) →
//     ЗЕРКАЛО карточек (`cachedChat` + предикаты `core/peers`): у оригинала это
//     RPC в воркер за той же карточкой, у нас она лежит на главном потоке;
//   • `hasRights(chatId, 'change_permissions')` → `hasRights(chat, 'ban_users')`:
//     у оригинала оба действия — ОДНА ветка `case 'ban_users': case
//     'change_permissions'` (`hasRights.ts:135-138`), а в нашем `ChatRights`
//     объявлено только первое имя;
//   • `slider` + `openUserPermissionsTab(slider, chatId, participant, isAdmin)`
//     (Solid-вкладка `AppUserPermissionsTab`, у нас не портирована) →
//     колбэк `openUserPermissions(participant, isAdmin)`; кто его исполняет —
//     решает владелец меню (сегодня — React-экран прав участника);
//   • `appImManager.setInnerPeer({peerId})` → колбэк `openPeer(peerId)` — тот же
//     шов, что `BubblesNavigation.openPeer` у ленты: глобального
//     `appImManager` у нас нет;
//   • действия — наши ручки `groups.addMember`/`unban`/`removeMember` вместо
//     `appChatsManager.addToChat`/`editBanned(…, пустые права)`/`kickFromChat`;
//     `handleMissingInvitees` после добавления (:53-55) не портирован — наша
//     ручка «кого не удалось пригласить» не отдаёт;
//   • `canEditAdmin(chat, participant, myId)` → `canEditAdmin(chat)` (шапка
//     `core/peers/participant.ts`: `promoted_by` на проводе нет).
// Правки под строгий tsconfig: состояние меню (`target`, `participant`, …)
// объявлено с `!`/`| undefined`, `pFlags` участника читается через `?.`.
import createContextMenu from '@helpers/dom/createContextMenu'
import findUpClassName from '@helpers/dom/findUpClassName'
import type { Middleware } from '@helpers/middleware'
import type { ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import rootScope from '@lib/rootScope'
import { cachedChat } from '@core/peerCache'
import { isBroadcast as isBroadcastChat } from '@core/peers/predicates'
import { hasRights } from '@core/peers/rights'
import { toPeerId } from '@core/peers/peerId'
import type { Chat } from '@core/peers/peer'
import { canEditAdmin, isParticipantAdmin, isParticipantCreator, type ChannelParticipant } from '@core/peers/participant'
import type { Managers } from '@/client/bootstrap'

export type Participant = ChannelParticipant

/** Ручки, которыми меню действует: добавить обратно, снять бан, выгнать. */
export type ParticipantContextMenuManagers = {
  groups: Pick<Managers['groups'], 'addMember' | 'removeMember' | 'unban'>
}

export default function createParticipantContextMenu(options: {
  listenTo: HTMLElement,
  appendTo?: HTMLElement,
  onOpen?: () => unknown,
  onClose?: () => unknown,
  chatId: number,
  participants: Map<PeerId, Participant>,
  middleware?: Middleware,
  managers: ParticipantContextMenuManagers,
  openPeer?: (peerId: PeerId) => void,
  openUserPermissions?: (participant: Participant, isAdmin?: boolean) => void
}) {
  const { listenTo, appendTo, onOpen, onClose, chatId, participants, middleware, managers, openPeer, openUserPermissions } = options
  const chatPeerId = toPeerId(chatId, true)
  let target: HTMLElement,
    participant: Participant,
    participantPeerId: PeerId,
    chat: Chat | undefined,
    isBroadcast: boolean,
    isBanned: boolean,
    canChangePermissions: boolean,
    canManageAdmins: boolean

  const openPermissions = (isAdmin?: boolean) => {
    openUserPermissions?.(participant, isAdmin)
  }

  function getButtons(): ButtonMenuItemOptionsVerifiable[] {
    return [{
      icon: 'message',
      text: 'SendMessage',
      onClick: () => {
        openPeer?.(participantPeerId)
      },
    }, {
      icon: 'adduser',
      text: isBroadcast ? 'AddToChannel' : 'AddToGroup',
      onClick: () => {
        if(isBanned) {
          void managers.groups.addMember(chatPeerId, participantPeerId)
        }
      },
      verify: () => {
        if(!isBanned) {
          return false
        }

        return true
      },
    }, {
      icon: 'promote',
      text: 'SetAsAdmin',
      onClick: () => openPermissions(true),
      verify: () => canManageAdmins && !isParticipantAdmin(participant),
    }, {
      icon: 'admin',
      text: 'EditAdminRights',
      onClick: () => openPermissions(true),
      verify: () => isParticipantAdmin(participant) && canEditAdmin(chat),
    }, {
      icon: 'restrict',
      text: 'KickFromSupergroup',
      onClick: () => openPermissions(false),
      verify: () => canChangePermissions && (
        participant._ === 'channelParticipant' ||
        (participant._ === 'channelParticipantBanned' && !participant.pFlags?.left)
      ),
    }, {
      icon: 'delete',
      text: 'Delete',
      onClick: () => {
        if(isBanned) {
          void managers.groups.unban(chatPeerId, participantPeerId)
        }
      },
      verify: () => {
        if(!isBanned || !canChangePermissions || participantPeerId === rootScope.myId) {
          return false
        }

        return true
      },
    }, {
      icon: 'delete',
      text: 'KickFromGroup',
      onClick: () => {
        void managers.groups.removeMember(chatPeerId, participantPeerId)
      },
      verify: () => canChangePermissions &&
        participantPeerId !== rootScope.myId &&
        !isParticipantCreator(participant) &&
        (!isParticipantAdmin(participant) || canEditAdmin(chat)) &&
        (participant._ === 'channelParticipant' || !isBanned),
    }]
  }

  const buttons: ButtonMenuItemOptionsVerifiable[] = []
  return createContextMenu({
    listenTo: listenTo,
    appendTo,
    middleware,
    findElement: (e) => target = findUpClassName(e.target!, 'chatlist-chat')!,
    onOpen: () => {
      participantPeerId = +target.dataset.peerId!
      participant = participants.get(participantPeerId)!
      chat = cachedChat(chatPeerId)
      isBroadcast = isBroadcastChat(chat)
      canChangePermissions = canManageAdmins = hasRights(chat, 'ban_users')

      target.classList.add('menu-open')
      isBanned = canChangePermissions && participant._ === 'channelParticipantBanned' && !!participant.pFlags?.left
      buttons.splice(0, Infinity, ...getButtons())
      return onOpen?.()
    },
    onClose: () => {
      target.classList.remove('menu-open')
      return onClose?.()
    },
    buttons,
  })
}
