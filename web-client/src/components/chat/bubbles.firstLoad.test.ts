// src/components/chat/bubbles.firstLoad.test.ts
//
// ПЕРВОЕ ОТКРЫТИЕ ЧАТА — три механизма, которые в tweb висят на одном событии
// и на одном методе (`ChatBubbles.setPeer`):
//   • спиннер первой загрузки (`ProgressivePreloader`, tweb bubbles.ts:752,
//     :5375-5380, :5393);
//   • «лестница» появления баблов (`animateAsLadder`, :10313-10464; вооружение
//     в `getHistory` :11467/:11540, отложенный запуск :5395-5397);
//   • восстановление позиции между открытиями (`savedPosition`, :5100-5103,
//     :5337-5352, :5437-5438 + `appImManager.saveChatPosition` :2111-2149).
//
// happy-dom не считает layout — здесь та же фейковая геометрия, что в
// `bubbles.scroll.test.ts` (вьюпорт 500px, бабл 100px, позиция по индексу в
// потоке): и `getDistanceToEnd`, и `getViewportSlice` читают ровно эти
// величины, ничего другого о раскладке они не знают.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { clearChatPositions, getChatPosition, saveChatPosition } from '@core/chat/chatPositions'
import { dispatchHeavyAnimationEvent, interruptHeavyAnimation } from '@core/dom/heavyAnimation'
import { useSettingsStore } from '@/settings'
import type { MyMessage } from '@core/models'
import { makeMessage, type MessageFixture } from '@core/messages/testMessage'
import type { HistoryArgs, HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const CHAT = 50
const VIEWPORT_H = 500
const BUBBLE_H = 100

function msg(id: number, over: Partial<MessageFixture> = {}): MyMessage {
  return makeMessage({ id, peerId: CHAT, fromId: 2, text: `m${id}`, createdAt: '2026-08-15T12:00:00Z', ...over })
}

const page = (ids: number[], reachedTop = true, reachedBottom = true, cached?: boolean): HistoryResult => ({
  messages: ids.map((id) => msg(id)),
  count: ids.length,
  reachedTop,
  reachedBottom,
  cached,
})

/** Менеджеры ленты с управляемой историей: первая страница и «старее». */
function managersFor(first: HistoryResult, older = page([], true, false)) {
  const getHistory = vi.fn(async (args: HistoryArgs): Promise<HistoryResult> =>
    (args.addOffset ?? 0) > 0 ? older : first)
  const getAround = vi.fn(async () => ({ messages: [] as MyMessage[], reachedTop: false, reachedBottom: false }))
  // Последнее сообщение чата — им `setPeer` считает `topMessageFullMid`, а
  // через него `isJump`/`haveToScrollToBubble`.
  const getHistoryMaxSeq = vi.fn(async () => first.messages[first.messages.length - 1]?.id ?? 0)
  const managers: BubblesManagers = {
    messages: { getHistory, getAround, messageByDate: vi.fn(async () => null) },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
  }
  return Object.assign(managers, { getHistory, getAround, getHistoryMaxSeq })
}

const rect = (top: number, height: number): DOMRect => ({
  top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top,
  toJSON: () => ({}),
} as DOMRect)

/** Виртуальная раскладка поверх дерева ленты — см. шапку. */
function installFakeLayout(container: HTMLElement) {
  let scrollTop = 0
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = Math.max(0, Math.min(v, container.scrollHeight - container.clientHeight)) },
  })
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => VIEWPORT_H })
  Object.defineProperty(container, 'offsetHeight', { configurable: true, get: () => VIEWPORT_H })
  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => container.querySelectorAll('.bubble').length * BUBBLE_H,
  })
}

// eslint-disable-next-line @typescript-eslint/unbound-method
const originalRect = HTMLElement.prototype.getBoundingClientRect

let feeds: ChatBubbles[] = []
let current: ChatBubbles | undefined

