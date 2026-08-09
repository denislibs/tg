// Оверлей спойлеров сообщения — порт tweb `components/messageSpoilerOverlay`.
// Абсолютная канва поверх текста: воркер закрашивает прямоугольники слов цветом
// фона и сыплет по ним частицы, а по клику вырезает из закраски растущий круг —
// текст «проявляется».
//
// Компонент рендерит RichText рядом со своим текстом (см. RichText.tsx), меряет
// DOM и отдаёт геометрию воркеру; сам ничего не рисует.
//
// Деградация: если оверлей недоступен (нет WebGL2, выключены анимации, воркер
// упал) — компонент не рендерит НИЧЕГО, и спойлер прячет CSS из
// `styles/tweb/_spoiler.scss` (заливка + `opacity: 0` на тексте), раскрытие
// уходит на CSS-путь `spoilerReveal`. Открыться сам спойлер при отказе не может.
import { useEffect, useRef, useState } from 'react'
import {
  attachMessageSpoilerOverlay,
  canUseMessageSpoilerOverlay,
  type MessageSpoilerOverlayHandle,
  type SpoilerOverlayRect,
} from '@lib/spoiler/messageSpoilerOverlayController'
import {
  adjustSpaceBetweenCloseRects,
  computeFinalBackgroundColor,
  computeMaxDistToMargin,
  getCustomDOMRectsForSpoilerSpan,
  getParticleColor,
  getTimeForDist,
  isMouseCloseToAnySpoilerElement,
  waitResizeToBePainted,
} from '@lib/spoiler/messageSpoilerOverlayUtils'

const UNWRAPPED_TIMEOUT_MS = 10e3 // tweb: раскрытый спойлер сам закрывается через 10 c
const WRAP_DURATION = 200
const CAN_SHOW_TEXT_DELAY = 400 // tweb: настоящий текст показываем, когда канва уже легла
const RETRY_MEASURE_DELAY = 3000 // tweb: не смерили прямоугольники — попробовать ещё раз
const RESIZE_DEBOUNCE = 100
const SETTLE_RETRY_DELAY = 120 // бабл под анимацией появления — ждём, пока transform сядет
const SETTLE_MAX_ATTEMPTS = 25

// Канву можно отдать воркеру только один раз. В StrictMode эффект прогоняется на
// том же DOM-узле дважды, поэтому «использованные» канвы помечаем и просим React
// сделать новую (сменой key), а не пытаемся трансферить повторно.
const transferredCanvases = new WeakSet<HTMLCanvasElement>()

// Один MutationObserver на всё приложение вместо одного на бабл: тема меняется
// редко, а оверлеев в ленте десятки.
// отступление от tweb: там это подписка на rootScope-событие `theme_changed`,
// у нас смена темы видна как атрибут/класс на <html>.
const themeListeners = new Set<() => void>()
let themeObserver: MutationObserver | undefined
function subscribeThemeChange(listener: () => void) {
  themeListeners.add(listener)
  themeObserver ??= new MutationObserver(() => themeListeners.forEach((cb) => cb()))
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  })
  return () => {
    themeListeners.delete(listener)
    if (!themeListeners.size) {
      themeObserver?.disconnect()
      themeObserver = undefined
    }
  }
}

/**
 * Прямоугольники слов, которые обслуживает ИМЕННО этот оверлей: спойлеры внутри
 * поддерева, где уже висит другой оверлей, — не наши (иначе два оверлея красили
 * бы одни и те же слова и раскрытие одного оставляло бы закраску второго).
 */
function ownsSpoiler(messageElement: HTMLElement, span: Element) {
  let element = span.parentElement
  while (element) {
    if (element === messageElement) return true
    for (const child of element.children) {
      if (child.classList.contains('message-spoiler-overlay')) return false
    }
    element = element.parentElement
  }
  return false
}

