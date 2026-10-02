/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/blockedUsers.tsx:1-169 (812502980) —
 * вкладка «Заблокированные» (`AppBlockedUsersTab`, `solidJsTabs/tabs.ts`, tweb
 * `tabs.ts:248-258`). Задача 22 плана волны 2D. Открывает её хаб
 * «Конфиденциальность» с уже загруженной первой страницей (`{peerIds}`, tweb
 * `privacyAndSecurity.tsx:217`); дальше вкладка догружает список сама по 50.
 *
 * Разметка — дамп `docs/tweb/dom/dumps/14-left-16b-settings-blocked-users.json`:
 * подпись `BlockedUsersInfo` НАД карточкой (`:61`), в карточке — `ul.chatlist`
 * строк `chatlist-chat-abitbigger` (`lib/appDialogsManager.ts`, порт
 * `appDialogsManager.addDialogNew`), угловая кнопка `btn-corner` «добавить».
 *
 * Расхождения с оригиналом:
 *  1. `appUsersManager.getUser` (:44) → `managers.peers.getUsers([peerId])`:
 *     карточки кладёт владельцу `privacy.getBlocked` (порт `saveApiUsers`,
 *     `core/managers/privacyManager.ts`), синглтона менеджеров нет.
 *  2. `getPeerActiveUsernames(user)[0]` (:49-50) → `user.username`: коллекции
 *     `usernames` у нас нет, имя одно (`core/peers/predicates.ts`, шапка `isPublic`).
 *  3. `appUsersManager.toggleBlock/getBlocked` → `managers.privacy.toggleBlock/
 *     getBlocked` — там же, с событием `peer_block` после ответа сервера;
 *     `blockedMyStoriesFrom` (:120) у нас не бывает (нет блокировки историй).
 *  4. ВРЕМЕННО до 2C-16: `showPickUserPopup` (:68-75) ещё не портирован
 *     (`popups/pickUser.solid.tsx`, план 2C, задача 16) — выбор контакта
 *     открывается вкладкой `AppAddMembersTab` (задача 16 плана 2D, тот же
 *     `AppSelectPeers`) с заголовком и подсказкой оригинала; выбор — «Далее»,
 *     а не клик по строке, и можно отметить нескольких (каждого блокируем).
 *  5. `ButtonCorner` без `ariaLabel: 'Add'` (:64) — шапка `components/buttonCorner.ts`.
 *  6. `(dialogElement.container as any).dialogElement = dialogElement` (:41) делает
 *     сам `addDialogNew` (`lib/appDialogsManager.ts`, tweb `appDialogsManager.ts:2643`).
 */
import { onCleanup, onMount } from 'solid-js'
import { getOverlayRoot } from '@helpers/appWindow'
import { ButtonMenuSync } from '@components/buttonMenu'
import { addDialogNew, createChatList, DIALOG_LIST_ELEMENT_TAG, type DialogListElement } from '@lib/appDialogsManager'
import rootScope from '@lib/rootScope'
import findUpTag from '@helpers/dom/findUpTag'
import ButtonCorner from '@components/buttonCorner'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { formatUserPhone } from '@core/format/phone'
import { getUserStatusString } from '@core/presence'
import { attachContextMenuListener } from '@helpers/dom/attachContextMenuListener'
import positionMenu from '@helpers/positionMenu'
import contextMenuController from '@helpers/contextMenuController'
import Section from '@components/section.solid'
import type SidebarSlider from '@components/slider'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { AppAddMembersTab, type AppBlockedUsersTab } from '@components/solidJsTabs/tabs'

