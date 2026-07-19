// src/components/messages/MediaLightbox.tsx
// Full-screen media viewer for real-chat photos/videos. The open/close morph is a
// port of tweb's appMediaViewerBase.setMoverToTarget:
//  - «мовер» (fixed, transform-origin: top left) едет и масштабируется
//    НЕ-униформно (scale3d(sx, sy)) между rect миниатюры и центральным боксом —
//    чистый CSS-переход transform 200ms ease на компоновщике (не JS-анимация,
//    поэтому не роняет кадры при тяжёлых перерисовках);
//  - внутри — «аспектер» с контр-скейлом (scale3d(1/sx, 1/sy)) и cover-картинкой:
//    морф кропа — квадратная плитка галереи раскрывается в полный кадр бесшовно;
//  - радиус миниатюры анимируется (на закрытии ставится на полпути, как в tweb);
//  - весь хром (фон, панель, стрелки) гаснет opacity 200ms ease-in-out;
//  - unmount ровно через delay (tweb resolve по setTimeout(delay)).
// На закрытии rect миниатюры замеряется заново; если она ушла из вьюпорта —
// tweb-поведение: движения нет, только fade.
import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'
import { motion, AnimatePresence } from 'framer-motion'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import { peerColor } from '../peerColor'
import { useManagers } from '../../core/hooks/useManagers'
import type { MediaMeta } from '../../core/managers/mediaManager'
import { enterPip, pipSupported, usePortalContainer } from '../../core/pip'
import s from './MediaLightbox.module.scss'

export interface LightboxItem {
  mediaId?: number
  /** прямой URL картинки без mediaId (фото профиля — tweb openAvatarViewer) */
  src?: string
  type?: string
  sender?: string
  date?: string
  /** натуральные размеры медиа (из сообщения) — центральный бокс стабилен с 1-го кадра */
  width?: number
  height?: number
}
interface Rect { top: number; left: number; width: number; height: number }

const OPEN_MS = 200 // tweb OPEN_TRANSITION_TIME
const ZOOM_SPRING = { type: 'spring' as const, stiffness: 260, damping: 30, mass: 0.9 }

function fit(natW: number, natH: number, maxW: number, maxH: number) {
  if (!natW || !natH) return { width: Math.min(maxW, 800), height: Math.min(maxH, 600) }
  const r = Math.min(maxW / natW, maxH / natH)
  return { width: Math.round(natW * r), height: Math.round(natH * r) }
}

// Радиусы углов миниатюры [tl, tr, br, bl] — mover масштабируется не-униформно,
// поэтому радиус компенсируется эллиптически (x/sx, y/sy), как в tweb.
function cornerRadii(el?: HTMLElement): number[] {
  if (!el) return [0, 0, 0, 0]
  const cs = getComputedStyle(el)
  return [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]
    .map((v) => parseFloat(v) || 0)
}
const ellipticalRadius = (radii: number[], sx: number, sy: number) =>
  `${radii.map((r) => `${r / sx}px`).join(' ')} / ${radii.map((r) => `${r / sy}px`).join(' ')}`

const doubleRaf = () => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))

