// Медиа-редактор перед отправкой — упрощённый порт tweb mediaEditor на
// canvas 2D (без WebGL): слева рабочая область с превью, справа панель с
// вкладками Enhance / Crop / Draw / Text, undo-стек, FAB «Готово».
// Превью рисуется с даунскейлом под вьюпорт, но все координаты (crop, штрихи,
// текст) живут в пикселях исходника, поэтому экспорт — в полном разрешении.
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
  ASPECT_PRESETS, CROP_HANDLES, ENHANCE_DEFAULTS,
  aspectOf, centeredAspectCrop, fitScale, flipPointH, flipRectH,
  isDefaultEnhance, moveCrop, pushHistory, resizeCrop, rotatePointCW, rotateRectCW,
  type AspectPreset, type CropHandle, type EnhanceValues, type Point, type Rect,
} from './editorMath'
import {
  composeScene, flipOrientH, measureTextBlock, orientedSize, rebuildDrawLayer, rotateOrientCW, srcSize,
  type Orient, type SrcImage, type Stroke, type TextBlock, type TextStyle,
} from './sceneRender'
import { applyRedo, applyUndo, type HistoryItem, type RedoItem } from './editorHistory'
import s from './MediaEditor.module.scss'

// Палитра tweb mediaEditor (colorPickerSwatches).
const SWATCHES = ['#ffffff', '#fe4438', '#ff8901', '#ffd60a', '#33c759', '#62e5e0', '#0a84ff', '#bd5cf3']

type Tab = 'enhance' | 'crop' | 'draw' | 'text'

const TABS: { key: Tab; icon: IconName }[] = [
  { key: 'enhance', icon: 'enhance' },
  { key: 'crop', icon: 'crop' },
  { key: 'draw', icon: 'brush' },
  { key: 'text', icon: 'text' },
]

const ENHANCE_FIELDS: { key: keyof EnhanceValues; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'warmth', label: 'Warmth' },
]

const ASPECT_LABELS: Record<AspectPreset, string> = {
  free: 'Free', original: 'Original', '1:1': 'Square', '4:3': '4:3', '16:9': '16:9',
}

// Undo/redo — чистые редьюсеры в editorHistory (в стеке только штрихи и
// добавление/удаление текста; Enhance/Crop параметрические — сброс кнопкой).