const BlockedUsers = () => {
  const [tab] = useSuperTab<typeof AppBlockedUsersTab>()
  const { peerIds } = tab.payload
  const managers = tab.managers!

  let captionEl!: HTMLDivElement
  let menuElement: HTMLElement | undefined

  const list = createChatList()

  const add = async(peerId: PeerId, append: boolean) => {
    const dialogElement = addDialogNew({
      peerId: peerId,
      container: list,
      rippleEnabled: true,
      avatarSize: 'abitbigger',
      append,
      wrapOptions: {
        middleware: tab.middlewareHelper.get(),
      },
      managers,
    })

    const { dom } = dialogElement

    const [user] = await managers.peers.getUsers([peerId])
    if(!user) {
      return
    }

    const username = user.username
    if(user.pFlags?.bot) {
      dom.lastMessageSpan.append('@' + username)
    } else {
      if(user.phone) dom.lastMessageSpan.textContent = formatUserPhone(user.phone)
      else dom.lastMessageSpan.append(username ? '@' + username : getUserStatusString(user))
    }
  }

  onMount(() => {
    tab.container.classList.add('blocked-users-container')
    captionEl.parentElement!.prepend(captionEl)
    tab.scrollable.container.classList.add('chatlist-container')

    const btnAdd = ButtonCorner({ icon: 'add', className: 'is-visible' })
    tab.content.append(btnAdd)

    attachClickEvent(btnAdd, () => {
      // ВРЕМЕННО до 2C-16: `showPickUserPopup({titleLangKey: 'BlockedUsers',
      // peerType: ['contacts'], placeholder: 'BlockModal.Search.Placeholder',
      // onSelect})` (:68-75) — расхождение 4 шапки.
      void (tab.slider as SidebarSlider).createTab(AppAddMembersTab).open({
        type: 'privacy',
        title: 'BlockedUsers',
        placeholder: 'BlockModal.Search.Placeholder',
        peerType: ['contacts'],
        filterPeerTypeBy: ['isUser'],
        skippable: false,
        takeOut: (chosen) => {
          for(const peerId of chosen) {
            void managers.privacy.toggleBlock(peerId, true)
          }
        },
      })
    }, { listenerSetter: tab.listenerSetter })

    for(const peerId of peerIds) {
      void add(peerId, true)
    }

    let target: HTMLElement
    const onUnblock = () => {
      const peerId = +target.dataset.peerId!
      void managers.privacy.toggleBlock(peerId, false)
    }

    const element = menuElement = ButtonMenuSync({
      buttons: [{
        icon: 'lockoff',
        text: 'Unblock',
        onClick: onUnblock,
        options: { listenerSetter: tab.listenerSetter },
      }],
    })
    element.id = 'blocked-users-contextmenu'
    element.classList.add('contextmenu')

    getOverlayRoot().append(element)

    attachContextMenuListener({
      element: tab.scrollable.container,
      callback: (e) => {
        const found = findUpTag(e.target!, DIALOG_LIST_ELEMENT_TAG)
        if(!found) {
          return
        }
        target = found

        if(!('touches' in e)) e.preventDefault() // cross-realm-safe mouse check (Document PiP window)
        // tweb `e.cancelBubble = true` — по спецификации DOM это ровно
        // `stopPropagation()`, а happy-dom отдаёт `cancelBubble` только геттером
        // (так же `helpers/dom/createContextMenu.ts`).
        if(!('touches' in e)) e.stopPropagation()

        positionMenu(e, element)
        contextMenuController.openBtnMenu(element)
      },
      listenerSetter: tab.listenerSetter,
    })

    tab.listenerSetter.add(rootScope)('peer_block', (update) => {
      const { peerId, blocked } = update

      const li = list.querySelector<DialogListElement>(`[data-peer-id="${peerId}"]`)
      if(blocked) {
        if(!li) {
          void add(peerId, false)
        }
      } else if(li) {
        li.dialogElement!.remove()
      }
    })

    const LOAD_COUNT = 50
    let loading = false
    tab.scrollable.onScrolledBottom = () => {
      if(loading) {
        return
      }

      loading = true
      void managers.privacy.getBlocked(list.childElementCount, LOAD_COUNT).then((res) => {
        for(const peerId of res.peerIds) {
          void add(peerId, true)
        }

        if(res.peerIds.length < LOAD_COUNT || list.childElementCount === res.count) {
          tab.scrollable.onScrolledBottom = undefined
        }

        tab.scrollable.checkForTriggers?.()
      }).finally(() => {
        loading = false
      })
    }
  })

  onCleanup(() => {
    menuElement?.remove()
  })

  return (
    <Section caption="BlockedUsersInfo" captionRef={(el) => captionEl = el}>
      {list}
    </Section>
  )
}

export default BlockedUsers
