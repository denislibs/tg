/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/emptyPlaceholder.tsx` (812502980) — заглушка
 * «ничего не найдено» селектора пиров: утка UtyanSearch 140px, заголовок и
 * подпись; `hide` прячет её классом, не снимая узел
 * (`div.selector-empty-placeholder[.hide][.is-full]`, стили —
 * `styles/tweb/_selector.scss`). Потребитель —
 * `AppSelectPeers.processPlaceholderOnResults` (`appSelectPeers.solid.tsx`).
 *
 * Расхождение: стикер строит `lottieLoader.loadAnimationAsAsset` +
 * `waitForFirstFrame` напрямую, а не `wrapLocalSticker` (tweb
 * `wrappers/localSticker.ts:37-50`) — у нас этой обёртки нет, а её ветка
 * `assetName` — ровно эти два вызова на контейнере `div.media-sticker-wrapper`.
 */
import { createRoot, type Accessor, type JSX } from 'solid-js'
import type { Middleware } from '@helpers/middleware'
import lottieLoader, { type LottieAssetName } from '@lib/lottie/lottieLoader'

export default async function emptyPlaceholder({
  middleware,
  title,
  description,
  hide,
  assetName = 'UtyanSearch',
  width = 140,
  height = 140,
  isFullSize,
}: {
  middleware: Middleware,
  title: Accessor<JSX.Element>,
  description: Accessor<JSX.Element>,
  hide: Accessor<boolean>,
  assetName?: LottieAssetName,
  width?: number,
  height?: number,
  isFullSize?: boolean
}) {
  // `wrapLocalSticker({assetName, loop: true})` — см. шапку
  const container = document.createElement('div')
  container.classList.add('media-sticker-wrapper')
  const promise = lottieLoader.loadAnimationAsAsset({
    container,
    loop: true,
    autoplay: true,
    width,
    height,
    noCache: true,
    middleware,
  }, assetName).then((animation) => lottieLoader.waitForFirstFrame(animation))

  if(!middleware()) {
    return
  }

  await promise
  if(!middleware()) {
    return
  }

  container.classList.add('selector-empty-placeholder-sticker')

  let ret!: JSX.Element
  createRoot((disposer) => {
    middleware.onClean(disposer)
    ret = (
      <div class="selector-empty-placeholder" classList={{ 'hide': hide(), 'is-full': isFullSize }}>
        {container}
        <div class="selector-empty-placeholder-title">
          {title()}
        </div>
        {description() && (
          <div class="selector-empty-placeholder-description">
            {description()}
          </div>
        )}
      </div>
    )
  })

  return ret as HTMLElement
}
