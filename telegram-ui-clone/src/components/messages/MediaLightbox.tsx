// src/components/messages/MediaLightbox.tsx
// Full-screen media viewer for real-chat photos/videos. The open/close transition
// is an explicit FLIP: the media scales+translates from the clicked thumbnail's
// rect to the centred fullscreen box and back, so the photo literally grows out
// of (and shrinks back into) the bubble — ported from tweb's
// appMediaViewerBase.setMoverToTarget. (framer's cross-tree `layoutId` doesn't
// project reliably from inside the deep feed, so the FLIP is done by hand.)
//
// On top of the FLIP: zoom (wheel / +- / double-click), rotate (R), drag-to-pan
// when zoomed, a toolbar, and ←/→ paging across every photo/video in the chat.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Box } from '@mui/material'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import { motion, AnimatePresence } from 'framer-motion'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import { peerColor } from '../peerColor'
import { useManagers } from '../../core/hooks/useManagers'
import type { MediaMeta } from '../../core/managers/mediaManager'

export interface LightboxItem { mediaId: number; type?: string; sender?: string; date?: string }
interface Rect { top: number; left: number; width: number; height: number }

const OPEN_MS = 0.26 // grow/shrink duration
const OPEN_EASE = [0.32, 0.72, 0, 1] as const // snappy ease-out, tweb-ish
const ZOOM_SPRING = { type: 'spring' as const, stiffness: 260, damping: 30, mass: 0.9 }

function fit(natW: number, natH: number, maxW: number, maxH: number) {
  if (!natW || !natH) return { width: Math.min(maxW, 800), height: Math.min(maxH, 600) }
  const r = Math.min(maxW / natW, maxH / natH)
  return { width: Math.round(natW * r), height: Math.round(natH * r) }
}

