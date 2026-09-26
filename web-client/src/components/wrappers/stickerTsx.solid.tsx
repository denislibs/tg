/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/wrappers/sticker.ts::StickerTsx` (:828-880, 812502980) —
 * Solid-обёртка над `wrapSticker`: свой `div`, поколение на каждую смену стикера,
 * уборка на `onCleanup`.
 *
 * Расширение `.solid.tsx` при отсутствии JSX — по той же причине, что у
 * `checkboxFieldTsx.solid.tsx` (маска рантаймов `shared/solid/fileRuntime.ts`).
 *
 * Расхождения с оригиналом:
 *  1. Отдельный модуль, а не экспорт `wrappers/sticker.ts`: наш `sticker.ts` —
 *     ванильный порт (шапка файла), его зовут императивная лента и React; Solid
 *     живёт рядом, а не внутри.
 *  2. Вход — `mediaId` вместо `sticker: MyDocument`: у `wrapSticker` нет
 *     MTProto-документа (расхождение объявлено в шапке `sticker.ts`).
 *  3. `createMiddleware()` оригинала (`helpers/solid/createMiddleware.ts` —
 *     `getMiddleware()` + `onCleanup(destroy)`) не заводим: оригинал вдобавок сам
 *     вешает второй `onCleanup(() => middleware.destroy())` (:874), так что
 *     хватает `getMiddleware()` и этой одной уборки.
 */
import { createEffect, on, onCleanup, type Ref } from 'solid-js'
import { getMiddleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import wrapSticker, { type WrappedSticker, type WrapStickerOptions } from './sticker'

type StickerTsxExtraOptions = Omit<WrapStickerOptions, 'mediaId' | 'div' | 'width' | 'height' | 'middleware'>

export default function StickerTsx(props: {
  ref?: Ref<HTMLElement>
  mediaId: number
  width: number
  height: number
  autoStyle?: boolean
  class?: string
  extraOptions?: StickerTsxExtraOptions
  onRender?: (media: Awaited<WrappedSticker['render']>) => void
}) {
  const div = document.createElement('div')
  if(props.class) div.classList.add(props.class)

  const middleware = getMiddleware()

  if(props.autoStyle) {
    div.style.width = props.width + 'px'
    div.style.height = props.height + 'px'
    div.style.position = 'relative'
  }

  let lastRender = Promise.resolve()
  createEffect(on(() => props.mediaId, async(mediaId) => {
    await lastRender
    if(mediaId !== props.mediaId) return

    // Каждое поколение умирает со своим middleware: прежний плеер снимается
    // (`onClean` lottieLoader), а новое поколение усыновляет оставшийся DOM
    // нижним слоем (tweb :854-857).
    middleware.clean()

    // Протухшее поколение бросает MIDDLEWARE — ловим, чтобы отказ не порвал
    // последовательную цепочку (следующий прогон ждёт `lastRender`, tweb :859-861).
    lastRender = wrapSticker({
      middleware: middleware.get(),
      ...props.extraOptions,
      width: props.width,
      height: props.height,
      div,
      mediaId,
    }).render.then((media) => {
      if(media) props.onRender?.(media)
    }).catch(noop)
  }))

  onCleanup(() => middleware.destroy())

  if(typeof props.ref === 'function') {
    props.ref(div)
  }

  return div
}
