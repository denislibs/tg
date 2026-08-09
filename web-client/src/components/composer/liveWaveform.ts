// src/components/composer/liveWaveform.ts
// Отрисовка живой волны записи — порт tweb
// `components/chat/voiceRecording/liveWaveform.ts`: константы :7-10, замер и
// dpr-буфер :79-94, сама отрисовка :156-205.
//
// Ключевое из оригинала: бары прижаты к ПРАВОМУ краю (`startX = max(0, w - total)`,
// :170) — живая запись растёт справа; цвет берётся из `--primary-color` самого
// канваса (:173-175); форма — `roundRect(x, y, 3, h, 1.5)` с фолбэком на `fillRect`.

const BAR_WIDTH = 3
const BAR_GAP = 3
const BAR_RADIUS = 1.5
const MIN_BAR_HEIGHT = 3

/** liveWaveform.ts:88 — сколько баров влезает в канвас указанной CSS-ширины. */
export function waveformCapacity(cssWidth: number): number {
  return Math.max(1, Math.floor((cssWidth + BAR_GAP) / (BAR_WIDTH + BAR_GAP)))
}

/** Подогнать буфер под dpr и нарисовать пики (0..1) в канвас. */
export function drawWaveform(canvas: HTMLCanvasElement, peaks: readonly number[]): void {
  const { width: w, height: h } = canvas.getBoundingClientRect()
  if (!w || !h) return

  const dpr = window.devicePixelRatio || 1
  const bufW = Math.round(w * dpr)
  const bufH = Math.round(h * dpr)
  if (canvas.width !== bufW) canvas.width = bufW
  if (canvas.height !== bufH) canvas.height = bufH

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const visible = peaks.slice(-waveformCapacity(w))
  if (!visible.length) return

  const stride = BAR_WIDTH + BAR_GAP
  const startX = Math.max(0, w - (visible.length * stride - BAR_GAP))
  const computed = getComputedStyle(canvas)
  ctx.fillStyle = computed.getPropertyValue('--primary-color').trim() || computed.color

  const midY = h / 2
  for (let i = 0; i < visible.length; i++) {
    const barH = Math.max(MIN_BAR_HEIGHT, Math.min(h, visible[i] * h))
    const x = startX + i * stride
    const y = midY - barH / 2
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, BAR_WIDTH, barH, BAR_RADIUS)
    else ctx.rect(x, y, BAR_WIDTH, barH)
    ctx.fill()
  }
}
