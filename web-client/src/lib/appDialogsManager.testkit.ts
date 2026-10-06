// Общая обвязка тестов владельца папок (`lib/appDialogsManager.ts`, задача 5
// плана `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`).
//
// Зависимости в тестах НАСТОЯЩИЕ: проекция `stores/folders.solid.ts` поверх
// своих зеркал, Solid-ряд `foldersTabs.solid.tsx`, живые `horizontalMenu` и
// `TransitionSlider`, `Scrollable` на каждую папку. Подменено только то, чего
// happy-dom не умеет, — ГЕОМЕТРИЯ (ширина кадра, reflow, зажим `scrollTop` по
// содержимому), кадры анимации (очередь `requestAnimationFrame` под ручным
// управлением, как в `components/appSearchSuper.scroll.test.ts`) и
// `ResizeObserver`, которого в happy-dom нет.
//
// Список папки — настоящий `AutonomousDialogList` (задача 1-4 волны 7), но его
// `clear`/`onChatsScroll` подменены дублёром (`installListProbes`): владельца
// проверяют по оркестровке папок, а не по загрузке страниц (её пины —
// `components/autonomousDialogList/dialogs.test.ts`). Дублёр `clear` пустит `ul`,
// как `deferredSortedVirtualList.tsx:157-168` у tweb, `onChatsScroll` — рисует
// первую страницу. Подмена ставится на ПРОТОТИП до `mountOwner`: первую страницу
// «Всех чатов» владелец просит ещё внутри `start()` (`:1064-1065`).
import { expect, vi } from 'vitest'
import { useAppStateStore } from '@stores/appState'
import { applyFolderUpdate, useFoldersStore } from '@stores/foldersStore'
import { useChatsStore } from '@stores/chatsStore'
import { useNotifyStore } from '@stores/notifyStore'
import useFolders from '@stores/folders.solid'
import { initialState } from '@core/state/state'
import { ALL_FOLDER_ID } from '@core/folderIds'
import { fastRaf } from '@helpers/schedulers'
import type { RawFolder } from '@core/managers/foldersManager'
import type { TopicRow } from '@core/managers/groupsManager'
import appDialogsManager, { type AppDialogsManager } from './appDialogsManager'
import type { AppSidebarLeft } from '@components/sidebarLeft'
import { installSidebarLeft } from '@/test/sidebarLeft'
import type { Managers } from '@/client/bootstrap'
import { AutonomousDialogList } from '@components/autonomousDialogList/dialogs'

/** ширина кадра папки — её читает `slideTabs` (`transition.ts:102-116`) */
export const WIDTH = 400
/** высота строки чатлиста (`dialogs.ts:221`, `itemSize: 72`) и окна скроллера */
const ROW = 72
const VIEWPORT = 600
/** строк в первой странице дублёра — больше окна, чтобы было куда скроллить */
export const PAGE = 20

const SETTINGS = {
  private: { muted: false, preview: true },
  groups: { muted: false, preview: true },
  channels: { muted: false, preview: true },
}

export const raw = (id: number, pos: number, title: string): RawFolder => ({
  id, title, pos,
  contacts: false, non_contacts: false, groups: false, broadcasts: false, bots: false,
  exclude_muted: false, exclude_read: false, include_peers: [], exclude_peers: [],
})

/** Папки кладутся тем же путём, что пуш сервера: `applyFolderUpdate` → `appState.folders`. */
export function putFolders(...folders: RawFolder[]) {
  folders.forEach((folder) => applyFolderUpdate({ folder }))
}

/**
 * Сторы папок и их зеркала — в исходное. Зеркало пиров (`resetPeerMirror`)
 * тест-файлы сбрасывают сами: его сброс разрешён только тестам и проектору
 * (`core/noDuplicatePeers.test.ts`), а обвязка тестом не является.
 */
export function resetStores() {
  useFolders().dispose()
  useAppStateStore.setState(initialState(), true)
  useChatsStore.setState({ dialogs: [], dialogIndexById: {} })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useNotifyStore.setState({ settings: SETTINGS })
}

// ── ResizeObserver ─────────────────────────────────────────────────────────
export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed: Element[] = []
  disconnected = false
  constructor(public callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
  observe(el: Element) { this.observed.push(el) }
  unobserve() {}
  disconnect() { this.disconnected = true }
  /** браузер сообщает новую высоту наблюдаемого узла */
  fire(height: number) {
    const entry = {
      target: this.observed[0],
      contentRect: { height } as DOMRectReadOnly,
      borderBoxSize: [{ blockSize: height, inlineSize: 0 }],
    } as unknown as ResizeObserverEntry
    this.callback([entry], this as unknown as ResizeObserver)
  }
}

// ── Кадры анимации ─────────────────────────────────────────────────────────
let frames: FrameRequestCallback[] = []
let realRaf: typeof requestAnimationFrame | undefined

