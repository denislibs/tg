/**
 * Свайп-ответ и даблклик-ответ — порт tweb `ChatBubbles`:
 *   • `createReplySwipeController` (bubbles.ts:1586-1706) — визуальный
 *     контроллер жеста: сдвиг бабла и групповой аватарки, проявляющаяся иконка
 *     `reply_filled`, вход в reply по достижении порога;
 *   • привязка тач-жеста к контейнеру ленты (bubbles.ts:1543-1572);
 *   • даблклик-ответ (bubbles.ts:1497-1542) — здесь только ПРЕДИКАТ
 *     («этот даблклик должен стать ответом?»), потому что сам обработчик в
 *     tweb висит на контейнере в `bubbles.ts`.
 *
 * Живёт отдельным модулем, а не внутри нашего `bubbles.ts`, ровно по границе
 * оригинала: в tweb это самостоятельный замкнутый контроллер, который в
 * форке переиспользуют ДВА разных источника жеста (тач и трекпад).
 *
 * Чего здесь нет и почему (все три — предмет отдельной работы, не «упрощение»):
 *   • `attachReplyWheelSwipe` (tweb bubbles.ts:1713+) — трекпадный wheel-свайп.
 *     Это форк-специфика нашего локального tweb, а не оригинальный Telegram Web K
 *     (прямое предупреждение в шапке `docs/tweb/message-interactions.md`),
 *     поэтому не портируется. Вместе с ним не переносится и возврат `MAX` из
 *     контроллера — в tweb его читает ровно этот путь.
 *   • `cancelContextMenuOpening()` в `move` (bubbles.ts:1655) — гасит
 *     всплывающее по long-press контекстное меню, когда палец поехал.
 *     `contextMenuController` в проекте сейчас портируется отдельно; когда он
 *     появится, вызов возвращается ровно в помеченное ниже место.
 *   • сам reply-флоу композера (`chat.input.initMessageReply`) — здесь только
 *     узкий порт-интерфейс `ReplyGestureChat`, как `ChatContext`/`BubblesManagers`
 *     в `bubbles.ts`.
 */
import Icon from '@components/icon'
import { setTransition } from '@core/dom/setTransition'
import findUpClassName from '@helpers/dom/findUpClassName'
import getVisibleRect from '@helpers/dom/getVisibleRect'
import handleHorizontalSwipe from '@helpers/dom/handleHorizontalSwipe'
import { fastRaf } from '@helpers/schedulers'

/** tweb bubbles.ts:1587 — класс жеста на бабле и на групповой аватарке. */
const GESTURING_CLASS = 'is-gesturing-reply'
/** tweb bubbles.ts:1588 — предел сдвига бабла, px. */
const MAX = 64
/** tweb bubbles.ts:1589 — порог, после которого отпускание даёт ответ. */
const REPLY_AFTER = MAX * .75
/** tweb bubbles.ts:1621, 1697 — длительность перехода класса жеста, мс. */
const TRANSITION_DURATION = 250

/**
 * Срез `Chat`, который читают оба жеста ответа. Всё, что в tweb —
 * `this.chat.*` внутри `bubbles.ts:1497-1706`.
 */
export interface ReplyGestureChat {
  /** tweb `this.chat.type === ChatType.Pinned` (:1546) — в экране закреплённых
   *  свайп-ответа нет. */
  isPinned?(): boolean
  /** tweb `this.chat.selection.isSelecting` (:1547) — в режиме выделения жест
   *  не начинается. */
  isSelecting?(): boolean
  /** tweb `await this.chat.canSend()` (:1548) — асинхронный, как в оригинале. */
  canSend(): boolean | Promise<boolean>
  /**
   * tweb `this.chat.input.initMessageReply(this.chat.input
   * .getChatInputReplyToFromMessage(message))` (:1699) — вход в reply-флоу
   * композера. В оригинале лента сначала достаёт сообщение по `fullMid` бабла;
   * у нас адрес бабла — `dataset.mid` (`bubbles.ts:866`), а разбор сообщения и
   * построение `ChatInputReplyTo` — дело владельца композера, поэтому сюда
   * едет только `mid`.
   */
  initMessageReply(mid: number): void
}

/** Тач-часть жеста: три колбэка, которые дёргает `handleHorizontalSwipe`. */
export interface ReplySwipeController {
  /** tweb `prepare` (:1600-1616) — валидация цели БЕЗ мутаций DOM. */
  prepare(bubble: HTMLElement): void
  /** tweb `move` (:1637-1657). */
  move(xDiff: number): void
  /** tweb `reset` (:1659-1703). */
  reset(): void
}

