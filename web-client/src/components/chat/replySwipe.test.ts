// Тесты порта свайп-ответа и даблклик-ответа (tweb bubbles.ts:1497-1706).
// Три уровня: чистый предикат даблклика, визуальный контроллер жеста и его
// привязка к контейнеру через `handleHorizontalSwipe` (сквозной жест мышью —
// `SwipeHandler` в окружении без тача ведёт жест на mousedown/mousemove/mouseup,
// колбэки контроллера при этом ровно те же).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachReplySwipe,
  createReplySwipeController,
  findDoubleClickReplyBubble,
  type DoubleClickReplyContext,
  type ReplyGestureChat,
} from './replySwipe'

// happy-dom не даёт задать clientX/clientY через конструктор — как и в
// `swipeHandler.test.ts`, поля довешиваются вручную.
function makeMouseEvent(type: string, clientX: number, clientY: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  for(const [key, value] of Object.entries({ clientX, clientY, button: 0 })) {
    Object.defineProperty(e, key, { value, configurable: true })
  }
  return e
}

function nextRaf() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

/** Прямоугольники, при которых `getVisibleRect(avatar, bubble)` не отбраковывает
 *  аватарку: в happy-dom все rect'ы нулевые и она считалась бы невидимой. */
function stubRects(element: HTMLElement, rect: { top: number, right: number, bottom: number, left: number }) {
  element.getBoundingClientRect = () => ({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  }) as DOMRect
}

/** Группа как в ленте: `.bubbles-group` с аватаркой и баблом внутри. */
function createGroup(mid = 7) {
  const group = document.createElement('div')
  group.classList.add('bubbles-group')

  const avatar = document.createElement('div')
  avatar.classList.add('bubbles-group-avatar')

  const bubble = document.createElement('div')
  bubble.classList.add('bubble')
  bubble.dataset.mid = '' + mid

  const content = document.createElement('div')
  content.classList.add('bubble-content')
  bubble.append(content)

  group.append(avatar, bubble)
  document.body.append(group)

  stubRects(bubble, { top: 0, right: 300, bottom: 100, left: 0 })
  stubRects(avatar, { top: 60, right: 40, bottom: 100, left: 0 })

  return { group, avatar, bubble, content }
}

