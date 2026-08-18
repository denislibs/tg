/**
 * Порт tweb `src/components/wrappers/video.ts` (`wrapVideo`) — ванильный: DOM
 * строится императивно, контейнер приходит снаружи, временем жизни поколения
 * владеет `middleware`.
 *
 * ── Дерево, которое строит функция (живые дампы tweb, `docs/tweb/dom/dumps/`) ─
 * Обычное видео (`03-video-poll.json`) — слой видео поверх постера:
 *   div.attachment.media-container.media-container-fitted [style="width: 320px; height: 400px;"]
 *     span.video-time                                  ← таймкод/GIF-бейдж
 *       span.tgico.video-time-icon                     ← «без звука» у автоплея
 *     canvas.canvas-thumbnail.thumbnail.media-photo    ← stripped-подложка
 *     div.media-container-aspecter [style="width: 300px; height: 400px;"]
 *       img.media-photo                                ← постер
 *       video.media-video                              ← само видео
 * Кружок (`03-service-round.json`) — своя коробка внутри контейнера:
 *   div.attachment.media-container.no-background [style="width: 400px; height: 400px;"]
 *     div.media-round.z-depth-1.is-paused [data-mid data-peer-id]
 *       canvas.video-round-canvas                      ← кадры играющего звука
 *       span.video-time > span.tgico.video-time-icon
 *       svg.progress-ring [style="transform: rotate(-90deg);"]
 *         circle.progress-ring__circle
 *       video.media-video                              ← muted-превью в цикле
 *
 * ── Как оригинал ложится на нашу модель ─────────────────────────────────────
 *  • вход — `doc` с плоскими полями вместо MTProto `MyDocument`; собирает его
 *    `videoDocFromMessage` (единственное место, где `Message` превращается в
 *    `doc`, — им пользуются и альбом, и будущий бабл). `doc.type` там считается
 *    ровно по данным сервера: `roundVideo` → `round`, `media_animated` → `gif`
 *    (порт tweb `documentAttributeAnimated` → `doc.type === 'gif'`), иначе
 *    `video`. Эвристика `core/gifs.ts::isGifLike` сюда не тянется: она гадает по
 *    имени файла и нужна там, где серверного признака нет по построению
 *    (Tenor, локальный файл до отправки);
 *  • АДРЕС ВИДЕО — не картиночный конвейер. Картинки едут `ensureMediaUrl`
 *    (objectURL воркера), а `<video>` стримит: `resolveStreamUrl`
 *    (`core/mediaUrl.ts`). При DNP-ON он резолвится АСИНХРОННО (уходит на
 *    `/dnp-stream/{id}`), поэтому путь назначения `src` здесь всегда через
 *    промис — синхронной ветки «src сразу» нет вовсе. Токен живёт 15 минут, и
 *    открытое видео обязано пережить его смену: `subscribeMediaToken`
 *    пересобирает `src`, сохраняя позицию и состояние воспроизведения
 *    (при DNP-ON подписки нет — в адресе `/dnp-stream/{id}` токена нет);
 *  • `supportsStreaming` (`documentAttributeVideo.supports_streaming`) у нас
 *    ИСТИННО ВСЕГДА, и это проверено по бэкенду: media-эндпоинт отдаёт файл
 *    через `http.ServeContent` (`media_handler.go:318` — «handles Range/206»),
 *    то есть любое медиа стримится по построению, а нестримовых документов, как
 *    в MTProto, у нас не бывает. Поэтому из трёх веток прелоадера оригинала
 *    (video.ts:503-529) исполнимы две — аплоад и стрим (`cancelable: false`), а
 *    третья («скачать файл целиком, потому что стрим не поддерживается») вместе
 *    с `apiManagerProxy.getCacheContext(doc).downloaded` осталась бы мёртвым
 *    кодом: условия `!supportsStreaming` не наступает;
 *  • `appDownloadManager.getUpload(uploadingFileName)` → `uploadPromise`:
 *    реестра аплоадов по имени файла у нас нет, промис прогресса даёт
 *    вызывающий (так же сделано в `wrapPhoto`);
 *  • `photoSize`/`videoSize`/`altDoc` (лестница `PhotoSize`, HEVC-дубль,
 *    анимированная обложка) — сущностей нет в модели: у медиа один id и два
 *    размера (`thumb: true|false`). Вместе с `altDoc` отпадает и ветка
 *    `<source>`-ов с `video.load()`;
 *  • постер: как и в оригинале, его целиком рисует `wrapPhoto` — одной веткой,
 *    без развилки «есть серверный постер / нет». Развилка живёт ВНУТРИ
 *    аргументов: tweb выбирает размер документа (`choosePhotoSize`), и если
 *    единственный подходящий — stripped, `wrapPhoto` показывает его КАК медиа
 *    (ранний выход photo.ts:208). У нас размеров два, поэтому тот же выбор
 *    записан парой `thumb: doc.hasThumb` / `strippedSize: !doc.hasThumb`.
 *    Ветка `getStrippedThumbIfNeeded` осталась ровно там же, где в оригинале, —
 *    у медиа БЕЗ сообщения (`* gifs masonry`, video.ts:454-479).
 *
 * ── ЧТО ЕЩЁ НЕ ПЕРЕНЕСЕНО (каждое — заявка на отдельную задачу, не «нам не надо») ─
 *  • ВЕСЬ блок мини-плеера/наблюдателя звука (video.ts:728-949, `willObserveSound`,
 *    `VideoPlayer`, `setSingleMedia`, `toggleVideoAutoplaySound`). Он включается
 *    только при `observer && USE_VIDEO_OBSERVER`, а `USE_VIDEO_OBSERVER = false`
 *    КОНСТАНТОЙ (video.ts:51): в самом tweb эта ветка сейчас не исполняется ни
 *    разу (`bubbles.ts:4101,4157` читают её как `!USE_VIDEO_OBSERVER`). Перенос
 *    тянет за собой `SuperIntersectionObserver`, события контроллера
 *    (`toggleVideoAutoplaySound`/`playbackParams`/`setSingleMedia`) и монтаж
 *    `VideoPlayer` в бабл — объём отдельной задачи, а не строчка здесь;
 *  • `withTail` (video.ts:448-453) — вставка видео в `<foreignObject>` хвоста
 *    бабла. Ветка не исполняется и в самом tweb: единственное место, которое
 *    создавало этот `<foreignObject>`, — `if(withTail) {` в `wrapPhoto`
 *    (photo.ts:110), и оно ЗАКОММЕНТИРОВАНО, так что `photoRes.images.*`
 *    всегда лежат в обычном контейнере, а `getAttributeNS(null, 'width')` вернул
 *    бы null. Хвост в обеих кодовых базах рисует CSS;
 *  • `handleVideoLeak` (`helpers/dom/handleVideoLeak.ts`) — подсистема обхода
 *    утечки декодера Chromium (глобальные слушатели `seeked/canplay/seeking`,
 *    `getVideoPlaybackQuality`, пересборка `<source>`). Отдельный файл-хелпер
 *    целиком, вместе с `fixChromiumMp4` (см. шапку `helpers/onMediaLoad.ts`);
 *  • `searchContext` кружка (`appMediaPlaybackController.setSearchContext` +
 *    `findMediaTargets`, video.ts:370-378) — плейлист «следующее голосовое/кружок»
 *    сканом соседей в ленте. `findMediaTargets` живёт в `components/audio.ts`, а
 *    `setSearchContext`/`resolveWaitingForLoadMedia` — в контроллере коллекции;
 *    оба файла правятся не этой задачей;
 *  • `altDoc` (HEVC-дубль, video.ts:666-693) и `videoSize` (анимированная
 *    обложка) — понятия транспорта Telegram: у одного документа два кодека и
 *    лестница `PhotoSize`. Наш медиа-конвейер отдаёт один файл на `media_id`,
 *    предмета нет до появления второй кодировки на бэкенде;
 *  • `uploadingFileName` в форме tweb (`appDownloadManager.getUpload(name)` —
 *    реестр живых аплоадов по имени файла): у нас его роль играет
 *    `uploadPromise`, как и в уже принятом `wrapPhoto`. Приведение обоих
 *    врапперов к форме оригинала = заводить реестр аплоадов, то есть править
 *    `wrapPhoto` и путь отправки — соседние задачи.
 */
