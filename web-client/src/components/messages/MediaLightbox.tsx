// src/components/messages/MediaLightbox.tsx
// Умирает в стадии E медиа-суперпорта (замена — vanilla-ядро вьювера), поэтому
// Task 7 его на useMediaUrl/downloadMediaURL сознательно НЕ переводит: остаётся
// на RPC contentUrl/thumbUrl/streamUrl до сноса вместе с useLightbox.
// Медиавьюер. Дерево и классы — дословно из tweb (`mediaViewer/base.ts:318-435`,
// живой DOM — `docs/research/2026-08-08-tweb-live-dom-reference.md` §9):
//
//   div.media-viewer-whole[.active]
//     div.zoom-container                       − · .progress-line · +
//     div.overlays > .media-viewer > .media-viewer-content
//                                    > .media-viewer-container > .media-viewer-media
//     div.media-viewer-topbar.media-viewer-appear
//       .media-viewer-topbar-left > btn-icon.only-handhelds + .media-viewer-author
//       .media-viewer-buttons
//     div.media-viewer-movers
//       .media-viewer-switcher.media-viewer-switcher-left|right[.hide] > span.tgico
//       .media-viewer-mover-wrapper > .media-viewer-mover > .media-viewer-aspecter
//                                     [> .ckin__player.default > video.ckin__video]
//     div.media-viewer-caption.spoilers-container[.hide] > .scrollable.scrollable-y
//
// Все стили — из портированного партиала `styles/tweb/_mediaViewer.scss`; локальный
// модуль держит только утилиты из ещё не портированных файлов tweb.
//
// Морф открытия/закрытия — порт `setMoverToTarget`: «мовер» (fixed,
// transform-origin: top left) едет и масштабируется НЕ-униформно
// (scale3d(sx, sy)) между rect миниатюры и центральным боксом — чистый
// CSS-переход из партиала (`.media-viewer-mover.active`, 200 ms); внутри —
// «аспектер» с контр-скейлом (морф кропа: квадратная плитка галереи бесшовно
// раскрывается в полный кадр); радиус миниатюры анимируется (на закрытии
// ставится на полпути, как в tweb). Хром (фон/панель/подпись) гаснет классом
// `.media-viewer-whole.active` из партиала, не инлайн-стилями.
//
// Листание — порт `moveTheMover`: уходящий мовер уезжает за экран за 350 ms
// (`.media-viewer-mover.moving`), новый въезжает с противоположной стороны;
// кольцевого листания нет — на краях свитчер получает `.hide`.
//
// Зум/поворот/пан — порт `buildMoversTransform`: один трансформ на
// `.media-viewer-movers` (screen-space zoom/pan снаружи, rotate вокруг центра
// кадра внутри). framer-motion здесь не используется.
import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import IconButton from '../../shared/ui/IconButton'
import Slider from '../../shared/ui/Slider'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import RichText from '../RichText'
import Avatar from '../../shared/ui/Avatar'
import { glyph } from '../../core/tgico-icons'
import { peerColor } from '../peerColor'
import { calcImageInBox } from '../../core/dom/calcImageInBox'
import { useManagers } from '../../core/hooks/useManagers'
import { useNavLayer } from '../../core/hooks/useNavLayer'
import { getSecretMediaUrl } from '../../core/secret/mediaCache'
import type { MediaMeta } from '../../core/managers/mediaManager'
import type { MessageEntity } from '../../core/models'
import { enterPip, pipSupported, usePortalContainer } from '../../core/pip'
import { pushEsc } from '../../core/hotkeys'
import { useSettingsStore } from '../../settings'
import { doubleRaf } from '@helpers/schedulers'
import VideoPlayer from './VideoPlayer'
import s from './MediaLightbox.module.scss'

export interface LightboxItem {
  mediaId?: number
  /** прямой URL картинки без mediaId (фото профиля — tweb openAvatarViewer) */
  src?: string
  /** видео-вариант фото профиля (tweb photo_video): играем muted-loop, poster = src */
  videoUrl?: string
  type?: string
  sender?: string
  date?: string
  /** подпись к медиа (tweb `.media-viewer-caption`) + её rich-text сущности */
  caption?: string
  captionEntities?: MessageEntity[]
  /** натуральные размеры медиа (из сообщения) — центральный бокс стабилен с 1-го кадра */
  width?: number
  height?: number
  /** секретное медиа (E2E): ключ/iv/mime для расшифровки ciphertext'а в blob-URL */
  secret?: { keyB64: string; ivB64: string; mime: string }
}
interface Rect { top: number; left: number; width: number; height: number }
interface Transform { x: number; y: number; scale: number }
// Один «мовер» = одна карточка медиа в `.media-viewer-movers`. Последний в списке
// — текущий; предыдущие уезжают за экран и удаляются через MOVE_MS.
interface Mover {
  key: number
  idx: number
  /** 0 — полёт из миниатюры (открытие), 1 — въезд справа, −1 — въезд слева */
  from: 0 | 1 | -1
  /** снимок картинки уезжающего мовера + его бокс на момент ухода */
  snapshot?: string
  w?: number
  h?: number
}

