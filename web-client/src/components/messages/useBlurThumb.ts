// Канвас-превью медиа в бабле — модель tweb (Task 9 медиа-суперпорта):
// stripped-превью рисуется НЕ background-image, а канвасом из `helpers/blur.ts`
// (порт tweb blur.ts) с классами `media-photo thumbnail canvas-thumbnail` —
// как в tweb wrapPhoto (photo.ts:150,199-201 append в контейнер/аспектер;
// сами классы: `canvas-thumbnail` ставит blur(), `thumbnail` —
// getImageFromStrippedThumb.ts:24, `media-photo` — wrapPhoto).
//
// Канвас — vanilla-узел вне дерева React (blur() создаёт и владеет им, как в
// tweb), поэтому вставляем его императивно prepend'ом в контейнер: превью
// оказывается ПОД полным медиа (оно рендерится позже по DOM), как у tweb, где
// thumb аппендится до самого медиа. React чужой узел не трогает.
import { useLayoutEffect, useRef, type RefObject } from 'react'
import blur from '@helpers/blur'

/**
 * @param blurBase64 stripped-превью (base64 JPEG из payload медиа)
 * @param skip не монтировать превью (полный URL уже известен синхронно —
 *        аналог tweb `cacheContext.downloaded`, getStrippedThumbIfNeeded.ts:23)
 */
export function useBlurThumb(blurBase64: string | undefined, skip = false): RefObject<HTMLDivElement | null> {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // skip читается через ref и НЕ входит в deps: решение «нужно ли превью»
  // принимается один раз на появление blur-данных (как в tweb — на рендер
  // обёртки). Поздний приход полного URL превью не снимает: в tweb thumbnail
  // остаётся в DOM под проявившимся медиа.
  const skipRef = useRef(skip)
  skipRef.current = skip
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !blurBase64 || skipRef.current) return
    const { canvas } = blur(`data:image/jpeg;base64,${blurBase64}`)
    canvas.classList.add('media-photo', 'thumbnail')
    host.prepend(canvas)
    return () => { canvas.remove() }
  }, [blurBase64])
  return hostRef
}
