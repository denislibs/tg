// TrackingMonkey — обезьянка на шаге кода (tweb components/monkeys/tracking.ts):
// две lottie-анимации в одном контейнере — idle (TwoFactorSetupMonkeyIdle, луп)
// и tracking (TwoFactorSetupMonkeyTracking), глаза следят за вводом.
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
  const idleRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const idleAnim = useRef<AnimationItem | null>(null)
  const trackAnim = useRef<AnimationItem | null>(null)
  const needFrame = useRef(0)

  useEffect(() => {
    let alive = true
    void Promise.all([
      loadLottie(),
      import('../assets/tgs/TwoFactorSetupMonkeyIdle.json'),
      import('../assets/tgs/TwoFactorSetupMonkeyTracking.json'),
    ]).then(([lottie, idleMod, trackMod]) => {
      if (!alive || !idleRef.current || !trackRef.current) return
      idleAnim.current = lottie.loadAnimation({
        container: idleRef.current,
        renderer: 'canvas',
        loop: true,
        autoplay: true,
        animationData: idleMod.default as unknown,
      })
      const track = lottie.loadAnimation({
        container: trackRef.current,
        renderer: 'canvas',
        loop: false,
        autoplay: false,
        animationData: trackMod.default as unknown,
      })
      trackRef.current.style.display = 'none'
      // Пауза на целевом кадре; при возврате в 0 — переключение обратно на idle.
      track.addEventListener('enterFrame', () => {
        const current = track.currentFrame
        const target = needFrame.current
        if ((track.playDirection === 1 && current >= target) || (track.playDirection === -1 && current <= target)) {
          track.setSpeed(1)
          track.pause()
        }
        if (current <= 0 && target === 0 && idleRef.current && trackRef.current) {
          trackRef.current.style.display = 'none'
          idleRef.current.style.display = ''
          idleAnim.current?.play()
        }
      })
      trackAnim.current = track
    })
    return () => {
      alive = false
      idleAnim.current?.destroy()
      trackAnim.current?.destroy()
      idleAnim.current = null
      trackAnim.current = null
    }
  }, [])

  // Единая точка воспроизведения (tweb playAnimation).
  const playTo = (frame: number) => {
    const track = trackAnim.current
    if (!track || frame === needFrame.current) return
    if (frame) {
      // ввод начался — прячем idle, показываем tracking
      idleAnim.current?.stop()
      if (idleRef.current) idleRef.current.style.display = 'none'
      if (trackRef.current) trackRef.current.style.display = ''
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

  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto 8px' }}>
      <div ref={idleRef} style={{ position: 'absolute', inset: 0 }} />
      <div ref={trackRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}
