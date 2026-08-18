/**
 * Порт tweb `src/components/wrappers/sticker.ts` (`wrapSticker`) — ванильный,
 * без React: контейнер приходит снаружи, DOM строится императивно, а временем
 * жизни поколения владеет `middleware` (ровно как в оригинале).
 *
 * ФОРМА. В tweb это ФУНКЦИЯ, а не класс, и уборку она НЕ возвращает: всё, что
 * `wrapSticker` заводит (плеер, регистрация в `animationIntersector`,
 * контроллер слоёв, слушатели `<video>`), снимается через `middleware.onClean`/
 * `onDestroy` — у tweb это единый механизм актуальности на весь клиент
 * (`lottieLoader.loadAnimationWorker` сам вешает `middleware.onClean(() =>
 * player.remove())`, `animationIntersector.addAnimation` — `controlled:
 * middleware`). Класс здесь был бы вторым, конкурирующим владельцем времени
 * жизни. Поэтому форма портирована 1:1: функция, а `destroy()` в возвращаемом
 * хэндле — это ровно `helper.destroy()` собственной зоны актуальности, чтобы
 * вызывающему без своего `middleware` было чем погасить поколение.
 *
 * ЧТО `destroy()` НЕ ДЕЛАЕТ (осознанно, это механика tweb, а не пробел): он не
 * вырывает узлы из контейнера. `LottiePlayer.remove()` (tweb 1:1) canvas в DOM
 * оставляет, `animationIntersector.removeAnimation` для `type: 'video'`
 * специально не зовёт `animation.remove()`, — потому что следующее поколение в
 * ТОМ ЖЕ контейнере усыновляет оставшийся кадр нижним слоем и не мигает
 * пустотой (`stickerAppearance`, tweb `SuperStickerRenderer.processInvisible`).
 * Узлы уходят вместе с контейнером, которым владеет вызывающий.
 *
 * Слои показа (снизу вверх) и их снятие — целиком на `createStickerAppearance`
 * (`./stickerAppearance`, порт tweb 1:1):
 *   0) SVG-силуэт из векторного контура (`pathThumb`, tweb `photoPathSize`);
 *   1) превью-картинка: кадр, сохранённый прошлым показом (приоритет, tweb
 *      `lottieCachedThumb`), иначе stripped-JPEG с бэка (tweb `doc.thumbs[0]`);
 *   2) медиа: canvas плеера lottie / `<video>` / `<img>` с классом `media-sticker`;
 *   3) нижние слои снимаются, только когда верхний ДОКАЗАННО прокрашен
 *      (`ensurePresented` у lottie), а не по таймеру.
 *
 * ОТЛИЧИЯ ОТ ОРИГИНАЛА (каждое — следствие нашей модели данных, не вкусовщина):
 *   • вход — `mediaId` + плоские метаданные вместо `doc: MyDocument`: у нас нет
 *     MTProto-документа с `thumbs[]`/`mime_type`/`sticker`;
 *   • тип стикера определяется по `Content-Type` файла (`./stickerContent`), а
 *     не по `doc.sticker` — единственный источник формата в нашем транспорте;
 *   • `width`/`height` ОБЯЗАТЕЛЬНЫ, дефолта из `mediaSizes` (tweb:122-128) нет:
 *     там бокс выбирается по ТИПУ стикера (`doc.animated` → `animatedSticker`
 *     либо `staticSticker`), а тип у нас известен только ПОСЛЕ загрузки файла
 *     (Content-Type). Размер считает вызывающий — он знает контекст показа;
 *   • один контейнер вместо `div: HTMLElement | HTMLElement[]`: массив в tweb
 *     нужен рендереру кастомных эмодзи, которого у нас нет (единственный
 *     потребитель `loadAnimationWorker` — показ одного стикера);
 *   • статичная ветка тоже идёт через `stickerAppearance`, а не через
 *     `getThumbFromContainer` + ручной `fade-out`/`remove` (tweb:557-672):
 *     контроллер слоёв у нас общий на все три формата и умеет больше
 *     (усыновление медиа прошлого поколения), а поведение то же — кроссфейд
 *     поверх непрозрачного превью и снятие превью после него.
 */
import animationIntersector, { type AnimationItemGroup } from '@components/animationIntersector'
import type { LazyLoadQueue } from '@core/lazyLoadQueue'
import { createSvgFromBase64 } from '@core/stickers/getPathFromBytes'
import {
  getStickerThumb,
  isSavingStickerThumb,
  saveStickerThumb,
  saveStickerThumbFromPlayer,
} from '@core/stickers/stickerThumbs'
import createVideo from '@helpers/dom/createVideo'
import renderImageFromUrl from '@helpers/dom/renderImageFromUrl'
import liteMode, { type LiteModeKey } from '@helpers/liteMode'
import makeError from '@helpers/makeError'
import { getMiddleware, type Middleware } from '@helpers/middleware'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import createStickerAppearance from './stickerAppearance'
import { getStickerContentKind, hasStickerContent, loadStickerContent } from './stickerContent'

