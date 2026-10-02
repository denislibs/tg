// Пины меню диалога (`components/dialogsContextMenu.ts`, порт tweb
// `src/components/dialogsContextMenu.ts:64-702`), задача 1-2 волны 7
// (`docs/superpowers/plans/2026-09-30-wave-7-shell-sidebars.md`).
//
// Меню проверяется через НАСТОЯЩЕГО владельца: `AppDialogsManager.start` создаёт
// его (tweb `appDialogsManager.ts:850`), `l(filter)` вешает на список папки
// (`:1478` → `:2337-2339`). Строки — `<a data-peer-id>` в `.chatlist-top`, как у
// React-списка до 1-4 и у `SortedDialogList` после: меню ищет строку
// `findDialogListElement`, а не держит её.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, frameOf, installFrames, mountOwner, resetStores, settle, uninstallFrames, type Mounted,
} from '@lib/appDialogsManager.testkit'
import contextMenuController from '@helpers/contextMenuController'
import { hideToast } from '@components/toast'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { EMPTY_NOTIFY_SETTINGS, MUTE_UNTIL_FOREVER } from '@core/dialogs/notifySettings'
import { getOutputPeer } from '@core/peers/peerId'
import type { Dialog } from '@core/models'
import { useChatsStore } from '@stores/chatsStore'
import { useFoldersStore } from '@stores/foldersStore'

// «Открыть в новой вкладке» — `verify: IS_SHARED_WORKER_SUPPORTED` (:188); в
// happy-dom `SharedWorker` нет, а пины — про браузер, где он есть.
vi.mock('@environment/sharedWorkerSupport', () => ({ default: true }))

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

function seed(dialogs: Dialog[], viewer: 'member' | 'creator' = 'member') {
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } },
    { _: 'user', id: USER, first_name: 'Алиса', pFlags: {} },
    {
      _: 'channel', id: 100, title: 'Группа', date: 0, photo: { _: 'chatPhotoEmpty' },
      pFlags: viewer === 'creator' ? { megagroup: true, creator: true } : { megagroup: true },
    },
    { _: 'channel', id: 200, title: 'Канал', date: 0, photo: { _: 'chatPhotoEmpty' }, pFlags: { broadcast: true } },
  ] }])
  useChatsStore.setState({ dialogs })
}

/** строки списка папки — в `.chatlist-top` владельца, как у React-`ChatList` */
function mountRows(filterId = 0, peerIds: PeerId[] = [USER, GROUP, CHANNEL, ME]) {
  const top = frameOf(mounted!.folders, filterId).querySelector<HTMLElement>('.chatlist-top')!
  const ul = document.createElement('ul')
  ul.className = 'chatlist'
  for(const peerId of peerIds) {
    const a = document.createElement('a')
    a.className = 'row chatlist-chat'
    a.dataset.peerId = '' + peerId
    const title = document.createElement('span')
    title.className = 'peer-title'
    a.append(title)
    ul.append(a)
  }
  top.append(ul)
  return ul
}

const rowOf = (peerId: PeerId) => document.querySelector<HTMLElement>(`.chatlist-chat[data-peer-id="${peerId}"]`)!

async function open(peerId: PeerId, page?: { pageX: number, pageY: number }) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  // `positionMenu` читает `pageX`/`pageY` (:197-203); happy-dom их не выводит
  if(page) Object.defineProperties(e, { pageX: { value: page.pageX }, pageY: { value: page.pageY } })
  rowOf(peerId).querySelector('.peer-title')!.dispatchEvent(e)
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

