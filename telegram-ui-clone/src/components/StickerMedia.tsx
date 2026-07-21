// StickerMedia — единый рендер файла стикера (пикер, саджесты, бабл в чате).
// Файл лежит в media: lottie-json (mime application/json) либо статичный
// webp/png. Тип заранее не известен (в списках стикеров есть только media_id),
// поэтому контент грузится fetch'ем и различается по Content-Type; результат
// кэшируется на сессию — повторный маунт (перелистывание категорий пикера,
// скролл ленты) не перекачивает файл.
import { memo, useEffect, useRef, useState } from 'react'
import lottie, { type AnimationItem } from 'lottie-web'
import { mediaContentUrl, primeMediaToken } from '../core/mediaUrl'

export type StickerContent =
  | { kind: 'lottie'; data: unknown }
  | { kind: 'image'; url: string }

const cache = new Map<number, Promise<StickerContent>>()

export function loadStickerContent(mediaId: number): Promise<StickerContent> {
  let p = cache.get(mediaId)
  if (!p) {
    p = (async (): Promise<StickerContent> => {
      await primeMediaToken()
      const res = await fetch(mediaContentUrl(mediaId))
      if (!res.ok) throw new Error(`sticker media ${mediaId}: HTTP ${res.status}`)
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) return { kind: 'lottie', data: await res.json() }
      return { kind: 'image', url: URL.createObjectURL(await res.blob()) }
    })()
    // упавшую загрузку не кэшировать — следующий маунт попробует снова
    p.catch(() => cache.delete(mediaId))
    cache.set(mediaId, p)
  }
  return p
}

// Hover-анимация в пикере: одновременно играет максимум одна (tweb играет
// только стикер под курсором).
let hoverPlaying: AnimationItem | null = null

const StickerMedia = memo(function StickerMedia({
  mediaId,
  width,
  height,
  loop = false,
  autoplay = false,
  playOnHover = false,
}: {
  mediaId: number
  width: number
  height: number
  /** зацикливать lottie (бабл в чате — из настроек; hover в пикере — пока курсор внутри) */
  loop?: boolean
  /** играть сразу (бабл в чате); в пикере — false, первый кадр статично */
  autoplay?: boolean
  /** пикер/саджесты: play() на mouseenter, stop() на mouseleave */
  playOnHover?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)
  const [content, setContent] = useState<StickerContent | null>(null)

  useEffect(() => {
    let alive = true
    loadStickerContent(mediaId).then((c) => { if (alive) setContent(c) }, () => {})
    return () => { alive = false }
  }, [mediaId])

  // lottie монтируется лениво по факту загрузки json; без autoplay показываем
  // первый кадр (goToAndStop), как статичное превью.
  useEffect(() => {
    if (content?.kind !== 'lottie' || !boxRef.current) return
    const anim = lottie.loadAnimation({
      container: boxRef.current,
      renderer: 'canvas',
      loop,
      autoplay,
      animationData: content.data,
    })
    if (!autoplay) anim.goToAndStop(0, true)
    animRef.current = anim
    return () => {
      if (hoverPlaying === anim) hoverPlaying = null
      anim.destroy()
      animRef.current = null
    }
  }, [content, loop, autoplay])

  const hoverProps = playOnHover
    ? {
        onMouseEnter: () => {
          const anim = animRef.current
          if (!anim) return
          if (hoverPlaying && hoverPlaying !== anim) hoverPlaying.stop()
          hoverPlaying = anim
          anim.play()
        },
        onMouseLeave: () => {
          const anim = animRef.current
          if (!anim) return
          if (hoverPlaying === anim) hoverPlaying = null
          anim.stop() // возврат на первый кадр
        },
      }
    : undefined

  return (
    <div ref={boxRef} style={{ width, height, pointerEvents: playOnHover ? 'auto' : 'none' }} {...hoverProps}>
      {content?.kind === 'image' && (
        <img src={content.url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      )}
    </div>
  )
})

export default StickerMedia