function mount(managers: BubblesManagers, over: Partial<ChatContext> = {}) {
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
  const b = new ChatBubbles(ctx, managers)
  installFakeLayout(b.scrollable.container)
  feeds.push(b)
  current = b
  return b
}

/** Уход из чата: у нас его исполняет смерть инстанса ленты (порт события
 *  tweb `peer_changing` → `appImManager.saveChatPosition`). */
function leaveChat(b: ChatBubbles) {
  b.destroy()
  const idx = feeds.indexOf(b)
  if(idx !== -1) feeds.splice(idx, 1)
  if(current === b) current = undefined
}

/** Открыть окно и дождаться ОТРИСОВКИ — как `Chat.setPeer` (tweb chat.ts:1119-1122). */
async function openFeed(feed: ChatBubbles, options?: { lastMsgId?: number, samePeer?: boolean }) {
  await (await feed.setPeer(options))?.promise
}

async function settle(times = 6) {
  for(let i = 0; i < times; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

const bubblesOf = (b: ChatBubbles) =>
  Array.from(b.chatInner.querySelectorAll<HTMLElement>('.bubble:not(.service)'))

const wrappersOf = (b: ChatBubbles) =>
  bubblesOf(b).map((bubble) => bubble.lastElementChild as HTMLElement)

const spinnerOf = (b: ChatBubbles) => b.container.querySelector('.preloader-container')

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  clearChatPositions()
  interruptHeavyAnimation()
  rootScope.myId = 999
  useSettingsStore.setState({ reduceMotion: false })
  HTMLElement.prototype.getBoundingClientRect = function(this: HTMLElement) {
    const container = current?.scrollable.container
    if(!container) return rect(0, 0)
    if(this === container) return rect(0, VIEWPORT_H)
    if(this.classList.contains('bubble')) {
      const all = Array.from(container.querySelectorAll('.bubble'))
      const idx = all.indexOf(this)
      if(idx === -1) return rect(0, 0)
      return rect(idx * BUBBLE_H - container.scrollTop, BUBBLE_H)
    }

    return rect(0, 0)
  }
})

afterEach(() => {
  for(const feed of feeds) feed.destroy()
  feeds = []
  current = undefined
  HTMLElement.prototype.getBoundingClientRect = originalRect
  clearChatPositions()
  interruptHeavyAnimation()
})

