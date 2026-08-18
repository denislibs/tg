// Оверлей спойлеров сообщения — порт tweb `components/messageSpoilerOverlay`.
// Абсолютная канва поверх текста: прямоугольники слов закрашиваются цветом фона
// и засыпаются частицами, а по клику из закраски вырезается растущий круг —
// текст «проявляется».
//
// Путей ДВА, ровно как в оригинале (`useWorker` = есть ли WebGL2 в OffscreenCanvas):
//   • воркерный — канва уезжает в воркер, компонент только меряет DOM и шлёт
//     геометрию/цвета/команды раскрытия;
//   • legacy — симуляция крутится в главном потоке (`DotRenderer.attachTextSpoilerTarget`),
//     а рисует прямо здесь `draw()`, который зовёт цикл симуляции.
//
// Ниже них третий уровень — чистый CSS (`styles/tweb/_spoiler.scss`: заливка
// `.spoiler` + `opacity: 0` на `.spoiler-text`, раскрытие через `spoilerReveal`).
// Он включается сам, когда оверлея в DOM нет: в Firefox (tweb выключает оверлей
// там же — `bubbles.ts:addMessageSpoilerOverlay`), при выключенных анимациях и
// когда WebGL2 не поднялся НИГДЕ (тогда `readyResult` legacy-пути = false).
import { useEffect, useRef, useState } from 'react'
import { IS_FIREFOX } from '@environment/userAgent'
import callbackify from '@helpers/callbackify'
import { animateValue } from '@helpers/animateValue'
import { animate } from '@helpers/animation'
import { unwrapEasing } from '@helpers/easings'
import { getMiddleware } from '@helpers/middleware'
import type { AnimationItemGroup } from '@components/animationIntersector'
import BluffSpoilerController from '@lib/spoiler/bluffSpoilerController'
import DotRenderer from '@components/dotRenderer'
import { drawImageFromSource } from '@lib/spoiler/drawImageFromSource'
import { animationsEnabled } from '@lib/spoiler/spoilerSupport'
import type { SpoilerOverlayRect } from '@lib/spoiler/spoilerRenderer.worker'
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

// tweb: оверлей живёт в группе анимаций чата
const ANIMATION_GROUP: AnimationItemGroup = 'chat'

