/** @jsxImportSource solid-js */
// LottieAnimation — единственная точка входа для встроенных lottie-ассетов
// (обезьянки, уточки, иконки папок и т.п.). Порт tweb
// `src/components/lottieAnimation.tsx:1-72`, дословно: контейнер-`div` с
// CSS-переменной `--size`, клик перезапускает анимацию при `restartOnClick`,
// сама загрузка отложена до первого реального маунта при `needRaf`
// (карусели/скрытые табы монтируют DOM раньше, чем узел попадает во
// вьюпорт — как в оригинале, `lottieAnimation.tsx:38-42`).
//
// Ассет — `LottieAssetName`, грузится по URL `assets/tgs/<name>.json`
// (`lottieLoader.makeAssetUrl`, `lib/lottie/lottieLoader.ts:140`, вендорено
// 1:1 из tweb `lottieLoader.ts:154-156`) через `loadAnimationAsAsset`
// (`lottieLoader.ts:142-145`, tweb `lottieLoader.ts:158-161`) — Этап 0 плана
// «один движок lottie» (docs/superpowers/plans/2026-09-05-lottie-single-
// engine.md) перенёс сами json'ки на статику `public/assets/tgs/`, откуда
// этот URL и резолвится.
//
// Расхождение с оригиналом (объявлено): у tweb `lottieLoader` — ОБЯЗАТЕЛЬНЫЙ
// проп, вызывающий берёт его из `useHotReloadGuard()` (DI-реестр менеджеров с
// hot-reload, `@lib/solidjs/hotReloadGuard`) — этого механизма в проекте нет,
// `lottieLoader` у нас всегда импортируется готовым синглтоном (см.
// `StickerMedia.tsx`, `wrappers/sticker.ts`). Поэтому проп сделан
// НЕОБЯЗАТЕЛЬНЫМ и по умолчанию берёт тот же синглтон — вызывающему не нужно
// ничего прокидывать, а тесты по-прежнему могут подменить его инъекцией.
//
// Потребителей на этот компонент пока НЕТ (Этап 0 — только фундамент):
// `PasswordMonkey.tsx`/`LottieSticker.tsx`/`TrackingMonkey.solid.tsx`/
// `MediaHeader.solid.tsx` переезжают на него по одному в Этапах 1-3.
import { type Component, createRenderEffect, mergeProps, onCleanup } from 'solid-js'

import defaultLottieLoader, { type LottieAssetName, type LottieLoader } from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import type { LottieOptions } from '@lib/lottie/lottiePlayer'

const LottieAnimation: Component<{
  /** @default синглтон `@lib/lottie/lottieLoader` — см. докблок файла */
  lottieLoader?: LottieLoader
  class?: string
  name: LottieAssetName
  size?: number
  needRaf?: boolean
  restartOnClick?: boolean
  lottieOptions?: Partial<LottieOptions>
  onPromise?: (promise: Promise<LottiePlayer>) => void
}> = (inProps) => {
  const props = mergeProps({ size: 100, lottieLoader: defaultLottieLoader }, inProps)

  let animationPromise: Promise<LottiePlayer>

  const div = (
    <div
      classList={{
        [props.class as string]: !!props.class,
      }}
      style={{
        '--size': props.size + 'px',
      }}
      onClick={() => {
        if(!props.restartOnClick) return
        void animationPromise?.then((animation) => {
          animation.playOrRestart()
        })
      }}
    />
  ) as HTMLDivElement

  let cleanup = false
  function loadAnimation() {
    if(props.needRaf && !div.isConnected && !cleanup) {
      requestAnimationFrame(loadAnimation)
      return
    }

    animationPromise = props.lottieLoader.loadAnimationAsAsset(
      {
        container: div,
        loop: false,
        autoplay: true,
        width: props.size,
        height: props.size,
        group: 'none',
        ...props.lottieOptions,
      },
      props.name,
    )
    props.onPromise?.(animationPromise)
  }

  createRenderEffect(loadAnimation)

  onCleanup(() => {
    cleanup = true
    void animationPromise?.then((animation) => {
      animation.remove()
    })
  })

  return div
}

export default LottieAnimation
