// src/client/boot.firstPage.test.tsx
// Первичная загрузка диалогов — ОДНА СТРАНИЦА, а список догружается сам
// (спека docs/superpowers/specs/2026-08-13-dialogs-count-and-refresh-design.md).
//
// Прежде этот файл (`boot.fullList.test.tsx`) пинил обратное — полную первичную
// загрузку. Она была вынужденной: размер набора архива и пользовательских папок
// равнялся длине уже набранного, поэтому `totalCount === items.length` ⇒ дырок в
// `fullItems` нет ⇒ `requestItemForIdx` не зовётся ⇒ догрузки для них не
// случалось НИКОГДА, и усечённое зеркало молча оставляло эти списки неполными.
// Спека сняла обе причины: `/chats` принимает `folder_id` реальной папки, а
// `dialogsManager.ts::countFor` отдаёт размер СВОЕЙ выборки (архиву — свой,
// пользовательской папке — завышенную глобальную оценку, порт dialogs.ts:1728).
// Завышенная оценка и есть механизм: она рождает дырку, дырка дёргает
// `requestItemForIdx`, тот тянет страницы.
//
// Сценарии сохранены, ожидания инвертированы: первичный `refresh()` уходит с
// `limit` (`dialogsManager.ts::doRefresh`), зеркало получает первую страницу, а
// архив и папка всё равно наполняются — уже догрузкой сайдбара.
//
// Поэтому данные здесь сеются ТОЛЬКО через путь загрузки (владелец →
// `rt:dialog_op` → проектор → зеркало), как в `realtime/storeProjection.dialogs.
// test.ts`: тест, пишущий в стор напрямую, догрузки не увидел бы в принципе.
// Фейковый `rest` ведёт себя как бэкенд: режет запрошенную выборку `limit`ом и
// курсором, выборку выбирает по `folder_id` (`dialogpage.go`, `chatsrepo.go`).
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
import { DIALOG_LOAD_COUNT } from '../core/dialogs/loadCount'
import { RT } from '../core/realtime/events'
import { ALL_FOLDER_ID } from '../core/folderIds'
import { useChatsStore } from '../stores/chatsStore'
import { useFoldersStore } from '../stores/foldersStore'
import { useNotifyStore } from '../stores/notifyStore'
import { useNavigationStore } from '../stores/navigationStore'
import { useAppStateStore } from '../stores/appState'
import { useSettingsStore } from '../settings'
import type { Managers } from './bootstrap'
import { mapMyMessage, type MyMessage, type RawDialog, type RawMyMessage } from '../core/models'
import { makeRawMessage } from '../core/messages/testMessage'
import type { Folder } from '../core/managers/foldersManager'
import { makeDialog } from '../core/dialogs/testDialog'

const HOST_HEIGHT = 720

/** Окно первичного `refresh()` на пустом кэше — `Math.max(0, DIALOG_LOAD_COUNT)`. */
const FIRST_PAGE = DIALOG_LOAD_COUNT
/**
 * Набор — ЧЕТЫРЕ первых страницы. Двух мало: одна страница догрузки
 * (`useDialogListSource` → `getDialogs({filterId})` → `dialogsManager.fetchPage`)
 * на таком наборе случайно дотянулась бы до хвоста, и тест не отличил бы
 * работающий цикл догрузки от единственного везучего запроса.
 */
const TOTAL = FIRST_PAGE * 4
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
 *  порядке: peer_id 1 — самый свежий, TOTAL — самый старый. */
const rawMessage = (peerId: number): RawMyMessage => makeRawMessage({
  id: 1, peerId, fromId: 1, text: 'x',
  createdAt: new Date(Date.UTC(2026, 7, 1) - peerId * 60_000).toISOString(),
})

/** Строка на проводе — конструктор `dialog` минус два клиентских параметра. */
const rawDialog = (peerId: number, archived: boolean): RawDialog => {
  const { peerId: _peerId, lastMessage: _lastMessage, ...wire } = makeDialog({ peerId, archived, topMessage: 1 })
  return wire
}