beforeEach(async() => {
  resetStores()
  resetPeerMirror()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
  FakeResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  rootScope.myId = ME
  mounted = mountOwner()
  await settle()
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
    seed([dialog(USER)])
    mountRows()
    const menu = await open(USER)

    expect(menu).not.toBeNull()
    expect(menu!.parentElement).toBe(document.body)
    expect(menu!.querySelectorAll('.btn-menu-item.rp-overflow').length).toBe(6)
    expect(labels(menu)).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Clear history', 'Delete Chat'])
    // «Удалить» — `className: 'danger'` (:450)
    expect(menu!.lastElementChild!.classList.contains('danger')).toBe(true)
    expect(rowOf(USER).classList.contains('menu-open')).toBe(true)
  })

  it('непрочитанная, закреплённая, заглушённая, в архиве личка: Mark as read и обратные пункты', async() => {
    seed([dialog(USER, {
      unread_count: 3,
      pFlags: { pinned: true },
      folder_id: 1,
      notify_settings: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER },
    })])
    mountRows()

    expect(labels(await open(USER))).toEqual([
      'Open in new tab', 'Mark as read', 'Unpin', 'Unmute', 'Unarchive', 'Clear history', 'Delete Chat',
    ])
  })

  it('группа участником — «Leave Group»; создателем — «Delete Group» (getDeleteButtonText :373-375)', async() => {
    seed([dialog(GROUP)])
    mountRows()
    expect(labels(await open(GROUP))).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Clear history', 'Leave Group'])
    contextMenuController.close()
    await settle()

    seed([dialog(GROUP)], 'creator')
    expect(labels(await open(GROUP))).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Clear history', 'Delete Group'])
  })

  it('канал подписчиком: без «Clear history» (canClearHistory), «Leave Channel»', async() => {
    seed([dialog(CHANNEL)])
    mountRows()
    expect(labels(await open(CHANNEL))).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Leave Channel'])
  })

  it('«Избранное»: без mute и архива (peerId !== myId), без удаления (О-89)', async() => {
    seed([dialog(ME)])
    mountRows()
    expect(labels(await open(ME))).toEqual(['Open in new tab', 'Pin', 'Clear history'])
  })

  it('пользовательская папка — пунктов закрепа нет (О-70)', async() => {
    useFoldersStore.setState({ selectedId: 5 })
    mounted!.manager.filterId = 5
    seed([dialog(USER)])
    mountRows()
    expect(labels(await open(USER))).toEqual(['Open in new tab', 'Mute', 'Archive', 'Clear history', 'Delete Chat'])
  })

  it('секретный чат (В7-1): без «Clear history», удаление — как у лички', async() => {
    seed([dialog(GROUP, { secret: true })])
    mountRows()
    expect(labels(await open(GROUP))).toEqual(['Open in new tab', 'Pin', 'Mute', 'Archive', 'Delete Chat'])
  })

  it('строки без диалога — меню не открывается иначе как с «Open in new tab»', async() => {
    seed([])
    mountRows()
    expect(labels(await open(USER))).toEqual(['Open in new tab'])
  })
})