function createChat(overrides: Partial<ReplyGestureChat> = {}): ReplyGestureChat & { initMessageReply: ReturnType<typeof vi.fn> } {
  return {
    canSend: () => true,
    initMessageReply: vi.fn(),
    ...overrides,
  } as ReplyGestureChat & { initMessageReply: ReturnType<typeof vi.fn> }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('createReplySwipeController — визуал жеста (tweb bubbles.ts:1586-1706)', () => {
  it('тап без движения не оставляет ни класса жеста, ни иконки (:1592, :1660)', () => {
    const { bubble } = createGroup()
    const controller = createReplySwipeController(createChat())

    controller.prepare(bubble)
    controller.reset()

    expect(bubble.classList.contains('is-gesturing-reply')).toBe(false)
    expect(bubble.querySelector('.bubble-gesture-reply-icon')).toBeNull()
  })

  it('первое движение вешает is-gesturing-reply на бабл и аватарку и вставляет иконку (:1618-1635)', () => {
    const { bubble, avatar } = createGroup()
    const controller = createReplySwipeController(createChat())

    controller.prepare(bubble)
    controller.move(10)

    expect(bubble.classList.contains('is-gesturing-reply')).toBe(true)
    expect(avatar.classList.contains('is-gesturing-reply')).toBe(true)

    const icon = bubble.querySelector('.bubble-gesture-reply-icon')
    expect(icon).not.toBeNull()
    // иконка — прямой ребёнок бабла, а не `.bubble-content` (tweb :1634 с
    // закомментированным `.querySelector('.bubble-content')`)
    expect(icon!.parentElement).toBe(bubble)
    expect(icon!.classList.contains('tgico')).toBe(true)
  })

  it('translateX = -min(64, xDiff) и тот же transform у аватарки (:1651-1656)', () => {
    const { bubble, avatar } = createGroup()
    const controller = createReplySwipeController(createChat())

    controller.prepare(bubble)

    controller.move(30)
    expect(bubble.style.transform).toBe('translateX(-30px)')
    expect(avatar.style.transform).toBe('translateX(-30px)')

    controller.move(100) // за MAX — упирается в 64
    expect(bubble.style.transform).toBe('translateX(-64px)')
    expect(avatar.style.transform).toBe('translateX(-64px)')
  })

  it('opacity иконки = xDiff/48, is-visible — только с порога (:1645-1650)', () => {
    const { bubble } = createGroup()
    const controller = createReplySwipeController(createChat())

    controller.prepare(bubble)

    controller.move(24)
    const icon = bubble.querySelector<HTMLElement>('.bubble-gesture-reply-icon')!
    expect(icon.style.opacity).toBe('0.5')
    expect(icon.classList.contains('is-visible')).toBe(false)

    controller.move(47) // порог ещё не взят
    expect(icon.classList.contains('is-visible')).toBe(false)

    controller.move(48)
    expect(icon.classList.contains('is-visible')).toBe(true)
    expect(icon.style.opacity).toBe('1')

    controller.move(100) // opacity не растёт выше единицы
    expect(icon.style.opacity).toBe('1')
  })

  it('отпускание не дойдя до 48 — ответа нет (:1697-1701)', async() => {
    const { bubble } = createGroup()
    const chat = createChat()
    const controller = createReplySwipeController(chat)

    controller.prepare(bubble)
    controller.move(47)
    controller.reset()
    await nextRaf()

    expect(chat.initMessageReply).not.toHaveBeenCalled()
  })

  it('отпускание с порога — ответ на mid бабла (:1697-1701)', async() => {
    const { bubble } = createGroup(42)
    const chat = createChat()
    const controller = createReplySwipeController(chat)

    controller.prepare(bubble)
    controller.move(48)
    controller.reset()
    await nextRaf()

    expect(chat.initMessageReply).toHaveBeenCalledWith(42)
  })

  it('порог сбрасывается: жест, откатившийся ниже 48, ответа не даёт (:1643)', async() => {
    const { bubble } = createGroup()
    const chat = createChat()
    const controller = createReplySwipeController(chat)

    controller.prepare(bubble)
    controller.move(60)
    controller.move(20) // палец поехал обратно
    controller.reset()
    await nextRaf()

    expect(chat.initMessageReply).not.toHaveBeenCalled()
  })

  it('reset гасит иконку через is-hiding, снимает transform и убирает иконку по концу перехода (:1671-1695)', async() => {
    const { bubble, avatar } = createGroup()
    const controller = createReplySwipeController(createChat())

    controller.prepare(bubble)
    controller.move(60)

    const icon = bubble.querySelector<HTMLElement>('.bubble-gesture-reply-icon')!
    controller.reset()

    expect(icon.classList.contains('is-hiding')).toBe(true)
    expect(bubble.classList.contains('backwards')).toBe(true)

    await nextRaf()
    expect(bubble.style.transform).toBe('')
    expect(avatar.style.transform).toBe('')

    await new Promise((resolve) => setTimeout(resolve, 300)) // 250 мс перехода
    expect(bubble.querySelector('.bubble-gesture-reply-icon')).toBeNull()
    expect(bubble.classList.contains('is-gesturing-reply')).toBe(false)
    expect(avatar.classList.contains('is-gesturing-reply')).toBe(false)
  })

  it('иконка переиспользуется следующим жестом без остатков предыдущего (:1629-1632)', async() => {
    const { bubble } = createGroup()
    const controller = createReplySwipeController(createChat())

    controller.prepare(bubble)
    controller.move(60)
    controller.reset()
    await nextRaf()

    controller.prepare(bubble)
    controller.move(10)
    const icon = bubble.querySelector<HTMLElement>('.bubble-gesture-reply-icon')!
    expect(icon.classList.contains('is-hiding')).toBe(false)
    expect(icon.classList.contains('is-visible')).toBe(false)
  })
})

describe('attachReplySwipe — привязка к контейнеру (tweb bubbles.ts:1543-1572)', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    container.classList.add('bubbles')
    document.body.append(container)
  })

  /** Сквозной жест: нажали на `target` в точке `from`, увели влево на `distance`, отпустили. */
  async function swipeLeft(target: HTMLElement, distance: number) {
    target.dispatchEvent(makeMouseEvent('mousedown', 200, 100))
    await Promise.resolve() // handleStart асинхронный (verifyTouchTarget)
    await Promise.resolve()
    document.dispatchEvent(makeMouseEvent('mousemove', 200 - distance, 100))
    document.dispatchEvent(makeMouseEvent('mouseup', 200 - distance, 100))
    await nextRaf()
  }

  it('свайп не дойдя до 48 — ответа нет', async() => {
    const { group, bubble, content } = createGroup(11)
    container.append(group)
    const chat = createChat()
    const handler = attachReplySwipe(container, chat)

    await swipeLeft(content, 47)

    expect(chat.initMessageReply).not.toHaveBeenCalled()
    expect(bubble.style.transform).toBe('')
    handler.removeListeners()
  })

  it('свайп за 48 — ответ на mid бабла', async() => {
    const { group, content } = createGroup(11)
    container.append(group)
    const chat = createChat()
    const handler = attachReplySwipe(container, chat)

    await swipeLeft(content, 50)

    expect(chat.initMessageReply).toHaveBeenCalledWith(11)
    handler.removeListeners()
  })

  it('в режиме выделения жест не начинается (:1547)', async() => {
    const { group, bubble, content } = createGroup()
    container.append(group)
    const chat = createChat({ isSelecting: () => true })
    const handler = attachReplySwipe(container, chat)

    await swipeLeft(content, 60)

    expect(chat.initMessageReply).not.toHaveBeenCalled()
    expect(bubble.classList.contains('is-gesturing-reply')).toBe(false)
    handler.removeListeners()
  })

  it('в закреплённых жест не начинается (:1546)', async() => {
    const { group, bubble, content } = createGroup()
    container.append(group)
    const chat = createChat({ isPinned: () => true })
    const handler = attachReplySwipe(container, chat)

    await swipeLeft(content, 60)

    expect(chat.initMessageReply).not.toHaveBeenCalled()
    expect(bubble.classList.contains('is-gesturing-reply')).toBe(false)
    handler.removeListeners()
  })

  it('без права писать жест не начинается (:1548, canSend асинхронный)', async() => {
    const { group, bubble, content } = createGroup()
    container.append(group)
    const chat = createChat({ canSend: () => Promise.resolve(false) })
    const handler = attachReplySwipe(container, chat)

    await swipeLeft(content, 60)

    expect(chat.initMessageReply).not.toHaveBeenCalled()
    expect(bubble.classList.contains('is-gesturing-reply')).toBe(false)
    handler.removeListeners()
  })

  it('служебный бабл жест не получает (:1552-1557)', async() => {
    const { group, bubble, content } = createGroup()
    bubble.classList.add('service')
    container.append(group)
    const chat = createChat()
    const handler = attachReplySwipe(container, chat)

    await swipeLeft(content, 60)

    expect(chat.initMessageReply).not.toHaveBeenCalled()
    expect(bubble.classList.contains('is-gesturing-reply')).toBe(false)
    handler.removeListeners()
  })

  it('отправляющийся бабл жест не получает (:1552-1557)', async() => {
    const { group, bubble, content } = createGroup()
    bubble.classList.add('is-sending')
    container.append(group)
    const chat = createChat()
    const handler = attachReplySwipe(container, chat)

    await swipeLeft(content, 60)

    expect(chat.initMessageReply).not.toHaveBeenCalled()
    expect(bubble.classList.contains('is-gesturing-reply')).toBe(false)
    handler.removeListeners()
  })

  it('свайп ВПРАВО ответа не даёт (handleHorizontalSwipe инвертирует дифф)', async() => {
    const { group, content } = createGroup()
    container.append(group)
    const chat = createChat()
    const handler = attachReplySwipe(container, chat)

    content.dispatchEvent(makeMouseEvent('mousedown', 100, 100))
    await Promise.resolve()
    await Promise.resolve()
    document.dispatchEvent(makeMouseEvent('mousemove', 180, 100)) // вправо → xDiff отрицательный
    document.dispatchEvent(makeMouseEvent('mouseup', 180, 100))
    await nextRaf()

    expect(chat.initMessageReply).not.toHaveBeenCalled()
    handler.removeListeners()
  })

  it('вертикальный увод гасит жест (handleHorizontalSwipe: |yDiff| > 20)', async() => {
    const { group, bubble, content } = createGroup()
    container.append(group)
    const chat = createChat()
    const handler = attachReplySwipe(container, chat)

    content.dispatchEvent(makeMouseEvent('mousedown', 200, 100))
    await Promise.resolve()
    await Promise.resolve()
    document.dispatchEvent(makeMouseEvent('mousemove', 195, 160)) // ось — вертикаль
    document.dispatchEvent(makeMouseEvent('mouseup', 195, 160))
    await nextRaf()

    expect(bubble.classList.contains('is-gesturing-reply')).toBe(false)
    expect(chat.initMessageReply).not.toHaveBeenCalled()
    handler.removeListeners()
  })
})