/**
 * Порт `createReplySwipeController` (tweb bubbles.ts:1586-1706).
 *
 * Аргумент `container` оригинала не переносится: в теле контроллера он не
 * читается ни разу (проверено по исходнику) — параметр там мёртвый.
 */
export function createReplySwipeController(chat: ReplyGestureChat): ReplySwipeController {
  let shouldReply = false
  // визуальная обвязка наложена — откладывается до первого движения, чтобы
  // тап без движения не оставлял мусора (tweb :1592)
  let started = false
  let target: HTMLElement | undefined
  let icon: HTMLElement | undefined
  let swipeAvatar: HTMLElement | undefined

  // Валидация и разрешение цели вместе с её групповой аватаркой. Мутаций DOM
  // здесь НЕТ: тач-путь зовёт это на touchstart (`verifyTouchTarget`), а тап,
  // который никуда не поехал, не должен оставить ни класса жеста, ни иконки —
  // их накладывает `begin` на первом `move` (tweb :1596-1599).
  const prepare = (bubble: HTMLElement) => {
    target = bubble
    swipeAvatar = undefined
    started = false

    // tweb :1606-1614 обёрнут в try/catch ради `target.parentElement` при
    // выключенном strictNullChecks; у нас за это отвечает `?.` — ловить нечего.
    const avatar = target.parentElement?.querySelector<HTMLElement>('.bubbles-group-avatar')
    if(avatar && getVisibleRect(avatar, target)) {
      swipeAvatar = avatar
    }
  }

  const begin = () => {
    ;[target, swipeAvatar].filter((element): element is HTMLElement => !!element).forEach((element) => {
      setTransition({
        element,
        className: GESTURING_CLASS,
        forwards: true,
        duration: TRANSITION_DURATION,
      })
      void element.offsetLeft // reflow
    })

    if(!icon) {
      icon = Icon('reply_filled', 'bubble-gesture-reply-icon')
    } else {
      // переиспользование после, возможно, прерванного фейда
      icon.classList.remove('is-visible', 'is-hiding')
      icon.style.opacity = ''
    }

    target?.append(icon)
  }

  const move = (xDiff: number) => {
    if(!started) {
      started = true
      begin()
    }

    // `started === true` ⇒ `begin()` отработал ⇒ иконка и цель заданы
    const currentIcon = icon!
    const currentTarget = target!

    shouldReply = xDiff >= REPLY_AFTER

    if(shouldReply && !currentIcon.classList.contains('is-visible')) {
      currentIcon.classList.add('is-visible')
    }
    currentIcon.style.opacity = '' + Math.min(1, xDiff / REPLY_AFTER)

    const x = -Math.max(0, Math.min(MAX, xDiff))
    const transform = `translateX(${x}px)`
    currentTarget.style.transform = transform
    if(swipeAvatar) {
      swipeAvatar.style.transform = transform
    }

    // tweb :1655 `cancelContextMenuOpening()` — вернуть, когда приедет
    // `helpers/contextMenuController` (см. шапку файла).
  }

  const reset = () => {
    if(!started) { // жест кончился без движения — показывать было нечего
      target = swipeAvatar = undefined
      return
    }
    started = false

    const _target = target!
    const _swipeAvatar = swipeAvatar
    const _icon = icon!
    target = swipeAvatar = undefined

    // иконка гаснет за время отъезда бабла, а не пропадает в один кадр
    _icon.classList.add('is-hiding')

    const onTransitionEnd = () => {
      if(_icon.parentElement === _target) {
        _icon.classList.remove('is-visible', 'is-hiding')
        _icon.style.opacity = ''
        _icon.remove()
      }
    }

    ;[_target, _swipeAvatar].filter((element): element is HTMLElement => !!element).forEach((element, idx) => {
      setTransition({
        element,
        className: GESTURING_CLASS,
        forwards: false,
        duration: TRANSITION_DURATION,
        onTransitionEnd: idx === 0 ? onTransitionEnd : undefined,
      })
    })

    fastRaf(() => {
      _target.style.transform = ''
      if(_swipeAvatar) {
        _swipeAvatar.style.transform = ''
      }

      if(shouldReply) {
        // в tweb здесь `this.chat.getMessage(getBubbleFullMid(_target))`; у нас
        // адрес бабла — `dataset.mid` (bubbles.ts:866). Бабл без адреса
        // (дата-бабл, служебное) до сюда не доходит — его отсекает
        // `verifyTouchTarget` по классу `service`; проверка на NaN держит это
        // свойство явно, а не молчаливым `initMessageReply(NaN)`.
        const mid = +_target.dataset.mid!
        if(!isNaN(mid)) {
          chat.initMessageReply(mid)
        }
        shouldReply = false
      }
    })
  }

  return { prepare, move, reset }
}

