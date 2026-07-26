// StickerMedia — единый рендер файла стикера (пикер, саджесты, бабл в чате).
// Файл лежит в media: lottie-json (mime application/json) либо статичный
// webp/png. Тип заранее не известен (в списках стикеров есть только media_id),
// поэтому контент грузится fetch'ем и различается по Content-Type; результат
// кэшируется на сессию — повторный маунт (перелистывание категорий пикера,
// скролл ленты) не перекачивает файл.
//
// Анимированные стикеры (lottie) рендерит движок tlottie (SIMD-WASM), портированный
// из tweb 1:1: декод кадров идёт в отдельном воркере, отрисовка — на main-thread
// (этап 1, legacy-режим). См. src/lib/lottie/*.
import { memo, useEffect, useRef, useState } from 'react'
import lottieLoader from '../lib/lottie/lottieLoader'
import type LottiePlayer from '../lib/lottie/lottiePlayer'
import { mediaContentUrl, primeMediaToken } from '../core/mediaUrl'

export type StickerContent =
  | { kind: 'lottie'; data: unknown }
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }

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
      // video/webm (vp9) — видео-стикер (tweb wrapSticker WebM-ветка).
      if (ct.startsWith('video/')) return { kind: 'video', url: URL.createObjectURL(await res.blob()) }
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
let hoverPlaying: LottiePlayer | null = null

const StickerMedia = memo(function StickerMedia({
  mediaId,
  width,
  height,
  loop = false,
  autoplay = false,
  playOnHover = false,
  replayToken = 0,
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
  /** big-emoji: инкремент проигрывает lottie заново с первого кадра (replay по клику) */
  replayToken?: number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<LottiePlayer | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [content, setContent] = useState<StickerContent | null>(null)

  useEffect(() => {
    let alive = true
    loadStickerContent(mediaId).then((c) => { if (alive) setContent(c) }, () => {})
    return () => { alive = false }
  }, [mediaId])

  // lottie монтируется лениво по факту загрузки json: декод в воркере tlottie,
  // отрисовка на <canvas> (плеер сам создаёт и аппендит его в контейнер на первом
  // кадре). group:'none' → плеер самозапускается в onLoad при autoplay; без
  // autoplay в контейнере остаётся статичный первый кадр.
  useEffect(() => {
    if (content?.kind !== 'lottie' || !boxRef.current) return
    const container = boxRef.current
    // Воркер парсит анимацию из Blob (readBlobAsText + JSON.parse); наш бэк отдаёт
    // несжатый JSON, поэтому просто сериализуем разобранные данные обратно в Blob.
    const blob = new Blob([JSON.stringify(content.data)], { type: 'application/json' })
    let alive = true
    let player: LottiePlayer | null = null
    void lottieLoader
      .loadAnimationWorker({
        container,
        animationData: blob,
        loop,
        autoplay,
        width,
        height,
        group: 'none',
        noOffscreen: true, // этап 1: legacy-рендер (декод в воркере, отрисовка на main)
        // Кэш кадров только для зацикленных стикеров. У one-shot (loop=false) при
        // завершении срабатывает onLap → clearCache → ImageBitmap.close(), и кадр,
        // который в этот момент дорисовывается, детачится (drawImage on detached).
        // В tweb этот путь координирует animationIntersector, который на этапе 1 не
        // переносим. Для one-shot кэш всё равно бесполезен (каждый кадр показывается
        // один раз), а loop=true никогда не завершается → clearCache не вызывается,
        // кэш безопасен и ускоряет повторы. Этап 2 (offscreen) кэширует в воркере.
        noCache: !loop,
      })
      .then((p) => {
        if (!alive) { p.remove(); return }
        player = p
        playerRef.current = p
      })
      .catch(() => {}) // NO_WASM (нет SIMD) и т.п. — стикер просто не анимируется
    return () => {
      alive = false
      if (player) {
        if (hoverPlaying === player) hoverPlaying = null
        player.remove()
      }
      playerRef.current = null
    }
  }, [content, loop, autoplay, width, height, mediaId])

  // Replay по клику big-emoji (tweb: клик по анимированному эмодзи проигрывает
  // его заново): рестарт с первого кадра при каждом инкременте токена.
  useEffect(() => {
    if (!replayToken) return
    playerRef.current?.restart()
  }, [replayToken])

  // Видео-стикер (webm): ленивая авто-пауза вне вьюпорта (аналог tweb
  // animationIntersector) — офскрин-стикеры не декодируются/не жгут CPU. В пикере
  // (playOnHover) проигрывание управляется наведением, а не вьюпортом.
  useEffect(() => {
    if (content?.kind !== 'video' || playOnHover || !boxRef.current) return
    const video = videoRef.current
    if (!video) return
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting
        if (visible && autoplay) void video.play().catch(() => {})
        else video.pause()
      },
      { threshold: 0.01 },
    )
    io.observe(boxRef.current)
    return () => io.disconnect()
  }, [content, autoplay, playOnHover])

  const hoverProps = playOnHover
    ? {
        onMouseEnter: () => {
          const player = playerRef.current
          if (player) {
            if (hoverPlaying && hoverPlaying !== player) hoverPlaying.stop()
            hoverPlaying = player
            player.play()
          }
          const video = videoRef.current
          if (video) void video.play().catch(() => {})
        },
        onMouseLeave: () => {
          const player = playerRef.current
          if (player) {
            if (hoverPlaying === player) hoverPlaying = null
            player.stop() // возврат на первый кадр
          }
          const video = videoRef.current
          if (video) { video.pause(); video.currentTime = 0 }
        },
      }
    : undefined

  return (
    <div ref={boxRef} style={{ position: 'relative', width, height, pointerEvents: playOnHover ? 'auto' : 'none' }} {...hoverProps}>
      {content?.kind === 'image' && (
        <img src={content.url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      )}
      {content?.kind === 'video' && (
        <video
          ref={videoRef}
          src={content.url}
          muted
          loop={loop}
          playsInline
          autoPlay={autoplay && !playOnHover}
          preload="metadata"
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      )}
    </div>
  )
})

export default StickerMedia
