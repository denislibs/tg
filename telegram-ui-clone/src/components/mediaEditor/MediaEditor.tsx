// Медиа-редактор перед отправкой — упрощённый порт tweb mediaEditor на
// canvas 2D/WebGL: слева рабочая область с превью, справа панель с вкладками
// Enhance / Crop / Draw / Text, undo-стек, FAB «Готово».
// Единое координатное пространство сцены — центрированный СЫРОЙ исходник W×H:
// поворот/флип/масштаб покрытия применяются ко всей сцене (base + штрихи +
// текст) одним трансформом, поэтому слои всегда согласованы; crop вырезает
// осевую рамку. Экспорт — в полном разрешении тем же composeScene.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import IconButton from '../../shared/ui/IconButton'
import Slider from '../../shared/ui/Slider'
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import TgIcon, { type IconName } from '../TgIcon'
import ConfirmDialog from '../settings/ConfirmDialog'
import { usePortalContainer } from '../../core/pip'
import { useT } from '../../i18n'
import { EASE } from '../../motion'
import {
  ADJUSTMENTS, ASPECT_PRESETS, CROP_HANDLES, ENHANCE_DEFAULTS,
  aspectOf, centeredAspectCrop, contrastColor, coverScale, enhanceRange, fitScale,
  isDefaultEnhance, moveCrop, pushHistory, resizeCrop,
  type AspectPreset, type CropHandle, type EnhanceValues, type Point, type Rect,
} from './editorMath'
import {
  composeScene, fontInfoMap, measureTextBlock, rebuildDrawLayer, srcSize, stickerBaseSize,
  type BrushType, type FontKey, type Scene, type SrcImage, type StickerLayer, type Stroke,
  type TextAlign, type TextBlock, type TextStyle,
} from './sceneRender'
import { hitSticker, resizeSticker, stickerCorners, type Corner } from './stickerLayer'
import { StickerAssets } from './stickerAssets'
import StickerPicker from './StickerPicker'
import { EnhanceRenderer } from './enhanceGL'
import { applyRedo, applyUndo, type HistoryItem, type RedoItem } from './editorHistory'
import type { Sticker } from '../../core/managers/stickersManager'
import s from './MediaEditor.module.scss'

// Палитра tweb mediaEditor (colorPickerSwatches).
const SWATCHES = ['#ffffff', '#fe4438', '#ff8901', '#ffd60a', '#33c759', '#62e5e0', '#0a84ff', '#bd5cf3']

// Шрифты вкладки text: порядок и подписи 1:1 с tweb textTab.
const FONTS: { key: FontKey; label: string }[] = [
  { key: 'roboto', label: 'Roboto' },
  { key: 'suez', label: 'Suez One' },
  { key: 'fugaz', label: 'Fugaz One' },
  { key: 'courier', label: 'Courier Prime' },
  { key: 'chewy', label: 'Chewy' },
  { key: 'sedan', label: 'Sedan' },
  { key: 'bubbles', label: 'Rubik Bubbles' },
  { key: 'playwrite', label: 'Playwrite' },
]
const ALIGNS: { key: TextAlign; icon: IconName }[] = [
  { key: 'left', icon: 'align_left' },
  { key: 'center', icon: 'align_center' },
  { key: 'right', icon: 'align_right' },
]

// Кисти вкладки draw (порядок и дефолтные цвета — из tweb brushTab).
type ColoredBrush = 'pen' | 'arrow' | 'marker' | 'neon'
const BRUSH_COLORS: Record<ColoredBrush, string> = {
  pen: '#fe4438', arrow: '#ffd60a', marker: '#ff8901', neon: '#62e5e0',
}
const BRUSHES: { key: BrushType; label: string; icon: IconName }[] = [
  { key: 'pen', label: 'Pen', icon: 'edit' },
  { key: 'arrow', label: 'Arrow', icon: 'arrowhead' },
  { key: 'marker', label: 'Brush', icon: 'brush' },
  { key: 'neon', label: 'Neon', icon: 'highlights' },
  { key: 'blur', label: 'Blur', icon: 'sharpen' },
  { key: 'eraser', label: 'Eraser', icon: 'delete' },
]
const hasBrushColor = (b: BrushType): b is ColoredBrush => b in BRUSH_COLORS
// Радиус размытия base для blur-кисти — в пикселях исходника, зависит от размера
// картинки (tweb использует фикс. 10px на канвасе редактора; у нас слой рисования
// в нативном разрешении, поэтому масштабируем от стороны, чтобы блюр был заметен).
const blurRadiusFor = (w: number, h: number): number => Math.max(6, Math.round(Math.max(w, h) / 150))

type Tab = 'enhance' | 'crop' | 'draw' | 'text' | 'stickers'

const TABS: { key: Tab; icon: IconName }[] = [
  { key: 'enhance', icon: 'enhance' },
  { key: 'crop', icon: 'crop' },
  { key: 'draw', icon: 'brush' },
  { key: 'text', icon: 'text' },
  { key: 'stickers', icon: 'smile' }, // tweb mediaEditor: вкладка stickers = иконка smile
]

// Радиус захвата угловой ручки стикера (экранные px).
const STICKER_HANDLE_HIT = 16

const ASPECT_LABELS: Record<AspectPreset, string> = {
  free: 'Free', original: 'Original', '1:1': 'Square',
  '3:2': '3:2', '2:3': '2:3', '4:3': '4:3', '3:4': '3:4', '5:4': '5:4', '4:5': '4:5',
  '7:5': '7:5', '5:7': '5:7', '16:9': '16:9', '9:16': '9:16',
}

// Колесо углов (tweb rotationWheel): 42px на 15°, метки каждые 15° в ±90°.
const DEGREE_DIST_PX = 42
const DEGREE_STEP = 15
const WHEEL_LABELS = Array.from({ length: 13 }, (_, i) => i * DEGREE_STEP - 90)
const SNAP_RAD = (2.5 * Math.PI) / 180 // «липкий» захват к прямому углу
const WHEEL_H = 56 // высота панели колеса под изображением
const QUARTER = Math.PI / 2