const OPEN_MS = 200 // tweb OPEN_TRANSITION_TIME
const MOVE_MS = 350 // tweb MOVE_TRANSITION_TIME
// Вертикальные резервы вокруг медиа (tweb RESERVE_TOP/BOTTOM_DESKTOP) — из них
// считается и padding у `.media-viewer-content`, и центральный бокс.
const RESERVE_TOP = 80
const RESERVE_BOTTOM = 110
const ZOOM_MIN = 0.5 // tweb ZOOM_MIN_VALUE
const ZOOM_MAX = 4 // tweb ZOOM_MAX_VALUE
const ZOOM_STEP = 0.5 // tweb ZOOM_STEP
const ZOOM_INITIAL = 1 // tweb ZOOM_INITIAL_VALUE

const clampN = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

// tweb base.ts:1111 — зоны, клик по которым НЕ считается кликом по фону.
const CHROME = ['ckin__player', 'media-viewer-buttons', 'media-viewer-author', 'media-viewer-caption', 'zoom-container', 'media-viewer-topbar']

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

// tweb setFullAspect: та же высота, ширина по аспекту медиа — морф кропа.
function setFullAspect(a: HTMLElement, box: { width: number; height: number }, rect: { width: number; height: number }) {
  const proportion = box.width / box.height
  let { width, height } = rect
  if (proportion > 0) width = height * proportion
  else height = width * proportion
  a.style.cssText = `width: ${width}px; height: ${height}px; transform: scale3d(${box.width / width}, ${box.height / height}, 1);`
}

