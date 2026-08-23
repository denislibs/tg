// src/components/Sidebar.archive.test.tsx
// Этап 4, Task 1: оверлей архива переехал на то же виртуальное ядро, что и
// список папки (`DeferredSortedVirtualList`).
//
// Пины здесь про проводку ИМЕННО архива, а не про само ядро (оно покрыто
// `virtual/*.test.tsx`) и не про список папки (`ChatList.test.tsx`):
// (1) в DOM живут только строки окна, а не весь архив;
// (2) `ul` несёт высоту под ВЕСЬ набор и лежит прямо в контейнере прокрутки;
// (3) `totalCount` — размер АРХИВНОЙ выборки, который отдал ВЛАДЕЛЕЦ (а не
//     длина того, что уже в зеркале): при неполной загрузке архива хвост списка
//     это дырки-скелетоны, и они же просят следующую страницу — оверлей
//     листается сам (порт `archivedTab.tsx:19,80-96` — архив это тот же
//     `AutonomousDialogList` с `FOLDER_ID_ARCHIVE`);
// (4) пустой архив показывает заглушку ВМЕСТО `ul`;
// (5) строки те же `ChatListItem` с тем же `onSelect`/`selected`.
//
// Тест гоняет ЖИВОЙ Sidebar (как `Sidebar.chatlist.test.tsx`): оверлей архива
// открывается тем же путём, что у пользователя, — кликом по закреплённому ряду
// «Архив» в списке чатов.
//
// happy-dom не считает layout: `offsetHeight`/`offsetWidth` (их читает
// `useElementSize` у контейнера прокрутки) подставляются стабом на прототипе —
// тот же приём, что в `ChatList.test.tsx`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Рендеры НАСТОЯЩЕЙ `ChatListItem` — считаются по `useTypingLabel`, который
// строка зовёт ровно один раз за рендер и ровно со своим `chatId` (приём
// `ChatList.test.tsx`). Границей мемоизации при этом остаётся `memo` самой
// строки, поэтому счётчик краснеет и на снятом `memo`, и на нестабильных
// пропсах, приехавших из `ArchiveList`.
// `archiveRenderItems` — какая ссылка `renderItem` приезжала в ядро списка
// АРХИВА (в сайдбаре таких списков два — папки и архива, различаем по классу
// `ul`). Сюда `useCallback` вокруг `renderItem` попадает напрямую: счётчик
// рендеров строк его не видит, потому что пропсы строки стабильны сами по себе
// и её `memo` гасит лишний рендер даже при меняющемся `renderItem`.
const { rowRenders, archiveRenderItems } = vi.hoisted(() => ({
  rowRenders: [] as number[],
  archiveRenderItems: [] as unknown[],
}))

vi.mock('../core/hooks/useTypingLabel', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../core/hooks/useTypingLabel')>()
  return {
    ...mod,
    useTypingLabel: (chatId: number, isGroup: boolean) => {
      rowRenders.push(chatId)
      return mod.useTypingLabel(chatId, isGroup)
    },
  }
})

vi.mock('./virtual/DeferredSortedVirtualList', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./virtual/DeferredSortedVirtualList')>()
  const styles = (await import('./Sidebar.module.scss')).default
  const Real = mod.default
  return {
    ...mod,
    default: (props: ComponentProps<typeof Real>) => {
      if (props.className === styles.archiveVirtualList) archiveRenderItems.push(props.renderItem)
      return <Real {...props} />
    },
  }
})

import type { ComponentProps } from 'react'

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
import type { Dialog } from '../core/models'
import { makeDialog } from '../core/dialogs/testDialog'

const HOST_HEIGHT = 720
const ITEM = 72
/** Архивных — заведомо больше окна; обычных — сколько угодно, лишь бы список жил. */
const ARCHIVED = 300
const NORMAL = 5
/** id архивных диалогов идут отдельным диапазоном — их видно в `href` строки. */
const ARCHIVE_ID_BASE = 1000

