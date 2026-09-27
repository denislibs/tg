/** @jsxImportSource solid-js */
/**
 * Пины порта `foldersTabs.solid.tsx` (tweb `src/components/foldersTabs.tsx`),
 * задача 4 плана `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`.
 *
 * Эталон разметки — ЖИВОЙ ДАМП Telegram `docs/tweb/dom/dumps/14-left-01-chatlist.json:46-71`
 * (градиент + карточка с четырьмя вкладками, у последней пустой бейдж). Дамп
 * читается из файла и сравнивается по тем же правилам, что `tools/tweb-parity/dom-parity.mjs`
 * (тег, классы, вложенность); нумерация — по РАЗВЁРНУТОМУ тексту
 * (`json.load(...).split('\n')`), первая строка — первая.
 *
 * Пропы в тестах — те, что даёт владелец оригинала (`appDialogsManager.ts:654-686`):
 * их и получит наш владелец в задаче 5.
 *
 * Источник данных — настоящая проекция `stores/folders.solid.ts`, наполненная
 * через её зеркала (папки в `appState`, диалоги в `chatsStore`, мьют в
 * `notifyStore`), а не подложенный массив: ряд обязан жить на тех же ссылках
 * элементов, что сохраняет `reconcile` проекции.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'solid-js/web'
import '@/test/lang'
import FoldersTabs from './foldersTabs.solid'
import useFolders from '@stores/folders.solid'
import { useAppStateStore } from '@stores/appState'
import { applyFolderUpdate, useFoldersStore } from '@stores/foldersStore'
import { useChatsStore } from '@stores/chatsStore'
import { useNotifyStore } from '@stores/notifyStore'
import { initialState } from '@core/state/state'
import { ALL_FOLDER_ID } from '@core/folderIds'
import { makeDialog } from '@core/dialogs/testDialog'
import { resetPeerMirror } from '@core/peerCache'
import type { RawFolder } from '@core/managers/foldersManager'
import type { Dialog } from '@core/models'
import type { ScrollableContextValue } from './scrollable2.solid'

/** Строки дампа `from..to` включительно (1-based), приведённые к `тег.классы` с отступом. */
function dumpLines(file: string, from: number, to: number) {
  const text = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/tweb/dom/dumps', file), 'utf8')) as string
  const lines = text.split('\n').slice(from - 1, to)
  const base = lines[0].search(/\S/)
  return lines.map((line) => {
    const indent = (line.search(/\S/) - base) / 2
    const descriptor = line.trim().split(/[\s[]/)[0]
    return '  '.repeat(indent) + descriptor
  })
}

/** То же представление для живого поддерева — формат `snapshot-dom.js` без атрибутов и текста. */
function snapshot(root: Element) {
  const out: string[] = []
  const visit = (el: Element, level: number) => {
    out.push('  '.repeat(level) + [el.tagName.toLowerCase(), ...Array.from(el.classList)].join('.'))
    Array.from(el.children).forEach((child) => visit(child, level + 1))
  }
  Array.from(root.children).forEach((child) => visit(child, 0))
  return out
}

const SETTINGS = {
  private: { muted: false, preview: true },
  groups: { muted: false, preview: true },
  channels: { muted: false, preview: true },
}

/** Папка «ровно эти чаты» — счётчик равен числу непрочитанных среди них. */
const raw = (id: number, pos: number, title: string, include: number[]): RawFolder => ({
  id, title, pos,
  contacts: false, non_contacts: false, groups: false, broadcasts: false, bots: false,
  exclude_muted: false, exclude_read: false, include_peers: include, exclude_peers: [],
})

const setDialogs = (dialogs: Dialog[]) => {
  useChatsStore.getState().applyDialogOps([{
    op: 'reset',
    items: dialogs.map((dialog, i) => ({ dialog, index: dialogs.length - i })),
  }])
}

const folders = useFolders()

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

const tabs = (el: Element) => Array.from(el.querySelectorAll<HTMLElement>('.menu-horizontal-div-item'))
const badge = (tab: Element) => tab.querySelector<HTMLElement>('.menu-horizontal-div-item-span > div.badge')!
/** Те же УЗЛЫ (ссылки), а не равные по форме: `toEqual` у DOM сравнивает `isEqualNode`. */
function expectSameNodes(actual: Element[], expected: Element[]) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((node, i) => expect(node).toBe(expected[i]))
}
const title = (tab: Element) => tab.querySelector<HTMLElement>('.menu-horizontal-div-item-span > span.text-super')!

/** Пропы владельца оригинала (`appDialogsManager.ts:654-686`) без его побочек (`hide`, `onRef`). */
const ownerProps = () => ({
  scrollableProps: { class: 'folders-tabs-scrollable' },
  menuProps: { id: 'folders-tabs' },
  gradientProps: { className: 'folders-tabs-gradient', color: 'surface' as const, smaller: true },
})