// tweb applyCenterStyles — покоящееся положение мовера (класс `.center`).
function applyCenterStyles(m: HTMLElement) {
  m.style.left = '50%'
  m.style.top = `calc(50% + ${(RESERVE_TOP - RESERVE_BOTTOM) / 2}px)`
  m.style.transform = 'translate3d(-50%, -50%, 0)'
  m.style.maxWidth = '100vw'
  m.style.maxHeight = `calc(100vh - ${RESERVE_TOP + RESERVE_BOTTOM}px)`
}
// tweb clearCenterStyles — снять всё, кроме transform/width/height.
function clearCenterStyles(m: HTMLElement) {
  m.style.left = ''
  m.style.top = ''
  m.style.maxWidth = ''
  m.style.maxHeight = ''
}

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
  const videoRate = useSettingsStore((st) => st.videoRate)
  const updateSettings = useSettingsStore((st) => st.update)

  const [movers, setMovers] = useState<Mover[]>([{ key: 0, idx: index, from: 0 }])
  // tweb toggleWholeActive: `.active` включает хром (overlays / topbar / caption),
  // `.backwards` ставится на закрытии.
  const [active, setActive] = useState(false)
  const [backwards, setBackwards] = useState(false)
  const [meta, setMeta] = useState<MediaMeta | null>(null)
  const [url, setUrl] = useState('')
  // Shown image: starts as the clicked thumbnail (already cached, so the morph
  // grows a VISIBLE picture) and swaps to full-res once decoded.
  const [imgSrc, setImgSrc] = useState(originSrc ?? '')
  // натуральные размеры direct-src картинки (аватарки) — меты у неё нет
  const [natSize, setNatSize] = useState<{ w: number; h: number } | null>(null)
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: ZOOM_INITIAL })
  const [rotation, setRotation] = useState(0)
  // tweb `.no-transition` на moversContainer во время жеста — трансформ идёт за
  // пальцем/колесом без сглаживания.
  const [gesturing, setGesturing] = useState(false)
  // Мовер в полёте: аспектер контр-масштабирован, поэтому контролы плеера заперты
  // спрятанными (tweb base.ts:2735 `videoPlayer.lockControls(false)`).
  const [flying, setFlying] = useState(true)
  // tweb: `has-video` + `has-video-controls` на wholeDiv — подпись и топбар гаснут
  // вместе с панелью плеера; `hide-caption` — пока открыто меню плеера.
  const [controlsShown, setControlsShown] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))

  const wholeRef = useRef<HTMLDivElement>(null)
  const moverRef = useRef<HTMLDivElement | null>(null)
  const aspecterRef = useRef<HTMLDivElement | null>(null)
  const videoElRef = useRef<HTMLVideoElement>(null)
  const closingRef = useRef(false)
  const navLockRef = useRef(false)
  const flownKeyRef = useRef(-1)
  const flightUntilRef = useRef(0)

  const cur = movers[movers.length - 1]
  const idx = cur.idx
  const item = items[idx]
  // Видео-аватар (tweb photo_video): direct-src элемент с videoUrl — poster = src.
  const isAvatarVideo = !!item?.videoUrl
  const isVideo = isAvatarVideo || item?.type === 'video' || !!meta?.mime.startsWith('video/')
  // Обычное видео чата (не видео-аватар) — с кастомными контролами и скоростью.
  const isChatVideo = isVideo && !isAvatarVideo
  const isZooming = transform.scale !== ZOOM_INITIAL

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Восстанавливаем сохранённую скорость на каждом новом видео (tweb
  // appMediaPlaybackController.playbackRate персистится между открытиями).
  useEffect(() => {
    if (isChatVideo && videoElRef.current) videoElRef.current.playbackRate = videoRate
  }, [isChatVideo, url, videoRate])

  useEffect(() => {
    let alive = true
    setMeta(null); setUrl(''); setNatSize(null)
    const flying = cur.from === 0
    // Секретное медиа (E2E): сервер отдаёт только ciphertext — качаем, расшифровываем
    // (общий кэш) и играем blob-URL. meta/contentUrl тут неприменимы (там шифртекст).
    if (item.secret && item.mediaId != null) {
      const sec = item.secret
      const isVid = item.type === 'video' || sec.mime.startsWith('video/')
      void getSecretMediaUrl(item.mediaId, sec.keyB64, sec.ivB64, sec.mime).then((u) => {
        if (!alive) return
        setUrl(u)
        if (isVid) return
        // натуральные размеры из декодированного blob — центральный бокс по кадру
        const pre = new Image()
        const delay = flying ? OPEN_MS + 40 : 0
        pre.onload = () => {
          if (!alive) return
          setNatSize({ w: pre.naturalWidth, h: pre.naturalHeight })
          window.setTimeout(() => { if (alive) setImgSrc(u) }, delay)
        }
        pre.src = u
      }).catch(() => {})
      return () => { alive = false }
    }
    if (item.mediaId == null) {
      const src = item.src
      if (!src) return
      const pre = new Image()
      pre.onload = () => {
        if (!alive) return
        setNatSize({ w: pre.naturalWidth, h: pre.naturalHeight })
        // Видео-аватар: still (src) — это poster/морф, а в <video> течёт videoUrl.
        if (item.videoUrl) {
          setUrl(item.videoUrl)
          setImgSrc(src)
          return
        }
        setUrl(src)
        const delay = flying ? OPEN_MS + 40 : 0
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
      if (m.hasThumb) void managers.media.thumbUrl(mediaId).then((u) => { if (alive) setImgSrc((prev) => prev || u) })
    })
    void (video ? managers.media.streamUrl(mediaId) : managers.media.contentUrl(mediaId)).then((u) => {
      if (!alive) return
      setUrl(u)
      if (video) return
      const pre = new Image()
      // Defer the full-res swap past the grow so its repaint can't drop frames
      // mid-animation; paged items (no flight) swap as soon as decoded.
      const delay = flying ? OPEN_MS + 40 : 0
      pre.onload = () => { if (alive) window.setTimeout(() => { if (alive) setImgSrc(u) }, delay) }
      pre.src = u
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.mediaId, item.src, item.videoUrl, item.type, managers])

  // ── геометрия центрального бокса (tweb mediaBoxSize + calcImageInBox) ──
  const boxW = viewport.w
  const boxH = viewport.h - RESERVE_TOP - RESERVE_BOTTOM
  const dims = item?.width && item?.height
    ? { w: item.width, h: item.height }
    : meta?.width
      ? { w: meta.width, h: meta.height }
      : natSize
        ? { w: natSize.w, h: natSize.h }
        : { w: originRect.width, h: originRect.height }
  const final = useMemo(() => calcImageInBox(dims.w, dims.h, boxW, boxH), [dims.w, dims.h, boxW, boxH])
  const finalLeft = (viewport.w - final.width) / 2
  const finalTop = (viewport.h - final.height) / 2 + (RESERVE_TOP - RESERVE_BOTTOM) / 2

  // ── зум/поворот: единый трансформ на `.media-viewer-movers` (tweb) ──
  // После поворота на 90°/270° бокс меняет стороны местами — доскейливаем, чтобы
  // повёрнутый кадр вписался в то же окно (tweb getRotationFitScale).
  const rotationFit = (rot: number) => {
    const n = ((rot % 360) + 360) % 360
    if (n !== 90 && n !== 270) return 1
    if (!final.width || !final.height) return 1
    return Math.min(boxW / final.height, boxH / final.width)
  }
  // Экранный bbox медиа ПОСЛЕ поворота (tweb getDisplayRect) — по нему считаются
  // границы пана.
  const displayRect = () => {
    const base = { left: finalLeft, top: finalTop, right: finalLeft + final.width, bottom: finalTop + final.height, width: final.width, height: final.height }
    if (!rotation) return base
    const n = ((rotation % 360) + 360) % 360
    const swap = n === 90 || n === 270
    const fit = rotationFit(rotation)
    const cx = base.left + base.width / 2
    const cy = base.top + base.height / 2
    const width = (swap ? base.height : base.width) * fit
    const height = (swap ? base.width : base.height) * fit
    return { left: cx - width / 2, right: cx + width / 2, top: cy - height / 2, bottom: cy + height / 2, width, height }
  }
  // tweb calculateOffsetBoundaries + getZoomBoundaries
  const clampTransform = ({ x, y, scale }: Transform): Transform => {
    const r = displayRect()
    const centerX = (viewport.w - viewport.w * scale) / 2
    const centerY = (viewport.h - viewport.h * scale) / 2
    const minX = Math.max(-r.left * scale, centerX)
    const maxX = viewport.w - r.right * scale
    const minY = Math.max(-r.top * scale, centerY)
    const maxY = viewport.h - r.bottom * scale
    return { x: clampN(x, maxX, minX), y: clampN(y, maxY, minY), scale }
  }
  // tweb onZoom: масштаб с удержанием точки-центра на месте.
  const zoomAround = (base: Transform, zoomAdd: number, centerX?: number, centerY?: number): Transform => {
    const cx = centerX || viewport.w / 2
    const cy = centerY || viewport.h / 2
    const scale = clampN(base.scale + zoomAdd, ZOOM_MIN, ZOOM_MAX)
    const scaleFactor = scale / base.scale
    const scaledCenterX = Math.abs(Math.min(base.x, 0)) + cx
    const scaledCenterY = Math.abs(Math.min(base.y, 0)) + cy
    return clampTransform({
      x: base.x + (scaledCenterX - scaleFactor * scaledCenterX),
      y: base.y + (scaledCenterY - scaleFactor * scaledCenterY),
      scale,
    })
  }
  const addZoomStep = (add: boolean) => setTransform((t) => zoomAround(t, ZOOM_STEP * (add ? 1 : -1)))
  const resetZoom = () => setTransform({ x: 0, y: 0, scale: ZOOM_INITIAL })

  // tweb buildMoversTransform: zoom/pan — снаружи (screen space), rotate + refit —
  // внутри, вокруг центра кадра; identity-звено пишется всегда, чтобы первый
  // поворот интерполировался пофункционально, а не матрицей.
  const moversTransform = (() => {
    const cx = finalLeft + final.width / 2
    const cy = finalTop + final.height / 2
    const fit = rotationFit(rotation)
    return `translate3d(${transform.x.toFixed(3)}px, ${transform.y.toFixed(3)}px, 0px) scale(${transform.scale.toFixed(3)}) ` +
      `translate(${cx.toFixed(3)}px, ${cy.toFixed(3)}px) rotate(${rotation}deg) scale(${fit.toFixed(5)}) translate(${(-cx).toFixed(3)}px, ${(-cy).toFixed(3)}px)`
  })()

  // ── полёт мовера ──
  // Покоящееся состояние: `.center.active` + инлайновые left/top/transform (tweb).
  const snapCenter = (m: HTMLDivElement, a: HTMLDivElement) => {
    m.classList.remove('moving', 'opening', 'active')
    a.style.cssText = ''
    void m.offsetLeft // reflow
    m.classList.add('center')
    m.style.transition = 'none'
    applyCenterStyles(m)
    m.style.borderRadius = ''
    void m.offsetLeft // reflow — центр встаёт без анимации
    m.style.transition = ''
    m.classList.add('active')
    setFlying(false) // мовер приземлился — контролы плеера можно отпирать
  }

  useLayoutEffect(() => {
    const m = moverRef.current, a = aspecterRef.current
    if (!m || !a) return
    if (flownKeyRef.current === cur.key) {
      // Пересчёт бокса (ресайз / доехали натуральные размеры) — без анимации,
      // но не посреди уже идущего полёта.
      if (Date.now() < flightUntilRef.current) return
      snapCenter(m, a)
      return
    }
    flownKeyRef.current = cur.key

    setFlying(true)

    if (cur.from === 0) {
      // ── открытие: из rect миниатюры в центр (tweb setMoverToTarget) ──
      flightUntilRef.current = Date.now() + OPEN_MS
      const or = originRect
      const radii = cornerRadii(originEl)
      const sx = or.width / final.width
      const sy = or.height / final.height
      m.classList.remove('center', 'moving')
      clearCenterStyles(m)
      m.style.transition = 'none'
      m.style.transform = `translate3d(${or.left}px,${or.top}px,0) scale3d(${sx},${sy},1)`
      m.style.borderRadius = ellipticalRadius(radii, sx, sy)
      a.style.cssText = `width: ${or.width}px; height: ${or.height}px; transform: scale3d(${final.width / or.width}, ${final.height / or.height}, 1);`
      void m.offsetLeft // reflow — зафиксировать стартовое состояние без перехода
      m.style.transition = ''
      m.classList.add('active', 'opening')
      void doubleRaf().then(() => {
        if (closingRef.current) return
        m.style.transform = `translate3d(${finalLeft}px,${finalTop}px,0) scale3d(1,1,1)`
        m.style.borderRadius = ''
        setFullAspect(a, final, or)
        window.setTimeout(() => { if (!closingRef.current) snapCenter(m, a) }, OPEN_MS)
      })
      return
    }

    // ── листание: новый мовер въезжает с края экрана (tweb setMoverToTarget,
    //    ветка wasActive) ──
    flightUntilRef.current = Date.now() + MOVE_MS
    const startX = cur.from === 1 ? viewport.w : -final.width
    m.classList.remove('center', 'active', 'opening')
    clearCenterStyles(m)
    a.style.cssText = ''
    m.style.transition = 'none'
    m.style.borderRadius = ''
    m.style.transform = `translate3d(${startX}px,${finalTop}px,0)`
    void m.offsetLeft // reflow
    m.style.transition = ''
    m.classList.add('moving')
    void doubleRaf().then(() => {
      if (closingRef.current) return
      m.style.transform = `translate3d(${finalLeft}px,${finalTop}px,0)`
      window.setTimeout(() => { if (!closingRef.current) snapCenter(m, a) }, MOVE_MS)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.key, final.width, final.height, finalLeft, finalTop])

  // Хром включается кадром позже монтирования — иначе CSS-переход
  // `.media-viewer-appear` / `.overlays` не с чего запускать (tweb toggleWholeActive).
  useEffect(() => { setActive(true) }, [])

  // ── листание (tweb moveTheMover) ──
  const hasPrev = idx > 0
  const hasNext = idx < items.length - 1
  const nav = (dir: 1 | -1) => {
    if (closingRef.current || navLockRef.current) return
    const next = idx + dir
    if (next < 0 || next >= items.length) return // кольцевого листания в tweb нет
    navLockRef.current = true
    window.setTimeout(() => { navLockRef.current = false }, MOVE_MS)

    const old = moverRef.current
    const oldKey = cur.key
    if (old) {
      // tweb removeCenterFromMover + `.moving`: уезжает за противоположный край.
      const r = old.getBoundingClientRect()
      old.style.transition = 'none'
      old.style.transform = `translate3d(${r.left}px,${r.top}px,0)`
      old.classList.remove('center', 'active')
      clearCenterStyles(old)
      void old.offsetLeft // reflow
      old.style.transition = ''
      old.classList.add('moving')
      old.style.transform = `translate3d(${dir === 1 ? -r.width : viewport.w}px,${r.top}px,0)`
      window.setTimeout(() => setMovers((ms) => ms.filter((mv) => mv.key !== oldKey)), MOVE_MS)
    }

    resetZoom()
    setRotation(0)
    setImgSrc('')
    setMovers((ms) => [
      ...ms.map((mv) => (mv.key === oldKey ? { ...mv, snapshot: imgSrc, w: final.width, h: final.height } : mv)),
      { key: oldKey + 1, idx: next, from: dir },
    ])
  }

  // ── закрытие (tweb setMoverToTarget(closing = true)) ──
  const close = () => {
    if (closingRef.current) return
    closingRef.current = true
    resetZoom()
    setRotation(0)
    onClosingStart?.() // reveal the source thumbnail now (no empty-bubble gap)
    setBackwards(true)
    setActive(false) // хром гаснет CSS-переходом из партиала

    const m = moverRef.current, a = aspecterRef.current
    // Летим в миниатюру ТЕКУЩЕГО элемента (tweb перевешивает target при листании:
    // для первого — исходный originEl, для пролистанных — ищем его <img> в DOM),
    // и только если она всё ещё во вьюпорте — иначе tweb-поведение: только fade.
    let target: Rect | null = null
    let targetEl: HTMLElement | undefined
    const el = cur.from === 0
      ? originEl
      : item.mediaId != null
        ? (document.querySelector(`img[src*="/media/${item.mediaId}/"]`) as HTMLElement | null) ?? undefined
        : undefined
    if (el?.isConnected) {
      const r = el.getBoundingClientRect()
      const visible = r.width > 0 && r.bottom > 0 && r.top < viewport.h && r.right > 0 && r.left < viewport.w
      if (visible) {
        target = { top: r.top, left: r.left, width: r.width, height: r.height }
        targetEl = el
      }
    }

    if (!m || !a) {
      window.setTimeout(onClose, OPEN_MS)
      return
    }
    // tweb removeCenterFromMover: `.center` → явный transform без анимации.
    m.style.transition = 'none'
    m.style.transform = `translate3d(${finalLeft}px,${finalTop}px,0)`
    m.classList.remove('center')
    clearCenterStyles(m)
    void m.offsetLeft // reflow
    m.style.transition = ''
    void doubleRaf().then(() => {
      if (target) {
        const radii = cornerRadii(targetEl)
        const sx = target.width / final.width
        const sy = target.height / final.height
        m.style.transform = `translate3d(${target.left}px,${target.top}px,0) scale3d(${sx},${sy},1)`
        a.style.cssText = `width: ${target.width}px; height: ${target.height}px; transform: scale3d(${final.width / target.width}, ${final.height / target.height}, 1);`
        // tweb ставит радиус на полпути анимации
        window.setTimeout(() => { m.style.borderRadius = ellipticalRadius(radii, sx, sy) }, OPEN_MS / 2)
      } else {
        m.style.opacity = '0'
      }
      window.setTimeout(onClose, OPEN_MS) // tweb резолвит ровно по delay
    })
  }

  // Back (браузер/аппаратный) закрывает лайтбокс с анимацией, как Esc.
  useNavLayer(true, close)

  useEffect(() => {
    // Esc — через глобальный Esc-стек (core/hotkeys): лайтбокс закрывается
    // верхним в LIFO-порядке, фолбэк «закрыть чат» не срабатывает.
    const unregisterEsc = pushEsc(close)
    const onKey = (e: KeyboardEvent) => {
      // не перехватываем клавиши, когда фокус в поле ввода (напр. слайдер громкости).
      // Escape НЕ здесь — им заведует глобальный Esc-стек (pushEsc выше).
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const v = videoElRef.current
      if (e.key === ' ' && isChatVideo && v) {
        // Space — play/pause видео (tweb KeyCode.Space togglePlay)
        e.preventDefault()
        if (v.paused) void v.play().catch(() => {})
        else v.pause()
      } else if (e.key === 'ArrowRight') {
        // на видео стрелки перематывают ±5с (tweb seek), иначе листают медиа
        if (isChatVideo && v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 5)
        else if (!isZooming) nav(1)
      } else if (e.key === 'ArrowLeft') {
        if (isChatVideo && v) v.currentTime = Math.max(0, v.currentTime - 5)
        else if (!isZooming) nav(-1)
      } else if (e.key === '+' || e.key === '=') addZoomStep(true)
      else if (e.key === '-') addZoomStep(false)
      else if (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 'к') setRotation((r) => r - 90)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      unregisterEsc()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items.length, isChatVideo, isZooming])

  // Колесо: с Ctrl/Meta/Shift — зум вокруг курсора, без модификатора — пан
  // (tweb swipeHandler.handleWheel). Слушатель ручной: React вешает `wheel`
  // пассивно, а нам нужен preventDefault.
  useEffect(() => {
    const el = wholeRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.zoom-container') || t.closest('.media-viewer-caption')) return
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault()
        const delta = clampN(e.deltaY, -25, 25)
        setTransform((tr) => zoomAround(tr, -delta * 0.01, e.clientX, e.clientY))
      } else if (isZooming) {
        e.preventDefault()
        setTransform((tr) => clampTransform({ x: tr.x - e.deltaX, y: tr.y - e.deltaY, scale: tr.scale }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isZooming, final.width, final.height, finalLeft, finalTop, rotation, viewport.w, viewport.h])

  // Пан мышью при зуме (tweb SwipeHandler → adjustPosition).
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isZooming || e.button !== 0) return
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    setGesturing(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.x = e.clientX; d.y = e.clientY
    setTransform((tr) => clampTransform({ x: tr.x + dx, y: tr.y + dy, scale: tr.scale }))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.id !== e.pointerId) return
    dragRef.current = null
    setGesturing(false)
  }

  // tweb onClick на wholeDiv: клик мимо хрома (или прямо по картинке) закрывает.
  const onWholeClick = (e: React.MouseEvent) => {
    if (closingRef.current || navLockRef.current) return
    const t = e.target as HTMLElement
    if (t.tagName === 'A') return
    // отступление от tweb: `.btn-menu` — меню плеера уходит в портал на body, но в
    // React-дереве остаётся потомком вьюера, так что клик по нему всплывает сюда.
    const hitChrome = CHROME.some((c) => t.closest(`.${c}`)) || t.closest('.btn-menu') !== null
    if (!hitChrome || t.tagName === 'IMG') close()
  }

  const download = async () => {
    const a = document.createElement('a')
    if (item.secret) {
      // секретное медиа: meta вернула бы шифртекст — имя по типу
      a.download = `media-${item.mediaId}${item.type === 'video' ? '.mp4' : '.jpg'}`
    } else if (item.mediaId != null) {
      const m = await managers.media.meta(item.mediaId)
      a.download = m.fileName || `media-${item.mediaId}`
    } else {
      a.download = 'photo.jpg'
    }
    a.href = url
    document.body.appendChild(a); a.click(); a.remove()
  }

  const multi = items.length > 1
  const caption = item?.caption

  // `<video class="ckin__video">` — tweb VideoPlayer вешает этот класс на видео,
  // которое ему передали (mediaPlayer/index.ts:147). Узел один и тот же и для
  // видео чата (внутри плеера), и для видео-аватарки (голым в аспектере).
  const videoNode = (
    <video
      ref={videoElRef}
      className="ckin__video"
      src={url}
      poster={isAvatarVideo ? imgSrc || item.src : undefined}
      autoPlay
      muted={isAvatarVideo}
      loop={isAvatarVideo}
      playsInline
      onLoadedMetadata={isChatVideo ? (e) => { e.currentTarget.playbackRate = videoRate } : undefined}
      onClick={isChatVideo && !isZooming ? (e) => {
        // tweb mediaPlayer: клик по видео (не на тач) переключает play/pause
        const v = e.currentTarget
        if (v.paused) void v.play().catch(() => {})
        else v.pause()
      } : undefined}
    />
  )

  // Портал в body: Chat живёт под предком с transform, а он создаёт containing
  // block для position:fixed — без портала вьюер привязывался бы к колонке чата.
  return createPortal(
    <div
      ref={wholeRef}
      className={classNames(
        'media-viewer-whole', s.whole,
        active ? 'active' : '',
        backwards ? 'backwards' : '',
        isZooming ? 'is-zooming' : '',
        // tweb base.ts:2715 — хром вьюера живёт по состоянию плеера
        isChatVideo ? 'has-video' : '',
        isChatVideo && controlsShown ? 'has-video-controls' : '',
        menuOpen ? 'hide-caption' : '',
      )}
      onClick={onWholeClick}
    >
      {/* зум-панель (tweb zoomElements.container, base.ts:366-397): обе кнопки —
          ButtonIcon({noRipple: true}), полоса — RangeSelector({withTransition: true}),
          то есть заполнение ШИРИНОЙ с переходом .2s (_ckin.scss:393-399). Ширину и
          вертикальные отступы полосы задаёт `.zoom-container` (flex: 1 1 auto),
          поэтому дефолтную раскладку Slider'а здесь гасим. */}
      <div className={classNames('zoom-container', isZooming ? 'is-visible' : '')}>
        <IconButton
          noRipple
          className={transform.scale <= ZOOM_MIN ? 'inactive' : ''}
          title="Уменьшить (−)"
          onClick={() => addZoomStep(false)}
        ><span className="tgico button-icon">{glyph('zoomout')}</span></IconButton>
        <Slider
          withTransition
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.01}
          value={transform.scale}
          onChange={(v) => setTransform((t) => zoomAround(t, v - t.scale))}
          style={{ width: 'auto', marginBlock: 0 }}
          ariaLabel="Масштаб"
        />
        <IconButton
          noRipple
          className={transform.scale >= ZOOM_MAX ? 'inactive' : ''}
          title="Увеличить (+)"
          onClick={() => addZoomStep(true)}
        ><span className="tgico button-icon">{glyph('zoomin')}</span></IconButton>
      </div>

      {/* затемнение + центральный «слот» медиа: `.media-viewer-media` — невидимый
          якорь, по которому tweb считает целевой прямоугольник полёта */}
      <div className="overlays">
        <div className="media-viewer">
          <div className="media-viewer-content" style={{ paddingTop: RESERVE_TOP, paddingBottom: RESERVE_BOTTOM }}>
            <div className="media-viewer-container">
              <div className="media-viewer-media" style={{ width: final.width, height: final.height }} />
            </div>
          </div>
        </div>
      </div>

      <div className="media-viewer-topbar media-viewer-appear">
        <div className="media-viewer-topbar-left">
          {/* мобильная «назад» — единственная кнопка вьюера С ripple (в дампе
              §9 она `button.btn-icon.only-handhelds.rp` с `div.c-ripple`) */}
          <IconButton className="only-handhelds" title="Закрыть (Esc)" onClick={close}>
            <TgIcon name="close" className="button-icon" />
          </IconButton>
          <div className="media-viewer-author no-select">
            {item?.sender && (
              <Avatar className="media-viewer-userpic" size={44} background={peerColor(item.sender)} text={item.sender.charAt(0)} />
            )}
            <div className="media-viewer-author-right">
              {/* tweb: `.media-viewer-name > span.peer-title[data-peer-id]` (avatar.ts:170).
                  отступление от tweb: data-peer-id нет — вьюеру передаётся имя
                  отправителя строкой, id пира сюда не доезжает. */}
              <div className="media-viewer-name"><span className="peer-title">{item?.sender}</span></div>
              {/* отступление от tweb: там дата собрана из `span.i18n` штатным
                  форматтером лангпака; у нас готовая строка из модели сообщения. */}
              <div className="media-viewer-date">
                {multi && `${idx + 1} из ${items.length}`}
                {item?.date && <span className={multi ? 'media-viewer-date-dot' : ''}>{item.date}</span>}
              </div>
            </div>
          </div>
        </div>
        {/* tweb base.ts:356-362 — кнопки топбара создаются как
            ButtonIcon(icon, {noRipple: true}): без `.rp` и без `div.c-ripple`.
            Ripple в tweb остаётся только у `only-handhelds`-кнопок (см. выше). */}
        <div className="media-viewer-buttons">
          {/* Порядок кнопок tweb (base.ts:356): topButtons + download, rotate,
              zoomin, close. topButtons вьюера сообщений — `['delete', 'forward']`
              (mediaViewer/index.ts:102); у нас этих двух нет — действия над
              сообщением во вьюер не проброшены. Остальные четыре и их порядок 1:1.
              PiP у видео чата стоит в своём слоте tweb — `.right-controls` плеера;
              здесь остаётся только для видео-аватарки, у которой плеера нет. */}
          {isAvatarVideo && pipSupported() && (
            <IconButton noRipple title="Картинка в картинке" onClick={() => { if (videoElRef.current) void enterPip(videoElRef.current) }}>
              <span className="tgico button-icon">{glyph('pip')}</span>
            </IconButton>
          )}
          <IconButton noRipple title="Скачать" onClick={download}>
            <span className="tgico button-icon">{glyph('download')}</span>
          </IconButton>
          <IconButton noRipple title="Повернуть (R)" onClick={() => setRotation((r) => r - 90)}>
            <span className="tgico button-icon">{glyph('rotate_left')}</span>
          </IconButton>
          <IconButton noRipple title="Увеличить (+)" onClick={() => { if (isZooming) resetZoom(); else addZoomStep(true) }}>
            <span className="tgico button-icon">{glyph(isZooming ? 'zoomout' : 'zoomin')}</span>
          </IconButton>
          <IconButton noRipple title="Закрыть (Esc)" onClick={close}>
            <span className="tgico button-icon">{glyph('close')}</span>
          </IconButton>
        </div>
      </div>

      <div
        className={classNames('media-viewer-movers', gesturing ? 'no-transition' : '')}
        style={{ transform: moversTransform }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={classNames('media-viewer-switcher', 'media-viewer-switcher-left', hasPrev ? '' : 'hide')}
          onClick={(e) => { e.stopPropagation(); nav(-1) }}
        >
          <span className="tgico media-viewer-sibling-button media-viewer-prev-button">{glyph('previous')}</span>
        </div>
        <div
          className={classNames('media-viewer-switcher', 'media-viewer-switcher-right', hasNext ? '' : 'hide')}
          onClick={(e) => { e.stopPropagation(); nav(1) }}
        >
          <span className="tgico media-viewer-sibling-button media-viewer-next-button">{glyph('next')}</span>
        </div>

        {movers.map((mv) => {
          const isCurrent = mv.key === cur.key
          return (
            <div className="media-viewer-mover-wrapper" key={mv.key}>
              <div
                ref={isCurrent ? moverRef : undefined}
                className="media-viewer-mover"
                style={{ width: mv.w ?? final.width, height: mv.h ?? final.height }}
                onDoubleClick={isCurrent && !isChatVideo ? (e) => {
                  if (isZooming) resetZoom()
                  else setTransform((t) => zoomAround({ ...t, x: 0, y: 0 }, ZOOM_INITIAL + 2 - t.scale, e.clientX, e.clientY))
                } : undefined}
              >
                <div ref={isCurrent ? aspecterRef : undefined} className="media-viewer-aspecter">
                  {!isCurrent
                    ? (mv.snapshot ? <img className="thumbnail" src={mv.snapshot} alt="" draggable={false} /> : null)
                    : isVideo && url ? (
                      // tweb (base.ts:2580 + mediaPlayer): видео чата живёт ВНУТРИ
                      // `.ckin__player`, который лежит в аспектере; видео-аватарка
                      // (photo_video) плеера не получает — muted-loop autoplay,
                      // still-кадр как poster. Клик по видео играет/паузит.
                      isChatVideo ? (
                        <VideoPlayer
                          videoRef={videoElRef}
                          rate={videoRate}
                          onRateChange={(r) => updateSettings({ videoRate: r })}
                          locked={flying || isZooming || rotation !== 0}
                          onToggleControls={setControlsShown}
                          onMenuToggle={setMenuOpen}
                        >
                          {videoNode}
                        </VideoPlayer>
                      ) : videoNode
                    ) : imgSrc ? (
                      <img className="thumbnail" src={imgSrc} alt="" draggable={false} />
                    ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className={classNames('media-viewer-caption', 'spoilers-container', caption ? '' : 'hide')}>
        <div className="scrollable scrollable-y">
          {caption ? <RichText text={caption} entities={item.captionEntities} linkColor="var(--link-color)" /> : null}
        </div>
      </div>
    </div>,
    portalContainer,
  )
}
