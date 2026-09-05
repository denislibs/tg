// LottieSticker — анимированные иллюстрации-уточки из tweb (public/assets/tgs/*.json,
// те же данные, что играет rlottie в оригинале; здесь — lottie-web/canvas).
// Ассеты подтягиваются лениво, чтобы не раздувать основной бандл: раньше —
// бандл-чанком (`import('../assets/tgs/*.json')`), теперь — с той же статики,
// что и tlottie-точка входа `LottieAnimation` (Этап 0 плана «один движок
// lottie»); движок здесь не менялся, это Этапы 1-3.
import { useEffect, useRef } from 'react'
import { type AnimationItem } from 'lottie-web'
import { loadLottie, loadTgsAsset } from './lottie'

const ASSETS: Record<string, () => Promise<{ default: unknown }>> = {
  UtyanLinks: () => loadTgsAsset('UtyanLinks'),
  UtyanSearch: () => loadTgsAsset('UtyanSearch'),
  Folders_1: () => loadTgsAsset('Folders_1'),
  Folders_2: () => loadTgsAsset('Folders_2'),
  UtyanPasscode: () => loadTgsAsset('UtyanPasscode'),
  UtyanDisappear: () => loadTgsAsset('UtyanDisappear'),
  Key: () => loadTgsAsset('key'),
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
    void Promise.all([loadLottie(), ASSETS[name]()]).then(([lottie, mod]) => {
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
