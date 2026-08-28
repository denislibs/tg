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
import { mirrorWindow, resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { interruptHeavyAnimation } from '@core/dom/heavyAnimation'
import { useSettingsStore } from '@/settings'
import { clearChatPositions } from '@core/chat/chatPositions'
import type { MyMessage } from '@core/models'
import { makeMessage, type MessageFixture } from '@core/messages/testMessage'
import type { HistoryArgs, HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { makeFullMid, type BubblesManagers, type ChatContext } from './bubbles'

/** Открыть окно ленты и дождаться ОТРИСОВКИ. `setPeer` (как в оригинале)
 *  возвращает управление, едва отправив запрос: рендер и доводка живут во
 *  ВТОРОМ промисе результата — `{cached, promise}`, и ждёт его `Chat.setPeer`
 *  (tweb chat.ts:1119-1122). */
async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

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
function pagingManagers(pages: { first: HistoryResult, older?: HistoryResult, newer?: HistoryResult, around?: HistoryResult }) {
  const calls: HistoryArgs[] = []
  const getHistory = vi.fn(async (args: HistoryArgs): Promise<HistoryResult> => {
    calls.push(args)
    if (!args.offsetId) return pages.first
    if ((args.addOffset ?? 0) > 0) return pages.older ?? page([], true, false)
    return pages.newer ?? page([], false, true)
  })
  // Четвёртая форма страницы — окно ВОКРУГ номера (`?around=`): ею отвечает
  // `requestHistory` на `backLimit` прыжка, см. её докблок.
  const aroundCalls: { centerId: number, limit?: number }[] = []
  const getAround = vi.fn(async (_peerId: number, centerId: number, limit?: number) => {
    aroundCalls.push({ centerId, limit })
    const p = pages.around ?? page([], false, false)
    return { messages: p.messages, reachedTop: p.reachedTop, reachedBottom: p.reachedBottom }
  })
  const messageByDate = vi.fn(async (): Promise<number | null> => null)
  const getReadMaxSeqIfUnread = vi.fn(async () => 0)
  const markRead = vi.fn(async () => ({ ok: true }))
  const getHistoryMaxSeq = vi.fn(async () => 0)
  const managers: BubblesManagers = {
    messages: { getHistory, getAround, messageByDate },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread, getHistoryMaxSeq },
    // Ручка отметки прочтения: наблюдатель непрочитанных живёт в самой ленте
    // (порт tweb bubbles.ts:2941-3012).
    realtime: { markRead },
  }
  return Object.assign(managers, { calls, aroundCalls, getHistory, getAround, messageByDate, getReadMaxSeqIfUnread, getHistoryMaxSeq, markRead })
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
    // Как настоящий элемент: позиция ЗАЖИМАЕТСЯ в [0, scrollHeight −
    // clientHeight]. Без зажима `setScrollPositionSilently(99999)` из
    // `setPeer` (порт tweb bubbles.ts:5442/5489 — «уйти в самый низ») оставил
    // бы здесь буквальные 99999, и вся лента оказалась бы «выше вьюпорта» для
    // `getViewportSlice`.
    set: (v: number) => { scrollTop = Math.max(0, Math.min(v, container.scrollHeight - container.clientHeight)) },
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
  // Этот файл — про скролл и пагинацию, а не про «лестницу» первой загрузки.
  // Лестница объявляет себя ТЯЖЁЛОЙ АНИМАЦИЕЙ на всю свою длительность
  // (tweb bubbles.ts:10436-10440), а под ней лента по построению не грузит
  // страниц и не подрезает вьюпорт — то есть здесь она заглушила бы ровно то,
  // что проверяется. Выключаем её тем же гейтом, что и оригинал:
  // `liteMode.isAvailable('animations')` (tweb bubbles.ts:11540). Побочно это
  // делает мгновенным и `fastSmoothScroll` — что тестам только на руку:
  // доводка скролла здесь проверяется по КОНЕЧНОЙ позиции.
  useSettingsStore.setState({ reduceMotion: true })
  interruptHeavyAnimation()
  // Карта сохранённых позиций — синглтон модуля, а `destroy()` в `afterEach`
  // пишет в неё (порт `peer_changing` → `saveChatPosition`). Без сброса
  // следующий тест открывал бы «тот же чат» ВОЗВРАТОМ: окно восстановилось бы
  // из прошлых номеров, и страницу у менеджера никто бы не спросил.
  clearChatPositions()
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
    await openFeed(b)
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
    await openFeed(b)
    await settle()

    // Окно открыто и стоит у низа, но с концом истории НЕ сведено. Первый
    // триггер `onScrolledBottom` даёт уже докручивание: `setPeer` увёл ленту
    // вниз ТИХОЙ записью (`setScrollPositionSilently(99999)`, порт tweb
    // bubbles.ts:5489), а она оставляет `lastScrollPosition` больше реальной
    // позиции — то есть направление читается как «вверх», и нижний триггер
    // (`lastScrollDirection >= 0`) не срабатывает сам собой.
    await scrollTo(b, b.scrollable.container.scrollHeight)
    await settle()

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
    await openFeed(b)
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
    await openFeed(b)
    await settle()

    b.loadMoreHistory(true)
    b.loadMoreHistory(false)
    await settle()

    expect(managers.calls).toHaveLength(1)
  })
})

