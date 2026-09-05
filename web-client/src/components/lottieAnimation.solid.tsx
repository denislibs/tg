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
// Расхождение с оригиналом (объявлено, проверено по исходникам tweb): проп
// `lottieLoader` у оригинала формально обязателен, но мажоритарный приём —
// импорт готового синглтона прямо на месте вызова: семь из восьми прямых
// потребителей `LottieAnimation` делают `import lottieLoader from
// '@lib/lottie/lottieLoader'` и передают его явным пропом (`mediaHeader.
// tsx:70`, `chat/bubbles/suggestBirthday.tsx:23`, `chat/bubbles/premiumGift.
// tsx:39`, `popups/birthday.tsx:225`, `popups/sendGift.tsx:135`, `popups/
// emailSetup.tsx:107,219`, `stories/profileList.tsx:674`) — ровно как у нас в
// `StickerMedia.tsx`/`wrappers/sticker.ts`. Через `useHotReloadGuard()`
// (DI-реестр менеджеров с hot-reload, `@lib/solidjs/hotReloadGuard`) его берёт
// только один частный враппер, `settingsTabLottieAnimation.tsx:15`, и то
// попутно — там же достаётся `usePromiseCollector`, а не потому, что прямой
// импорт синглтона недоступен. У нас `useHotReloadGuard()` нет вовсе, поэтому
// проп сделан НЕОБЯЗАТЕЛЬНЫМ и по умолчанию берёт тот же синглтон, что и
// мажоритарный приём оригинала — вызывающему не нужно ничего прокидывать, а
// тесты по-прежнему могут подменить его инъекцией.
//
// Потребитель — `MediaHeader.solid.tsx::Sticker` (Этап 2 плана, слот `name`).
// `LottieSticker.tsx` на него НЕ переезжал и не переедет: это React-компонент
// (не Solid-остров, см. его собственный докблок), он зовёт
// `lottieLoader.loadAnimationAsAsset` напрямую — тем же приёмом, что и обе
// обезьянки (`PasswordMonkey.tsx`/`TrackingMonkey.solid.tsx`), у которых
// оригиналы (`monkeys/{password,tracking}.ts`) тоже ходят в
// `lottieLoader.loadAnimationAsAsset` напрямую, минуя `lottieAnimation.tsx`.
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
    // Расхождение с оригиналом (`tweb lottieAnimation.tsx:66-70` — тот же
    // `.then()` без второго аргумента): у нас `loadAnimationAsAsset` умеет
    // РЕДЖЕКТИТЬ (`NO_WASM`, деградация без WASM SIMD — план «один движок
    // lottie», раздел «Решение по деградации без WASM SIMD»), а у tweb
    // такого пути нет вовсе. Без второго аргумента `.then()` при отклонённом
    // `animationPromise` рождает СВОЙ, ничьей стороной не пойманный,
    // отклонённый промис — консьюмерский `onPromise`-катч (см. вызывающих)
    // ловит ИСХОДНЫЙ `animationPromise`, а не этот производный. Пустой
    // обработчик здесь — тот же смысл, что у `onPromise`-катчей вызывающих
    // (`StickerMedia.tsx:282`), но за само размонтирование отвечает компонент.
    void animationPromise?.then(
      (animation) => {
        animation.remove()
      },
      () => {},
    )
  })

  return div
}

export default LottieAnimation