// ─── спиннер первой загрузки ───────────────────────────────────────────────
//
// Группа гоняется с выключенными анимациями: `SetTransition` тогда применяет
// классы СИНХРОННО (`core/dom/setTransition.ts:127-134`), и «висит ли спиннер»
// становится наблюдаемым фактом, а не гонкой с кадром. Сам гейт спиннера от
// анимаций не зависит.
describe('ChatBubbles — спиннер первой загрузки (порт ProgressivePreloader)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ reduceMotion: true })
  })

  it('пока летит первая страница — спиннер в `.bubbles`, а окна в скролле нет', async () => {
    let release: (() => void) | undefined
    const managers = managersFor(page([1, 2, 3]))
    managers.getHistory.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return page([1, 2, 3])
    })
    const b = mount(managers)

    const setPeerPromise = b.setPeer()
    await vi.waitFor(() => {
      expect(managers.getHistory).toHaveBeenCalled()
    })

    expect(spinnerOf(b)).not.toBeNull()
    // tweb :5378 — старое окно убрано из `Scrollable`, иначе спиннер висел бы
    // поверх чужих баблов.
    expect(b.scrollable.container.querySelector('.bubbles-inner')).toBeNull()

    release?.()
    await (await setPeerPromise)?.promise
  })

  /**
   * Задержать ОТРИСОВКУ страницы, не задерживая ответ: перед
   * `performHistoryResult` лента ждёт `getHeavyAnimationPromise()` (порт tweb
   * bubbles.ts:11491). Так между «ответ пришёл» и «окно отрисовано» появляется
   * наблюдаемый момент — тот самый, в котором и живёт гейт `!cached`.
   */
  function holdRender() {
    void dispatchHeavyAnimationEvent(new Promise<void>(() => {}), 60_000)
    return () => { interruptHeavyAnimation() }
  }

  it('страница ПО СЕТИ: ответ пришёл, окно ещё не отрисовано — спиннер висит', async () => {
    const b = mount(managersFor(page([1, 2, 3])))
    const release = holdRender()

    const setPeerPromise = b.setPeer()
    await settle(2)

    expect(spinnerOf(b)).not.toBeNull()

    release()
    await (await setPeerPromise)?.promise
  })

  it('страница ИЗ КЭША: в тот же момент спиннера уже нет (гейт `!cached`, tweb :5375)', async () => {
    const b = mount(managersFor(page([1, 2, 3], true, true, true)))
    const release = holdRender()

    const setPeerPromise = b.setPeer()
    await settle(2)

    expect(spinnerOf(b)).toBeNull()

    release()
    await (await setPeerPromise)?.promise
  })

  it('окно доехало — спиннер снят', async () => {
    const b = mount(managersFor(page([1, 2, 3])))
    await openFeed(b)

    expect(spinnerOf(b)).toBeNull()
    expect(bubblesOf(b)).toHaveLength(3)
  })

  it('прыжок внутри ОТКРЫТОГО чата (`samePeer`) окна не стирает и спиннера не вешает', async () => {
    const managers = managersFor(page([1, 2, 3]))
    const b = mount(managers)
    await openFeed(b)

    let release: (() => void) | undefined
    managers.getAround.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { messages: [msg(1), msg(2), msg(3)], reachedTop: true, reachedBottom: true }
    })

    // Цель ВНЕ окна — иначе `setPeer` уходит по кэш-ветке и ленту не трогает.
    const jump = b.setPeer({ lastMsgId: 99, samePeer: true })
    await vi.waitFor(() => {
      expect(managers.getAround).toHaveBeenCalled()
    })

    expect(spinnerOf(b)).toBeNull()
    expect(b.scrollable.container.querySelector('.bubbles-inner')).not.toBeNull()

    release?.()
    await (await jump)?.promise
  })
})

