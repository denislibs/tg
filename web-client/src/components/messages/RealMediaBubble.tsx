// src/components/messages/RealMediaBubble.tsx
// The real-chat media bubble: renders a backend media object (by id) as a photo,
// video, music row, or downloadable file — styled after tweb's wrappers.
//
// Вход — САМО вложение сообщения (`MyPhoto | MyDocument`, то есть результат
// `getMediaFromMessage`), как у врапперов оригинала: `wrapPhoto({photo})` /
// `wrapVideo({doc})` / `wrapDocument({message})` спрашивают у него `doc.type`,
// `doc.w`/`doc.h`, `doc.attributes`, `photo.sizes` — и здесь спрашивается ровно
// то же. Media URLs are built SYNCHRONOUSLY on the main thread (see core/mediaUrl).
// So a media bubble does ZERO per-image requests on mount — no meta/contentUrl
// RPC round-trips — which is what used to make the feed jitter while scrolling.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import mediaSizes, { setAttachmentSize } from '../../core/dom/mediaSizes'
import { fmtDur } from '../../core/hooks/useVoiceRecorder'
import { useAudioStore } from '../../stores/audioStore'
// Токен-механизм остаётся ТОЛЬКО видео-путям этого бабла (инлайн-автоплей
// <video> и href документа — стрим/байты, не картинки); img-src и thumb с
// Task 7 идут воркерным конвейером (useMediaUrl → downloadMediaURL).
import { mediaContentUrl, hasMediaToken, primeMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import { useBlurThumb } from './useBlurThumb'
import {
  getMediaDimensions,
  getStrippedThumb,
  hasServerThumb,
  isPaidMediaLocked,
  type MessageMediaPaidMedia,
  type MyDocument,
  type MyPhoto,
} from '../../core/media/messageMedia'
// Рубильник наблюдателя звука — там же, где в tweb (wrappers/video.ts:51);
// его же оттуда импортирует и лента оригинала (bubbles.ts:110).
import { USE_VIDEO_OBSERVER } from '../wrappers/video'
import { useUploadsStore } from '../../stores/uploadsStore'
import RadialProgress from '../RadialProgress'
import AudioPlayIcon from './AudioPlayIcon'
import StarIcon from '../stars/StarIcon'
import { useT } from '../../i18n'
import type { RenderTime } from './bubbleParts/Time'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import s from './RealMediaBubble.module.scss'

// Порог инлайн-автоплея видео (tweb wrappers/video.ts:50).
const MAX_VIDEO_AUTOPLAY_SIZE = 50 * 1024 * 1024

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`
  return `${n} Б`
}

interface Props {
  /** отсутствует, пока идёт аплоад оптимистичного сообщения (есть localUrl) */
  mediaId?: number
  /** вложение сообщения (tweb `getMediaFromMessage`) — им и решается всё ниже */
  media?: MyPhoto | MyDocument
  /** тип сообщения; читается ТОЛЬКО когда вложения ещё нет (идёт аплоад) */
  type?: string
  /** исходящее — tweb вешает `is-out` на сам audio-element (wrappers/document.ts:149) */
  out?: boolean
  /** tweb дублирует id сообщения/отправителя на audio-element (audio.ts:543-544) */
  mid?: number
  peerId?: number
  /** рендер времени бабла (bubbleParts/Time) — форму выбирает сам бабл:
   * плавающая пилюля поверх фото/видео либо угол у документа/аудио */
  renderTime?: RenderTime
  onOpen?: (mediaId: number, el: HTMLElement) => void
  // Автозагрузка для чата (tweb autoDownloadSize): 0 = грузить только по клику
  autoDownload?: ChatAutoDownload
  // Мгновенное превью исходящего медиа + кольцо прогресса аплоада
  localUrl?: string
  clientId?: string
  /** крестик на кольце: отменить аплоад (tweb ProgressivePreloader cancel) */
  onCancelUpload?: (clientId: string) => void
  /** у сообщения есть подпись/reply/webpage — tweb расширяет бокс и режет нижние
   * радиусы вложения (no-brb) */
  hasMessageBlock?: boolean
  /** элемент альбома — tweb запрещает инлайн-автоплей таким видео */
  isAlbumItem?: boolean
  /** платное медиа (Telegram paid media) — САМ конструктор: цена в
   *  `stars_amount`, а «заблокировано ли» это выбор конструктора внутри вектора
   *  (`isPaidMediaLocked`), а не булев ключ рядом */
  paidMedia?: MessageMediaPaidMedia
  /** разблокировать платное медиа за звёзды (списывает у покупателя) */
  onUnlockPaid?: () => Promise<void>
}

export default function RealMediaBubble({
  mediaId, media, type, out, mid, peerId,
  renderTime, onOpen, autoDownload, localUrl, clientId, onCancelUpload,
  hasMessageBlock = false, isAlbumItem = false, paidMedia, onUnlockPaid,
}: Props) {
  const paidLocked = !!paidMedia && isPaidMediaLocked(paidMedia)
  // Вложение — фотография (лестница `sizes`) либо документ (`attributes` уже
  // сведены `saveDocument` в `type`/`w`/`h`/`duration`/`file_name`).
  const doc = media?._ === 'document' ? media : undefined
  const mime = doc?.mime_type
  const size = doc?.size
  const fileName = doc?.file_name
  const duration = doc?.duration
  const { w: width, h: height } = getMediaDimensions(media)
  // Токен нужен только видео-путям (videoSrc/href ниже) — картинки с Task 7 на
  // воркерном конвейере и от токена не зависят.
  useMediaTokenVersion() // re-render when the media token is (re)primed → fresh video URLs
  const t = useT()
  // Платное медиа: пока идёт списание — блокируем повторный клик и крутим кольцо.
  const [unlocking, setUnlocking] = useState(false)
  const handleUnlock = () => {
    if (unlocking || !onUnlockPaid) return
    setUnlocking(true)
    void onUnlockPaid().finally(() => setUnlocking(false))
  }
  const tokenReady = hasMediaToken()
  // Автозагрузка выключена → грузим только после клика (tweb noAutoDownload)
  const [forced, setForced] = useState(false)
  // Кольцо прогресса аплоада (tweb ProgressivePreloader) — пока запись жива
  const uploadProgress = useUploadsStore((s) => (clientId ? s.byId[clientId] : undefined))
  const cancelUpload = clientId && onCancelUpload ? () => onCancelUpload(clientId) : undefined
  // Наш shimmer поверх blur-превью убран: в tweb его нет — картинка просто
  // проявляется поверх канвас-превью (useBlurThumb ниже).
  const imgRef = useRef<HTMLImageElement>(null)
  useLayoutEffect(() => { setForced(false) }, [mediaId])

  // Каким баблом рисовать файл — решает `doc.type`, как в оригинале
  // (tweb bubbles.ts:8510-8512): видео/гифка/кружок идут медиа-контейнером,
  // музыка — audio-element'ом, всё остальное — строкой документа. Фотография
  // приходит `messageMediaPhoto` и документа не имеет вовсе.
  // Пока идёт аплоад, вложения ещё нет — тогда единственный признак это `type`
  // самого сообщения.
  const docType = doc?.type
  // GIF (tweb `doc.type === 'gif'`, appDocsManager.ts:219-226): автоплей-цикл
  // прямо в бабле, бейдж GIF, без play-диска. Клик — лайтбокс. Отступление от
  // оригинала: Telegram перекодирует image/gif в mp4 и у него остаётся одна
  // форма показа (<video>), наш бэкенд отдаёт gif как есть — поэтому настоящий
  // image/gif показывается анимированной картинкой, а mp4-гифка — <video>.
  const gifLike = docType === 'gif'
  const isGif = gifLike && mime === 'image/gif'
  const gifVideo = gifLike && !isGif
  const isImage = media ? media._ === 'photo' || isGif : type === 'photo'
  const isVideo = doc ? docType === 'video' || docType === 'round' || gifVideo : type === 'video'
  const isAudio = doc ? docType === 'audio' : type === 'audio'
  // Гейт автозагрузки (tweb useAutoDownloadSettings → wrapPhoto autoDownloadSize):
  // GIF и видео идут по настройке «Видео», остальное — «Фото». При 0 показываем
  // blur-превью с кнопкой загрузки; клик грузит, следующий клик открывает.
  // Локальное превью исходящего (localUrl) гейту не подлежит.
  const blocked = !forced && !localUrl && !!autoDownload
    && (isVideo || isGif ? autoDownload.video === 0 : autoDownload.photo === 0)
  // Инлайн-автоплей видео (tweb wrapVideo: canAutoplay = size ≤ 50 МБ и это не
  // элемент альбома). Автоплей есть → крутится <video muted loop> и в
  // .video-time добавляется иконка nosound; иначе — большая play-кнопка.
  const canAutoplay = isVideo && !blocked && (size == null || size <= MAX_VIDEO_AUTOPLAY_SIZE) && !isAlbumItem
  // URL картинки (Task 7): воркерный конвейер downloadMediaURL, синхронно из
  // зеркала при повторном рендере. GIF показывает анимированный контент; прочее
  // предпочитает серверный thumb с фолбэком на оригинал. Инлайн-автоплей без
  // gif-пути (videoSrc ниже) картинку не рендерит вовсе — id → null, чтобы хук
  // не скачивал байты, которые никто не покажет; то же для localUrl и гейта
  // автозагрузки (blocked обязан НЕ ходить в сеть до клика).
  const needMediaUrl = (isImage || isVideo) && !(canAutoplay && !gifVideo)
    && !localUrl && !blocked && !paidLocked && mediaId != null
  const mediaUrl = useMediaUrl(needMediaUrl ? mediaId! : null, { thumb: !isGif && !gifVideo && hasServerThumb(media) })
  // Канвас-превью (tweb-модель, Task 9): blur() → canvas-thumbnail prepend'ом в
  // контейнер медиа; НЕ монтируется, если полный URL известен уже на этом
  // рендере (localUrl / синхронное попадание в зеркало конвейера) — аналог
  // tweb `cacheContext.downloaded`.
  // Ступень `photoStrippedSize` вложения (tweb getStrippedThumb).
  const strippedThumb = getStrippedThumb(media)
  const blurHostRef = useBlurThumb(
    (isImage || isVideo) && !paidLocked ? strippedThumb : undefined,
    !!localUrl || !!mediaUrl,
  )
  // Платное медиа: кроме stripped-ступени у нас ничего нет — превью монтируется всегда.
  const paidBlurHostRef = useBlurThumb(paidLocked ? strippedThumb : undefined)

  // документ/музыка уже на дереве tweb — время позиционируют правила
  // `.document .time` / `.audio .time` из портированных партиалов
  const timeCluster: ReactNode = renderTime?.('corner', 'container')

  // ---- Photo / video ----
  if (isImage || isVideo) {
    // Бокс — порт tweb setAttachmentSize (mediaSizes.regular 420×400 / 340×340
    // на узком экране + минимумы 200/320/120/368). Раньше был свой 320×420.
    //
    // `canHaveVideoPlayer` оригинала — это НЕ «медиа является видео», а
    // `willObserveSound` из wrapVideo (video.ts:139-157 → :428): флаг
    // поднимается только в ветке «автоплей есть» и только под гейтом
    // `observer && USE_VIDEO_OBSERVER`. Константа стоит `false` (см. её
    // докблок), поэтому минимум 368 в оригинале не срабатывает ни разу — и у
    // нас теперь тоже. Включат рубильник — поедет и здесь, той же дорогой.
    // Отдельная проверка `photo.type === 'video'` внутри setAttachmentSize уже
    // покрыта: `canAutoplay` истинен только у видео.
    const willObserveSound = USE_VIDEO_OBSERVER && canAutoplay && !gifLike
    // Фото у tweb — `messageMediaPhoto` (MyPhoto), всё прочее медиа приходит
    // ДОКУМЕНТОМ (`photo._ === 'document'`): и видео, и тенор-mp4, и настоящий
    // image/gif (documentAttributeAnimated → `type: 'gif'`). От этого зависят
    // дефолт натурального размера (документу 512, фото 100 — сообщение без
    // геометрии) и внешний гейт минимумов бокса. Оба вопроса задаются самому
    // вложению — так же, как их задаёт `setAttachmentSize` оригинала.
    const isDocumentMedia = !!doc
    const documentType = docType
    // `boxSize` — размер САМОГО контейнера (расширенный минимумами), `size` —
    // вписанный, он уходит в `.media-container-aspecter` (tweb
    // setAttachmentSize.ts:64-103 + wrappers/photo.ts:136-137).
    const { size: fitted, boxSize: box, isFit } = setAttachmentSize({
      width: width || 0,
      height: height || 0,
      boxWidth: mediaSizes.active.regular.width,
      boxHeight: mediaSizes.active.regular.height,
      hasMessage: true, // медиа бабла всегда принадлежит сообщению (tweb `message`)
      hasMessageBlock,
      isDocument: isDocumentMedia,
      documentType,
      isVideoWithPlayer: willObserveSound,
    })
    // Платное медиа, ещё не оплачено (Telegram paid media): вместо контента —
    // размытый плейсхолдер (канвас-превью) с оверлеем «Разблокировать за N ⭐».
    // media_id сервер не отдал, поэтому кроме blur/размеров у нас ничего нет.
    if (paidLocked) {
      return (
        <div
          ref={paidBlurHostRef}
          className={classNames('attachment', 'media-container', 'no-background', s.paidLocked)}
          style={{ width: box.width, height: box.height }}
        >
          <button className={s.paidUnlockBtn} onClick={handleUnlock} disabled={unlocking} type="button">
            {unlocking ? (
              <><RadialProgress progress={0} size={20} /><span>{t('Unlocking…')}</span></>
            ) : (
              <><span>{t('Unlock for')}</span><StarIcon size={16} /><span>{paidMedia.stars_amount}</span></>
            )}
          </button>
        </div>
      )
    }
    const needPlayButton = isVideo && !gifVideo && !canAutoplay && !blocked
    // Картинка/гиф — из зеркала конвейера (useMediaUrl выше): синхронно при
    // повторном рендере, '' пока URL не объявлен (виден канвас-превью).
    const displaySrc = localUrl || mediaUrl
    // Инлайн-автоплей настоящего видео — СТРИМ, не картинка: остаётся на
    // токен-URL до перевода видео-путей (вьювер/стадия E ходит resolveStreamUrl).
    const videoSrc = canAutoplay && !gifVideo && tokenReady && mediaId != null ? mediaContentUrl(mediaId) : undefined
    // Дерево tweb (живой DOM §3c, wrappers/photo.ts:134-180): контейнер
    // .attachment.media-container; когда бокс пришлось раздвинуть (isFit=false —
    // подпись/минимальная ширина), tweb добавляет .media-container-fitted, кладёт
    // в контейнер приглушённую миниатюру .media-photo.thumbnail, а само медиа —
    // в .media-container-aspecter.
    const mediaEl = videoSrc ? (
      <video
        className="media-video"
        src={videoSrc}
        autoPlay
        muted
        loop
        playsInline
        onError={() => { void primeMediaToken(true) }}
      />
    ) : displaySrc ? (
      // blob:-URL конвейера: onError-релечение токена тут больше не о чем —
      // протухание закрывает сброс зеркала на смене сессии (rt:logging_out).
      gifVideo ? (
        <video
          className="media-video"
          src={displaySrc}
          autoPlay
          muted
          loop
          playsInline
        />
      ) : (
        <img ref={imgRef} className="media-photo" src={displaySrc} alt="" loading="lazy" decoding="async" />
      )
    ) : null
    return (
      <div
        ref={blurHostRef}
        className={classNames(
          'attachment', 'media-container', 'no-background',
          hasMessageBlock ? 'no-brb' : '',
          isFit ? '' : 'media-container-fitted',
        )}
        onClick={(e) => (blocked ? setForced(true) : mediaId != null ? onOpen?.(mediaId, e.currentTarget) : undefined)}
        style={{ width: box.width, height: box.height }}
      >
        {(gifLike || (isVideo && !!duration)) && (
          <span className="video-time">
            {gifLike ? 'GIF' : fmtDur(duration!)}
            {canAutoplay && !gifVideo && <TgIcon name="nosound" size="inherit" className="video-time-icon" />}
          </span>
        )}
        {(needPlayButton || blocked) && (
          <button type="button" className="btn-circle video-play position-center">
            <TgIcon name={blocked ? 'download' : 'largeplay'} size="inherit" className="button-icon" />
          </button>
        )}
        {!isFit && displaySrc && !videoSrc && (
          <img
            className="media-photo thumbnail"
            src={displaySrc}
            alt=""
            loading="lazy"
            decoding="async"
            // Превью проявляется классом `fade-in` (tweb renderMediaWithFadeIn.ts:30
            // ставит его перед вставкой картинки и снимает по `animationend`, :38-45).
            // Сама анимация — в партиале: `.media-container-fitted > .thumbnail`
            // держит opacity .8, а `.fade-in` крутит `thumbnail-fade-in-opacity .2s
            // ease-in-out forwards` (_chatBubble.scss:874-879). Класс у нас не ставился
            // нигде — превью появлялось рывком.
            onLoad={(e) => e.currentTarget.classList.add('fade-in')}
            onAnimationEnd={(e) => e.currentTarget.classList.remove('fade-in')}
          />
        )}
        {isFit ? mediaEl : (
          <div className="media-container-aspecter" style={{ width: fitted.width, height: fitted.height }}>
            {mediaEl}
          </div>
        )}
        {uploadProgress != null && (
          <div className={s.play}>
            <div
              className={s.cancelRing}
              onClick={(e) => { e.stopPropagation(); cancelUpload?.() }}
            >
              <RadialProgress progress={uploadProgress} />
              {cancelUpload && <TgIcon name="close" size={24} color="#fff" className={s.cancelX} />}
            </div>
          </div>
        )}
        {renderTime?.('floating')}
      </div>
    )
  }

  // ---- Music (audio, compressed) ----
  if (isAudio) {
    // ID3-теги живут в documentAttributeAudio — тот же `attributes.find`,
    // которым их достаёт оригинал (tweb audio.ts:352).
    const audioAttribute = doc?.attributes.find((a) => a._ === 'documentAttributeAudio')
    return (
      <AudioRow
        mediaId={mediaId}
        // tweb audio.ts:391 — `audioAttribute?.title ?? doc.file_name`
        title={audioAttribute?.title || fileName || `audio-${mediaId}`}
        performer={audioAttribute?.performer}
        duration={duration} size={size}
        out={out} mid={mid} peerId={peerId}
        time={timeCluster}
        uploadProgress={uploadProgress}
        onCancelUpload={cancelUpload}
      />
    )
  }

  // ---- Document / file (tweb .document: цветная «страница» с загнутым
  // уголком и расширением; pdf/zip/apk — фирменные цвета, остальное акцент) ----
  const name = fileName || `media-${mediaId}`
  // Пока идёт аплоад (mediaId ещё нет) — ссылка неактивна, на иконке кольцо.
  // Токен-URL сознательно: это БАЙТОВЫЙ стрим-фетч файла с прогрессом (DocRow),
  // категория «МОЖНО: bytes прямым fetch» (web-client/CLAUDE.md), не картинка.
  const href = tokenReady && mediaId != null ? mediaContentUrl(mediaId) : undefined
  return (
    <DocRow
      name={name} size={size} mime={mime} href={href}
      uploadProgress={uploadProgress} onCancelUpload={cancelUpload}
      timeCluster={timeCluster}
    />
  )
}

