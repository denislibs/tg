// Пины списка диалогов папки — `AutonomousDialogList` (`autonomousDialogList/dialogs.ts`)
// поверх `SortedDialogList` и Solid-ядра виртуального списка, в настоящем
// владельце папок (`lib/appDialogsManager.ts`). Задача 1-4 волны 7.
//
// Сюда переехали сценарии снесённого источника React-списка
// (`core/hooks/useDialogListSource.test.tsx`, спека § 5: «тесты-предохранители
// переписываются, а не удаляются»): строки — производная зеркала и одного правила
// папки, страницы — `getDialogs` владельца с курсором «минимальный индекс
// страницы», залипший курсор останавливает цикл, `clear()` — заново с первой
// страницы, гидратация строки «Архив». Добавлены сценарии плана 1-4: порядок с
// закрепом, вставка сверху, удаление, списки по папкам (`xds`), активная строка
// открытого чата, `destroy` папки.
//
// Окружение — настоящее, кроме геометрии: высоту скроллера (720) отдаёт стаб
// `getBoundingClientRect` (её читает `useElementSize` ядра при создании списка),
// страницы — фейк владельца поверх зеркала (`ownerPages`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, finishTransition, flushFrames, installFrames, mountOwner, putFolders, raw,
  resetStores, settle, tabEls, uninstallFrames, type Mounted,
} from '@lib/appDialogsManager.testkit'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeDialog } from '@core/dialogs/testDialog'
import { makeMessage } from '@core/messages/testMessage'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import { dialogMatchesFolder } from '@core/folderFilter'
import { isDialogArchived, type Dialog } from '@core/models'
import type { DialogsPage } from '@core/managers/dialogsManager'
import { useChatsStore } from '@stores/chatsStore'
import appImManager from '@lib/appImManager'
import { useNotifyStore } from '@stores/notifyStore'
import { useAppStateStore } from '@stores/appState'
import { useFoldersStore } from '@stores/foldersStore'
import { useSecretChatStore } from '@stores/secretChatStore'
import useFolders from '@stores/folders.solid'
import rootScope from '@lib/rootScope'
import { AutonomousDialogList } from './dialogs'

const HOST_HEIGHT = 720
/** `guessLoadCount()` в happy-dom: `max(768 / 64 * 1.25 | 0, 20)` */
const LOAD_COUNT = 20
const ARCHIVE_ROW_LIMIT = 10

type Query = { offsetIndex?: number, limit: number, filterId: number }

let mounted: Mounted | undefined
let calls: Query[]
/** ответ владельца, который тест придержал (`hold`) */
let held: ((page: DialogsPage) => void)[]
let hold = false

/** Владелец диалогов: страница из зеркала по правилу папки, курсор — индекс (как `dialogsManager.forFilter`). */
const ownerPages = vi.fn(async (query: Query): Promise<DialogsPage> => {
  calls.push(query)
  if(calls.length > 40) throw new Error('getDialogs зациклился')
  const { dialogs, dialogIndexById } = useChatsStore.getState()
  const folder = useAppStateStore.getState().folders.find((f) => f.id === query.filterId)
  const matching = dialogs.filter((d) => {
    if(query.filterId === ARCHIVE_FOLDER_ID) return isDialogArchived(d)
    if(isDialogArchived(d)) return false
    if(query.filterId === ALL_FOLDER_ID) return true
    return !!folder && dialogMatchesFolder(d, undefined, folder, new Set())
  })
  const after = matching.filter((d) => query.offsetIndex === undefined || dialogIndexById[d.peerId] < query.offsetIndex)
  const result = { dialogs: after.slice(0, query.limit), count: matching.length, isEnd: after.length <= query.limit }
  if(hold) return new Promise((resolve) => held.push(() => resolve(result)))
  return result
})

const pageCalls = () => calls.filter((c) => !(c.filterId === ARCHIVE_FOLDER_ID && c.limit === ARCHIVE_ROW_LIMIT && c.offsetIndex === undefined))
const archiveRowCalls = () => calls.filter((c) => c.filterId === ARCHIVE_FOLDER_ID && c.limit === ARCHIVE_ROW_LIMIT && c.offsetIndex === undefined)

/** Диалоги в зеркало тем же путём, что проектор: индекс — от владельца (больше — выше). */
function seed(dialogs: Dialog[], index = (i: number) => (1000 - i) * 0x10000) {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: true })
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items: dialogs.map((dialog, i) => ({ dialog, index: index(i) })) }])
}

