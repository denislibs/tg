// src/core/effects/emojiEffects.ts
// Полноэкранные canvas-эффекты эмодзи (аналог tweb emoji fireworks / interactive
// emoji): клик по big-emoji баблу и отправка одиночного эффект-эмодзи запускают
// короткий (1.2–1.8с) салют 2D-частиц поверх всего приложения. Оверлей — один
// переиспользуемый <canvas> (fixed, inset 0, pointer-events: none, z-index 5000),
// живёт только пока летят частицы. prefers-reduced-motion → no-op.
import { normalizeEmoji } from '../animatedEmoji'
import { emojiOnlyCount } from '../../components/RichText'

export type EmojiEffectKind = 'fireworks' | 'confetti' | 'hearts' | 'thumbs' | 'poop' | 'cake'

// Маппинг эмодзи → вид эффекта (ключи без FE0F — сравнение нормализованное).
const EFFECT_BY_EMOJI: Record<string, EmojiEffectKind> = {
  '❤': 'hearts', '😍': 'hearts', '🥰': 'hearts',
  '🎉': 'confetti', '🥳': 'confetti', '🎊': 'confetti',
  '🎆': 'fireworks', '✨': 'fireworks', '🌟': 'fireworks',
  '👍': 'thumbs',
  '💩': 'poop',
  '🎂': 'cake',
}

export function effectForEmoji(emoji: string): EmojiEffectKind | null {
  return EFFECT_BY_EMOJI[normalizeEmoji(emoji)] ?? null
}

/** Гейт отправителя: текст сообщения — РОВНО один эффект-эмодзи, иначе null. */
export function sendEffectForText(text: string): EmojiEffectKind | null {
  return emojiOnlyCount(text) === 1 ? effectForEmoji(text.trim()) : null
}

// ── частицы ──
// Кинематика замкнутой формой (x0 + v·t + g·t²/2) — интегрировать не нужно,
// каждый кадр считается от возраста частицы.
export interface EffectParticle {
  x: number; y: number        // старт, px
  vx: number; vy: number      // скорость, px/s
  gravity: number             // px/s²
  rot: number; vr: number     // rad; для sway-форм rot — фаза покачивания
  sway: number                // амплитуда горизонтального покачивания, px
  size: number                // px
  color: string
  glyph: string               // для shape 'glyph', иначе ''
  shape: 'spark' | 'rect' | 'heart' | 'glyph'
  delay: number               // s до появления (залпы фейерверка)
  ttl: number                 // s жизни после появления
}

export const MAX_PARTICLES = 150

const CONFETTI_COLORS = ['#e8bc2c', '#d0021b', '#4a90d9', '#7ed321', '#9013fe', '#f5a623']
const SPARK_COLORS = ['#ffd54d', '#ff8a65', '#4fc3f7', '#aed581', '#f06292', '#fff176']
const HEART_COLORS = ['#e0245e', '#ff5c8a', '#ff8fab', '#d81b60']

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

/**
 * Чистая генерация начальных частиц эффекта (позиции/скорости по виду).
 * origin — точка запуска (центр кликнутого бабла); без него — дефолт по виду:
 * конфетти всегда сверху, фейерверк по верхней трети, остальное — низ по центру.
 */
export function spawnEffectParticles(
  kind: EmojiEffectKind,
  origin: { x: number; y: number } | null,
  w: number,
  h: number,
): EffectParticle[] {
  const out: EffectParticle[] = []
  if (kind === 'fireworks') {
    // 3 залпа по 40 искр: радиальный разлёт, гравитация, затухание.
    for (let salvo = 0; salvo < 3; salvo++) {
      const cx = salvo === 0 && origin ? origin.x : rnd(w * 0.2, w * 0.8)
      const cy = salvo === 0 && origin ? origin.y : rnd(h * 0.15, h * 0.45)
      for (let i = 0; i < 40; i++) {
        const ang = (i / 40) * Math.PI * 2 + rnd(-0.1, 0.1)
        const speed = rnd(160, 420)
        out.push({
          x: cx, y: cy,
          vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          gravity: 500, rot: 0, vr: 0, sway: 0,
          size: rnd(2, 4), color: pick(SPARK_COLORS), glyph: '',
          shape: 'spark', delay: salvo * 0.28, ttl: rnd(0.8, 1.2),
        })
      }
    }
  } else if (kind === 'confetti') {
    // Прямоугольнички 6 цветов сверху экрана, с вращением.
    for (let i = 0; i < 100; i++) {
      out.push({
        x: rnd(0, w), y: rnd(-40, -10),
        vx: rnd(-70, 70), vy: rnd(260, 520),
        gravity: 260, rot: rnd(0, Math.PI * 2), vr: rnd(-10, 10), sway: rnd(0, 20),
        size: rnd(6, 11), color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], glyph: '',
        shape: 'rect', delay: rnd(0, 0.3), ttl: rnd(1.3, 1.7),
      })
    }
  } else if (kind === 'hearts') {
    // Всплывающие сердца снизу от origin с покачиванием.
    const ox = origin?.x ?? w / 2
    const oy = origin?.y ?? h * 0.85
    for (let i = 0; i < 16; i++) {
      out.push({
        x: ox + rnd(-40, 40), y: oy + rnd(-10, 10),
        vx: rnd(-30, 30), vy: -rnd(160, 320),
        gravity: 0, rot: rnd(0, Math.PI * 2), vr: 0, sway: rnd(14, 36),
        size: rnd(14, 30), color: pick(HEART_COLORS), glyph: '',
        shape: 'heart', delay: rnd(0, 0.4), ttl: rnd(1.1, 1.6),
      })
    }
  } else {
    // thumbs / poop / cake: всплывающие эмодзи-глифы с разлётом веером.
    const glyph = kind === 'thumbs' ? '👍' : kind === 'poop' ? '💩' : '🎂'
    const ox = origin?.x ?? w / 2
    const oy = origin?.y ?? h * 0.85
    for (let i = 0; i < 12; i++) {
      out.push({
        x: ox + rnd(-20, 20), y: oy + rnd(-10, 10),
        vx: rnd(-170, 170), vy: -rnd(220, 430),
        gravity: 380, rot: rnd(-0.5, 0.5), vr: rnd(-3, 3), sway: 0,
        size: rnd(22, 40), color: '', glyph,
        shape: 'glyph', delay: rnd(0, 0.25), ttl: rnd(1.2, 1.7),
      })
    }
  }
  return out.slice(0, MAX_PARTICLES)
}