// ---- Строка документа с управляемым скачиванием (tweb ProgressivePreloader):
// клик → fetch с чтением потока и кольцом «скачано / всего» на иконке; клик по
// кольцу — отмена. По завершении файл сохраняется как обычная загрузка.
function DocRow({ name, size, mime, href, uploadProgress, onCancelUpload, timeCluster }: {
  name: string
  size?: number
  mime?: string
  href?: string
  uploadProgress?: number
  onCancelUpload?: () => void
  timeCluster: ReactNode
}) {
  const rawExt = name.includes('.') ? (name.split('.').pop() || '').split(' ')[0].toLowerCase() : ''
  const ext = (rawExt || 'file').slice(0, 6)
  const [dl, setDl] = useState<{ loaded: number; total: number } | null>(null)
  const dlAbort = useRef<AbortController | null>(null)
  useEffect(() => () => dlAbort.current?.abort(), [])

  const startDownload = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (uploadProgress != null) { onCancelUpload?.(); return }
    if (!href) return
    if (dl) { dlAbort.current?.abort(); return } // повторный клик = отмена
    const ac = new AbortController()
    dlAbort.current = ac
    setDl({ loaded: 0, total: size ?? 0 })
    try {
      // Стрим файла (bytes) с прогрессом/отменой — прямой fetch к media-эндпоинту,
      // не через managers/worker-RPC. Санкц. исключение — см. web-client/CLAUDE.md «МОЖНО».
      const res = await fetch(href, { signal: ac.signal })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || size || 0
      const reader = res.body.getReader()
      const chunks: BlobPart[] = []
      let loaded = 0
      let lastPaint = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.byteLength
        const now = performance.now()
        if (now - lastPaint > 100) { lastPaint = now; setDl({ loaded, total }) }
      }
      const url = URL.createObjectURL(new Blob(chunks, { type: mime || 'application/octet-stream' }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      // отмена или сеть — просто вернуть иконку
    } finally {
      setDl(null)
      dlAbort.current = null
    }
  }

  // Кольцо: аплоад у отправителя ИЛИ активное скачивание у получателя.
  const ring = uploadProgress ?? (dl ? (dl.total > 0 ? dl.loaded / dl.total : 0) : undefined)
  // Подстрока: «передано / всего» пока идёт аплоад/скачивание, иначе размер.
  const sub = uploadProgress != null && size
    ? `${fmtSize(Math.round(uploadProgress * size))} / ${fmtSize(size)}`
    : dl && dl.total > 0
      ? `${fmtSize(dl.loaded)} / ${fmtSize(dl.total)}`
      : size ? fmtSize(size) : ''
  // Дерево tweb (живой DOM §3 «документ» + _document.scss):
  //   div.document[.downloading][.ext-<ext>]
  //     div.document-ico > span.document-ico-text
  //     div.document-name > middle-ellipsis-element
  //     div.document-size > span
  //     span.time + span.clearfix
  // Ссылка-обёртка нужна нам для download-атрибута — оставляем <a> с теми же
  // классами (в tweb загрузка вешается обработчиком).
  return (
    <a
      // `downloading` — пока крутится кольцо (tweb _document.scss:97-101: уголок
      // листа при этом свёрнут). Раньше тут стоял `downloaded`, из-за чего
      // ховер-правила партиала (`&:not(.downloaded)`, :70-83 — расширение гаснет,
      // уголок разворачивается) не срабатывали никогда.
      className={classNames('document', ring != null ? 'downloading' : '', `ext-${ext}`, s.docRow)}
      href={href}
      download={name}
      onClick={startDownload}
    >
      <div className="document-ico">
        {ring != null ? (
          <span className={s.docProgress}>
            <RadialProgress progress={ring} size={44} />
            <TgIcon name="close" size={20} color="#fff" className={s.cancelX} />
          </span>
        ) : (
          <>
            <span className="document-ico-text">{ext}</span>
            <span className={s.docDl}>
              <TgIcon name="download" size={26} color="#fff" />
            </span>
          </>
        )}
      </div>
      <div className="document-name">
        <middle-ellipsis-element>{name}</middle-ellipsis-element>
      </div>
      <div className="document-size">
        <span>{sub}</span>
      </div>
      {timeCluster}
      <span className="clearfix" />
    </a>
  )
}

