// src/components/userInfo/SharedMedia.saved.test.tsx
// Этап 4, Task 3: вкладка «Избранное» («Чаты») панели профиля переехала на то же
// виртуальное ядро, что список чатов и архив (`DeferredSortedVirtualList`).
//
// Пины здесь про проводку ИМЕННО этого списка, а не про ядро (оно покрыто
// `virtual/*.test.tsx`) и не про список папки (`ChatList.test.tsx`):
// (1) в DOM живут только строки окна, а не весь набор;
// (2) высота `ul` — РОВНО `count * 72`, без `+8`: `extraPaddingBottom: 0`
//     оригинала (`tweb/src/components/appSearchSuper.ts:1906`) — единственное
//     геометрическое отличие этого списка от остальных;
// (3) хост окна — скроллер ПАНЕЛИ ПРОФИЛЯ (`.scrollable-y`, вендорный класс tweb),
//     а не родитель `ul` и не окно: список лежит в карточке внутри вкладки;
// (4) пустой набор показывает прежнюю заглушку ВМЕСТО `ul`;
// (5) уход с вкладки размонтирует список и снимает слушатель скролла с хоста;
// (6) клик по строке отдаёт панели того же пира, что и до виртуализации.
//
// Тест гоняет НАСТОЯЩИЙ `SharedMedia` внутри узла-скроллера с классом панели.
// Моки — только пробы поверх настоящих модулей: счётчик рендеров строк
// (`fmtWhen`, зовётся строкой ровно раз за рендер) и перехват пропов ядра
// (дальше рендерится реальный компонент).
//
// happy-dom не считает layout: `offsetHeight`/`offsetWidth` (их читает
// `useElementSize` у хоста) подставляются стабом на прототипе — тот же приём,
// что в `ChatList.test.tsx` и `Sidebar.archive.test.tsx`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rowRenders, listProps } = vi.hoisted(() => ({
  rowRenders: [] as string[],
  listProps: [] as unknown[],
}))

// Рендеры НАСТОЯЩЕЙ строки: `fmtWhen` она зовёт ровно один раз за рендер и
// ровно со своим `last.at` (приём `ChatList.test.tsx` с `useTypingLabel`).
vi.mock('../../core/dialogToChat', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../core/dialogToChat')>()
  return {
    ...mod,
    fmtWhen: (iso?: string) => {
      rowRenders.push(iso ?? '')
      return mod.fmtWhen(iso)
    },
  }
})

// Какие пропы приезжали в ядро списка «Избранного» — сюда `useCallback` вокруг
// `renderItem` попадает напрямую: счётчик рендеров строк его не видит (строку
// спасает `memo` внутри ядра).
vi.mock('../virtual/DeferredSortedVirtualList', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../virtual/DeferredSortedVirtualList')>()
  const Real = mod.default
  return {
    ...mod,
    default: (props: ComponentProps<typeof Real>) => {
      listProps.push(props)
      return <Real {...props} />
    },
  }
})

import type { ComponentProps } from 'react'

/** Пропы ядра — для утверждений о том, что в него приезжает. */
type ListProps = ComponentProps<(typeof import('../virtual/DeferredSortedVirtualList'))['default']>

import SharedMedia from './SharedMedia'
import itemStyles from '../virtual/DeferredSortedVirtualList.module.scss'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { SavedDialog } from '../../core/managers/chatsManager'
import type { OpenPeer } from '../../data'

const HOST_HEIGHT = 720
/** `itemSize: 72` — `tweb/src/components/appSearchSuper.ts:1905`. */
const ITEM = 72
const SAVED = 150

const managers = new Proxy({}, {
  get: () => new Proxy({}, { get: () => async () => undefined }),
}) as unknown as Managers

// Ключ ЗНАКОВЫЙ: у источника-человека он положительный, у источника-чата
// отрицательный — это и есть единственный признак вида, второго поля рядом нет.
const dialog = (i: number): SavedDialog => ({
  kind: i % 2 ? 'chat' : 'user',
  peerId: i % 2 ? -(i + 1) : i + 1,
  title: 'saved-' + i,
  count: 1,
  last: { type: 'text', text: 'msg-' + i, at: '2026-08-13T10:00:00Z' },
})

const savedDialogs = (n: number): SavedDialog[] => Array.from({ length: n }, (_, i) => dialog(i))

/** Скроллер панели профиля — он же `scrollableHost` списка. */
let host: HTMLDivElement
/**
 * React вешает свою делегацию событий (в т.ч. `scroll`) на КОРНЕВОЙ узел, в
 * который рендерит, поэтому рендерим в узел ВНУТРИ хоста: иначе счётчик
 * слушателей скролла на хосте считал бы ещё и делегацию React'а.
 */