// Метаданные открытого input-оверлея текста (сам текст живёт в input).
interface EditingText {
  id: number
  x: number
  y: number
  isNew: boolean
  sizeSrc: number
  color: string
  style: TextStyle
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
  const [orient, setOrient] = useState<Orient>({ rot: 0, flip: false })
  const [tab, setTab] = useState<Tab>('enhance')
  const [enhance, setEnhance] = useState<EnhanceValues>(ENHANCE_DEFAULTS)
  const [crop, setCrop] = useState<Rect | null>(null)
  const [aspect, setAspect] = useState<AspectPreset>('free')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [texts, setTexts] = useState<TextBlock[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [redoStack, setRedoStack] = useState<RedoItem[]>([])
  const [brushColor, setBrushColor] = useState(SWATCHES[1])
  const [brushSize, setBrushSize] = useState(12)
  const [textColor, setTextColor] = useState(SWATCHES[0])
  const [textSize, setTextSize] = useState(32)
  const [textStyle, setTextStyle] = useState<TextStyle>('normal')
  const [editingText, setEditingText] = useState<EditingText | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [vp, setVp] = useState({ w: 0, h: 0 })

  const workRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const drawLayerRef = useRef<HTMLCanvasElement | null>(null)
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const renderRef = useRef<() => void>(() => {})
  // editingText зеркалится в ref: blur и pointerdown приходят в один тик, и
  // только синхронный ref спасает от двойного коммита блока
  const editingRef = useRef<EditingText | null>(null)
  const nextIdRef = useRef(1)
  const strokeRef = useRef<Stroke | null>(null)
  const textDragRef = useRef<{ id: number; last: Point; moved: boolean } | null>(null)
  const cropDragRef = useRef<{ mode: 'move' | CropHandle; start: Rect; px: number; py: number } | null>(null)

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

  // Производные величины текущего кадра: видимая область и масштаб превью.
  const os = img ? orientedSize(img, orient) : null
  const view: Rect | null = os && crop ? (tab === 'crop' ? { x: 0, y: 0, w: os.w, h: os.h } : crop) : null
  const scale = view ? fitScale(view.w, view.h, Math.max(1, vp.w), Math.max(1, vp.h)) : 1
  const dispW = view ? view.w * scale : 0
  const dispH = view ? view.h * scale : 0

  // ── Слой рисования (полное разрешение) ──
  useEffect(() => {
    if (!img || !os) return
    let layer = drawLayerRef.current
    if (!layer || layer.width !== Math.round(os.w) || layer.height !== Math.round(os.h)) {
      layer = document.createElement('canvas')
      layer.width = Math.round(os.w)
      layer.height = Math.round(os.h)
      drawLayerRef.current = layer
    }
    rebuildDrawLayer(layer, strokes)
    renderRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, orient, strokes])

  // ── Отрисовка превью ──
  renderRef.current = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !img || !view) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(dispW * dpr))
    canvas.height = Math.max(1, Math.round(dispH * dpr))
    const k = scale * dpr
    ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k)
    composeScene(
      ctx,
      { img, orient, enhance, drawLayer: drawLayerRef.current, texts },
      editingRef.current && !editingRef.current.isNew ? editingRef.current.id : undefined,
    )
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
        next = [...texts, { id: ed.id, x: ed.x, y: ed.y, text: value, color: ed.color, size: ed.sizeSrc, style: ed.style }]
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

  // ── Undo / Redo ── (логика — чистые редьюсеры editorHistory)
  const applyHistory = (fn: typeof applyUndo) => {
    const next = fn({ history, redoStack, strokes, texts })
    setHistory(next.history)
    setRedoStack(next.redoStack)
    setStrokes(next.strokes)
    setTexts(next.texts)
  }
  const undo = () => applyHistory(applyUndo)
  const redo = () => applyHistory(applyRedo)

  // ── Закрытие ──
  const dirty = !!img && !!os && !!crop && (
    strokes.length > 0 || texts.length > 0 || !isDefaultEnhance(enhance)
    || orient.rot !== 0 || orient.flip
    || crop.x > 0.5 || crop.y > 0.5 || crop.w < os.w - 0.5 || crop.h < os.h - 0.5
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

  // ── Экспорт (полное разрешение исходника) ──
  const doFinish = async () => {
    if (!img || !crop || busy) return
    const exportTexts = editingRef.current ? commitEditing() : texts
    setBusy(true)
    try {
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(crop.w))
      c.height = Math.max(1, Math.round(crop.h))
      const ctx = c.getContext('2d')
      if (!ctx) return
      // JPEG без альфы: прозрачные пиксели (png) станут белыми, а не чёрными
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.translate(-crop.x, -crop.y)
      composeScene(ctx, { img, orient, enhance, drawLayer: drawLayerRef.current, texts: exportTexts })
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92))
      if (blob) onDone(blob)
    } finally {
      setBusy(false)
    }
  }

  // ── Pointer-события канваса (Draw/Text) ──
  const toSrc = (e: React.PointerEvent): Point => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r || !view) return { x: 0, y: 0 }
    return { x: view.x + (e.clientX - r.left) / scale, y: view.y + (e.clientY - r.top) / scale }
  }

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (!img || !view || e.button !== 0) return
    const p = toSrc(e)
    if (tab === 'draw') {
      e.currentTarget.setPointerCapture(e.pointerId)
      strokeRef.current = { color: brushColor, size: Math.max(1, brushSize / scale), points: [p] }
      const layer = drawLayerRef.current
      if (layer) rebuildDrawLayer(layer, [...strokes, strokeRef.current])
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
          sizeSrc: Math.max(1, textSize / scale),
          color: textColor,
          style: textStyle,
        })
      }
    }
  }

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (tab === 'draw' && strokeRef.current) {
      strokeRef.current.points.push(toSrc(e))
      const layer = drawLayerRef.current
      if (layer) rebuildDrawLayer(layer, [...strokes, strokeRef.current])
      renderRef.current()
    } else if (tab === 'text' && textDragRef.current) {
      const d = textDragRef.current
      const p = toSrc(e)
      const dx = p.x - d.last.x
      const dy = p.y - d.last.y
      if (Math.hypot(dx, dy) * scale > 2) d.moved = true
      if (d.moved) {
        d.last = p
        setTexts((ts) => ts.map((b) => (b.id === d.id ? { ...b, x: b.x + dx, y: b.y + dy } : b)))
      }
    }
  }

  const onCanvasPointerUp = () => {
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
          })
        }
      }
    }
  }

  // ── Crop: рамка + 8 ручек ──
  const aspectValue = os ? aspectOf(aspect, os.w, os.h) : null

  const onCropPointerDown = (e: React.PointerEvent, mode: 'move' | CropHandle) => {
    if (!crop || e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    cropDragRef.current = { mode, start: crop, px: e.clientX, py: e.clientY }
  }

  const onCropPointerMove = (e: React.PointerEvent) => {
    const d = cropDragRef.current
    if (!d || !os) return
    const dx = (e.clientX - d.px) / scale
    const dy = (e.clientY - d.py) / scale
    setCrop(d.mode === 'move'
      ? moveCrop(d.start, dx, dy, os.w, os.h)
      : resizeCrop(d.start, d.mode, dx, dy, os.w, os.h, aspectValue))
  }

  const onCropPointerUp = () => { cropDragRef.current = null }

  const applyAspect = (preset: AspectPreset) => {
    if (!os) return
    setAspect(preset)
    setCrop(centeredAspectCrop(os.w, os.h, aspectOf(preset, os.w, os.h)))
  }

  // Поворот/отражение: пересчитать crop, штрихи и якоря текста в новое
  // ориентированное пространство (слой рисования перестроится эффектом).
  const doRotate = () => {
    if (!os || !crop) return
    const h0 = os.h
    setOrient(rotateOrientCW(orient))
    setCrop(rotateRectCW(crop, h0))
    setStrokes(strokes.map((st) => ({ ...st, points: st.points.map((p) => rotatePointCW(p, h0)) })))
    setTexts(texts.map((b) => ({ ...b, ...rotatePointCW(b, h0) })))
    setAspect('free')
  }

  const doFlip = () => {
    if (!os || !crop) return
    const w0 = os.w
    setOrient(flipOrientH(orient))
    setCrop(flipRectH(crop, w0))
    setStrokes(strokes.map((st) => ({ ...st, points: st.points.map((p) => flipPointH(p, w0)) })))
    setTexts(texts.map((b) => ({ ...b, ...flipPointH(b, w0) })))
    setAspect('free')
  }

  const resetCrop = () => {
    if (!os) return
    setAspect('free')
    setCrop({ x: 0, y: 0, w: os.w, h: os.h })
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

  return createPortal(
    <motion.div
      className={s.root}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <div className={s.work} ref={workRef}>
        {img && view && (
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

            {tab === 'crop' && crop && (
              <div
                className={s.cropFrame}
                style={{ left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale }}
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
                style={{
                  left: (editingText.x - view.x) * scale,
                  top: (editingText.y - view.y) * scale,
                  width: Math.max(120, dispW - (editingText.x - view.x) * scale - 8),
                  fontSize: editingText.sizeSrc * scale,
                  color: editingText.color,
                }}
                defaultValue={editingText.isNew ? '' : texts.find((b) => b.id === editingText.id)?.text ?? ''}
                autoFocus
                spellCheck={false}
                onBlur={() => commitEditing()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEditing() }
                }}
              />
            )}
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
              onClick={() => { if (editingRef.current) commitEditing(); setTab(key) }}
            >
              <TgIcon name={icon} size={24} />
            </div>
          ))}
        </div>

        <div className={s.body}>
          {tab === 'enhance' && (
            <>
              {ENHANCE_FIELDS.map((f) =>
                sliderRow(f.label, enhance[f.key], -100, 100, (v) => setEnhance({ ...enhance, [f.key]: v }), true))}
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
              <div className={s.cropTools}>
                <IconButton size="small" color="#fff" title={t('Rotate')} onClick={doRotate}><TgIcon name="rotate" /></IconButton>
                <IconButton size="small" color="#fff" title={t('Flip')} onClick={doFlip}><TgIcon name="flip" /></IconButton>
              </div>
              <div className={s.resetBtn} onClick={resetCrop}>{t('Reset')}</div>
            </>
          )}

          {tab === 'draw' && (
            <>
              {swatches(brushColor, setBrushColor)}
              {sliderRow('Brush size', brushSize, 2, 32, setBrushSize)}
            </>
          )}

          {tab === 'text' && (
            <>
              {swatches(textColor, setTextColor)}
              <div className={s.styleRow}>
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
              {sliderRow('Text size', textSize, 16, 64, setTextSize)}
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
