// src/components/Sidebar.archive.test.tsx
// Оверлей архива колонки (`ВРЕМЕННО до 1-5`, вкладка `AppArchivedTab` у tweb):
// список — `AutonomousDialogList(FOLDER_ID_ARCHIVE)` владельца
// (`appDialogsManager.mountArchivedList`, задача 1-4 волны 7), как у вкладки tweb
// `archivedTab.tsx:80-110`.
//
// Пины здесь про проводку ИМЕННО архива, а не про само ядро
// (`deferredSortedVirtualList.solid.test.tsx`) и не про список папки
// (`autonomousDialogList/dialogs.test.ts`):
// (1) в DOM живут только строки окна, а не весь архив;
// (2) `ul` несёт высоту под ВЕСЬ набор и лежит в скроллере списка;
// (3) размер набора — `count` АРХИВНОЙ выборки владельца: при неполной загрузке
//     хвост — скелетоны, и они же просят следующую страницу;
// (4) пустой архив показывает заглушку ВМЕСТО списка;
// (5) клик по строке открывает чат, подсветку ставит `peer_changed` владельца.
// React-пины мемоизации строк (`memo`, стабильный `renderItem`, кэш обёрток
// `useDialogListSource`) предмета больше не имеют: строку строит список один раз
// (`SortedDialogList`), React её не перерисовывает.
//
// Тест гоняет ЖИВОЙ Sidebar: оверлей открывается тем же путём, что у пользователя, —
// кликом по закреплённой строке «Архив» в списке «Всех чатов».
//
// happy-dom не считает layout: высоту скроллера (её читает `useElementSize` ядра)
// отдаёт стаб `getBoundingClientRect`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import s from './Sidebar.module.scss'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { useFoldersStore } from '../stores/foldersStore'
import { useNotifyStore } from '../stores/notifyStore'
import { useNavigationStore } from '../stores/navigationStore'
import { useAppStateStore } from '../stores/appState'
import { useSettingsStore } from '../settings'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '../core/folderIds'
import type { Managers } from '../client/bootstrap'
import { isDialogArchived, type Dialog } from '../core/models'
import { makeDialog } from '../core/dialogs/testDialog'

const HOST_HEIGHT = 720
const ITEM = 72
/** Архивных — заведомо больше окна; обычных — сколько угодно, лишь бы список жил. */
const ARCHIVED = 300
const NORMAL = 5
/** id архивных диалогов идут отдельным диапазоном — их видно в `href` строки. */
const ARCHIVE_ID_BASE = 1000

// Владелец отдаёт страницу СВОЕЙ выборки из зеркала (курсор — индекс, как
// `dialogsManager.forFilter`) и её размер: «Все чаты» — набор незаархивированных,
// архив — свой (`/chats?folder_id=1`; `archiveCount` — сколько их «на сервере»).
const answerFor = (o: { filterId: number, offsetIndex?: number, limit?: number }, archiveCount: number) => {
  const { dialogs, dialogIndexById } = useChatsStore.getState()
  const archived = o.filterId === ARCHIVE_FOLDER_ID
  const matching = dialogs.filter((d) => isDialogArchived(d) === archived)
  const after = matching.filter((d) => o.offsetIndex === undefined || dialogIndexById[d.peerId] < o.offsetIndex)
  const limit = o.limit ?? 20
  return {
    dialogs: after.slice(0, limit),
    count: archived ? archiveCount : NORMAL,
    isEnd: after.length <= limit,
  }
}

function managersWith(getDialogs: (o: { filterId: number }) => unknown): Managers {
  return new Proxy({}, {
    get: (_target, ns: string) => new Proxy({}, {
      get: (_t, method: string) => {
        if (ns === 'realtime' && method === 'getStatus') return async () => ({ state: 'ready', retryAt: undefined, syncing: false })
        if (ns === 'dialogs' && method === 'getDialogs') return getDialogs
        return async () => undefined
      },
    }),
  }) as unknown as Managers
}