/**
 * Кадры — под ручное управление. Возвращает, прокрутилась ли затравка модульной
 * очереди `fastRaf` (причина та же, что в `appSearchSuper.scroll.test.ts`:
 * непрокрученная чужим файлом очередь проглотила бы все наши `fastRaf`);
 * тест-файл обязан это проверить.
 */
export function installFrames() {
  frames = []
  realRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => frames.push(cb)) as typeof requestAnimationFrame
  let primed = false
  fastRaf(() => { primed = true })
  flushFrames()
  return primed
}

export function uninstallFrames() {
  flushFrames()
  if(realRaf) globalThis.requestAnimationFrame = realRaf
}

export function flushFrames() {
  while(frames.length) {
    const current = frames
    frames = []
    current.forEach((cb) => cb(0))
  }
}

/**
 * Дать доиграть асинхронщине переключения: `selectFolderByIndex` ждёт
 * `closeEverythingInsideNaturally` (`appDialogsManager.ts:756`), полоса — его
 * (`horizontalMenu.ts`, `await result1`), `onFiltersLengthChange` — `pause(0)`.
 */
export async function settle() {
  for(let i = 0; i < 3; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushFrames()
  }
}

// ── Геометрия кадров ───────────────────────────────────────────────────────
/** что лежало в инлайновом `transform` кадра в момент reflow (`transition.ts:109`) */
export const transformAtReflow = new WeakMap<HTMLElement, string>()

/** Ширина и reflow каждого кадра папки — happy-dom их не считает. */
export function stubGeometry(folders: HTMLElement) {
  Array.from(folders.children).forEach((el) => {
    const frame = el as HTMLElement
    frame.getBoundingClientRect = () => ({ width: WIDTH }) as DOMRect
    Object.defineProperty(frame, 'offsetWidth', {
      configurable: true,
      get: () => {
        transformAtReflow.set(frame, frame.style.transform)
        return WIDTH
      },
    })
  })
}

// ── Дублёр загрузки списка папки ───────────────────────────────────────────
export type ListProbe = {
  ul: HTMLElement
  calls: { clear: number; onChatsScroll: number }
}

const probes = new Map<AutonomousDialogList, ListProbe>()

/** `data-filter-id` скроллера — у списка своего поля под папку снаружи нет (у tweb оно `protected`). */
export const filterIdOf = (xd: AutonomousDialogList) => +xd.scrollable.container.dataset.filterId!

/**
 * Пробы на всех списках, которые построит владелец. `scrollTop` скроллера зажат
 * содержимым, как у браузера после layout: пустой `ul` — прокручивать нечего.
 */
export function installListProbes() {
  probes.clear()
  const probeOf = (xd: AutonomousDialogList) => {
    let probe = probes.get(xd)
    if(probe) return probe

    const ul = xd.sortedList.list
    const container = xd.scrollable.container
    let top = 0
    const max = () => Math.max(0, ul.children.length * ROW - VIEWPORT)
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.min(Math.max(0, value), max()) },
    })
    // браузерный layout после смены содержимого: позиция зажимается им
    const layout = () => { top = Math.min(top, max()) }

    probe = { ul, calls: { clear: 0, onChatsScroll: 0 } }
    ;(probe as ListProbe & { layout: () => void }).layout = layout
    probes.set(xd, probe)
    return probe
  }

  vi.spyOn(AutonomousDialogList.prototype, 'clear').mockImplementation(function(this: AutonomousDialogList) {
    const probe = probeOf(this)
    ++probe.calls.clear
    probe.ul.replaceChildren()
    ;(probe as ListProbe & { layout: () => void }).layout()
  })
  vi.spyOn(AutonomousDialogList.prototype, 'onChatsScroll').mockImplementation(function(this: AutonomousDialogList) {
    const probe = probeOf(this)
    ++probe.calls.onChatsScroll
    probe.ul.replaceChildren(...Array.from({ length: PAGE }, (_, i) => {
      const li = document.createElement('li')
      li.textContent = `#${i + 1}`
      return li
    }))
    ;(probe as ListProbe & { layout: () => void }).layout()
  })

  return (xd: AutonomousDialogList) => probeOf(xd)
}