/**
 * `<video>` в роли анимации: `animationIntersector` хранит в `_autoplay`/`_loop`
 * исходные значения, чтобы вернуть их после паузы по вьюпорту/настройке
 * (`animationIntersector.ts:386-406`, порт tweb). В tweb эти поля объявлены
 * глобальным дополнением `HTMLVideoElement`; у нас глобальных дополнений нет,
 * поэтому тот же контракт выражен типом на месте.
 */
type StickerVideo = HTMLVideoElement & { _autoplay?: boolean; _loop?: boolean | number }

export interface WrapStickerOptions {
  /** файл стикера на media-эндпоинте (у tweb — `doc.id` документа MTProto) */
  mediaId: number
  /** контейнер показа; им владеет вызывающий (tweb `div`) */
  div: HTMLElement
  /** зона актуальности вызывающего; её `clean` гасит поколение (tweb `middleware`) */
  middleware?: Middleware
  /** очередь загрузки на экран (tweb `lazyLoadQueue`) */
  lazyLoadQueue?: LazyLoadQueue
  /** живой геттер видимости цели — приоритезация внутри очереди (см. `core/lazyLoadQueue`) */
  isVisible?: () => boolean
  /** группа `animationIntersector` (tweb `group`) */
  group?: AnimationItemGroup
  /** играть сразу (tweb `play`) */
  play?: boolean
  /** зацикливать (tweb `loop`) */
  loop?: boolean
  /** размер бокса показа (tweb `width`/`height`) */
  width: number
  height: number
  /** `false` — не показывать превью и не сохранять первый кадр (tweb `withThumb`) */
  withThumb?: boolean
  /** принудительно включить/выключить кроссфейд первого кадра (tweb `needFadeIn`) */
  needFadeIn?: boolean
  /** эмодзи стикера: как в tweb, снимает `loop` у анимированного эмодзи и уходит в `data-sticker-emoji` */
  emoji?: string
  /** ключ lite-mode (tweb `liteModeKey`, по умолчанию `stickers_panel`); `false` — не гейтить */
  liteModeKey?: LiteModeKey | false
  /** stripped-JPEG превью в base64 (tweb `photoStrippedSize.bytes`) */
  thumb?: string
  /** векторный контур в base64 (tweb `photoPathSize.bytes`) */
  pathThumb?: string
  /** натуральные пиксели документа (tweb `doc.w`/`doc.h`) — система координат контура */
  docWidth?: number
  docHeight?: number
}

export interface WrappedSticker {
  /** tweb `ret.render` — медиа этого поколения; реджектится `MIDDLEWARE` у протухшего */
  render: Promise<LottiePlayer | HTMLVideoElement | HTMLImageElement>
  /** tweb `ret.width`/`ret.height` */
  width: number
  height: number
  /** погасить поколение: плеер, регистрации, слушатели (узлы — см. шапку) */
  destroy: () => void
}

