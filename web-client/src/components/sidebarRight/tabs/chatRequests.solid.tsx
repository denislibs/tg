/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/chatRequests.tsx:1-95`
 * (812502980) — вкладка правой колонки «Заявки на вступление»
 * (`AppChatRequestsTab`, tweb `tabs.ts:464-468`). Задача 0б-7 волны 7 (П-1).
 * Открывает её строка «Заявки» редактора чата (`editChat.tsx:700-708`).
 *
 *   .sidebar-content > div.selector (`AppSelectPeers`, `peerType: ['custom']`)
 *     строка: … + div.chatlist-chat-buttons > [Добавить] [Отклонить]           (:44-51)
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. `isBroadcast` — по зеркалу (`isBroadcastPeer`).
 *  2. `placeholderElementsGap` (:52) не передаётся — плейсхолдера строк у
 *     нашего селектора нет (его расхождение 4).
 *  3. `appImManager` — синглтон (`useHotReloadGuard` — обвязка их дев-сборки).
 */
import type { Component } from 'solid-js'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import { formatFullSentTime } from '@helpers/date'
import Button from '@components/button'
import { i18n } from '@lib/langPack'
import appImManager from '@lib/appImManager'
import type { DialogElement } from '@lib/appDialogsManager'
import { isBroadcastPeer } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import { createSelectorForTab } from './participantsSelector'
import { getImportersLoader } from './chatInviteLinkShared'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppChatRequestsTab } from '@components/solidJsTabs/tabs'

const ChatRequests: Component = () => {
  const [tab] = useSuperTab<typeof AppChatRequestsTab>()
  const promiseCollector = usePromiseCollector()
  const chatId = tab.payload
  const peerId = toPeerId(chatId as number, true)
  const managers = tab.managers!

  promiseCollector.collect((async() => {
    const isBroadcast = isBroadcastPeer(peerId)
    tab.container.classList.add('edit-peer-container', 'chat-members-container', 'chat-requests-container')
    tab.title.replaceChildren(i18n(isBroadcast ? 'SubscribeRequests' : 'MemberRequests'))

    const { importersMap, deleteImporter, load } = getImportersLoader({
      chatId,
      managers,
      requested: true,
      link: undefined,
    })

    const dialogElements: Map<PeerId, DialogElement> = new Map()
    const { selector, loadPromise } = createSelectorForTab({
      appendTo: tab.content,
      managers,
      middleware: tab.middlewareHelper.get(),
      peerId,
      peerType: ['custom'],
      getMoreCustom: load,
      getSubtitleForElement: (peerId) => i18n('RequestedToJoinAt', [formatFullSentTime(importersMap.get(peerId)?.date ?? 0)]),
      processElementAfter: (peerId, dialogElement) => {
        const buttons = document.createElement('div')
        buttons.classList.add('chatlist-chat-buttons')
        const button = Button('btn-primary btn-control-small btn-color-primary', { text: isBroadcast ? 'AddToChannel' : 'AddToGroup' })
        const button2 = Button('btn-transparent btn-control-small primary', { text: 'Dismiss' })
        buttons.append(button, button2)
        dialogElement.container.append(buttons)
        dialogElements.set(peerId, dialogElement)
      },
    })

    let changedLength = 0
    attachClickEvent(selector.scrollable.container, async(e) => {
      const target = findUpClassName(e.target!, 'chatlist-chat')
      if(!target) {
        return
      }

      const peerId = +target.dataset.peerId!
      const dialogElement = dialogElements.get(peerId)!

      const addButton = findUpClassName(e.target!, 'btn-color-primary')
      const dismissButton = findUpClassName(e.target!, 'btn-transparent')
      const add = addButton ? true : (dismissButton ? false : undefined)

      if(add === undefined) {
        void appImManager.setInnerPeer({ peerId })
        return
      }

      const toggle = dialogElement.toggleDisability(true)
      try {
        await managers.groups.hideChatJoinRequest(chatId, peerId, add)
        ++changedLength
        selector.deletePeerId(peerId)
        dialogElements.delete(peerId)
        deleteImporter(peerId)
      } catch{
        toggle()
      }
    }, { listenerSetter: tab.listenerSetter })

    tab.eventListener.addEventListener('close', () => {
      tab.eventListener.dispatchEvent('finish', changedLength)
    })

    await loadPromise
  })())

  return null
}

export default ChatRequests
