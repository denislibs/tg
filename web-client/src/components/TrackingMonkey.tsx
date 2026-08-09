// TrackingMonkey — обезьянка на шаге кода (порт tweb `components/monkeys/tracking.ts`):
// ДВЕ lottie-анимации в ОДНОМ контейнере `div.media-sticker-wrapper` — idle
// (TwoFactorSetupMonkeyIdle, луп) и tracking (TwoFactorSetupMonkeyTracking);
// неактивная канва прячется `display: none`. Канвы несут класс `lottie`,
// атрибуты — size × devicePixelRatio (у tweb на retina это 260 при CSS 130).
//
// События как в tweb: focus → playAnimation(1), blur → playAnimation(0),
// input → playAnimation((1 + typed) / length * 45); кадр =
// round(min(45, min(len, 30)) * (165/45) + 11.33) — 1-й символ ≈ 15, потолок 121.
// Подыгрывание — play от текущего кадра к целевому (setDirection + pause на
// enterFrame); возврат к 0 — speed 7.
import { useEffect, useRef } from 'react'
import { type AnimationItem } from 'lottie-web'
import { loadLottie } from './lottie'

const MAX = 45
const frameFor = (len: number) => {
  len = Math.min(len, 30)
  return len ? Math.round(Math.min(MAX, len) * (165 / MAX) + 11.33) : 0
}

export default function TrackingMonkey({ typed, length, focused, size = 130 }: {
  /** сколько цифр уже введено */
  typed: number
  /** полная длина кода */
  length: number
  focused: boolean
  size?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const idleAnim = useRef<AnimationItem | null>(null)
  const trackAnim = useRef<AnimationItem | null>(null)
  // канвы, созданные lottie-web внутри общего контейнера (tweb animation.canvas[0])
  const idleCanvas = useRef<HTMLCanvasElement | null>(null)
  const trackCanvas = useRef<HTMLCanvasElement | null>(null)
  const needFrame = useRef(0)

  useEffect(() => {
    let alive = true
    const container = wrapRef.current
    if (!container) return
    // lottie-web сам создаёт канву внутри контейнера; `className` из
    // rendererSettings вешает на неё класс `lottie`, `dpr` даёт атрибуты 2×.
    const settings = {
      className: 'lottie',
      dpr: window.devicePixelRatio || 1,
    }
    void Promise.all([
      loadLottie(),
      import('../assets/tgs/TwoFactorSetupMonkeyIdle.json'),
      import('../assets/tgs/TwoFactorSetupMonkeyTracking.json'),
    ]).then(([lottie, idleMod, trackMod]) => {
      if (!alive) return
      const idle = lottie.loadAnimation({
        container,
        renderer: 'canvas',
        loop: true,
        autoplay: true,
        animationData: idleMod.default as unknown,
        rendererSettings: settings,
      })
      idleAnim.current = idle
      idleCanvas.current = container.querySelector('canvas')

      const track = lottie.loadAnimation({
        container,
        renderer: 'canvas',
        loop: false,
        autoplay: false,
        animationData: trackMod.default as unknown,
        rendererSettings: settings,
      })
      trackAnim.current = track
      trackCanvas.current = container.querySelectorAll('canvas')[1] as HTMLCanvasElement
      if (trackCanvas.current) trackCanvas.current.style.display = 'none'

      // Пауза на целевом кадре; при возврате в 0 — переключение обратно на idle.
      track.addEventListener('enterFrame', () => {
        const current = track.currentFrame
        const target = needFrame.current
        if ((track.playDirection === 1 && current >= target) || (track.playDirection === -1 && current <= target)) {
          track.setSpeed(1)
          track.pause()
        }
        if (current <= 0 && target === 0 && idleCanvas.current && trackCanvas.current) {
          idleCanvas.current.style.display = ''
          idleAnim.current?.play()
          trackCanvas.current.style.display = 'none'
        }
      })
    })
    return () => {
      alive = false
      idleAnim.current?.destroy()
      trackAnim.current?.destroy()
      idleAnim.current = null
      trackAnim.current = null
      idleCanvas.current = null
      trackCanvas.current = null
    }
  }, [])

  // Единая точка воспроизведения (tweb playAnimation).
  const playTo = (frame: number) => {
    const track = trackAnim.current
    if (!track || frame === needFrame.current) return
    if (frame) {
      // ввод начался — прячем idle, показываем tracking
      idleAnim.current?.stop()
      if (idleCanvas.current) idleCanvas.current.style.display = 'none'
      if (trackCanvas.current) trackCanvas.current.style.display = ''
    }
    track.setDirection(needFrame.current > frame ? -1 : 1)
    if (needFrame.current !== 0 && frame === 0) track.setSpeed(7)
    needFrame.current = frame
    track.play()
  }

  // focus → лёгкий взгляд вниз (len 1 ⇒ кадр 15); blur → кадр 0 (idle).
  const prevFocused = useRef(focused)
  useEffect(() => {
    if (prevFocused.current === focused) return
    prevFocused.current = focused
    playTo(frameFor(focused ? 1 : 0))
  }, [focused]) // eslint-disable-line react-hooks/exhaustive-deps

  // ввод: (1 + typed) / length * 45 — как tweb input-listener для code-input.
  const prevTyped = useRef(typed)
  useEffect(() => {
    if (prevTyped.current === typed) return
    prevTyped.current = typed
    playTo(frameFor(((1 + typed) / length) * MAX))
  }, [typed, length]) // eslint-disable-line react-hooks/exhaustive-deps

  // `.media-sticker-wrapper` — тот же контейнер, что у tweb (TrackingMonkey.container).
  // Размер задаём явно: lottie-web считает атрибуты канвы от offsetWidth хоста, а
  // хост внутри flex-центрированного `._sticker` иначе схлопнулся бы в ноль.
  return <div ref={wrapRef} className="media-sticker-wrapper" style={{ width: size, height: size }} />
}