export default function wrapSticker(options: WrapStickerOptions): WrappedSticker {
  const {
    mediaId,
    div,
    lazyLoadQueue,
    isVisible,
    group,
    width,
    height,
    withThumb,
    needFadeIn,
    emoji,
    thumb,
    pathThumb,
    docWidth,
    docHeight,
  } = options
  // tweb: `liteModeKey ??= 'stickers_panel'` (sticker.ts:111)
  const liteModeKey = options.liteModeKey === undefined ? 'stickers_panel' : options.liteModeKey

  // Собственная зона актуальности поколения. Родительская её убивает — и
  // МГНОВЕННО: в tweb middleware вызывающего используется как есть, поэтому
  // родитель, погашенный ещё до вызова, обязан делать поколение мёртвым сразу.
  // Одного `onClean` для этого мало: он зовёт колбэк сразу, но `helper.destroy()`
  // пересоздаёт `details` — и `helper.get()` вернул бы ЖИВОЙ middleware. Поэтому
  // родитель входит вторым термом в наш собственный (штатная композиция
  // `MiddlewareHelper.get(additionalCallback)`).
  const helper = getMiddleware()
  const parent = options.middleware
  parent?.onClean(() => helper.destroy())
  const middleware = helper.get(parent && (() => parent()))

  // tweb sticker.ts:137-147
  div.dataset.docId = String(mediaId)
  if (emoji) div.dataset.stickerEmoji = emoji
  div.classList.add('media-sticker-wrapper')

  // tweb: `loop = !!(!emoji || isCustomEmoji) && loop` — анимированное эмодзи
  // играет один раз (кастомных эмодзи у нас нет, поэтому ветка `isCustomEmoji`
  // не портируется).
  let loop = !emoji && !!options.loop
  let play = !!options.play

  // tweb sticker.ts:149-152
  if (play && liteModeKey && !liteMode.isAvailable(liteModeKey)) {
    play = false
    loop = false
  }

  // Контроллер слоёв: он же усыновит canvas/img прошлого поколения в этом
  // контейнере и снимет его только под новым доказанно прокрашенным кадром.
  const appearance = createStickerAppearance({
    container: div,
    // tweb `thumbKey = doc.id + '-' + toneIndex`; тонов/перекраски у нас нет —
    // ключ тот же, что у кэша кадров (`core/stickers/stickerThumbs`).
    thumbKey: String(mediaId),
    middleware,
  })

  // tweb sticker.ts:222-225. `downloaded` — байты файла уже в кэше и кроссфейд
  // не форсирован; `isAnimated` (tweb:189) у нас выводится из типа СКАЧАННОГО
  // файла (см. `stickerContent.getStickerContentKind`) — ровно в тех двух
  // условиях, где tweb его спрашивает, файл либо уже скачан, либо ответ не
  // влияет на результат (`!downloaded` истинно само по себе).
  const downloaded = hasStickerContent(mediaId) && !needFadeIn
  const contentKind = getStickerContentKind(mediaId)
  const isAnimated = contentKind === 'lottie' || contentKind === 'video'
  const isThumbNeededForType = isAnimated
  // tweb `lottieCachedThumb` — кадр, сохранённый прошлым показом; там он
  // спрашивается только у Lottie/WebM, у нас это выполняется само:
  // `saveStickerThumb*` зовут ровно эти две ветки, у статики кадра не бывает.
  const lottieCachedThumb = getStickerThumb(mediaId)

  // tweb sticker.ts:247-258 — гейт превью целиком (без терма `onlyThumb`:
  // режима «только превью» у нас нет). `doc.thumbs?.length` у нас — это наличие
  // хоть какого-то присланного превью: stripped-JPEG или векторного контура.
  if (
    (!!(thumb || pathThumb) || lottieCachedThumb) &&
    (!downloaded || isThumbNeededForType) &&
    withThumb !== false
  ) {
    // tweb:259 `let thumb = lottieCachedThumb || doc.thumbs[0]` — СОХРАНЁННЫЙ
    // КАДР ПРИОРИТЕТНЕЕ присланного stripped-JPEG: он резкий и совпадает с тем,
    // что сейчас появится, а stripped — мыло. Инверсия этих двух и была
    // «морганием в мыло».
    const thumbUrl = lottieCachedThumb?.url ?? (thumb ? `data:image/jpeg;base64,${thumb}` : undefined)

    // tweb:268-273 — силуэт из собственного контура стикера ставится ПЕРВЫМ:
    // он синхронный, а превью-картинка проигрывает гонку даже у тёплого показа
    // (ей нужен decode). viewBox — из натуральных пикселей документа (tweb
    // `doc.w`/`doc.h`), а не из бокса показа: точки контура заданы в
    // координатах исходного канваса.
    if (pathThumb && appearance.canBuildSilhouette()) {
      const built = createSvgFromBase64(pathThumb, docWidth || 512, docHeight || 512)
      if (built) appearance.setSilhouette(built.svg)
    }

    // tweb:275-276 — картинка апгрейдит силуэт, когда догрузится и декодируется.
    if (thumbUrl && appearance.canBuildImage()) {
      const thumbImage = new Image()
      void renderImageFromUrl(thumbImage, thumbUrl, () => {
        // tweb проверяет middleware в каждой отложенной ветке превью
        // (:347, :358, :364) — здесь это тот же гвард на пришедший поздно колбэк.
        if (!middleware()) return
        appearance.upgradeToImage(thumbImage)
      })
    }
  }

  const middlewareError = makeError('MIDDLEWARE')

  const loadLottie = async (data: unknown): Promise<LottiePlayer> => {
    // Воркер парсит анимацию из Blob (readBlobAsText + JSON.parse); наш
    // транспорт отдаёт разобранный json, поэтому сериализуем обратно.
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const animation = await lottieLoader.loadAnimationWorker({
      container: div,
      animationData: blob,
      loop,
      autoplay: play,
      width,
      height,
      name: 'doc' + mediaId,
      group,
      // Плеер сам снимется с наблюдения и уничтожится по `middleware.onClean`
      // (`lottieLoader.loadAnimationWorker`, tweb 1:1) — своей уборки не надо.
      middleware,
      liteModeKey: liteModeKey || undefined,
      // Кэш кадров в legacy-режиме живёт на вкладке, и у one-shot завершение
      // зовёт clearCache ровно тогда, когда кадр дорисовывается, — поэтому
      // кэшируем только зацикленные.
      noCache: !loop,
    })

    if (!middleware()) throw middlewareError

    // tweb sticker.ts:482-499 — `firstFrame`; у нас `onFirstFrame` (тот же
    // слушатель, но срабатывает и на уже отрисованном плеере).
    animation.onFirstFrame(() => {
      if (!middleware()) return
      if (withThumb !== false) void saveStickerThumbFromPlayer(mediaId, animation)
      void appearance.onMediaFirstFrame({ animation, media: animation.canvas[0], needFadeIn })
    })

    return animation
  }

  const loadVideo = async (url: string): Promise<HTMLVideoElement> => {
    // tweb sticker.ts:524 — `createVideo({middleware})`: playsinline + отпускание
    // сетевого запроса/декодера по смерти поколения.
    const video = createVideo({ middleware }) as StickerVideo
    video.classList.add('media-sticker')
    video.muted = true
    if (play) video.autoplay = true
    if (loop) video.loop = true
    video._autoplay = play
    video._loop = loop

    // tweb ждёт `onMediaLoad` внутри `renderImageFromUrl`; здесь нужен не
    // «готов к воспроизведению» (`canplay`), а именно ПЕРВЫЙ КАДР — из него
    // рисуется превью для следующего показа, — поэтому слушаем `loadeddata`
    // напрямую, а не идём через общий хелпер.
    video.addEventListener(
      'loadeddata',
      () => {
        if (!middleware()) return

        // tweb sticker.ts:596-616: кадр видео-стикера сохраняется превью для
        // следующего показа; размер — бокс показа в физических пикселях,
        // подогнанный под соотношение сторон видео (оно произвольное).
        const { videoWidth, videoHeight } = video
        const ratio = videoWidth / videoHeight
        let w = width * window.devicePixelRatio
        let h = height * window.devicePixelRatio
        if (ratio < 1) w = h * ratio
        else h = w / ratio

        // `w > 0 && h > 0` — своя страховка: у tweb размеры гарантированы
        // документом, у нас они читаются из самого файла и на `loadeddata` без
        // видеодорожки дают NaN (canvas такого размера бессмыслен).
        if (w > 0 && h > 0 && !isSavingStickerThumb(mediaId, w, h)) {
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            void saveStickerThumb(mediaId, canvas)
          }
        }

        void appearance.onMediaFirstFrame({ media: video, needFadeIn })
      },
      { once: true },
    )

    div.append(video)
    video.src = url

    // tweb sticker.ts:674-683 — видео-стикер живёт в общем интерсекторе: пауза
    // вне вьюпорта, в фоновой вкладке и на время тяжёлой анимации. Снятие с
    // наблюдения — по `controlled: middleware`, своей уборки не надо.
    animationIntersector.addAnimation({
      animation: video,
      group,
      observeElement: div,
      controlled: middleware,
      liteModeKey: liteModeKey || undefined,
      type: 'video',
    })

    return video
  }

  const loadImage = (url: string): Promise<HTMLImageElement> =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.classList.add('media-sticker')
      void renderImageFromUrl(image, url, () => {
        if (!middleware()) {
          reject(middlewareError)
          return
        }

        div.append(image)
        void appearance.onMediaFirstFrame({ media: image, needFadeIn })
        resolve(image)
      })
    })

  // tweb `load()` (sticker.ts:417): один вход, три ветки по типу стикера.
  const load = async () => {
    if (!middleware()) throw middlewareError

    const content = await loadStickerContent(mediaId)
    if (!middleware()) throw middlewareError

    if (content.kind === 'lottie') return loadLottie(content.data)
    if (content.kind === 'video') return loadVideo(content.url)
    return loadImage(content.url)
  }

  // tweb sticker.ts:735 — `lazyLoadQueue && (!downloaded || isAnimated)`: мимо
  // очереди идёт только уже скачанная СТАТИКА. Закэшированный tgs/webm всё
  // равно ставится в очередь — его показ это не чтение готового URL, а декод
  // (парс json, старт плеера/видео), и без гейта они стартуют все разом.
  const render =
    lazyLoadQueue && (!downloaded || isAnimated) ? lazyLoadQueue.push(load, isVisible) : load()

  return {
    render,
    width,
    height,
    destroy: () => helper.destroy(),
  }
}
