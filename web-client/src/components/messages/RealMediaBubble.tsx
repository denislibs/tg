// src/components/messages/RealMediaBubble.tsx
// The real-chat media bubble: renders a backend media object (by id) as a photo,
// video, music row, or downloadable file — styled after tweb's wrappers.
//
// Everything needed to render comes from the message itself (history read model:
// dims, mime, blur preview, thumb flag, duration, size, name) and media URLs are
// built SYNCHRONOUSLY on the main thread (see core/mediaUrl). So a media bubble
// does ZERO per-image requests on mount — no meta/contentUrl RPC round-trips —
// which is what used to make the feed jitter while scrolling.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import { mediaSizes, setAttachmentSize } from '../../core/dom/mediaSizes'
import { fmtDur } from '../../core/hooks/useVoiceRecorder'
import { useAudioStore } from '../../stores/audioStore'
import { mediaContentUrl, mediaThumbUrl, hasMediaToken, primeMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import { isGifLike } from '../../core/gifs'
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
  type?: string
  // History read model — the bubble renders entirely from these (no meta request).
  width?: number
  height?: number
  mime?: string
  blur?: string
  hasThumb?: boolean
  duration?: number
  size?: number
  fileName?: string
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
  /** платное медиа (Telegram paid media): цена + заблокировано ли для зрителя */
  paidMedia?: { price: number; locked: boolean }
  /** разблокировать платное медиа за звёзды (списывает у покупателя) */
  onUnlockPaid?: () => Promise<void>
}

