/** @jsxImportSource solid-js */
// Вкладка «Архив» — порт tweb `sidebarLeft/tabs/archivedTab.tsx` (задача 1-5 волны 7).
// Настоящие владелец списка (`lib/appDialogsManager.ts`), класс колонки
// (`AppSidebarLeft`, `openArchiveTab`), слайдер и навигация; замокана граница с
// воркером — страницы владельца диалогов поверх зеркала (как в
// `autonomousDialogList/dialogs.test.ts`). Таймеры настоящие: переход вкладки
// 250 мс → `onCloseAfterTimeout` 280 мс; кадры ядра списка — вручную (`installFrames`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, flushFrames, installFrames, mountOwner, resetStores, uninstallFrames, type Mounted,
} from '@lib/appDialogsManager.testkit'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeDialog } from '@core/dialogs/testDialog'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import { isDialogArchived, type Dialog } from '@core/models'
import type { DialogsPage } from '@core/managers/dialogsManager'
import appNavigationController from '@core/navigation/appNavigationController'
import { useChatsStore } from '@stores/chatsStore'

type Query = { offsetIndex?: number, limit: number, filterId: number }

let mounted: Mounted | undefined
let calls: Query[]

/** Владелец диалогов: страница из зеркала по выборке, курсор — индекс. */
const ownerPages = vi.fn(async (query: Query): Promise<DialogsPage> => {
  calls.push(query)
  const { dialogs, dialogIndexById } = useChatsStore.getState()
  const matching = dialogs.filter((d) => query.filterId === ARCHIVE_FOLDER_ID ? isDialogArchived(d) : !isDialogArchived(d))
  const after = matching.filter((d) => query.offsetIndex === undefined || dialogIndexById[d.peerId] < query.offsetIndex)
  return { dialogs: after.slice(0, query.limit), count: matching.length, isEnd: after.length <= query.limit }
})

const user = (id: number) => ({ _: 'user' as const, id, first_name: 'U' + id, pFlags: {} })

function seed(dialogs: Dialog[]) {
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items: dialogs.map((dialog, i) => ({ dialog, index: (1000 - i) * 0x10000 })) }])
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** переход (250) + разрушение вкладки (280) + запас; кадры ядра — на каждом шаге */
async function settle() {
  for(let i = 0; i < 6; ++i) {
    await pause(100)
    flushFrames()
  }
}

const archiveTab = () => document.getElementById('chats-archived-container')
const rowIds = (root: ParentNode | null | undefined) =>
  Array.from(root?.querySelectorAll<HTMLElement>('a.chatlist-chat') ?? []).map((el) => +el.dataset.peerId!)

async function start() {
  applyPeerOps([{ op: 'upsert', peers: [user(1), user(2), user(3)] }])
  seed([makeDialog({ peerId: 1 }), makeDialog({ peerId: 2, archived: true }), makeDialog({ peerId: 3, archived: true })])
  mounted = mountOwner({ getDialogs: ownerPages })
  await settle()
  return mounted
}

/** клик по строке «Архив» списка «Всех чатов» — `mousedown` в фазе захвата (`setListClickListener`) */
async function clickArchiveRow() {
  const row = await vi.waitFor(() => {
    const el = mounted!.manager.xds.get(ALL_FOLDER_ID)!.sortedList.list.querySelector<HTMLElement>('archive-dialog')
    expect(el).not.toBeNull()
    return el!
  })
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await settle()
}

const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  calls = []
  ownerPages.mockClear()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if(this.classList.contains('scrollable')) {
      return { width: 360, height: 720, top: 0, left: 0, right: 360, bottom: 720, x: 0, y: 0, toJSON() {} } as DOMRect
    }
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect
  })
})

afterEach(async() => {
  mounted?.sidebar.closeAllTabs()
  await settle()
  appNavigationController.spliceItems(0, Infinity)
  mounted?.manager.destroy()
  mounted = undefined
  uninstallFrames()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  resetStores()
  resetPeerMirror()
})

describe('AppArchivedTab: открытие строкой «Архив»', () => {
  it('клик открывает вкладку со списком `xds[FOLDER_ID_ARCHIVE]` владельца и его страницей', async() => {
    const { manager, sidebar } = await start()
    await clickArchiveRow()

    const tab = archiveTab()!
    expect(tab).not.toBeNull()
    expect(tab.classList.contains('active')).toBe(true)
    expect(tab.querySelector('.sidebar-header__title')?.textContent ?? tab.querySelector('.sidebar-header')!.textContent).toContain('Archived Chats')
    expect(sidebar.getHistory()).toHaveLength(1)

    const xd = manager.xds.get(ARCHIVE_FOLDER_ID)!
    expect(xd).toBeDefined()
    // скроллер списка встал на место скроллера вкладки (`archivedTab.tsx:101-103`)
    expect(tab.contains(xd.scrollable.container)).toBe(true)
    expect(manager.filterId).toBe(ARCHIVE_FOLDER_ID)
    // страница архива — запросом списка, а не только первой страницей строки (`limit: 10`)
    expect(calls.some((c) => c.filterId === ARCHIVE_FOLDER_ID && c.offsetIndex === undefined && c.limit !== 10)).toBe(true)
    await vi.waitFor(() => expect(rowIds(tab).sort((a, b) => a - b)).toEqual([2, 3]))
  })

  it('после въезда список «Всех чатов» очищен (`_onOpenAfterTimeout`)', async() => {
    const { manager } = await start()
    expect(manager.xds.get(ALL_FOLDER_ID)!.sortedList.itemsLength()).toBeGreaterThan(0)
    await clickArchiveRow()

    expect(manager.xds.get(ALL_FOLDER_ID)!.sortedList.itemsLength()).toBe(0)
  })
})

describe('AppArchivedTab: закрытие', () => {
  it('Esc закрывает вкладку: выборка — прежняя папка, список архива разрушен, «Все чаты» перезагружены', async() => {
    const { manager, sidebar } = await start()
    await clickArchiveRow()
    const xd = manager.xds.get(ARCHIVE_FOLDER_ID)!
    const destroy = vi.spyOn(xd, 'destroy')

    esc()
    await settle()

    expect(archiveTab()).toBeNull()
    expect(sidebar.getHistory()).toHaveLength(0)
    expect(manager.filterId).toBe(ALL_FOLDER_ID)
    expect(manager.xds.has(ARCHIVE_FOLDER_ID)).toBe(false)
    expect(destroy).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(rowIds(manager.xds.get(ALL_FOLDER_ID)!.sortedList.list)).toEqual([1]))
  })

  it('Back браузера закрывает вкладку', async() => {
    const { manager, sidebar } = await start()
    await clickArchiveRow()
    await pause(20) // запись истории доезжает очередью мутаций

    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()

    expect(archiveTab()).toBeNull()
    expect(sidebar.getHistory()).toHaveLength(0)
    expect(manager.filterId).toBe(ALL_FOLDER_ID)
  })

  it('повторное открытие — новый список архива, не разрушенный прежний', async() => {
    const { manager } = await start()
    await clickArchiveRow()
    const first = manager.xds.get(ARCHIVE_FOLDER_ID)
    esc()
    await settle()

    await clickArchiveRow()
    const second = manager.xds.get(ARCHIVE_FOLDER_ID)
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
    await vi.waitFor(() => expect(rowIds(archiveTab()).sort((a, b) => a - b)).toEqual([2, 3]))
  })
})
