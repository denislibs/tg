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
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import { calcImageInBox } from '../../core/dom/calcImageInBox'
import { fmtDur } from '../../core/hooks/useVoiceRecorder'
import { useAudioStore } from '../../stores/audioStore'
import { mediaContentUrl, mediaThumbUrl, hasMediaToken, primeMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import { isGifLike } from '../../core/gifs'
import { useUploadsStore } from '../../stores/uploadsStore'
import RadialProgress from '../RadialProgress'
import StarIcon from '../stars/StarIcon'
import { useT } from '../../i18n'
import type { MsgStatus } from '../../data'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import s from './RealMediaBubble.module.scss'

// Display box (tweb mediaSizes.regular): photos/videos fit within, aspect kept.
const BOX_W = 320
const BOX_H = 420

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`
  return `${n} Б`
}

function Ticks({ status, color }: { status?: MsgStatus; color: string }) {
  if (!status) return null
  if (status === 'sending') return <TgIcon name="sending" size={16} color={color} />
  if (status === 'error') return <TgIcon name="sendingerror" size={16} color="#ff595a" />
  return <TgIcon name={status === 'read' ? 'checks' : 'check'} size={16} color={color} />
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
  out: boolean
  time?: string
  status?: MsgStatus
  tickColor: string
  onOpen?: (mediaId: number, el: HTMLElement) => void
  // Автозагрузка для чата (tweb autoDownloadSize): 0 = грузить только по клику
  autoDownload?: ChatAutoDownload
  // Мгновенное превью исходящего медиа + кольцо прогресса аплоада
  localUrl?: string
  clientId?: string
  /** крестик на кольце: отменить аплоад (tweb ProgressivePreloader cancel) */
  onCancelUpload?: (clientId: string) => void
  radius?: string
  /** платное медиа (Telegram paid media): цена + заблокировано ли для зрителя */
  paidMedia?: { price: number; locked: boolean }
  /** разблокировать платное медиа за звёзды (списывает у покупателя) */
  onUnlockPaid?: () => Promise<void>
}

export default function RealMediaBubble({
  mediaId, type, width, height, mime, blur, hasThumb, duration, size, fileName,
  out, time, status, tickColor, onOpen, autoDownload, localUrl, clientId, onCancelUpload, radius,
  paidMedia, onUnlockPaid,
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
  // Image fade-in: blur/shimmer placeholder → image fades in once decoded. We read
  // the browser's REAL cache state (img.complete) before paint instead of tracking
  // a "loaded" flag ourselves: a cached <img> (e.g. a bubble remounted on chat
  // switch) reports complete synchronously, so it shows instantly with no
  // placeholder flash — while genuinely-new images still start hidden and fade in.
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  useLayoutEffect(() => {
    const img = imgRef.current
    setImgLoaded(!!(img && img.complete && img.naturalWidth > 0))
    setForced(false)
  }, [mediaId])

  // An audio file (mp3 etc.) renders as a music player even when sent "as a file"
  // (type document) — like Telegram. So audio mime overrides the document type.
  const isAudioMime = !!mime?.startsWith('audio/')
  const asFile = type === 'document' && !isAudioMime
  const isImage = !asFile && (type === 'photo' || !!mime?.startsWith('image/'))
  const isVideo = !asFile && (type === 'video' || !!mime?.startsWith('video/'))
  const isAudio = !asFile && (type === 'audio' || isAudioMime)

  const timeCluster: ReactNode = time ? (
    <div className={s.timeCluster}>
      <Text size={12} color={out ? tickColor : 'var(--tg-textFaint)'} style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</Text>
      {out && <Ticks status={status} color={tickColor} />}
    </div>
  ) : null

  // ---- Photo / video ----
  if (isImage || isVideo) {
    const box = calcImageInBox(width || 0, height || 0, BOX_W, BOX_H)
    const lqip = blur ? `url("data:image/jpeg;base64,${blur}")` : undefined
    // Платное медиа, ещё не оплачено (Telegram paid media): вместо контента —
    // размытый плейсхолдер (blur) с оверлеем «Разблокировать за N ⭐». media_id
    // сервер не отдал, поэтому кроме blur/размеров у нас ничего нет.
    if (paidMedia?.locked) {
      return (
        <div
          className={classNames(s.media, s.paidLocked)}
          style={{ width: box.width, height: box.height, borderRadius: radius, backgroundImage: lqip }}
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
    // Synchronous src (no RPC). GIFs show the animated content; others prefer the
    // smaller server thumbnail, falling back to the original.
    const displaySrc = localUrl
      ? localUrl
      : !tokenReady || blocked || mediaId == null
        ? ''
        : isGif || gifVideo
          ? mediaContentUrl(mediaId)
          : hasThumb ? mediaThumbUrl(mediaId) : mediaContentUrl(mediaId)
    return (
      <div
        className={s.media}
        onClick={(e) => (blocked ? setForced(true) : mediaId != null ? onOpen?.(mediaId, e.currentTarget) : undefined)}
        style={{ width: box.width, height: box.height, borderRadius: radius, backgroundImage: lqip }}
      >
        {/* Shimmer over the blur preview while the image loads. It sits BEHIND the
            <img> (earlier in DOM, both absolute) so it never covers the picture;
            the image itself is never opacity-gated, so a browser-cached image (e.g.
            a bubble remounted on chat switch) paints instantly with no flash. */}
        {!imgLoaded && !blocked && (
          <div className={s.shimmerWrap}>
            <div className={s.shimmer} />
          </div>
        )}
        {displaySrc ? (
          gifVideo ? (
            <video
              className={s.img}
              src={displaySrc}
              autoPlay
              muted
              loop
              playsInline
              onLoadedData={() => setImgLoaded(true)}
              onError={() => { void primeMediaToken(true) }}
            />
          ) : (
            <img ref={imgRef} className={s.img} src={displaySrc} alt="" decoding="async" onLoad={() => setImgLoaded(true)} onError={() => { void primeMediaToken(true) }} />
          )
        ) : null}
        {blocked && (
          <div className={s.play}>
            <div className={s.playDisc}>
              <TgIcon name="download" size={30} color="#fff" />
            </div>
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
        {gifLike && (
          <div className={s.badgeTL}>
            <Text size={11} weight={700} color="#fff" style={{ letterSpacing: '0.04em' }}>GIF</Text>
          </div>
        )}
        {isVideo && !blocked && !gifVideo && (
          <div className={s.play}>
            <div className={s.playDisc}>
              <TgIcon name="play" size={34} color="#fff" />
            </div>
          </div>
        )}
        {isVideo && !gifVideo && !!duration && (
          <div className={s.badgeTL}>
            <Text size={12} color="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDur(duration)}</Text>
          </div>
        )}
        {time && (
          <div className={s.timeBadge}>
            <Text size={12} color="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</Text>
            {out && <Ticks status={status} color="#fff" />}
          </div>
        )}
      </div>
    )
  }

  // ---- Music (audio, compressed) ----
  if (isAudio) {
    return (
      <AudioRow
        mediaId={mediaId} name={fileName || `audio-${mediaId}`} duration={duration} size={size}
        time={timeCluster}
        primary={out ? '#fff' : 'var(--tg-textPrimary)'}
        secondary={out ? 'rgba(255,255,255,0.7)' : 'var(--tg-textSecondary)'}
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
      name={name} size={size} mime={mime} href={href} out={out}
      uploadProgress={uploadProgress} onCancelUpload={cancelUpload}
      timeCluster={timeCluster}
    />
  )
}

// ---- Строка документа с управляемым скачиванием (tweb ProgressivePreloader):
// клик → fetch с чтением потока и кольцом «скачано / всего» на иконке; клик по
// кольцу — отмена. По завершении файл сохраняется как обычная загрузка.
function DocRow({ name, size, mime, href, out, uploadProgress, onCancelUpload, timeCluster }: {
  name: string
  size?: number
  mime?: string
  href?: string
  out: boolean
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
  return (
    <a
      className={classNames(s.fileRow, s.doc, s.docRow)}
      href={href}
      download={name}
      onClick={startDownload}
      data-out={out || undefined}
      style={{ '--doc-color': DOC_EXT_COLORS[ext] ?? 'var(--tg-accent)' } as React.CSSProperties}
    >
      <div className={s.docIco}>
        {ring != null ? (
          <span className={s.docProgress}>
            <RadialProgress progress={ring} size={44} />
            <TgIcon name="close" size={20} color="#fff" className={s.cancelX} />
          </span>
        ) : (
          <>
            <span className={s.docExt}>{ext}</span>
            <span className={s.docDl}>
              <TgIcon name="download" size={26} color="#fff" />
            </span>
          </>
        )}
      </div>
      <div className={s.fileBody}>
        <Text noWrap size={16} weight={700} color="var(--m-primary)">{name}</Text>
        <div className={s.fileSub}>
          <Text size={14} color="var(--m-secondary)">{sub}</Text>
          {timeCluster}
        </div>
      </div>
    </a>
  )
}

// Цвета расширений (tweb _document.scss .ext-*)
const DOC_EXT_COLORS: Record<string, string> = {
  pdf: '#DF3F40',
  zip: '#FB8C00',
  apk: '#43A047',
}

// Music row: plays through the GLOBAL audio player (same as voice messages), so a
// track shows in the now-playing plate and only one thing plays at a time. While
// this file is the active track the row flips to pause + a seekable progress bar
// (tweb). Otherwise it shows duration • size.
function AudioRow({ mediaId, name, duration, size, primary, secondary, time, uploadProgress, onCancelUpload }: {
  mediaId?: number
  name: string
  duration?: number
  size?: number
  primary: string
  secondary: string
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

  return (
    <div className={classNames(s.fileRow, s.audio)}>
      {uploadProgress != null ? (
        <div className={classNames(s.circle, s.circleBtn, s.cancelRing)} onClick={onCancelUpload}>
          <RadialProgress progress={uploadProgress} size={44} />
          {onCancelUpload && <TgIcon name="close" size={20} color="#fff" className={s.cancelX} />}
        </div>
      ) : (
        <div className={classNames(s.circle, s.circleBtn)} onClick={onPlay}>
          {playing ? <TgIcon name="pause" size={28} /> : <TgIcon name="play" size={28} />}
        </div>
      )}
      <div className={s.fileBody}>
        <Text noWrap size={14.5} weight={600} color={primary}>{name}</Text>
        {isCurrent ? (
          <div className={s.progressRow}>
            <div className={s.progressTrack} onClick={onSeek}>
              <div className={s.progressFill} style={{ width: `${frac * 100}%`, background: 'var(--tg-accent)' }} />
            </div>
            <Text size={12.5} color={secondary} style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtDur(Math.floor(curTime))}</Text>
            {time}
          </div>
        ) : (
          <div className={s.fileSub}>
            <Text size={12.5} color={secondary}>{sub}</Text>
            {time}
          </div>
        )}
      </div>
    </div>
  )
}
