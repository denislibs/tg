// src/components/messages/RealMediaBubble.tsx
// The real-chat media bubble: renders a backend media object (by id) as a photo,
// video, music row, or downloadable file — styled after tweb's wrappers.
//
// Everything needed to render comes from the message itself (history read model:
// dims, mime, blur preview, thumb flag, duration, size, name) and media URLs are
// built SYNCHRONOUSLY on the main thread (see core/mediaUrl). So a media bubble
// does ZERO per-image requests on mount — no meta/contentUrl RPC round-trips —
// which is what used to make the feed jitter while scrolling.
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import { calcImageInBox } from '../../core/dom/calcImageInBox'
import { fmtDur } from '../../core/hooks/useVoiceRecorder'
import { useAudioStore } from '../../stores/audioStore'
import { mediaContentUrl, mediaThumbUrl, hasMediaToken, primeMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
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
  mediaId: number
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
  radius?: string
}

export default function RealMediaBubble({
  mediaId, type, width, height, mime, blur, hasThumb, duration, size, fileName,
  out, time, status, tickColor, onOpen, autoDownload, radius,
}: Props) {
  useMediaTokenVersion() // re-render when the media token is (re)primed → fresh URLs
  const tokenReady = hasMediaToken()
  // Автозагрузка выключена → грузим только после клика (tweb noAutoDownload)
  const [forced, setForced] = useState(false)
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
    const isGif = mime === 'image/gif'
    // Гейт автозагрузки (tweb useAutoDownloadSettings → wrapPhoto autoDownloadSize):
    // GIF и видео идут по настройке «Видео», остальное — «Фото». При 0 показываем
    // blur-превью с кнопкой загрузки; клик грузит, следующий клик открывает.
    const blocked = !forced && !!autoDownload
      && (isVideo || isGif ? autoDownload.video === 0 : autoDownload.photo === 0)
    // Synchronous src (no RPC). GIFs show the animated content; others prefer the
    // smaller server thumbnail, falling back to the original.
    const displaySrc = !tokenReady || blocked
      ? ''
      : isGif
        ? mediaContentUrl(mediaId)
        : hasThumb ? mediaThumbUrl(mediaId) : mediaContentUrl(mediaId)
    return (
      <div
        className={s.media}
        onClick={(e) => (blocked ? setForced(true) : onOpen?.(mediaId, e.currentTarget))}
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
        {displaySrc ? <img ref={imgRef} className={s.img} src={displaySrc} alt="" decoding="async" onLoad={() => setImgLoaded(true)} onError={() => { void primeMediaToken(true) }} /> : null}
        {blocked && (
          <div className={s.play}>
            <div className={s.playDisc}>
              <TgIcon name="download" size={30} color="#fff" />
            </div>
          </div>
        )}
        {isGif && (
          <div className={s.badgeTL}>
            <Text size={11} weight={700} color="#fff" style={{ letterSpacing: '0.04em' }}>GIF</Text>
          </div>
        )}
        {isVideo && !blocked && (
          <div className={s.play}>
            <div className={s.playDisc}>
              <TgIcon name="play" size={34} color="#fff" />
            </div>
          </div>
        )}
        {isVideo && !!duration && (
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
      />
    )
  }

  // ---- Document / file ----
  const name = fileName || `media-${mediaId}`
  const ext = (name.split('.').pop() || '').slice(0, 4).toUpperCase()
  const sub = size ? fmtSize(size) : ''
  const href = tokenReady ? mediaContentUrl(mediaId) : undefined
  return (
    <div className={classNames(s.fileRow, s.doc)} data-out={out || undefined}>
      <a className={s.circle} href={href} download={name}>
        {ext ? <Text size={11} weight={700}>{ext}</Text> : <TgIcon name="document" />}
        <div className={s.dl}>
          <TgIcon name="download" size={22} />
        </div>
      </a>
      <div className={s.fileBody}>
        <Text noWrap size={14.5} weight={600} color="var(--m-primary)">{name}</Text>
        <div className={s.fileSub}>
          <Text size={12.5} color="var(--m-secondary)">{sub}</Text>
          {timeCluster}
        </div>
      </div>
    </div>
  )
}

// Music row: plays through the GLOBAL audio player (same as voice messages), so a
// track shows in the now-playing plate and only one thing plays at a time. While
// this file is the active track the row flips to pause + a seekable progress bar
// (tweb). Otherwise it shows duration • size.
function AudioRow({ mediaId, name, duration, size, primary, secondary, time }: {
  mediaId: number
  name: string
  duration?: number
  size?: number
  primary: string
  secondary: string
  time: ReactNode
}) {
  const isCurrent = useAudioStore((s) => s.track?.mediaId === mediaId)
  const playing = useAudioStore((s) => s.playing && s.track?.mediaId === mediaId)
  const curTime = useAudioStore((s) => (s.track?.mediaId === mediaId ? s.currentTime : 0))
  const curDur = useAudioStore((s) => (s.track?.mediaId === mediaId ? s.duration : 0))
  const seekFraction = useAudioStore((s) => s.seekFraction)
  const toggle = useAudioStore((s) => s.toggle)
  const playQueue = useAudioStore((s) => s.playQueue)

  const sizeStr = size ? fmtSize(size) : ''
  const sub = [duration ? fmtDur(duration) : '', sizeStr].filter(Boolean).join(' • ')

  const onPlay = () => {
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
      <div className={classNames(s.circle, s.circleBtn)} onClick={onPlay}>
        {playing ? <TgIcon name="pause" size={28} /> : <TgIcon name="play" size={28} />}
      </div>
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
