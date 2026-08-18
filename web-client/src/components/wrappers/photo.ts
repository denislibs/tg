/**
 * Порт tweb `src/components/wrappers/photo.ts` (`wrapPhoto`) — ванильный, без
 * React: контейнер приходит снаружи, DOM строится императивно, временем жизни
 * поколения владеет `middleware`.
 *
 * ── Дерево, которое строит функция (живой DOM tweb, `docs/tweb/dom/dumps/`) ──
 * Вписанное медиа (`isFit`, обычный случай) — один слой:
 *   div.attachment.media-container [style="width: 420px; height: 236px;"]
 *     canvas.canvas-thumbnail.thumbnail.media-photo   ← stripped-превью
 *     img.media-photo                                 ← полное, поверх превью
 * Медиа, которому бокс РАСШИРИЛИ (узкая картинка + подпись/минимальная ширина,
 * `isFit === false` — дамп `03-video-poll.json`) — два слоя:
 *   div.attachment.media-container.media-container-fitted [style="width: 320px; height: 400px;"]
 *     canvas.canvas-thumbnail.thumbnail.media-photo   ← подложка НА ВЕСЬ бокс
 *     div.media-container-aspecter [style="width: 300px; height: 400px;"]
 *       canvas.canvas-thumbnail.thumbnail.media-photo ← превью в аспекте
 *       img.media-photo                               ← полное, в аспекте
 *
 * ── Отличия от оригинала (каждое — следствие нашей модели данных) ───────────
 *  • вход — `mediaId` + плоские метаданные вместо `photo: MyPhoto | MyDocument |
 *    WebDocument | InputWebFileLocation`: MTProto-медиа с лестницей `sizes[]` у
 *    нас нет. Отсюда же отсутствуют ветки `isWebFile`/`isWebDoc`/
 *    `isImageFromDocument` и ранний выход «у медиа нет ни `sizes`, ни `thumbs`»
 *    (photo.ts:71-93) — различать нечего, любой `mediaId` скачивается;
 *  • tweb-параметр `size: PhotoSize` → `thumb?: boolean` + `strippedSize?:
 *    boolean`: у нашего медиа ровно два серверных размера
 *    (`thumb: true|false` у `mediaManager.downloadMediaURL`) плюс stripped-превью
 *    в самом сообщении (`media_blur`), лестницы и `choosePhotoSize` не
 *    существует. Ранний выход оригинала «выбранный размер САМ является байтами
 *    превью» (photo.ts:208) портирован — это и есть `strippedSize` (см. ниже у
 *    ветки). Вместе с `size` отпадают:
 *      – условие `size._ === 'photoSizeEmpty' && isDocument` в том же раннем
 *        выходе — `photoSizeEmpty` это MTProto-заглушка «размера нет», у нас
 *        отсутствие медиа выражается отсутствием `mediaId`, а не пустым
 *        размером;
 *      – ветка `size._ === 'videoSize'` (photo.ts:213-218, `<video autoplay loop
 *        muted class="media-photo">`) — это MTProto `videoSize`, анимированная
 *        обложка (профиля/эмодзи-статуса), а не видео сообщения; такого поля у
 *        нас нет вовсе. Видео сообщения рисует `wrapVideo`, не этот враппер;
 *  • `cacheContext` (`apiManagerProxy.getCacheContext`) → зеркало URL:
 *    `cachedMediaUrl(id, thumb) !== undefined` — тот же смысл «байты уже на
 *    руках», см. `core/mediaCache.ts`. Как и в оригинале, оно перечитывается
 *    ВНУТРИ `load()`: к моменту, когда задача вышла из очереди, тот же id мог
 *    уже приехать по чужому запросу;
 *  • `appDownloadManager.downloadMediaURL` → `ensureMediaUrl` (единственная
 *    точка входа императивного кода за URL; пин `core/noDuplicateMediaUrl.test.ts`);
 *  • `lazyLoadQueue.push({div, load})` → `queue.push(load, isVisible)`: наша
 *    очередь функциональная и приоритезирует по живому геттеру видимости, а не
 *    по элементу (`core/lazyLoadQueue.ts`);
 *  • `uploadingFileName` → `uploadPromise`: реестра аплоадов по имени файла
 *    (`appDownloadManager.getUpload`) у нас нет — промис прогресса даёт
 *    вызывающий, он же владеет отменой;
 *  • `container` обязателен. Ветка tweb `if(!container)` (photo.ts:66-69)
 *    обслуживает вызовы «сделай мне `images.full`, но никуда не вставляй»;
 *    у нас таких вызовов нет, а `renderMediaWithFadeIn` без контейнера и не
 *    работает — держать мёртвую ветку незачем;
 *  • `isOut`/`withTail`/`managers` не портированы: в теле оригинала они не
 *    используются (только пробрасываются в рекурсивный вызов), а
 *    `wrapMediaWithTail` в tweb закомментирован.
 */
