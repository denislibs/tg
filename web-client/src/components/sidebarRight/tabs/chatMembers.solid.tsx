/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/chatMembers.tsx:1-118`
 * (812502980) — вкладка правой колонки «Участники»/«Подписчики»
 * (`AppChatMembersTab`, tweb `tabs.ts:476-480`). Задача 0б-7 волны 7 (П-1).
 * Открывает её строка редактора чата (`editChat.tsx:857-863`).
 *
 *   .sidebar-content
 *     button.btn-corner.is-visible (добавить, при праве `invite_users`)   (:31-41)
 *     div.selector (`AppSelectPeers` на участниках канала)                 (:47-55)
 *
 * Прокрутка списка — подгрузка `AppSelectPeers` страницами по 50
 * (`getMoreChannelParticipants`, `onScrolledBottom`), как у оригинала (RS-06).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. «Скрыть участников» (`canHideMembers` + секция `ChannelHideMembers`,
 *     :43-46, :59-95): нет на бэкенде ни `channelFull.participants_hidden`, ни
 *     `toggleParticipantsHidden`, ни `hidden_members_group_size_min` (Б-116) —
 *     секция не рисуется, `channelFull` не грузится.
 *  2. Карточка чата — из зеркала (`cachedChat`/`isBroadcast`), а не RPC.
 *  3. Меню участника — колбэками `openPeer`/`openUserPermissions` (шапка
 *     `helpers/dom/createParticipantContextMenu.ts`).
 */
import type { Component } from 'solid-js'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import createParticipantContextMenu from '@helpers/dom/createParticipantContextMenu'
import { hasRights } from '@core/peers/rights'
import { isBroadcast as isBroadcastChat } from '@core/peers/predicates'
import { cachedChat } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import { i18n } from '@lib/langPack'
import appImManager from '@lib/appImManager'
import addChatUsers from '@components/addChatUsers'
import ButtonCorner from '@components/buttonCorner'
import type SidebarSlider from '@components/slider'
import { createSelectorForParticipants } from './participantsSelector'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import { openUserPermissionsTab, type AppChatMembersTab } from '@components/solidJsTabs/tabs'

const ChatMembers: Component = () => {
  const [tab] = useSuperTab<typeof AppChatMembersTab>()
  const promiseCollector = usePromiseCollector()
  const chatId = tab.payload
  const peerId = toPeerId(chatId as number, true)
  const slider = tab.slider as SidebarSlider

  promiseCollector.collect((async() => {
    // расхождение 2
    const chat = cachedChat(peerId)
    const isBroadcast = isBroadcastChat(chat)
    tab.container.classList.add('edit-peer-container', 'chat-members-container')
    tab.title.replaceChildren(i18n(isBroadcast ? 'PeerInfo.Subscribers' : 'GroupMembers'))

    const canAddMembers = hasRights(chat, 'invite_users')
    const addBtn = ButtonCorner({ icon: 'addmember_filled', className: 'is-visible', ariaLabel: 'GroupAddMembers' })
    if(canAddMembers) tab.content.append(addBtn)

    attachClickEvent(addBtn, () => {
      addChatUsers({
        peerId,
        slider,
      })
    }, { listenerSetter: tab.listenerSetter })

    // `canHideMembers` — расхождение 1

    const { selector, loadPromise } = createSelectorForParticipants({
      appendTo: tab.content,
      managers: tab.managers!,
      middleware: tab.middlewareHelper.get(),
      peerId,
      channelParticipantsUpdateFilter: (participant) => !!participant,
    })

    // расхождение 3
    createParticipantContextMenu({
      chatId: chatId as number,
      listenTo: selector.scrollable.container,
      participants: selector.participants,
      managers: tab.managers!,
      middleware: tab.middlewareHelper.get(),
      openPeer: (peerId) => void appImManager.setInnerPeer({ peerId }),
      openUserPermissions: (participant, isAdmin) => openUserPermissionsTab(slider, chatId, participant, isAdmin),
    })

    await loadPromise
  })())

  return null
}

export default ChatMembers
