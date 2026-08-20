// src/components/chat/bubbles.scroll.test.ts
//
// Скролл, пагинация и липкие даты императивной ленты (порт tweb
// `chat/bubbles.ts`: `onScroll`, `loadMoreHistory`/`getHistory1`,
// `createScrollSaver`/`prepareToSaveScroll`, `stickyIntersector`,
// `scrollToEnd`/`scrollToBubble`/`highlightBubble`, `setUnreadDelimiter`).
//
// happy-dom не считает layout: `getBoundingClientRect()` у всего нулевой, а
// `scrollTop`/`scrollHeight`/`clientHeight` — нули. Поэтому здесь стоит
// ФЕЙКОВАЯ ГЕОМЕТРИЯ (`installFakeLayout`): вьюпорт 500px, бабл 100px, позиция
// бабла — его индекс в потоке минус `scrollTop`. Этого достаточно и честно: и
// `ScrollSaver`, и `Scrollable.checkForTriggers`, и `getViewportSlice` читают
// ровно эти четыре величины, никакой другой информации о раскладке у них нет.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import type { MyMessage } from '@core/models'
import { makeMessage, type MessageFixture } from '@core/messages/testMessage'
import type { HistoryArgs, HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { makeFullMid, type BubblesManagers, type ChatContext } from './bubbles'

const CHAT = 50
const VIEWPORT_H = 500
const BUBBLE_H = 100

/** Номер у сообщения ОДИН (решение Р1) — он же адрес бабла, он же порядок.
 *  Фикстуры пишут его маленькими числами: читаемость важнее, а в границу
 *  пространств этот файл не бьёт (менеджер здесь фейковый). */
function msg(id: number, over: Partial<MessageFixture> = {}): MyMessage {
  return makeMessage({ id, peerId: CHAT, fromId: 2, text: `m${id}`, createdAt: '2026-08-15T12:00:00Z', ...over })
}

type ContextExtras = Partial<ChatContext>

function makeContext(over: ContextExtras = {}) {
  const container = document.createElement('div')
  container.classList.add('chat')
  const bubblesViewport = document.createElement('div')
  const ctx: ChatContext = {
    peerId: CHAT,
    messagesStorageKey: String(CHAT),
    container,
    bubblesViewport,
    ...over,
  }
  return { ctx, container, bubblesViewport }
}

const page = (ids: number[], reachedTop: boolean, reachedBottom: boolean): HistoryResult => ({
  messages: ids.map((id) => msg(id)),

  count: ids.length,
  reachedTop,
  reachedBottom,
})

/** Менеджеры с ТРЁХСТОРОННЕЙ историей: первая страница (offsetSeq 0), «старее»
 *  (addOffset > 0) и «новее» (addOffset < 0) — ровно три формы запроса, которые
 *  умеет строить `requestHistory`. */
function pagingManagers(pages: { first: HistoryResult, older?: HistoryResult, newer?: HistoryResult }) {
  const calls: HistoryArgs[] = []
  const getHistory = vi.fn(async (args: HistoryArgs): Promise<HistoryResult> => {
    calls.push(args)
    if (!args.offsetId) return pages.first
    if ((args.addOffset ?? 0) > 0) return pages.older ?? page([], true, false)
    return pages.newer ?? page([], false, true)
  })
  const getReadMaxSeqIfUnread = vi.fn(async () => 0)
  const getHistoryMaxSeq = vi.fn(async () => 0)
  const managers: BubblesManagers = {
    messages: { getHistory },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread, getHistoryMaxSeq },
  }
  return Object.assign(managers, { calls, getHistory, getReadMaxSeqIfUnread, getHistoryMaxSeq })
}

/** Троттлинг Scrollable в этой среде — `setTimeout(24)`
 *  (`IS_OVERLAY_SCROLL_SUPPORTED()` в happy-dom истинно), плюс очередь рендера
 *  ленты живёт на `pause(0)`. */
