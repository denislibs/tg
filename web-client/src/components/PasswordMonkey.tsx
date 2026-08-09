// PasswordMonkey — обезьянка на экранах пароля (порт tweb
// `components/monkeys/password.ts`): одна lottie TwoFactorSetupMonkeyPeek в
// контейнере `div.media-sticker-wrapper`, канва — `canvas.lottie` с атрибутами
// size × devicePixelRatio. Закрывает глаза лапами; когда пароль показан
// «глазком» — подглядывает (кадры 0→16, обратно 16→0, как в tweb).
import { useEffect, useRef } from 'react'
import { type AnimationItem } from 'lottie-web'
import { loadLottie } from './lottie'

const PEEK_FRAME = 16 // tweb PasswordMonkey: сегмент [0..16] — раскрыть глаза

export default function PasswordMonkey({ peeking, size = 130 }: { peeking: boolean; size?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  useEffect(() => {
    let alive = true
    const container = wrapRef.current
    if (!container) return
    void Promise.all([loadLottie(), import('../assets/tgs/TwoFactorSetupMonkeyPeek.json')]).then(
      ([lottie, mod]) => {
        if (!alive) return
        const anim = lottie.loadAnimation({
          container,
          renderer: 'canvas',
          loop: false,
          autoplay: false,
          animationData: mod.default as unknown,
          rendererSettings: { className: 'lottie', dpr: window.devicePixelRatio || 1 },
        })
        anim.goToAndStop(0, true)
        animRef.current = anim
      },
    )
    return () => {
      alive = false
      animRef.current?.destroy()
      animRef.current = null
    }
  }, [])

  const first = useRef(true)
  useEffect(() => {
    const anim = animRef.current
    if (!anim) return
    if (first.current && !peeking) return // стартовое состояние — глаза закрыты
    first.current = false
    anim.playSegments(peeking ? [0, PEEK_FRAME] : [PEEK_FRAME, 0], true)
  }, [peeking])

  // Размер задаём явно: lottie-web считает атрибуты канвы от offsetWidth хоста,
  // а хост внутри flex-центрированного `._sticker` иначе схлопнулся бы в ноль.
  // отступление от tweb: `margin: 0 auto` — обезьянку зовут ещё два экрана
  // (пасскод, 2FA в настройках), где центрировать её больше некому.
  return (
    <div
      ref={wrapRef}
      className="media-sticker-wrapper"
      style={{ width: size, height: size, margin: '0 auto' }}
    />
  )
}