import ProgressivePreloader from '@components/preloader'
import mediaSizes, { setAttachmentSize } from '@core/dom/mediaSizes'
import type { LazyLoadQueue } from '@core/lazyLoadQueue'
import { ensureMediaUrl } from '@core/media/ensureMediaUrl'
import getMediaThumbIfNeeded from '@core/media/getStrippedThumbIfNeeded'
import { cachedMediaUrl } from '@core/mediaCache'
import blur from '@helpers/blur'
import type { CancellablePromise } from '@helpers/cancellablePromise'
import renderMediaWithFadeIn from '@helpers/dom/renderMediaWithFadeIn'
import liteMode from '@helpers/liteMode'
import makeError from '@helpers/makeError'
import type { Middleware } from '@helpers/middleware'
import noop from '@helpers/noop'

/** tweb photo.ts:299-301 — кольцо прогресса не вешается на мелкое медиа */
const MIN_PRELOADER_SIDE = 150

/** `onlyCache` не дал URL: медиа ждёт клика по manual-кольцу (tweb photo.ts:255) */
const NO_AUTO_DOWNLOAD_ERROR = makeError('NO_AUTO_DOWNLOAD')

export interface WrapPhotoOptions {
  /** файл на media-эндпоинте (у tweb — `photo`/`doc` MTProto) */
  mediaId: number
  /** натуральные пиксели медиа (tweb `photoSize.w`/`h`) */
  width?: number
  height?: number
  /** stripped-JPEG превью в base64 (наш `message.mediaBlur`, tweb `photoStrippedSize.bytes`) */
  strippedThumb?: string
  /** качать уменьшенную версию (наш аналог tweb-параметра `size: PhotoSize`) */
  thumb?: boolean
  /**
   * Выбранный размер САМ является байтами превью — tweb `size._ ===
   * 'photoStrippedSize'` (`size.bytes`), ранний выход photo.ts:208. Качать
   * нечего: показывается `strippedThumb` из сообщения, и он рисуется КАК медиа,
   * а не как подложка. Так у оригинала выглядят видео без серверного постера
   * (единственный подходящий `PhotoSize` документа — stripped) и неоплаченное
   * платное медиа (`generatePhotoForExtendedMediaPreview` отдаёт псевдо-фото с
   * `id: 0` и единственным stripped-размером — отсюда же и `mediaId: 0` у
   * такого вызова).
   */
  strippedSize?: boolean
  /** контейнер показа; им владеет вызывающий (tweb `container`) */
  container: HTMLElement
  boxWidth?: number
  boxHeight?: number
  /** `false`/`undefined` — грузить сразу, минуя очередь (tweb `lazyLoadQueue`) */
  lazyLoadQueue?: LazyLoadQueue | false
  /** живой геттер видимости цели — приоритезация внутри очереди */
  isVisible?: () => boolean
  middleware?: Middleware
  withoutPreloader?: boolean
  loadPromises?: Promise<unknown>[]
  /** 0 — автозагрузка выключена (tweb `autoDownloadSize`) */
  autoDownloadSize?: number
  noBlur?: boolean
  noThumb?: boolean
  noFadeIn?: boolean
  /** размыть УЖЕ СКАЧАННОЕ медиа и показать блюр вместо него (tweb `blurAfter`) */
  blurAfter?: boolean
  processUrl?: (url: string) => Promise<string>
  fadeInElement?: HTMLElement
  onRender?: () => void
  onRenderFinish?: () => void
  useBlur?: boolean | number
  useRenderCache?: boolean
  /** медиа принадлежит сообщению (tweb `message`) — гейт минимальной ширины бокса */
  hasMessage?: boolean
  /** у сообщения есть подпись/reply/webpage — tweb расширяет бокс до 320 */
  hasMessageBlock?: boolean
  /** видео с плеером: минимальная ширина 368 вместо 120 (tweb `canHaveVideoPlayer`) */
  canHaveVideoPlayer?: boolean
  /** медиа — документ, а не фото (tweb `photo._ === 'document'`): дефолт
   * натурального размера 512 вместо 100 + внешний гейт минимумов бокса */
  isDocument?: boolean
  /** тип документа (tweb `photo.type`) — вместе с `isDocument` решает тот гейт */
  documentType?: string
  /** промис отгрузки файла (tweb `appDownloadManager.getUpload(uploadingFileName)`) */
  uploadPromise?: CancellablePromise<unknown>
}

