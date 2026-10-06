// Пины меню диалога (`components/dialogsContextMenu.ts`, порт tweb
// `src/components/dialogsContextMenu.ts:64-702`), задача 1-2 волны 7
// (`docs/superpowers/plans/2026-09-30-wave-7-shell-sidebars.md`).
//
// Меню проверяется через НАСТОЯЩЕГО владельца и его списки (задача 1-4):
// `AppDialogsManager.start` создаёт меню (tweb `appDialogsManager.ts:850`),
// `l(filter)` → `setListClickListener({withContext: true})` вешает его на `ul`
// списка папки (`:1478` → `:2337-2339`). Строки — `DialogElement` списка
// `AutonomousDialogList` поверх зеркала; меню ищет строку `findDialogListElement`.
// Страницы — фейк владельца поверх зеркала (`ownerPages`, как в
// `autonomousDialogList/dialogs.test.ts`), геометрия скроллера — стаб.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, finishTransition, installFrames, mountOwner, putFolders, raw, resetStores, settle, tabEls,
  uninstallFrames, type Mounted,
} from '@lib/appDialogsManager.testkit'
import contextMenuController from '@helpers/contextMenuController'
import { hideToast } from '@components/toast'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { EMPTY_NOTIFY_SETTINGS, MUTE_UNTIL_FOREVER } from '@core/dialogs/notifySettings'
import { getOutputPeer } from '@core/peers/peerId'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import { dialogMatchesFolder } from '@core/folderFilter'
import { isDialogArchived, type Dialog } from '@core/models'
import type { DialogsPage } from '@core/managers/dialogsManager'
import { useChatsStore } from '@stores/chatsStore'
import { useAppStateStore } from '@stores/appState'

// «Открыть в новой вкладке» — `verify: IS_SHARED_WORKER_SUPPORTED` (:188); в
// happy-dom `SharedWorker` нет, а пины — про браузер, где он есть.
vi.mock('@environment/sharedWorkerSupport', () => ({ default: true }))

// Apple-тач (`attachContextMenuListener.ts`: `IS_APPLE && IS_TOUCH_SUPPORTED`) —
// меню по долгому нажатию, а не по `contextmenu`. Флаг читается при `attach`.
const env = vi.hoisted(() => ({ appleTouch: false }))
vi.mock('@environment/touchSupport', () => ({ get default() { return env.appleTouch } }))
vi.mock('@environment/userAgent', async(importOriginal) => {
  const actual = await importOriginal<typeof import('@environment/userAgent')>()
  return { ...actual, get IS_APPLE() { return env.appleTouch || actual.IS_APPLE } }
})

const ME = 1
const USER = 7
const GROUP = -100
const CHANNEL = -200

let mounted: Mounted | undefined

function dialog(peerId: PeerId, patch: Partial<Dialog> = {}): Dialog {
  return {
    _: 'dialog',
    peerId,
    peer: getOutputPeer(peerId),
    pFlags: {},
    top_message: 50,
    read_inbox_max_id: 50,
    read_outbox_max_id: 50,
    unread_count: 0,
    unread_mentions_count: 0,
    unread_reactions_count: 0,
    notify_settings: EMPTY_NOTIFY_SETTINGS,
    folder_id: 0,
    ...patch,
  }
}

/** Владелец диалогов: страница из зеркала по правилу папки (как `dialogsManager.forFilter`). */
const ownerPages = vi.fn(async(query: { offsetIndex?: number, limit: number, filterId: number }): Promise<DialogsPage> => {
  const { dialogs, dialogIndexById } = useChatsStore.getState()
  const folder = useAppStateStore.getState().folders.find((f) => f.id === query.filterId)
  const matching = dialogs.filter((d) => {
    if(query.filterId === ARCHIVE_FOLDER_ID) return isDialogArchived(d)
    if(isDialogArchived(d)) return false
    if(query.filterId === ALL_FOLDER_ID) return true
    return !!folder && dialogMatchesFolder(d, undefined, folder, new Set())
  })
  const after = matching.filter((d) => query.offsetIndex === undefined || dialogIndexById[d.peerId] < query.offsetIndex)
  return { dialogs: after.slice(0, query.limit), count: matching.length, isEnd: after.length <= query.limit }
})

