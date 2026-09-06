// Фабрика оверлея спойлеров — порт tweb `createMessageSpoilerOverlay`
// (`components/messageSpoilerOverlay/index.tsx:467-495`).
//
// Пины здесь — про КОНТРАКТ фабрики, а не про рисование (его держит
// `messageSpoilerOverlay.legacy.test.ts`):
//   • узел строится только там, где спойлеру есть куда раскрываться
//     (`.spoilers-container`, ветки `styles/tweb/_spoiler.scss`);
//   • симуляция получает ЗАДАЧУ — геометрию слов, а не пустой список: без неё
//     канва осталась бы прозрачной, а слова — голыми;
//   • клик уходит в ОВЕРЛЕЙ, а CSS-фолбэк (`lib/spoiler/spoilerReveal.ts`)
//     при живом оверлее молчит — и снова оживает после `dispose()`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MessageEntity } from '@core/models'

const spies = vi.hoisted(() => ({
  attachTextSpoilerOverlay: vi.fn(),
  attachTextSpoilerTarget: vi.fn(),
  attachBluffTextSpoilerTarget: vi.fn(),
}))

/** Задачи, ушедшие в симуляцию: ровно то, что оверлей просит нарисовать. */
const tasks = vi.hoisted(() => ({
  update: [] as { rects: unknown[] }[],
  unwrap: [] as { coords: [number, number], maxDist: number }[],
}))

spies.attachTextSpoilerOverlay.mockImplementation(() => ({
  animation: { paused: false },
  dpr: 1,
  overlay: {
    update: (payload: { rects: unknown[] }) => { tasks.update.push(payload) },
    unwrap: (coords: [number, number], maxDist: number) => { tasks.unwrap.push({ coords, maxDist }) },
    wrap: () => {},
    reset: () => {},
    clear: () => {},
  },
}))
vi.mock('@components/dotRenderer', () => ({ default: spies }))

// Воркерный путь (WebGL2 в OffscreenCanvas есть) — основной в браузере.
vi.mock('@lib/spoiler/spoilerSupport', () => ({
  TEXT_SPOILER_WIDTH: 240,
  TEXT_SPOILER_HEIGHT: 120,
  spoilerSimDpr: () => 1,
  animationsEnabled: () => true,
  isWorkerSimSupported: () => true,
}))

const { createMessageSpoilerOverlay } = await import('./messageSpoilerOverlay')
const { default: wrapRichText } = await import('@lib/richtext/wrapRichText')

const SPOILER: MessageEntity[] = [{ _: 'messageEntitySpoiler', offset: 0, length: 6 }]

const rect = (left: number, top: number, width: number, height: number) => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
}) as DOMRect

/**
 * Тело сообщения со спойлерным словом — ровно та разметка, что у бабла
 * (`bubbles.ts`: `.message.spoilers-container` + `wrapRichText`).
 *
 * Геометрия подставлена руками: happy-dom не считает ни боксы, ни
 * прямоугольники строк, а оверлей без них не смерит ни одного слова.
 */
function mountMessage({ container = true, measurable = true } = {}) {
  const messageElement = document.createElement('div')
  messageElement.className = container ? 'message spoilers-container' : 'message'
  messageElement.append(wrapRichText('secret rest', { entities: SPOILER }))
  document.body.append(messageElement)

  const span = messageElement.querySelector('.spoiler-text') as HTMLElement
  span.getClientRects = (() =>
    measurable ? [rect(10, 4, 60, 18)] : []) as unknown as Element['getClientRects']

  return { messageElement, span }
}

// Бокс оверлея — первый же `update()` фабрики меряет его ДО возврата хендла,
// поэтому геометрию подставляем на прототипе, а не на готовом узле.
// `offsetWidth/Height` рядом с ним — признак «трансформа появления нет».
const OVERLAY_BOX = rect(0, 0, 200, 26)
const isOverlay = (el: HTMLElement) => el.classList.contains('message-spoiler-overlay')
HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
  return isOverlay(this) ? OVERLAY_BOX : rect(0, 0, 0, 0)
}
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  get(this: HTMLElement) { return isOverlay(this) ? OVERLAY_BOX.width : 0 },
  configurable: true,
})
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  get(this: HTMLElement) { return isOverlay(this) ? OVERLAY_BOX.height : 0 },
  configurable: true,
})