export default function MediaLightbox({ items, index, originRect, originSrc, onClose, onClosingStart }: {
  items: LightboxItem[]
  index: number
  originRect: Rect
  originSrc?: string
  onClose: () => void
  // Called the instant the close animation starts — the parent reveals the source
  // thumbnail again here so there's never a hidden-thumbnail "empty bubble" gap
  // behind the shrinking/fading clone.
  onClosingStart?: () => void
}) {
  const managers = useManagers()
  const [idx, setIdx] = useState(index)
  const [meta, setMeta] = useState<MediaMeta | null>(null)
  const [url, setUrl] = useState('')
  // Shown image: starts as the clicked thumbnail (already cached, so the FLIP
  // grows a VISIBLE picture) and swaps to full-res once decoded.
  const [imgSrc, setImgSrc] = useState(originSrc ?? '')
  const [closing, setClosing] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  // The FLIP origin applies only to the first-opened item; paging clears it (no
  // thumbnail to fly from/to → plain crossfade).
  const [flyFrom, setFlyFrom] = useState<Rect | null>(originRect)

  const item = items[idx]
  const isVideo = item?.type === 'video' || !!meta?.mime.startsWith('video/')

  useEffect(() => { setZoom(1); setRot(0) }, [idx])

  useEffect(() => {
    let alive = true
    setMeta(null); setUrl('')
    const video = item.type === 'video'
    void managers.media.meta(item.mediaId).then((m) => {
      if (!alive) return
      setMeta(m)
      if (m.hasThumb) void managers.media.thumbUrl(item.mediaId).then((u) => { if (alive) setImgSrc((s) => s || u) })
    })
    void managers.media.contentUrl(item.mediaId).then((u) => {
      if (!alive) return
      setUrl(u)
      if (video) return
      const pre = new Image()
      // Defer the full-res swap past the grow so its repaint can't drop frames
      // mid-animation; paged items (no flyFrom) swap as soon as decoded.
      const delay = flyFrom ? OPEN_MS * 1000 + 40 : 0
      pre.onload = () => { if (alive) window.setTimeout(() => { if (alive) setImgSrc(u) }, delay) }
      pre.src = u
    })
    return () => { alive = false }
  }, [item.mediaId, item.type, managers])

  const stepZoom = (d: number) => setZoom((z) => Math.min(4, Math.max(1, +(z + d).toFixed(2))))
  const nav = (dir: number) => {
    setFlyFrom(null)
    setImgSrc('')
    setIdx((i) => (i + dir + items.length) % items.length)
  }
  const close = () => {
    setZoom(1); setRot(0)
    onClosingStart?.() // reveal the source thumbnail now (no empty-bubble gap)
    setClosing(true)
    window.setTimeout(onClose, OPEN_MS * 1000 + 30)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') nav(1)
      else if (e.key === 'ArrowLeft') nav(-1)
      else if (e.key === '+' || e.key === '=') stepZoom(0.4)
      else if (e.key === '-') stepZoom(-0.4)
      else if (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 'к') setRot((r) => r - 90)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items.length])

  const vw = window.innerWidth, vh = window.innerHeight
  // Centred final box: for the just-opened item derive from the thumbnail's aspect
  // (known immediately) so the box is stable from frame one; paged items size from
  // meta.
  const final = useMemo(
    () => flyFrom
      ? fit(originRect.width, originRect.height, vw * 0.92, vh * 0.84)
      : fit(meta?.width ?? 0, meta?.height ?? 0, vw * 0.92, vh * 0.84),
    [flyFrom, originRect, meta, vw, vh],
  )
  const finalLeft = (vw - final.width) / 2
  const finalTop = (vh - final.height) / 2

  // FLIP transform from the thumbnail rect to the centred final rect.
  const flip = flyFrom
    ? {
        scale: flyFrom.width / final.width,
        x: (flyFrom.left + flyFrom.width / 2) - (finalLeft + final.width / 2),
        y: (flyFrom.top + flyFrom.height / 2) - (finalTop + final.height / 2),
      }
    : { scale: 0.96, x: 0, y: 0 }

  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); stepZoom(e.deltaY < 0 ? 0.3 : -0.3) }
  const c = zoom * 140
  const multi = items.length > 1
  const download = async () => {
    const m = await managers.media.meta(item.mediaId)
    const a = document.createElement('a')
    a.href = url; a.download = m.fileName || `media-${item.mediaId}`
    document.body.appendChild(a); a.click(); a.remove()
  }

  return (
    <Box onClick={close} sx={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
      {/* backdrop — ONLY this fades; the photo clone stays opaque from frame 0 so
          it fully covers the (hidden) source thumbnail during the grow/shrink (no
          empty-bubble flash). */}
      <Box
        component={motion.div}
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: OPEN_MS }}
        sx={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.92)' }}
      />

      {/* top bar: sender + date (left, like Telegram) · toolbar (right) */}
      <Box onClick={(e) => e.stopPropagation()} sx={{ position: 'fixed', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', px: 1.5, py: 1.25, zIndex: 2, color: '#fff' }}>
        {item?.sender && <Avatar background={peerColor(item.sender)} size={36} text={item.sender.charAt(0)} />}
        <Box sx={{ ml: 1.25, minWidth: 0, lineHeight: 1.25 }}>
          {item?.sender && <Text noWrap size={15} weight={600}>{item.sender}</Text>}
          <Text noWrap size={13} color="rgba(255,255,255,0.6)">
            {item?.date}{multi ? `${item?.date ? ' · ' : ''}${idx + 1} из ${items.length}` : ''}
          </Text>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
          <IconButton title="Повернуть (R)" onClick={() => setRot((r) => r - 90)} color="#fff"><TgIcon name="rotate_left" /></IconButton>
          <IconButton title="Увеличить (+)" onClick={() => stepZoom(0.5)} color="#fff"><TgIcon name="zoomin" /></IconButton>
          <IconButton title="Скачать" onClick={download} color="#fff"><TgIcon name="download" /></IconButton>
          <IconButton title="Закрыть (Esc)" onClick={close} color="#fff"><TgIcon name="close" /></IconButton>
        </Box>
      </Box>

      {/* prev / next */}
      {multi && (
        <>
          <IconButton onClick={(e) => { e.stopPropagation(); nav(-1) }} title="Назад (←)" color="#fff" style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', width: 54, height: 54, background: 'rgba(255,255,255,0.08)', zIndex: 2, '--ib-hover': 'rgba(255,255,255,0.16)' } as CSSProperties}><TgIcon name="previous" size={30} /></IconButton>
          <IconButton onClick={(e) => { e.stopPropagation(); nav(1) }} title="Вперёд (→)" color="#fff" style={{ position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)', width: 54, height: 54, background: 'rgba(255,255,255,0.08)', zIndex: 2, '--ib-hover': 'rgba(255,255,255,0.16)' } as CSSProperties}><TgIcon name="next" size={30} /></IconButton>
        </>
      )}

      {/* media: outer = FLIP grow/shrink; inner = zoom/rotate/drag */}
      <Box
        component={motion.div}
        key={item.mediaId}
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}
        initial={{ opacity: flyFrom ? 1 : 0, scale: flip.scale, x: flip.x, y: flip.y }}
        animate={closing && flyFrom
          ? { opacity: 1, scale: flip.scale, x: flip.x, y: flip.y }
          : closing
            ? { opacity: 0, scale: 0.96, x: 0, y: 0 }
            : { opacity: 1, scale: 1, x: 0, y: 0 }}
        transition={{ duration: OPEN_MS, ease: OPEN_EASE }}
        style={{ position: 'fixed', left: finalLeft, top: finalTop, width: final.width, height: final.height, transformOrigin: 'center center', borderRadius: 8, overflow: 'hidden', cursor: zoom > 1 ? 'grab' : 'zoom-in' }}
      >
        <motion.div
          drag={zoom > 1}
          dragConstraints={{ left: -c, right: c, top: -c, bottom: c }}
          dragElastic={0.12}
          dragMomentum={false}
          whileDrag={{ cursor: 'grabbing' }}
          animate={{ scale: zoom, rotate: rot }}
          transition={ZOOM_SPRING}
          style={{ width: '100%', height: '100%', display: 'flex' }}
        >
          {isVideo && url ? (
            <video src={url} controls autoPlay style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <AnimatePresence mode="wait">
              {imgSrc && (
                <motion.img
                  key={imgSrc}
                  src={imgSrc}
                  alt=""
                  draggable={false}
                  initial={{ opacity: flyFrom ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none', pointerEvents: 'none' }}
                />
              )}
            </AnimatePresence>
          )}
        </motion.div>
      </Box>
    </Box>
  )
}
