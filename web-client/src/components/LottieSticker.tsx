// LottieSticker — иллюстрации-уточки (пустые состояния, папки, ключ,
// пасскод) в React-дереве. Порт tweb-обёрток над `components/lottieAnimation.
// tsx` (`emptySearchPlaceholder/index.tsx:24-30`, `settingsTabLottieAnimation.
// tsx:19-25`, `emptyPlaceholder.tsx` — все три зовут `LottieAnimation` с
// `restartOnClick`): единственный движок — `lib/lottie/lottieLoader`
// (tlottie, WASM-воркер), портированный из tweb `lottieLoader.ts` (Этап 0
// плана «один движок lottie», docs/superpowers/plans/2026-09-05-lottie-
// single-engine.md). Ассет — json со статики `public/assets/tgs/<name>.json`
// (`lottieLoader.makeAssetUrl`), имя — из вендорного `LottieAssetName`.
//
// Solid-компонент `components/lottieAnimation.solid.tsx` — та же точка входа
// для Solid-дерева (её использует `MediaHeader.solid.tsx::Sticker`); здесь та
// же логика вызвана НАПРЯМУЮ (приём — как у `PasswordMonkey.tsx`, Этап 1), а
// не через Solid-остров: все потребители этого файла — мелкие иконки внутри
// React-экранов настроек, а `web-client/CLAUDE.md` держит `<SolidIsland>`
// только для крупных границ (попап/вкладка/экран) — сама уточка ею не
// является.
import { useEffect, useRef } from 'react'
import lottieLoader, { type LottieAssetName } from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'

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
  const animRef = useRef<LottiePlayer | null>(null)

  useEffect(() => {
    let alive = true
    const container = ref.current
    if (!container) return

    // group:'none' — тот же выбор, что у оригинала (`lottieAnimation.tsx:47`):
    // без него autoplay ждёт первую отмашку `animationIntersector`
    // (карусель/скрытые табы), а эти уточки монтируются сразу видимыми.
    //
    // Деградация без WASM SIMD (backlogs/frontend/lottie-no-wasm-fallback.md,
    // часть 2 — закрыта): `loadAnimationAsAsset` бросает `NO_WASM`
    // (`lib/lottie/lottieLoader.ts:216`), канва в DOM не появляется — но сама
    // `loadAnimationAsAsset` вставляет в `container` статичный PNG первого
    // кадра ДО реджекта (`lib/lottie/lottieAssetFallback.ts`), поэтому уточка
    // не пропадает совсем, а перестаёт двигаться.
    const load = lottieLoader
      .loadAnimationAsAsset({ container, loop, autoplay: true, width: size, height: size, group: 'none' }, name)
      .then((animation) => {
        if (!alive) {
          animation.remove()
          return
        }
        animRef.current = animation
      })

    // Реджект (NO_WASM/сеть) гасим ЗДЕСЬ, в одном месте — приём
    // `StickerMedia.tsx:282`, а не россыпью `.catch(() => {})`.
    void load.catch(() => {})

    return () => {
      alive = false
      animRef.current?.remove()
      animRef.current = null
    }
  }, [name, size, loop])

  // клик — проиграть ещё раз (tweb `restartOnClick`, `lottieAnimation.tsx:29-33`)
  return (
    <div
      ref={ref}
      style={{ width: size, height: size, margin: '0 auto', cursor: 'pointer' }}
      onClick={() => animRef.current?.playOrRestart()}
    />
  )
}
