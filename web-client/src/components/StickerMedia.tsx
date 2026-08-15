// StickerMedia — единый рендер файла стикера (пикер, саджесты, бабл в чате).
// Файл лежит в media: lottie-json (mime application/json либо gzip'нутый
// application/x-tgsticker — см. core/stickers/tgs) либо статичный webp/png,
// либо webm-видео. Тип заранее не известен (в списках стикеров есть только
// media_id), поэтому контент грузится fetch'ем и различается по Content-Type;
// результат кэшируется на сессию — повторный маунт (перелистывание категорий
// пикера, скролл ленты) не перекачивает файл.
//
// Показ — трёхслойный, как в tweb `wrapSticker` + `stickerAppearance`:
//   1) нижний слой — превью: stripped-JPEG с бэка (`thumb`) либо кадр,
//      сохранённый прошлым показом (`core/stickers/stickerThumbs`);
//   2) верхний — само медиа (canvas плеера / <video> / <img>);
//   3) нижний снимается ТОЛЬКО когда верхний доказанно прокрасился
//      (`ensurePresented` у lottie) — поэтому ячейка не мигает пустотой.
// Медиа создаётся императивно (не JSX): слоями владеет контроллер
// `stickerAppearance`, он же усыновляет DOM прошлого поколения — React не должен
// конкурировать с ним за те же узлы.
//
// Анимированные стикеры (lottie) рендерит движок tlottie (SIMD-WASM),
// портированный из tweb 1:1: декод кадров идёт в отдельном воркере. См.
// src/lib/lottie/*.
import { memo, useEffect, useRef } from 'react'
import lottieLoader from '../lib/lottie/lottieLoader'
import type LottiePlayer from '../lib/lottie/lottiePlayer'
import animationIntersector, { type AnimationItemGroup } from './animationIntersector'
import { mediaContentUrl, primeMediaToken } from '../core/mediaUrl'
import createStickerAppearance from './wrappers/stickerAppearance'
import { getStickerThumb, saveStickerThumb, saveStickerThumbFromPlayer } from '../core/stickers/stickerThumbs'
import { isLottieMime, readLottie } from '../core/stickers/tgs'
import { useMiddlewareHelper } from '../core/hooks/useMiddlewareHelper'
import { useEvent } from '../core/hooks/useEvent'
import renderImageFromUrl from '@helpers/dom/renderImageFromUrl'
import type { LazyLoadQueue } from '../core/lazyLoadQueue'

export type StickerContent =
  | { kind: 'lottie'; data: unknown }
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }

const cache = new Map<number, Promise<StickerContent>>()

/**
 * @param loadQueue общая на экран очередь загрузки (tweb `wrapSticker`'s
 *   `lazyLoadQueue`, `PARALLEL_LIMIT=8`) — без неё вьюпорт с десятками
 *   стикеров запускал бы столько же параллельных fetch'ей разом. Как и в
 *   tweb (`wrapSticker.ts:735` — уже скачанное грузится в обход очереди),
 *   через неё идёт ТОЛЬКО настоящая новая загрузка: кэш-хит возвращает
 *   существующий промис напрямую, не занимая место в очереди повторно.
 */
