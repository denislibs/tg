// Пины вкладки «Чаты» (savedDialogs) у «Избранного» — `AppSearchSuper.loadSavedDialogs`
// (tweb 812502980 `appSearchSuper.ts:2214-2265`) поверх `AutonomousSavedDialogList`
// (`autonomousDialogList/savedDialogs.ts`) и `SortedDialogList` с `virtualFilterId`.
// Задача 1-7 волны 7 (`docs/superpowers/plans/2026-09-30-wave-7-shell-sidebars.md`).
//
// Сюда переехали сценарии снесённой Solid-вкладки (`sidebarRight/savedDialogsTab.solid.test.tsx`)
// и вкладочная половина `appSearchSuper.giftsSaved.test.ts`: окно строк, высота `ul`
// ровно `count * 72`, счётчик одним запросом, клик открывает чат источника, «Мои
// заметки», снятие списка по `middleware`. Новое — строка теперь `DialogElement`
// оригинала: свой пир, источник в `threadId`, без `row-with-padding`, `isMainList`
// как у tweb (`indexKey: 'index_0'`, `sortedDialogList.ts:187`).
//
// Окружение настоящее: запущенный владелец списков (`mountOwner`), живой
// `Scrollable` панели, Solid-ядро виртуального списка. Подменены только геометрия
// (высота скроллера — стаб `getBoundingClientRect`) и `ResizeObserver`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { FakeResizeObserver, mountOwner, resetStores, type Mounted } from '@lib/appDialogsManager.testkit'
import type { DialogListElement } from '@lib/appDialogsManager'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeDialog } from '@core/dialogs/testDialog'
import { makeMessage } from '@core/messages/testMessage'
import { getOutputPeer } from '@core/peers/peerId'
import type { SavedDialog } from '@core/managers/chatsManager'
import type { LangPackKey } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import { useChatsStore } from '@stores/chatsStore'
import appImManager from '@lib/appImManager'

vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { peers: { fillMirror: async () => {} } } }),
}))

const ME: PeerId = 7
const HOST_HEIGHT = 720
/** `itemSize: 72` — `appSearchSuper.ts:2225` */
const ITEM = 72

const user = (id: number, name = 'U' + id) => ({ _: 'user' as const, id, first_name: name, pFlags: {} })

/** Сохранённое сообщение лежит в «Избранном» (`peerId: ME`), источник — пересылка. */
const saved = (source: PeerId, i: number, text = 'msg-' + i): SavedDialog => ({
  peerId: source,
  lastMessage: {
    ...makeMessage({ id: i + 1, peerId: ME, fromId: ME, date: 1786968000 - i, text }),
    ...(source === ME ? {} : { fwd_from: { _: 'messageFwdHeader' as const, from_id: getOutputPeer(source), date: 1786960000 } }),
  },
})
const savedList = (n: number) => Array.from({ length: n }, (_, i) => saved(i % 2 ? -(i + 100) : i + 100, i))

function fakeBackend(dialogs: SavedDialog[]) {
  const calls = { dialogs: 0 }
  const managers = {
    messages: {
      searchHistory: async () => ({ messages: [], count: 0 }),
      searchCounters: async (_peerId: number, filters: string[]) => filters.map((filter) => ({ filter, count: 0 })),
    },
    peers: { fillMirror: async () => {} },
    chats: { savedDialogs: async () => { calls.dialogs++; return dialogs } },
    presence: { get: async () => [] },
  } as unknown as SearchSuperManagers
  return { managers, calls }
}

const SAVED_DIALOGS: SearchSuperMediaTab = { type: 'savedDialogs', name: 'FilterChats' as LangPackKey }
const MEDIA: SearchSuperMediaTab = { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey }

let owner: Mounted | undefined

function build(managers: SearchSuperManagers, onLengthChange?: AppSearchSuper['onLengthChange']) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const searchSuper = new AppSearchSuper({ mediaTabs: [{ ...SAVED_DIALOGS }, { ...MEDIA }], scrollable, managers, onLengthChange, hideEmptyTabs: false })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId: ME, historyStorage: getHistoryStorage(ME) })
  return { searchSuper, scrollable }
}

const settle = async() => {
  for(let i = 0; i < 4; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const itemsTab = (s: AppSearchSuper) => s.mediaTabsMap.get('savedDialogs')!.itemsTab!
const list = (s: AppSearchSuper) => itemsTab(s).querySelector<HTMLElement>('ul.chatlist')
/** строки сверху вниз — по `top`, который пишет ядро */
const rows = (s: AppSearchSuper) => Array.from(itemsTab(s).querySelectorAll<HTMLElement>('a.chatlist-chat'))
.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
const press = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))

