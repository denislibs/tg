/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/chatlistContacts.tsx` (812502980, 118 строк):
 * секция «Контакты» под коротким списком чатов. Её создаёт и снимает
 * `appDialogsManager._onListLengthChange` (tweb `appDialogsManager.ts:1789-1817`),
 * когда во «Всех чатах» меньше `MIN_DIALOGS_WITHOUT_CONTACTS` строк.
 *
 * Расхождения с оригиналом:
 *  1. Менеджеры — наши: `contacts.getContactsPeerIds` (у tweb
 *     `appUsersManager.getContactsPeerIds(undefined, undefined, 'online')`),
 *     `contacts.isContact` (`appPeersManager.isContact`), `dialogs.hasDialog`
 *     (`appMessagesManager.getDialogOnly`). Порядок `'online'` у нашего
 *     владельца контактов не заведён (расхождение 4 шапки
 *     `core/managers/contactsManager.ts`) — берём `'none'`: строки и так
 *     сортирует по присутствию `SortedUserList` (`getIndex`), онлайн-порядок
 *     оригинала решает лишь, какие контакты попадут в первую страницу.
 */
import { createSignal } from 'solid-js'
import Section from '@components/section.solid'
import SortedUserList, { type SortedUserListManagers } from '@components/sortedUserList'
import { getMiddleware } from '@helpers/middleware'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import filterAsync from '@helpers/array/filterAsync'
import windowSize from '@helpers/windowSize'
import { isAnyChat } from '@core/peers/peerId'
import type { Managers } from '@/client/bootstrap'

const CONTACT_ROW_HEIGHT = 60

export type ChatlistContactsManagers = SortedUserListManagers & {
  contacts: Pick<Managers['contacts'], 'getContactsPeerIds' | 'isContact'>,
  dialogs: Pick<Managers['dialogs'], 'hasDialog'>,
}

export type ChatlistContacts = ReturnType<typeof createChatlistContacts>

/**
 * The "Contacts" section under a short chat list: with only a handful of dialogs the sidebar
 * would be mostly empty, so the contacts you have never written to are offered there instead.
 * It renders lazily — a page at a time as the chat list is scrolled — and hides itself while
 * nothing has passed the filter yet.
 */
export function createChatlistContacts(options: {
  managers: ChatlistContactsManagers,
  /** The rendered count changed — the sidebar rechecks its empty-placeholder layout. */
  onLengthChange: () => void,
  /** Hands the rendered list over so the sidebar can attach its own chat-row click handling. */
  attachToList: (list: HTMLUListElement) => void,
}) {
  const { managers } = options
  const middlewareHelper = getMiddleware()
  const middleware = middlewareHelper.get()

  const [hasItems, setHasItems] = createSignal(false)

  // the contact ids arrive asynchronously; until they do there is nothing to page through
  // and nothing to reconcile against
  let contacts: PeerId[] | undefined

  // a contact the user already has a dialog with belongs in the chat list, not here
  const isContactWithoutDialog = async(peerId: PeerId) => {
    const [isContact, hasDialog] = await Promise.all([
      managers.contacts.isContact(peerId),
      managers.dialogs.hasDialog(peerId),
    ])

    return isContact && !hasDialog
  }

  const onListLengthChange = () => {
    setHasItems(!!sortedUserList.list.childElementCount)
    options.onLengthChange()
  }

  const sortedUserList: SortedUserList = new SortedUserList({
    avatarSize: 'abitbigger',
    createChatListOptions: {
      dialogSize: 48,
      new: true,
    },
    autonomous: false,
    onListLengthChange,
    managers,
    middleware,
  })

  const list = sortedUserList.list
  options.attachToList(list)

  const loadMore = () => {
    if(!contacts?.length) {
      return
    }

    const pageCount = windowSize.height / CONTACT_ROW_HEIGHT | 0
    void filterAsync(contacts.splice(0, pageCount), isContactWithoutDialog).then((peerIds) => {
      if(!middleware()) return
      peerIds.forEach((peerId) => void sortedUserList.add(peerId))
    })
  }

  const processContact = async(peerId: PeerId) => {
    if(!contacts || isAnyChat(peerId)) {
      return
    }

    const good = await isContactWithoutDialog(peerId)
    if(!middleware()) return

    const added = sortedUserList.has(peerId)
    if(!added && good) void sortedUserList.add(peerId)
    else if(added && !good) sortedUserList.delete(peerId)
  }

  const element = wrapSolidComponent(() => (
    <Section
      class="sidebar-left-contacts-section"
      classList={{ hide: !hasItems() }}
      name="Contacts"
      noDelimiter
      fakeGradientDelimiter
    >
      {list}
    </Section>
  ), middleware)

  void managers.contacts.getContactsPeerIds(undefined, undefined, 'none').then((peerIds) => {
    if(!middleware()) return

    contacts = peerIds.slice()
    loadMore()
    onListLengthChange()
  })

  return {
    element,
    loadMore,
    processContact,
    destroy: () => middlewareHelper.destroy(),
  }
}
