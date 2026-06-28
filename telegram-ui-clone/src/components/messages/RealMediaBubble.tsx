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
import { Box, Typography, useTheme } from '@mui/material'
import TgIcon from '../TgIcon'
import { calcImageInBox } from '../../core/dom/calcImageInBox'
import { fmtDur } from '../../core/hooks/useVoiceRecorder'
import { useAudioStore } from '../../stores/audioStore'
import { mediaContentUrl, mediaThumbUrl, hasMediaToken, primeMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import type { MsgStatus } from '../../data'

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
  radius?: string
}

export default function RealMediaBubble({
  mediaId, type, width, height, mime, blur, hasThumb, duration, size, fileName,
  out, time, status, tickColor, onOpen, radius,
}: Props) {
  const tg = useTheme().tg
  useMediaTokenVersion() // re-render when the media token is (re)primed → fresh URLs
  const tokenReady = hasMediaToken()
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
  }, [mediaId])

  // An audio file (mp3 etc.) renders as a music player even when sent "as a file"
  // (type document) — like Telegram. So audio mime overrides the document type.
  const isAudioMime = !!mime?.startsWith('audio/')
  const asFile = type === 'document' && !isAudioMime
  const isImage = !asFile && (type === 'photo' || !!mime?.startsWith('image/'))
  const isVideo = !asFile && (type === 'video' || !!mime?.startsWith('video/'))
  const isAudio = !asFile && (type === 'audio' || isAudioMime)

  const timeCluster: ReactNode = time ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
      <Typography sx={{ fontSize: 12, color: out ? tickColor : tg.textFaint, fontVariantNumeric: 'tabular-nums' }}>{time}</Typography>
      {out && <Ticks status={status} color={tickColor} />}
    </Box>
  ) : null

  // ---- Photo / video ----
  if (isImage || isVideo) {
    const box = calcImageInBox(width || 0, height || 0, BOX_W, BOX_H)
    const lqip = blur ? `url("data:image/jpeg;base64,${blur}")` : undefined
    const isGif = mime === 'image/gif'
    // Synchronous src (no RPC). GIFs show the animated content; others prefer the
    // smaller server thumbnail, falling back to the original.
    const displaySrc = !tokenReady
      ? ''
      : isGif
        ? mediaContentUrl(mediaId)
        : hasThumb ? mediaThumbUrl(mediaId) : mediaContentUrl(mediaId)
    return (
      <Box
        onClick={(e) => onOpen?.(mediaId, e.currentTarget)}
        sx={{ position: 'relative', width: box.width, height: box.height, maxWidth: '100%', cursor: 'pointer', borderRadius: radius, overflow: 'hidden', backgroundImage: lqip, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: lqip ? undefined : 'rgba(127,127,127,0.16)', '& img': { cursor: 'pointer' } }}
      >
        {/* Shimmer over the blur preview while the image loads. It sits BEHIND the
            <img> (earlier in DOM, both absolute) so it never covers the picture;
            the image itself is never opacity-gated, so a browser-cached image (e.g.
            a bubble remounted on chat switch) paints instantly with no flash. */}
        {!imgLoaded && (
          <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.14) 50%, transparent 70%)', animation: 'mediaShimmer 1.25s infinite' }} />
          </Box>
        )}
        {displaySrc ? <img ref={imgRef} src={displaySrc} alt="" decoding="async" onLoad={() => setImgLoaded(true)} onError={() => { void primeMediaToken(true) }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        {isGif && (
          <Box sx={{ position: 'absolute', left: 8, top: 8, px: 0.75, py: 0.25, borderRadius: '10px', background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>GIF</Typography>
          </Box>
        )}
        {isVideo && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <Box sx={{ width: 54, height: 54, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TgIcon name="play" size={34} color="#fff" />
            </Box>
          </Box>
        )}
        {isVideo && !!duration && (
          <Box sx={{ position: 'absolute', left: 8, top: 8, px: 0.75, py: 0.25, borderRadius: '10px', background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }}>
            <Typography sx={{ fontSize: 12, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(duration)}</Typography>
          </Box>
        )}
        {time && (
          <Box sx={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', alignItems: 'center', gap: 0.25, px: 0.75, py: 0.25, borderRadius: '10px', background: 'rgba(0,0,0,0.45)' }}>
            <Typography sx={{ fontSize: 12, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{time}</Typography>
            {out && <Ticks status={status} color="#fff" />}
          </Box>
        )}
      </Box>
    )
  }

  // ---- Music (audio, compressed) ----
  if (isAudio) {
    return (
      <AudioRow
        mediaId={mediaId} name={fileName || `audio-${mediaId}`} duration={duration} size={size}
        accent={tg.accent} time={timeCluster}
        primary={out ? '#fff' : tg.textPrimary}
        secondary={out ? 'rgba(255,255,255,0.7)' : tg.textSecondary}
      />
    )
  }

  // ---- Document / file ----
  const name = fileName || `media-${mediaId}`
  const ext = (name.split('.').pop() || '').slice(0, 4).toUpperCase()
  const sub = size ? fmtSize(size) : ''
  const href = tokenReady ? mediaContentUrl(mediaId) : undefined
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 1, minWidth: 200 }}>
      <Box component="a" href={href} download={name} sx={{ width: 48, height: 48, flexShrink: 0, borderRadius: '50%', background: out ? 'rgba(255,255,255,0.22)' : tg.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', position: 'relative', '&:hover .dl': { opacity: 1 } }}>
        {ext ? <Typography sx={{ fontSize: 11, fontWeight: 700 }}>{ext}</Typography> : <TgIcon name="document" />}
        <Box className="dl" sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity .15s', background: 'rgba(0,0,0,0.25)', borderRadius: '50%' }}>
          <TgIcon name="download" size={22} />
        </Box>
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontSize: 14.5, fontWeight: 600, color: out ? '#fff' : tg.textPrimary }}>{name}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography sx={{ fontSize: 12.5, color: out ? 'rgba(255,255,255,0.7)' : tg.textSecondary }}>{sub}</Typography>
          {timeCluster}
        </Box>
      </Box>
    </Box>
  )
}

// Music row: plays through the GLOBAL audio player (same as voice messages), so a
// track shows in the now-playing plate and only one thing plays at a time. While
// this file is the active track the row flips to pause + a seekable progress bar
// (tweb). Otherwise it shows duration • size.
function AudioRow({ mediaId, name, duration, size, accent, primary, secondary, time }: {
  mediaId: number
  name: string
  duration?: number
  size?: number
  accent: string
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
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 1, minWidth: 240 }}>
      <Box onClick={onPlay} sx={{ width: 48, height: 48, flexShrink: 0, borderRadius: '50%', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        {playing ? <TgIcon name="pause" size={28} /> : <TgIcon name="play" size={28} />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontSize: 14.5, fontWeight: 600, color: primary }}>{name}</Typography>
        {isCurrent ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Box
              onClick={onSeek}
              sx={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(127,127,127,0.35)', cursor: 'pointer', position: 'relative' }}
            >
              <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, background: accent, borderRadius: 2 }} />
            </Box>
            <Typography sx={{ fontSize: 12.5, color: secondary, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtDur(Math.floor(curTime))}</Typography>
            {time}
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography sx={{ fontSize: 12.5, color: secondary }}>{sub}</Typography>
            {time}
          </Box>
        )}
      </Box>
    </Box>
  )
}
