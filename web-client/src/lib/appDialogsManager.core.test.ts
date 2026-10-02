// Пины ядра `AppDialogsManager` (задача 1-8 волны 7, tweb `appDialogsManager.ts` 812502980):
// пустые плейсхолдеры (`generateEmptyPlaceholder`/`checkIfPlaceholderNeeded` `:1624-1738`),
// секция «Контакты» под коротким списком (`_onListLengthChange` `:1792-1817`) и подсветка
// открытого чата ровно на одной строке (`setDialogActive` `:1300`, `peer_changed` `:1176-1229`).
//
// Владелец — настоящий (`mountOwner`), списки — настоящие `AutonomousDialogList`, страницы —
// фейк владельца поверх зеркала; подменена только геометрия скроллера.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, finishTransition, installFrames, mountOwner, putFolders, raw,
  resetStores, settle, tabEls, uninstallFrames, type Mounted,
} from '@lib/appDialogsManager.testkit'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeDialog } from '@core/dialogs/testDialog'
import { makeMessage } from '@core/messages/testMessage'
import { ALL_FOLDER_ID } from '@core/folderIds'
import type { Dialog } from '@core/models'
import type { DialogsPage } from '@core/managers/dialogsManager'
import { useChatsStore } from '@stores/chatsStore'
import appImManager from '@lib/appImManager'
import { ChatType } from '@components/chat/chatType'

const HOST_HEIGHT = 720

type Query = { offsetIndex?: number, limit: number, filterId: number }

let mounted: Mounted | undefined

/** Владелец диалогов: «Все чаты» — всё зеркало, пользовательская папка — пусто. */
const ownerPages = vi.fn(async (query: Query): Promise<DialogsPage> => {
  const { dialogs, dialogIndexById } = useChatsStore.getState()
  const matching = query.filterId === ALL_FOLDER_ID ? dialogs : []
  const after = matching.filter((d) => query.offsetIndex === undefined || dialogIndexById[d.peerId] < query.offsetIndex)
  return { dialogs: after.slice(0, query.limit), count: matching.length, isEnd: after.length <= query.limit }
})

function seed(dialogs: Dialog[]) {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: true })
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items: dialogs.map((dialog, i) => ({ dialog, index: (1000 - i) * 0x10000 })) }])
}

const user = (id: number) => ({ _: 'user' as const, id, first_name: 'U' + id, pFlags: {} })
const dialogOf = (peerId: PeerId) =>
  makeDialog({ peerId, lastMessage: makeMessage({ id: 1, peerId, fromId: peerId, text: 'm' + peerId, date: 1_700_000_000 }) })

async function start(contacts: number[] = []) {
  mounted = mountOwner({ getDialogs: ownerPages })
  mounted.hooks.managers.contacts.getContactsPeerIds.mockImplementation(async () => contacts.slice())
  mounted.hooks.managers.contacts.isContact.mockImplementation(async (peerId: number) => contacts.includes(peerId))
  mounted.hooks.managers.dialogs.hasDialog.mockImplementation(async (peerId: number) =>
    useChatsStore.getState().dialogs.some((d) => d.peerId === peerId))
  await settle()
  return mounted
}

const xd = (filterId = ALL_FOLDER_ID) => mounted!.manager.xds.get(filterId)!
const partOf = (filterId = ALL_FOLDER_ID) => xd(filterId).sortedList.list.parentElement as HTMLElement
const rowsCount = () => xd().sortedList.list.querySelectorAll('a.chatlist-chat').length

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  ownerPages.mockClear()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if(this.classList.contains('scrollable')) {
      return { width: 360, height: HOST_HEIGHT, top: 0, left: 0, right: 360, bottom: HOST_HEIGHT, x: 0, y: 0, toJSON() {} } as DOMRect
    }
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect
  })
})

afterEach(() => {
  mounted?.manager.destroy()
  mounted = undefined
  uninstallFrames()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  resetStores()
  resetPeerMirror()
})

