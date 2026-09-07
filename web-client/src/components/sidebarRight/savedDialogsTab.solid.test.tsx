/** @jsxImportSource solid-js */
// Пины вкладки «Чаты» (savedDialogs) правой колонки на новом носителе —
// Solid `savedDialogsTab.solid.tsx` (задача 12 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`), порт
// tweb `appSearchSuper.ts:1890-1941` (`loadSavedDialogs`) поверх Solid-ядра
// `verticalVirtualList.solid.tsx` (порт `tweb/src/components/verticalVirtualList.tsx`).
//
// Сценарии унаследованы от `userInfo/SharedMedia.saved.test.tsx` (React-носитель,
// уходит задачей 13) — сверено по списку в его шапке:
// (1) в DOM живут только строки окна, а не весь набор;
// (2) высота `ul` — РОВНО `count * 72`, без `+8` (`extraPaddingBottom: 0`,
//     `tweb:1906`);
// (3) окно считается по скроллу ХОСТА, который приходит снаружи — это
//     `scrollable.container` всей панели (`tweb:1897`, `:1904`), а не родитель `ul`;
// (4) пустой набор: у оригинала `ul` ОСТАЁТСЯ (высота 0), а вкладку прячет
//     счётчик (`setCounter(type, 0)` → `hide` на строке ряда); React-заглушка
//     «Nothing here yet.» вместо `ul` в оригинале отсутствовала — не переносится;
// (5) `dispose` снимает список и слушатель скролла с хоста (у оригинала —
//     `xd.destroy()` по `middleware.onClean`, `tweb:1935-1938`);
// (6) клик по строке ОТКРЫВАЕТ пира — проверяется РЕЗУЛЬТАТ (куда ушла
//     навигация: `navigationStore`), а не вызов колбэка;
// (7)-(8) React-пины стабильности ссылок (`useEvent`/`useCallback`/`useMemo`)
//     на Solid предмета не имеют — гранулярная реактивность не перерисовывает
//     строки от рендера родителя;
// (9) пин класса `.scrollable-y` панели снят: хост приходит явно, не ищется по
//     классу.
//
// happy-dom не считает layout: размер хоста (`useElementSize` читает
// `getBoundingClientRect`) подставляется стабом на самом хосте.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSolid } from '@shared/solid/mountSolid.solid'
import { makeMessage } from '@core/messages/testMessage'
import type { SavedDialog } from '@core/managers/chatsManager'
import { useChatsStore } from '@stores/chatsStore'
import { useNavigationStore } from '@stores/navigationStore'
import itemStyles from '@components/virtual/DeferredSortedVirtualList.module.scss'
import SavedDialogsTab, { type SavedDialogsManagers, type SavedDialogsTabProps } from './savedDialogsTab.solid'

// `usePeer` (`stores/peers.solid`) объявляет пробел зеркала через
// `startClient().managers.peers.fillMirror`; сам `client/bootstrap` в графе
// теста поднимал бы воркер (`Worker` в happy-dom нет) — гасим фабрику.
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { peers: { fillMirror: async () => {} } } }),
}))

const HOST_HEIGHT = 720
/** `itemSize: 72` — `tweb/src/components/appSearchSuper.ts:1905`. */
const ITEM = 72
const SAVED = 150

// Ключ ЗНАКОВЫЙ: у источника-человека положительный, у источника-чата —
// отрицательный. Имя и аватарку строка берёт из карточки пира (зеркало),
// превью и время — из самого сообщения.
const dialog = (i: number): SavedDialog => {
  const peerId = i % 2 ? -(i + 1) : i + 1
  return {
    peerId,
    lastMessage: makeMessage({ id: i + 1, peerId, fromId: i + 1, date: 1786968000, text: 'msg-' + i }),
  }
}

const savedDialogs = (n: number): SavedDialog[] => Array.from({ length: n }, (_, i) => dialog(i))

let host: HTMLDivElement
let mount: HTMLDivElement
let dispose: (() => void) | undefined
let addSpy: ReturnType<typeof vi.spyOn>
let removeSpy: ReturnType<typeof vi.spyOn>

const scrollListenerCount = (spy: typeof addSpy) =>
  spy.mock.calls.filter((c: unknown[]) => c[0] === 'scroll').length

const list = () => host.querySelector('ul')
const rows = () => Array.from(host.querySelectorAll<HTMLElement>('.chatlist-chat'))
const rowTitles = () => rows().map((r) => r.textContent?.match(/msg-\d+/)?.[0] ?? '')

