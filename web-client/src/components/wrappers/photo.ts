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
 *  • вход — `photo: MyPhoto | MyDocument` и `size: PhotoSize`, как в оригинале.
 *    Не портированы ветки `isWebFile`/`isWebDoc` и ранний выход «у медиа нет ни
 *    `sizes`, ни `thumbs`» (photo.ts:71-93): `WebDocument`/
 *    `InputWebFileLocation` — медиа инлайн-ботов и веб-карточек MTProto,
 *    которого в нашей модели нет вообще (`core/media/messageMedia.ts`);
 *  • ступень выбирает `choosePhotoSize` (порт), а `photoSizeEmpty` заменён
 *    ОТСУТСТВИЕМ ступени: наш `choosePhotoSize` возвращает `undefined` там, где
 *    оригинал — заглушку `{_: 'photoSizeEmpty'}` (в модели «размера нет» это
 *    отсутствующий элемент массива, см. шапку `messageMedia.ts`). Поэтому
 *    условие раннего выхода `size._ === 'photoSizeEmpty' && isDocument`
 *    (photo.ts:207) записано как `!size && isDocument`;
 *  • выбранная ступень → адрес файла: у `downloadMediaURL` оригинала ступень
 *    едет параметром `thumb: size`, у нашего медиа-эндпоинта тот же выбор
 *    выражается булевым `thumb` — серверное превью (ступень `y`) против
 *    оригинала (`w`);
 *  • ветка `size._ === 'videoSize'` (photo.ts:213-218, `<video autoplay loop
 *    muted class="media-photo">`) — это MTProto `videoSize`, анимированная
 *    обложка (профиля/эмодзи-статуса), а не видео сообщения; такого
 *    конструктора в модели нет. Видео сообщения рисует `wrapVideo`;
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
import {
  choosePhotoSize,
  getStrippedThumb,
  THUMB_TYPE_FULL,
  THUMB_TYPE_SERVER,
  type MyDocument,
  type MyPhoto,
  type PhotoSize,
} from '@core/media/messageMedia'
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
  /** вложение сообщения (tweb `photo`) — фотография либо документ */
  photo: MyPhoto | MyDocument
  /**
   * Ступень лестницы, которую показываем (tweb `size`). Не задана — её выберет
   * `choosePhotoSize` по боксу, как в оригинале.
   */
  size?: PhotoSize
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
    photo, container, isVisible, middleware,
    loadPromises, noBlur, noThumb, noFadeIn, blurAfter, processUrl, fadeInElement,
    onRender, onRenderFinish, useBlur, useRenderCache, hasMessage, hasMessageBlock,
    canHaveVideoPlayer, uploadPromise,
  } = options
  const { withoutPreloader, lazyLoadQueue } = options
  let size = options.size

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

  // tweb photo.ts:71-73 — вопросы к САМОМУ вложению, а не к флагам вызывающего
  const isDocument = photo._ === 'document'
  // tweb photo.ts:73: картинка, приехавшая документом (настоящий `image/gif`
  // из `wrapVideo`). Своей ступени у неё нет — ею работает сам файл.
  const isImageFromDocument = isDocument && photo.mime_type.startsWith('image/') && !size
  const strippedThumb = getStrippedThumb(photo)

  // tweb photo.ts:95-100 — бокс нужен только когда ступень ещё не выбрана
  let { boxWidth, boxHeight } = options
  if (!size) {
    if (boxWidth === undefined) boxWidth = mediaSizes.active.regular.width
    if (boxHeight === undefined) boxHeight = mediaSizes.active.regular.height
  }

  container.classList.add('media-container')
  let aspecter = container

  let isFit = true
  let loadThumbPromise: Promise<unknown> = Promise.resolve()
  let thumbImage: HTMLImageElement | HTMLCanvasElement | undefined

  if (boxWidth && boxHeight && !size) { // !album
    // Ступень оригинал выбирает внутри `setAttachmentSize` и оттуда же забирает
    // (`size = set.photoSize`); наш `setAttachmentSize` (`core/dom/mediaSizes`)
    // считает только бокс, поэтому выбор стоит перед ним — той же функцией.
    size = isImageFromDocument ?
      // tweb photo.ts:120-126 — у картинки-документа ступень собирается из него
      // самого (`THUMB_TYPE_FULL`), лестница тут ни при чём
      { _: 'photoSize', w: photo.w ?? 0, h: photo.h ?? 0, size: photo.size, type: THUMB_TYPE_FULL } :
      choosePhotoSize(photo, boxWidth, boxHeight)

    // размер контейнера ставит сам `setAttachmentSize` (`boxSize`), как в
    // оригинале (setAttachmentSize.ts:102-103). Натуральную геометрию он берёт
    // так же: у документа — его собственную (`photo.w`), у фотографии — у
    // выбранной ступени (setAttachmentSize.ts:52-62).
    const sized = size && 'w' in size ? size : undefined
    const set = setAttachmentSize({
      width: (isDocument ? photo.w || sized?.w : sized?.w) || 0,
      height: (isDocument ? photo.h || sized?.h : sized?.h) || 0,
      element: container,
      boxWidth,
      boxHeight,
      hasMessage,
      hasMessageBlock,
      isDocument,
      documentType: isDocument ? photo.type : undefined,
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
          // то же медиа и та же ступень, что и во внешнем вызове
          // (tweb photo.ts:155,157)
          photo,
          size,
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
  } else if (!size) {
    // tweb photo.ts:179-183 — без бокса (ячейка альбома, рекурсивная подложка)
    // ступень всё равно нужна: по ней адресуется файл и по ней же решается
    // ранний выход ниже. Параметр `useBytes` оригинала сюда не едет — см.
    // отступление в шапке `choosePhotoSize` (`core/media/messageMedia.ts`).
    size = choosePhotoSize(photo, boxWidth, boxHeight)
  }

  // Ступень → файл на нашем медиа-эндпоинте: серверное превью (`y`) против
  // оригинала (`w`). У tweb этот же выбор едет объектом ступени в
  // `downloadMediaURL({media, thumb: size})`.
  const thumb = size?.type === THUMB_TYPE_SERVER
  // tweb photo.ts:207 `(size as photoStrippedSize)?.bytes` — выбранная ступень
  // САМА является байтами превью.
  const isStrippedSize = !!size && 'bytes' in size

  // Наш `cacheContext.downloaded`: попадание в зеркало URL. Геттер, а не
  // значение — tweb перечитывает кэш-контекст внутри `load()` (photo.ts:309).
  //
  // У stripped-ступени своего файла в кэше нет по построению (байты приезжают
  // в самом сообщении), поэтому `getCacheContext(photo, 'i')` у оригинала
  // всегда «не скачано» — и превью строится, даже когда полный файл на руках.
  const isDownloaded = () => !isStrippedSize && cachedMediaUrl(photo.id, thumb) !== undefined

  if (!noThumb) {
    const gotThumb = getMediaThumbIfNeeded({
      strippedThumb,
      downloaded: isDownloaded(),
      // tweb выводит его внутри самого хелпера (getStrippedThumbIfNeeded.ts:22);
      // у нашего порта это параметр — вопрос к медиа задаётся здесь
      isVideo: isDocument && (photo.type === 'video' || photo.type === 'gif'),
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

  // tweb photo.ts:207-209 — показывать больше нечего: у документа не нашлось
  // подходящей ступени (у оригинала это `photoSizeEmpty`, у нас — отсутствие
  // ступени) либо выбранная ступень САМА является байтами превью. Превью,
  // построенное выше, УЖЕ стоит в слоте медиа (`media-photo` в
  // аспектере/контейнере — не подложка на весь бокс, которую кладёт ветка
  // `!isFit`). Ни полного `<img>`, ни кольца, ни запроса байтов здесь нет.
  if ((!size && isDocument) || isStrippedSize) {
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
      const cached = cachedMediaUrl(photo.id, thumb)
      return cached === undefined ? Promise.reject(NO_AUTO_DOWNLOAD_ERROR) : Promise.resolve(cached)
    }

    return ensureMediaUrl(photo.id, { thumb, middleware })
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
  // tweb photo.ts:297-301: на мелком медиа кольца нет — оно там больше картинки.
  // Размеры — у ВЫБРАННОЙ ступени, как в оригинале.
  const preloaderSize = size && 'w' in size ? size : undefined
  const canAttachPreloader =
    ((preloaderSize?.w ?? 0) >= MIN_PRELOADER_SIDE && (preloaderSize?.h ?? 0) >= MIN_PRELOADER_SIDE) ||
    !!noAutoDownload
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
