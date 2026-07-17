// LottieSticker — анимированные иллюстрации-уточки из tweb (public/assets/tgs/*.json,
// те же данные, что играет rlottie в оригинале; здесь — lottie-web/canvas).
// Ассеты подтягиваются лениво, чтобы не раздувать основной бандл.
import { useEffect, useRef } from 'react'
import lottie, { type AnimationItem } from 'lottie-web'

const ASSETS: Record<string, () => Promise<{ default: unknown }>> = {
  UtyanLinks: () => import('../assets/tgs/UtyanLinks.json'),
  UtyanSearch: () => import('../assets/tgs/UtyanSearch.json'),
  Folders_1: () => import('../assets/tgs/Folders_1.json'),
  Folders_2: () => import('../assets/tgs/Folders_2.json'),
  UtyanPasscode: () => import('../assets/tgs/UtyanPasscode.json'),
  UtyanDisappear: () => import('../assets/tgs/UtyanDisappear.json'),
}

export type LottieAssetName = keyof typeof ASSETS

export default function LottieSticker({
  name,
  size = 120,
  loop = false,
}: {
  name: LottieAssetName
  size?: number
  loop?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  useEffect(() => {
    let alive = true
    void ASSETS[name]().then((mod) => {
      if (!alive || !ref.current) return
      animRef.current = lottie.loadAnimation({
        container: ref.current,
        renderer: 'canvas',
        loop,
        autoplay: true,
        animationData: mod.default,
      })
    })
    return () => {
      alive = false
      animRef.current?.destroy()
      animRef.current = null
    }
  }, [name, loop])

  // клик — проиграть ещё раз (как у tweb-плейсхолдеров)
  return (
    <div
      ref={ref}
      style={{ width: size, height: size, margin: '0 auto', cursor: 'pointer' }}
      onClick={() => animRef.current?.goToAndPlay(0)}
    />
  )
}
