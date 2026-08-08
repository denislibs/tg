// TrackingMonkey — обезьянка на шаге кода (tweb components/monkeys/tracking.ts):
// две lottie-анимации в одном контейнере — idle (TwoFactorSetupMonkeyIdle, луп)
// и tracking (TwoFactorSetupMonkeyTracking), глаза следят за вводом. progress
// (0..1 = len/length) отображается в кадр ≈ 45..165; подыгрывание — play от
// текущего кадра к целевому (setDirection + pause на enterFrame, как в tweb).
import { useEffect, useRef } from 'react'
import { type AnimationItem } from 'lottie-web'
import { loadLottie } from './lottie'

// tweb tracking.ts: 1-й символ ≈ кадр 45, последний ≈ 165; возврат к 0 — speed 7.
const frameFor = (progress: number) => (progress > 0 ? Math.round(45 + progress * (165 - 45)) : 0)

export default function TrackingMonkey({ progress, size = 130 }: { progress: number; size?: number }) {
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

  useEffect(() => {
    const track = trackAnim.current
    if (!track) return
    const frame = frameFor(progress)
    if (frame === needFrame.current) return
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
  }, [progress])

  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto 8px' }}>
      <div ref={idleRef} style={{ position: 'absolute', inset: 0 }} />
      <div ref={trackRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}