export default function MessageSpoilerOverlay() {
  // доступность решается синхронно — иначе оверлей успел бы мигнуть в DOM
  const [enabled, setEnabled] = useState(canUseMessageSpoilerOverlay)
  const [canvasKey, setCanvasKey] = useState(0)
  const overlayRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const overlay = overlayRef.current
    const canvas = canvasRef.current
    const messageElement = overlay?.parentElement
    if (!overlay || !canvas || !messageElement) return

    // раскрытие живёт на `.spoilers-container` (ветки `_spoiler.scss`); без него
    // оверлею некуда сообщать состояние — бабл остаётся на чистом CSS-фолбэке
    const container = overlay.closest('.spoilers-container')
    if (!container) {
      setEnabled(false)
      return
    }

    // второй прогон эффекта (StrictMode) на уже отданной канве — просим новую
    if (transferredCanvases.has(canvas)) {
      setCanvasKey((key) => key + 1)
      return
    }
    transferredCanvases.add(canvas)

    let disposed = false
    let rects: SpoilerOverlayRect[] = []
    let unwrapping = false
    let unwrapped = false
    let unwrapTimeout: number | undefined
    let unwrappedTimeout: number | undefined
    let retryTimeout: number | undefined
    let resizeTimeout: number | undefined
    let canShowTextTimeout: number | undefined
    let settleTimeout: number | undefined
    let settleAttempts = 0
    let lastSample: [number, number] | undefined
    let painted = false

    const setCanvasVisible = (visible: boolean) => {
      canvas.classList.toggle('message-spoiler-overlay__canvas--hidden', !visible)
    }

    // Настоящий текст (`opacity: 1` под канвой) показываем ТОЛЬКО когда воркер
    // подтвердил, что слова закрашены, — и заново после каждого пересчёта
    // геометрии, который эту закраску сбрасывал.
    const scheduleCanShowText = () => {
      if (!painted || canShowTextTimeout !== undefined) return
      canShowTextTimeout = window.setTimeout(() => {
        canShowTextTimeout = undefined
        if (!disposed && rects.length) container.classList.add('can-show-spoiler-text')
      }, CAN_SHOW_TEXT_DELAY)
    }

    const hideRealText = () => {
      window.clearTimeout(canShowTextTimeout)
      canShowTextTimeout = undefined
      container.classList.remove('can-show-spoiler-text')
    }

    const handle: MessageSpoilerOverlayHandle | null = attachMessageSpoilerOverlay(canvas, {
      onPainted: () => {
        if (disposed || painted) return
        painted = true
        scheduleCanShowText()
        setCanvasVisible(true)
      },
      onUnavailable: () => {
        if (!disposed) setEnabled(false)
      },
    })
    if (!handle) {
      setEnabled(false)
      return
    }

    const measure = (overlayRect = overlay.getBoundingClientRect()) => {
      const spans = [...messageElement.querySelectorAll('.spoiler-text')].filter((span) =>
        ownsSpoiler(messageElement, span),
      )
      const measured = spans.flatMap((span) =>
        getCustomDOMRectsForSpoilerSpan(span as HTMLElement, overlayRect),
      )
      rects = adjustSpaceBetweenCloseRects(measured)
      return overlayRect
    }

    const update = () => {
      const overlayRect = overlay.getBoundingClientRect()

      // Бабл может быть под transform (анимация появления в ленте): тогда
      // getBoundingClientRect отдаёт масштабированную геометрию, а ResizeObserver
      // молчит — layout-размер не менялся. `offsetWidth/Height` — округлённый до
      // целого layout-размер, поэтому расхождение больше полпикселя = масштаб.
      // Второе условие — страховка от постоянного transform, которого не дождаться:
      // две одинаковые пробы подряд считаем устоявшейся геометрией.
      // отступление от tweb: там баблы не въезжают со scale, и такой проверки нет.
      const untransformed =
        Math.abs(overlayRect.width - overlay.offsetWidth) <= 0.5 &&
        Math.abs(overlayRect.height - overlay.offsetHeight) <= 0.5
      const sameAsPrevious =
        !!lastSample &&
        Math.abs(overlayRect.width - lastSample[0]) < 0.01 &&
        Math.abs(overlayRect.height - lastSample[1]) < 0.01
      if (!untransformed && !sameAsPrevious) {
        lastSample = [overlayRect.width, overlayRect.height]
        if (settleAttempts++ < SETTLE_MAX_ATTEMPTS) {
          window.clearTimeout(settleTimeout)
          settleTimeout = window.setTimeout(() => { if (!disposed) update() }, SETTLE_RETRY_DELAY)
        }
        return
      }
      lastSample = undefined
      settleAttempts = 0

      measure(overlayRect)

      // канва отдана воркеру, на странице у неё остаётся дефолтный
      // внутренний размер — отображаемый задаём явно
      canvas.style.width = `${overlayRect.width}px`
      canvas.style.height = `${overlayRect.height}px`

      handle.update({
        width: Math.round(overlayRect.width * handle.dpr),
        height: Math.round(overlayRect.height * handle.dpr),
        rects,
        // запасной цвет, если у слова не удалось вычислить свой непрозрачный фон
        backgroundColor: computeFinalBackgroundColor(messageElement.parentElement) ?? 'transparent',
        particleColor: getParticleColor(),
      })

      if (rects.length) {
        scheduleCanShowText()
      } else {
        hideRealText()
        if (retryTimeout === undefined) {
          retryTimeout = window.setTimeout(() => {
            retryTimeout = undefined
            if (!disposed && !rects.length) update()
          }, RETRY_MEASURE_DELAY)
        }
      }
    }

    const returnToInitial = () => {
      window.clearTimeout(unwrapTimeout)
      window.clearTimeout(unwrappedTimeout)
      if (unwrapped) {
        handle.reset()
      } else {
        handle.wrap(WRAP_DURATION)
      }
      unwrapping = false
      unwrapped = false
      setCanvasVisible(painted)
    }

    const onClick = (event: MouseEvent) => {
      const overlayRect = overlay.getBoundingClientRect()
      if (!isMouseCloseToAnySpoilerElement(event.clientX, event.clientY, overlayRect, rects)) return
      if (unwrapping) return

      event.stopImmediatePropagation()
      event.stopPropagation()
      event.preventDefault()

      const coords: [number, number] = [
        event.clientX - overlayRect.left,
        event.clientY - overlayRect.top,
      ]
      const maxDist = computeMaxDistToMargin(event.clientX, event.clientY, overlayRect, rects) + 20
      const duration = getTimeForDist(maxDist)

      messageElement.classList.remove('is-hovering-spoiler')
      unwrapping = true
      handle.unwrap(coords, maxDist, duration)

      unwrapTimeout = window.setTimeout(() => {
        unwrapped = true
        setCanvasVisible(false) // круг доел закраску — канву можно погасить
        unwrappedTimeout = window.setTimeout(returnToInitial, UNWRAPPED_TIMEOUT_MS)
      }, duration)
    }

    // строки спойлера разделены зазором, поэтому курсор ставим вручную
    const onMouseMove = (event: MouseEvent) => {
      if (unwrapping) return
      messageElement.classList.toggle(
        'is-hovering-spoiler',
        isMouseCloseToAnySpoilerElement(
          event.clientX,
          event.clientY,
          overlay.getBoundingClientRect(),
          rects,
        ),
      )
    }
    const onMouseOut = () => messageElement.classList.remove('is-hovering-spoiler')

    messageElement.addEventListener('click', onClick, true)
    messageElement.addEventListener('mousemove', onMouseMove)
    messageElement.addEventListener('mouseout', onMouseOut)

    let firstResizeCallback = true
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      if (firstResizeCallback) {
        // ResizeObserver всегда дёргает колбэк сразу при observe — этот «резайз»
        // уже отработан вызовом update() ниже, пересчитывать нечего
        firstResizeCallback = false
        return
      }
      window.clearTimeout(resizeTimeout)
      resizeTimeout = window.setTimeout(() => {
        // при сворачивании/разворачивании цитаты размеры едут — гасим закраску,
        // пока не пересчитаем
        handle.clear()
        rects = []
        hideRealText()
        waitResizeToBePainted(entry).then(
          () => { if (!disposed) update() },
          () => { if (!disposed) update() },
        )
      }, RESIZE_DEBOUNCE)
    })
    resizeObserver.observe(overlay)

    // вне экрана симуляция не крутится (в tweb это делает animationIntersector)
    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) handle.play()
        else handle.pause()
      }
    })
    intersectionObserver.observe(canvas)

    const unsubscribeTheme = subscribeThemeChange(() => {
      window.setTimeout(() => { if (!disposed) update() }, 200)
    })

    update()

    return () => {
      disposed = true
      window.clearTimeout(unwrapTimeout)
      window.clearTimeout(unwrappedTimeout)
      window.clearTimeout(retryTimeout)
      window.clearTimeout(resizeTimeout)
      window.clearTimeout(canShowTextTimeout)
      window.clearTimeout(settleTimeout)
      messageElement.removeEventListener('click', onClick, true)
      messageElement.removeEventListener('mousemove', onMouseMove)
      messageElement.removeEventListener('mouseout', onMouseOut)
      messageElement.classList.remove('is-hovering-spoiler')
      container.classList.remove('can-show-spoiler-text')
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      unsubscribeTheme()
      handle.detach()
    }
  }, [canvasKey])

  if (!enabled) return null

  return (
    <div ref={overlayRef} className="message-spoiler-overlay">
      <canvas
        key={canvasKey}
        ref={canvasRef}
        className="message-spoiler-overlay__canvas message-spoiler-overlay__canvas--hidden"
      />
    </div>
  )
}