function setPeers(viewer: 'member' | 'creator') {
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } },
    { _: 'user', id: USER, first_name: 'Алиса', pFlags: {} },
    {
      _: 'channel', id: 100, title: 'Группа', date: 0, photo: { _: 'chatPhotoEmpty' },
      pFlags: viewer === 'creator' ? { megagroup: true, creator: true } : { megagroup: true },
    },
    { _: 'channel', id: 200, title: 'Канал', date: 0, photo: { _: 'chatPhotoEmpty' }, pFlags: { broadcast: true } },
  ] }])
}

/** пиры и диалоги — в зеркало тем же путём, что проектор; владелец со списками — поверх */
async function seed(dialogs: Dialog[], viewer: 'member' | 'creator' = 'member') {
  setPeers(viewer)
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: true })
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items: dialogs.map((dialog, i) => ({ dialog, index: (1000 - i) * 0x10000 })) }])
  mounted = mountOwner({ getDialogs: ownerPages })
  await settle()
}

/** строка диалога в списке папки — `DialogElement` списка (`xds[filterId]`) */
async function rowIn(filterId: number, peerId: PeerId) {
  return vi.waitFor(() => {
    const row = mounted!.manager.xds.get(filterId)?.sortedList.list.querySelector<HTMLElement>(`a.chatlist-chat[data-peer-id="${peerId}"]`)
    expect(row).toBeTruthy()
    return row!
  })
}

/** тело вкладки архива — список `xds[FOLDER_ID_ARCHIVE]` и `filterId` архива (`archivedTab.tsx:86-108`);
 *  сама вкладка — `sidebarLeft/tabs/archivedTab.solid.test.tsx` */
function openArchive() {
  const { scrollable, ul } = mounted!.manager.l({ id: ARCHIVE_FOLDER_ID, localId: ARCHIVE_FOLDER_ID })
  scrollable.append(ul)
  document.body.append(scrollable.container)
  mounted!.manager.setFilterIdAndChangeTab(ARCHIVE_FOLDER_ID)
}

async function open(peerId: PeerId, options: { page?: { pageX: number, pageY: number }, filterId?: number } = {}) {
  const row = await rowIn(options.filterId ?? mounted!.manager.filterId, peerId)
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  // `positionMenu` читает `pageX`/`pageY` (:197-203); happy-dom их не выводит
  const { page } = options
  if(page) Object.defineProperties(e, { pageX: { value: page.pageX }, pageY: { value: page.pageY } })
  row.querySelector('.dialog-title')!.dispatchEvent(e)
  await settle()
  return document.querySelector<HTMLElement>('.btn-menu.contextmenu.active')
}

/** подпись пункта — последний ребёнок пункта: у «Удалить» его подменяет `onOpenBefore` (:142-146) */
const labels = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? []).map((el) => el.lastChild!.textContent)

function click(menu: HTMLElement, label: string) {
  const item = Array.from(menu.querySelectorAll<HTMLElement>('.btn-menu-item')).find((el) => el.lastChild!.textContent === label)!
  item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  ownerPages.mockClear()
  env.appleTouch = false
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
  FakeResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  // высоту скроллеров папок читает ядро списка при создании
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if(this.classList.contains('scrollable')) {
      return { width: 360, height: 720, top: 0, left: 0, right: 360, bottom: 720, x: 0, y: 0, toJSON() {} } as DOMRect
    }
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect
  })
  rootScope.myId = ME
})

afterEach(() => {
  // открытый тост, как у tweb, гасится первым же кликом/ПКМ (`OverlayClickHandler`)
  hideToast()
  contextMenuController.close()
  mounted?.manager.destroy()
  mounted = undefined
  uninstallFrames()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  resetStores()
  resetPeerMirror()
})