describe('DialogsContextMenu: действия', () => {
  it('«Pin» зовёт менеджер, меню закрывается сразу (tweb buttonMenu.ts:210-217), закреп в зеркале — только ответом', async() => {
    seed([dialog(USER)])
    mountRows()
    let resolvePin!: () => void
    vi.mocked(mounted!.hooks.managers.groups.setPin).mockImplementationOnce(() => new Promise<void>((resolve) => resolvePin = resolve))

    const menu = await open(USER)
    click(menu!, 'Pin')

    expect(mounted!.hooks.managers.groups.setPin).toHaveBeenCalledWith(USER, true)
    expect(menu!.classList.contains('active')).toBe(false)
    expect(rowOf(USER).classList.contains('menu-open')).toBe(false)
    // меню ничего не переставляет само: зеркало двигает владелец после ответа
    expect(useChatsStore.getState().dialogs[0].pFlags?.pinned).toBeUndefined()
    resolvePin()
    await settle()
  })

  it('«Unpin» закреплённого — setPin(peerId, false); отказ лимита — тост', async() => {
    seed([dialog(USER, { pFlags: { pinned: true } })])
    mountRows()
    vi.mocked(mounted!.hooks.managers.groups.setPin).mockRejectedValueOnce(Object.assign(new Error('pin limit reached'), { type: 'pin limit reached' }))

    click((await open(USER))!, 'Unpin')
    await settle()

    expect(mounted!.hooks.managers.groups.setPin).toHaveBeenCalledWith(USER, false)
    expect(document.querySelector('.toast')?.textContent).toBe('Sorry, you can\'t pin any more chats to the top.')
  })

  it('«Archive» переносит диалог в архив, «Unarchive» — обратно (editPeerFolders :543-548)', async() => {
    seed([dialog(USER), dialog(GROUP, { folder_id: 1 })])
    mountRows()

    click((await open(USER))!, 'Archive')
    expect(mounted!.hooks.managers.groups.setArchive).toHaveBeenLastCalledWith(USER, true)
    await settle()

    click((await open(GROUP))!, 'Unarchive')
    expect(mounted!.hooks.managers.groups.setArchive).toHaveBeenLastCalledWith(GROUP, false)
  })

  it('«Mute» открывает попап сроков, «Unmute» снимает сразу', async() => {
    seed([dialog(USER), dialog(GROUP, { notify_settings: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER } })])
    mountRows()

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
    seed([dialog(USER, { unread_count: 2, top_message: 77 })])
    mountRows()
    click((await open(USER))!, 'Mark as read')
    expect(mounted!.hooks.managers.realtime.markRead).toHaveBeenCalledWith({ peerId: USER, upToId: 77 })
  })

  it('«Delete Chat» лички — попап popup-delete-chat, подтверждение выходит из чата', async() => {
    seed([dialog(USER)])
    mountRows()
    click((await open(USER))!, 'Delete Chat')

    const popup = document.querySelector<HTMLElement>('.popup-delete-chat')!
    expect(popup.querySelector('.popup-title')!.textContent).toBe('Delete chat')
    popup.querySelector<HTMLElement>('.popup-button.danger')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()

    expect(mounted!.hooks.managers.groups.removeMember).toHaveBeenCalledWith(USER, ME)
    expect(mounted!.hooks.managers.dialogs.applyRemoved).toHaveBeenCalledWith(USER)
  })

  it('«Delete Group» создателем с отмеченным «для всех» — deleteGroup', async() => {
    seed([dialog(GROUP)], 'creator')
    mountRows()
    click((await open(GROUP))!, 'Delete Group')

    const popup = document.querySelector<HTMLElement>('.popup-delete-chat')!
    popup.querySelector<HTMLInputElement>('.checkbox-field-input')!.click()
    popup.querySelector<HTMLElement>('.popup-button.danger')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()

    expect(mounted!.hooks.managers.groups.deleteGroup).toHaveBeenCalledWith(GROUP)
    expect(mounted!.hooks.managers.groups.removeMember).not.toHaveBeenCalled()
  })

  it('«Clear history» — подтверждение, затем chats.clearHistory', async() => {
    seed([dialog(USER)])
    mountRows()
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
    seed([dialog(USER)])
    mountRows()
    const menu = await open(USER)
    expect(menu).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(menu!.classList.contains('active')).toBe(false)
    expect(rowOf(USER).classList.contains('menu-open')).toBe(false)
  })

  // `positionMenu` (tweb `positionMenu.ts:189-313`) меряет само собранное меню
  // (`scrollWidth`/`scrollHeight`), а окно — по `body.getBoundingClientRect()`:
  // захардкоженный размер (как у прежнего React-меню, `MW=220, MH=320`) флип по
  // факту не повторит.
  it('позиция — по фактическому размеру меню: низкое не флипается, высокое уходит вверх', async() => {
    seed([dialog(USER)])
    mountRows()
    let menuHeight = 100
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 800 } as DOMRect)
    const proto = HTMLElement.prototype
    const scrollHeight = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
    const scrollWidth = Object.getOwnPropertyDescriptor(proto, 'scrollWidth')
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('btn-menu') ? menuHeight : 0 } })
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() { return 200 } })
    try {
      const low = await open(USER, { pageX: 300, pageY: 600 })
      expect(low!.style.top).toBe('600px')
      expect(low!.classList.contains('bottom-right')).toBe(true)
      contextMenuController.close()
      await settle()

      menuHeight = 300
      const high = await open(USER, { pageX: 300, pageY: 600 })
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

  it('destroy() владельца снимает слушатели меню со списка папки', async() => {
    seed([dialog(USER)])
    const ul = mountRows()
    expect(await open(USER)).not.toBeNull()
    contextMenuController.close()
    await settle()

    mounted!.manager.destroy()
    mounted = undefined
    await settle()
    // узел папки снят из DOM, но событие по оторванному поддереву всплывает
    // до `.chatlist-top` — слушать его больше некому
    ul.querySelector('a')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    expect(document.querySelector('.btn-menu.contextmenu.active')).toBeNull()
  })
})
