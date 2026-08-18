/**
 * Порт tweb `src/components/wrappers/stickerAppearance.ts` (1:1 по механике).
 *
 * Контроллер слоёв показа стикера в ОДНОМ контейнере, СНИЗУ ВВЕРХ: SVG-силуэт
 * из векторного контура (мгновенный, синхронный — `setSilhouette`), затем
 * превью-картинка (кадр, сохранённый прошлым показом, либо stripped с бэка —
 * `upgradeToImage`), сверху — само медиа. Каждый следующий слой апгрейдит
 * предыдущий тем же способом (`underlay.replaceWith`), поэтому силуэт просто
 * занимает `underlay` первым и дальше живёт по общим правилам
 * `upgradeToImage`/`onMediaFirstFrame`.
 * Нижний слой снимается только когда верхний ДОКАЗАННО на экране
 * (`ensurePresented` у lottie-плеера), поэтому ячейка никогда не мигает
 * пустотой. Пересоздание контроллера на том же контейнере «усыновляет»
 * оставшийся DOM предыдущего поколения и держит его нижним слоем, пока новое
 * медиа не покажет кадр.
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

  // Живое медиа прошлого поколения не даёт вставить простую картинку (tweb:53-55);
  // заменяет его только перевешивание «только превью» (`replacePreviousMedia`).
  const canBuildImage = () =>
    !disposed && !mediaArrived && underlay?.tagName !== 'IMG' && (replacePreviousMedia || !previous.length)

  // Силуэт — САМЫЙ нижний слой из всех (tweb canBuildSilhouette): в отличие от
  // canBuildImage он не встаёт поверх уже занятого underlay (в т.ч. поверх
  // усыновлённого силуэта прошлого поколения) — рисуется только в абсолютно
  // пустой контейнер, до которого ещё не добрался ни thumb, ни медиа.
  const canBuildSilhouette = () => !disposed && !mediaArrived && !underlay && !previous.length

  /**
   * SVG-силуэт из векторного контура (tweb `setSilhouette`) — ставится ДО
   * превью, пока даже stripped-JPEG ещё не декодировался. Синхронный слой:
   * в отличие от `setThumb` не ждёт `decode()`, потому что рисуется из уже
   * готового SVG-узла, а не из грузящейся картинки. Заняв `underlay`, он
   * дальше апгрейдится тем же путём, что и любой превью-слой —
   * `upgradeToImage` заменит его картинкой через `underlay.replaceWith(image)`.
   */
  const setSilhouette = (svg: SVGSVGElement) => {
    if (!canBuildSilhouette()) return

    svg.classList.add('lottie-vector', 'media-sticker', 'thumbnail')
    svg.dataset.stickerThumb = thumbKey
    container.append(svg)
    underlay = svg as unknown as HTMLElement
  }

  /** Апгрейд нижнего слоя до превью-картинки (кэшированный кадр либо stripped). */
  const upgradeToImage = (image: HTMLImageElement, onApplied?: () => void) => {
    if (!canBuildImage()) {
      onApplied?.()
      return
    }

    // Свап гейтится на decode: недекодированная картинка иначе на кадр рисует
    // пустоту поверх того, что уже видно (мгновенно у закэшированной).
    const decoded = image.decode ? image.decode() : Promise.resolve()
    decoded.then(
      () => {
        if (!canBuildImage()) {
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

  return { canBuildSilhouette, canBuildImage, setSilhouette, upgradeToImage, onMediaFirstFrame }
}

// Смонтировано в debug-неймспейс (как lottieLoader/liteMode) — контроллер
// императивный и проверяется в браузере против живого стикера.
if (MOUNT_CLASS_TO) MOUNT_CLASS_TO.createStickerAppearance = createStickerAppearance