/**
 * Порт привязки тач-свайпа к контейнеру ленты (tweb bubbles.ts:1543-1572).
 * Гейт `IS_TOUCH_SUPPORTED` остаётся на вызывающей стороне — в tweb он тоже
 * стоит в `bubbles.ts` (:1543 `} else if(IS_TOUCH_SUPPORTED) {`), а не внутри.
 *
 * Возвращает `SwipeHandler`, чтобы владелец ленты снял слушатели на
 * destroy (`handler.removeListeners()`), как tweb хранит `this.replySwipeHandler`.
 */
export function attachReplySwipe(container: HTMLElement, chat: ReplyGestureChat) {
  const controller = createReplySwipeController(chat)
  return handleHorizontalSwipe({
    element: container,
    verifyTouchTarget: async(e) => {
      if(chat.isPinned?.() ||
        chat.isSelecting?.() ||
        !(await chat.canSend())) {
        return false
      }

      const bubble = findUpClassName(e.target, 'bubble')
      if(!bubble ||
        bubble.classList.contains('service') ||
        bubble.classList.contains('is-sending')) {
        return false
      }

      controller.prepare(bubble)
      return true
    },
    onSwipe: (xDiff) => {
      controller.move(xDiff)
    },
    onReset: () => {
      controller.reset()
    },
    listenerOptions: { capture: true },
  })
}

/**
 * Срез состояния, по которому решается даблклик-ответ (tweb bubbles.ts:1499-1538).
 * Всё инжектируется, поэтому предикат остаётся чистым: у него нет ни своего
 * состояния, ни доступа к чату.
 */
export interface DoubleClickReplyContext {
  /** tweb `this.chat.type === ChatType.Pinned || ChatType.Logs` (:1500-1501). */
  isPinnedOrLogs: boolean
  /** tweb `this.chat.selection.isSelecting` (:1502). */
  isSelecting: boolean
  /** tweb `this.chat.input.canSendPlain()` (:1503). */
  canSendPlain: boolean
  /**
   * Отрицание tweb `message.pFlags.is_outgoing || message.peerId !== this.peerId`
   * (:1535-1538): ещё не отправленное сообщение и бабл не из текущего чата
   * ответа не получают. Сообщение принадлежит ленте, поэтому проверка приезжает
   * колбэком, а не читается предикатом.
   */
  isRepliable(bubble: HTMLElement): boolean
  /** tweb `getSelectedText()` (:1526). По умолчанию — выделение документа. */
  getSelectedText?(): string
}

/** tweb bubbles.ts:1511-1521 — по этим предкам даблклик не считается ответом. */
const DOUBLE_CLICK_IGNORED_CLASSES = [
  'attachment',
  'audio',
  'document',
  'contact',
  'time',
  'code-header-button',
  'reaction',
  'bubble-beside-button',
  'poll-message-content',
]

/** Порт tweb `helpers/dom/getSelectedText.ts` в применимой части: ветка
 *  `document.selection` — обвязка под IE (в tweb под `@ts-ignore`), а
 *  `getAppWindow()` — форк-специфика Document-PiP, которой у нас нет. */
function getSelectedText(): string {
  return window.getSelection()?.toString() ?? ''
}

/**
 * «Этот даблклик должен стать ответом?» — порт решающей части обработчика
 * tweb bubbles.ts:1497-1542. Возвращает бабл, на который надо ответить, или
 * `null`. Сам вызов `initMessageReply` (:1539) остаётся за вызывающим: у него
 * есть сообщение бабла.
 */
export function findDoubleClickReplyBubble(
  e: { target: EventTarget | null },
  ctx: DoubleClickReplyContext,
): HTMLElement | null {
  if(ctx.isPinnedOrLogs || ctx.isSelecting || !ctx.canSendPlain) {
    return null
  }

  const target = e.target as HTMLElement | null
  if(!target) {
    return null
  }

  if(DOUBLE_CLICK_IGNORED_CLASSES.some((className) => findUpClassName(target, className))) {
    return null
  }

  // tweb :1523-1525 — сам бабл (пустое место в нём) или обёртка выделения документа
  let bubble = target.classList.contains('bubble') ?
    target :
    (target.classList.contains('document-selection') ? target.parentElement : null)

  const selectedText = ctx.getSelectedText ? ctx.getSelectedText() : getSelectedText()
  if(!bubble && (!selectedText.trim() || /^\s/.test(selectedText))) {
    bubble = findUpClassName(target, 'bubble')
  }

  if(!bubble || bubble.classList.contains('bubble-first')) { // tweb :1534
    return null
  }

  return ctx.isRepliable(bubble) ? bubble : null
}