async function settle(times = 6) {
  for (let i = 0; i < times; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

const rect = (top: number, height: number): DOMRect => ({
  top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top,
  toJSON: () => ({}),
} as DOMRect)

/**
 * Виртуальная раскладка поверх дерева ленты: контейнер — окно `[0, 500)`,
 * каждый `.bubble` — 100px, позиция считается по индексу узла в общем потоке
 * контейнера. Именно это и делает проверяемым главный пин этапа: вставка
 * страницы НАД вьюпортом сдвигает индекс якоря, а значит и его `DOMRect`.
 */
function installFakeLayout(container: HTMLElement) {
  let scrollTop = 0
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = v },
  })
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => VIEWPORT_H })
  Object.defineProperty(container, 'offsetHeight', { configurable: true, get: () => VIEWPORT_H })
  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => container.querySelectorAll('.bubble').length * BUBBLE_H,
  })

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function(this: HTMLElement) {
    if (this === container) return rect(0, VIEWPORT_H)
    if (this.classList.contains('bubble')) {
      const all = Array.from(container.querySelectorAll('.bubble'))
      const idx = all.indexOf(this)
      if (idx === -1) return rect(0, 0)
      return rect(idx * BUBBLE_H - container.scrollTop, BUBBLE_H)
    }
    return rect(0, 0)
  }

  return () => { HTMLElement.prototype.getBoundingClientRect = original }
}

/** Настоящий путь скролла: пишем позицию и отдаём браузерное событие —
 *  дальше работает троттлинг Scrollable (`onScroll` → `onAdditionalScroll` +
 *  `checkForTriggers`), а не наш прямой вызов.
 *
 *  Событие отдаётся ДВАЖДЫ намеренно: корректирующая запись позиции
 *  (`ScrollSaver.restore` → `setScrollPositionSilently`) взводит
 *  `ignoreNextScrollEvent` — порт tweb, который ГЛУШИТ ближайшее нативное
 *  `scroll`, чтобы программная запись не выглядела как ручной скролл. Первый
 *  наш dispatch после такой записи и съедается этим механизмом. */
async function scrollTo(bubbles: ChatBubbles, top: number) {
  bubbles.scrollable.container.scrollTop = top
  bubbles.scrollable.container.dispatchEvent(new Event('scroll'))
  await settle(1)
  bubbles.scrollable.container.dispatchEvent(new Event('scroll'))
  await settle(1)
}

const rendered = (b: ChatBubbles) =>
  Array.from(b.chatInner.querySelectorAll<HTMLElement>('.bubble:not(.service)'))

let bubbles: ChatBubbles | undefined
let restoreLayout: (() => void) | undefined

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 999
})

afterEach(() => {
  bubbles?.destroy()
  bubbles = undefined
  restoreLayout?.()
  restoreLayout = undefined
  vi.unstubAllGlobals()
})

function mount(managers: BubblesManagers, over: ContextExtras = {}) {
  const { ctx, container: chatColumn } = makeContext(over)
  const b = new ChatBubbles(ctx, managers)
  restoreLayout = installFakeLayout(b.scrollable.container)
  bubbles = b
  return { b, chatColumn }
}

// ─── Пагинация ─────────────────────────────────────────────────────────────