function upsert(dialog: Dialog, index: number) {
  useChatsStore.getState().applyDialogOps([{ op: 'upsert', items: [{ dialog, index }] }])
}

const user = (id: number, name = 'U' + id) => ({ _: 'user' as const, id, first_name: name, pFlags: {} })
const dialogOf = (peerId: PeerId, over: Parameters<typeof makeDialog>[0] extends infer F ? Partial<F> : never = {}) =>
  makeDialog({ peerId, lastMessage: makeMessage({ id: 1, peerId, fromId: peerId, text: 'm' + peerId, date: 1_700_000_000 }), ...over })

async function start() {
  mounted = mountOwner({ getDialogs: ownerPages })
  await settle()
  return mounted
}

const xd = (filterId = ALL_FOLDER_ID) => mounted!.manager.xds.get(filterId)!
/** строки списка сверху вниз — по `top`, который пишет ядро (порядок узлов в DOM — не порядок строк) */
const rowIds = (list = xd()) => Array.from(list.sortedList.list.querySelectorAll<HTMLElement>('a.chatlist-chat'))
.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
.map((el) => +el.dataset.peerId!)
const waitRows = (expected: number[], list?: AutonomousDialogList) => vi.waitFor(() => expect(rowIds(list)).toEqual(expected))

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  calls = []
  held = []
  hold = false
  ownerPages.mockClear()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  // высоту скроллеров папок читает ядро списка при создании
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

describe('AutonomousDialogList: строки — производная зеркала', () => {
  it('порядок — по индексу владельца: закреплённый выше свежего, дальше по последнему сообщению', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2), user(3)] }])
    // индекс закреплённого — PINNED_BASE-диапазон (`core/dialogs/dialogIndex.ts`)
    seed([dialogOf(3, { pinned: true }), dialogOf(1), dialogOf(2)], (i) => [0x7fff0000 * 0x10000, 2000 * 0x10000, 1000 * 0x10000][i])
    await start()

    await waitRows([3, 1, 2])
    expect(xd().getDialogElement(3)!.dom.listEl.classList.contains('is-pinned')).toBe(true)
  })

  it('«Все чаты» — всё зеркало, кроме архива; «Архив» — ровно архивные', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2), user(3)] }])
    seed([dialogOf(1), dialogOf(2, { archived: true }), dialogOf(3)])
    await start()

    await waitRows([1, 3])

    const container = document.createElement('div')
    document.body.append(container)
    const unmount = mounted!.manager.mountArchivedList(container)
    await waitRows([2], xd(ARCHIVE_FOLDER_ID))
    unmount()
  })

  it('пользовательская папка — тот же правило, что у владельца; определения ещё нет — список пуст', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2)] }])
    putFolders({ ...raw(7, 1, 'Избранные'), include_peers: [2] })
    seed([dialogOf(1), dialogOf(2)])
    await start()

    const list = xd(7)
    expect(list.testDialogForFilter(useChatsStore.getState().dialogs[1])).toBe(true)
    expect(list.testDialogForFilter(useChatsStore.getState().dialogs[0])).toBe(false)

    useAppStateStore.setState({ folders: [] })
    expect(list.testDialogForFilter(useChatsStore.getState().dialogs[1])).toBe(false)
  })

  it('excludeMuted + глобально заглушённый ТИП: строки нет — правило мьюта одно (`isDialogMuted`)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1)] }])
    putFolders({ ...raw(7, 1, 'Без звука'), contacts: true, non_contacts: true, exclude_muted: true })
    seed([dialogOf(1)])
    useNotifyStore.setState({ settings: { ...useNotifyStore.getState().settings, private: { muted: true, preview: true } } })
    await start()

    expect(xd(7).testDialogForFilter(useChatsStore.getState().dialogs[0])).toBe(false)
  })

  it('новый диалог в зеркале выше всех — строка встаёт сверху (`dialogs_multiupdate`)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2), user(9)] }])
    seed([dialogOf(1), dialogOf(2)])
    await start()
    await waitRows([1, 2])

    upsert(dialogOf(9), 5000 * 0x10000)
    await waitRows([9, 1, 2])
  })

  it('диалог пропал из зеркала — строки нет (`dialog_drop`), её зона погашена', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2)] }])
    seed([dialogOf(1), dialogOf(2)])
    await start()
    await waitRows([1, 2])
    const removed = xd().getDialogElement(2)!
    const middleware = removed.middlewareHelper.get()

    useChatsStore.getState().applyDialogOps([{ op: 'remove', peerId: 2 }])
    await waitRows([1])
    expect(middleware()).toBe(false)
  })

  it('перемещение в архив — строка уходит из «Всех чатов»', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2)] }])
    seed([dialogOf(1), dialogOf(2)])
    await start()
    await waitRows([1, 2])

    upsert(dialogOf(2, { archived: true }), 999 * 0x10000)
    await waitRows([1])
  })

  it('непрочитанное в зеркале — бейдж строки (`dialog_unread` → `setLastMessage` + `setUnreadMessages`)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1)] }])
    seed([dialogOf(1)])
    await start()
    await waitRows([1])

    upsert(dialogOf(1, { unread: 4 }), 1000 * 0x10000)
    await vi.waitFor(() => expect(xd().getDialogElement(1)!.dom.unreadBadge?.textContent).toBe('4'))
  })
})