describe('пустой список — плейсхолдер tweb (`checkIfPlaceholderNeeded`)', () => {
  it('«Все чаты» без диалогов: `.empty-placeholder-dialogs` в `.chatlist-top`, подпись — число контактов', async () => {
    seed([])
    await start([5, 6])

    const part = partOf()
    await vi.waitFor(() => expect(part.querySelector('.empty-placeholder')).not.toBeNull())
    const placeholder = part.querySelector<HTMLElement>(':scope > .empty-placeholder')!
    expect(placeholder.classList.contains('empty-placeholder-dialogs')).toBe(true)
    // `visible` — после картинки и числа контактов (`:1700-1703`, проявление по CSS)
    await vi.waitFor(() => expect(placeholder.classList.contains('visible')).toBe(true))
    expect(part.classList.contains('with-placeholder')).toBe(true)
    expect(part.dataset.placeholderType).toBe('dialogs')
    expect(placeholder.querySelector('.empty-placeholder-header')!.textContent).toBe('Your chats will appear here')
    expect(placeholder.querySelector('img.empty-placeholder-dialogs-icon')).not.toBeNull()
    await vi.waitFor(() => expect(placeholder.querySelector('.empty-placeholder-subtitle')!.textContent).toBe('You have 2 contacts on Telegram'))
  })

  it('без контактов — подпись «синхронизируйте контакты»', async () => {
    seed([])
    await start([])

    const part = partOf()
    await vi.waitFor(() => expect(part.querySelector('.empty-placeholder-subtitle')?.textContent).toContain('sync your contacts'))
  })

  it('пустая пользовательская папка: `.empty-placeholder-folder`, «Folder is empty» и «Edit Folder»', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1)] }])
    seed([dialogOf(1)])
    putFolders(raw(3, 1, 'Работа'))
    await start()

    tabEls(mounted!.host)[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    finishTransition(mounted!.folders)
    await settle()

    const part = partOf(3)
    await vi.waitFor(() => expect(part.querySelector('.empty-placeholder')).not.toBeNull())
    const placeholder = part.querySelector<HTMLElement>(':scope > .empty-placeholder')!
    expect(placeholder.className).toBe('empty-placeholder empty-placeholder-folder')
    expect(part.dataset.placeholderType).toBe('folder')
    expect(placeholder.querySelector('.empty-placeholder-header')!.textContent).toBe('Folder is empty')
    expect(placeholder.querySelector('.empty-placeholder-subtitle')!.textContent).toBe('No chats currently belong to this folder.')
    const button = placeholder.querySelector<HTMLElement>('button.btn-primary.btn-color-primary.btn-control')!
    expect(button.textContent).toContain('Edit Folder')
    // у «Всех чатов» с диалогом плейсхолдера нет
    expect(partOf().querySelector('.empty-placeholder')).toBeNull()
  })

  it('диалог появился — плейсхолдер снят вместе с `with-placeholder`', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1)] }])
    seed([])
    await start()
    const part = partOf()
    await vi.waitFor(() => expect(part.querySelector('.empty-placeholder')).not.toBeNull())

    useChatsStore.getState().applyDialogOps([{ op: 'upsert', items: [{ dialog: dialogOf(1), index: 1000 * 0x10000 }] }])

    await vi.waitFor(() => expect(rowsCount()).toBe(1))
    await vi.waitFor(() => expect(part.querySelector('.empty-placeholder')).toBeNull())
    expect(part.classList.contains('with-placeholder')).toBe(false)
  })
})

describe('секция «Контакты» под коротким списком (`_onListLengthChange`)', () => {
  it('меньше 10 диалогов — контакты без диалога секцией в `.chatlist-bottom`, `with-contacts` у скроллера', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(7), user(8)] }])
    seed([dialogOf(1)])
    await start([1, 7, 8])
    await vi.waitFor(() => expect(rowsCount()).toBe(1))

    const parts = partOf().parentElement!
    const bottom = partOf().nextElementSibling as HTMLElement
    expect(parts.classList.contains('with-contacts')).toBe(true)
    const section = bottom.querySelector<HTMLElement>('.sidebar-left-contacts-section')!
    expect(section).not.toBeNull()
    // контакт с диалогом (1) в секцию не попадает
    await vi.waitFor(() => expect(Array.from(section.querySelectorAll<HTMLElement>('a.chatlist-chat')).map((el) => +el.dataset.peerId!).sort((a, b) => a - b)).toEqual([7, 8]))
    expect(section.classList.contains('hide')).toBe(false)
    expect(section.querySelector('ul.chatlist.chatlist-new.chatlist-48')).not.toBeNull()
  })

  it('10 диалогов и больше — секции нет', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => i + 1)
    applyPeerOps([{ op: 'upsert', peers: ids.map(user) }])
    seed(ids.map(dialogOf))
    await start([20])
    await vi.waitFor(() => expect(rowsCount()).toBe(10))

    expect(partOf().parentElement!.classList.contains('with-contacts')).toBe(false)
    expect(document.querySelector('.sidebar-left-contacts-section')).toBeNull()
  })
})

describe('активная строка — ровно одна (`setDialogActive`)', () => {
  it('смена открытого чата переносит `active`, закрытие гасит; тред того же пира строку не подсвечивает', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2)] }])
    seed([dialogOf(1), dialogOf(2)])
    let open: { peerId: PeerId, threadId?: number, type: ChatType } = { peerId: 1, type: ChatType.Chat }
    vi.spyOn(appImManager, 'chat', 'get').mockImplementation(() => open as typeof appImManager.chat)
    const peerChanged = (next: typeof open) => {
      open = next
      appImManager.dispatchEvent('peer_changed', appImManager.chat)
    }
    await start()
    await vi.waitFor(() => expect(rowsCount()).toBe(2))
    const active = () => Array.from(xd().sortedList.list.querySelectorAll<HTMLElement>('.chatlist-chat.active')).map((el) => +el.dataset.peerId!)

    expect(active()).toEqual([1])

    peerChanged({ peerId: 2, type: ChatType.Chat })
    expect(active()).toEqual([2])

    // тред комментариев того же пира — не та же «строка» (`isSamePeer` с `threadId`)
    peerChanged({ peerId: 2, threadId: 5, type: ChatType.Discussion })
    expect(active()).toEqual([])

    peerChanged({ peerId: 1, type: ChatType.Chat })
    expect(active()).toEqual([1])

    peerChanged({ peerId: 0, type: ChatType.Chat })
    expect(active()).toEqual([])
  })
})
