// src/components/Sidebar.archive.test.tsx
// Этап 4, Task 1: оверлей архива переехал на то же виртуальное ядро, что и
// список папки (`DeferredSortedVirtualList`).
//
// Пины здесь про проводку ИМЕННО архива, а не про само ядро (оно покрыто
// `virtual/*.test.tsx`) и не про список папки (`ChatList.test.tsx`):
// (1) в DOM живут только строки окна, а не весь архив;
// (2) `ul` несёт высоту под ВЕСЬ набор и лежит прямо в контейнере прокрутки;
// (3) `totalCount` — длина набора: дырок-скелетонов у архива не бывает, а
//     открытие оверлея не порождает ни одного запроса страницы у владельца
//     (пагинации у архива нет — он живёт в зеркале целиком);
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
import { ALL_FOLDER_ID } from '../core/folderIds'
import type { Managers } from '../client/bootstrap'
import type { Dialog } from '../core/models'

const HOST_HEIGHT = 720
const ITEM = 72
/** Архивных — заведомо больше окна; обычных — сколько угодно, лишь бы список жил. */
const ARCHIVED = 300
const NORMAL = 5
/** id архивных диалогов идут отдельным диапазоном — их видно в `href` строки. */
const ARCHIVE_ID_BASE = 1000

function fakeManagers() {
  // Владелец отдаёт РОВНО набор незаархивированных: у списка «Все чаты» не
  // остаётся дырок, и он просит страницу ровно один раз — на первом показе
  // папки. Всё, что сверх этого, — уже запрос архива, которого быть не должно.
  const getDialogs = vi.fn(async () => ({ dialogs: [], count: NORMAL, isEnd: true }))
  const managers = new Proxy({}, {
    get: (_target, ns: string) => new Proxy({}, {
      get: (_t, method: string) => {
        if (ns === 'realtime' && method === 'getStatus') return async () => ({ state: 'ready', retryAt: undefined, syncing: false })
        if (ns === 'dialogs' && method === 'getDialogs') return getDialogs
        return async () => undefined
      },
    }),
  }) as unknown as Managers
  return { managers, getDialogs }
}

const dialog = (chatId: number, archived: boolean): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived,
} as Dialog)

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

/** Контейнер прокрутки оверлея архива — он же `scrollableHost` списка. */
const archiveHost = () => document.querySelector<HTMLElement>('.' + s.archiveList) as HTMLElement
const archiveList = () => archiveHost().querySelector('ul') as HTMLElement
const archiveRows = () => Array.from(archiveList().querySelectorAll<HTMLElement>('a.chatlist-chat'))
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
  useAppStateStore.setState({ folders: [], drafts: [] })
  useNavigationStore.setState({ selectedId: null, openThread: null })
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
async function openArchive() {
  const { managers, getDialogs } = fakeManagers()
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

  it('в хвосте списка настоящие строки, а не скелетоны-дырок', async () => {
    await openArchive()

    // Дырки ядро кладёт В КОНЕЦ (`fullItems` длиной `totalCount`), поэтому
    // смотреть на них надо с самого низа: `totalCount` больше набора хоть на
    // единицу — и последнее окно доберёт скелетон. Низ: 300*72 + 8 - 720.
    await scrollArchiveTo(ARCHIVED * ITEM + 8 - HOST_HEIGHT)

    // Нижняя граница: idx >= ceil((20888 - 288) / 72) = 287; верхняя — за концом
    // набора, поэтому окно упирается в его длину: строки 288..300.
    expect(archiveRows()).toHaveLength(13)
    expect(archiveRows()[12].getAttribute('href')).toBe('#' + (ARCHIVE_ID_BASE + ARCHIVED))
    expect(archiveList().querySelectorAll('.loading-dialog-skeleton')).toHaveLength(0)
  })

  it('пагинации нет: открытие архива не шлёт владельцу ни одного запроса страницы', async () => {
    const { getDialogs } = await openArchive()

    // Единственный запрос — первый показ папки «Все чаты»; архив своего не шлёт
    // (мутация: посадить список на `useDialogListSource(ARCHIVE_FOLDER_ID, …)`
    // — у него свой курсор, и он попросит страницу архива у владельца).
    expect(getDialogs).toHaveBeenCalledTimes(1)
    expect(getDialogs).toHaveBeenCalledWith(expect.objectContaining({ filterId: ALL_FOLDER_ID }))
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
    // значит и `chats`, и `archivedChats` приезжают новыми. Мутация: убрать кэш
    // обёрток в `ArchiveList` (`itemCacheRef`/`prevItemsRef`) — у каждой строки
    // окна сменится ссылка `item`, и все 14 перерисуются.
    await act(async () => {
      useChatsStore.getState().applyDialogOps([{ op: 'patch', chatId: 1, fields: { unread: 1 } }])
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
    // Мутация: убрать кэш обёрток в `ArchiveList` — сравнение старого и нового
    // списка идёт ПО ССЫЛКЕ, новые обёртки в прежнем списке не найдутся,
    // компенсация не сработает и весь экран дёрнется.
    expect(archiveHost().scrollTop).toBe(HOST_HEIGHT + ITEM)
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