describe('AutonomousDialogList: постраничная догрузка (base.ts:251-299)', () => {
  it('первая страница — `getDialogs` с `guessLoadCount()` и `filterId` папки, без курсора', async () => {
    await start()
    expect(pageCalls()[0]).toEqual({ offsetIndex: undefined, limit: LOAD_COUNT, filterId: ALL_FOLDER_ID })
  })

  it('следующая страница уходит с курсором = минимальный индекс предыдущей, totalCount — `count` ответа', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1)
    applyPeerOps([{ op: 'upsert', peers: ids.map((id) => user(id)) }])
    seed(ids.map((id) => dialogOf(id)))
    await start()

    await vi.waitFor(() => expect(xd().sortedList.itemsLength()).toBe(LOAD_COUNT))
    // ul ядра — высотой под весь набор (`count` владельца)
    expect(xd().sortedList.list.style.height).toBe(`${30 * 72 + 8}px`)

    const minIndex = useChatsStore.getState().dialogIndexById[LOAD_COUNT]
    xd().requestItemForIdx(25)
    await vi.waitFor(() => expect(pageCalls()[1]).toEqual({ offsetIndex: minIndex, limit: LOAD_COUNT, filterId: ALL_FOLDER_ID }))
    await vi.waitFor(() => expect(xd().sortedList.itemsLength()).toBe(30))
  })

  it('500 диалогов долистаны до конца — в DOM только окно видимости, а не весь набор', async () => {
    const TOTAL = 500
    const ids = Array.from({ length: TOTAL }, (_, i) => i + 1)
    applyPeerOps([{ op: 'upsert', peers: ids.map((id) => user(id)) }])
    seed(ids.map((id) => dialogOf(id)))
    await start()

    for(let loaded = LOAD_COUNT; loaded < TOTAL; loaded += LOAD_COUNT) {
      xd().requestItemForIdx(loaded)
      await vi.waitFor(() => expect(xd().sortedList.itemsLength()).toBeGreaterThan(loaded))
    }
    const host = xd().scrollable.container
    host.scrollTop = TOTAL * 72 - HOST_HEIGHT
    host.dispatchEvent(new Event('scroll'))
    await settle()

    await vi.waitFor(() => expect(rowIds()[rowIds().length - 1]).toBe(TOTAL))
    // окно 720 / 72 = 10 строк плюс запас ядра; у React-списка до 1-4 — тоже окно,
    // этот пин держит, что порт его не потерял
    expect(xd().sortedList.list.querySelectorAll('a.chatlist-chat').length).toBeLessThan(40)
  })

  it('повторный запрос того же индекса не плодит запросов: фетчер сериализует', async () => {
    hold = true
    await start()
    const before = pageCalls().length
    xd().requestItemForIdx(0)
    xd().requestItemForIdx(0)
    expect(pageCalls()).toHaveLength(before)
  })

  it('первая загрузка глушит анимацию переезда, пока страница не легла (`dialogs.ts:358`)', async () => {
    hold = true
    const unblock = vi.fn()
    const blockAnimation = vi.spyOn((await import('@components/sortedDialogList')).default.prototype, 'blockAnimation')
    blockAnimation.mockImplementation(() => unblock)
    await start()

    expect(blockAnimation).toHaveBeenCalled()
    expect(unblock).not.toHaveBeenCalled()
    held.forEach((resolve) => resolve(undefined as never))
    await settle()
    expect(unblock).toHaveBeenCalled()
  })

  it('курсор не сдвинулся (пустая страница) — цикл фетчера останавливается, а не долбит владельца', async () => {
    await start()
    xd().requestItemForIdx(50)
    await settle()
    expect(pageCalls().length).toBeLessThanOrEqual(2)
  })

  it('зеркало не знает индексов пришедших диалогов — курсор не сдвинулся, цикл встаёт (расхождение 3 `base.ts`)', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1)
    applyPeerOps([{ op: 'upsert', peers: ids.map((id) => user(id)) }])
    seed(ids.map((id) => dialogOf(id)))
    await start()
    await vi.waitFor(() => expect(xd().sortedList.itemsLength()).toBe(LOAD_COUNT))
    xd().clear()
    useChatsStore.setState({ dialogIndexById: {} })
    const before = pageCalls().length

    xd().requestItemForIdx(50)
    await settle()

    expect(pageCalls().length - before).toBeLessThanOrEqual(2)
  })

  it('`clear()` — список пуст, курсор сброшен: следующая страница снова с начала', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1)
    applyPeerOps([{ op: 'upsert', peers: ids.map((id) => user(id)) }])
    seed(ids.map((id) => dialogOf(id)))
    await start()
    await vi.waitFor(() => expect(xd().sortedList.itemsLength()).toBe(LOAD_COUNT))

    xd().clear()
    expect(xd().sortedList.itemsLength()).toBe(0)
    xd().onChatsScroll()
    await vi.waitFor(() => expect(pageCalls()[pageCalls().length - 1].offsetIndex).toBeUndefined())
  })

  it('ответ, начатый до `clear()`, строк не кладёт (у tweb `clear()` отклоняет `loadDialogsDeferred`)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1)] }])
    seed([dialogOf(1)])
    hold = true
    await start()
    expect(held.length).toBeGreaterThan(0)

    xd().clear()
    held.forEach((resolve) => resolve(undefined as never))
    await settle()

    expect(xd().sortedList.itemsLength()).toBe(0)
  })
})

