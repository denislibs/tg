/**
 * Порт tweb `src/components/wrappers/stickerAppearance.ts` (1:1 по механике).
 *
 * Контроллер слоёв показа стикера в ОДНОМ контейнере: снизу превью (stripped
 * с бэка либо кадр, сохранённый прошлым показом), сверху — само медиа. Нижний
 * слой снимается только когда верхний ДОКАЗАННО на экране (`ensurePresented`
 * у lottie-плеера), поэтому ячейка никогда не мигает пустотой. Пересоздание
 * контроллера на том же контейнере «усыновляет» оставшийся DOM предыдущего
 * поколения и держит его нижним слоем, пока новое медиа не покажет кадр.
 *
 * Отличие от tweb: у него ключ слоя `thumbKey` = `docId-toneIndex`, у нас тонов
 * нет — ключом идёт mediaId (см. `core/stickers/stickerThumbs.ts`).
 */
import liteMode from '@helpers/liteMode'
import { MOUNT_CLASS_TO } from '@config/debug'
import type { Middleware } from '@helpers/middleware'
import type LottiePlayer from '@lib/lottie/lottiePlayer'

export const onAnimationEnd = (element: HTMLElement, onEnd: () => void, timeout: number) => {
  const handler = () => {
    element.removeEventListener('animationend', handler)
    onEnd()
    clearTimeout(timer)
  }
  element.addEventListener('animationend', handler)
  const timer = setTimeout(handler, timeout)
}

const whenAnimationEnd = (element: HTMLElement, timeout: number) =>
  new Promise<void>((resolve) => onAnimationEnd(element, resolve, timeout))

const MEDIA_TAGS = new Set(['CANVAS', 'VIDEO', 'IMG', 'svg'])

export type StickerAppearance = ReturnType<typeof createStickerAppearance>

export default function createStickerAppearance({
  container,
  thumbKey,
  middleware,
  replacePreviousMedia,
}: {
  container: HTMLElement
  thumbKey: string
  middleware?: Middleware
  replacePreviousMedia?: boolean
}) {
  let disposed = false
  let mediaArrived = false
  let underlay: HTMLElement | undefined // текущее превью
  const previous: HTMLElement[] = [] // медиа прошлого поколения, снимается под новым слоем

  middleware?.onClean(() => {
    disposed = true
  })

  // Усыновление оставшегося DOM: превью с тем же ключом переиспользуем как
  // нижний слой, прочее медиа держим под ним до первого кадра нового.
  for (const child of Array.from(container.children) as HTMLElement[]) {
    if (child.tagName === 'DIV') continue
    else if (!underlay && child.dataset.stickerThumb === thumbKey) underlay = child
    else if (MEDIA_TAGS.has(child.tagName)) previous.push(child)
  }

  const canBuildThumb = () =>
    !disposed && !mediaArrived && underlay?.tagName !== 'IMG' && (replacePreviousMedia || !previous.length)

  /** Показать превью нижним слоем (stripped с бэка либо кэшированный кадр). */
  const setThumb = (image: HTMLImageElement, onApplied?: () => void) => {
    if (!canBuildThumb()) {
      onApplied?.()
      return
    }

    // Свап гейтится на decode: недекодированная картинка иначе на кадр рисует
    // пустоту поверх того, что уже видно (мгновенно у закэшированной).
    const decoded = image.decode ? image.decode() : Promise.resolve()
    decoded.then(
      () => {
        if (!canBuildThumb()) {
          onApplied?.()
          return
        }
        image.classList.add('media-sticker', 'thumbnail')
        image.dataset.stickerThumb = thumbKey
        if (underlay) underlay.replaceWith(image)
        else container.append(image)
        underlay = image
        previous.splice(0).forEach((el) => el.remove())
        onApplied?.()
      },
      () => onApplied?.(),
    )
  }

  /**
   * Первый кадр медиа приехал: кроссфейд поверх ещё непрозрачного превью, затем
   * снятие всех нижних слоёв — но только после `ensurePresented` (кадр реально
   * на экране), иначе снятие обнажит непрокрашенный canvas.
   */
  const onMediaFirstFrame = async ({
    animation,
    media,
    needFadeIn,
  }: {
    animation?: LottiePlayer
    media?: HTMLElement
    needFadeIn?: boolean
  }) => {
    if (disposed || mediaArrived) return

    mediaArrived = true
    const lower = [...previous, underlay].filter(Boolean) as HTMLElement[]
    const top = lower[lower.length - 1]
    underlay = undefined
    previous.length = 0

    const fade =
      needFadeIn !== false && (needFadeIn || !top || top.tagName === 'svg') && liteMode.isAvailable('animations')

    if (fade && media) {
      media.classList.add('fade-in')
      await whenAnimationEnd(media, 400)
      media.classList.remove('fade-in')
    }

    await animation?.ensurePresented()
    if (disposed) return

    lower.forEach((el) => el.remove())
  }

  return { canBuildThumb, setThumb, onMediaFirstFrame }
}

// Смонтировано в debug-неймспейс (как lottieLoader/liteMode) — контроллер
// императивный и проверяется в браузере против живого стикера.
if (MOUNT_CLASS_TO) MOUNT_CLASS_TO.createStickerAppearance = createStickerAppearance