function fakeManagers(archiveCount = ARCHIVED) {
  const getDialogs = vi.fn(async (o: { filterId: number, offsetIndex?: number, limit?: number }) => answerFor(o, archiveCount))
  return { managers: managersWith(getDialogs), getDialogs }
}

/** Тот же владелец, но страница АРХИВНОЙ выборки не отвечает, пока тест её не
 *  отпустит: только в этом окне у архивного списка `wasAtLeastOnceFetched === false`
 *  (первая загрузка ещё идёт). */
function pendingArchiveManagers(archiveCount = ARCHIVED) {
  let release: (() => void) | null = null
  const getDialogs = vi.fn(async (o: { filterId: number, offsetIndex?: number, limit?: number }) => {
    if (o.filterId === ARCHIVE_FOLDER_ID && o.limit !== 10) await new Promise<void>((resolve) => { release = resolve })
    return answerFor(o, archiveCount)
  })
  return { managers: managersWith(getDialogs), release: () => release?.() }
}

const dialog = (peerId: PeerId, archived: boolean): Dialog => makeDialog({ peerId, archived })

/** Кладём диалоги в зеркало ТЕМ ЖЕ путём, что проектор — операцией владельца. */
function seedMirror(items: { dialog: Dialog; index: number }[]) {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false })
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items }])
}

function seed(archived: number) {
  const normal = Array.from({ length: NORMAL }, (_, i) => ({ dialog: dialog(i + 1, false), index: 10_000 - i }))
  const arch = Array.from({ length: archived }, (_, i) => ({
    dialog: dialog(ARCHIVE_ID_BASE + i + 1, true), index: archived - i,
  }))
  seedMirror([...normal, ...arch])
}

/** Хост оверлея и скроллер списка архива (узел владельца, `l()` → `generateScrollable`). */
const archiveBox = () => document.querySelector<HTMLElement>('.' + s.archiveList) as HTMLElement
const archiveHost = () => archiveBox().querySelector<HTMLElement>(':scope > .scrollable')!
const archiveList = () => archiveHost().querySelector('ul') as HTMLElement
/** Строки сверху вниз — по `top` ядра (порядок узлов в DOM — не порядок строк). */
const archiveRows = () => Array.from(archiveList().querySelectorAll<HTMLElement>('a.chatlist-chat'))
.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))

/** Троттлинг измерения скролла в happy-dom уходит в `setTimeout(24)`. */
async function scrollArchiveTo(top: number) {
  const host = archiveHost()
  act(() => {
    host.scrollTop = top
    host.dispatchEvent(new Event('scroll'))
  })
  await settle()
}