describe('AutonomousDialogList: строка «Архив» (`ensureArchiveDialogHydrated`, расхождение 2)', () => {
  it('архива в зеркале нет — загрузка «Всех чатов» тянет страницу архивной выборки', async () => {
    await start()
    expect(archiveRowCalls()).toHaveLength(1)
  })

  it('архив в зеркале — строка «Архив» закреплена первой, страница строки не запрашивается', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2)] }])
    seed([dialogOf(1), dialogOf(2, { archived: true })])
    await start()

    expect(archiveRowCalls()).toHaveLength(0)
    await vi.waitFor(() => {
      const first = Array.from(xd().sortedList.list.children).find((el) => (el as HTMLElement).style.top === '0px')
      expect(first?.querySelector('.chatlist-chat:not(a)')).not.toBeNull()
    })
    await waitRows([1])
  })

  it('владелец ответил «архива нет» — на следующих загрузках не переспрашиваем', async () => {
    await start()
    xd().clear()
    xd().onChatsScroll()
    await settle()
    expect(archiveRowCalls()).toHaveLength(1)
  })

  it('архив появился в зеркале позже — строка закрепляется подпиской; исчез — снимается', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2)] }])
    seed([dialogOf(1)])
    await start()
    await waitRows([1])
    const pinned = () => xd().sortedList.list.querySelector('.chatlist-chat:not(a)')

    upsert(dialogOf(2, { archived: true }), 10 * 0x10000)
    await vi.waitFor(() => expect(pinned()).not.toBeNull())

    useChatsStore.getState().applyDialogOps([{ op: 'remove', peerId: 2 }])
    await vi.waitFor(() => expect(pinned()).toBeNull())
  })

  it('список пользовательской папки строку архива не гидрирует', async () => {
    putFolders(raw(7, 1, 'Папка'))
    await start()
    const before = archiveRowCalls().length
    xd(7).onChatsScroll()
    await settle()
    expect(archiveRowCalls()).toHaveLength(before)
  })
})