// Music row: plays through the GLOBAL audio player (same as voice messages), so a
// track shows in the now-playing plate and only one thing plays at a time.
//
// Дерево 1:1 с tweb (audio.ts:373-378,543-544 + живой DOM `03-reply-audio.json`):
//   audio-element.audio[.is-out][.audio-show-progress][data-mid,data-peer-id]
//     div.audio-toggle.audio-ico[.playing] > .audio-play-icon > .part.one/.two
//     div.audio-details
//       div.audio-title > middle-ellipsis-element      ← title ?? file_name
//       div.audio-subtitle
//         div.audio-time                               ← длительность / currentTime
//         div.audio-description " • performer"         ← в покое
//         | div.progress-line > __filled + input.__seek ← во время игры (ЗАМЕНА описания)
//     span.time + span.clearfix
function AudioRow({ mediaId, title, performer, duration, size, out, mid, peerId, time, uploadProgress, onCancelUpload }: {
  mediaId?: number
  title: string
  performer?: string
  duration?: number
  size?: number
  out?: boolean
  mid?: number
  peerId?: number
  time: ReactNode
  uploadProgress?: number
  onCancelUpload?: () => void
}) {
  // mediaId ещё нет во время аплоада — трек не считается текущим (иначе
  // undefined===undefined совпало бы с «нет активного трека»).
  const isCurrent = useAudioStore((s) => mediaId != null && s.track?.mediaId === mediaId)
  const playing = useAudioStore((s) => s.playing && mediaId != null && s.track?.mediaId === mediaId)
  const curTime = useAudioStore((s) => (mediaId != null && s.track?.mediaId === mediaId ? s.currentTime : 0))
  const curDur = useAudioStore((s) => (mediaId != null && s.track?.mediaId === mediaId ? s.duration : 0))
  const seekFraction = useAudioStore((s) => s.seekFraction)
  const toggle = useAudioStore((s) => s.toggle)
  const playQueue = useAudioStore((s) => s.playQueue)

  // tweb audio.ts:349-371: части описания = [performer]; formatBytes(size) идёт
  // ТОЛЬКО когда частей нет. Строка всегда начинается с ' • '.
  const description = performer || (size ? fmtSize(size) : '')
  // Отступление от tweb: во время аплоада в описание кладём «отдано / всего»
  // (tweb ограничивается кольцом ProgressivePreloader поверх кнопки) — иначе у
  // отправителя нет числового прогресса.
  const subtitleText = uploadProgress != null && size
    ? `${fmtSize(Math.round(uploadProgress * size))} / ${fmtSize(size)}`
    : description
  // audio.ts:583-584 — в покое время трека, при игре подменяется на currentTime
  const timeText = fmtDur(Math.floor(isCurrent ? curTime : duration ?? 0))
  // tweb ставит `audio-show-progress` ТОЛЬКО с первого play и снимает на `ended`
  // (audio.ts:405-434). До этого `.audio-subtitle` держит max-width:100%.
  const showProgress = isCurrent && (playing || curTime > 0)

  const onPlay = () => {
    if (mediaId == null) return // ещё грузится
    if (isCurrent) toggle()
    else playQueue([{ mediaId, title, subtitle: description }], 0)
  }
  const frac = curDur > 0 ? Math.min(1, curTime / curDur) : 0

  return (
    <audio-element
      class={classNames('audio', out ? 'is-out' : '', showProgress ? 'audio-show-progress' : '')}
      data-mid={mid}
      data-peer-id={peerId}
    >
      {uploadProgress != null ? (
        <div className={classNames('audio-toggle', 'audio-ico', s.cancelRing)} onClick={onCancelUpload}>
          <RadialProgress progress={uploadProgress} size={44} />
          {onCancelUpload && <TgIcon name="close" size={20} color="#fff" className={s.cancelX} />}
        </div>
      ) : (
        <div className={classNames('audio-toggle', 'audio-ico', playing ? 'playing' : '')} onClick={onPlay}>
          <AudioPlayIcon />
        </div>
      )}
      <div className="audio-details">
        <div className="audio-title">
          <middle-ellipsis-element>{title}</middle-ellipsis-element>
        </div>
        <div className="audio-subtitle">
          <div className="audio-time">{timeText}</div>
          {showProgress ? (
            // RangeSelector (tweb rangeSelector.ts:47-76): контейнер несёт
            // --progress долей, .__filled — inline width в процентах, скраб —
            // невидимым input[type=range] поверх полосы.
            <div className="progress-line" style={{ ['--progress' as string]: String(frac) }}>
              <div className="progress-line__filled" style={{ width: `${(frac * 100).toFixed(4)}%` }} />
              <input
                className="progress-line__seek"
                type="range"
                min={0}
                max={curDur || 0}
                step={1 / 60}
                value={curTime}
                aria-label="seek"
                onChange={(e) => { if (curDur > 0) seekFraction(Number(e.target.value) / curDur) }}
              />
            </div>
          ) : (
            <div className="audio-description">{subtitleText ? ` • ${subtitleText}` : ''}</div>
          )}
        </div>
      </div>
      {time}
      <span className="clearfix" />
    </audio-element>
  )
}