describe('DialogsContextMenu: пункты по verify tweb', () => {
  it('ПКМ по строке лички → div.btn-menu.contextmenu, строка помечена menu-open', async() => {
    await seed([dialog(USER)])
    const menu = await open(USER)

    expect(menu).not.toBeNull()
    expect(menu!.parentElement).toBe(document.body)
    expect(menu!.querySelectorAll('.btn-menu-item.rp-overflow').length).toBe(6)
    expect(labels(menu)).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Clear history', 'Delete Chat'])
    // «Удалить» — `className: 'danger'` (:450)
    expect(menu!.lastElementChild!.classList.contains('danger')).toBe(true)
    expect((await rowIn(ALL_FOLDER_ID, USER)).classList.contains('menu-open')).toBe(true)
  })

  it('архив: непрочитанная, закреплённая, заглушённая личка — Mark as read и обратные пункты', async() => {
    await seed([dialog(USER, {
      unread_count: 3,
      pFlags: { pinned: true },
      folder_id: 1,
      notify_settings: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER },
    })])
    // меню архива — то же меню владельца на списке `l({id: FOLDER_ID_ARCHIVE})`;
    // закреп в архиве есть (`filterId` архива — не пользовательская папка)
    openArchive()
    expect(mounted!.manager.filterId).toBe(ARCHIVE_FOLDER_ID)

    expect(labels(await open(USER))).toEqual([
      'Open in new tab', 'Mark as read', 'Unpin', 'Unmute', 'Unarchive', 'Clear history', 'Delete Chat',
    ])
  })

  it('группа участником — «Leave Group»; создателем — «Delete Group» (getDeleteButtonText :373-375)', async() => {
    await seed([dialog(GROUP)])
    expect(labels(await open(GROUP))).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Clear history', 'Leave Group'])
    contextMenuController.close()
    await settle()

    setPeers('creator')
    expect(labels(await open(GROUP))).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Clear history', 'Delete Group'])
  })

  it('канал подписчиком: без «Clear history» (canClearHistory), «Leave Channel»', async() => {
    await seed([dialog(CHANNEL)])
    expect(labels(await open(CHANNEL))).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Leave Channel'])
  })

  it('«Избранное»: без mute и архива (peerId !== myId), без удаления (О-89)', async() => {
    await seed([dialog(ME)])
    expect(labels(await open(ME))).toEqual(['Open in new tab', 'Pin', 'Clear history'])
  })

  it('пользовательская папка — меню на её списке, пунктов закрепа нет (О-70)', async() => {
    putFolders({ ...raw(5, 1, 'Папка'), include_peers: [USER] })
    await seed([dialog(USER)])
    tabEls(mounted!.host)[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    finishTransition(mounted!.folders)
    expect(mounted!.manager.filterId).toBe(5)

    expect(labels(await open(USER))).toEqual(['Open in new tab', 'Mute', 'Archive', 'Clear history', 'Delete Chat'])
  })

  it('секретный чат (В7-1): без «Clear history», удаление — как у лички', async() => {
    await seed([dialog(GROUP, { secret: true })])
    expect(labels(await open(GROUP))).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Delete Chat'])
  })
})

