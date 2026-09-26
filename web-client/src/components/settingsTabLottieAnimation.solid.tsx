/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/settingsTabLottieAnimation.tsx` (812502980, 29
 * строк) — лотти-заставка вкладки настроек (код-пароль, автоудаление, 2FA)
 * поверх `LottieAnimation`: перезапуск по щелчку, загрузка отдаётся коллектору
 * вкладки (`usePromiseCollector`), чтобы вкладка не въезжала без заставки.
 *
 * Отличия от оригинала:
 *  1. `lottieLoader` — синглтон `@lib/lottie/lottieLoader` по умолчанию
 *     `LottieAnimation`, а не `useHotReloadGuard()` (HMR-охранника у нас нет —
 *     то же расхождение в `lottieAnimation.solid.tsx`).
 *  2. Коллектору отдаётся промис с поглощённым отказом: у нас
 *     `loadAnimationAsAsset` умеет отклоняться (`NO_WASM` — деградация без
 *     WASM SIMD, статичный кадр он ставит сам), и отказ в `Promise.all`
 *     коллектора уронил бы открытие вкладки. У tweb отказа нет вовсе.
 *  3. Пропы разворачиваются ДО `class`, а не после (tweb `:23-24`): иначе
 *     переданный `class` перетёр бы класс контейнера модуля. Потребители
 *     tweb `class` не передают, так что разметка у них та же.
 */
import { type Component } from 'solid-js'
import classNames from '@helpers/string/classNames'
import type { LottieAssetName } from '@lib/lottie/lottieLoader'
import LottieAnimationBase from '@components/lottieAnimation.solid'
import styles from '@components/settingsTabLottieAnimation.module.scss'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'

const SettingsTabLottieAnimation: Component<{
  class?: string
  name: LottieAssetName
  size?: number
}> = (props) => {
  const promiseCollector = usePromiseCollector()

  return (
    <LottieAnimationBase
      onPromise={(promise) => promiseCollector.collect(promise.catch(() => {}))}
      restartOnClick
      {...props}
      class={classNames(props.class, styles.Container)}
    />
  )
}

export default SettingsTabLottieAnimation