const SERVER: RawDialog[] = Array.from({ length: TOTAL }, (_, i) => rawDialog(i + 1, i + 1 === ARCHIVED_ID))
const peerIdOf = (d: RawDialog): number => (d.peer._ === 'peerUser' ? d.peer.user_id : -1)
const isArchivedRaw = (d: RawDialog): boolean => d.folder_id === 1

/**
 * Фейк `/chats` в поведении бэкенда (`dialogpage.go` + `chatsrepo.go`): выборку
 * задаёт `folder_id` (`0` — всё, кроме архива; `1` — только архив; параметра нет
 * — весь набор), а `limit`/`offset_peer_id` режут ЕЁ ЖЕ, поэтому `count` и
 * `is_end` тоже относятся к запрошенной выборке.
 */
function fakeRest() {
  const requests: (Record<string, string | number> | undefined)[] = []
  const get = async (_path: string, params?: Record<string, string | number>) => {
    requests.push(params)
    const wire = params?.folder_id
    const set = wire === undefined ? SERVER : SERVER.filter((r) => isArchivedRaw(r) === (wire === 1))
    const limit = Number(params?.limit ?? set.length)
    const offsetPeerId = Number(params?.offset_peer_id ?? 0)
    const start = offsetPeerId ? set.findIndex((r) => peerIdOf(r) === offsetPeerId) + 1 : 0
    const dialogs = set.slice(start, start + limit)
    // Контейнер схемы: «это всё» выражает ОТСУТСТВИЕ count (`messages.dialogs`),
    // кусок — его наличие (`messages.dialogsSlice`). Булева `is_end` на проводе
    // больше нет.
    const whole = start === 0 && start + dialogs.length >= set.length
    return {
      _: whole ? 'messages.dialogs' : 'messages.dialogsSlice',
      ...(whole ? {} : { count: set.length }),
      dialogs,
      messages: dialogs.map((d) => rawMessage(peerIdOf(d))),
      chats: [], users: [],
    }
  }
  return { requests, rest: { get } as unknown as Parameters<typeof newDialogsManager>[0]['rest'] }
}