describe('DialogsContextMenu: действия', () => {
  it('«Pin» зовёт менеджер, меню закрывается сразу (tweb buttonMenu.ts:210-217), закреп в зеркале — только ответом', async() => {
    await seed([dialog(USER)])
    let resolvePin!: () => void
    vi.mocked(mounted!.hooks.managers.groups.setPin).mockImplementationOnce(() => new Promise<void>((resolve) => resolvePin = resolve))

    const menu = await open(USER)
    click(menu!, 'Pin')

    expect(mounted!.hooks.managers.groups.setPin).toHaveBeenCalledWith(USER, true)
    expect(menu!.classList.contains('active')).toBe(false)
    expect((await rowIn(ALL_FOLDER_ID, USER)).classList.contains('menu-open')).toBe(false)
    // меню ничего не переставляет само: зеркало двигает владелец после ответа
    expect(useChatsStore.getState().dialogs[0].pFlags?.pinned).toBeUndefined()
    resolvePin()
    await settle()
  })

  it('«Unpin» закреплённого — setPin(peerId, false); отказ лимита — тост', async() => {
    await seed([dialog(USER, { pFlags: { pinned: true } })])
    vi.mocked(mounted!.hooks.managers.groups.setPin).mockRejectedValueOnce(Object.assign(new Error('pin limit reached'), { type: 'pin limit reached' }))

    click((await open(USER))!, 'Unpin')
    await settle()

    expect(mounted!.hooks.managers.groups.setPin).toHaveBeenCalledWith(USER, false)
    expect(document.querySelector('.toast')?.textContent).toBe('Sorry, you can\'t pin any more chats to the top.')
  })

  it('«Archive» переносит диалог в архив, «Unarchive» — обратно (editPeerFolders :543-548)', async() => {
    await seed([dialog(USER), dialog(GROUP, { folder_id: 1 })])

    click((await open(USER))!, 'Archive')
    expect(mounted!.hooks.managers.groups.setArchive).toHaveBeenLastCalledWith(USER, true)
    await settle()

    openArchive()
    click((await open(GROUP))!, 'Unarchive')
    expect(mounted!.hooks.managers.groups.setArchive).toHaveBeenLastCalledWith(GROUP, false)
  })

  it('«Mute» открывает попап сроков, «Unmute» снимает сразу', async() => {
    await seed([dialog(USER), dialog(GROUP, { notify_settings: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER } })])

    click((await open(USER))!, 'Mute')
    const popup = document.querySelector<HTMLElement>('.popup-mute')!
    expect(popup).not.toBeNull()
    popup.querySelector<HTMLElement>('.popup-button:not(.danger)')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    expect(mounted!.hooks.managers.groups.setMute).toHaveBeenLastCalledWith(USER, true, undefined)
    await settle()

    click((await open(GROUP))!, 'Unmute')
    expect(mounted!.hooks.managers.groups.setMute).toHaveBeenLastCalledWith(GROUP, false)
  })

  it('«Mark as read» читает до top_message', async() => {
    await seed([dialog(USER, { unread_count: 2, top_message: 77 })])
    click((await open(USER))!, 'Mark as read')
    expect(mounted!.hooks.managers.realtime.markRead).toHaveBeenCalledWith({ peerId: USER, upToId: 77 })
  })

  // tweb deleteDialog.ts case 'chat' → `flushHistory({justClear: false, revoke})`:
  // у нас `chats.deleteHistory`, строку снимает `dialogs.applyRemoved`. Выход из
  // лички (`removeMember`) сервер теперь отвергает.
  it('«Delete Chat» лички — попап popup-delete-chat, подтверждение удаляет историю у себя', async() => {
    await seed([dialog(USER)])
    click((await open(USER))!, 'Delete Chat')

    const popup = document.querySelector<HTMLElement>('.popup-delete-chat')!
    expect(popup.querySelector('.popup-title')!.textContent).toBe('Delete chat')
    expect(popup.querySelector('.checkbox-field')!.textContent).toContain('Also delete for')
    popup.querySelector<HTMLElement>('.popup-button.danger')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()

    expect(mounted!.hooks.managers.chats.deleteHistory).toHaveBeenCalledWith(USER, false)
    expect(mounted!.hooks.managers.dialogs.applyRemoved).toHaveBeenCalledWith(USER)
    expect(mounted!.hooks.managers.groups.removeMember).not.toHaveBeenCalled()
  })

  it('«Delete Chat» лички с отмеченным «Also delete for …» — revoke', async() => {
    await seed([dialog(USER)])
    click((await open(USER))!, 'Delete Chat')

    const popup = document.querySelector<HTMLElement>('.popup-delete-chat')!
    popup.querySelector<HTMLInputElement>('.checkbox-field-input')!.click()
    popup.querySelector<HTMLElement>('.popup-button.danger')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()

    expect(mounted!.hooks.managers.chats.deleteHistory).toHaveBeenCalledWith(USER, true)
    expect(mounted!.hooks.managers.dialogs.applyRemoved).toHaveBeenCalledWith(USER)
  })

  // В7-1: секретный чат — выход, как раньше, и без чекбокса `revoke`.
  it('«Delete Chat» секретного чата — выход без чекбокса', async() => {
    await seed([dialog(USER, { secret: true })])
    click((await open(USER))!, 'Delete Chat')

    const popup = document.querySelector<HTMLElement>('.popup-delete-chat')!
    expect(popup.querySelector('.checkbox-field')).toBeNull()
    popup.querySelector<HTMLElement>('.popup-button.danger')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()

    expect(mounted!.hooks.managers.groups.removeMember).toHaveBeenCalledWith(USER, ME)
    expect(mounted!.hooks.managers.chats.deleteHistory).not.toHaveBeenCalled()
  })

  it('«Delete Group» создателем с отмеченным «для всех» — deleteGroup', async() => {
    await seed([dialog(GROUP)], 'creator')
    click((await open(GROUP))!, 'Delete Group')

    const popup = document.querySelector<HTMLElement>('.popup-delete-chat')!
    popup.querySelector<HTMLInputElement>('.checkbox-field-input')!.click()
    popup.querySelector<HTMLElement>('.popup-button.danger')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()

    expect(mounted!.hooks.managers.groups.deleteGroup).toHaveBeenCalledWith(GROUP)
    expect(mounted!.hooks.managers.groups.removeMember).not.toHaveBeenCalled()
  })

  it('«Clear history» — подтверждение, затем chats.clearHistory', async() => {
    await seed([dialog(USER)])
    click((await open(USER))!, 'Clear history')

    const popup = document.querySelector<HTMLElement>('.popup-confirmation')!
    expect(popup.querySelector('.popup-title')!.textContent).toBe('Clear History')
    popup.querySelector<HTMLElement>('.popup-button.danger')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()

    expect(mounted!.hooks.managers.chats.clearHistory).toHaveBeenCalledWith(USER)
  })
})