describe('AutonomousDialogList: строка живёт событиями зеркала', () => {
  it('«печатает» — набор из зеркала вместо последнего сообщения; набор кончился — сообщение вернулось', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1)] }])
    seed([dialogOf(1)])
    await start()
    await waitRows([1])
    const dom = xd().getDialogElement(1)!.dom
    await vi.waitFor(() => expect(dom.lastMessageSpan.textContent).toBe('m1'))

    useChatsStore.getState().setTyping(1, 1, { _: 'sendMessageTypingAction' }, Date.now())
    expect(dom.lastMessageSpan.querySelector('.peer-typing-container .peer-typing-text')).not.toBeNull()
    expect(dom.lastMessageSpan.classList.contains('user-typing')).toBe(true)

    useChatsStore.getState().clearTyping(1, 1)
    await vi.waitFor(() => expect(dom.lastMessageSpan.textContent).toBe('m1'))
    expect(dom.lastMessageSpan.classList.contains('user-typing')).toBe(false)
  })

  it('онлайн — точка на аватаре (`user_update` → `setOnlineStatus`)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1)] }])
    seed([dialogOf(1)])
    await start()
    await waitRows([1])

    useChatsStore.getState().setPresence({ user_id: 1, status: { _: 'userStatusOnline', expires: Math.floor(Date.now() / 1000) + 60 } } as never)
    expect(xd().getDialogElement(1)!.dom.avatarEl!.node.classList.contains('is-online')).toBe(true)
  })

  it('свой онлайн — у «Избранного» точки нет (`getUserStatus` у себя пуст, appUsersManager.ts:864-866)', async () => {
    const ME = 7
    const prevMyId = rootScope.myId
    rootScope.myId = ME
    try {
      applyPeerOps([{ op: 'upsert', peers: [user(ME), user(1)] }])
      seed([dialogOf(ME), dialogOf(1)])
      await start()
      await waitRows([ME, 1])

      const expires = Math.floor(Date.now() / 1000) + 60
      useChatsStore.getState().setPresence({ user_id: ME, status: { _: 'userStatusOnline', expires } } as never)
      useChatsStore.getState().setPresence({ user_id: 1, status: { _: 'userStatusOnline', expires } } as never)

      expect(xd().getDialogElement(ME)!.dom.avatarEl!.node.classList.contains('is-online')).toBe(false)
      expect(xd().getDialogElement(1)!.dom.avatarEl!.node.classList.contains('is-online')).toBe(true)
    } finally {
      rootScope.myId = prevMyId
    }
  })

  it('значки у имени (LS-02: галочка «Telegram») — `withIcons` строки, tweb `:403`', async () => {
    applyPeerOps([{ op: 'upsert', peers: [{ ...user(1, 'Telegram'), pFlags: { verified: true } }, user(2)] }])
    seed([dialogOf(1), dialogOf(2)])
    await start()
    await waitRows([1, 2])

    const titleOf = (peerId: number) => xd().getDialogElement(peerId)!.dom.titleSpan
    expect(titleOf(1).querySelector('.verified-icon')).not.toBeNull()
    expect(titleOf(2).querySelector('.verified-icon')).toBeNull()
  })
})

describe('В7-1: строка секретного чата (наш продукт, фича на паузе)', () => {
  it('до рукопожатия — статус вместо последнего сообщения, замок у имени; статус сменился — строка следом', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1)] }])
    useSecretChatStore.getState().setStatus(1, 'awaiting')
    seed([dialogOf(1, { secret: true })])
    await start()
    await waitRows([1])
    const dom = xd().getDialogElement(1)!.dom

    await vi.waitFor(() => expect(dom.lastMessageSpan.textContent).toBe('Waiting for the other party to accept the secret chat…'))
    expect(dom.titleSpanContainer.querySelector('.tgico')).not.toBeNull()

    useSecretChatStore.getState().setStatus(1, 'established')
    await vi.waitFor(() => expect(dom.lastMessageSpan.textContent).toBe('m1'))
  })
})

