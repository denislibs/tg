/** @jsxImportSource solid-js */
// Порт tweb `src/tests/chatlistContacts.test.tsx` (812502980) на наши менеджеры
// (расхождение 1 шапки `chatlistContacts.solid.tsx`); строки — настоящий английский
// пакет (`@/test/lang`), а не мок `i18n` оригинала: его модуль у нас несёт и default-экспорт.
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lists: [] as Array<{
    list: HTMLUListElement,
    added: PeerId[],
    deleted: PeerId[],
    onListLengthChange: () => void,
    destroyed: boolean,
  }>,
}))

vi.mock('@components/sortedUserList', () => ({
  default: class SortedUserList {
    public list = document.createElement('ul')
    public added: PeerId[] = []
    public deleted: PeerId[] = []

    constructor(private options: { onListLengthChange: () => void, middleware: { onDestroy: (cb: () => void) => void } }) {
      options.middleware.onDestroy(() => {
        mocks.lists.find((entry) => entry.list === this.list)!.destroyed = true
      })

      mocks.lists.push({
        list: this.list,
        added: this.added,
        deleted: this.deleted,
        onListLengthChange: options.onListLengthChange,
        destroyed: false,
      })
    }

    public has(peerId: PeerId) {
      return this.added.includes(peerId) && !this.deleted.includes(peerId)
    }

    public add(peerId: PeerId) {
      this.added.push(peerId)
      this.list.append(document.createElement('li'))
      this.options.onListLengthChange()
    }

    public delete(peerId: PeerId) {
      this.deleted.push(peerId)
      this.list.lastElementChild?.remove()
      this.options.onListLengthChange()
    }
  },
}))

vi.mock('@helpers/windowSize', () => ({
  default: { get height() { return 120 } }, // → a page of two rows
}))

import '@/test/lang'
import { createChatlistContacts, type ChatlistContactsManagers } from '@components/sidebarLeft/chatlistContacts.solid'

const contactWithoutDialog: PeerId = 1
const contactWithDialog: PeerId = 2
const thirdContact: PeerId = 3

function create(contacts: PeerId[], dialogs: PeerId[] = [contactWithDialog]) {
  const onLengthChange = vi.fn()
  const attachToList = vi.fn()
  const managers = {
    contacts: {
      getContactsPeerIds: () => Promise.resolve(contacts.slice()),
      isContact: (peerId: PeerId) => Promise.resolve(contacts.includes(peerId)),
    },
    dialogs: {
      hasDialog: (peerId: PeerId) => Promise.resolve(dialogs.includes(peerId)),
    },
  } as unknown as ChatlistContactsManagers

  const placeholder = createChatlistContacts({ managers, onLengthChange, attachToList })
  return { placeholder, onLengthChange, attachToList, entry: mocks.lists[mocks.lists.length - 1] }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  mocks.lists.length = 0
  document.body.replaceChildren()
})

describe('chat list contacts placeholder', () => {
  it('renders the section the sidebar styles expect', async() => {
    const { placeholder, entry } = create([contactWithoutDialog], [])
    await flush()

    const container = placeholder.element
    expect(container.className).toBe('sidebar-left-section-container sidebar-left-contacts-section')

    const inner = container.firstElementChild!
    expect(inner.className).toBe('sidebar-left-section no-delimiter')
    // the gradient band separates the section from the chat list above it
    expect(inner.firstElementChild!.className).toBe('gradient-delimiter')

    const content = inner.children[1]
    expect(content.className).toBe('sidebar-left-section-content')
    expect(content.firstElementChild!.className).toBe('sidebar-left-h2 sidebar-left-section-name')
    expect(content.firstElementChild!.textContent).toBe('Contacts')
    expect(content.children[1]).toBe(entry.list)
  })

  it('stays hidden until a contact passes the filter', async() => {
    const { placeholder, attachToList, entry } = create([contactWithDialog])

    expect(placeholder.element.classList.contains('hide')).toBe(true)
    expect(attachToList).toHaveBeenCalledWith(entry.list)

    await flush()

    // the only contact already has a dialog, so nothing is rendered
    expect(entry.added).toEqual([])
    expect(placeholder.element.classList.contains('hide')).toBe(true)
  })

  it('renders contacts without a dialog and reveals the section', async() => {
    const { placeholder, onLengthChange, entry } = create([contactWithoutDialog, contactWithDialog])
    await flush()

    expect(entry.added).toEqual([contactWithoutDialog])
    expect(placeholder.element.classList.contains('hide')).toBe(false)
    expect(onLengthChange).toHaveBeenCalled()
  })

  it('pages through the contacts as the chat list asks for more', async() => {
    const { placeholder, entry } = create([contactWithoutDialog, thirdContact, 4], [])
    await flush()

    // 120px of window height fits two rows
    expect(entry.added).toEqual([contactWithoutDialog, thirdContact])

    placeholder.loadMore()
    await flush()
    expect(entry.added).toHaveLength(3)

    // nothing left to page through
    placeholder.loadMore()
    await flush()
    expect(entry.added).toHaveLength(3)
  })

  it('follows a peer gaining and losing its dialog', async() => {
    const dialogs: PeerId[] = []
    const { placeholder, entry } = create([contactWithoutDialog], dialogs)
    await flush()
    expect(entry.added).toEqual([contactWithoutDialog])

    // the user wrote to them: the row belongs to the chat list now
    dialogs.push(contactWithoutDialog)
    await placeholder.processContact(contactWithoutDialog)
    expect(entry.deleted).toEqual([contactWithoutDialog])
    expect(placeholder.element.classList.contains('hide')).toBe(true)

    // ...and back again
    dialogs.length = 0
    await placeholder.processContact(contactWithoutDialog)
    expect(entry.added).toEqual([contactWithoutDialog, contactWithoutDialog])
  })

  it('ignores chats and stops working once destroyed', async() => {
    const { placeholder, entry } = create([contactWithoutDialog], [])
    await flush()

    await placeholder.processContact(-10)
    expect(entry.deleted).toEqual([])

    placeholder.destroy()
    expect(entry.destroyed).toBe(true)

    await placeholder.processContact(contactWithoutDialog)
    expect(entry.deleted).toEqual([])
  })
})