beforeEach(() => {
  resetStores()
  resetSharedMediaHistories()
  resetPeerMirror()
  rootScope.myId = ME
  useChatsStore.setState({ meId: ME, dialogs: [], loaded: true })
  applyPeerOps([{ op: 'upsert', peers: [user(ME, 'Я'), user(100, 'Алиса'), user(102, 'Борис')] }])
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const height = this.classList.contains('scrollable') ? HOST_HEIGHT : 0
    return { width: 360, height, top: 0, left: 0, right: 360, bottom: height, x: 0, y: 0, toJSON() {} } as DOMRect
  })
  owner = mountOwner()
})

afterEach(() => {
  owner?.manager.destroy()
  owner = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  resetStores()
  resetPeerMirror()
})

describe('AppSearchSuper: «Чаты» у «Избранного» — строки DialogElement (loadSavedDialogs)', () => {
  it('строка — DialogElement своего пира с источником в threadId: классы, аватар и имя источника', async() => {
    const { managers } = fakeBackend([saved(100, 0)])
    const { searchSuper } = build(managers)

    await searchSuper.load(true)
    await settle()

    const [row] = rows(searchSuper)
    expect(row.dataset.peerId).toBe('' + ME)
    expect(row.dataset.threadId).toBe('100')
    expect(row.getAttribute('href')).toBe('#' + ME)
    // классы `DialogElement` (`appDialogsManager.ts:321-441`); `row-with-padding` —
    // от аватара-медиа (`rowTsx.tsx:166-172`), хотя `havePadding: !threadId` ложен;
    // хэш-класс модуля ядра (`styles.Item`) не предмет
    expect(Array.from(row.classList).filter((c) => !c.startsWith('_')).sort()).toEqual(
      ['chatlist-chat', 'chatlist-chat-bigger', 'hover-effect', 'no-wrap', 'row', 'row-big', 'row-clickable', 'row-with-padding', 'rp'].sort(),
    )
    expect(row.querySelector('.row-title-row.dialog-title .peer-title')!.textContent).toBe('Алиса')
    const avatar = row.querySelector('.dialog-avatar')!
    expect(avatar.classList.contains('row-media-bigger')).toBe(true)
    expect(avatar.classList.contains('avatar-54')).toBe(true)
    expect(avatar.getAttribute('data-peer-id')).toBe('100')
    // `indexKey: 'index_0'` → `isMainList: this.indexKey === 'index_0'` (`sortedDialogList.ts:187`)
    expect((row as DialogListElement).dialogElement!.isMainList).toBe(true)
  })

  it('подзаголовок — сохранённое сообщение, без иконки пересылки (`!isSaved`, dialogSubtitle.ts:51)', async() => {
    const { managers } = fakeBackend([saved(100, 0, 'привет')])
    const { searchSuper } = build(managers)

    await searchSuper.load(true)
    await settle()

    const [row] = rows(searchSuper)
    expect(row.querySelector('.dialog-subtitle .row-subtitle')!.textContent).toContain('привет')
    expect(row.querySelector('.dialog-subtitle-ico-forward_filled')).toBe(null)
    expect(row.querySelector('.dialog-title-details .message-time')!.textContent).not.toBe('')
  })

  it('«Мои заметки» — источник-зритель: иконка mynotes и имя «My Notes»', async() => {
    const { managers } = fakeBackend([saved(ME, 0), saved(100, 1)])
    const { searchSuper } = build(managers)

    await searchSuper.load(true)
    await settle()

    const [notes, other] = rows(searchSuper)
    expect(notes.querySelector('.avatar .avatar-icon-mynotes')).not.toBe(null)
    expect(notes.querySelector('.peer-title')!.textContent).toBe('My Notes')
    expect(other.querySelector('.avatar-icon-mynotes')).toBe(null)
  })

  it('порядок — порядок ответа владельца; ul ровно count * 72, в DOM только окно (14 = 720/72 + 4)', async() => {
    const { managers } = fakeBackend(savedList(150))
    const { searchSuper } = build(managers)

    await searchSuper.load(true)
    await settle()

    // `extraPaddingBottom: 0` (`:2230`) — без прибавки 8px
    expect(list(searchSuper)!.style.height).toBe(150 * ITEM + 'px')
    const r = rows(searchSuper)
    expect(r).toHaveLength(14)
    expect(r.map((el) => +el.dataset.threadId!).slice(0, 3)).toEqual([100, -101, 102])
  })

  it('клик открывает чат источника (О-110: окна сохранённого диалога нет); «Мои заметки» — «Избранное»', async() => {
    const setPeer = vi.spyOn(appImManager, 'setPeer').mockResolvedValue(undefined)
    useChatsStore.setState({ dialogs: [makeDialog({ peerId: 100 })] })
    const { managers } = fakeBackend([saved(100, 0), saved(102, 1), saved(ME, 2)])
    const { searchSuper } = build(managers)
    await searchSuper.load(true)
    await settle()
    const [alice, boris, notes] = rows(searchSuper)

    press(alice)
    expect(setPeer).toHaveBeenLastCalledWith({ peerId: 100 })

    press(boris)
    expect(setPeer).toHaveBeenLastCalledWith({ peerId: 102 })

    // tweb `setPeer({peerId: myId})` — «Избранное»
    press(notes)
    expect(setPeer).toHaveBeenLastCalledWith({ peerId: ME })
  })

  it('открытое «Избранное» не подсвечивает строки сохранённых диалогов (С10)', async() => {
    vi.spyOn(appImManager, 'chat', 'get').mockReturnValue({ peerId: ME } as typeof appImManager.chat)
    const { managers } = fakeBackend([saved(100, 0)])
    const { searchSuper } = build(managers)

    await searchSuper.load(true)
    await settle()

    expect(rows(searchSuper)[0].classList.contains('active')).toBe(false)
  })

  it('счётчик — строки страницы одним запросом; карточка секции раскрыта', async() => {
    const onLengthChange = vi.fn()
    const { managers, calls } = fakeBackend(savedList(3))
    const { searchSuper } = build(managers, onLengthChange)

    await searchSuper.load(true)
    await settle()

    expect(calls.dialogs).toBe(1)
    expect(searchSuper.counters.savedDialogs).toBe(3)
    expect(onLengthChange).toHaveBeenCalledWith('savedDialogs', 3)
    expect(searchSuper.mediaTabsMap.get('savedDialogs')!.hideOn!.classList.contains('hide')).toBe(false)
  })

  it('список живёт один на пира: повторный load не ходит в сеть и не плодит ul', async() => {
    const { managers, calls } = fakeBackend(savedList(2))
    const { searchSuper } = build(managers)

    await searchSuper.load(true)
    await settle()
    await searchSuper.load(true)
    await settle()

    expect(calls.dialogs).toBe(1)
    expect(itemsTab(searchSuper).querySelectorAll('ul')).toHaveLength(1)
  })

  it('смена пира снимает список по middleware, а скроллер панели не роняет (расхождение 7 списка)', async() => {
    const { managers, calls } = fakeBackend(savedList(2))
    const { searchSuper, scrollable } = build(managers)
    const removeSpy = vi.spyOn(scrollable.container, 'removeEventListener')
    await searchSuper.load(true)
    await settle()
    const onScrolledBottom = scrollable.onScrolledBottom

    searchSuper.setQuery({ peerId: 2, historyStorage: getHistoryStorage(2) })
    searchSuper.cleanupHTML()

    expect(removeSpy.mock.calls.some((c) => c[0] === 'scroll')).toBe(true)
    expect(list(searchSuper)).toBe(null)
    expect(scrollable.onScrolledBottom).toBe(onScrolledBottom)
    expect(onScrolledBottom).toBeTypeOf('function')

    searchSuper.setQuery({ peerId: ME, historyStorage: getHistoryStorage(ME) })
    await searchSuper.load(true)
    await settle()
    expect(calls.dialogs).toBe(2)
    expect(list(searchSuper)).not.toBe(null)
  })

  it('destroy() не оставляет ни строк, ни слушателя скролла на общем скроллере', async() => {
    const { managers } = fakeBackend(savedList(2))
    const { searchSuper, scrollable } = build(managers)
    const removeSpy = vi.spyOn(scrollable.container, 'removeEventListener')
    await searchSuper.load(true)
    await settle()
    expect(document.querySelector('ul.chatlist a.chatlist-chat')).not.toBe(null)

    searchSuper.destroy()

    expect(document.querySelector('.search-super')).toBe(null)
    expect(document.querySelector('a.chatlist-chat')).toBe(null)
    expect(removeSpy.mock.calls.some((c) => c[0] === 'scroll')).toBe(true)
  })
})