describe('Панель тем и свёрнутая колонка (`ВРЕМЕННО до 1-6`/`2-1`)', () => {
  it('форум открыт — `is-forum-visible` колонки и бейджи на аватарах непрочитанных строк; закрыт — сняты', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1)] }])
    seed([dialogOf(1, { unread: 3 })])
    await start()
    await waitRows([1])
    const dom = xd().getDialogElement(1)!.dom
    await vi.waitFor(() => expect(dom.unreadBadge?.textContent).toBe('3'))
    const column = document.createElement('div')

    mounted!.manager.onForumToggle(true, column)
    expect(column.classList.contains('is-forum-visible')).toBe(true)
    expect(dom.unreadAvatarBadge?.textContent).toBe('3')

    mounted!.manager.onForumToggle(false, column)
    // уход бейджа — переход с отложенным на два кадра стартом (`toggleBadgeByKey`, `useRafs`)
    await vi.waitFor(() => {
      flushFrames()
      expect(dom.unreadAvatarBadge).toBeUndefined()
    })
  })
})

describe('AppDialogsManager + списки: папки, активная строка, destroy', () => {
  it('смена папки не пересоздаёт списки: `xds` держит список на папку (tweb `:1474`)', async () => {
    putFolders(raw(3, 1, 'Работа'))
    await start()
    const all = xd(ALL_FOLDER_ID)
    const work = xd(3)

    tabEls(mounted!.host)[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    finishTransition(mounted!.folders)
    tabEls(mounted!.host)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(xd(ALL_FOLDER_ID)).toBe(all)
    expect(xd(3)).toBe(work)
    expect(mounted!.manager.xd).toBe(all)
    expect(useFolders().folderItems.map((item) => item.id)).toEqual([0, 3])
  })

  it('открытый чат — его строка `active`; другой чат — подсветка переехала; чат закрыт — подсветки нет (`setDialogActive`)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2)] }])
    seed([dialogOf(1), dialogOf(2)])
    // открытый чат — `appImManager.chat`, его смена — событие `peer_changed`
    let openPeerId: PeerId = 1
    vi.spyOn(appImManager, 'chat', 'get').mockImplementation(() => ({ peerId: openPeerId }) as typeof appImManager.chat)
    const peerChanged = (peerId: PeerId) => {
      openPeerId = peerId
      appImManager.dispatchEvent('peer_changed', appImManager.chat)
    }
    await start()
    await waitRows([1, 2])
    const row = (id: number) => xd().getDialogElement(id)!.dom.listEl

    // строка, построенная при открытом чате, подсвечена сразу (у tweb — в конструкторе)
    expect(row(1).classList.contains('active')).toBe(true)

    peerChanged(2)
    expect(row(1).classList.contains('active')).toBe(false)
    expect(row(2).classList.contains('active')).toBe(true)

    peerChanged(0)
    expect(row(2).classList.contains('active')).toBe(false)
    expect(xd().sortedList.list.querySelectorAll('.chatlist-chat.active')).toHaveLength(0)
  })

  it('клик по строке форума чат не открывает (`toggleForumTabByPeerId` — бэклог Б-3)', async () => {
    const setPeer = vi.spyOn(appImManager, 'setPeer').mockResolvedValue(undefined)
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 50, title: 'Форум', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, forum: true } }] }])
    seed([dialogOf(-50)])
    await start()
    await waitRows([-50])

    xd().getDialogElement(-50)!.dom.listEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(setPeer).not.toHaveBeenCalled()
  })

  it('`destroy()` списка снимает все его строки и гасит их зоны (DoD 5)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [user(1), user(2)] }])
    seed([dialogOf(1), dialogOf(2)])
    await start()
    await waitRows([1, 2])
    const list = xd()
    const zones = [1, 2].map((id) => list.getDialogElement(id)!.middlewareHelper.get())

    list.destroy()

    expect(list.sortedList.list.querySelectorAll('.chatlist-chat')).toHaveLength(0)
    expect(zones.map((zone) => zone())).toEqual([false, false])
    // подписки на зеркало сняты: операция зеркала до снятого списка не доходит
    const update = vi.spyOn(list, 'updateDialog')
    upsert(dialogOf(1, { unread: 2 }), 5000 * 0x10000)
    expect(update).not.toHaveBeenCalled()
  })

  it('владелец гасит списки всех папок на `destroy()`', async () => {
    putFolders(raw(3, 1, 'Работа'))
    await start()
    const lists = Array.from(mounted!.manager.xds.values())
    const destroys = lists.map((list) => vi.spyOn(list, 'destroy'))

    mounted!.manager.destroy()
    mounted = undefined

    destroys.forEach((destroy) => expect(destroy).toHaveBeenCalledTimes(1))
    expect(useFoldersStore.getState()).toBeDefined()
  })
})
