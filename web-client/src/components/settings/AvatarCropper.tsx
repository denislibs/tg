import { useEffect, useRef, useState } from 'react'
import IconButton from '../../shared/ui/IconButton'
import Slider from '../../shared/ui/Slider'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import s from './AvatarCropper.module.scss'

const CROP = 300 // on-screen crop diameter (square)
const OUT = 640 // exported avatar size (square px)
const MAX_ZOOM = 3

// A simple circular avatar cropper (a much-reduced MediaEditor): pick a square
// region with drag-to-pan and zoom, then export a JPEG blob. The full editor
// (filters/text/draw) comes later.
export default function AvatarCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File
  onCancel: () => void
  onConfirm: (blob: Blob, width: number, height: number) => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  // Load the picked file into an Image element.
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => setImg(im)
    im.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Base scale to "cover" the crop square; zoom multiplies it.
  const baseScale = img ? CROP / Math.min(img.naturalWidth, img.naturalHeight) : 1
  const scale = baseScale * zoom
  const dispW = img ? img.naturalWidth * scale : 0
  const dispH = img ? img.naturalHeight * scale : 0

  // Clamp the offset so the image always covers the crop square.
  const clamp = (o: { x: number; y: number }) => {
    const minX = CROP - dispW
    const minY = CROP - dispH
    return { x: Math.min(0, Math.max(minX, o.x)), y: Math.min(0, Math.max(minY, o.y)) }
  }

  // Re-clamp / recentre whenever the zoom (and thus dispW/H) changes.
  useEffect(() => {
    if (!img) return
    setOffset((o) => clamp(o))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, img])

  // Centre the image on first load.
  useEffect(() => {
    if (!img) return
    setOffset({ x: (CROP - dispW) / 2, y: (CROP - dispH) / 2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img])

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setOffset(clamp({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) }))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const confirm = () => {
    if (!img) return
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Map the crop square back into source-image pixels.
    const sx = -offset.x / scale
    const sy = -offset.y / scale
    const s = CROP / scale
    ctx.drawImage(img, sx, sy, s, s, 0, 0, OUT, OUT)
    canvas.toBlob((b) => b && onConfirm(b, OUT, OUT), 'image/jpeg', 0.9)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={s.root}
    >
      <div className={s.header}>
        <IconButton onClick={onCancel} color="#fff">
          <TgIcon name="close" />
        </IconButton>
      </div>

      <div className={s.stage}>
        <div
          className={s.crop}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {img && (
            <img
              className={s.img}
              src={img.src}
              alt=""
              draggable={false}
              style={{ left: offset.x, top: offset.y, width: dispW, height: dispH }}
            />
          )}
        </div>
      </div>

      {/* zoom control */}
      <div className={s.zoom}>
        <TgIcon name="minus" color="#fff" />
        <Slider min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={setZoom} color="#fff" />
        <TgIcon name="add" color="#fff" />
      </div>

      {/* confirm */}
      <div className={s.confirm}>
        <IconButton onClick={confirm} color="#fff" className={s.confirmBtn}>
          <TgIcon name="check" />
        </IconButton>
      </div>
    </motion.div>
  )
}