/** SSOT сообщений воркера в объёме, нужном разрешению `top_message`. */
function fakeMessagesOwner() {
  const byPeer = new Map<number, Map<number, MyMessage>>()
  return {
    async saveApiMessages(list?: RawMyMessage[]): Promise<MyMessage[]> {
      const out = (list ?? []).map((r) => mapMyMessage(r))
      for (const m of out) {
        let c = byPeer.get(m.peerId)
        if (!c) { c = new Map(); byPeer.set(m.peerId, c) }
        c.set(m.id, m)
      }
      return out
    },
    getMessageByPeer: (peerId: number, id: number) => (id ? byPeer.get(peerId)?.get(id) : undefined),
  }
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
    // Владелец сообщений: вектор `messages` контейнера втекает сюда, отсюда же
    // разрешается `top_message` (решение Р11). Без него у строки списка не
    // будет ни превью, ни ДАТЫ — а по дате считается и порядок, и курсор.
    messages: fakeMessagesOwner(),
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

describe('boot: холодный старт грузит ПЕРВУЮ СТРАНИЦУ (архив и папки догружаются сами)', () => {
  // Страховка от вырождения фикстуры: если архивный чат или чат папки уедут в
  // первую страницу, все тесты ниже станут зелёными при любом поведении boot.
  it('фикстура: архивный чат и чат папки лежат ЗА первой страницей глобального порядка', () => {
    expect(SERVER.slice(0, FIRST_PAGE).some(isArchivedRaw)).toBe(false)
    expect(SERVER.findIndex((r) => peerIdOf(r) === ARCHIVED_ID)).toBeGreaterThanOrEqual(FIRST_PAGE)
    expect(SERVER.findIndex((r) => peerIdOf(r) === FOLDER_CHAT_ID)).toBeGreaterThanOrEqual(FIRST_PAGE)
  })

  it('зеркало получает первую страницу, а не весь список', async () => {
    const { requests } = await coldStart()

    // Единственный запрос сеанса — окно удерживаемого (кэш пуст → страница),
    // по ГЛОБАЛЬНОЙ выборке и без курсора: `refresh()` обслуживает весь кэш.
    expect(requests).toEqual([{ limit: FIRST_PAGE }])
    expect(useChatsStore.getState().dialogs).toHaveLength(FIRST_PAGE)
  })

  it('архив: диалог за пределами первой страницы попадает в архивный список', async () => {
    const { dialogs } = await coldStart()
    await renderSidebar(dialogs)
    await settle(350) // догрузка «Всех чатов» и архива доиграна

    await act(async () => { fireEvent.click(archiveRow()!) })

    expect(hrefs(archiveOverlayRows())).toEqual(['#' + ARCHIVED_ID])
  })

  it('строка «Архив» есть, хотя архивных чатов нет среди первых DIALOG_LOAD_COUNT диалогов', async () => {
    const { dialogs } = await coldStart()
    await renderSidebar(dialogs)
    await settle(350)

    // Гейт закреплённого ряда — `archived.length > 0` (ChatList.tsx), то есть
    // архив в зеркале. Первая страница его не приносит; приносит догрузка.
    expect(archiveRow()).not.toBe(null)
  })

  /**
   * ЧТО ЭТОТ СЦЕНАРИЙ НЕ ПОКРЫВАЕТ. Прежде он ждал, что чат папки, лежащий
   * четырьмя страницами ниже, окажется в её списке, — при полной первичной
   * загрузке это выполнялось само собой. В страничной модели наполнение папки
   * доводит ВНЕШНИЙ ДРАЙВЕР (скролл: новые видимые индексы → новые
   * `requestItemForIdx`), а в юнит-тесте его нет: цикл фетчера штатно
   * обрывается на первой же пустой странице ПАПКИ (`count: 0` →
   * `sequentialCursorFetcher.ts:68`, вендор 1:1 — так же обрывается и в
   * оригинале), потому что очередная страница ГЛОБАЛЬНОЙ выборки не принесла
   * ни одного подходящего папке диалога. Проверяемо здесь ровно то, что ниже:
   * страница уходит в сеть за СВОЕЙ (глобальной) выборкой, курсор продвигается
   * и не залипает, зеркало растёт, а цикл встаёт, а не крутится вечно.
   * Наполнение папки прокруткой до конца проверяется на стенде (спека,
   * «Не проверяются автоматически»).
   */
  it('пользовательская папка: её страницы вычерпывают ГЛОБАЛЬНУЮ выборку с продвигающимся курсором', async () => {
    const { dialogs, requests } = await coldStart()
    await renderSidebar(dialogs)

    await act(async () => { fireEvent.click(screen.getByText(FOLDER.title)) })
    await settle(350) // слайд доигран, активна вкладка папки

    // Страницы папки — те, что ушли с курсором и БЕЗ `folder_id` (порт
    // `realFolderId`: у пользовательской папки серверного набора нет, её
    // страницы вычерпывают глобальный). Первичный `refresh()` уходит без
    // курсора, страница строки «Архив» — со своим `folder_id`.
    const folderPages = requests.filter((q) => q?.folder_id === undefined && q?.offset_peer_id !== undefined)
    const cursors = folderPages.map((q) => Number(q!.offset_peer_id))

    expect(cursors.length).toBeGreaterThan(0)
    // Продолжили ровно за окном первичного `refresh()`, а не с начала набора.
    expect(cursors[0]).toBe(FIRST_PAGE)
    // Курсор продвигается и ни разу не повторяется — иначе страница вечно
    // приносила бы уже известное (мутация: вернуть курсор выборки к хвосту
    // кэша — страница архива кладёт туда самый старый архивный диалог, и
    // глобальный курсор прыгает в конец набора).
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b))
    expect(new Set(cursors).size).toBe(cursors.length)
    // Зеркало выросло за пределы первой страницы — выборка реально черпается.
    expect(useChatsStore.getState().dialogs.length).toBeGreaterThan(FIRST_PAGE + 1)

    // И цикл догрузки встал, а не крутится вечно.
    const settled = requests.length
    await settle(350)
    expect(requests).toHaveLength(settled)
  })
})