describe('ChatBubbles — пагинация (loadMoreHistory + getHistory1)', () => {
  it('докрутили вверх → доехала страница СТАРЫХ (и предзагрузка justLoad её не рисовала)', async () => {
    const managers = pagingManagers({
      first: page([11, 12, 13, 14, 15, 16, 17, 18, 19, 20], false, true),
      older: page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], true, false),
    })
    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    // Предзагрузка соседней страницы (tweb getHistory1 :11346) уже сходила за
    // старыми, но `justLoad` — «грузим, не рисуем».
    expect(managers.calls.some((c) => (c.addOffset ?? 0) > 0)).toBe(true)
    expect(rendered(b)).toHaveLength(10)

    await scrollTo(b, 900) // сначала вниз — иначе lastScrollDirection === 0
    await scrollTo(b, 100) // и к верхнему краю: сработает onScrolledTop
    await settle()

    expect(rendered(b).map((el) => el.dataset.mid)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(String),
    )
    expect(b.scrollable.loadedAll.top).toBe(true)
  })

  it('докрутили вниз → доехала страница НОВЫХ', async () => {
    const newerPages = [page([16, 17, 18], false, false), page([19, 20], false, true)]
    const managers = pagingManagers({ first: page([11, 12, 13, 14, 15], true, false) })
    managers.getHistory.mockImplementation(async (args: HistoryArgs) => {
      managers.calls.push(args)
      if (!args.offsetId) return page([11, 12, 13, 14, 15], true, false)
      if ((args.addOffset ?? 0) > 0) return page([], true, false)
      return newerPages.find((p) => p.messages[0].id > args.offsetId!) ?? page([], false, true)
    })

    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    // Первая страница легла и лента встала у низа НЕсведённого окна — этого
    // достаточно, чтобы `checkForTriggers` позвал `onScrolledBottom` (тот же
    // путь, что и у ручного докручивания вниз).
    expect(managers.calls.some((c) => (c.addOffset ?? 0) < 0)).toBe(true)
    expect(rendered(b).map((el) => el.dataset.mid)).toContain('16')

    await scrollTo(b, b.scrollable.container.scrollHeight)
    await settle()

    expect(rendered(b).map((el) => el.dataset.mid)).toEqual(
      ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20'],
    )
    expect(b.scrollable.loadedAll.bottom).toBe(true)
  })

  it('повторный триггер ПОКА страница в полёте не даёт второго запроса', async () => {
    const managers = pagingManagers({ first: page([11, 12, 13], false, true) })
    // «Старее» — вечно висящий запрос: ровно то состояние, ради которого в
    // `loadMoreHistory` живёт гейт `getHistoryTopPromise`.
    managers.getHistory.mockImplementation(async (args: HistoryArgs) => {
      managers.calls.push(args)
      if (!args.offsetId) return page([11, 12, 13], false, true)
      return new Promise<HistoryResult>(() => {})
    })

    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    const afterFirst = managers.calls.filter((c) => (c.addOffset ?? 0) > 0).length
    expect(afterFirst).toBe(1) // предзагрузка вверх ушла и висит

    b.loadMoreHistory(true)
    b.loadMoreHistory(true)
    await settle()
    b.loadMoreHistory(true)
    await settle()

    expect(managers.calls.filter((c) => (c.addOffset ?? 0) > 0)).toHaveLength(afterFirst)
  })

  it('край истории закрывает свою сторону: у сведённого верха вверх не ходим вовсе', async () => {
    const managers = pagingManagers({ first: page([11, 12, 13], true, true) })
    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    b.loadMoreHistory(true)
    b.loadMoreHistory(false)
    await settle()

    expect(managers.calls).toHaveLength(1)
  })
})

// ─── Сохранение позиции при вставке НАД вьюпортом ───────────────────────────

describe('ChatBubbles — ScrollSaver вокруг вставки сверху', () => {
  it('позиция вьюпорта не уезжает: scrollTop сдвигается ровно на высоту вставленного', async () => {
    const managers = pagingManagers({
      first: page([11, 12, 13, 14, 15, 16, 17, 18, 19, 20], false, true),
      older: page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], true, false),
    })
    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    // Пользователь стоит в середине истории.
    await scrollTo(b, 900)
    await scrollTo(b, 800)
    const before = b.scrollable.container.scrollTop
    const anchor = rendered(b).find((el) => el.getBoundingClientRect().top >= 0)!
    const anchorTopBefore = anchor.getBoundingClientRect().top

    b.loadMoreHistory(true)
    await settle()

    // Десять баблов по 100px встали НАД якорем — на столько же обязан вырасти
    // scrollTop, иначе лента визуально прыгнет на свежезагруженные старые.
    expect(rendered(b)).toHaveLength(20)
    expect(b.scrollable.container.scrollTop).toBe(before + 10 * BUBBLE_H)
    // И сам якорь остался на том же месте экрана.
    expect(anchor.getBoundingClientRect().top).toBe(anchorTopBefore)
  })
})

// ─── Липкая дата ───────────────────────────────────────────────────────────

/** Управляемый IntersectionObserver: `StickyIntersector` создаёт ровно два —
 *  сначала по sentinel'ам (headers), потом по самим секциям. */