let mountPoint: HTMLDivElement
let addSpy: ReturnType<typeof vi.spyOn>
let removeSpy: ReturnType<typeof vi.spyOn>

const scrollListenerCount = (spy: typeof addSpy) =>
  spy.mock.calls.filter((c: unknown[]) => c[0] === 'scroll').length

const list = () => host.querySelector('ul')
// Строка «Избранного» теперь вендорная (`chatlist-chat`, как у списка чатов).
const rows = () => Array.from(host.querySelectorAll<HTMLElement>('.chatlist-chat'))
// Строку опознаём по превью последнего сообщения (`msg-N`): в `textContent`
// оно идёт между заголовком/временем и инициалом аватара (аватар в вендорной
// разметке — последний ребёнок строки).
const rowTitles = () => rows().map((r) => r.textContent?.match(/msg-\d+/)?.[0] ?? '')

let sizeStubbed = false

/** Набор одного теста — СТАБИЛЬНАЯ ссылка, как снимок одного RPC у `useSavedDialogs`. */
let dialogs: SavedDialog[]

function renderSaved(props: {
  dialogs?: SavedDialog[]
  tab?: string
  onOpenPeer?: (peer: OpenPeer) => void
  gifts?: never[]
}) {
  const ui = (p: typeof props) => (
    <ManagersProvider managers={managers}>
      <SharedMedia
        tab={p.tab ?? 'Chats'}
        onTab={() => {}}
        chatId={null}
        savedDialogs={p.dialogs ?? dialogs}
        gifts={p.gifts}
        onOpenPeer={p.onOpenPeer}
      />
    </ManagersProvider>
  )
  const utils = render(ui(props), { container: mountPoint })
  return { rerender: (next: typeof props) => utils.rerender(ui(next)) }
}