describe('findDoubleClickReplyBubble — предикат даблклика (tweb bubbles.ts:1497-1542)', () => {
  function createContext(overrides: Partial<DoubleClickReplyContext> = {}): DoubleClickReplyContext {
    return {
      isPinnedOrLogs: false,
      isSelecting: false,
      canSendPlain: true,
      isRepliable: () => true,
      getSelectedText: () => '',
      ...overrides,
    }
  }

  it('клик по пустому месту бабла даёт сам бабл (:1523-1533)', () => {
    const { bubble, content } = createGroup()
    expect(findDoubleClickReplyBubble({ target: content }, createContext())).toBe(bubble)
    expect(findDoubleClickReplyBubble({ target: bubble }, createContext())).toBe(bubble)
  })

  it('в закреплённых/логах, в выделении и без права писать — null (:1499-1504)', () => {
    const { content } = createGroup()
    expect(findDoubleClickReplyBubble({ target: content }, createContext({ isPinnedOrLogs: true }))).toBeNull()
    expect(findDoubleClickReplyBubble({ target: content }, createContext({ isSelecting: true }))).toBeNull()
    expect(findDoubleClickReplyBubble({ target: content }, createContext({ canSendPlain: false }))).toBeNull()
  })

  it.each([
    'attachment',
    'audio',
    'document',
    'contact',
    'time',
    'code-header-button',
    'reaction',
    'bubble-beside-button',
    'poll-message-content',
  ])('клик внутри .%s игнорируется (:1511-1521)', (className) => {
    const { bubble } = createGroup()
    const part = document.createElement('div')
    part.classList.add(className)
    const inner = document.createElement('span')
    part.append(inner)
    bubble.append(part)

    expect(findDoubleClickReplyBubble({ target: inner }, createContext())).toBeNull()
  })

  it('живое выделение текста внутри бабла отменяет ответ, схлопнувшееся — нет (:1526-1531)', () => {
    const { bubble, content } = createGroup()
    const text = document.createElement('span')
    content.append(text)

    expect(findDoubleClickReplyBubble({ target: text }, createContext({ getSelectedText: () => 'выделено' }))).toBeNull()
    // выделение начинается с пробела — считается пустым
    expect(findDoubleClickReplyBubble({ target: text }, createContext({ getSelectedText: () => ' hi' }))).toBe(bubble)
    expect(findDoubleClickReplyBubble({ target: text }, createContext({ getSelectedText: () => '   ' }))).toBe(bubble)
  })

  it('клик по самому баблу отвечает даже при живом выделении (:1523-1524)', () => {
    const { bubble } = createGroup()
    expect(findDoubleClickReplyBubble({ target: bubble }, createContext({ getSelectedText: () => 'выделено' }))).toBe(bubble)
  })

  it('.document-selection поднимается до своего родителя (:1525)', () => {
    const { bubble } = createGroup()
    const selection = document.createElement('div')
    selection.classList.add('document-selection')
    bubble.append(selection)

    // `.document` в предках отбраковал бы клик раньше — здесь его нет
    expect(findDoubleClickReplyBubble({ target: selection }, createContext())).toBe(bubble)
  })

  it('bubble-first ответа не получает (:1534)', () => {
    const { bubble, content } = createGroup()
    bubble.classList.add('bubble-first')
    expect(findDoubleClickReplyBubble({ target: content }, createContext())).toBeNull()
  })

  it('неотправленное/чужое сообщение ответа не получает (:1535-1538)', () => {
    const { content } = createGroup()
    expect(findDoubleClickReplyBubble({ target: content }, createContext({ isRepliable: () => false }))).toBeNull()
  })

  it('клик мимо баблов — null', () => {
    const outside = document.createElement('div')
    document.body.append(outside)
    expect(findDoubleClickReplyBubble({ target: outside }, createContext())).toBeNull()
    expect(findDoubleClickReplyBubble({ target: null }, createContext())).toBeNull()
  })
})