class FakeIntersectionObserver {
  public static instances: FakeIntersectionObserver[] = []
  public targets: Element[] = []
  constructor(public cb: (entries: unknown[], observer: unknown) => void, public options?: unknown) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) { this.targets.push(el) }
  unobserve(el: Element) { this.targets = this.targets.filter((t) => t !== el) }
  disconnect() { this.targets = [] }
  takeRecords() { return [] }
}

describe('ChatBubbles — липкая дата ставится наблюдателем', () => {
  const stick = (sentinel: Element, stuck: boolean) => {
    FakeIntersectionObserver.instances[0].cb([{
      target: sentinel,
      boundingClientRect: { bottom: stuck ? -10 : 10 },
      rootBounds: { top: 0 },
    }], null)
  }

  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })

  it('sentinel секции ставит наблюдатель — он же третий узел секции (STICKY_OFFSET)', async () => {
    const managers = pagingManagers({ first: page([1, 2], true, true) })
    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    const section = b.chatInner.querySelector('.bubbles-date-group')!
    expect(Array.from(section.children).slice(0, 3).map((el) => el.className)).toEqual([
      'bubble service is-date',
      'bubble service is-date is-fake',
      'sticky_sentinel sticky_sentinel--top',
    ])
  })

  it('класс is-sticky пишется ПРЯМО на узел даты, лента при этом не перерисовывается', async () => {
    const managers = pagingManagers({ first: page([1, 2], true, true) })
    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    const section = b.chatInner.querySelector('.bubbles-date-group')!
    const dateBubble = section.children[0]
    const nodesBefore = rendered(b)
    const groupBubbles = vi.spyOn(b, 'groupBubbles')

    stick(section.querySelector('.sticky_sentinel--top')!, true)

    expect(dateBubble.classList.contains('is-sticky')).toBe(true)
    // Ни одного нового узла: класс — единственное, что изменилось.
    expect(rendered(b)).toEqual(nodesBefore)
    expect(groupBubbles).not.toHaveBeenCalled()

    stick(section.querySelector('.sticky_sentinel--top')!, false)
    expect(dateBubble.classList.contains('is-sticky')).toBe(false)
  })

  it('из нескольких застрявших секций is-sticky носит САМАЯ ПОЗДНЯЯ', async () => {
    const managers = pagingManagers({
      first: {
        messages: [
          msg(1, { createdAt: '2026-08-14T12:00:00Z' }),
          msg(2, { createdAt: '2026-08-15T12:00:00Z' }),
        ],
        count: 2, reachedTop: true, reachedBottom: true,
      },
    })
    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    const sections = Array.from(b.chatInner.querySelectorAll('.bubbles-date-group'))
    expect(sections).toHaveLength(2)

    stick(sections[0].querySelector('.sticky_sentinel--top')!, true)
    expect(sections[0].children[0].classList.contains('is-sticky')).toBe(true)

    stick(sections[1].querySelector('.sticky_sentinel--top')!, true)
    expect(sections[0].children[0].classList.contains('is-sticky')).toBe(false)
    expect(sections[1].children[0].classList.contains('is-sticky')).toBe(true)
  })
})

// ─── Кнопка «вниз» ─────────────────────────────────────────────────────────

describe('ChatBubbles — кнопка «вниз»', () => {
  it('появляется по порогу SCROLLED_DOWN_THRESHOLD и гаснет у низа', async () => {
    const managers = pagingManagers({ first: page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], true, true) })
    const { b, chatColumn } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    // Открытие чата: лента прижата к низу — кнопки нет.
    expect(chatColumn.classList.contains('is-go-down-visible')).toBe(false)

    await scrollTo(b, 0) // 1000 − 0 − 500 = 500 > 300
    expect(b.container.classList.contains('scrolled-down')).toBe(false)
    expect(chatColumn.classList.contains('is-go-down-visible')).toBe(true)

    await scrollTo(b, 500) // 1000 − 500 − 500 = 0 < 300
    expect(b.container.classList.contains('scrolled-down')).toBe(true)
    expect(chatColumn.classList.contains('is-go-down-visible')).toBe(false)
  })

  it('уводит в конец: scrollToEnd → scrollIntoViewNew(chatInner, «end»)', async () => {
    const managers = pagingManagers({ first: page([1, 2, 3], true, true) })
    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    const spy = vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockResolvedValue(undefined)
    await b.scrollToEnd()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatchObject({ element: b.chatInner, position: 'end' })
  })
})