/** Троттлинг измерения скролла в happy-dom уходит в `setTimeout(24)`. */
async function scrollHostTo(top: number) {
  act(() => {
    host.scrollTop = top
    host.dispatchEvent(new Event('scroll'))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
}

beforeEach(() => {
  rowRenders.length = 0
  listProps.length = 0
  dialogs = savedDialogs(SAVED)

  host = document.createElement('div')
  host.className = 'scrollable scrollable-y'
  mountPoint = document.createElement('div')
  host.append(mountPoint)
  document.body.append(host)
  addSpy = vi.spyOn(host, 'addEventListener')
  removeSpy = vi.spyOn(host, 'removeEventListener')

  if (!sizeStubbed) {
    sizeStubbed = true
    const isHost = (el: HTMLElement) => el.classList.contains('scrollable-y')
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

afterEach(() => {
  cleanup()
  host.remove()
  vi.restoreAllMocks()
})

describe('SharedMedia — «Избранное» на виртуальном ядре', () => {
  it('150 сохранённых диалогов: в DOM только строки окна (14 = 720/72 + overscan 4)', () => {
    renderSaved({})

    // idx * 72 >= 0 - 288 — верно для всех idx >= 0;
    // (idx + 1) * 72 <= 0 + 720 + 288 = 1008 → idx <= 13.
    expect(rows()).toHaveLength(14)
    expect(rowTitles()[0]).toBe('msg-0')
    expect(rowTitles()[13]).toBe('msg-13')
  })

  it('высота ul — РОВНО count * 72: extraPaddingBottom: 0, без прибавки 8px', () => {
    renderSaved({})

    // Мутация: убрать проп `extraPaddingBottom` (ядро возьмёт дефолтные 8,
    // `DeferredSortedVirtualList.tsx:134`) — станет 10808px.
    expect(list()!.style.height).toBe(SAVED * ITEM + 'px')
    expect(list()!.style.height).toBe('10800px')
  })

  it('окно считается по скроллу ПАНЕЛИ: прокрутка хоста двигает набор строк', async () => {
    renderSaved({})

    await scrollHostTo(HOST_HEIGHT)

    // Нижняя: idx * 72 >= 720 - 288 = 432 → idx >= 6; верхняя: idx <= 23.
    expect(rows()).toHaveLength(18)
    expect(rowTitles()[0]).toBe('msg-6')
    expect(rowTitles()[17]).toBe('msg-23')
  })

  it('scrollableHost — узел-скроллер панели, а не родитель ul', () => {
    renderSaved({})

    // `ul` лежит в карточке вкладки, а окно считается по скроллеру панели —
    // мутация «взять `ul.parentElement`, как у списка чатов» краснит это
    // равенство, а вместе с ним и оба теста окна выше (у карточки нет высоты).
    expect(list()!.parentElement).not.toBe(host)
    expect((listProps[0] as ListProps).scrollableHost).toBe(null)
    const withHost = listProps.find((p) => (p as ListProps).scrollableHost)
    expect((withHost as ListProps).scrollableHost).toBe(host)
  })

  it('строки несут класс абсолютного позиционирования ядра (itemRef доехал до узла)', () => {
    renderSaved({})

    // Мутация: снять `ref={itemRef}` со строки — ядро не найдёт узел, класс не
    // навесится, и строки лягут обычным потоком поверх высоты `ul`.
    expect(rows().every((r) => r.classList.contains(itemStyles.Item))).toBe(true)
    expect(rows()[3].style.top).toBe(3 * ITEM + 'px')
  })

  it('пустой набор: прежняя заглушка ВМЕСТО ul', () => {
    renderSaved({ dialogs: [] })

    expect(list()).toBe(null)
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()
  })

  it('клик по строке отдаёт панели того же пира — одним знаковым ключом', () => {
    const onOpenPeer = vi.fn()
    renderSaved({ onOpenPeer })

    fireEvent.click(rows()[0]) // kind: 'user'
    fireEvent.click(rows()[1]) // kind: 'chat'

    expect(onOpenPeer).toHaveBeenNthCalledWith(1, { id: 1, title: 'saved-0', photoId: undefined })
    expect(onOpenPeer).toHaveBeenNthCalledWith(2, { id: -2, title: 'saved-1', photoId: undefined })
  })

  it('строка «Избранного» (self) не открывает пира', () => {
    const onOpenPeer = vi.fn()
    const self: SavedDialog = { kind: 'self', peerId: 7, title: 'me', count: 1, last: { type: 'text', text: 'x', at: '2026-08-13T10:00:00Z' } }
    renderSaved({ dialogs: [self, dialog(1)], onOpenPeer })

    fireEvent.click(host.querySelectorAll<HTMLElement>('.chatlist-chat')[0])

    expect(onOpenPeer).not.toHaveBeenCalled()
    expect(screen.getByText('My Notes')).toBeTruthy()
  })

  it('рендер панели строк не касается, а ядро получает ту же ссылку renderItem', () => {
    const { rerender } = renderSaved({ onOpenPeer: () => {} })
    expect(rowRenders).toHaveLength(14) // всё окно, по разу

    // Панель перерисовалась с НОВОЙ стрелкой `onOpenPeer` — ровно то, что
    // происходит на каждом её рендере. Мутации, которые это красит: снять
    // `useEvent` вокруг `onOpenPeer` или `useCallback` вокруг `renderItem`
    // (первую видит счётчик рендеров строк, вторую — набор ссылок ниже).
    rerender({ onOpenPeer: () => {} })

    expect(rowRenders).toHaveLength(14)
    const renderItems = listProps.map((p) => (p as ListProps).renderItem)
    expect(renderItems.length).toBeGreaterThan(1)
    expect(new Set(renderItems).size).toBe(1)
  })

  it('обёртки строк переживают рендер панели: ссылка на items та же', () => {
    const { rerender } = renderSaved({ onOpenPeer: () => {} })
    rerender({ onOpenPeer: () => {} })

    // Контракт пропа `items` ядра (`DeferredSortedVirtualList.tsx:64-80`):
    // обёртки сравниваются ПО ССЫЛКЕ. Мутация: снять `useMemo` — новый массив с
    // новыми обёртками на каждом рендере панели, все строки окна перерисуются.
    const items = listProps.map((p) => (p as ListProps).items)
    expect(new Set(items).size).toBe(1)
  })

  it('уход с вкладки размонтирует список и снимает слушатель скролла с хоста', async () => {
    const { rerender } = renderSaved({ gifts: [] })
    expect(list()).not.toBe(null)
    expect(scrollListenerCount(addSpy)).toBe(1)

    rerender({ gifts: [], tab: 'Gifts' })
    // Уходящий кадр `TabSlide` живёт в DOM, пока играет слайд; в happy-dom
    // `transitionend` не приходит, снимает его фолбэк-таймер (200 + 100).
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })

    expect(list()).toBe(null)
    expect(scrollListenerCount(removeSpy)).toBe(scrollListenerCount(addSpy))
  })

  it('скроллер панели носит именно тот класс, по которому список его ищет', () => {
    // Список находит хост по `closest('.scrollable-y')` — коуплинг с разметкой
    // панели. Пин: `UserInfoPanel` вешает этот класс на свой скроллер (мутация
    // «переименовать класс скроллера» краснит здесь, а не молча оставляет
    // список без окна).
    const panel = readFileSync(join(__dirname, '..', 'UserInfoPanel.tsx'), 'utf8')
    expect(panel).toMatch(/<div ref=\{bodyRef\} className="scrollable scrollable-y"/)
    expect(readFileSync(join(__dirname, 'SharedMedia.tsx'), 'utf8')).toContain("closest<HTMLElement>('.scrollable-y')")
  })
})