import animationIntersector, { type AnimationItemGroup } from '@components/animationIntersector'
import Icon from '@components/icon'
import ProgressivePreloader from '@components/preloader'
import { createProgressRing, getProgressRingRadius } from '@components/progressRing'
import wrapPhoto, { type WrappedPhoto } from '@components/wrappers/photo'
import { mediaPlayback } from '@core/audio/mediaPlaybackController'
import mediaSizesInstance, { ScreenSize } from '@core/dom/mediaSizes'
import type { ChatAutoDownload } from '@core/hooks/useChatAutoDownload'
import type { LazyLoadQueue } from '@core/lazyLoadQueue'
import getMediaThumbIfNeeded from '@core/media/getStrippedThumbIfNeeded'
import { cachedMediaUrl } from '@core/mediaCache'
import { resolveStreamUrl, subscribeMediaToken } from '@core/mediaUrl'
import type { Message } from '@core/models'
import { IS_SAFARI } from '@environment/userAgent'
import { animateSingle } from '@helpers/animation'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import createVideo from '@helpers/dom/createVideo'
import safePlay from '@helpers/dom/safePlay'
import onMediaLoad, { shouldIgnoreVideoError } from '@helpers/onMediaLoad'
import liteMode from '@helpers/liteMode'
import makeError from '@helpers/makeError'
import type { Middleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import { fastRaf } from '@helpers/schedulers'
import throttle from '@helpers/schedulers/throttle'
import sequentialDom from '@helpers/sequentialDom'
import { AppConfig } from '@config/app'
import { formatVideoTime } from '@components/messages/videoPlayback'

/** tweb video.ts:50 — видео крупнее 50 МБ инлайн не автоплеится */
const MAX_VIDEO_AUTOPLAY_SIZE = 50 * 1024 * 1024

/** автозагрузка выключена: ждём клика по manual-кольцу (tweb `makeError('NO_AUTO_DOWNLOAD')`) */
const NO_AUTO_DOWNLOAD_ERROR = makeError('NO_AUTO_DOWNLOAD')

/** tweb video.ts:53 — длина окружности кольца кружка, общая на все кружки */
let roundVideoCircumference = 0

/**
 * tweb video.ts:54-74 — на смене брейкпоинта размер кружка меняется
 * (`HANDHELDS.round` ≠ `DESKTOP.round`), и ВСЕ живые кольца в ленте
 * пересчитываются на месте: заново атрибуты svg/circle и полный (пустой)
 * `stroke-dashoffset`. Пересборки бабла при этом не происходит, поэтому без
 * этого обработчика кольцо осталось бы прежнего диаметра поверх кружка нового.
 * Радиус считает та же формула, что при создании (`getProgressRingRadius`) —
 * ровно для этого она и общая.
 */
mediaSizesInstance.addEventListener('changeScreen', (from, to) => {
  if (to === ScreenSize.mobile || from === ScreenSize.mobile) {
    const elements = Array.from(document.querySelectorAll<SVGSVGElement>('.media-round .progress-ring'))
    const width = mediaSizesInstance.active.round.width
    const halfSize = width / 2
    const radius = getProgressRingRadius(width)
    roundVideoCircumference = 2 * Math.PI * radius
    elements.forEach((element) => {
      element.setAttributeNS(null, 'width', '' + width)
      element.setAttributeNS(null, 'height', '' + width)

      const circle = element.firstElementChild as SVGCircleElement
      circle.setAttributeNS(null, 'cx', '' + halfSize)
      circle.setAttributeNS(null, 'cy', '' + halfSize)
      circle.setAttributeNS(null, 'r', '' + radius)

      circle.style.strokeDasharray = roundVideoCircumference + ' ' + roundVideoCircumference
      circle.style.strokeDashoffset = '' + roundVideoCircumference
    })
  }
})

/**
 * Текст таймкода — tweb пишет `spanTime.firstChild.nodeValue` (video.ts:303):
 * важно менять ИМЕННО текстовый узел, иконка «без звука» лежит рядом и
 * `textContent = …` снёс бы её.
 */
function setTimeText(spanTime: HTMLElement, text: string): void {
  const first = spanTime.firstChild
  if (first && first.nodeType === Node.TEXT_NODE) first.nodeValue = text
  else spanTime.prepend(document.createTextNode(text))
}

/** Плоский аналог tweb `MyDocument` для видео-путей. */
export interface WrapVideoDoc {
  /** файл на медиа-эндпоинте (tweb `doc.id`) */
  id: number
  /** tweb `doc.type` */
  type: 'video' | 'gif' | 'round'
  /** натуральные пиксели (tweb `doc.w`/`doc.h`) */
  width?: number
  height?: number
  /** длительность в секундах (tweb `doc.duration`) */
  duration?: number
  /** размер файла (tweb `doc.size`) — гейт автоплея */
  size?: number
  /** MIME (tweb `doc.mime_type`) */
  mime?: string
  /** stripped-JPEG превью из payload сообщения (tweb `photoStrippedSize.bytes`) */
  strippedThumb?: string
  /** у медиа есть серверный постер (наш аналог «есть подходящий `PhotoSize`») */
  hasThumb?: boolean
}

/** То, что врапперу нужно от сообщения (tweb передаёт весь `Message.message`). */
export interface WrapVideoMessage {
  /** tweb `message.mid` */
  mid?: number
  /** tweb `message.peerId` */
  peerId?: number
  /** кружок ещё не просмотрен (tweb `message.pFlags.media_unread`) */
  mediaUnread?: boolean
  /** сообщение ещё не отправлено (tweb `message.pFlags.is_outgoing`; у нас id < 0) */
  isOutgoing?: boolean
}

export interface WrapVideoOptions {
  doc: WrapVideoDoc
  container?: HTMLElement
  message?: WrapVideoMessage
  boxWidth?: number
  boxHeight?: number
  middleware?: Middleware
  lazyLoadQueue?: LazyLoadQueue | false
  /** живой геттер видимости цели — приоритезация внутри очереди */
  isVisible?: () => boolean
  /** не рисовать `.video-time`/кнопку воспроизведения (tweb `noInfo`) */
  noInfo?: boolean
  noPlayButton?: boolean
  /** группа `animationIntersector` (tweb `group`) */
  group?: AnimationItemGroup
  /** только постер, видео не грузить (tweb `onlyPreview`) */
  onlyPreview?: boolean
  /** не строить превью вовсе (tweb `noPreview`) */
  noPreview?: boolean
  /** превью нужно, даже когда сообщения нет (tweb `withPreview`) */
  withPreview?: boolean
  withoutPreloader?: boolean
  loadPromises?: Promise<unknown>[]
  autoDownload?: ChatAutoDownload
  /** явное решение про автоплей (tweb `canAutoplay`) */
  canAutoplay?: boolean
  /** не ставить `autoplay` атрибут (tweb `noAutoplayAttribute`) — элемент альбома */
  noAutoplayAttribute?: boolean
  useBlur?: boolean | number
  /** промис отгрузки файла (tweb `appDownloadManager.getUpload(uploadingFileName)`) */
  uploadPromise?: CancellablePromise<unknown>
  /** у сообщения есть подпись/reply/webpage — tweb расширяет бокс (для `wrapPhoto`) */
  hasMessageBlock?: boolean
  /** tweb `onLoad` — видео отдало первый кадр */
  onLoad?: () => void
}

/** tweb `(container as any).preloader` (video.ts:706) — кольцо на контейнере. */
type ContainerWithPreloader = HTMLElement & { preloader?: ProgressivePreloader }

/** tweb `(divRound as any as AudioElement).onLoad` (video.ts:401) — отложенный старт кружка. */
type RoundElement = HTMLElement & { onLoad?: () => void, message?: WrapVideoMessage }

export interface WrappedVideo {
  /** tweb `res.thumb` */
  thumb?: WrappedPhoto
  /** tweb `res.video` */
  video?: HTMLVideoElement
  /** tweb `res.loadPromise` */
  loadPromise: Promise<unknown>
  /** кольцо загрузки; tweb отдаёт его через `(container as any).preloader` */
  preloader?: ProgressivePreloader
}

/**
 * `Message` → `doc` враппера. ЕДИНСТВЕННОЕ место, где решается тип медиа для
 * видео-путей: `roundVideo` → кружок, серверный `media_animated` → гифка (порт
 * `documentAttributeAnimated`), иначе видео. Возвращает `null`, если качать
 * нечего — платное медиа до оплаты приезжает без `media_id`.
 */
export function videoDocFromMessage(message: Message): WrapVideoDoc | null {
  if (message.mediaId == null) return null

  return {
    id: message.mediaId,
    type: message.type === 'roundVideo' ? 'round' : message.mediaAnimated ? 'gif' : 'video',
    width: message.mediaWidth,
    height: message.mediaHeight,
    duration: message.mediaDuration,
    size: message.mediaSize,
    mime: message.mediaMime,
    strippedThumb: message.mediaBlur,
    hasThumb: message.mediaHasThumb,
  }
}

export default async function wrapVideo(options: WrapVideoOptions): Promise<WrappedVideo> {
  const {
    doc, container, message, boxWidth, boxHeight, middleware, lazyLoadQueue, isVisible,
    noInfo, noPlayButton, group, onlyPreview, noPreview, withPreview, withoutPreloader,
    loadPromises, autoDownload, noAutoplayAttribute, useBlur, uploadPromise,
    hasMessageBlock, onLoad,
  } = options

  // tweb video.ts:120-123 — гифка адресуема из ленты по `data-doc-id`
  if (doc.type === 'gif' && container) {
    container.classList.add('media-gif-wrapper')
    container.dataset.docId = '' + doc.id
  }

  let noAutoDownload: boolean | undefined = autoDownload?.video === 0
  // tweb video.ts:127 — элемент альбома приходит без бокса (его задаёт грид)
  const isGroupedItem = !(boxWidth && boxHeight)
  // tweb video.ts:129-136
  const canAutoplay = options.canAutoplay ?? (
    (
      doc.type !== 'video' || (
        (doc.size ?? 0) <= MAX_VIDEO_AUTOPLAY_SIZE &&
        !isGroupedItem
      )
    ) && (doc.type === 'gif' ? liteMode.isAvailable('gif') : liteMode.isAvailable('video'))
  )

  let spanTime: HTMLElement | undefined, spanPlay: HTMLElement | undefined

  // tweb video.ts:140-177 — таймкод/бейдж и кнопка воспроизведения
  if (!noInfo && container) {
    spanTime = document.createElement('span')
    spanTime.classList.add('video-time')
    container.append(spanTime)

    let needPlayButton = false
    if (doc.type !== 'gif') {
      setTimeText(spanTime, formatVideoTime(doc.duration ?? 0))

      if (!noPlayButton && doc.type !== 'round') {
        if (canAutoplay && !noAutoDownload) {
          spanTime.append(Icon('nosound', 'video-time-icon'))
        } else {
          needPlayButton = true
        }
      }
    } else {
      setTimeText(spanTime, 'GIF')

      if (!canAutoplay && !noPlayButton) {
        needPlayButton = true
        noAutoDownload = undefined
      }
    }

    if (needPlayButton) {
      // tweb `Button('btn-circle video-play position-center', {icon: 'largeplay', noRipple: true})`
      spanPlay = document.createElement('button')
      spanPlay.className = 'btn-circle video-play position-center'
      spanPlay.append(Icon('largeplay', 'button-icon'))
      container.append(spanPlay)
    }
  }

  const res: WrappedVideo = { loadPromise: Promise.resolve() }

  // tweb video.ts:185-208 — настоящий image/gif это КАРТИНКА, её рисует wrapPhoto
  if (doc.mime === 'image/gif' && container) {
    const photoRes = await wrapPhoto({
      mediaId: doc.id,
      width: doc.width,
      height: doc.height,
      strippedThumb: doc.strippedThumb,
      container,
      boxWidth,
      boxHeight,
      lazyLoadQueue,
      isVisible,
      middleware,
      withoutPreloader,
      loadPromises,
      autoDownloadSize: autoDownload?.video,
      useBlur,
      hasMessageBlock,
      uploadPromise,
    })

    res.thumb = photoRes
    res.loadPromise = photoRes.loadPromises.full
    return res
  }

  let preloader: ProgressivePreloader | undefined

  const video = createVideo({ middleware })
  video.classList.add('media-video')
  video.muted = true

  if (doc.type === 'round') {
    wrapRound({ doc, message, container, video, spanTime, middleware, noAutoDownload, getPreloader: () => preloader })
  } else if (!noAutoplayAttribute && !uploadPromise) {
    video.autoplay = true // для safari (комментарий tweb video.ts:407)
  }

  let photoRes: WrappedPhoto | undefined
  if (message || onlyPreview || withPreview) {
    if (container) { // наш `wrapPhoto` требует контейнер (см. его шапку)
      photoRes = await wrapPhoto({
        mediaId: doc.id,
        // Наш аналог `choosePhotoSize(doc, …)` из оригинала: у документа
        // выбирается ЕДИНСТВЕННЫЙ подходящий размер. Есть серверный постер —
        // это он (`thumb: true`); нет — им оказывается stripped из самого
        // сообщения, и тогда `wrapPhoto` показывает его КАК медиа, ничего не
        // скачивая (`strippedSize`, ранний выход photo.ts:208). Без этого
        // враппер потянул бы в `<img>` полный mp4.
        thumb: doc.hasThumb,
        strippedSize: !doc.hasThumb,
        width: doc.width,
        height: doc.height,
        strippedThumb: doc.strippedThumb,
        container,
        boxWidth,
        boxHeight,
        lazyLoadQueue,
        isVisible,
        middleware,
        withoutPreloader: true,
        loadPromises,
        autoDownloadSize: autoDownload?.photo,
        useBlur,
        hasMessageBlock,
        canHaveVideoPlayer: doc.type === 'video',
        uploadPromise,
      })

      res.thumb = photoRes
    }

    // tweb video.ts:434-446 — без автоплея видео не грузится вовсе: показан
    // постер, дальше решает клик (лайтбокс/кнопка).
    if ((!canAutoplay && doc.type !== 'gif') || onlyPreview) {
      if (uploadPromise && container && !onlyPreview) {
        preloader = new ProgressivePreloader({ attachMethod: 'prepend', isUpload: true })
        preloader.attachPromise(uploadPromise)
        preloader.attach(container, false)
        res.preloader = preloader
      }

      res.loadPromise = photoRes ? photoRes.loadPromises.full : res.loadPromise
      return res
    }
  } else if (!noPreview) { // * gifs masonry (комментарий tweb video.ts:454)
    // Медиа БЕЗ сообщения: сообщения нет — значит нет и вызывающего, который
    // решил бы про размер, поэтому кадр строится прямо из stripped-превью.
    // `isVideo` тут не декорация (tweb выводит его из `doc.type`): у видео
    // «скачано» относится к файлу, а не к первому кадру, и без него подложка
    // снималась бы у уже виденного медиа, оставляя пустой прямоугольник.
    const gotThumb = getMediaThumbIfNeeded({
      strippedThumb: doc.strippedThumb,
      downloaded: cachedMediaUrl(doc.id) !== undefined,
      isVideo: true,
      useBlur: useBlur ?? true,
    })
    if (gotThumb) {
      const thumbImage = gotThumb.image
      thumbImage.classList.add('media-poster')
      container?.append(thumbImage)
      res.thumb = {
        loadPromises: { thumb: gotThumb.loadPromise, full: Promise.resolve() },
        images: { thumb: thumbImage, full: null },
        preloader: null,
        aspecter: null,
      }

      loadPromises?.push(gotThumb.loadPromise)
      res.loadPromise = gotThumb.loadPromise
    }
  }

  // ! do not append before load or will get `URL safety check` error
  // (комментарий tweb video.ts:486)
  const appendVideo = () => {
    (photoRes?.aspecter ?? container)?.append(video)
  }

  // tweb video.ts:491-493: элемент с ГОТОВЫМ постером (`video.poster`) можно
  // вставлять сразу — пустого кадра не будет. Атрибут `poster` не проставляет
  // ни один вызывающий (постер у tweb — отдельный `<img>` от `wrapPhoto`),
  // поэтому на практике работает вставка по первому кадру ниже.
  if (!video.parentElement && container && video.poster) {
    appendVideo()
  }

  if (uploadPromise && container) { // means upload
    preloader = new ProgressivePreloader({ attachMethod: 'prepend', isUpload: true })
    preloader.attachPromise(uploadPromise)
    preloader.attach(container, false)
    noAutoDownload = undefined

    // * autoplay is suppressed while the upload is in progress, and the bubble
    // * isn't re-rendered on send — resume playback once the upload completes
    // (комментарий tweb video.ts:512-513)
    if (!noAutoplayAttribute && doc.type !== 'round') {
      void uploadPromise.then(() => {
        if (middleware && !middleware()) return
        safePlay(video)
      }, noop)
    }
  } else if (!withoutPreloader) {
    // Стрим (tweb video.ts:524-529): кольцо неотменяемое — рвать нечего,
    // байты тянет сам <video>.
    preloader = new ProgressivePreloader({ cancelable: false, attachMethod: 'prepend' })
  }
  res.preloader = preloader

  const renderDeferred = deferredPromise<void>()
  video.addEventListener('error', (e) => {
    if (shouldIgnoreVideoError(e)) {
      return
    }

    if (video.error && video.error.code !== 4) {
      console.error('Error ' + video.error.code + '; details: ' + video.error.message)
    }

    if (preloader && !uploadPromise) {
      preloader.detach()
    }

    if (!renderDeferred.isFulfilled) {
      renderDeferred.resolve!()
    }
  }, { once: true })

  // tweb video.ts:550-572 — таймкод считает ОСТАТОК, кнопка снимается на первом
  // же кадре воспроизведения
  if (doc.type === 'video' && spanTime) {
    const timeElement = spanTime
    const onTimeUpdate = () => {
      if (!video.duration) return
      setTimeText(timeElement, formatVideoTime(video.duration - video.currentTime))
    }

    const throttledTimeUpdate = throttle(() => { fastRaf(onTimeUpdate) }, 1e3, false)
    video.addEventListener('timeupdate', throttledTimeUpdate)

    if (spanPlay) {
      const playButton = spanPlay
      video.addEventListener('timeupdate', () => {
        void sequentialDom.mutateElement(playButton, () => { playButton.remove() })
      }, { once: true })
    }
  }

  video.muted = true
  video.loop = true
  if (!noAutoplayAttribute && !uploadPromise) {
    video.autoplay = true
  }

  let loadPhotoThumbFunc = noAutoDownload ? photoRes?.preloader?.loadFunc : undefined

  // Текущий адрес стрима: сравнивается при смене токена (пересобирать один и
  // тот же URL — значит дёрнуть буфер видео зря).
  let currentUrl: string | undefined

  const setSrc = (url: string) => {
    currentUrl = url
    video.src = url
  }

  const load = async () => {
    if (preloader && noAutoDownload && !withoutPreloader) {
      preloader.construct?.()
      preloader.setManual()
    }

    let loadPromise: Promise<string>
    if (noAutoDownload) {
      loadPromise = Promise.reject(NO_AUTO_DOWNLOAD_ERROR)
    } else {
      // Единственный вход за адресом стрима. При DNP-ON он асинхронный
      // (`/dnp-stream/{id}` считается воркером), поэтому ветка одна на оба режима.
      loadPromise = Promise.resolve(resolveStreamUrl(doc.id))

      if (preloader && !uploadPromise && container) {
        preloader.attach(container, false)
        video.addEventListener(IS_SAFARI ? 'timeupdate' : 'canplay', () => {
          preloader?.detach()
        }, { once: true })
      }
    }

    void loadPromise.catch(noop)

    if (!noAutoDownload && loadPhotoThumbFunc) {
      loadPhotoThumbFunc()
      loadPhotoThumbFunc = undefined
    }

    noAutoDownload = undefined

    void loadPromise.then((url) => {
      if (middleware && !middleware()) {
        renderDeferred.resolve!()
        return
      }

      const onError = (err: unknown) => {
        console.error('video load error', video, err)
        if (spanTime) {
          spanTime.classList.add('is-error')
          const previousIcon = spanTime.querySelector('.video-time-icon')
          const newIcon = Icon('sendingerror', 'video-time-icon')
          if (previousIcon) previousIcon.replaceWith(newIcon)
          else spanTime.append(newIcon)
        }
        renderDeferred.reject!(err)
      }

      onMediaLoad(video).then(() => {
        if (middleware && !middleware()) {
          renderDeferred.resolve!()
          return
        }

        if (group) {
          animationIntersector.addAnimation({
            animation: video,
            group,
            observeElement: video,
            controlled: middleware,
            type: 'video',
          })
        }

        if (preloader && !uploadPromise) {
          preloader.detach()
        }

        if (!video.parentElement && container && !video.poster) {
          appendVideo()
        }

        renderDeferred.resolve!()
        onLoad?.()
      }, onError)

      setSrc(url)
      subscribeToToken()
    }, noop)

    const render = Promise.all([loadPromise, renderDeferred])
    void render.catch(noop)
    return { download: loadPromise, render }
  }

  // Смена медиа-токена: адрес стрима подписан токеном и живёт 15 минут — без
  // пересборки открытое видео получит 401 на середине буфера. При DNP-ON
  // подписки нет: в `/dnp-stream/{id}` токена нет, пересобирать нечего.
  let unsubscribeToken: (() => void) | undefined
  const subscribeToToken = () => {
    if (AppConfig.dnp.enabled || unsubscribeToken) return

    unsubscribeToken = subscribeMediaToken(() => {
      if (middleware && !middleware()) return

      void Promise.resolve(resolveStreamUrl(doc.id)).then((url) => {
        if (middleware && !middleware()) return
        if (url === currentUrl) return

        const { currentTime } = video
        const wasPlaying = !video.paused
        setSrc(url)
        if (currentTime) {
          video.addEventListener('loadedmetadata', () => { video.currentTime = currentTime }, { once: true })
        }
        if (wasPlaying) safePlay(video)
      }, noop)
    })

    middleware?.onClean(() => {
      unsubscribeToken?.()
      unsubscribeToken = undefined
    })
  }

  if (preloader && !uploadPromise) {
    preloader.setDownloadFunction(load)
  }

  // tweb video.ts:706 — кольцо живёт на самом контейнере: бабл ленты
  // (`chat/bubbles.ts`) достаёт его оттуда, когда пересобирает медиа на месте.
  if (container) (container as ContainerWithPreloader).preloader = preloader

  // tweb video.ts:708-718 — гифка без автоплея грузится по клику, всё остальное
  // либо сразу, либо очередью.
  if (doc.type === 'gif' && !canAutoplay && container) {
    attachClickEvent(container, (e) => {
      cancelEvent(e)
      spanPlay?.remove()
      void load()
    }, { capture: true, once: true })
  } else if (!lazyLoadQueue) {
    res.loadPromise = (await load()).render
    void res.loadPromise.catch(noop)
  } else {
    // очередь реджектит снятые задачи (`clear()`) — гасим, чтобы не всплывало
    void lazyLoadQueue.push(() => load().then(({ download }) => download), isVisible).catch(noop)
  }

  if (res.thumb) {
    await res.thumb.loadPromises.thumb
  }

  res.video = video

  return res
}

/**
 * Кружок (tweb video.ts:220-405). Отличие от нашей React-версии
 * (`messages/bubbleParts/mediaBubbles.tsx`) принципиальное: там бабл заводил
 * СВОЙ `<video>` со звуком и сам вёл прогресс, здесь — как в оригинале:
 * звучащий элемент принадлежит сообщению и живёт в контроллере коллекции
 * (`mediaPlayback.addMedia`), а инлайн-`<video>` остаётся немым превью в цикле
 * и прячется (`hide`) на время воспроизведения — кадры рисует канвас.
 */
function wrapRound({
  doc, message, container, video, spanTime, middleware, noAutoDownload, getPreloader,
}: {
  doc: WrapVideoDoc
  message?: WrapVideoMessage
  container?: HTMLElement
  video: HTMLVideoElement
  spanTime?: HTMLElement
  middleware?: Middleware
  noAutoDownload?: boolean
  getPreloader: () => ProgressivePreloader | undefined
}): void {
  const divRound = document.createElement('div')
  divRound.classList.add('media-round', 'z-depth-1')
  if (message?.mid !== undefined) divRound.dataset.mid = '' + message.mid
  if (message?.peerId !== undefined) divRound.dataset.peerId = '' + message.peerId

  const size = mediaSizesInstance.active.round
  const strokeWidth = 3.5
  const radius = getProgressRingRadius(size.width, strokeWidth)
  if (!roundVideoCircumference) {
    roundVideoCircumference = 2 * Math.PI * radius
  }

  // Общее кольцо (тот же модуль у превью записи кружка). Ведём его императивно
  // (кадры гонит `onFrame` ниже), поэтому прогресс — обычная запись в DOM,
  // ровно как в оригинале (комментарий tweb video.ts:234-236).
  const ring = createProgressRing({ size: size.width, strokeWidth, strokeOpacity: 0.3 })
  middleware?.onClean(() => { ring.destroy() })
  divRound.append(ring.element)

  const circle = ring.circle
  circle.style.strokeDasharray = roundVideoCircumference + ' ' + roundVideoCircumference
  circle.style.strokeDashoffset = '' + roundVideoCircumference

  if (message?.mediaUnread) {
    divRound.classList.add('is-unread')
  }

  const canvas = document.createElement('canvas')
  canvas.classList.add('video-round-canvas')
  canvas.width = canvas.height = doc.width || size.width

  if (spanTime) divRound.prepend(canvas, spanTime)
  else divRound.prepend(canvas)
  divRound.append(video)
  container?.append(divRound)

  const ctx = canvas.getContext('2d')

  const roundElement = divRound as RoundElement
  roundElement.message = message

  const onLoad = () => {
    // tweb video.ts:264-265 — сообщение перечитывается с самого узла (у отложенного
    // старта оно уже с серверными id), элемент сообщения заводит КОНТРОЛЛЕР, а не бабл.
    const message = roundElement.message
    const globalVideo = mediaPlayback.addMedia({
      track: {
        mediaId: doc.id,
        title: '',
        subtitle: '',
        chatId: message?.peerId,
        msgId: message?.mid,
        type: 'round',
      },
      autoload: !noAutoDownload,
    }) as HTMLVideoElement

    const onFrame = () => {
      if (ctx) ctx.drawImage(globalVideo, 0, 0)

      if (globalVideo.duration) {
        const offset = roundVideoCircumference - globalVideo.currentTime / globalVideo.duration * roundVideoCircumference
        circle.style.strokeDashoffset = '' + offset
      }

      return !globalVideo.paused
    }

    const onTimeUpdate = () => {
      if (!globalVideo.duration) return

      if (globalVideo.paused) {
        onFrame()
      }

      if (spanTime) setTimeText(spanTime, formatVideoTime(globalVideo.duration - globalVideo.currentTime))
    }

    const throttledTimeUpdate = throttle(() => { fastRaf(onTimeUpdate) }, 1000, false)

    const noSoundIcon = Icon('nosound', 'video-time-icon')
    const setIsPaused = (paused: boolean) => {
      divRound.classList.toggle('is-paused', paused)
      if (paused) spanTime?.append(noSoundIcon)
      else noSoundIcon.remove()
    }

    const onPlay = () => {
      video.classList.add('hide')
      setIsPaused(false)
      void animateSingle(onFrame, canvas)

      // ! костыль (комментарий tweb video.ts:359)
      const preloader = getPreloader()
      if (preloader?.preloader && preloader.preloader.classList.contains('manual')) {
        preloader.onClick()
      }
    }

    const onPaused = () => {
      setIsPaused(true)
    }

    const onEnded = () => {
      video.classList.remove('hide')
      setIsPaused(true)

      video.currentTime = 0
      if (spanTime) setTimeText(spanTime, formatVideoTime(globalVideo.duration || doc.duration || 0))

      if (globalVideo.currentTime) {
        globalVideo.currentTime = 0
      }
    }

    globalVideo.addEventListener('play', onPlay)
    globalVideo.addEventListener('timeupdate', throttledTimeUpdate)
    globalVideo.addEventListener('pause', onPaused)
    globalVideo.addEventListener('ended', onEnded)

    // tweb снимает слушатели «когда элемент ушёл из DOM» (`clear`, video.ts:267-278)
    // через промис смены чата у `appImManager`; у нас ту же роль играет middleware
    // поколения — оно и есть «этот бабл больше не живой».
    middleware?.onClean(() => {
      globalVideo.removeEventListener('play', onPlay)
      globalVideo.removeEventListener('timeupdate', throttledTimeUpdate)
      globalVideo.removeEventListener('pause', onPaused)
      globalVideo.removeEventListener('ended', onEnded)
    })

    attachClickEvent(canvas, (e) => {
      cancelEvent(e)

      // ! костыль (комментарий tweb video.ts:359)
      const preloader = getPreloader()
      if (preloader && !preloader.detached) {
        preloader.onClick()
      }

      if (globalVideo.paused) {
        // Запуск идёт через контроллер коллекции: он остановит чужой трек,
        // дождётся src (`willBePlayed`) и объявит очередь — `safePlay` мимо него
        // сделал бы кружок вторым одновременно играющим звуком.
        mediaPlayback.playMedia(globalVideo)
      } else {
        globalVideo.pause()
      }
    })

    if (globalVideo.paused) {
      if (globalVideo.duration && globalVideo.currentTime !== globalVideo.duration && globalVideo.currentTime > 0) {
        onFrame()
        onTimeUpdate()
        video.classList.add('hide')
      } else {
        onPaused()
      }
    } else {
      onPlay()
    }
  }

  // tweb video.ts:399-405: у ещё не отправленного сообщения (`pFlags.is_outgoing`,
  // у нас — оптимистичный id < 0) старт откладывается: ленте нужно сначала
  // получить ack, чтобы у кружка были серверные `mid`/`peerId`. Дёргает
  // отложенный старт лента — как и в оригинале, через сам узел.
  if (message?.isOutgoing) {
    roundElement.onLoad = onLoad
    divRound.dataset.isOutgoing = '1'
  } else {
    onLoad()
  }
}