// ─── Переход к сообщению ───────────────────────────────────────────────────

describe('ChatBubbles — переход к сообщению', () => {
  it('центрирование идёт через scrollIntoViewNew с position «center»', async () => {
    const managers = pagingManagers({ first: page([1, 2, 3, 4, 5], true, true) })
    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    const target = b.getBubble(makeFullMid(CHAT, 3))!
    const spy = vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockResolvedValue(undefined)
    void b.scrollToBubble(target, 'center')

    expect(spy.mock.calls[0][0]).toMatchObject({ element: target, position: 'center', axis: 'y' })
  })

  it('подсветка: is-highlighted на 2 секунды, повторный прыжок перезапускает её', async () => {
    vi.useFakeTimers()
    try {
      const managers = pagingManagers({ first: page([1], true, true) })
      const { b } = mount(managers)
      const target = document.createElement('div')
      target.classList.add('bubble')

      b.highlightBubble(target)
      expect(target.classList.contains('is-highlighted')).toBe(true)
      const firstTimeout = target.dataset.highlightTimeout
      expect(firstTimeout).toBeDefined()

      vi.advanceTimersByTime(1000)
      b.highlightBubble(target)
      expect(target.dataset.highlightTimeout).not.toBe(firstTimeout)
      expect(target.classList.contains('is-highlighted')).toBe(true)

      // Прошло 2000мс от ВТОРОГО вызова — не от первого.
      vi.advanceTimersByTime(1500)
      expect(target.classList.contains('is-highlighted')).toBe(true)
      vi.advanceTimersByTime(600)
      expect(target.classList.contains('is-highlighted')).toBe(false)
      expect(target.dataset.highlightTimeout).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── Граница непрочитанных ─────────────────────────────────────────────────

describe('ChatBubbles — граница непрочитанных', () => {
  it('is-first-unread встаёт на ПЕРВОЕ входящее новее горизонта прочтения', async () => {
    const managers = pagingManagers({ first: page([11, 12, 13, 14, 15], true, true) })
    managers.getReadMaxSeqIfUnread.mockResolvedValue(12)
    managers.getHistoryMaxSeq.mockResolvedValue(15)

    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    expect(b.chatInner.querySelectorAll('.is-first-unread')).toHaveLength(1)
    expect(b.getBubble(makeFullMid(CHAT, 13))!.classList.contains('is-first-unread')).toBe(true)
  })

  it('исходящие в кандидаты не идут', async () => {
    const managers = pagingManagers({
      first: {
        messages: [msg(11), msg(12), msg(13, { out: true }), msg(14), msg(15)],
        count: 5, reachedTop: true, reachedBottom: true,
      },
    })
    managers.getReadMaxSeqIfUnread.mockResolvedValue(12)
    managers.getHistoryMaxSeq.mockResolvedValue(15)

    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    expect(b.getBubble(makeFullMid(CHAT, 13))!.classList.contains('is-first-unread')).toBe(false)
    expect(b.getBubble(makeFullMid(CHAT, 14))!.classList.contains('is-first-unread')).toBe(true)
  })

  it('прочитанный чат черты не получает (горизонт 0)', async () => {
    const managers = pagingManagers({ first: page([11, 12, 13], true, true) })
    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    expect(b.chatInner.querySelectorAll('.is-first-unread')).toHaveLength(0)
  })

  it('перед САМЫМ последним сообщением чата черта не рисуется', async () => {
    const managers = pagingManagers({ first: page([11, 12, 13], true, true) })
    managers.getReadMaxSeqIfUnread.mockResolvedValue(12)
    managers.getHistoryMaxSeq.mockResolvedValue(13)

    const { b } = mount(managers)
    await b.loadFirstHistory()
    await settle()

    expect(b.chatInner.querySelectorAll('.is-first-unread')).toHaveLength(0)
  })
})