// ── синглтон-оверлей ──
interface LiveParticle { p: EffectParticle; start: number }

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let raf = 0
let live: LiveParticle[] = []

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (ctx) return ctx
  canvas = document.createElement('canvas')
  const st = canvas.style
  st.position = 'fixed'
  st.inset = '0'
  st.width = '100%'
  st.height = '100%'
  st.pointerEvents = 'none'
  st.zIndex = '5000'
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  document.body.appendChild(canvas)
  ctx = canvas.getContext('2d')
  ctx?.scale(dpr, dpr)
  if (!ctx) destroy()
  return ctx
}

function destroy() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  canvas?.remove()
  canvas = null
  ctx = null
  live = []
}

// Классическое bezier-сердце шириной/высотой size с центром в (0,0).
function heartPath(c: CanvasRenderingContext2D, size: number) {
  const w = size
  const h = size
  const x = 0
  const y = -h / 2
  const top = h * 0.3
  c.beginPath()
  c.moveTo(x, y + top)
  c.bezierCurveTo(x, y, x - w / 2, y, x - w / 2, y + top)
  c.bezierCurveTo(x - w / 2, y + (h + top) / 2, x, y + (h + top) / 2, x, y + h)
  c.bezierCurveTo(x, y + (h + top) / 2, x + w / 2, y + (h + top) / 2, x + w / 2, y + top)
  c.bezierCurveTo(x + w / 2, y, x, y, x, y + top)
}

function frame(now: number) {
  const c = ctx
  if (!c || !canvas) return
  c.clearRect(0, 0, window.innerWidth, window.innerHeight)
  live = live.filter(({ p, start }) => (now - start) / 1000 <= p.ttl)
  for (const { p, start } of live) {
    const t = (now - start) / 1000
    if (t < 0) continue // залп ещё не стартовал
    const x = p.x + p.vx * t + (p.sway ? Math.sin(t * 5 + p.rot) * p.sway : 0)
    const y = p.y + p.vy * t + (p.gravity * t * t) / 2
    // Затухание на последних 30% жизни.
    const alpha = Math.max(0, Math.min(1, (p.ttl - t) / (p.ttl * 0.3)))
    c.save()
    c.globalAlpha = alpha
    c.translate(x, y)
    if (p.shape === 'spark') {
      c.fillStyle = p.color
      c.beginPath()
      c.arc(0, 0, p.size, 0, Math.PI * 2)
      c.fill()
    } else if (p.shape === 'rect') {
      c.rotate(p.rot + p.vr * t)
      c.fillStyle = p.color
      c.fillRect(-p.size / 2, -p.size * 0.2, p.size, p.size * 0.4)
    } else if (p.shape === 'heart') {
      c.fillStyle = p.color
      heartPath(c, p.size)
      c.fill()
    } else {
      c.rotate(p.rot + p.vr * t)
      c.font = `${Math.round(p.size)}px sans-serif`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(p.glyph, 0, 0)
    }
    c.restore()
  }
  if (live.length) raf = requestAnimationFrame(frame)
  else destroy()
}

/** Запустить эффект; origin — центр кликнутого бабла (viewport-координаты). */
export function playEmojiEffect(kind: EmojiEffectKind, origin?: { x: number; y: number }) {
  if (typeof document === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  if (!ensureCanvas()) return
  const now = performance.now()
  const parts = spawnEffectParticles(kind, origin ?? null, window.innerWidth, window.innerHeight)
  for (const p of parts) live.push({ p, start: now + p.delay * 1000 })
  if (!raf) raf = requestAnimationFrame(frame)
}
