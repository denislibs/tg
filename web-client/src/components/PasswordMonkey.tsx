// PasswordMonkey — обезьянка на экранах пароля (tweb components/monkeys/password:
// tgs TwoFactorSetupMonkeyPeek, size 157). Закрывает глаза лапами; когда пароль
// показан «глазком» — подглядывает (кадры 0→16, обратно 16→0, как в tweb).
import { useEffect, useRef } from 'react'
import lottie, { type AnimationItem } from 'lottie-web'

const PEEK_FRAME = 16 // tweb PasswordMonkey: сегмент [0..16] — раскрыть глаза

export default function PasswordMonkey({ peeking, size = 157 }: { peeking: boolean; size?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  useEffect(() => {
    let alive = true
    void import('../assets/tgs/TwoFactorSetupMonkeyPeek.json').then((mod) => {
      if (!alive || !ref.current) return
      const anim = lottie.loadAnimation({
        container: ref.current,
        renderer: 'canvas',
        loop: false,
        autoplay: false,
        animationData: mod.default as unknown,
      })
      anim.goToAndStop(0, true)
      animRef.current = anim
    })
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

  return <div ref={ref} style={{ width: size, height: size, margin: '0 auto' }} />
}