/** tweb `bubbles.ts:addMessageSpoilerOverlay` (`if(IS_FIREFOX) return`) + наш кламп по анимациям. */
const canUseMessageSpoilerOverlay = () => !IS_FIREFOX && animationsEnabled()

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
    const overlayElement = overlayRef.current
    const canvas = canvasRef.current
    const messageElement = overlayElement?.parentElement
    if (!overlayElement || !canvas || !messageElement) return

    // раскрытие живёт на `.spoilers-container` (ветки `_spoiler.scss`); без него
    // оверлею некуда сообщать состояние — бабл остаётся на чистом CSS-фолбэке
    const container = overlayElement.closest('.spoilers-container')
    if (!container) {
      setEnabled(false)
      return
    }

    // when supported, the drawing runs inside the spoiler-renderer worker and this
    // component only measures the DOM and pushes geometry/colors/unwraps to it
    const useWorker = BluffSpoilerController.isWorkerSimSupported()

    // второй прогон эффекта (StrictMode) на уже отданной канве — просим новую
    if (useWorker && transferredCanvases.has(canvas)) {
      setCanvasKey((key) => key + 1)
      return
    }

    let disposed = false
    let dpr = window.devicePixelRatio
    let rects: SpoilerOverlayRect[] = []
    let backgroundColor = 'transparent'
    let particleColor = getParticleColor()
    let unwrapping = false
    let unwrapped = false
    let unwrapProgress = 0
    let clickCoordinates: [number, number] | undefined
    let maxDist = 0
    let cancelUnwrapAnimation: (() => void) | undefined
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

    // Настоящий текст (`opacity: 1` под канвой) показываем ТОЛЬКО когда закраска
    // слов подтверждена, — и заново после каждого пересчёта геометрии, который
    // эту закраску сбрасывал.
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

    const onPainted = () => {
      if (disposed || painted) return
      painted = true
      scheduleCanShowText()
      setCanvasVisible(true)
    }

    const onUnavailable = () => {
      if (!disposed) setEnabled(false)
    }

    // --- legacy-путь: рисуем сами, сэмплируя канвас главнопоточной симуляции ---

    const ctx = useWorker ? null : canvas.getContext('2d')
    const offScreenCanvas = useWorker ? undefined : document.createElement('canvas')
    const offScreenCtx = offScreenCanvas?.getContext('2d')
    let sourceCanvas: HTMLCanvasElement | undefined

    const timesDpr = <T extends number[]>(...values: T) => values.map((value) => value * dpr) as T

    const drawSpoilerRects = () => {
      if (!ctx) return

      for (const rect of rects) {
        const x = rect.left
        const y = Math.max(0, rect.top)
        const dw = rect.width
        const dh = rect.height

        ctx.fillStyle = rect.color || backgroundColor
        ctx.fillRect(...timesDpr(x, y, dw, dh))

        if (!sourceCanvas || !offScreenCanvas || !offScreenCtx) continue

        offScreenCtx.clearRect(...timesDpr(x, y, dw, dh))
        if (!clickCoordinates) {
          drawImageFromSource(offScreenCtx, sourceCanvas, ...timesDpr(x, y, dw, dh, x, y, dw, dh))
        } else {
          // частицы «поддуваются» от точки клика
          const scaledProgress = unwrapProgress ** 2 * 0.4
          drawImageFromSource(
            offScreenCtx,
            sourceCanvas,
            ...timesDpr(
              x + (clickCoordinates[0] - x) * scaledProgress,
              y + (clickCoordinates[1] - y) * scaledProgress,
              dw * (1 - scaledProgress),
              dh * (1 - scaledProgress),
              x,
              y,
              dw,
              dh,
            ),
          )
        }

        offScreenCtx.globalCompositeOperation = 'source-atop'
        offScreenCtx.fillStyle = particleColor
        offScreenCtx.fillRect(...timesDpr(x, y, dw, dh))
        offScreenCtx.globalCompositeOperation = 'source-over'

        ctx.drawImage(offScreenCanvas, ...timesDpr(x, y, dw, dh, x, y, dw, dh))
      }
    }

    const drawClippingCircle = () => {
      if (!ctx || !clickCoordinates || !maxDist) return

      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'white'
      ctx.shadowBlur = (maxDist / 3.5) * dpr * unwrapProgress
      ctx.shadowColor = 'white'
      ctx.beginPath()
      ctx.arc(
        ...timesDpr(clickCoordinates[0], clickCoordinates[1], maxDist * unwrapProgress),
        0,
        2 * Math.PI,
      )
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
    }

    const draw = () => {
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawSpoilerRects()
      drawClippingCircle()
    }

    let overlay: NonNullable<ReturnType<typeof DotRenderer.attachTextSpoilerOverlay>>['overlay'] | undefined
    let animation: { paused: boolean } | undefined

    const measure = (overlayRect: DOMRect) => {
      const spans = [...messageElement.querySelectorAll('.spoiler-text')].filter((span) =>
        ownsSpoiler(messageElement, span),
      )
      const measured = spans.flatMap((span) =>
        getCustomDOMRectsForSpoilerSpan(span as HTMLElement, overlayRect),
      )
      rects = adjustSpaceBetweenCloseRects(measured)
    }

    const update = () => {
      const overlayRect = overlayElement.getBoundingClientRect()

      // Бабл может быть под transform (анимация появления в ленте): тогда
      // getBoundingClientRect отдаёт масштабированную геометрию, а ResizeObserver
      // молчит — layout-размер не менялся. `offsetWidth/Height` — округлённый до
      // целого layout-размер, поэтому расхождение больше полпикселя = масштаб.
      // Второе условие — страховка от постоянного transform, которого не дождаться:
      // две одинаковые пробы подряд считаем устоявшейся геометрией.
      // отступление от tweb: там баблы не въезжают со scale, и такой проверки нет.
      const untransformed =
        Math.abs(overlayRect.width - overlayElement.offsetWidth) <= 0.5 &&
        Math.abs(overlayRect.height - overlayElement.offsetHeight) <= 0.5
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
      backgroundColor = computeFinalBackgroundColor(messageElement.parentElement) ?? 'transparent'
      particleColor = getParticleColor()

      if (overlay) {
        // канва отдана воркеру, на странице у неё остаётся дефолтный
        // внутренний размер — отображаемый задаём явно
        canvas.style.width = `${overlayRect.width}px`
        canvas.style.height = `${overlayRect.height}px`

        overlay.update({
          width: Math.round(overlayRect.width * dpr),
          height: Math.round(overlayRect.height * dpr),
          rects,
          // запасной цвет, если у слова не удалось вычислить свой непрозрачный фон
          backgroundColor,
          particleColor,
        })
      } else if (offScreenCanvas) {
        // legacy: размером канвы владеем мы (у воркерного пути он уезжает сообщением)
        offScreenCanvas.width = canvas.width = Math.round(overlayRect.width * dpr)
        offScreenCanvas.height = canvas.height = Math.round(overlayRect.height * dpr)
      }

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

    // --- подключение к рендереру (после `update`/`draw`: обе ветки зовут их сразу) ---

    const middlewareHelper = getMiddleware()

    if (useWorker) {
      transferredCanvases.add(canvas)
      const attached = DotRenderer.attachTextSpoilerOverlay({
        canvas,
        middleware: middlewareHelper.get(),
        animationGroup: ANIMATION_GROUP,
        onPainted,
        onUnavailable,
      })
      if (!attached) {
        middlewareHelper.destroy()
        setEnabled(false)
        return
      }
      overlay = attached.overlay
      animation = attached.animation
      dpr = attached.dpr
    } else {
      const attached = DotRenderer.attachTextSpoilerTarget({
        canvas,
        draw,
        middleware: middlewareHelper.get(),
        animationGroup: ANIMATION_GROUP,
      })
      animation = attached.animation
      dpr = attached.dpr
      sourceCanvas = attached.sourceCanvas
      void callbackify(attached.readyResult, (ok) => {
        if (disposed) return
        // симуляции нет и в главном потоке — уровнем ниже ждёт CSS-фолбэк
        if (!ok) {
          onUnavailable()
          return
        }
        onPainted()
        update()
        draw()
      })
    }

    const clearPainting = () => {
      if (overlay) overlay.clear()
      else ctx?.clearRect(0, 0, canvas.width, canvas.height)
      rects = []
    }

    const returnToInitial = () => {
      window.clearTimeout(unwrapTimeout)
      window.clearTimeout(unwrappedTimeout)
      cancelUnwrapAnimation?.()

      if (unwrapped) {
        overlay?.reset()
        unwrapProgress = 0
        clickCoordinates = undefined
        maxDist = 0
        // цикл симуляции мог встать (цель вне экрана) — дорисовываем вручную
        if (!useWorker && animation?.paused) {
          animate(() => {
            draw()
            return false
          })
        }
      } else {
        overlay?.wrap(WRAP_DURATION)
        if (!useWorker) {
          cancelUnwrapAnimation = animateValue(
            unwrapProgress,
            0,
            WRAP_DURATION,
            (value) => { unwrapProgress = value },
            {
              onEnd: () => {
                clickCoordinates = undefined
                maxDist = 0
              },
            },
          )
        }
      }

      unwrapping = false
      unwrapped = false
      setCanvasVisible(painted)
    }

    const onClick = (event: MouseEvent) => {
      const overlayRect = overlayElement.getBoundingClientRect()
      if (!isMouseCloseToAnySpoilerElement(event.clientX, event.clientY, overlayRect, rects)) return
      if (unwrapping) return

      event.stopImmediatePropagation()
      event.stopPropagation()
      event.preventDefault()

      const coords: [number, number] = [
        event.clientX - overlayRect.left,
        event.clientY - overlayRect.top,
      ]
      maxDist = computeMaxDistToMargin(event.clientX, event.clientY, overlayRect, rects) + 20
      const duration = getTimeForDist(maxDist)
      clickCoordinates = coords

      messageElement.classList.remove('is-hovering-spoiler')
      unwrapping = true
      // воркер повторяет ту же кривую для пикселей; здесь она нужна legacy-пути
      overlay?.unwrap(coords, maxDist, duration)
      if (!useWorker) {
        cancelUnwrapAnimation = animateValue(
          0,
          1,
          duration,
          (value) => { unwrapProgress = value },
          { easing: unwrapEasing },
        )
      }

      unwrapTimeout = window.setTimeout(() => {
        unwrapped = true
        unwrapProgress = 1
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
          overlayElement.getBoundingClientRect(),
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
        clearPainting()
        hideRealText()
        waitResizeToBePainted(entry).then(
          () => { if (!disposed) { update(); draw() } },
          () => { if (!disposed) { update(); draw() } },
        )
      }, RESIZE_DEBOUNCE)
    })
    resizeObserver.observe(overlayElement)

    const unsubscribeTheme = subscribeThemeChange(() => {
      window.setTimeout(() => { if (!disposed) { update(); draw() } }, 200)
    })

    update()

    return () => {
      disposed = true
      cancelUnwrapAnimation?.()
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
      unsubscribeTheme()
      // снимает анимацию из animationIntersector, а та — отпускает рендерер
      middlewareHelper.destroy()
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