export interface WrappedPhoto {
  /** tweb `ret.loadPromises` */
  loadPromises: { thumb: Promise<unknown>; full: Promise<unknown> }
  /** tweb `ret.images` */
  images: { thumb: HTMLImageElement | HTMLCanvasElement | null; full: HTMLImageElement | null }
  /** tweb `ret.preloader` */
  preloader: ProgressivePreloader | null
  /** tweb `ret.aspecter` — контейнер, если бокс не расширяли */
  aspecter: HTMLElement | null
}

export default async function wrapPhoto(options: WrapPhotoOptions): Promise<WrappedPhoto> {
  const {
    mediaId, width, height, strippedThumb, thumb, strippedSize, container, isVisible, middleware,
    loadPromises, noBlur, noThumb, noFadeIn, blurAfter, processUrl, fadeInElement,
    onRender, onRenderFinish, useBlur, useRenderCache, hasMessage, hasMessageBlock,
    canHaveVideoPlayer, isDocument, documentType, uploadPromise,
  } = options
  const { withoutPreloader, lazyLoadQueue } = options

  const ret: WrappedPhoto = {
    loadPromises: {
      thumb: Promise.resolve(),
      full: Promise.resolve(),
    },
    images: {
      thumb: null,
      full: null,
    },
    preloader: null,
    aspecter: null,
  }

  let noAutoDownload: boolean | undefined = options.autoDownloadSize === 0

  // tweb photo.ts:97-100
  const boxWidth = options.boxWidth === undefined ? mediaSizes.active.regular.width : options.boxWidth
  const boxHeight = options.boxHeight === undefined ? mediaSizes.active.regular.height : options.boxHeight

  container.classList.add('media-container')
  let aspecter = container

  let isFit = true
  let loadThumbPromise: Promise<unknown> = Promise.resolve()
  let thumbImage: HTMLImageElement | HTMLCanvasElement | undefined

  // Наш `cacheContext.downloaded`: попадание в зеркало URL. Геттер, а не
  // значение — tweb перечитывает кэш-контекст внутри `load()` (photo.ts:309).
  //
  // `strippedSize` — тот же кэш-контекст, что у оригинала: tweb берёт его ПО
  // ВЫБРАННОМУ размеру (`getCacheContext(photo, size.type)`), а у stripped-
  // размера своего файла в кэше нет по построению — байты приезжают в самом
  // сообщении, скачивать нечего. Отсюда `downloaded === false` всегда, и превью
  // строится, даже когда полный файл уже на руках. Именно этим у оригинала
  // держится постер видео: «скачано» относится к файлу, а не к первому кадру.
  const isDownloaded = () => !strippedSize && cachedMediaUrl(mediaId, thumb) !== undefined

  if (boxWidth && boxHeight) { // !album
    // размер контейнера ставит сам `setAttachmentSize` (`boxSize`), как в
    // оригинале (setAttachmentSize.ts:102-103)
    const set = setAttachmentSize({
      width: width || 0,
      height: height || 0,
      element: container,
      boxWidth,
      boxHeight,
      hasMessage,
      hasMessageBlock,
      isDocument,
      documentType,
      isVideoWithPlayer: canHaveVideoPlayer,
    })
    isFit = set.isFit

    if (!isFit) {
      aspecter = document.createElement('div')
      aspecter.classList.add('media-container-aspecter')
      // ВПИСАННЫЙ размер, не расширенный бокс контейнера (tweb photo.ts:136-137)
      aspecter.style.width = set.size.width + 'px'
      aspecter.style.height = set.size.height + 'px'

      const gotThumb = getMediaThumbIfNeeded({
        strippedThumb,
        useBlur: useBlur !== undefined ? useBlur : !noBlur,
        ignoreCache: true,
      })
      if (gotThumb) {
        loadThumbPromise = gotThumb.loadPromise
        // намеренно локальная переменная (tweb photo.ts:149 «local scope»):
        // подложку на весь бокс НЕ отдаём в `renderMediaWithFadeIn`, иначе она
        // снялась бы вместе с превью аспектера и по краям осталась дыра
        const backdrop = gotThumb.image
        backdrop.classList.add('media-photo')
        container.append(backdrop)
      } else {
        // Превью из сообщения нет — подложку делаем из самого медиа: рекурсивный
        // вызов без бокса кладёт полное изображение прямо в контейнер, а
        // `blurAfter` подменяет его размытой уменьшенной копией (tweb photo.ts:153-176).
        const res = await wrapPhoto({
          container,
          mediaId,
          width,
          height,
          strippedThumb,
          thumb,
          // tweb пробрасывает в рекурсивный вызов тот же `size` (photo.ts:157)
          strippedSize,
          // и то же самое медиа (`photo`, photo.ts:155) — а значит и ответы про
          // него: это тот же документ/фото, что и во внешнем вызове
          isDocument,
          documentType,
          boxWidth: 0,
          boxHeight: 0,
          lazyLoadQueue,
          loadPromises,
          middleware,
          withoutPreloader: true,
          autoDownloadSize: options.autoDownloadSize,
          noBlur,
          noThumb: true,
          blurAfter: true,
        })
        res.images.full?.classList.add('media-photo', 'thumbnail')
      }

      container.classList.add('media-container-fitted')
      container.append(aspecter)
    }
  }

  if (!noThumb) {
    const gotThumb = getMediaThumbIfNeeded({
      strippedThumb,
      downloaded: isDownloaded(),
      useBlur: useBlur !== undefined ? useBlur : !noBlur,
    })

    if (gotThumb) {
      loadThumbPromise = Promise.all([loadThumbPromise, gotThumb.loadPromise])
      ret.loadPromises.thumb = ret.loadPromises.full = loadThumbPromise
      thumbImage = ret.images.thumb = gotThumb.image
      thumbImage.classList.add('media-photo')
      aspecter.append(thumbImage)
    }
  }

  ret.aspecter = aspecter

  // tweb photo.ts:208-210 — выбранный размер САМ является байтами превью:
  // показывать больше нечего, и превью, построенное выше, УЖЕ стоит в слоте
  // медиа (`media-photo` в аспектере/контейнере — не подложка на весь бокс,
  // которую кладёт ветка `!isFit`). Ни полного `<img>`, ни кольца, ни запроса
  // байтов в этой ветке нет вовсе.
  if (strippedSize) {
    return ret
  }

  const media = ret.images.full = new Image()
  media.classList.add('media-photo')

  const needFadeIn = (!!thumbImage || !isDownloaded()) && liteMode.isAvailable('animations') && !noFadeIn

  let preloader: ProgressivePreloader | undefined
  if (!withoutPreloader) {
    if (!isDownloaded() || uploadPromise) {
      preloader = new ProgressivePreloader({
        attachMethod: 'prepend',
        isUpload: !!uploadPromise,
      })
    }

    if (uploadPromise && preloader) { // means upload
      preloader.attachPromise(uploadPromise)
      preloader.attach(container)
      noAutoDownload = undefined
    }
  }

  const getDownloadPromise = (): Promise<string> => {
    // tweb: `downloadMediaURL({..., onlyCache: noAutoDownload})`. `onlyCache` у
    // нас — синхронное чтение зеркала: глубже (корзина `cachedFiles` в воркере)
    // заглянуть, не начав скачивание, нечем. Расхождение только в редком случае
    // «поздняя вкладка, файл уже в корзине воркера»: tweb показал бы картинку,
    // мы — manual-кольцо до клика.
    if (noAutoDownload) {
      const cached = cachedMediaUrl(mediaId, thumb)
      return cached === undefined ? Promise.reject(NO_AUTO_DOWNLOAD_ERROR) : Promise.resolve(cached)
    }

    return ensureMediaUrl(mediaId, { thumb, middleware })
  }

  const renderOnLoad = (url: string) => {
    return renderMediaWithFadeIn({
      container,
      media,
      url,
      needFadeIn,
      aspecter,
      thumbImage,
      fadeInElement,
      onRender,
      onRenderFinish,
      useRenderCache,
    })
  }

  const onLoad = async (url: string) => {
    if (middleware && !middleware()) return

    if (processUrl) {
      url = await processUrl(url)
    }

    if (blurAfter) {
      // downscale to a tiny thumbnail before blurring so the upscaled side-fill
      // looks like frosted glass (matches the official clients), instead of a
      // weak blur on the full image — комментарий и константы tweb photo.ts:283-290
      const result = blur(url, 10, 2, 48)
      return result.promise.then(() => {
        return renderOnLoad(result.canvas.toDataURL())
      })
    }

    return renderOnLoad(url)
  }

  let loadPromise: Promise<unknown> | undefined
  // tweb photo.ts:297-301: на мелком медиа кольца нет — оно там больше картинки;
  // у tweb размеры берутся из выбранного `PhotoSize`, у нас лестницы нет,
  // ближайший аналог — натуральные пиксели медиа (у альбома tweb смотрит на
  // `choosePhotoSize(480)`, то есть тоже на исходную геометрию, а не на бокс).
  const canAttachPreloader = ((width ?? 0) >= MIN_PRELOADER_SIDE && (height ?? 0) >= MIN_PRELOADER_SIDE) || !!noAutoDownload
  const load = async () => {
    if (noAutoDownload && !withoutPreloader && preloader) {
      preloader.construct?.()
      preloader.setManual()
    }

    const promise = getDownloadPromise()
    if (
      preloader &&
      !isDownloaded() &&
      !withoutPreloader &&
      canAttachPreloader
    ) {
      preloader.attach(container, false, promise)
    }

    noAutoDownload = undefined

    const renderPromise = promise.then(onLoad)
    void renderPromise.catch(noop)
    return { download: promise, render: renderPromise }
  }

  if (preloader) {
    preloader.setDownloadFunction(load)
  }

  if (isDownloaded()) {
    loadThumbPromise = loadPromise = (await load()).render
  } else {
    if (!lazyLoadQueue) loadPromise = (await load()).render
    // очередь реджектит снятые задачи (`clear()`) — гасим, чтобы не всплывало
    else void lazyLoadQueue.push(() => load().then(({ download }) => download), isVisible).catch(noop)
  }

  if (loadPromises && loadThumbPromise) {
    loadPromises.push(loadThumbPromise)
  }

  ret.loadPromises.thumb = loadThumbPromise
  ret.loadPromises.full = loadPromise || Promise.resolve()
  ret.preloader = preloader || null

  return ret
}
