// src/client/boot.fullList.test.tsx
// Сквозное ревью этапа 3: первичная загрузка диалогов ОБЯЗАНА быть полной.
//
// Дефект, который держит этот файл: этап 3 сделал первый запрос сеанса
// СТРАНИЦЕЙ (`getDialogs({limit: guessLoadCount()})`). `limit` режет
// ГЛОБАЛЬНЫЙ порядок, архивные строки в ответе бэкенда не выделены
// (`backend/internal/usecase/chat/dialogpage.go`, `chatsrepo.go`), а размера
// набора у архива и пользовательских папок нет ни у бэкенда, ни у воркера
// (`dialogsManager.ts::countFor` отдаёт им длину уже набранного). Значит
// усечённое зеркало делает эти списки неполными МОЛЧА: `totalCount ===
// items.length` ⇒ дырок нет ⇒ `requestItemForIdx` не зовётся ⇒ догрузки нет
// никогда. А если архивный чат не попал в первые ~20 строк — в сайдбаре нет
// самой строки «Архив», то есть входа в архив.
//
// Поэтому данные здесь сеются ТОЛЬКО через путь загрузки (владелец →
// `rt:dialog_op` → проектор → зеркало), как в `realtime/storeProjection.dialogs.
// test.ts`: тест, пишущий в стор напрямую, этот дефект не увидел бы в принципе.
// Фейковый `rest` ведёт себя как бэкенд — режет ГЛОБАЛЬНЫЙ порядок `limit`ом,
// архив не выделяет; проверяемая мутация — вернуть в `boot.ts::applyDialogsMirror`
// постраничный `getDialogs({limit: guessLoadCount()})`.
//
// happy-dom не считает layout: `offsetHeight`/`offsetWidth` (их читает
// `useElementSize` у контейнеров прокрутки) подставляются стабом на прототипе —
// тот же приём, что в `components/Sidebar.archive.test.tsx`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'

import { applyDialogsMirror, fillDialogsMirror } from './boot'
import { registerStoreProjection } from './realtime/storeProjection'
import Sidebar from '../components/Sidebar'
import s from '../components/Sidebar.module.scss'
import { ManagersProvider } from '../core/hooks/useManagers'
import { newDialogsManager } from '../core/managers/dialogsManager'
import { guessLoadCount } from '../core/dialogs/loadCount'
import { RT } from '../core/realtime/events'
import { ALL_FOLDER_ID } from '../core/folderIds'
import { useChatsStore } from '../stores/chatsStore'
import { useFoldersStore } from '../stores/foldersStore'
import { useNotifyStore } from '../stores/notifyStore'
import { useNavigationStore } from '../stores/navigationStore'
import { useAppStateStore } from '../stores/appState'
import { useSettingsStore } from '../settings'
import type { Managers } from './bootstrap'
import type { RawDialog } from '../core/models'
import type { Folder } from '../core/managers/foldersManager'

const HOST_HEIGHT = 720

/** Размер первой страницы — ровно тот, которым грузил дефектный boot. */
const PAGE = guessLoadCount()
/**
 * Набор — ЧЕТЫРЕ страницы. Двух мало: при усечённом зеркале список папки успевает
 * выпустить ОДНУ сетевую страницу собственной догрузки (`useDialogListSource` →
 * `getDialogs({filterId})` → `dialogsManager.fetchPage`), и на наборе из двух
 * страниц она случайно дотянула бы до хвоста, скрыв дефект. Дальше первой
 * страницы цикл фетчера не идёт: страница ПАПКИ пришла пустой, курсор не
 * сдвинулся — `count: 0` обрывает цикл, и папка не наполняется уже никогда.
 */
const TOTAL = PAGE * 4
/** Единственный архивный чат — в самом ХВОСТЕ глобального порядка. */
const ARCHIVED_ID = TOTAL
/** Единственный чат пользовательской папки — тоже за первой страницей. */
const FOLDER_CHAT_ID = TOTAL - 1