// Владелец отдаёт размер СВОЕЙ выборки: «Все чаты» — набор незаархивированных,
// архив — свой (`/chats?folder_id=1`). Дырок ни у того, ни у другого не
// остаётся, поэтому каждый список просит страницу ровно один раз — на первом
// показе. Сами диалоги приезжают зеркалу отдельно (`seedMirror`), как их
// разложил бы проектор по операции владельца.
const answerFor = (filterId: number, archiveCount: number) => ({
  dialogs: [],
  count: filterId === ARCHIVE_FOLDER_ID ? archiveCount : NORMAL,
  isEnd: true,
})

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
  const getDialogs = vi.fn(async (o: { filterId: number }) => answerFor(o.filterId, archiveCount))
  return { managers: managersWith(getDialogs), getDialogs }
}

/** Тот же владелец, но страница АРХИВНОЙ выборки не отвечает, пока тест её не
 *  отпустит: только в этом окне у архивного списка живы `wasAtLeastOnceFetched
 *  === false` и `animate === false` (первая загрузка ещё идёт). */
function pendingArchiveManagers(archiveCount = ARCHIVED) {
  let release: (() => void) | null = null
  const getDialogs = vi.fn(async (o: { filterId: number }) => {
    if (o.filterId === ARCHIVE_FOLDER_ID) await new Promise<void>((resolve) => { release = resolve })
    return answerFor(o.filterId, archiveCount)
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

/** Архивный чат получил сообщение и уехал на самый верх архива. */
const raiseArchived = (chatId: number, index: number) =>
  useChatsStore.getState().applyDialogOps([{ op: 'upsert', items: [{ dialog: dialog(chatId, true), index }] }])

/** Контейнер прокрутки оверлея архива — он же `scrollableHost` списка. */
const archiveHost = () => document.querySelector<HTMLElement>('.' + s.archiveList) as HTMLElement
const archiveList = () => archiveHost().querySelector('ul') as HTMLElement
const archiveRows = () => Array.from(archiveList().querySelectorAll<HTMLElement>('a.chatlist-chat'))
/** Строки, которым ядро ПРЯМО СЕЙЧАС анимирует `top`: на время движения
 *  `useAnimatedTop` держит на строке `--background` (`useAnimatedTop.ts:97`). */
const animatingRows = () => archiveRows().filter((el) => el.style.getPropertyValue('--background') !== '')
/** Рендеры НАСТОЯЩИХ строк архива (id обычных диалогов в этот диапазон не попадают). */
const archiveRowRenders = () => rowRenders.filter((id) => id > ARCHIVE_ID_BASE).length

/** Троттлинг измерения скролла в happy-dom уходит в `setTimeout(24)`. */
async function scrollArchiveTo(top: number) {
  const host = archiveHost()
  act(() => {
    host.scrollTop = top
    host.dispatchEvent(new Event('scroll'))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
}

let sizeStubbed = false

beforeEach(() => {
  rowRenders.length = 0
  archiveRenderItems.length = 0
  seed(ARCHIVED)
  useSettingsStore.setState({ passcodeEnabled: false })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useAppStateStore.setState({ folders: [] })
  useNavigationStore.setState({ selectedId: null })
  useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: false, preview: true }, channels: { muted: false, preview: true } } })

  if (!sizeStubbed) {
    sizeStubbed = true
    // Высота есть у контейнера прокрутки папки и у контейнера прокрутки архива —
    // из неё каждый список считает своё окно видимости.
    const isHost = (el: HTMLElement) =>
      el.classList.contains('folders-scrollable') || el.classList.contains(s.archiveList)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return isHost(this) ? HOST_HEIGHT : 0 },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) { return isHost(this) ? 360 : 0 },
    })
  }
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Рендер сайдбара + открытие оверлея архива кликом по закреплённому ряду. */
async function mountAndOpenArchive(managers: Managers) {
  render(
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await act(async () => {})

  // Закреплённый ряд «Архив» — ПЕРВЫЙ элемент списка чатов (`div`, в отличие от
  // строки-диалога `a`), кликом по нему оверлей и открывается.
  const archiveRow = document.querySelector('ul.chatlist > div.chatlist-chat') as HTMLElement
  await act(async () => { fireEvent.click(archiveRow) })
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

    expect(archiveList().parentElement).toBe(archiveHost())
    expect(archiveList().style.height).toBe(ARCHIVED * ITEM + 8 + 'px')
  })

  // Размер набора приезжает от ВЛАДЕЛЬЦА, а не считается по зеркалу: пока
  // архив догружен не весь, `ul` ростом со всю выборку, а её незагруженный
  // хвост — дырки-скелетоны, которые и просят следующую страницу. Мутация:
  // `totalCount={items.length}` в `ArchiveList` — оба ассерта краснеют.
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
    expect(archiveRows()).toHaveLength(13)
    expect(archiveRows()[12].getAttribute('href')).toBe('#' + (ARCHIVE_ID_BASE + ARCHIVED))
    expect(archiveList().querySelectorAll('.loading-dialog-skeleton')).toHaveLength(0)
  })

  // Порт `archivedTab.tsx:19,80-96`: у архива СВОЙ курсор — он просит страницы
  // сам, как и список папки. Без этого архив живёт лишь тем, что случайно
  // оказалось в зеркале, а страницы «Всех чатов» уходят с `folder_id=0` и
  // архивных диалогов не приносят вовсе (спека, «Дополнение: вход в архив»).
  // Мутация: вернуть списку `NO_ITEM_REQUEST` и `totalCount={items.length}` —
  // запроса с `filterId: ARCHIVE_FOLDER_ID` при открытии оверлея не будет.
  it('архив листается сам: открытие оверлея просит у владельца страницу архивной выборки', async () => {
    const { getDialogs } = await openArchive()

    // Счёт ТОЧНЫЙ: по одной первой странице на список и ни одной сверх — иначе
    // дырки-скелетоны архива устроили бы лавину запросов. Запроса строки
    // «Архив» здесь нет: архив уже в зеркале (`seed`), просить нечего
    // (`useDialogListSource::ensureArchiveHydrated`).
    expect(getDialogs.mock.calls.map(([o]) => o)).toEqual([
      { offsetIndex: undefined, limit: 20, filterId: ALL_FOLDER_ID },
      { offsetIndex: undefined, limit: 20, filterId: ARCHIVE_FOLDER_ID },
    ])
  })

  it('клик по строке архива выбирает ТОТ ЖЕ чат и подсвечивает её', async () => {
    await openArchive()

    await act(async () => { fireEvent.click(archiveRows()[3]) })

    const id = String(ARCHIVE_ID_BASE + 4)
    expect(useNavigationStore.getState().selectedId).toBe(id)
    expect(archiveRows()[3].classList.contains('active')).toBe(true)
  })

  it('рендер сайдбара строк архива не касается', async () => {
    await openArchive()

    expect(archiveRowRenders()).toBe(14) // всё окно, по разу

    // Рендер сайдбара, не меняющий ни набор архива, ни выделение: включили
    // код-пароль (над списком появляется замок). Мутации, которые это краснит:
    // снять `useEvent` вокруг `onSelect` или `useCallback` вокруг `renderItem`
    // в `ArchiveList` — `handleSelect` приезжает новой стрелкой на каждом
    // рендере Sidebar, и всё окно перерисуется; снять `memo` с `ChatListItem` —
    // тоже.
    await act(async () => { useSettingsStore.setState({ passcodeEnabled: true }) })

    expect(archiveRowRenders()).toBe(14)
  })

  it('ядро архива получает ОДНУ И ТУ ЖЕ ссылку renderItem между рендерами', async () => {
    await openArchive()
    await act(async () => { useSettingsStore.setState({ passcodeEnabled: true }) })

    // Мутация: снять `useCallback` вокруг `renderItem` в `ArchiveList` — на
    // каждом рендере сайдбара в ядро приезжает новая стрелка, и оно проходит
    // по всему окну заново (строки при этом спасает их собственный `memo`,
    // поэтому счётчик рендеров строк такую мутацию не видит).
    expect(archiveRenderItems.length).toBeGreaterThan(1)
    expect(new Set(archiveRenderItems).size).toBe(1)
  })

  it('операция зеркала в ЧУЖОМ чате строк архива не касается', async () => {
    await openArchive()
    expect(archiveRowRenders()).toBe(14)

    // Прочитали обычный (неархивный) чат: `dialogs` в зеркале — новый массив,
    // значит и `chats` приезжают новыми. Мутация: убрать кэш обёрток в
    // `useDialogListSource` (`itemCacheRef`/`prevItemsRef`) — у каждой строки
    // окна сменится ссылка `item`, и все 14 перерисуются.
    await act(async () => {
      useChatsStore.getState().applyDialogOps([{ op: 'patch', peerId: 1, fields: { unread_count: 1 } }])
    })

    expect(archiveRowRenders()).toBe(14)
  })

  it('новый архивный чат сверху компенсируется скроллом, а не рывком всех строк', async () => {
    await openArchive()
    await scrollArchiveTo(HOST_HEIGHT)

    // Индекс между обычными чатами (10 000-…) и архивными (300-…) — новый чат
    // встаёт ПЕРВЫМ в архиве, все прежние строки уезжают ровно на одну позицию.
    await act(async () => {
      useChatsStore.getState().applyDialogOps([
        { op: 'upsert', items: [{ dialog: dialog(ARCHIVE_ID_BASE + 900, true), index: 5000 }] },
      ])
    })

    // Равномерный сдвиг ядро компенсирует скроллом, а не анимацией `top` у всех
    // видимых строк сразу (`useShouldAnimate` → `createScrollShiftCompensator`).
    // Мутация: убрать кэш обёрток в `useDialogListSource` — сравнение старого и
    // нового списка идёт ПО ССЫЛКЕ, новые обёртки в прежнем списке не найдутся,
    // компенсация не сработает и весь экран дёрнется.
    expect(archiveHost().scrollTop).toBe(HOST_HEIGHT + ITEM)
  })

  // `wasAtLeastOnceFetched` и `animate` — ЖИВЫЕ значения из
  // `useDialogListSource`, а не константы (ими они были, пока своей первой
  // загрузки у архива не существовало вовсе). Наблюдать разницу можно РОВНО
  // пока первая страница архива летит: во всех остальных тестах файла ассерты
  // идут после её ответа, когда оба значения уже истинны, — там мутация
  // «обратно в `true`» не красит ничего.
  describe('первая страница архива ещё летит', () => {
    it('ul ростом с ХОСТ, а не под весь набор (wasAtLeastOnceFetched)', async () => {
      const { managers, release } = pendingArchiveManagers()
      await mountAndOpenArchive(managers)

      // Мутация `wasAtLeastOnceFetched={true}`: `forceHostHeight` снимается, и
      // `ul` сразу получает высоту под всю выборку — первый ассерт краснеет.
      expect(archiveList().style.height).toBe(HOST_HEIGHT + 'px')

      await act(async () => { release() })

      expect(archiveList().style.height).toBe(ARCHIVED * ITEM + 8 + 'px')
    })

    it('переезд строки НЕ анимируется, а после ответа — анимируется (animate)', async () => {
      const { managers, release } = pendingArchiveManagers()
      await mountAndOpenArchive(managers)

      // Сдвиг НЕравномерный (одна строка едет через всё окно наверх, остальные —
      // на позицию вниз), поэтому `useShouldAnimate` анимацию разрешает и
      // решает уже `animate` списка: пока первая загрузка не доиграла, глушилка
      // (`blockedAnimationCount`) держит её выключенной.
      // Мутация `animate={true}`: строки поедут анимацией и `--background`
      // встанет — первый ассерт краснеет.
      await act(async () => { raiseArchived(ARCHIVE_ID_BASE + 10, 1000) })
      expect(animatingRows()).toHaveLength(0)

      await act(async () => { release() })
      await act(async () => { raiseArchived(ARCHIVE_ID_BASE + 11, 1001) })

      // Мутация `animate={false}`: анимации не будет и здесь — второй ассерт
      // краснеет.
      expect(animatingRows().length).toBeGreaterThan(0)
    })
  })

  it('пустой архив: заглушка ВМЕСТО списка, ul в DOM нет', async () => {
    await openArchive()
    expect(archiveList()).not.toBe(null)

    // Разархивировали всё, пока оверлей открыт, — он остаётся на экране.
    await act(async () => { seed(0) })

    expect(archiveHost().querySelector('ul')).toBe(null)
    expect(screen.getByText('No archived chats')).toBeTruthy()
  })
})
