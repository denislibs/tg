/** @jsxImportSource solid-js */
// Порт tweb `src/components/popups/sharedFolderInvite.tsx` (812502980) — попап
// «Добавить папку» по ссылке `t.me/addlist/<slug>` (`internalLinkProcessor.processListLink`).
//
//   div.popup.popup-forward.popup-chatlist-invite
//     div.popup-container > div.popup-header (крестик, «Add Folder»)
//       div.popup-body > div.selector… (`AppSelectPeers`, :101-125)
//         [ряд папок `menu-horizontal-scrollable` + `.popup-chatlist-invite-description`] — в начало скроллера (:189)
//       div.popup-footer > button.popup-footer-button (`.popup-chatlist-invite-button-text` с бейджем)
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Ветки «уже добавлена» (`chatlistsChatlistInviteAlready`: `missing_peers`/
//     `already_peers`, `SharedFolder.Link.TitleAdd`/`…Already`), выхода из папки
//     (`deleting`, `getLeaveChatlistSuggestions`) и обновлений (`updating`,
//     `joinChatlistUpdates`) не портированы: наш `GET /folder_invites/{slug}`
//     отдаёт только свежее приглашение (`{title, chats}`), ручек выхода и
//     обновлений нет (Б-52, Б-76).
//  2. Название папки — строка без сущностей (`FolderInvitePreview.title`), поэтому
//     `wrapFolderTitle` не нужен (то же расхождение 4 у `sidebarLeft/tabs/sharedFolder.solid.tsx`).
//  3. «Снять всё» — циклом `remove`: `removeBatch` у нашего `AppSelectPeers` не
//     портирован (его шапка, п. 14).
//  4. После вступления tweb выбирает вступившую папку (`filter_joined` →
//     `setSelectedFolderId`, `stores/folders.ts:201-203`) по `updateDialogFilter` ответа.
//     Наша ручка отвечает `boolTrue` без номера папки: перечитываем папки и диалоги
//     (`loadFolders({overwrite: true})`), вкладку не переключаем.
//  5. Лимит папок (`DIALOG_FILTERS_TOO_MUCH` → `showLimitPopup('folders')`) — попапа
//     лимитов у нас нет, отказ оставляет попап открытым (кнопка снова активна).
import { createSignal, onCleanup } from 'solid-js'
import PopupElement, { createPopup } from '@components/popups/indexTsx.solid'
import AppSelectPeers from '@components/appSelectPeers.solid'
import Tabs from '@components/tabs.solid'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { getMiddleware } from '@helpers/middleware'
import ListenerSetter from '@helpers/listenerSetter'
import I18n, { i18n, _i18n } from '@lib/langPack'
import type { Managers } from '@/client/bootstrap'
import type { FolderInvitePreview } from '@core/managers/foldersManager'
import { loadFolders } from '@stores/foldersStore'

const CLASS_NAME = 'popup-chatlist-invite'

export default function showSharedFolderInvitePopup(options: {
  chatlistInvite: FolderInvitePreview,
  slug: string,
  managers: Managers
}) {
  const { chatlistInvite, slug, managers } = options
  const middlewareHelper = getMiddleware()
  const middleware = middlewareHelper.get()
  const listenerSetter = new ListenerSetter()

  // the picker owns the popup's scrolling area, so it IS the body
  const bodyEl = document.createElement('div')
  bodyEl.classList.add('popup-body')

  const [show, setShow] = createSignal(false)
  const [confirmDisabled, setConfirmDisabled] = createSignal(false)

  const activeTitle = document.createElement('span')
  activeTitle.textContent = chatlistInvite.title

  // the row never scrolls and takes no clicks here — it only shows where the folder lands
  const n = (
    <div class="menu-horizontal-scrollable">
      <Tabs.Menu>
        <Tabs.MenuTab>{i18n('FilterAllChats')}</Tabs.MenuTab>
        <Tabs.MenuTab class="active">{activeTitle}</Tabs.MenuTab>
        <Tabs.MenuTab>{i18n('FilterPersonal')}</Tabs.MenuTab>
      </Tabs.Menu>
      <div class="inner-shadow inner-shadow-inset" />
    </div>
  ) as HTMLElement

  const description = document.createElement('div')
  description.classList.add(CLASS_NAME + '-description', 'subtitle')
  _i18n(description, 'SharedFolder.Link.Description')

  const counterI18n = new I18n.IntlElement()
  const selectAllI18n = new I18n.IntlElement()

  const peerIds: PeerId[] = chatlistInvite.chats.map((chat) => chat.peer_id)

  const addFolderI18n = new I18n.IntlElement({ key: 'SharedFolder.Link.Title' })
  const addFolderText = addFolderI18n.element
  addFolderText.classList.add(`${CLASS_NAME}-button-text`)

  let shouldDeselect = false
  const onSelectionChange = (length: number) => {
    counterI18n.update({
      key: 'SharedFolder.Link.Chats',
      args: [i18n('Chats', [length])],
    })

    shouldDeselect = length === peerIds.length
    selectAllI18n.update({
      key: shouldDeselect ? 'DeselectAll' : 'SelectAll',
    })

    if(length) addFolderText.dataset.badge = '' + length
    addFolderText.classList.toggle('has-badge', !!length)

    setConfirmDisabled(!length)
  }

  const selector: AppSelectPeers = new AppSelectPeers({
    middleware,
    appendTo: bodyEl,
    onChange: onSelectionChange,
    onFirstRender: () => {
      setShow(true)
      selector.checkForTriggers() // ! due to zero height before mounting
    },
    multiSelect: true,
    noSearch: true,
    sectionNameLangPackKey: counterI18n.element,
    avatarSize: 'abitbigger',
    managers,
    peerType: [],
    meAsSaved: false,
  })

  selectAllI18n.element.classList.add('sidebar-left-section-name-right')
  selector.section.title?.append(selectAllI18n.element)

  attachClickEvent(selectAllI18n.element, () => {
    if(shouldDeselect) {
      peerIds.forEach((peerId) => selector.remove(peerId)) // расхождение 3
    } else {
      selector.addBatch(peerIds)
    }
  }, { listenerSetter })

  selector.scrollable.attachBorderListeners()
  selector.scrollable.prepend(n, description)

  // resolving closes the popup; throwing leaves it open with the button live again
  const onConfirm = async() => {
    await managers.folders.joinInvite(slug, [...selector.selected] as PeerId[])
    // расхождение 4
    void managers.dialogs.refresh()
      .then(() => loadFolders(managers, { overwrite: true }))
      .catch(() => { /* список догонит следующий refresh */ })
  }

  selector.addInitial(peerIds)
  void selector.renderResultsFunc(peerIds)

  if(!peerIds.length) {
    onSelectionChange(0)
  }

  createPopup(() => {
    onCleanup(() => {
      listenerSetter.removeAll()
      middlewareHelper.destroy()
    })

    return (
      <PopupElement class={'popup-forward ' + CLASS_NAME} closable show={show()}>
        <PopupElement.Header>
          <PopupElement.CloseButton />
          <PopupElement.Title>{i18n('SharedFolder.Link.Title')}</PopupElement.Title>
        </PopupElement.Header>
        {bodyEl}
        <PopupElement.Footer>
          <PopupElement.FooterButton disabled={confirmDisabled()} callback={onConfirm}>
            {addFolderText}
          </PopupElement.FooterButton>
        </PopupElement.Footer>
      </PopupElement>
    )
  })
}
