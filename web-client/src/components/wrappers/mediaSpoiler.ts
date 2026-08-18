// wrapMediaSpoiler — порт tweb `components/wrappers/mediaSpoiler.ts`.
//
// Скрытое медиа: поверх фото/видео кладётся контейнер из двух канвасов —
// размытое stripped-превью (`canvas.media-spoiler-thumbnail`) и слой движущихся
// точек (`canvas.canvas-dots`, его даёт `DotRenderer`). Клик раскрывает: либо
// анимацией «дырка растёт из точки клика» (`revealWithAnimation`), либо, если
// координат нет, простым угасанием через `SetTransition('is-revealing')`.
// Обратного скрытия НЕТ — раскрытый спойлер удаляется вместе со своим
// middleware-хелпером (в отличие от текстового спойлера, который прячется обратно).
//
// НЕ портирована ветка «чувствительный контент» (`sensitive`,
// `sensitiveSpoilers`, `clearSensitiveSpoilers`, `hasSensitiveSpoiler`,
// `AgeVerificationPopup`, `confirmationPopup('18Plus')`,
// `appPrivacyManager.setContentSettings`): её предмет — отдельная
// аккаунт-настройка Telegram «показывать чувствительный контент» с проверкой
// возраста, у нас нет ни её API, ни попапа, ни соответствующего поля у медиа.
// Это самостоятельная фича, а не часть спойлера: пометку `18+` ставит не
// отправитель, а модерация.
import cancelEvent from '@helpers/dom/cancelEvent'
import safePlay from '@helpers/dom/safePlay'
import type { Middleware } from '@helpers/middleware'
import { setTransition } from '@core/dom/setTransition'
import { getImageFromStrippedThumb } from '@core/media/getStrippedThumbIfNeeded'
import { getStrippedThumb, type MyDocument, type MyPhoto } from '@core/media/messageMedia'
import DotRenderer from '@components/dotRenderer'
import type { AnimationItemGroup } from '@components/animationIntersector'
import type { DotRendererConfig } from '@lib/spoiler/dotRendererCore'

export function toggleMediaSpoiler(options: {
  mediaSpoiler: HTMLElement
  reveal: boolean
  destroyAfter?: boolean
}) {
  const { mediaSpoiler, reveal, destroyAfter } = options
  setTransition({
    element: mediaSpoiler,
    forwards: reveal,
    className: 'is-revealing',
    duration: 250,
    onTransitionEnd: () => {
      if (reveal && destroyAfter) {
        mediaSpoiler.remove()
        mediaSpoiler.middlewareHelper?.destroy()
      }
    },
  })
}

function revealSpoilerWithAnimation(options: { mediaSpoiler: HTMLElement; event: Event }) {
  const { mediaSpoiler, event } = options

  const thumbnailCanvas = mediaSpoiler.querySelector('canvas.media-spoiler-thumbnail') as HTMLCanvasElement | null
  const canvas = mediaSpoiler.querySelector('canvas.canvas-dots') as HTMLElement | null
  if (!canvas) return false

  const controls = DotRenderer.getImageSpoilerByElement(canvas)

  if (!controls || !thumbnailCanvas) return false

  const result = controls.revealWithAnimation(event, thumbnailCanvas)
  if (!result) return false

  return result.then(() => {
    mediaSpoiler.remove()
    mediaSpoiler.middlewareHelper?.destroy()
  })
}

export function onMediaSpoilerClick(options: { mediaSpoiler: HTMLElement; event: Event }) {
  const { mediaSpoiler, event } = options
  cancelEvent(event)

  if (mediaSpoiler.classList.contains('is-revealing') || mediaSpoiler.dataset.isRevealing) {
    return
  }

  const video = mediaSpoiler.parentElement?.querySelector('video')
  if (video && !mediaSpoiler.parentElement?.querySelector('.video-play')) {
    video.autoplay = true
    safePlay(video)
  }

  if (revealSpoilerWithAnimation({ mediaSpoiler, event })) {
    mediaSpoiler.dataset.isRevealing = 'true'
    return
  }

  toggleMediaSpoiler({
    mediaSpoiler,
    reveal: true,
    destroyAfter: true,
  })
}

interface WrapMediaSpoilerOptions {
  /** вложение, которое прячем (tweb `media: Document.document | Photo.photo`) */
  media: MyPhoto | MyDocument
  width?: number
  height?: number
  middleware: Middleware
  animationGroup: AnimationItemGroup
  config?: Partial<DotRendererConfig>
}

function wrapMediaSpoilerWithImage(
  options: Omit<WrapMediaSpoilerOptions, 'media'> & {
    image: HTMLImageElement | HTMLCanvasElement
  },
) {
  const { middleware, image } = options
  if (!middleware()) {
    return
  }

  image.classList.add('media-spoiler-thumbnail')

  const container = document.createElement('div')
  container.classList.add('media-spoiler-container')
  container.middlewareHelper = middleware.create()

  const { canvas, readyResult } = DotRenderer.create({
    ...options,
    middleware: container.middlewareHelper.get(),
  })

  container.append(image, canvas)

  return { container, readyResult }
}

export default async function wrapMediaSpoiler(options: WrapMediaSpoilerOptions) {
  // tweb: `sizes.find((size) => size._ === 'photoStrippedSize')` — ровно это и
  // делает `getStrippedThumb`, одинаково для `photo.sizes` и `doc.thumbs`.
  const thumb = getStrippedThumb(options.media)
  if (!thumb) {
    return
  }

  // tweb: `getImageFromStrippedThumb(media, thumb, true)` — третий аргумент
  // `useBlur`; наш bytes-канал отдаёт байты ступени готовой base64-строкой
  // (см. шапку `core/media/getStrippedThumbIfNeeded.ts`)
  const { image, loadPromise } = getImageFromStrippedThumb(thumb, true)
  await loadPromise

  const wrapped = wrapMediaSpoilerWithImage({ ...options, image })
  if (!wrapped) {
    return
  }

  const { container, readyResult } = wrapped

  if (readyResult instanceof Promise) {
    await readyResult
  }

  return container
}