/** Собрать оверлей и вставить его так, как это делает лента (tweb :9792). */
function attachOverlay(messageElement: HTMLElement) {
  const handle = createMessageSpoilerOverlay({ messageElement })
  handle && messageElement.append(handle.element)
  return handle
}

beforeEach(() => {
  tasks.update.length = 0
  tasks.unwrap.length = 0
  spies.attachTextSpoilerOverlay.mockClear()
  document.body.replaceChildren()
})

describe('createMessageSpoilerOverlay', () => {
  it('без `.spoilers-container` оверлея не будет — сообщение остаётся на CSS-фолбэке', () => {
    const { messageElement } = mountMessage({ container: false })

    expect(createMessageSpoilerOverlay({ messageElement })).toBeUndefined()
    expect(spies.attachTextSpoilerOverlay).not.toHaveBeenCalled()
  })

  it('строит узел оверлея с канвой — разметка tweb (index.tsx:469, :155-161)', () => {
    const { messageElement } = mountMessage()

    const handle = attachOverlay(messageElement)!

    expect(handle.element.classList.contains('message-spoiler-overlay')).toBe(true)
    expect(handle.element.querySelector('canvas.message-spoiler-overlay__canvas')).not.toBeNull()
    expect(messageElement.querySelector('.message-spoiler-overlay')).toBe(handle.element)
  })

  it('отдаёт симуляции прямоугольники слов, а не пустой список', () => {
    const { messageElement } = mountMessage()

    attachOverlay(messageElement)

    expect(spies.attachTextSpoilerOverlay).toHaveBeenCalledTimes(1)
    const last = tasks.update[tasks.update.length - 1]
    expect(last).toBeDefined()
    expect(last!.rects).toEqual([{ left: 10, top: 4, width: 61, height: 19 }])
  })

  it('клик по слову раскрывает спойлер оверлеем, а не CSS-фолбэком', () => {
    const { messageElement, span } = mountMessage()

    attachOverlay(messageElement)
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 10 }))

    // задача раскрытия ушла в симуляцию — частицы разлетаются от точки клика
    expect(tasks.unwrap).toHaveLength(1)
    expect(tasks.unwrap[0].coords).toEqual([20, 10])
    expect(tasks.unwrap[0].maxDist).toBeGreaterThan(0)
    // CSS-путь при живом оверлее молчит (`spoilerReveal.ts`)
    expect(messageElement.classList.contains('is-spoiler-visible')).toBe(false)
  })

  // Гонка, ради которой в `spoilerReveal.ts` стоит проверка на живой оверлей:
  // бабл уже в ленте, оверлей уже в DOM, а слова ещё не смерены — клик проходит
  // мимо обработчика оверлея. Сработай тут CSS-раскрытие, оно ободрало бы
  // заливку под ещё не нарисованными частицами.
  it('оверлей есть, слова ещё не смерены — CSS-фолбэк молчит', () => {
    const { messageElement, span } = mountMessage({ measurable: false })

    attachOverlay(messageElement)
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 10 }))

    expect(tasks.unwrap).toHaveLength(0)
    expect(messageElement.classList.contains('is-spoiler-visible')).toBe(false)
  })

  it('`dispose()` снимает узел и возвращает сообщение на CSS-фолбэк', () => {
    const { messageElement, span } = mountMessage()

    const handle = attachOverlay(messageElement)!
    handle.dispose()

    expect(messageElement.querySelector('.message-spoiler-overlay')).toBeNull()

    span.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 10 }))
    // слушатель оверлея снят — клик снова доходит до `onSpoilerClick`
    expect(tasks.unwrap).toHaveLength(0)
    expect(messageElement.classList.contains('is-spoiler-visible')).toBe(true)
  })
})