/** Папка «включи ровно этот чат» (tweb include_peers): правило не зависит ни от
 *  типов, ни от контактов — предмет теста здесь состав зеркала, а не фильтр. */
const FOLDER: Folder = {
  id: 7, title: 'Работа', pos: 0,
  contacts: false, nonContacts: false, groups: false, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [FOLDER_CHAT_ID], excludeChats: [],
}

/** Порядок в ответе — по времени последнего сообщения (его же считает
 *  `dialogIndex`), поэтому позиция в массиве и есть позиция в глобальном
 *  порядке: chat_id 1 — самый свежий, TOTAL — самый старый. */
const rawDialog = (chatId: number, archived: boolean): RawDialog => ({
  chat_id: chatId, type: 'private', last_read_seq: 0, unread: 0, title: 't' + chatId, archived,
  last_message: { seq: 1, text: 'x', sender_id: 1, at: new Date(Date.UTC(2026, 7, 1) - chatId * 60_000).toISOString() },
})

const SERVER: RawDialog[] = Array.from({ length: TOTAL }, (_, i) => rawDialog(i + 1, i + 1 === ARCHIVED_ID))

/**
 * Фейк `/chats` в поведении бэкенда: без параметров — весь список с `is_end`;
 * с `limit`/`offset_chat_id` — окно ГЛОБАЛЬНОГО порядка (архив не выделен,
 * своего набора у папок нет), как `dialogpage.go` + `chatsrepo.go`.
 */
function fakeRest() {
  const requests: (Record<string, string | number> | undefined)[] = []
  const get = async (_path: string, params?: Record<string, string | number>) => {
    requests.push(params)
    if (!params) return { chats: SERVER, count: SERVER.length, is_end: true }
    const limit = Number(params.limit)
    const offsetChatId = Number(params.offset_chat_id ?? 0)
    const start = offsetChatId ? SERVER.findIndex((r) => r.chat_id === offsetChatId) + 1 : 0
    const chats = SERVER.slice(start, start + limit)
    return { chats, count: SERVER.length, is_end: start + chats.length >= SERVER.length }
  }
  return { requests, rest: { get } as unknown as Parameters<typeof newDialogsManager>[0]['rest'] }
}

/**
 * Холодный старт РЕАЛЬНЫМ путём: настоящий владелец + настоящий проектор,
 * склеенные тем же каналом `rt:dialog_op`, что и в проде (workerCore.ts:
 * onDialogOps → broadcast → realtimeBridge → storeProjection), и настоящие
 * `fillDialogsMirror`/`applyDialogsMirror` из `boot.ts`.
 */
async function coldStart() {
  const { rest, requests } = fakeRest()
  const dialogs = newDialogsManager({
    rest,
    onDialogOps: (ops) => rootScope.dispatchEventSingle(RT.dialogOp, { ops }),
    loadCache: async () => [], // первый вход: офлайн-кэша прошлой сессии нет
    loadState: async () => ({ pinnedOrders: {}, drafts: [], folders: [FOLDER] }),
  })
  const managers = { dialogs } as unknown as Managers
  const op = await fillDialogsMirror(managers, false)
  await applyDialogsMirror(op, managers, false)
  return { dialogs, requests }
}

/** Менеджеры сайдбара: `dialogs` — ТОТ ЖЕ владелец, что грузил холодный старт
 *  (список папки просит страницы у него), остальное — no-op (приём
 *  `Sidebar.connectionStatus.test.tsx`). */
function sidebarManagers(dialogs: unknown): Managers {
  const stub = (ns: string) => new Proxy({}, {
    get: (_t, method: string | symbol) => (
      ns === 'realtime' && method === 'getStatus'
        ? async () => ({ state: 'ready', retryAt: undefined, syncing: false })
        : async () => undefined
    ),
  })
  return new Proxy({}, {
    get: (_target, ns: string | symbol) => (ns === 'dialogs' ? dialogs : stub(String(ns))),
  }) as unknown as Managers
}