// ─── «лестница» появления баблов ───────────────────────────────────────────
describe('ChatBubbles — «лестница» при открытии чата (порт animateAsLadder)', () => {
  it('первое открытие: `zoom-fading` на ленте, `can-zoom-fade` на обёртках баблов', async () => {
    const b = mount(managersFor(page([1, 2, 3])))
    await openFeed(b)

    expect(b.chatInner.classList.contains('zoom-fading')).toBe(true)
    for(const wrapper of wrappersOf(b)) {
      expect(wrapper.classList.contains('can-zoom-fade')).toBe(true)
    }
  })

  it('каскад идёт ОТ нижнего сообщения вверх: 4мс у цели, дальше шаг 40мс', async () => {
    const b = mount(managersFor(page([1, 2, 3])))
    await openFeed(b)

    // tweb :10352-10355 + :10375: цель (`sortedFullMids[0]` — самое нижнее
    // сообщение) едет отдельным списком без сдвига, `(0 || 0.1) * 40`, а
    // остальные вверх со сдвигом на шаг.
    const delays = Object.fromEntries(
      bubblesOf(b).map((bubble) => [bubble.dataset.mid, (bubble.lastElementChild as HTMLElement).style.transitionDelay]),
    )
    expect(delays).toEqual({ 3: '4ms', 2: '40ms', 1: '80ms' })
  })

  it('каскад откладывается до конца `setPeer`: к его старту серии уже в ленте', async () => {
    const b = mount(managersFor(page([1, 2, 3])))

    // tweb :10318-10322 — лестницу зовёт ОЧЕРЕДЬ РЕНДЕРА (:5905), а очередь
    // работает ДО того, как серии смонтированы в `chatInner`
    // (`bubbleGroups.mountUnmountGroups`). Поэтому вызов внутри `setPeer`
    // сохраняет себя в `resolveLadderAnimation` и выполняется позже — из
    // самого `setPeer` (:5395-5397). Без отсрочки каскад навесил бы классы на
    // узлы, которых в дереве ленты ещё нет.
    //
    // Ловим момент постановки `zoom-fading` (первое, что делает каскад) и
    // считаем, сколько баблов к этой секунде уже в ленте. Перехват — на
    // `chatInner`, потому что `setPeer` заводит НОВЫЙ узел ленты.
    let bubblesAtLadderStart: number | undefined
    let inner = b.chatInner
    Object.defineProperty(b, 'chatInner', {
      configurable: true,
      get: () => inner,
      set: (next: HTMLDivElement) => {
        inner = next
        const list = next.classList
        const add = list.add.bind(list)
        list.add = (...tokens: string[]) => {
          if(tokens.includes('zoom-fading')) {
            bubblesAtLadderStart ??= next.querySelectorAll('.bubble:not(.service)').length
          }

          add(...tokens)
        }
      },
    })

    await openFeed(b)

    expect(bubblesAtLadderStart).toBe(3)
  })

  it('по концу каскада служебные классы и задержки сняты', async () => {
    const b = mount(managersFor(page([1, 2, 3])))
    await openFeed(b)

    // Каскад объявлен тяжёлой анимацией на `max(delays) + 300` (tweb :10437-10438):
    // здесь это 80 + 300.
    await settle(20)

    expect(b.chatInner.classList.contains('zoom-fading')).toBe(false)
    for(const wrapper of wrappersOf(b)) {
      expect(wrapper.classList.contains('can-zoom-fade')).toBe(false)
      expect(wrapper.classList.contains('zoom-fade')).toBe(false)
      expect(wrapper.style.transitionDelay).toBe('')
    }
  })

  it('без анимаций лестницы нет вовсе (гейт `liteMode.isAvailable`, tweb :11540)', async () => {
    useSettingsStore.setState({ reduceMotion: true })
    const b = mount(managersFor(page([1, 2, 3])))
    await openFeed(b)

    expect(b.chatInner.classList.contains('zoom-fading')).toBe(false)
    for(const wrapper of wrappersOf(b)) {
      expect(wrapper.classList.contains('can-zoom-fade')).toBe(false)
    }
  })

  it('страница ИЗ КЭША лестницу не запускает (гейт `!cached`, tweb :11467)', async () => {
    const b = mount(managersFor(page([1, 2, 3], true, true, true)))
    await openFeed(b)

    expect(b.chatInner.classList.contains('zoom-fading')).toBe(false)
    for(const wrapper of wrappersOf(b)) {
      expect(wrapper.classList.contains('can-zoom-fade')).toBe(false)
    }
  })

  it('ДОГРУЖЕННАЯ страница лестницы не запускает — она только про ПЕРВУЮ (гейт `isFirstLoad`)', async () => {
    const managers = managersFor(page([11, 12, 13], false, true), page([8, 9, 10], true, false))
    const b = mount(managers)
    await openFeed(b)
    await settle(20) // дать первой лестнице догореть

    b.loadMoreHistory(true)
    await settle(6)

    expect(bubblesOf(b)).toHaveLength(6)
    expect(b.chatInner.classList.contains('zoom-fading')).toBe(false)
    for(const wrapper of wrappersOf(b)) {
      expect(wrapper.classList.contains('can-zoom-fade')).toBe(false)
    }
  })
})