/** Волна раскрытия строк ядра (`setTimeout` ~8 мс) и ответы владельца. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
}

beforeEach(() => {
  seed(ARCHIVED)
  useSettingsStore.setState({ passcodeEnabled: false })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useAppStateStore.setState({ folders: [] })
  useNavigationStore.setState({ selectedId: null })
  useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: false, preview: true }, channels: { muted: false, preview: true } } })

  // Высота есть у скроллера папки и у скроллера списка архива — из неё каждый
  // список считает своё окно видимости.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains('scrollable')) {
      return { width: 360, height: HOST_HEIGHT, top: 0, left: 0, right: 360, bottom: HOST_HEIGHT, x: 0, y: 0, toJSON() {} } as DOMRect
    }
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect
  })
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Рендер сайдбара + открытие оверлея архива кликом по закреплённому ряду. */
async function mountAndOpenArchive(managers: Managers) {
  render(
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await settle()

  // Закреплённая строка «Архив» — ПЕРВАЯ в списке «Всех чатов» (`div`, в отличие от
  // строки-диалога `a`; островом `ArchiveRow`, ВРЕМЕННО до 1-5), кликом по ней
  // оверлей и открывается (tweb `openArchiveTab`).
  const archiveRow = document.querySelector('ul.chatlist div.chatlist-chat') as HTMLElement
  await act(async () => { fireEvent.click(archiveRow) })
  await settle()
}

/** То же с владельцем, отвечающим сразу. `archiveCount` — размер архивной
 *  выборки, который он отдаёт (по умолчанию сходится с засеянным зеркалом:
 *  архив загружен целиком). */
async function openArchive(archiveCount = ARCHIVED) {
  const { managers, getDialogs } = fakeManagers(archiveCount)
  await mountAndOpenArchive(managers)
  return { getDialogs }
}

describe('Sidebar — архив на виртуальном ядре', () => {
  it('300 архивных чатов: в DOM только строки окна (14 = 720/72 + overscan 4)', async () => {
    await openArchive()

    // idx * 72 >= 0 - 288 — верно для всех idx >= 0;
    // (idx + 1) * 72 <= 0 + 720 + 288 = 1008 → idx <= 13 (у idx=13 РОВНО 1008).
    expect(archiveRows()).toHaveLength(14)
    expect(archiveRows()[0].getAttribute('href')).toBe('#' + (ARCHIVE_ID_BASE + 1))
    expect(archiveRows()[13].getAttribute('href')).toBe('#' + (ARCHIVE_ID_BASE + 14))
  })

  it('скролл двигает окно архива: въезжают следующие строки, уехавшие уходят', async () => {
    await openArchive()

    await scrollArchiveTo(HOST_HEIGHT)

    // Нижняя: idx * 72 >= 720 - 288 = 432 → idx >= 6; верхняя: idx <= 23.
    expect(archiveRows()).toHaveLength(18)
    expect(archiveRows()[0].getAttribute('href')).toBe('#' + (ARCHIVE_ID_BASE + 7))
    expect(archiveRows()[17].getAttribute('href')).toBe('#' + (ARCHIVE_ID_BASE + 24))
  })

  it('ul лежит в контейнере прокрутки и несёт высоту под ВЕСЬ архив (300 * 72 + 8)', async () => {
    await openArchive()

    expect(archiveList().closest('.scrollable')).toBe(archiveHost())
    expect(archiveList().style.height).toBe(ARCHIVED * ITEM + 8 + 'px')
  })

  // Размер набора приезжает от ВЛАДЕЛЬЦА, а не считается по зеркалу: пока
  // архив догружен не весь, `ul` ростом со всю выборку, а её незагруженный
  // хвост — дырки-скелетоны, которые и просят следующую страницу.
  it('загружена часть архива: ul ростом со ВСЮ выборку, хвост — скелетоны', async () => {
    const SERVER = ARCHIVED * 2

    await openArchive(SERVER)

    expect(archiveList().style.height).toBe(SERVER * ITEM + 8 + 'px')
    await scrollArchiveTo(SERVER * ITEM + 8 - HOST_HEIGHT)
    expect(archiveList().querySelectorAll('.loading-dialog-skeleton').length).toBeGreaterThan(0)
  })

  it('в хвосте списка настоящие строки, а не скелетоны-дырок', async () => {
    await openArchive()

    // Архив здесь загружен ЦЕЛИКОМ (владелец отдал ровно длину зеркала),
    // поэтому дырок нет вовсе. Дырки ядро кладёт В КОНЕЦ (`fullItems` длиной
    // `totalCount`), поэтому смотреть на них надо с самого низа: `totalCount`
    // больше набора хоть на единицу — и последнее окно доберёт скелетон (это
    // соседний тест). Низ: 300*72 + 8 - 720.
    await scrollArchiveTo(ARCHIVED * ITEM + 8 - HOST_HEIGHT)

    // Нижняя граница: idx >= ceil((20888 - 288) / 72) = 287; верхняя — за концом
    // набора, поэтому окно упирается в его длину: строки 288..300.
    // хвост догружается страницами по 20 — ждём, пока они дойдут до конца набора
    await vi.waitFor(() => expect(archiveRows()).toHaveLength(13), { timeout: 5000 })
    expect(archiveRows()[12].getAttribute('href')).toBe('#' + (ARCHIVE_ID_BASE + ARCHIVED))
    expect(archiveList().querySelectorAll('.loading-dialog-skeleton')).toHaveLength(0)
  })

  // Порт `archivedTab.tsx:19,80-96`: у архива СВОЙ курсор — он просит страницы
  // сам, как и список папки. Без этого архив живёт лишь тем, что случайно
  // оказалось в зеркале, а страницы «Всех чатов» уходят с `folder_id=0` и
  // архивных диалогов не приносят вовсе (спека, «Дополнение: вход в архив»).
  // Мутация: не звать `setFilterIdAndChangeTab(FOLDER_ID_ARCHIVE)` в
  // `mountArchivedList` — запроса с `filterId: ARCHIVE_FOLDER_ID` при открытии нет.
  it('архив листается сам: открытие оверлея просит у владельца страницу архивной выборки', async () => {
    const { getDialogs } = await openArchive()

    // Первые страницы — по одной на список. Запроса строки «Архив» здесь нет:
    // архив уже в зеркале (`seed`), просить нечего (`ensureArchiveDialogHydrated`).
    const firstPages = getDialogs.mock.calls.map(([o]) => o).filter((o) => o.offsetIndex === undefined)
    expect(firstPages).toEqual([
      { offsetIndex: undefined, limit: 20, filterId: ALL_FOLDER_ID },
      { offsetIndex: undefined, limit: 20, filterId: ARCHIVE_FOLDER_ID },
    ])
  })

  it('клик по строке архива выбирает ТОТ ЖЕ чат и подсвечивает её', async () => {
    await openArchive()

    // клик списка — `mousedown` в фазе захвата (`setListClickListener`, tweb `:2072-2346`)
    await act(async () => { fireEvent.mouseDown(archiveRows()[3], { button: 0 }) })

    const id = String(ARCHIVE_ID_BASE + 4)
    expect(useNavigationStore.getState().selectedId).toBe(id)
    expect(archiveRows()[3].classList.contains('active')).toBe(true)
  })

  it('новый архивный чат встаёт первым в архиве (`dialogs_multiupdate`), окно сдвигается компенсацией скролла', async () => {
    await openArchive()
    await scrollArchiveTo(HOST_HEIGHT)

    // Индекс между обычными чатами (10 000-…) и архивными (300-…) — новый чат
    // встаёт ПЕРВЫМ в архиве, все прежние строки уезжают ровно на одну позицию.
    await act(async () => {
      useChatsStore.getState().applyDialogOps([
        { op: 'upsert', items: [{ dialog: dialog(ARCHIVE_ID_BASE + 900, true), index: 5000 }] },
      ])
    })

    await settle()
    // Равномерный сдвиг ядро компенсирует скроллом (`onScrollShift`,
    // `verticalVirtualList.tsx:49-53`), а не анимацией `top` у всех видимых строк.
    expect(archiveHost().scrollTop).toBe(HOST_HEIGHT + ITEM)
  })

  // Пока первая страница архива летит, ядро держит `ul` ростом с хост
  // (`wasAtLeastOnceFetched` ложен, `forceHostHeight`), после ответа — под весь набор.
  it('первая страница архива ещё летит: ul ростом с ХОСТ, а не под весь набор', async () => {
    const { managers, release } = pendingArchiveManagers()
    await mountAndOpenArchive(managers)

    expect(archiveList().style.height).toBe(HOST_HEIGHT + 'px')

    await act(async () => { release() })
    await settle()

    expect(archiveList().style.height).toBe(ARCHIVED * ITEM + 8 + 'px')
  })

  it('пустой архив: заглушка ВМЕСТО списка, ul в DOM нет', async () => {
    await openArchive()
    expect(archiveList()).not.toBe(null)

    // Разархивировали всё, пока оверлей открыт, — он остаётся на экране.
    await act(async () => { seed(0) })

    expect(archiveBox().querySelector('ul')).toBe(null)
    expect(screen.getByText('No archived chats')).toBeTruthy()
  })
})