async function renderSidebar(dialogs: unknown) {
  render(
    <ManagersProvider managers={sidebarManagers(dialogs)}>
      <Sidebar onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  await act(async () => {})
}

/** Доводка: троттлинг измерения скролла (24 мс) + фолбэк-таймер слайда (200+100). */
async function settle(ms: number) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

/** Закреплённый ряд «Архив» — единственный `div` среди строк списка чатов. */
const archiveRow = () => document.querySelector<HTMLElement>('ul.chatlist > div.chatlist-chat')
const archiveOverlayRows = () => [...document.querySelectorAll<HTMLElement>(`.${s.archiveList} ul a.chatlist-chat`)]
const activeScroller = () => document.querySelector<HTMLElement>('.folders-scrollable.active')!
const hrefs = (rows: HTMLElement[]) => rows.map((r) => r.getAttribute('href'))

let sizeStubbed = false

beforeAll(() => registerStoreProjection({} as unknown as Managers))

beforeEach(() => {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false })
  useSettingsStore.setState({ passcodeEnabled: false })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useAppStateStore.setState({ folders: [FOLDER], drafts: [] })
  useNavigationStore.setState({ selectedId: null })
  useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: false, preview: true }, channels: { muted: false, preview: true } } })

  if (!sizeStubbed) {
    sizeStubbed = true
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

afterEach(() => { cleanup() })

describe('boot: холодный старт грузит СПИСОК ЦЕЛИКОМ (архив и папки живут из того же зеркала)', () => {
  // Страховка от вырождения фикстуры: если архивный чат или чат папки уедут в
  // первую страницу, все тесты ниже станут зелёными при любом поведении boot.
  it('фикстура: архивный чат и чат папки лежат ЗА первой страницей глобального порядка', () => {
    expect(SERVER.slice(0, PAGE).some((r) => r.archived)).toBe(false)
    expect(SERVER.findIndex((r) => r.chat_id === ARCHIVED_ID)).toBeGreaterThanOrEqual(PAGE)
    expect(SERVER.findIndex((r) => r.chat_id === FOLDER_CHAT_ID)).toBeGreaterThanOrEqual(PAGE)
  })

  it('зеркало получает ВЕСЬ список, а не первую страницу', async () => {
    const { requests } = await coldStart()

    // Единственный запрос сеанса — без `limit` и без курсора.
    expect(requests).toEqual([undefined])
    expect(useChatsStore.getState().dialogs).toHaveLength(TOTAL)
  })

  it('архив: диалог за пределами первой страницы попадает в архивный список', async () => {
    const { dialogs } = await coldStart()
    await renderSidebar(dialogs)

    await act(async () => { fireEvent.click(archiveRow()!) })

    expect(hrefs(archiveOverlayRows())).toEqual(['#' + ARCHIVED_ID])
  })

  it('строка «Архив» есть, хотя архивных чатов нет среди первых guessLoadCount() диалогов', async () => {
    const { dialogs } = await coldStart()
    await renderSidebar(dialogs)

    // При усечённом зеркале архивных чатов нет вовсе, гейт `archived.length > 0`
    // (ChatList.tsx) не пускает закреплённый ряд — входа в архив нет в принципе.
    expect(archiveRow()).not.toBe(null)
  })

  it('пользовательская папка: чат за пределами первой страницы попадает в свою папку', async () => {
    const { dialogs } = await coldStart()
    await renderSidebar(dialogs)

    await act(async () => { fireEvent.click(screen.getByText(FOLDER.title)) })
    await settle(350) // слайд доигран, активна вкладка папки

    expect(hrefs([...activeScroller().querySelectorAll<HTMLElement>('a.chatlist-chat')]))
      .toEqual(['#' + FOLDER_CHAT_ID])
  })
})