beforeEach(() => {
  folders.dispose()
  useAppStateStore.setState(initialState(), true)
  useChatsStore.setState({ dialogs: [], dialogIndexById: {} })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useNotifyStore.setState({ settings: SETTINGS })
  resetPeerMirror()
})

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  folders.dispose()
})

describe('foldersTabs.solid: разметка совпадает с живым дампом', () => {
  it('градиент + ряд из четырёх вкладок = 14-left-01-chatlist.json:46-71', () => {
    setDialogs([makeDialog({ peerId: 1, unread: 3 })])
    applyFolderUpdate({ folder: raw(3, 1, 'Работа', [1]) })
    applyFolderUpdate({ folder: raw(4, 2, 'Семья', [1]) })
    applyFolderUpdate({ folder: raw(5, 3, 'Пусто', [99]) })
    folders.hydrate()

    const el = mount(() => <FoldersTabs {...ownerProps()} />)

    // `active` (дамп :51) ставит полоса `horizontalMenu`, а не ряд: компонент
    // выбранную папку не читает (`docs/tweb/folders-tabs.md` § 1.4).
    const expected = dumpLines('14-left-01-chatlist.json', 46, 71).map((line) => line.replace('.active', ''))
    expect(snapshot(el)).toEqual(expected)
    expect(el.querySelector('.menu-horizontal-div')!.id).toBe('folders-tabs')
    expect(el.querySelectorAll('.active')).toHaveLength(0)
  })
})

describe('foldersTabs.solid: вкладка', () => {
  beforeEach(() => {
    setDialogs([
      makeDialog({ peerId: 1, unread: 2 }),
      makeDialog({ peerId: 2, unread: 1, muteUntil: true }),
    ])
    applyFolderUpdate({ folder: raw(3, 1, 'Работа', [1]) })
    applyFolderUpdate({ folder: raw(4, 2, 'Шум', [2]) })
    applyFolderUpdate({ folder: raw(5, 3, 'Пусто', [99]) })
    folders.hydrate()
  })

  it('data-filter-id = id папки, по порядку folderItems (foldersTabs.tsx:34-36)', () => {
    const el = mount(() => <FoldersTabs />)

    expect(tabs(el).map((tab) => tab.dataset.filterId)).toEqual(['0', '3', '4', '5'])
  })

  it('«Все чаты» — всегда i18n FilterAllChatsShort, у папок — заголовок (foldersTabs.tsx:19-31)', () => {
    const el = mount(() => <FoldersTabs />)
    const [all, work, noise] = tabs(el)

    const allTitle = title(all).firstElementChild as HTMLElement
    expect(allTitle.matches('span.i18n')).toBe(true)
    expect(allTitle.textContent).toBe('All')
    expect(title(work).textContent).toBe('Работа')
    expect(title(noise).textContent).toBe('Шум')
  })

  it('бейдж: div.badge.badge-20, серый у замьюченной, пустой при нуле (foldersTabs.tsx:40-46)', () => {
    const el = mount(() => <FoldersTabs />)
    const [all, work, noise, empty] = tabs(el).map(badge)

    // «Все чаты» считает только незамьюченные (`folders.ts:26`) — 1.
    expect(all.className).toBe('badge badge-20 badge-primary')
    expect(all.textContent).toBe('1')
    expect(work.className).toBe('badge badge-20 badge-primary')
    expect(work.textContent).toBe('1')
    expect(noise.className).toBe('badge badge-20 badge-gray')
    expect(noise.textContent).toBe('1')
    expect(empty.className).toBe('badge badge-20 badge-primary is-badge-empty')
  })
})