function fakeManagers(dialogs: SavedDialog[]) {
  let calls = 0
  const managers = {
    chats: { savedDialogs: async () => { calls++; return dialogs } },
    peers: { fillMirror: async () => {} },
    presence: { get: async () => [] },
  } as unknown as SavedDialogsManagers
  return { managers, calls: () => calls }
}

function render(props: Partial<SavedDialogsTabProps> & { managers: SavedDialogsManagers }) {
  const full: SavedDialogsTabProps = { scrollableHost: host, onCountChange: () => {}, ...props }
  const r = mountSolid(mount, SavedDialogsTab, full)
  dispose = r.dispose
  return r
}

/** Дать ответу фейкового RPC доехать до стора компонента. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  host = document.createElement('div')
  host.className = 'scrollable scrollable-y'
  host.getBoundingClientRect = () =>
    ({ width: 360, height: HOST_HEIGHT, top: 0, left: 0, right: 360, bottom: HOST_HEIGHT, x: 0, y: 0, toJSON() {} }) as DOMRect
  mount = document.createElement('div')
  host.append(mount)
  document.body.append(host)
  addSpy = vi.spyOn(host, 'addEventListener')
  removeSpy = vi.spyOn(host, 'removeEventListener')
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
  useChatsStore.setState({ meId: 7, dialogs: [] })
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.restoreAllMocks()
})

describe('SavedDialogsTab — «Чаты» на Solid-ядре виртуального списка', () => {
  it('150 сохранённых диалогов: в DOM только строки окна (14 = 720/72 + overscan 4)', async () => {
    render(fakeManagers(savedDialogs(SAVED)))
    await settle()

    // idx * 72 >= 0 - 288 — верно для всех idx >= 0;
    // (idx + 1) * 72 <= 0 + 720 + 288 = 1008 → idx <= 13 (`tweb:65-74`).
    expect(rows()).toHaveLength(14)
    expect(rowTitles()[0]).toBe('msg-0')
    expect(rowTitles()[13]).toBe('msg-13')
  })

  it('высота ul — РОВНО count * 72: extraPaddingBottom: 0, без прибавки 8px', async () => {
    render(fakeManagers(savedDialogs(SAVED)))
    await settle()

    // Мутация: `extraPaddingBottom: 8` (дефолт `deferredSortedVirtualList.tsx:55`) —
    // станет 10808px.
    expect(list()!.style.height).toBe(SAVED * ITEM + 'px')
    expect(list()!.style.height).toBe('10800px')
  })

  it('список несёт классы оригинала: ul.chatlist.virtual-chatlist (`sortedDialogList.ts:118`)', async () => {
    render(fakeManagers(savedDialogs(3)))
    await settle()

    expect(list()!.classList.contains('chatlist')).toBe(true)
    expect(list()!.classList.contains('virtual-chatlist')).toBe(true)
  })

  it('окно считается по скроллу ХОСТА: прокрутка хоста двигает набор строк', async () => {
    render(fakeManagers(savedDialogs(SAVED)))
    await settle()

    host.scrollTop = HOST_HEIGHT
    host.dispatchEvent(new Event('scroll'))

    // Нижняя: idx * 72 >= 720 - 288 = 432 → idx >= 6; верхняя: idx <= 23.
    expect(rows()).toHaveLength(18)
    expect(rowTitles()[0]).toBe('msg-6')
    expect(rowTitles()[17]).toBe('msg-23')
  })

  it('слушатель скролла висит на переданном хосте, а не на родителе ul', async () => {
    render(fakeManagers(savedDialogs(SAVED)))
    await settle()

    expect(list()!.parentElement).not.toBe(host)
    expect(scrollListenerCount(addSpy)).toBe(1)
  })

  it('строки — абсолютно спозиционированы ядром: класс Item и top = idx * 72', async () => {
    render(fakeManagers(savedDialogs(SAVED)))
    await settle()

    // Мутация: не навешивать `styles.Item` / не писать `top` — строки лягут
    // потоком поверх высоты `ul`.
    expect(rows().every((r) => r.classList.contains(itemStyles.Item))).toBe(true)
    expect(rows()[3].style.top).toBe(3 * ITEM + 'px')
  })

  it('до ответа RPC ul ростом с хост (forceHostHeight), после — по набору', async () => {
    let resolve!: (d: SavedDialog[]) => void
    const managers = {
      chats: { savedDialogs: () => new Promise<SavedDialog[]>((r) => { resolve = r }) },
      peers: { fillMirror: async () => {} },
      presence: { get: async () => [] },
    } as unknown as SavedDialogsManagers
    render({ managers })

    expect(list()!.style.height).toBe(HOST_HEIGHT + 'px')
    expect(list()!.style.overflow).toBe('hidden')

    resolve(savedDialogs(2))
    await settle()

    expect(list()!.style.height).toBe(2 * ITEM + 'px')
    expect(list()!.style.overflow).toBe('')
  })

  it('пустой набор: ul остаётся высотой 0, а наружу уходит счётчик 0', async () => {
    const onCountChange = vi.fn()
    render({ ...fakeManagers([]), onCountChange })
    await settle()

    expect(list()).not.toBe(null)
    expect(list()!.style.height).toBe('0px')
    expect(rows()).toHaveLength(0)
    expect(onCountChange).toHaveBeenLastCalledWith(0)
  })

  it('счётчик — размер набора одним RPC; повторного запроса нет', async () => {
    const onCountChange = vi.fn()
    const fake = fakeManagers(savedDialogs(5))
    render({ ...fake, onCountChange })
    await settle()
    await settle()

    expect(onCountChange).toHaveBeenCalledWith(5)
    expect(fake.calls()).toBe(1)
  })

  it('клик по строке открывает ОРИГИНАЛЬНЫЙ чат пира — навигация уходит в navigationStore', async () => {
    // Пир-человек 1 уже есть в списке диалогов — открывается его чат;
    // пир-чат -2 открывается всегда (черновик бывает только у человека).
    useChatsStore.setState({ meId: 7, dialogs: [{ peerId: 1 } as never] })
    render(fakeManagers(savedDialogs(SAVED)))
    await settle()

    rows()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(useNavigationStore.getState().selectedId).toBe('1')

    rows()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(useNavigationStore.getState().selectedId).toBe('-2')
  })

  it('человек без диалога открывается черновиком с именем из карточки', async () => {
    render(fakeManagers(savedDialogs(SAVED)))
    await settle()

    rows()[2].dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const nav = useNavigationStore.getState()
    expect(nav.selectedId).toBe('draft:3')
    expect(nav.draftPeer).toMatchObject({ id: 3, title: expect.any(String) })
  })

  it('строка «Избранного» (self) не открывает пира и подписана «My Notes»', async () => {
    // «Мои заметки» — строка, чей источник совпадает со ЗРИТЕЛЕМ: вида
    // строкой на проводе нет, его отвечает сам ключ.
    const self: SavedDialog = { peerId: 7 }
    render(fakeManagers([self, dialog(1)]))
    await settle()

    const first = rows()[0]
    expect(first.textContent).toContain('My Notes')
    expect(first.classList.contains('rp')).toBe(false)
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(useNavigationStore.getState().selectedId).toBe(null)
  })

  it('строка — разметка chatlist-chat оригинала: заголовок, время, превью, аватар последним', async () => {
    render(fakeManagers(savedDialogs(1)))
    await settle()

    const row = rows()[0]
    expect(row.dataset.peerId).toBe('1')
    expect(row.querySelector('.row-title-row.dialog-title .row-title')).not.toBe(null)
    expect(row.querySelector('.row-title-right-secondary .message-time')).not.toBe(null)
    expect(row.querySelector('.row-subtitle-row.dialog-subtitle .row-subtitle')?.textContent).toBe('msg-0')
    // Строка «Избранного» — `addListDialog` с дефолтным `avatarSize: 'bigger'`
    // (`appDialogsManager.ts:216`, `:336-346`): 54px аватар, `row-big` = 72px.
    expect(row.classList.contains('chatlist-chat-bigger')).toBe(true)
    expect(row.classList.contains('row-big')).toBe(true)
    expect(row.lastElementChild!.classList.contains('dialog-avatar')).toBe(true)
    expect(row.lastElementChild!.classList.contains('row-media-bigger')).toBe(true)
    expect(row.lastElementChild!.classList.contains('avatar-54')).toBe(true)
  })

  it('dispose снимает список и слушатель скролла с хоста', async () => {
    render(fakeManagers(savedDialogs(SAVED)))
    await settle()
    expect(list()).not.toBe(null)
    expect(scrollListenerCount(addSpy)).toBe(1)

    dispose!()
    dispose = undefined

    expect(list()).toBe(null)
    expect(scrollListenerCount(removeSpy)).toBe(scrollListenerCount(addSpy))
  })
})