// ─── восстановление позиции между открытиями ───────────────────────────────
//
// Анимации выключены: лестница держала бы шину тяжёлых анимаций, а под ней
// лента не подрезает вьюпорт и не грузит страниц — то есть мешала бы измерять
// ровно то, что здесь проверяется.
describe('ChatBubbles — сохранённая позиция чата (порт savedPosition)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ reduceMotion: true })
  })

  const twelve = () => page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], true, true)

  it('уход из СЕРЕДИНЫ истории запоминает номера окна (по убыванию) и позицию скролла', async () => {
    const b = mount(managersFor(twelve()))
    await openFeed(b)
    await settle(2)

    b.scrollable.container.scrollTop = 300
    leaveChat(b)

    expect(getChatPosition(CHAT)).toEqual({
      mids: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      top: 300,
    })
  })

  it('уход У НИЗА истории ничего не запоминает и СТИРАЕТ прошлую запись (tweb :2144)', async () => {
    saveChatPosition(CHAT, undefined, { mids: [9, 8, 7], top: 999 })

    const b = mount(managersFor(twelve()))
    await openFeed(b)
    await settle(2)

    // `setPeer` уже увёл ленту в самый низ, но туда же её приводит и колесо —
    // важен итог, а не дорога.
    b.scrollable.container.scrollTop = 99999
    leaveChat(b)

    expect(getChatPosition(CHAT)).toBeUndefined()
  })

  it('пустое окно ничего не запоминает', async () => {
    saveChatPosition(CHAT, undefined, { mids: [9, 8, 7], top: 999 })

    const b = mount(managersFor(page([], true, true)))
    await openFeed(b)
    await settle(2)
    leaveChat(b)

    expect(getChatPosition(CHAT)).toBeUndefined()
  })

  it('чат, открытый заново, восстанавливает окно и позицию БЕЗ запроса истории', async () => {
    const first = mount(managersFor(twelve()))
    await openFeed(first)
    await settle(2)
    first.scrollable.container.scrollTop = 300
    leaveChat(first)

    const managers = managersFor(twelve())
    const second = mount(managers)
    await openFeed(second)

    // tweb :5346-5350 — окно собирается из ЗАПОМНЕННЫХ номеров: страницы
    // первого открытия (`offsetId: 0`) никто не просит. Догрузка соседних
    // страниц у восстановленного окна при этом идёт как обычно — границы
    // истории оно не объявляет (`isEnd` в этой ветке нет).
    expect(managers.getHistory.mock.calls.some(([args]) => !args.offsetId)).toBe(false)
    expect(bubblesOf(second).map((el) => el.dataset.mid)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(String),
    )
    // tweb :5437-5438 — и ставится ровно туда, откуда ушли.
    expect(second.scrollable.container.scrollTop).toBe(300)
  })

  it('открытие С ЦЕЛЬЮ сохранённую позицию игнорирует (гейт `!isTarget`, tweb :5101)', async () => {
    saveChatPosition(CHAT, undefined, { mids: [3, 2, 1], top: 250 })

    const managers = managersFor(twelve())
    managers.getAround.mockImplementation(async () => ({
      messages: [msg(5), msg(6), msg(7)],
      reachedTop: false,
      reachedBottom: false,
    }))
    const b = mount(managers)
    await openFeed(b, { lastMsgId: 6 })

    expect(managers.getAround).toHaveBeenCalled()
    expect(bubblesOf(b).map((el) => el.dataset.mid)).toEqual(['5', '6', '7'])
  })

  it('прыжок внутри ОТКРЫТОГО чата сохранённую позицию не читает (гейт `!samePeer`, tweb :5102)', async () => {
    const managers = managersFor(twelve())
    const b = mount(managers)
    await openFeed(b)
    await settle(2)

    // Запись появляется «из ниоткуда» намеренно: проверяется, что кнопка
    // «вниз» (`setMessageId()` без цели) её не подхватит.
    saveChatPosition(CHAT, undefined, { mids: [3, 2, 1], top: 250 })

    await openFeed(b, { samePeer: true })
    await settle(2)

    expect(bubblesOf(b)).toHaveLength(12)
    expect(b.scrollable.container.scrollTop).not.toBe(250)
  })
})