// Undo/redo — чистые редьюсеры в editorHistory (в стеке только штрихи и
// добавление/удаление текста; Enhance/Crop параметрические — сброс кнопкой).

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Простой rAF-аниматор прогресса 0..1; возвращает отмену (порт animateValue).
function animate(ms: number, onProgress: (t: number) => void, onEnd?: () => void): () => void {
  let raf = 0
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    onProgress(t)
    if (t < 1) raf = requestAnimationFrame(step)
    else onEnd?.()
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}

// Метаданные открытого input-оверлея текста (сам текст живёт в input).
interface EditingText {
  id: number
  x: number
  y: number
  isNew: boolean
  sizeSrc: number
  color: string
  style: TextStyle
  font: FontKey
  align: TextAlign
}

async function loadImage(file: File): Promise<SrcImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch { /* формат без поддержки в createImageBitmap — fallback на <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('image decode failed'))
      im.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function MediaEditor({ file, onDone, onCancel }: {
  file: File
  onDone: (blob: Blob) => void
  onCancel: () => void
}) {
  const t = useT()
  const container = usePortalContainer()

  const [img, setImg] = useState<SrcImage | null>(null)
  // Ориентация сцены: свободный угол (рад) + зеркала по осям.
  const [rotation, setRotation] = useState(0)
  const [flipX, setFlipX] = useState<1 | -1>(1)
  const [flipY, setFlipY] = useState<1 | -1>(1)
  const [tab, setTab] = useState<Tab>('enhance')
  const [enhance, setEnhance] = useState<EnhanceValues>(ENHANCE_DEFAULTS)
  const [crop, setCrop] = useState<Rect | null>(null)
  const [aspect, setAspect] = useState<AspectPreset>('free')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [texts, setTexts] = useState<TextBlock[]>([])
  const [stickers, setStickers] = useState<StickerLayer[]>([])
  const [selectedSticker, setSelectedSticker] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [redoStack, setRedoStack] = useState<RedoItem[]>([])
  const [brush, setBrush] = useState<BrushType>('pen')
  const [brushColors, setBrushColors] = useState<Record<ColoredBrush, string>>(BRUSH_COLORS)
  const [brushSize, setBrushSize] = useState(18)
  const [previewSize, setPreviewSize] = useState<number | null>(null)
  const [textColor, setTextColor] = useState(SWATCHES[0])
  const [textSize, setTextSize] = useState(40)
  const [textStyle, setTextStyle] = useState<TextStyle>('outline')
  const [textFontKey, setTextFontKey] = useState<FontKey>('roboto')
  const [textAlign, setTextAlign] = useState<TextAlign>('left')
  const [editingText, setEditingText] = useState<EditingText | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [vp, setVp] = useState({ w: 0, h: 0 })

  const workRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const drawLayerRef = useRef<HTMLCanvasElement | null>(null)
  // Заранее размытая копия базы (W×H) для blur-кисти; пересчёт при смене
  // исходника/коррекций. previewTimerRef — таймер скрытия превью размера кисти.
  const blurredRef = useRef<HTMLCanvasElement | null>(null)
  const previewTimerRef = useRef<number | null>(null)
  // WebGL-рендер коррекций: контекст/программа/буферы создаются один раз;
  // adjustedRef — canvas с наложенными коррекциями (null → fallback на CSS).
  const rendererRef = useRef<EnhanceRenderer | null>(null)
  const rendererReadyRef = useRef(false)
  const adjustedRef = useRef<HTMLCanvasElement | null>(null)
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const renderRef = useRef<() => void>(() => {})
  // editingText зеркалится в ref: blur и pointerdown приходят в один тик, и
  // только синхронный ref спасает от двойного коммита блока
  const editingRef = useRef<EditingText | null>(null)
  const nextIdRef = useRef(1)
  const strokeRef = useRef<Stroke | null>(null)
  const textDragRef = useRef<{ id: number; last: Point; moved: boolean } | null>(null)
  // Слои стикеров: кадры (lottie/img) грузит StickerAssets; перерисовку lottie
  // коалесцируем через rAF (renderScheduledRef).
  const stickerAssetsRef = useRef<StickerAssets | null>(null)
  const renderScheduledRef = useRef(false)
  const stickerDragRef = useRef<{ id: number; last: Point; moved: boolean } | null>(null)
  const stickerResizeRef = useRef<{ id: number; corner: Corner } | null>(null)
  const cropDragRef = useRef<{ mode: 'move' | CropHandle; start: Rect; px: number; py: number } | null>(null)
  const wheelDragRef = useRef<{ startX: number; startRot: number } | null>(null)
  const rotAnimRef = useRef<(() => void) | null>(null)
  const cropAnimRef = useRef<(() => void) | null>(null)

  // ── Загрузка исходника ──
  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        const bmp = await loadImage(file)
        if (dead) {
          if (typeof ImageBitmap !== 'undefined' && bmp instanceof ImageBitmap) bmp.close()
          return
        }
        const { w, h } = srcSize(bmp)
        setImg(bmp)
        setCrop({ x: 0, y: 0, w, h })
      } catch {
        onCancel() // не смогли декодировать — редактировать нечего
      }
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  useEffect(() => () => {
    if (img && typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) img.close()
  }, [img])

  // ── WebGL-рендер коррекций ──
  // Контекст/программа/буферы — один раз на монтирование; при недоступности
  // WebGL rendererRef остаётся null и весь путь коррекций уходит в CSS-fallback.
  useEffect(() => {
    try {
      rendererRef.current = new EnhanceRenderer()
    } catch {
      rendererRef.current = null
    }
    return () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
      adjustedRef.current = null
    }
  }, [])

  // ── Кадры стикеров ── создаём один раз; onFrame (кадр lottie) → перерисовка
  // превью, коалесцированная через rAF (renderRef.current — всегда свежий).
  useEffect(() => {
    const assets = new StickerAssets(() => {
      if (renderScheduledRef.current) return
      renderScheduledRef.current = true
      requestAnimationFrame(() => {
        renderScheduledRef.current = false
        renderRef.current()
      })
    })
    stickerAssetsRef.current = assets
    return () => {
      assets.destroy()
      stickerAssetsRef.current = null
    }
  }, [])

  // Грузим кадры для всех слоёв (добавление + восстановление undo/redo); ensure идемпотентен.
  useEffect(() => {
    const a = stickerAssetsRef.current
    if (!a) return
    for (const st of stickers) a.ensure(st.mediaId)
  }, [stickers])

  // Загрузка текстуры при смене исходника.
  useEffect(() => {
    rendererReadyRef.current = false
    const r = rendererRef.current
    if (!img || !r || !r.available) return
    try {
      r.setImage(img)
      rendererReadyRef.current = true
    } catch {
      rendererReadyRef.current = false
    }
  }, [img])

  // Пересчёт adjusted-canvas при смене исходника/коррекций (не на каждом кадре).
  useEffect(() => {
    const r = rendererRef.current
    if (img && r && rendererReadyRef.current && r.available) {
      try {
        adjustedRef.current = r.render(enhance)
      } catch {
        adjustedRef.current = null
      }
    } else {
      adjustedRef.current = null
    }
    renderRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, enhance])

  // Размытая копия базы для blur-кисти (совмещена со слоем рисования W×H).
  // Считаем после adjusted; при смене коррекций перерисовываем слой, если в нём
  // есть blur-штрихи (их пиксели берутся из этой копии).
  useEffect(() => {
    if (!img) { blurredRef.current = null; return }
    const { w, h } = srcSize(img)
    let c = blurredRef.current
    if (!c || c.width !== Math.round(w) || c.height !== Math.round(h)) {
      c = document.createElement('canvas')
      c.width = Math.round(w)
      c.height = Math.round(h)
      blurredRef.current = c
    }
    const bctx = c.getContext('2d')
    if (!bctx) return
    bctx.clearRect(0, 0, c.width, c.height)
    bctx.filter = `blur(${blurRadiusFor(w, h)}px)`
    bctx.drawImage(adjustedRef.current ?? img, 0, 0, c.width, c.height)
    bctx.filter = 'none'
    const layer = drawLayerRef.current
    if (layer && strokes.some((st) => st.brush === 'blur')) {
      rebuildDrawLayer(layer, strokes, blurredRef.current)
      renderRef.current()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, enhance])

  // ── Вьюпорт рабочей области ──
  useEffect(() => {
    const el = workRef.current
    if (!el) return
    const measure = () => setVp({ w: el.clientWidth - 48, h: el.clientHeight - 48 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => {
    rotAnimRef.current?.()
    cropAnimRef.current?.()
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
  }, [])

  // ── Производные величины текущего кадра ──
  const dims = img ? srcSize(img) : null
  const W = dims?.w ?? 0
  const H = dims?.h ?? 0
  const stickerBase = dims ? stickerBaseSize(W, H) : 0
  const cropTab = tab === 'crop'
  // Масштаб покрытия: изображение при любом угле полностью закрывает рамку.
  const scale = dims && crop ? coverScale(crop, W, H, rotation) : 1
  // Смещение центра рамки относительно центра изображения (центр. координаты).
  const ox = crop ? crop.x + crop.w / 2 - W / 2 : 0
  const oy = crop ? crop.y + crop.h / 2 - H / 2 : 0

  // Доступная под превью высота (в crop-режиме снизу — панель колеса).
  const availH = Math.max(1, vp.h - (cropTab ? WHEEL_H : 0))
  const availW = Math.max(1, vp.w)

  // Габарит повёрнутого изображения (для вписывания в crop-режиме).
  const cosA = Math.abs(Math.cos(rotation))
  const sinA = Math.abs(Math.sin(rotation))
  const bboxW = scale * (W * cosA + H * sinA)
  const bboxH = scale * (W * sinA + H * cosA)

  // k — линейный масштаб центрированное-выходное → CSS-пиксели; origin — сдвиг.
  // Crop-режим: показываем всё изображение (центр в центре вьюпорта), поверх —
  // рамка кропа + затемнение. Остальные вкладки: показываем регион кропа.
  let k: number
  let dispW: number
  let dispH: number
  let originX: number
  let originY: number
  if (cropTab && crop) {
    k = fitScale(bboxW, bboxH, availW, availH)
    dispW = availW
    dispH = availH
    originX = dispW / 2
    originY = dispH / 2
  } else if (crop) {
    k = fitScale(crop.w, crop.h, availW, availH)
    dispW = crop.w * k
    dispH = crop.h * k
    originX = k * (crop.w / 2 - ox)
    originY = k * (crop.h / 2 - oy)
  } else {
    k = 1; dispW = 0; dispH = 0; originX = 0; originY = 0
  }

  // Матрица источник → CSS-пиксели (относительно левого-верха канваса) для
  // pointer-инверсии и позиционирования input текста.
  const buildMatrix = (): DOMMatrix => {
    const m = new DOMMatrix()
    m.translateSelf(originX, originY)
    m.scaleSelf(k, k)
    m.scaleSelf(scale, scale)
    m.rotateSelf((rotation * 180) / Math.PI)
    m.scaleSelf(flipX, flipY)
    m.translateSelf(-W / 2, -H / 2)
    return m
  }

  const scene = (exportTexts?: TextBlock[]): Scene => ({
    img: img as SrcImage,
    enhance,
    adjusted: adjustedRef.current,
    drawLayer: drawLayerRef.current,
    texts: exportTexts ?? texts,
    stickers,
    stickerBase,
    resolveSticker: (id) => stickerAssetsRef.current?.get(id) ?? null,
    w: W,
    h: H,
    flipX,
    flipY,
    rotation,
    scale,
  })

  // ── Слой рисования (полное разрешение исходника W×H) ──
  useEffect(() => {
    if (!img) return
    let layer = drawLayerRef.current
    if (!layer || layer.width !== Math.round(W) || layer.height !== Math.round(H)) {
      layer = document.createElement('canvas')
      layer.width = Math.round(W)
      layer.height = Math.round(H)
      drawLayerRef.current = layer
    }
    rebuildDrawLayer(layer, strokes, blurredRef.current)
    renderRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, strokes])

  // ── Отрисовка превью ──
  renderRef.current = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !img || !crop) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(dispW * dpr))
    canvas.height = Math.max(1, Math.round(dispH * dpr))
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * originX, dpr * originY)
    composeScene(
      ctx,
      scene(),
      editingRef.current && !editingRef.current.isNew ? editingRef.current.id : undefined,
    )
    // Рамка выделения активного стикера (только превью, не в экспорте): рисуем в
    // том же пространстве сцены, что и слой; толщина/ручки — постоянные в
    // экранных px (делим на srcScale = k*scale).
    if (tab === 'stickers' && selectedSticker != null) {
      const L = stickers.find((l) => l.id === selectedSticker)
      if (L) {
        const srcScaleNow = k * scale
        const half = (stickerBase * L.scale) / 2
        ctx.save()
        ctx.scale(scale, scale)
        ctx.rotate(rotation)
        ctx.scale(flipX, flipY)
        ctx.translate(-W / 2, -H / 2)
        ctx.translate(L.x, L.y)
        ctx.rotate(L.rotation)
        ctx.lineWidth = 1.5 / srcScaleNow
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.strokeRect(-half, -half, half * 2, half * 2)
        const r = 5 / srcScaleNow
        ctx.fillStyle = '#fff'
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            ctx.beginPath()
            ctx.arc(sx * half, sy * half, r, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        ctx.restore()
      }
    }
  }
  useEffect(() => { renderRef.current() })

  // ── Текст: редактирование через input-оверлей ──
  const setEditing = (v: EditingText | null) => {
    editingRef.current = v
    setEditingText(v)
  }

  // Возвращает итоговый список блоков — экспорт при открытом инпуте берёт его
  // сразу, не дожидаясь setState.
  const commitEditing = (): TextBlock[] => {
    const ed = editingRef.current
    if (!ed) return texts
    const value = (textInputRef.current?.value ?? '').trim()
    setEditing(null)
    let next = texts
    if (ed.isNew) {
      if (value) {
        next = [...texts, { id: ed.id, x: ed.x, y: ed.y, text: value, color: ed.color, size: ed.sizeSrc, style: ed.style, font: ed.font, align: ed.align }]
        setHistory((h) => pushHistory(h, { type: 'text-add', id: ed.id }))
        setRedoStack([]) // новое действие обнуляет ветку повтора
      }
    } else if (value) {
      next = texts.map((b) => (b.id === ed.id ? { ...b, text: value } : b))
    } else {
      const block = texts.find((b) => b.id === ed.id)
      next = texts.filter((b) => b.id !== ed.id)
      if (block) { setHistory((h) => pushHistory(h, { type: 'text-remove', block })); setRedoStack([]) }
    }
    setTexts(next)
    return next
  }

  const cancelEditing = () => setEditing(null)

  const hitText = (p: Point): TextBlock | null => {
    if (!measureCtxRef.current) {
      measureCtxRef.current = document.createElement('canvas').getContext('2d')
    }
    const mctx = measureCtxRef.current
    if (!mctx) return null
    for (let i = texts.length - 1; i >= 0; i--) {
      const r = measureTextBlock(mctx, texts[i])
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return texts[i]
    }
    return null
  }

  // ── Слои стикеров ──
  // Добавление в центр видимой области (центр crop-рамки в координатах
  // исходника). rotation = -rotation сцены → стикер добавляется прямым на экране
  // (порт tweb stickersTab: rotation = -transform.rotation), дальше вращается
  // вместе с медиа. scale=1 (базовый размер — доля кадра, stickerBaseSize).
  const addSticker = (st: Sticker) => {
    if (!crop) return
    const id = nextIdRef.current++
    const layer: StickerLayer = {
      id, mediaId: st.mediaId,
      x: crop.x + crop.w / 2, y: crop.y + crop.h / 2,
      scale: 1, rotation: -rotation,
    }
    stickerAssetsRef.current?.ensure(st.mediaId)
    setStickers((prev) => [...prev, layer])
    setSelectedSticker(id)
    setHistory((h) => pushHistory(h, { type: 'sticker-add', id }))
    setRedoStack([])
  }

  const deleteSticker = (id: number) => {
    const layer = stickers.find((l) => l.id === id)
    setStickers((prev) => prev.filter((l) => l.id !== id))
    if (selectedSticker === id) setSelectedSticker(null)
    if (layer) { setHistory((h) => pushHistory(h, { type: 'sticker-remove', layer })); setRedoStack([]) }
  }

  // Выбор слоя поднимает его наверх стопки (порт moveSelectedLayerOnTop tweb).
  const selectSticker = (id: number) => {
    setSelectedSticker(id)
    setStickers((prev) => {
      const idx = prev.findIndex((l) => l.id === id)
      if (idx < 0 || idx === prev.length - 1) return prev
      const copy = prev.slice()
      const [l] = copy.splice(idx, 1)
      copy.push(l)
      return copy
    })
  }

  // ── Undo / Redo ── (логика — чистые редьюсеры editorHistory)
  const applyHistory = (fn: typeof applyUndo) => {
    const next = fn({ history, redoStack, strokes, texts, stickers })
    setHistory(next.history)
    setRedoStack(next.redoStack)
    setStrokes(next.strokes)
    setTexts(next.texts)
    setStickers(next.stickers)
    if (selectedSticker != null && !next.stickers.some((l) => l.id === selectedSticker)) {
      setSelectedSticker(null)
    }
  }
  const undo = () => applyHistory(applyUndo)
  const redo = () => applyHistory(applyRedo)

  // ── Закрытие ──
  const dirty = !!img && !!crop && (
    strokes.length > 0 || texts.length > 0 || stickers.length > 0 || !isDefaultEnhance(enhance)
    || rotation !== 0 || flipX !== 1 || flipY !== 1
    || crop.x > 0.5 || crop.y > 0.5 || crop.w < W - 0.5 || crop.h < H - 0.5
  )

  const requestClose = () => {
    if (dirty) setConfirmOpen(true)
    else onCancel()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (editingRef.current) cancelEditing()
        else if (!confirmOpen) requestClose()
        else setConfirmOpen(false)
        return
      }
      // Delete/Backspace удаляет выбранный стикер (когда открыта вкладка stickers
      // и не редактируется текст).
      if ((e.key === 'Delete' || e.key === 'Backspace') && tab === 'stickers'
        && selectedSticker != null && !editingRef.current) {
        e.preventDefault()
        e.stopPropagation()
        deleteSticker(selectedSticker)
        return
      }
      // Ctrl/Cmd+Z — undo, Ctrl/Cmd+Shift+Z или Ctrl/Cmd+Y — redo. Редактор —
      // верхний слой: гасим событие (stopPropagation), чтобы оно не ушло глубже.
      // В открытом текстовом инпуте не перехватываем (там правит браузер).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !editingRef.current) {
        if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); return }
        if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') { e.preventDefault(); e.stopPropagation(); redo() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // ── Экспорт (полное разрешение обрезанного/повёрнутого результата) ──
  const doFinish = async () => {
    if (!img || !crop || busy) return
    const exportTexts = editingRef.current ? commitEditing() : texts
    setBusy(true)
    try {
      const cw = Math.max(1, Math.round(crop.w))
      const ch = Math.max(1, Math.round(crop.h))
      const c = document.createElement('canvas')
      c.width = cw
      c.height = ch
      const ctx = c.getContext('2d')
      if (!ctx) return
      // JPEG без альфы: прозрачные пиксели (png) станут белыми, а не чёрными.
      // Cover-scale гарантирует, что изображение покрывает рамку — пустых углов
      // при повороте не будет.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, cw, ch)
      // Центрированное выходное пространство → канвас cw×ch (левый-верх рамки).
      ctx.setTransform(1, 0, 0, 1, crop.w / 2 - ox, crop.h / 2 - oy)
      composeScene(ctx, scene(exportTexts))
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92))
      if (blob) onDone(blob)
    } finally {
      setBusy(false)
    }
  }

  // ── Pointer-события канваса (Draw/Text) ──
  const toSrc = (e: React.PointerEvent): Point => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    const p = buildMatrix().inverse().transformPoint(
      new DOMPoint(e.clientX - r.left, e.clientY - r.top),
    )
    return { x: p.x, y: p.y }
  }

  // Линейный масштаб источник → экран (для толщины кисти и кегля текста).
  const srcScale = k * scale

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (!img || !crop || e.button !== 0) return
    const p = toSrc(e)
    if (tab === 'draw') {
      e.currentTarget.setPointerCapture(e.pointerId)
      strokeRef.current = {
        brush,
        color: hasBrushColor(brush) ? brushColors[brush] : '#ffffff',
        size: Math.max(1, brushSize / srcScale),
        points: [p],
      }
      const layer = drawLayerRef.current
      if (layer) rebuildDrawLayer(layer, [...strokes, strokeRef.current], blurredRef.current)
      renderRef.current()
    } else if (tab === 'text') {
      if (editingRef.current) {
        // клик вне инпута — коммит текущего блока (blur сделает no-op по ref)
        commitEditing()
        return
      }
      const hit = hitText(p)
      if (hit) {
        e.currentTarget.setPointerCapture(e.pointerId)
        textDragRef.current = { id: hit.id, last: p, moved: false }
      } else {
        setEditing({
          id: nextIdRef.current++,
          x: p.x,
          y: p.y,
          isNew: true,
          sizeSrc: Math.max(1, textSize / srcScale),
          color: textColor,
          style: textStyle,
          font: textFontKey,
          align: textAlign,
        })
      }
    } else if (tab === 'stickers') {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      // угловая ручка выбранного слоя → поворот+масштаб
      const sel = stickers.find((l) => l.id === selectedSticker)
      if (sel) {
        const hc = stickerCorners(sel, stickerBase, buildMatrix())
          .find((c) => Math.hypot(c.point.x - screen.x, c.point.y - screen.y) <= STICKER_HANDLE_HIT)
        if (hc) {
          e.currentTarget.setPointerCapture(e.pointerId)
          stickerResizeRef.current = { id: sel.id, corner: hc.corner }
          return
        }
      }
      // иначе — выбрать/перетащить слой под точкой или снять выделение
      const hit = hitSticker(stickers, p, stickerBase)
      if (hit) {
        e.currentTarget.setPointerCapture(e.pointerId)
        selectSticker(hit.id)
        stickerDragRef.current = { id: hit.id, last: p, moved: false }
      } else {
        setSelectedSticker(null)
      }
    }
  }

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (tab === 'draw' && strokeRef.current) {
      strokeRef.current.points.push(toSrc(e))
      const layer = drawLayerRef.current
      if (layer) rebuildDrawLayer(layer, [...strokes, strokeRef.current], blurredRef.current)
      renderRef.current()
    } else if (tab === 'text' && textDragRef.current) {
      const d = textDragRef.current
      const p = toSrc(e)
      const dx = p.x - d.last.x
      const dy = p.y - d.last.y
      if (Math.hypot(dx, dy) * srcScale > 2) d.moved = true
      if (d.moved) {
        d.last = p
        setTexts((ts) => ts.map((b) => (b.id === d.id ? { ...b, x: b.x + dx, y: b.y + dy } : b)))
      }
    } else if (tab === 'stickers' && stickerResizeRef.current) {
      const rz = stickerResizeRef.current
      const L = stickers.find((l) => l.id === rz.id)
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!L || !rect) return
      const c = buildMatrix().transformPoint(new DOMPoint(L.x, L.y))
      const { rotation: rot, scale: sc } = resizeSticker({
        corner: rz.corner,
        half: (stickerBase * srcScale) / 2,
        center: { x: c.x, y: c.y },
        pointer: { x: e.clientX - rect.left, y: e.clientY - rect.top },
        sceneRotation: rotation,
      })
      setStickers((prev) => prev.map((l) => (l.id === rz.id ? { ...l, rotation: rot, scale: Math.max(0.05, sc) } : l)))
    } else if (tab === 'stickers' && stickerDragRef.current) {
      const d = stickerDragRef.current
      const p = toSrc(e)
      const dx = p.x - d.last.x
      const dy = p.y - d.last.y
      if (Math.hypot(dx, dy) * srcScale > 2) d.moved = true
      if (d.moved) {
        d.last = p
        setStickers((prev) => prev.map((l) => (l.id === d.id ? { ...l, x: l.x + dx, y: l.y + dy } : l)))
      }
    }
  }

  const onCanvasPointerUp = () => {
    // трансформации слоёв-стикеров — live-мутации, в историю не пишем (как drag текста)
    stickerDragRef.current = null
    stickerResizeRef.current = null
    if (strokeRef.current) {
      const st = strokeRef.current
      strokeRef.current = null
      setStrokes((prev) => [...prev, st])
      setHistory((h) => pushHistory(h, { type: 'stroke' }))
      setRedoStack([]) // новый штрих обнуляет ветку повтора
    }
    const d = textDragRef.current
    if (d) {
      textDragRef.current = null
      if (!d.moved) {
        // клик без сдвига — редактировать существующий блок
        const block = texts.find((b) => b.id === d.id)
        if (block) {
          setEditing({
            id: block.id, x: block.x, y: block.y, isNew: false,
            sizeSrc: block.size, color: block.color, style: block.style,
            font: block.font, align: block.align,
          })
        }
      }
    }
  }

  // ── Crop: рамка + 8 ручек ──
  const aspectValue = crop ? aspectOf(aspect, W, H) : null

  const onCropPointerDown = (e: React.PointerEvent, mode: 'move' | CropHandle) => {
    if (!crop || e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    cropAnimRef.current?.()
    cropDragRef.current = { mode, start: crop, px: e.clientX, py: e.clientY }
  }

  const onCropPointerMove = (e: React.PointerEvent) => {
    const d = cropDragRef.current
    if (!d) return
    const dx = (e.clientX - d.px) / k
    const dy = (e.clientY - d.py) / k
    setCrop(d.mode === 'move'
      ? moveCrop(d.start, dx, dy, W, H)
      : resizeCrop(d.start, d.mode, dx, dy, W, H, aspectValue))
  }

  const onCropPointerUp = () => { cropDragRef.current = null }

  // Анимированная подгонка рамки под новое соотношение/поворот (~200ms).
  const animateCropTo = (target: Rect) => {
    if (!crop) { setCrop(target); return }
    const from = crop
    cropAnimRef.current?.()
    cropAnimRef.current = animate(200, (p) => {
      setCrop({
        x: lerp(from.x, target.x, p), y: lerp(from.y, target.y, p),
        w: lerp(from.w, target.w, p), h: lerp(from.h, target.h, p),
      })
    })
  }

  const applyAspect = (preset: AspectPreset) => {
    if (!crop) return
    setAspect(preset)
    animateCropTo(centeredAspectCrop(W, H, aspectOf(preset, W, H)))
  }

  // ── Свободный поворот / флип ──
  const animateRotationTo = (target: number) => {
    const from = rotation
    rotAnimRef.current?.()
    rotAnimRef.current = animate(200, (p) => setRotation(lerp(from, target, p)), () => setRotation(target))
  }

  // Поворот на 90° влево со снапом к прямому углу (tweb rotateLeft).
  const rotate90 = () => {
    if (!crop) return
    const base = Math.round(rotation / QUARTER) * QUARTER
    animateRotationTo(base - QUARTER)
    if (aspect === 'free') {
      // свободная рамка — «переворачиваем» её вместе с картинкой (swap w/h)
      const nw = Math.min(crop.h, W)
      const nh = Math.min(crop.w, H)
      animateCropTo({ x: (W - nw) / 2, y: (H - nh) / 2, w: nw, h: nh })
    }
  }

  // Чётность четверти: при 90/270 экранные оси меняются местами (tweb flipImage).
  const isReversed = () => Math.abs(Math.round(rotation / QUARTER)) % 2 === 1
  const flipHorizontal = () => (isReversed() ? setFlipY((f) => (f === 1 ? -1 : 1)) : setFlipX((f) => (f === 1 ? -1 : 1)))
  const flipVertical = () => (isReversed() ? setFlipX((f) => (f === 1 ? -1 : 1)) : setFlipY((f) => (f === 1 ? -1 : 1)))

  const resetCrop = () => {
    rotAnimRef.current?.()
    cropAnimRef.current?.()
    setAspect('free')
    setRotation(0)
    setFlipX(1)
    setFlipY(1)
    if (dims) setCrop({ x: 0, y: 0, w: W, h: H })
  }

  // ── Колесо углов ──
  const degTotal = (rotation * 180) / Math.PI
  const offDeg = degTotal - Math.round(degTotal / 90) * 90 // [-45,45] относительно прямого угла
  const wheelStripX = -(offDeg / DEGREE_STEP) * DEGREE_DIST_PX
  const wheelValue = (() => {
    const v = Math.abs(offDeg) < 0.05 ? 0 : offDeg
    return v.toFixed(1).replace(/\.0$/, '').replace(/^-0$/, '0')
  })()

  const onWheelPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    rotAnimRef.current?.()
    wheelDragRef.current = { startX: e.clientX, startRot: rotation }
  }
  const onWheelPointerMove = (e: React.PointerEvent) => {
    const d = wheelDragRef.current
    if (!d) return
    const deltaDeg = ((e.clientX - d.startX) / DEGREE_DIST_PX) * DEGREE_STEP
    let target = d.startRot - (deltaDeg * Math.PI) / 180
    // «липкий» захват к ближайшему прямому углу
    const nearest = Math.round(target / QUARTER) * QUARTER
    if (Math.abs(target - nearest) < SNAP_RAD) target = nearest
    setRotation(target)
  }
  const onWheelPointerUp = () => { wheelDragRef.current = null }

  // ── Кисть: текущий цвет per-brush и превью размера ──
  const brushColorValue = hasBrushColor(brush) ? brushColors[brush] : SWATCHES[0]
  const setBrushColorValue = (c: string) => {
    if (hasBrushColor(brush)) setBrushColors((m) => ({ ...m, [brush]: c }))
  }
  // Превью размера кисти: кружок по центру, гаснет через 1с после последнего
  // изменения слайдера (порт tweb previewBrushSize).
  const changeBrushSize = (v: number) => {
    setBrushSize(v)
    setPreviewSize(v)
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = window.setTimeout(() => setPreviewSize(null), 1000)
  }

  // ── UI-кусочки панели ──
  const swatches = (value: string, onChange: (c: string) => void) => (
    <div className={s.swatches}>
      {SWATCHES.map((c) => (
        <div
          key={c}
          className={classNames(s.swatch, value === c ? s.swatchActive : '')}
          style={{ backgroundColor: c, color: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )

  const sliderRow = (label: string, value: number, min: number, max: number, onChange: (v: number) => void, showSign = false) => (
    <div className={s.sliderRow}>
      <div className={s.sliderHead}>
        <span>{t(label)}</span>
        <span className={value !== 0 && showSign ? s.valueAccent : s.value}>{showSign && value > 0 ? `+${value}` : value}</span>
      </div>
      <Slider min={min} max={max} value={value} onChange={onChange} />
    </div>
  )

  const cropCursor: Record<CropHandle, string> = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  }

  // Положение рамки кропа на экране (crop-режим: изображение центрировано).
  const frameLeft = originX + k * (ox - (crop?.w ?? 0) / 2)
  const frameTop = originY + k * (oy - (crop?.h ?? 0) / 2)

  // Экранная позиция кнопки удаления выбранного стикера — его левый-верхний угол.
  const stickerDeletePos = (() => {
    if (tab !== 'stickers' || !crop) return null
    const L = stickers.find((l) => l.id === selectedSticker)
    if (!L) return null
    const c = stickerCorners(L, stickerBase, buildMatrix())
      .find((x) => x.corner.cornerX === -1 && x.corner.cornerY === -1)
    return c ? c.point : null
  })()

  return createPortal(
    <motion.div
      className={s.root}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <div className={s.work} ref={workRef}>
        {img && crop && (
          <div className={s.stage} style={{ width: dispW, height: dispH }}>
            <canvas
              ref={canvasRef}
              className={s.canvas}
              style={{
                width: dispW,
                height: dispH,
                cursor: tab === 'draw' ? 'crosshair' : tab === 'text' ? 'text' : 'default',
              }}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
            />

            {cropTab && (
              <div
                className={s.cropFrame}
                style={{ left: frameLeft, top: frameTop, width: crop.w * k, height: crop.h * k }}
                onPointerDown={(e) => onCropPointerDown(e, 'move')}
                onPointerMove={onCropPointerMove}
                onPointerUp={onCropPointerUp}
              >
                <div className={s.cropGrid} />
                {CROP_HANDLES.map((h) => (
                  <div
                    key={h}
                    className={s.cropHandle}
                    data-h={h}
                    style={{ cursor: cropCursor[h] }}
                    onPointerDown={(e) => onCropPointerDown(e, h)}
                    onPointerMove={onCropPointerMove}
                    onPointerUp={onCropPointerUp}
                  />
                ))}
              </div>
            )}

            {editingText && (
              <input
                key={editingText.id}
                ref={textInputRef}
                className={s.textInput}
                style={(() => {
                  const p = buildMatrix().transformPoint(new DOMPoint(editingText.x, editingText.y))
                  const fi = fontInfoMap[editingText.font]
                  return {
                    left: p.x,
                    top: p.y,
                    width: Math.max(120, dispW - p.x - 8),
                    fontSize: editingText.sizeSrc * srcScale,
                    fontFamily: `${fi.fontFamily}, sans-serif`,
                    fontWeight: fi.fontWeight,
                    textAlign: editingText.align,
                    color: editingText.style === 'normal' ? editingText.color : contrastColor(editingText.color),
                  }
                })()}
                defaultValue={editingText.isNew ? '' : texts.find((b) => b.id === editingText.id)?.text ?? ''}
                autoFocus
                spellCheck={false}
                onBlur={() => commitEditing()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEditing() }
                }}
              />
            )}

            {tab === 'draw' && previewSize != null && (
              <div
                className={s.brushPreview}
                style={{
                  width: previewSize,
                  height: previewSize,
                  background: hasBrushColor(brush) ? brushColorValue : 'rgba(255, 255, 255, 0.6)',
                }}
              />
            )}

            {stickerDeletePos && (
              <div
                className={s.stickerDelete}
                style={{ left: stickerDeletePos.x, top: stickerDeletePos.y }}
                title={t('Delete')}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => selectedSticker != null && deleteSticker(selectedSticker)}
              >
                <TgIcon name="delete" size={16} />
              </div>
            )}
          </div>
        )}

        {img && crop && cropTab && (
          <div className={s.wheel} style={{ height: WHEEL_H }}>
            <IconButton size="small" color="#fff" title={t('Rotate')} onClick={rotate90}>
              <TgIcon name="rotate" />
            </IconButton>
            <div
              className={s.wheelTrack}
              onPointerDown={onWheelPointerDown}
              onPointerMove={onWheelPointerMove}
              onPointerUp={onWheelPointerUp}
            >
              <div className={s.wheelStrip} style={{ transform: `translateX(calc(-50% + ${wheelStripX}px))` }}>
                {WHEEL_LABELS.map((d) => (
                  <div key={d} className={s.wheelLabel}>{d}</div>
                ))}
              </div>
              <div className={s.wheelArrow} />
              <div className={s.wheelValue}>{wheelValue}°</div>
            </div>
            <IconButton size="small" color="#fff" title={t('Flip')} onClick={flipHorizontal}>
              <TgIcon name="flip" />
            </IconButton>
            <IconButton size="small" color="#fff" title={t('Flip')} onClick={flipVertical}>
              <span style={{ display: 'flex', transform: 'rotate(90deg)' }}><TgIcon name="flip" /></span>
            </IconButton>
          </div>
        )}
      </div>

      <div className={s.panel}>
        <div className={s.topbar}>
          <IconButton size="small" color="#fff" onClick={requestClose}><TgIcon name="close" /></IconButton>
          <Text size={17} weight={600} color="#fff" style={{ flex: 1 }}>{t('Edit')}</Text>
          <IconButton size="small" color="#fff" disabled={!history.length} className={s.undoBtn} onClick={undo}>
            <TgIcon name="undo" />
          </IconButton>
          <IconButton size="small" color="#fff" disabled={!redoStack.length} className={s.undoBtn} onClick={redo}>
            <TgIcon name="redo" />
          </IconButton>
        </div>

        <div className={s.tabs}>
          {TABS.map(({ key, icon }) => (
            <div
              key={key}
              className={classNames(s.tab, tab === key ? s.tabActive : '')}
              onClick={() => { if (editingRef.current) commitEditing(); setSelectedSticker(null); setTab(key) }}
            >
              <TgIcon name={icon} size={24} />
            </div>
          ))}
        </div>

        <div className={classNames(s.body, tab === 'stickers' ? s.bodyFlush : '')}>
          {tab === 'stickers' && <StickerPicker onPick={addSticker} />}

          {tab === 'enhance' && (
            <>
              {ADJUSTMENTS.map((a) => {
                const [min, max] = enhanceRange(a.to100)
                return sliderRow(a.label, enhance[a.key], min, max,
                  (v) => setEnhance({ ...enhance, [a.key]: v }), !a.to100)
              })}
              {!isDefaultEnhance(enhance) && (
                <div className={s.resetBtn} onClick={() => setEnhance(ENHANCE_DEFAULTS)}>{t('Reset')}</div>
              )}
            </>
          )}

          {tab === 'crop' && (
            <>
              <div className={s.label}>{t('Aspect ratio')}</div>
              {ASPECT_PRESETS.map((p) => (
                <div
                  key={p}
                  className={classNames(s.presetRow, aspect === p ? s.presetActive : '')}
                  onClick={() => applyAspect(p)}
                >
                  {t(ASPECT_LABELS[p])}
                </div>
              ))}
              <div className={s.resetBtn} onClick={resetCrop}>{t('Reset')}</div>
            </>
          )}

          {tab === 'draw' && (
            <>
              <div className={hasBrushColor(brush) ? '' : s.swatchesDisabled}>
                {swatches(brushColorValue, setBrushColorValue)}
              </div>
              {sliderRow('Brush size', brushSize, 2, 32, changeBrushSize)}
              <div className={s.label}>{t('Tool')}</div>
              <div className={s.brushList}>
                {BRUSHES.map(({ key, label, icon }) => (
                  <div
                    key={key}
                    className={classNames(s.brushRow, brush === key ? s.brushActive : '')}
                    onClick={() => setBrush(key)}
                  >
                    <TgIcon name={icon} size={24} style={{ color: hasBrushColor(key) ? brushColors[key] : '#fff' }} />
                    <span>{t(label)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'text' && (
            <>
              {swatches(textColor, setTextColor)}
              <div className={s.toggleRow}>
                <div className={s.toggleGroup}>
                  {ALIGNS.map(({ key, icon }) => (
                    <div
                      key={key}
                      className={classNames(s.styleBtn, textAlign === key ? s.styleActive : '')}
                      onClick={() => setTextAlign(key)}
                    >
                      <TgIcon name={icon} size={24} />
                    </div>
                  ))}
                </div>
                <div className={s.toggleGroup}>
                  {([['fontframe', 'normal'], ['fontframe_outline', 'outline'], ['fontframe_bg', 'background']] as [IconName, TextStyle][]).map(([icon, st]) => (
                    <div
                      key={st}
                      className={classNames(s.styleBtn, textStyle === st ? s.styleActive : '')}
                      onClick={() => setTextStyle(st)}
                    >
                      <TgIcon name={icon} size={24} />
                    </div>
                  ))}
                </div>
              </div>
              {sliderRow('Text size', textSize, 16, 64, setTextSize)}
              <div className={s.label}>{t('Font')}</div>
              <div className={s.fontList}>
                {FONTS.map(({ key, label }) => (
                  <div
                    key={key}
                    className={classNames(s.fontRow, textFontKey === key ? s.fontActive : '')}
                    style={{ fontFamily: `${fontInfoMap[key].fontFamily}, sans-serif`, fontWeight: fontInfoMap[key].fontWeight }}
                    onClick={() => setTextFontKey(key)}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <motion.div
          className={classNames(s.fab, busy ? s.fabBusy : '')}
          whileTap={{ scale: 0.92 }}
          onClick={() => void doFinish()}
        >
          <TgIcon name="check" size={28} />
        </motion.div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title={t('Discard changes')}
          text={t('Are you sure you want to discard the changes?')}
          action={t('Discard')}
          danger
          zIndex={4300}
          onConfirm={onCancel}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </motion.div>,
    container,
  )
}