export function loadStickerContent(mediaId: number, loadQueue?: LazyLoadQueue): Promise<StickerContent> {
  let p = cache.get(mediaId)
  if (!p) {
    const fetchContent = async (): Promise<StickerContent> => {
      await primeMediaToken()
      // Медиа-bytes грузим прямым fetch к media-эндпоинту (не через managers/worker-RPC),
      // санкц. исключение — см. web-client/CLAUDE.md «МОЖНО». Тип стикера неизвестен
      // заранее — определяем по Content-Type сырого ответа.
      const res = await fetch(mediaContentUrl(mediaId))
      if (!res.ok) throw new Error(`sticker media ${mediaId}: HTTP ${res.status}`)
      const ct = res.headers.get('content-type') ?? ''
      if (isLottieMime(ct)) return { kind: 'lottie', data: await readLottie(res) }
      // video/webm (vp9) — видео-стикер (tweb wrapSticker WebM-ветка).
      if (ct.startsWith('video/')) return { kind: 'video', url: URL.createObjectURL(await res.blob()) }
      return { kind: 'image', url: URL.createObjectURL(await res.blob()) }
    }
    p = loadQueue ? loadQueue.push(fetchContent) : fetchContent()
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
  group = 'chat',
  thumb,
  loadQueue,
  onComplete,
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
  /** группа animationIntersector (tweb `group`): ею гасят/будят пачку анимаций разом */
  group?: AnimationItemGroup
  /** stripped-превью файла (base64 JPEG) — нижний слой, пока медиа грузится */
  thumb?: string
  /** общая на экран очередь загрузки (см. `loadStickerContent`) — опциональна:
   * большинство мест (бабл в чате, саджесты) грузят стикер напрямую, без
   * лимита; его заводит экран поиска стикеров (StickersSearchTab, Task 3) —
   * там же, где им гейтится и запрос состава набора. */
  loadQueue?: LazyLoadQueue
  /** проигрывание без loop дошло до конца (lottie: LottiePlayer.onComplete;
   * видео: 'ended'; статика — сразу после первого кадра, играть нечего).
   * Нужен потребителям, которые снимают себя по завершении одноразовой
   * анимации (эффект вокруг реакции — ReactionAroundEffect). */
  onComplete?: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<LottiePlayer | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const middlewareHelper = useMiddlewareHelper()
  // Стабильная обёртка: onComplete не входит в зависимости эффекта ниже (его
  // identity меняется у вызывающих без useEvent на своей стороне) — иначе
  // смена ссылки на колбэк пересоздавала бы плеер/appearance целиком.
  const onCompleteEvent = useEvent(() => onComplete?.())

  useEffect(() => {
    const container = boxRef.current
    if (!container) return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()

    // Контроллер слоёв: он же усыновит canvas/img прошлого поколения (смена
    // размера, смена стикера в той же ячейке) и снимет его под новым кадром.
    const appearance = createStickerAppearance({
      container,
      thumbKey: String(mediaId),
      middleware,
    })

    // Нижний слой: превью с бэка, иначе — кадр, сохранённый прошлым показом.
    const cached = getStickerThumb(mediaId)
    const thumbSrc = thumb ? `data:image/jpeg;base64,${thumb}` : cached?.url
    if (thumbSrc && appearance.canBuildThumb()) {
      const image = new Image()
      void renderImageFromUrl(image, thumbSrc, () => appearance.setThumb(image))
    }

    let player: LottiePlayer | null = null
    let video: HTMLVideoElement | null = null

    void loadStickerContent(mediaId, loadQueue).then((content) => {
      if (!middleware()) return

      if (content.kind === 'lottie') {
        // Воркер парсит анимацию из Blob (readBlobAsText + JSON.parse); наш бэк
        // отдаёт несжатый JSON, поэтому сериализуем разобранное обратно в Blob.
        const blob = new Blob([JSON.stringify(content.data)], { type: 'application/json' })
        void lottieLoader
          .loadAnimationWorker({
            container,
            animationData: blob,
            loop,
            autoplay,
            width,
            height,
            group,
            // tweb wrapSticker: стикеры в чате и в пикере — разные классы lite-mode,
            // по ним intersector.setAutoplay гасит/будит их пачкой при смене настройки
            liteModeKey: playOnHover ? 'stickers_panel' : 'stickers_chat',
            // Offscreen-рендер (tweb по умолчанию): canvas уезжает в воркер
            // (`transferControlToOffscreen`), главный поток не трогает пиксели и не
            // получает кадры. Наш lottie-воркер — dedicated (не SharedWorker),
            // поэтому презентация идёт через per-tab compositor-воркер, как в tweb
            // при `IS_SHARED_WORKER_OFFSCREEN_CANVAS_SUPPORTED === false`.
            // Снятие нижнего слоя в этом режиме гейтится `ensurePresented()`
            // (см. wrappers/stickerAppearance) — без него кадр снимался бы до
            // прокраски. Safari и браузеры без OffscreenCanvas/ImageBitmap
            // деградируют в legacy сами (lib/lottie/shouldRenderOffscreen).
            //
            // Кэш кадров в offscreen-режиме живёт в воркере и защищён от гонки
            // очистки; в legacy-фолбэке он на вкладке, и у one-shot (loop=false)
            // завершение зовёт onLap → clearCache → ImageBitmap.close() ровно
            // тогда, когда кадр дорисовывается (drawImage on detached). Поэтому
            // кэш по-прежнему включаем только для зацикленных.
            noCache: !loop,
          })
          .then((p) => {
            if (!middleware()) {
              p.remove()
              return
            }
            player = p
            playerRef.current = p
            // Плеер аппендит canvas в контейнер САМ (перед firstFrame), поэтому
            // здесь только сохранение кадра в кэш и снятие нижнего слоя.
            p.onFirstFrame(() => {
              if (!middleware()) return
              void saveStickerThumbFromPlayer(mediaId, p)
              void appearance.onMediaFirstFrame({ animation: p, media: p.canvas[0] })
            })
            // 'complete' шлёт только one-shot (loop=false, см. onLap в lottiePlayer);
            // у зацикленных потребитель onComplete просто никогда не позовётся.
            p.onComplete(() => {
              if (!middleware()) return
              onCompleteEvent()
            })
          })
          .catch(() => {}) // NO_WASM (нет SIMD) и т.п. — стикер просто не анимируется
        return
      }

      if (content.kind === 'video') {
        video = document.createElement('video')
        video.classList.add('media-sticker')
        video.muted = true
        video.loop = loop
        video.playsInline = true
        video.preload = 'metadata'
        video.draggable = false
        if (autoplay && !playOnHover) video.autoplay = true
        video.addEventListener(
          'loadeddata',
          () => {
            if (!middleware() || !video) return
            // Первый кадр webm — такое же превью, как первый кадр lottie:
            // сохраняем, чтобы следующий показ не начинался с пустоты.
            const canvas = document.createElement('canvas')
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            canvas.getContext('2d')?.drawImage(video, 0, 0)
            void saveStickerThumb(mediaId, canvas)
            void appearance.onMediaFirstFrame({ media: video })
          },
          { once: true },
        )
        container.append(video)
        videoRef.current = video
        video.src = content.url
        // Видео с loop=false доходит до конца и шлёт 'ended' ровно раз
        // (зацикленное — никогда, браузер сам заворачивает воспроизведение).
        if (!loop) {
          video.addEventListener('ended', () => { if (middleware()) onCompleteEvent() }, { once: true })
        }

        // Видео-стикер — в общий animationIntersector, как tweb делает для любого
        // <video> (wrappers/video.ts:649): пауза вне вьюпорта, в фоновой вкладке и
        // на время тяжёлой анимации. В пикере (playOnHover) проигрывание
        // управляется наведением, а не вьюпортом, — там не регистрируем.
        if (!playOnHover) {
          animationIntersector.addAnimation({ animation: video, group, observeElement: video, type: 'video' })
        }
        return
      }

      const image = new Image()
      image.classList.add('media-sticker')
      image.draggable = false
      void renderImageFromUrl(image, content.url, () => {
        if (!middleware()) return
        container.append(image)
        void appearance.onMediaFirstFrame({ media: image })
        // Статика не «доигрывает» — сигнал завершения шлём сразу по отрисовке,
        // иначе потребитель onComplete (эффект вокруг реакции) ждал бы вечно.
        onCompleteEvent()
      })
    })

    return () => {
      if (player) {
        if (hoverPlaying === player) hoverPlaying = null
        // снимаем с наблюдения И уничтожаем плеер (removeAnimation сам зовёт
        // animation.remove() для lottie); player.remove() идемпотентен, поэтому
        // второй вызов страхует случай, когда регистрация не состоялась.
        // Canvas при этом остаётся в DOM с последним кадром — следующее поколение
        // усыновит его нижним слоем (tweb SuperStickerRenderer.processInvisible).
        animationIntersector.removeAnimationByPlayer(player)
        player.remove()
      }
      if (video) {
        animationIntersector.removeAnimationByPlayer(video)
        video.pause()
      }
      playerRef.current = null
      videoRef.current = null
      scope.destroy()
    }
  }, [mediaId, thumb, width, height, loop, autoplay, group, playOnHover, loadQueue, middlewareHelper])

  // Replay по клику big-emoji (tweb: клик по анимированному эмодзи проигрывает
  // его заново): рестарт с первого кадра при каждом инкременте токена.
  useEffect(() => {
    if (!replayToken) return
    playerRef.current?.restart()
  }, [replayToken])

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
          if (video) {
            video.pause()
            video.currentTime = 0
          }
        },
      }
    : undefined

  return (
    <div
      ref={boxRef}
      style={{ position: 'relative', width, height, pointerEvents: playOnHover ? 'auto' : 'none' }}
      {...hoverProps}
    />
  )
})

export default StickerMedia