describe('DialogsContextMenu: закрытие, позиция, снятие', () => {
  it('Esc закрывает меню — запись \'menu\' в навигационном стеке', async() => {
    await seed([dialog(USER)])
    const menu = await open(USER)
    expect(menu).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(menu!.classList.contains('active')).toBe(false)
    expect((await rowIn(ALL_FOLDER_ID, USER)).classList.contains('menu-open')).toBe(false)
  })

  // `positionMenu` (tweb `positionMenu.ts:189-313`) меряет само собранное меню
  // (`scrollWidth`/`scrollHeight`), а окно — по `body.getBoundingClientRect()`:
  // захардкоженный размер (как у прежнего React-меню, `MW=220, MH=320`) флип по
  // факту не повторит.
  it('позиция — по фактическому размеру меню: низкое не флипается, высокое уходит вверх', async() => {
    await seed([dialog(USER)])
    let menuHeight = 100
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 800 } as DOMRect)
    const proto = HTMLElement.prototype
    const scrollHeight = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
    const scrollWidth = Object.getOwnPropertyDescriptor(proto, 'scrollWidth')
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('btn-menu') ? menuHeight : 0 } })
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() { return 200 } })
    try {
      const low = await open(USER, { page: { pageX: 300, pageY: 600 } })
      expect(low!.style.top).toBe('600px')
      expect(low!.classList.contains('bottom-right')).toBe(true)
      contextMenuController.close()
      await settle()

      menuHeight = 300
      const high = await open(USER, { page: { pageX: 300, pageY: 600 } })
      // 600 + 300 + 8 > 800 → сторона `center`, верх = 800 − 300 − 8
      expect(high!.style.top).toBe('492px')
      expect(high!.classList.contains('center-right')).toBe(true)
    } finally {
      // у happy-dom геттеры живут ниже по цепочке (`Element.prototype`) — тогда
      // своё свойство просто снимается
      for(const [key, descriptor] of [['scrollHeight', scrollHeight], ['scrollWidth', scrollWidth]] as const) {
        if(descriptor) Object.defineProperty(proto, key, descriptor)
        else delete (proto as unknown as Record<string, unknown>)[key]
      }
    }
  })

  it('Apple-тач: долгое нажатие на строку (400 мс) открывает меню', async() => {
    env.appleTouch = true
    await seed([dialog(USER)])
    const row = await rowIn(ALL_FOLDER_ID, USER)
    const touch = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.defineProperty(touch, 'touches', { value: [{ pageX: 10, pageY: 10, clientX: 10, clientY: 10 }] })
    row.querySelector('.dialog-title')!.dispatchEvent(touch)
    await settle()
    expect(document.querySelector('.btn-menu.contextmenu.active')).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 450))
    await settle()
    const menu = document.querySelector<HTMLElement>('.btn-menu.contextmenu.active')
    expect(labels(menu)).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Clear history', 'Delete Chat'])
  })
})