export default function MediaLightbox({ items, index, originRect, originSrc, originEl, onClose, onClosingStart }: {
  items: LightboxItem[]
  index: number
  originRect: Rect
  originSrc?: string
  // Исходная миниатюра: rect замеряется заново в момент закрытия (лента могла
  // проскроллиться) — mover летит в АКТУАЛЬНОЕ место, не в устаревшее.
  originEl?: HTMLElement
  onClose: () => void
  // Called the instant the close animation starts — the parent reveals the source
  // thumbnail again here so there's never a hidden-thumbnail "empty bubble" gap
  // behind the shrinking/fading clone.
  onClosingStart?: () => void
}) {
  const managers = useManagers()
  const portalContainer = usePortalContainer()
  const [idx, setIdx] = useState(index)
  const [meta, setMeta] = useState<MediaMeta | null>(null)
  const [url, setUrl] = useState('')
  // Shown image: starts as the clicked thumbnail (already cached, so the morph
  // grows a VISIBLE picture) and swaps to full-res once decoded.
  const [imgSrc, setImgSrc] = useState(originSrc ?? '')
  const [closing, setClosing] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rot, setRot] = useState(0)
  // The FLIP origin applies only to the first-opened item; paging clears it (no
  // thumbnail to fly from/to → plain crossfade).
  const [flyFrom, setFlyFrom] = useState<Rect | null>(originRect)
  // натуральные размеры direct-src картинки (аватарки) — меты у неё нет
  const [natSize, setNatSize] = useState<{ w: number; h: number } | null>(null)

  const moverRef = useRef<HTMLDivElement>(null)
  const aspecterRef = useRef<HTMLDivElement>(null)
  const videoElRef = useRef<HTMLVideoElement>(null)
  const closingRef = useRef(false)
  const radiiRef = useRef<number[]>([0, 0, 0, 0])

  const item = items[idx]
  const isVideo = item?.type === 'video' || !!meta?.mime.startsWith('video/')

  useEffect(() => { setZoom(1); setRot(0) }, [idx])

  useEffect(() => {
    let alive = true
    setMeta(null); setUrl(''); setNatSize(null)
    if (item.mediaId == null) {
      const src = item.src
      if (!src) return
      const pre = new Image()
      pre.onload = () => {
        if (!alive) return
        setNatSize({ w: pre.naturalWidth, h: pre.naturalHeight })
        setUrl(src)
        const delay = flyFrom ? OPEN_MS + 40 : 0
        window.setTimeout(() => { if (alive) setImgSrc(src) }, delay)
      }
      pre.src = src
      return () => { alive = false }
    }
    const mediaId = item.mediaId
    const video = item.type === 'video'
    void managers.media.meta(mediaId).then((m) => {
      if (!alive) return
      setMeta(m)
      if (m.hasThumb) void managers.media.thumbUrl(mediaId).then((u) => { if (alive) setImgSrc((s) => s || u) })
    })
    void managers.media.contentUrl(mediaId).then((u) => {
      if (!alive) return
      setUrl(u)
      if (video) return
      const pre = new Image()
      // Defer the full-res swap past the grow so its repaint can't drop frames
      // mid-animation; paged items (no flyFrom) swap as soon as decoded.
      const delay = flyFrom ? OPEN_MS + 40 : 0
      pre.onload = () => { if (alive) window.setTimeout(() => { if (alive) setImgSrc(u) }, delay) }
      pre.src = u
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.mediaId, item.src, item.type, managers])

  const vw = window.innerWidth, vh = window.innerHeight
  // Центральный бокс: по натуральным размерам медиа (как tweb) — они приходят в
  // сообщении; фолбэк — аспект миниатюры, затем meta.
  const dims = item?.width && item?.height
    ? { w: item.width, h: item.height }
    : meta?.width
      ? { w: meta.width, h: meta.height }
      : natSize
        ? { w: natSize.w, h: natSize.h }
        : { w: originRect.width, h: originRect.height }
  const final = useMemo(
    () => fit(dims.w, dims.h, vw * 0.92, vh * 0.84),
    [dims.w, dims.h, vw, vh],
  )
  const finalLeft = (vw - final.width) / 2
  const finalTop = (vh - final.height) / 2

  const restTransform = `translate3d(${finalLeft}px,${finalTop}px,0) scale3d(1,1,1)`

  // Snap-обновление мовера без анимации (первичная установка, пейджинг, ресайз).
  const snapToRest = () => {
    const m = moverRef.current, a = aspecterRef.current
    if (!m || !a) return
    m.classList.remove(s.animated)
    m.style.transform = restTransform
    m.style.borderRadius = ''
    m.style.opacity = ''
    a.style.cssText = ''
    void m.offsetLeft
    m.classList.add(s.animated)
  }

  const openedRef = useRef(false)
  useLayoutEffect(() => {
    const m = moverRef.current, a = aspecterRef.current
    if (!m || !a) return
    if (openedRef.current || !flyFrom) {
      snapToRest()
      return
    }
    // ── открытие: из rect миниатюры в центр (tweb setMoverToTarget, не closing) ──
    openedRef.current = true
    radiiRef.current = cornerRadii(originEl)
    const or = flyFrom
    const sx = or.width / final.width
    const sy = or.height / final.height
    m.classList.remove(s.animated)
    m.style.transform = `translate3d(${or.left}px,${or.top}px,0) scale3d(${sx},${sy},1)`
    m.style.borderRadius = ellipticalRadius(radiiRef.current, sx, sy)
    // аспектер: кроп миниатюры, контр-скейл до полного бокса
    a.style.width = `${or.width}px`
    a.style.height = `${or.height}px`
    a.style.transform = `scale3d(${final.width / or.width},${final.height / or.height},1)`
    void m.offsetLeft // reflow — зафиксировать стартовое состояние без перехода
    m.classList.add(s.animated)
    void doubleRaf().then(() => {
      if (closingRef.current) return
      m.style.transform = restTransform
      m.style.borderRadius = '0px'
      // tweb setFullAspect: та же высота, ширина по аспекту медиа — морф кропа
      const prop = final.width / final.height
      const w = or.height * prop
      a.style.width = `${w}px`
      a.style.height = `${or.height}px`
      a.style.transform = `scale3d(${final.width / w},${final.height / or.height},1)`
      // после перехода аспектер отдыхает на 100% (tweb чистит cssText по delay)
      window.setTimeout(() => {
        if (closingRef.current) return
        m.classList.remove(s.animated)
        a.style.cssText = ''
        void m.offsetLeft
        m.classList.add(s.animated)
      }, OPEN_MS)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final.width, final.height, finalLeft, finalTop, idx])

  const stepZoom = (d: number) => setZoom((z) => Math.min(4, Math.max(1, +(z + d).toFixed(2))))
  const nav = (dir: number) => {
    setFlyFrom(null)
    setImgSrc('')
    setIdx((i) => (i + dir + items.length) % items.length)
  }

  const close = () => {
    if (closingRef.current) return
    closingRef.current = true
    setZoom(1); setRot(0)
    onClosingStart?.() // reveal the source thumbnail now (no empty-bubble gap)
    setClosing(true) // хром (фон/панель/стрелки) гаснет CSS-переходом
    const m = moverRef.current, a = aspecterRef.current
    // Летим в миниатюру ТЕКУЩЕГО элемента (tweb перевешивает target при листании:
    // для первого — исходный originEl, для пролистанных — ищем его <img> в DOM),
    // и только если она всё ещё во вьюпорте — иначе tweb-поведение: только fade.
    let target: Rect | null = null
    let targetEl: HTMLElement | undefined
    const el = flyFrom
      ? originEl
      : item.mediaId != null
        ? (document.querySelector(`img[src*="/media/${item.mediaId}/"]`) as HTMLElement | null) ?? undefined
        : undefined
    if (el?.isConnected) {
      const r = el.getBoundingClientRect()
      const visible = r.width > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
      if (visible) {
        target = { top: r.top, left: r.left, width: r.width, height: r.height }
        targetEl = el
      }
    }
    if (m && a && target) {
      const radii = cornerRadii(targetEl)
      const sx = target.width / final.width
      const sy = target.height / final.height
      m.style.transform = `translate3d(${target.left}px,${target.top}px,0) scale3d(${sx},${sy},1)`
      a.style.width = `${target.width}px`
      a.style.height = `${target.height}px`
      a.style.transform = `scale3d(${final.width / target.width},${final.height / target.height},1)`
      // tweb ставит радиус на полпути анимации
      window.setTimeout(() => { m.style.borderRadius = ellipticalRadius(radii, sx, sy) }, OPEN_MS / 2)
    } else if (m) {
      m.style.opacity = '0'
    }
    window.setTimeout(onClose, OPEN_MS) // tweb резолвит ровно по delay
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

  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); stepZoom(e.deltaY < 0 ? 0.3 : -0.3) }
  const c = zoom * 140
  const multi = items.length > 1
  const download = async () => {
    const a = document.createElement('a')
    if (item.mediaId != null) {
      const m = await managers.media.meta(item.mediaId)
      a.download = m.fileName || `media-${item.mediaId}`
    } else {
      a.download = 'photo.jpg'
    }
    a.href = url
    document.body.appendChild(a); a.click(); a.remove()
  }

  // Портал в body: ConversationView живёт под framer-motion-предком с transform,
  // а он создаёт containing block для position:fixed — без портала лайтбокс
  // привязывался бы к колонке чата (съезжал вправо, сайдбар просвечивал).
  return createPortal(
    <div className={classNames(s.root, closing ? s.closing : '')} onClick={close}>
      {/* backdrop + хром гаснут вместе (tweb toggleWholeActive(false)) */}
      <div className={classNames(s.backdrop, s.chrome)} />

      {/* top bar: sender + date (left, like Telegram) · toolbar (right) */}
      <div className={classNames(s.topBar, s.chrome)} onClick={(e) => e.stopPropagation()}>
        {item?.sender && <Avatar background={peerColor(item.sender)} size={36} text={item.sender.charAt(0)} />}
        <div className={s.info}>
          {item?.sender && <Text noWrap size={15} weight={600}>{item.sender}</Text>}
          <Text noWrap size={13} color="rgba(255,255,255,0.6)">
            {item?.date}{multi ? `${item?.date ? ' · ' : ''}${idx + 1} из ${items.length}` : ''}
          </Text>
        </div>
        <div className={s.toolbar}>
          {isVideo && pipSupported() && (
            <IconButton title="Картинка в картинке" onClick={() => { if (videoElRef.current) void enterPip(videoElRef.current) }} color="#fff"><TgIcon name="pip" /></IconButton>
          )}
          <IconButton title="Повернуть (R)" onClick={() => setRot((r) => r - 90)} color="#fff"><TgIcon name="rotate_left" /></IconButton>
          <IconButton title="Увеличить (+)" onClick={() => stepZoom(0.5)} color="#fff"><TgIcon name="zoomin" /></IconButton>
          <IconButton title="Скачать" onClick={download} color="#fff"><TgIcon name="download" /></IconButton>
          <IconButton title="Закрыть (Esc)" onClick={close} color="#fff"><TgIcon name="close" /></IconButton>
        </div>
      </div>

      {/* prev / next */}
      {multi && (
        <>
          <IconButton className={classNames(s.nav, s.navLeft, s.chrome)} onClick={(e) => { e.stopPropagation(); nav(-1) }} title="Назад (←)" color="#fff"><TgIcon name="previous" size={30} /></IconButton>
          <IconButton className={classNames(s.nav, s.navRight, s.chrome)} onClick={(e) => { e.stopPropagation(); nav(1) }} title="Вперёд (→)" color="#fff"><TgIcon name="next" size={30} /></IconButton>
        </>
      )}

      {/* mover (tweb .media-viewer-mover): морф позиции/масштаба; внутри аспектер
          (морф кропа), внутри — слой зума/поворота */}
      <div
        ref={moverRef}
        key={item.mediaId ?? item.src}
        className={classNames(s.mover, s.animated)}
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}
        style={{ width: final.width, height: final.height, cursor: zoom > 1 ? 'grab' : 'zoom-in' }}
      >
        <div ref={aspecterRef} className={s.aspecter}>
          <motion.div
            drag={zoom > 1}
            dragConstraints={{ left: -c, right: c, top: -c, bottom: c }}
            dragElastic={0.12}
            dragMomentum={false}
            whileDrag={{ cursor: 'grabbing' }}
            animate={{ scale: zoom, rotate: rot }}
            transition={ZOOM_SPRING}
            className={s.zoomLayer}
          >
            {isVideo && url ? (
              <video ref={videoElRef} src={url} controls autoPlay className={s.media} />
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
                    className={s.media}
                  />
                )}
              </AnimatePresence>
            )}
          </motion.div>
        </div>
      </div>
    </div>,
    portalContainer,
  )
}