export default function RealMediaBubble({
  mediaId, type, width, height, mime, blur, hasThumb, duration, size, fileName,
  renderTime, onOpen, autoDownload, localUrl, clientId, onCancelUpload,
  hasMessageBlock = false, isAlbumItem = false, paidMedia, onUnlockPaid,
}: Props) {
  useMediaTokenVersion() // re-render when the media token is (re)primed → fresh URLs
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
  // проявляется поверх подложки (blur как background-image контейнера).
  const imgRef = useRef<HTMLImageElement>(null)
  useLayoutEffect(() => { setForced(false) }, [mediaId])

  // An audio file (mp3 etc.) renders as a music player even when sent "as a file"
  // (type document) — like Telegram. So audio mime overrides the document type.
  const isAudioMime = !!mime?.startsWith('audio/')
  const asFile = type === 'document' && !isAudioMime
  const isImage = !asFile && (type === 'photo' || !!mime?.startsWith('image/'))
  const isVideo = !asFile && (type === 'video' || !!mime?.startsWith('video/'))
  const isAudio = !asFile && (type === 'audio' || isAudioMime)

  const timeCluster: ReactNode = renderTime?.('corner')

  // ---- Photo / video ----
  if (isImage || isVideo) {
    // Бокс — порт tweb setAttachmentSize (mediaSizes.regular 420×400 / 340×340
    // на узком экране + минимумы 200/320/120/368). Раньше был свой 320×420.
    const canHavePlayer = isVideo && !isGifLike({ mime, fileName, duration })
    const { size: box, isFit } = setAttachmentSize({
      width: width || 0,
      height: height || 0,
      boxWidth: mediaSizes().regular.width,
      boxHeight: mediaSizes().regular.height,
      hasMessageBlock,
      isVideoWithPlayer: canHavePlayer,
    })
    const lqip = blur ? `url("data:image/jpeg;base64,${blur}")` : undefined
    // Платное медиа, ещё не оплачено (Telegram paid media): вместо контента —
    // размытый плейсхолдер (blur) с оверлеем «Разблокировать за N ⭐». media_id
    // сервер не отдал, поэтому кроме blur/размеров у нас ничего нет.
    if (paidMedia?.locked) {
      return (
        <div
          className={classNames('attachment', 'media-container', 'no-background', s.paidLocked)}
          style={{ width: box.width, height: box.height, backgroundImage: lqip }}
        >
          <button className={s.paidUnlockBtn} onClick={handleUnlock} disabled={unlocking} type="button">
            {unlocking ? (
              <><RadialProgress progress={0} size={20} /><span>{t('Unlocking…')}</span></>
            ) : (
              <><span>{t('Unlock for')}</span><StarIcon size={16} /><span>{paidMedia.price}</span></>
            )}
          </button>
        </div>
      )
    }
    const isGif = mime === 'image/gif'
    // «Гифоподобное» видео (tenor/giphy mp4 или image/gif): автоплей-цикл прямо
    // в бабле, бейдж GIF, без play-диска (tweb wrapVideo gif-путь). Клик — лайтбокс.
    const gifLike = isGifLike({ mime, fileName, duration })
    const gifVideo = gifLike && isVideo
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
    const needPlayButton = isVideo && !gifVideo && !canAutoplay && !blocked
    // Synchronous src (no RPC). GIFs show the animated content; others prefer the
    // smaller server thumbnail, falling back to the original.
    const displaySrc = localUrl
      ? localUrl
      : !tokenReady || blocked || mediaId == null
        ? ''
        : isGif || gifVideo
          ? mediaContentUrl(mediaId)
          : hasThumb ? mediaThumbUrl(mediaId) : mediaContentUrl(mediaId)
    const videoSrc = canAutoplay && !gifVideo && tokenReady && mediaId != null ? mediaContentUrl(mediaId) : undefined
    // Дерево tweb (живой DOM §3c, wrappers/photo.ts:134-180): контейнер
    // .attachment.media-container; когда бокс пришлось раздвинуть (isFit=false —
    // подпись/минимальная ширина), tweb добавляет .media-container-fitted, кладёт
    // в контейнер приглушённую миниатюру .media-photo.thumbnail, а само медиа —
    // в .media-container-aspecter.
    const media = videoSrc ? (
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
      gifVideo ? (
        <video
          className="media-video"
          src={displaySrc}
          autoPlay
          muted
          loop
          playsInline
          onError={() => { void primeMediaToken(true) }}
        />
      ) : (
        <img ref={imgRef} className="media-photo" src={displaySrc} alt="" loading="lazy" decoding="async" onError={() => { void primeMediaToken(true) }} />
      )
    ) : null
    return (
      <div
        className={classNames(
          'attachment', 'media-container', 'no-background',
          hasMessageBlock ? 'no-brb' : '',
          isFit ? '' : 'media-container-fitted',
        )}
        onClick={(e) => (blocked ? setForced(true) : mediaId != null ? onOpen?.(mediaId, e.currentTarget) : undefined)}
        style={{ width: box.width, height: box.height, backgroundImage: lqip }}
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
          <img className="media-photo thumbnail" src={displaySrc} alt="" loading="lazy" decoding="async" />
        )}
        {isFit ? media : (
          <div className="media-container-aspecter" style={{ width: box.width, height: box.height }}>
            {media}
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
    return (
      <AudioRow
        mediaId={mediaId} name={fileName || `audio-${mediaId}`} duration={duration} size={size}
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
  //   div.document[.downloaded][.ext-<ext>]
  //     div.document-ico > span.document-ico-text
  //     div.document-name > middle-ellipsis-element
  //     div.document-size > span
  //     span.time + span.clearfix
  // Ссылка-обёртка нужна нам для download-атрибута — оставляем <a> с теми же
  // классами (в tweb загрузка вешается обработчиком).
  return (
    <a
      className={classNames('document', ring == null ? 'downloaded' : '', `ext-${ext}`, s.docRow)}
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
// track shows in the now-playing plate and only one thing plays at a time. While
// this file is the active track the row flips to pause + a seekable progress bar
// (tweb). Otherwise it shows duration • size.
function AudioRow({ mediaId, name, duration, size, time, uploadProgress, onCancelUpload }: {
  mediaId?: number
  name: string
  duration?: number
  size?: number
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

  const sizeStr = size ? fmtSize(size) : ''
  // Пока грузится — «отдано / всего», после — длительность • размер.
  const sub = uploadProgress != null && size
    ? `${fmtSize(Math.round(uploadProgress * size))} / ${fmtSize(size)}`
    : [duration ? fmtDur(duration) : '', sizeStr].filter(Boolean).join(' • ')

  const onPlay = () => {
    if (mediaId == null) return // ещё грузится
    if (isCurrent) toggle()
    else playQueue([{ mediaId, title: name, subtitle: sizeStr }], 0)
  }
  const onSeek = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    seekFraction((e.clientX - r.left) / r.width)
  }
  const frac = curDur > 0 ? Math.min(1, curTime / curDur) : 0

  // Дерево tweb (живой DOM §3 «аудио-трек» + _audio.scss):
  //   audio-element.audio.audio-show-progress[.is-out]
  //     div.audio-ico.audio-toggle[.playing] > .audio-play-icon > .part.one/.two
  //     div.audio-details > .audio-title > middle-ellipsis-element
  //                       > .audio-subtitle > .audio-time + .progress-line
  //     span.time + span.clearfix
  return (
    <audio-element class={classNames('audio', 'audio-show-progress', isCurrent ? 'is-playing' : '')}>
      {uploadProgress != null ? (
        <div className={classNames('audio-ico', 'audio-toggle', s.cancelRing)} onClick={onCancelUpload}>
          <RadialProgress progress={uploadProgress} size={44} />
          {onCancelUpload && <TgIcon name="close" size={20} color="#fff" className={s.cancelX} />}
        </div>
      ) : (
        <div className={classNames('audio-ico', 'audio-toggle', playing ? 'playing' : '')} onClick={onPlay}>
          <AudioPlayIcon />
        </div>
      )}
      <div className="audio-details">
        <div className="audio-title">
          <middle-ellipsis-element>{name}</middle-ellipsis-element>
        </div>
        <div className="audio-subtitle">
          <div className="audio-time">{isCurrent ? fmtDur(Math.floor(curTime)) : sub}</div>
          {isCurrent && (
            <div
              className="progress-line"
              onClick={onSeek}
              style={{ ['--progress' as string]: `${frac * 100}%` }}
            />
          )}
        </div>
      </div>
      {time}
      <span className="clearfix" />
    </audio-element>
  )
}