// ── Владелец ───────────────────────────────────────────────────────────────
/** Дублёры менеджеров, которые зовут владелец, его списки и меню. */
function fakeManagers(getDialogs?: (...args: never[]) => unknown) {
  return {
    folders: { del: vi.fn(async (_id: number) => {}) },
    peers: { fillMirror: vi.fn(async (_ids: number[]) => {}) },
    presence: { get: async () => [] },
    // контакты под коротким списком и подпись пустого плейсхолдера (задача 1-8 волны 7)
    contacts: {
      getContactsPeerIds: vi.fn(async (..._args: unknown[]): Promise<number[]> => []),
      isContact: vi.fn(async (_peerId: number) => false),
    },
    dialogs: {
      hasDialog: vi.fn(async (_peerId: number) => false),
      getDialogs: getDialogs ?? vi.fn(async () => ({ dialogs: [], count: 0, isEnd: true })),
      // меню диалога (задача 1-2 волны 7) — дублёры ручек его пунктов
      applyRemoved: vi.fn(async (_peerId: number) => {}),
      refresh: vi.fn(async () => null),
    },
    groups: {
      setPin: vi.fn(async (_peerId: number, _pinned: boolean) => {}),
      setMute: vi.fn(async (_peerId: number, _muted: boolean, _until?: number) => {}),
      setArchive: vi.fn(async (_peerId: number, _archived: boolean) => {}),
      deleteGroup: vi.fn(async (_peerId: number) => {}),
      removeMember: vi.fn(async (_peerId: number, _userId: number) => {}),
      // темы форум-таба (задача 1-6 волны 7)
      listTopics: vi.fn(async (_peerId: number): Promise<TopicRow[]> => []),
      // «N онлайн» подписи форум-таба (`appImManager.getOnlines`, пачка П-4)
      getParticipants: vi.fn(async (_options: { id: number }) => ({ _: 'channels.channelParticipants' as const, count: 0, participants: [], chats: [], users: [] })),
      getOnlines: vi.fn(async (_chatId: number) => 1),
    },
    chats: { clearHistory: vi.fn(async (_peerId: number) => {}) },
    realtime: {
      markRead: vi.fn(async (_args: { peerId: number, upToId: number }) => ({ ok: true })),
      // автомат соединения (`start()`, `:990`) — его стартовый pull
      getStatus: async () => ({ state: 'ready', retryAt: undefined, syncing: false }),
    },
  }
}

export type Mounted = {
  manager: AppDialogsManager
  host: HTMLDivElement
  chatsContainer: HTMLDivElement
  hooks: { managers: ReturnType<typeof fakeManagers>; closeCalls: number }
  folders: HTMLElement
  /** класс колонки (`appSidebarLeft`), который конструирует `start()` (`:983`) */
  sidebar: AppSidebarLeft
}

/**
 * Колонка: разметка tweb `index.html:89-107` с `#chatlist-container` и класс
 * колонки на ней (`startDialogs()` его конструирует); `.connection-status-bottom`
 * (`bottomPart`) заводит сам владелец. Переход
 * «закрыть всё внутри колонки» (`closeEverythingInsideNaturally`, `:1027`) —
 * дублёр класса: тестам владельца важен его ответ, а не закрытие вкладок.
 */
export function mountOwner(options: {
  close?: () => boolean | Promise<boolean>
  /** страницы владельца диалогов — у тестов списка свои (`autonomousDialogList/dialogs.test.ts`) */
  getDialogs?: (...args: never[]) => unknown
} = {}): Mounted {
  const column = installSidebarLeft({} as Managers, undefined, { full: true })
  const { sidebar } = column
  const chatsContainer = column.chatlistContainer as HTMLDivElement

  const hooks = {
    closeCalls: 0,
    managers: fakeManagers(options.getDialogs),
  }
  vi.spyOn(sidebar, 'closeEverythingInsideNaturally').mockImplementation(async () => {
    ++hooks.closeCalls
    return options.close ? options.close() : true
  })

  const manager = appDialogsManager
  manager.startDialogs(hooks.managers as unknown as Managers)
  const host = chatsContainer.querySelector<HTMLDivElement>(':scope > .connection-status-bottom')!
  const folders = host.querySelector<HTMLElement>('#folders-container')!
  stubGeometry(folders)
  return { manager, host, chatsContainer, hooks, folders, sidebar }
}

export const frameEls = (folders: HTMLElement) => Array.from(folders.children) as HTMLElement[]
export const filterIds = (folders: HTMLElement) => frameEls(folders).map((el) => el.dataset.filterId)
export const tabEls = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('#folders-tabs > .menu-horizontal-div-item'))
export const frameOf = (folders: HTMLElement, filterId: number) =>
  folders.querySelector<HTMLElement>(`:scope > .folders-scrollable[data-filter-id="${filterId}"]`)!

/**
 * Настоящий конец CSS-перехода: оба кадра двигаются по `transition: transform`
 * (`_slider.scss:214-216`), поэтому `transitionend` приходит обоим — уходящему
 * (снимает с него `active from` и сдвиг) и приходящему (по нему слайдер зовёт
 * `onTransitionEnd` полосы, `transition.ts` ветка `e.target !== from`).
 */
export function finishTransition(folders: HTMLElement) {
  flushFrames()
  const outgoing = frameEls(folders).filter((el) => el.classList.contains('from'))
  const incoming = frameEls(folders).filter((el) => el.classList.contains('to'))
  outgoing.forEach((el) => el.dispatchEvent(new Event('transitionend', { bubbles: true })))
  incoming.forEach((el) => el.dispatchEvent(new Event('transitionend', { bubbles: true })))
}

export function expectActiveOnly(folders: HTMLElement, filterId: number) {
  expect(frameEls(folders).filter((el) => el.classList.contains('active')).map((el) => el.dataset.filterId))
    .toEqual(['' + filterId])
}