// ─── Кто ДОПОЛНЯЕТ окно зеркала, а кто НАЧИНАЕТ его заново ──────────────────
//
// Единственная точка, где страница попадает в зеркало, — `sup()` внутри
// `getHistory`, и ходят через неё ОБА сценария. Различает их вызывающий
// (`replaceWindow`), потому что в оригинале различие проведено на двух этажах:
//  • хранилище — `SlicedArray.insertSlice` (appMessagesManager.ts:9603)
//    приклеивает страницу к слайсу, только если та стыкуется с ним по границам
//    (slicedArray.ts:207-224); окно вокруг далёкого номера ни с чем не
//    стыкуется и становится ОТДЕЛЬНЫМ слайсом (slicedArray.ts:225-235);
//  • отрисованное — `setPeer` выкидывает его целиком: `cleanup()`
//    (bubbles.ts:5243) обнуляет `this.bubbles` (:4920) и заводит новый
//    `chatInner` (:5244). Этот этаж и играет наше плоское зеркало: из него
//    лента берёт сообщения на рендер, а `Chat.tsx` — приветствие бота и
//    клавиатуру ответа.
describe('ChatBubbles — окно зеркала: догрузка ДОПОЛНЯЕТ, setPeer ЗАМЕНЯЕТ', () => {
  it('догрузка страницы вверх ДОПОЛНЯЕТ окно — прежние сообщения остаются', async () => {
    const managers = pagingManagers({
      first: page([11, 12, 13, 14, 15, 16, 17, 18, 19, 20], false, true),
      older: page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], true, false),
    })
    const { b } = mount(managers)
    await openFeed(b)
    await settle()

    await scrollTo(b, 900) // сначала вниз — иначе lastScrollDirection === 0
    await scrollTo(b, 100) // и к верхнему краю: сработает onScrolledTop
    await settle()

    expect(mirrorWindow(String(CHAT))?.map((m) => m.id)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    )
  })

  // Тот самый дефект: окно, собранное вокруг далёкого номера, склеивалось с
  // прежним окном у низа истории — между ними дыра, а лента и React читали их
  // как одно непрерывное окно.
  it('прыжок к сообщению ВНЕ окна ЗАМЕНЯЕТ его — прежних сообщений в зеркале нет', async () => {
    const managers = pagingManagers({
      first: page([11, 12, 13], false, true),
      around: page([5, 6, 7, 8, 9], false, false),
    })
    managers.getHistoryMaxSeq.mockResolvedValue(13)
    const { b } = mount(managers)
    await openFeed(b)
    await settle()
    expect(mirrorWindow(String(CHAT))?.map((m) => m.id)).toEqual([11, 12, 13])

    vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockResolvedValue(undefined)
    await (await b.setMessageId({ lastMsgId: 7 }))?.promise
    await settle()

    // Ровно окно прыжка: ни одного бабла прежнего окна.
    expect(mirrorWindow(String(CHAT))?.map((m) => m.id)).toEqual([5, 6, 7, 8, 9])
    // И зеркало сходится с отрисованным — тем самым, ради чего замена и нужна.
    expect(rendered(b).map((el) => el.dataset.mid)).toEqual(['5', '6', '7', '8', '9'])
  })

  // Повтор `setPeer` того же чата. Одинаковой страницей это не проверить:
  // `putMirrorPage` дедуплицирует по ключу сообщения (`s:${id}`), и слияние
  // страницы с самой собой окна не удвоило бы. Разницу видно, когда вторая
  // страница ДРУГАЯ, — так «Очистить историю» и удаление сообщений и выглядят.
  it('повторный setPeer того же чата окно не накапливает: остаётся ровно новая страница', async () => {
    const pages = [page([11, 12, 13], false, true), page([12, 13], false, true)]
    const managers = pagingManagers({ first: pages[0] })
    managers.getHistory.mockImplementation(async (args: HistoryArgs) => {
      managers.calls.push(args)
      if (args.offsetId) return page([], true, false)
      return pages.shift() ?? page([], true, true)
    })
    const { b } = mount(managers)
    await openFeed(b)
    await settle()
    expect(mirrorWindow(String(CHAT))?.map((m) => m.id)).toEqual([11, 12, 13])

    await openFeed(b)
    await settle()

    expect(mirrorWindow(String(CHAT))?.map((m) => m.id)).toEqual([12, 13])
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
    await openFeed(b)
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
    await openFeed(b)
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
    await openFeed(b)
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
    await openFeed(b)
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
    await openFeed(b)
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
    await openFeed(b)
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
    await openFeed(b)
    await settle()

    const target = b.getBubble(makeFullMid(CHAT, 3))!
    const spy = vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockResolvedValue(undefined)
    void b.scrollToBubble(target, 'center')

    expect(spy.mock.calls[0][0]).toMatchObject({ element: target, position: 'center', axis: 'y' })
  })

  // Прыжок ВНЕ окна — то, ради чего порт `setPeer` и делался: до него
  // сообщение за пределами загруженной страницы просто не находилось.
  it('цель вне окна: окно пересобирается ВОКРУГ неё (getAround), цель подсвечена и отцентрирована', async () => {
    const managers = pagingManagers({
      first: page([11, 12, 13], false, true),
      around: page([5, 6, 7, 8, 9], false, false),
    })
    // Последнее сообщение чата (порт `historyStorage.maxId`, tweb
    // bubbles.ts:5079): без него цель не отличить от «идём в самый низ».
    managers.getHistoryMaxSeq.mockResolvedValue(13)
    const { b } = mount(managers)
    await openFeed(b)
    await settle()

    const spy = vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockResolvedValue(undefined)
    await (await b.setMessageId({ lastMsgId: 7 }))?.promise
    await settle()

    // Страница взята ОКНОМ вокруг номера, а не «от него вверх».
    expect(managers.aroundCalls.map((c) => c.centerId)).toEqual([7])
    expect(rendered(b).map((el) => el.dataset.mid)).toEqual(['5', '6', '7', '8', '9'])

    const target = b.getBubble(makeFullMid(CHAT, 7))!
    expect(target.classList.contains('is-highlighted')).toBe(true)
    expect(spy.mock.calls[0][0]).toMatchObject({ element: target, position: 'center' })
  })

  // `has-groups` на ленте включает отступы секций дня; владелец класса после
  // пересборки окна — сам `setPeer` (tweb bubbles.ts:5420), потому что
  // `cleanup()` реестр секций опустошает, но класс не трогает.
  it('пересобранное окно без сообщений снимает has-groups', async () => {
    const managers = pagingManagers({ first: page([11, 12, 13], false, true) })
    managers.getHistoryMaxSeq.mockResolvedValue(13)
    const { b } = mount(managers)
    await openFeed(b)
    await settle()
    expect(b.container.classList.contains('has-groups')).toBe(true)

    // Окно вокруг цели пустое (её удалили, пока летел запрос) — секций дня в
    // новом дереве нет.
    await (await b.setMessageId({ lastMsgId: 7 }))?.promise
    await settle()

    expect(rendered(b)).toHaveLength(0)
    expect(b.container.classList.contains('has-groups')).toBe(false)
  })

  // Кэш-ветка оригинала (tweb bubbles.ts:5156-5200): цель уже показана —
  // трогать ленту нечем, иначе прыжок к соседнему сообщению перерисовывал бы
  // всё окно.
  it('цель уже в окне: страница не запрашивается и узел ленты остаётся тем же', async () => {
    const managers = pagingManagers({ first: page([1, 2, 3, 4, 5], true, true) })
    managers.getHistoryMaxSeq.mockResolvedValue(5)
    const { b } = mount(managers)
    await openFeed(b)
    await settle()

    const chatInnerBefore = b.chatInner
    const historyCalls = managers.getHistory.mock.calls.length
    const spy = vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockResolvedValue(undefined)

    const result = await b.setMessageId({ lastMsgId: 2 })

    // `null` — сигнал оригинала «окно не перерисовывалось» (:5200).
    expect(result).toBeNull()
    expect(b.chatInner).toBe(chatInnerBefore)
    expect(managers.getHistory.mock.calls).toHaveLength(historyCalls)
    expect(managers.aroundCalls).toHaveLength(0)

    const target = b.getBubble(makeFullMid(CHAT, 2))!
    expect(target.classList.contains('is-highlighted')).toBe(true)
    expect(spy.mock.calls[0][0]).toMatchObject({ element: target, position: 'center' })
  })

  // Поколение окна (`setPeerTempId`, tweb bubbles.ts:5039-5055): без него
  // страница вытесненного прыжка дорисовалась бы в чужое окно.
  it('второй прыжок вытесняет первый: тот отвергнут PEER_CHANGED_ERROR, окно — вокруг ПОСЛЕДНЕЙ цели', async () => {
    const managers = pagingManagers({ first: page([11, 12, 13], false, true) })
    managers.getHistoryMaxSeq.mockResolvedValue(13)
    managers.getAround.mockImplementation(async (_peerId: number, centerId: number) => {
      const ids = centerId === 3 ? [2, 3, 4] : [6, 7, 8]
      return { messages: ids.map((id) => msg(id)), reachedTop: false, reachedBottom: false }
    })
    const { b } = mount(managers)
    await openFeed(b)
    await settle()

    vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockResolvedValue(undefined)
    const first = b.setMessageId({ lastMsgId: 3 })
    const second = b.setMessageId({ lastMsgId: 7 })

    await expect(first).rejects.toThrow('peer changed')
    await (await second)?.promise
    await settle()

    expect(rendered(b).map((el) => el.dataset.mid)).toEqual(['6', '7', '8'])
    expect(b.getBubble(makeFullMid(CHAT, 7))!.classList.contains('is-highlighted')).toBe(true)
  })

  // Календарь: клик по дата-баблу отдаёт хосту день секции и КОЛБЭК выбора
  // (порт tweb bubbles.ts:3075-3078 `showDatePickerPopup({initDate, onPick:
  // this.onDatePick})`), а выбранный день лента сама превращает в прыжок
  // (:10205).
  it('клик по дата-баблу открывает календарь, а выбранный день уводит прыжком', async () => {
    const openDatePicker = vi.fn<(initDate: number, onPick: (timestamp: number) => void) => void>()
    const managers = pagingManagers({ first: page([1, 2, 3], true, true) })
    managers.getHistoryMaxSeq.mockResolvedValue(3)
    const { b } = mount(managers, { navigation: { openDatePicker } })
    await openFeed(b)
    await settle()

    document.body.append(b.container)
    vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockResolvedValue(undefined)

    const dateContent = b.chatInner.querySelector<HTMLElement>('.bubble.is-date:not(.is-fake) .bubble-content')!
    dateContent.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // Первый аргумент — ЛОКАЛЬНАЯ полночь дня секции (порт
    // `getDateForDateContainer`, tweb bubbles.ts:4815).
    const day = new Date(msg(1).date * 1000).setHours(0, 0, 0, 0)
    expect(openDatePicker).toHaveBeenCalledWith(day, expect.any(Function))

    // Выбор дня: «день → номер» спрашивается у владельца, дальше — обычный прыжок.
    managers.messageByDate.mockResolvedValue(2)
    openDatePicker.mock.calls[0][1](1_755_216_000)
    await settle()

    expect(managers.messageByDate).toHaveBeenCalledWith(CHAT, 1_755_216_000)
    expect(b.getBubble(makeFullMid(CHAT, 2))!.classList.contains('is-highlighted')).toBe(true)
    b.container.remove()
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
    await openFeed(b)
    await settle()

    expect(b.chatInner.querySelectorAll('.is-first-unread')).toHaveLength(1)
    expect(b.getBubble(makeFullMid(CHAT, 13))!.classList.contains('is-first-unread')).toBe(true)
  })

  it('исходящие в кандидаты не идут', async () => {
    const managers = pagingManagers({
      first: {
        // Исходящее — это `fromId === rootScope.myId` (порт `Chat.isOurMessage`,
        // chat.ts:1379): чат не мегагруппа, и сырой `pFlags.out` сторону здесь
        // не решает — как и в оригинале.
        messages: [msg(11), msg(12), msg(13, { fromId: 999, out: true }), msg(14), msg(15)],
        count: 5, reachedTop: true, reachedBottom: true,
      },
    })
    managers.getReadMaxSeqIfUnread.mockResolvedValue(12)
    managers.getHistoryMaxSeq.mockResolvedValue(15)

    const { b } = mount(managers)
    await openFeed(b)
    await settle()

    expect(b.getBubble(makeFullMid(CHAT, 13))!.classList.contains('is-first-unread')).toBe(false)
    expect(b.getBubble(makeFullMid(CHAT, 14))!.classList.contains('is-first-unread')).toBe(true)
  })

  it('прочитанный чат черты не получает (горизонт 0)', async () => {
    const managers = pagingManagers({ first: page([11, 12, 13], true, true) })
    const { b } = mount(managers)
    await openFeed(b)
    await settle()

    expect(b.chatInner.querySelectorAll('.is-first-unread')).toHaveLength(0)
  })

  it('перед САМЫМ последним сообщением чата черта не рисуется', async () => {
    const managers = pagingManagers({ first: page([11, 12, 13], true, true) })
    managers.getReadMaxSeqIfUnread.mockResolvedValue(12)
    managers.getHistoryMaxSeq.mockResolvedValue(13)

    const { b } = mount(managers)
    await openFeed(b)
    await settle()

    expect(b.chatInner.querySelectorAll('.is-first-unread')).toHaveLength(0)
  })
})