describe('foldersTabs.solid: пропы владельца', () => {
  beforeEach(() => {
    applyFolderUpdate({ folder: raw(3, 1, 'Работа', []) })
    folders.hydrate()
  })

  it('без gradientProps градиента нет — первым узлом идёт ряд (foldersTabs.tsx:53)', () => {
    const el = mount(() => <FoldersTabs />)

    expect(el.children).toHaveLength(1)
    expect(el.firstElementChild!.className).toBe('menu-horizontal-scrollable')
    expect(el.querySelector('.menu-horizontal-gradient-container')).toBeNull()
  })

  it('с gradientProps градиент — первым узлом, ряд — вторым, оба без обёртки', () => {
    const el = mount(() => <FoldersTabs {...ownerProps()} />)

    expect(Array.from(el.children).map((child) => child.className)).toEqual([
      'menu-horizontal-gradient-container folders-tabs-gradient-container',
      'menu-horizontal-scrollable folders-tabs-scrollable',
    ])
  })

  it('ref-ы получают свои узлы; contextRef скроллера отдан раньше ref меню — на это опирается onRef владельца (:654-686)', () => {
    const got: Record<string, unknown> = {}
    let ctxAtMenuRef: ScrollableContextValue | undefined
    let ctx: ScrollableContextValue | undefined
    const el = mount(() => (
      <FoldersTabs
        scrollableProps={{
          class: 'folders-tabs-scrollable hide',
          ref: (node) => { got.scrollable = node },
          scrollableProps: { contextRef: (value) => { ctx = value } },
        }}
        menuProps={{
          id: 'folders-tabs',
          ref: (node) => { got.menu = node; ctxAtMenuRef = ctx },
        }}
        gradientProps={{
          className: 'folders-tabs-gradient',
          color: 'surface',
          smaller: true,
          ref: (node) => { got.gradient = node; node.classList.add('hide') },
        }}
      />
    ))

    expect(got.scrollable).toBe(el.querySelector('.menu-horizontal-scrollable.folders-tabs-scrollable.hide'))
    expect(got.menu).toBe(el.querySelector('#folders-tabs'))
    expect(got.gradient).toBe(el.querySelector('.folders-tabs-gradient-container'))
    // `hide`, поставленный В REF градиента (как `appDialogsManager.ts:678-681`),
    // затирается class-эффектом `Tabs.MenuGradient`: скомпилированный JSX
    // применяет ref раньше, чем render-эффект атрибута пишет `node.className`.
    // У tweb то же самое: разметка `tabs.tsx:71-95` дословно та же, а его
    // вендорный Solid 1.9.9 (`src/vendor/solid/web/dist/web.js:247-250`,
    // `dist/solid.js:215-218`) так же пишет `className` целиком и так же
    // исполняет render-эффект сразу. У tweb дальше `hide` градиента трогает
    // только `onFiltersLengthChange` (`:1298-1322`), и то лишь при смене показа
    // — одна папка оставляет градиент видимым. Наш владелец поэтому ставит
    // `hide` градиента не в ref, а в `onFiltersLengthChange` на каждом проходе
    // (расхождение 21 `lib/appDialogsManager.ts`, пин —
    // `appDialogsManager.dom.test.ts`). Пин здесь — механика компонента: `hide`
    // из ref не держится. У ряда `hide` едет пропом `class` и живёт.
    expect((got.gradient as HTMLElement).classList.contains('hide')).toBe(false)
    expect(ctxAtMenuRef).toBeDefined()
    expect(ctxAtMenuRef!.container).toBe(el.querySelector('.menu-horizontal-scrollable > .scrollable.scrollable-x'))
  })
})

describe('foldersTabs.solid: For держит узлы вкладок', () => {
  beforeEach(() => {
    setDialogs([makeDialog({ peerId: 1, unread: 2 })])
    applyFolderUpdate({ folder: raw(3, 1, 'Работа', [1]) })
    applyFolderUpdate({ folder: raw(4, 2, 'Шум', [2]) })
    applyFolderUpdate({ folder: raw(5, 3, 'Учёба', []) })
    folders.hydrate()
  })

  it('смена счётчика и мьюта правит бейдж на месте — вкладки те же узлы', () => {
    const el = mount(() => <FoldersTabs />)
    const before = tabs(el)
    expect(badge(before[2]).className).toBe('badge badge-20 badge-primary is-badge-empty')

    setDialogs([makeDialog({ peerId: 1, unread: 2 }), makeDialog({ peerId: 2, unread: 5, muteUntil: true })])

    const after = tabs(el)
    expectSameNodes(after, before)
    expect(badge(after[2]).className).toBe('badge badge-20 badge-gray')
    expect(badge(after[2]).textContent).toBe('1')
  })

  it('переименование правит заголовок на месте', () => {
    const el = mount(() => <FoldersTabs />)
    const before = tabs(el)

    applyFolderUpdate({ folder: raw(4, 2, 'Тишина', [2]) })

    const after = tabs(el)
    expectSameNodes(after, before)
    expect(title(after[2]).textContent).toBe('Тишина')
  })

  it('удаление папки снимает только её вкладку, добавление — вставляет на место', () => {
    const el = mount(() => <FoldersTabs />)
    const [all, work, noise, study] = tabs(el)

    applyFolderUpdate({ deleted: true, folder_id: 4 })
    expectSameNodes(tabs(el), [all, work, study])
    expect(noise.isConnected).toBe(false)

    applyFolderUpdate({ folder: raw(6, 2, 'Новая', []) })
    const now = tabs(el)
    expect(now.map((tab) => tab.dataset.filterId)).toEqual(['0', '3', '6', '5'])
    expectSameNodes([now[0], now[1], now[3]], [all, work, study])
  })
})
