// Кольцо прогресса (`components/progressRing.ts`, порт tweb
// `components/progressRing.tsx`).
//
// Пиним ДВА разных предмета:
//  1. поведение самого модуля — разметку (на неё опираются CSS-правила
//     `.progress-ring`/`.progress-ring__circle` и глобальный resize-хендлер tweb,
//     который правит УЖЕ созданный элемент по атрибутам) и арифметику
//     заполнения (`stroke-dasharray`/`stroke-dashoffset` от `progress`);
//  2. единственность реализации — сканом исходников (по образцу
//     `core/scrollWriters.test.ts`): кольцо было тремя копиями (локальная во
//     `wrappers/video.ts`, JSX-копия в `composer/RoundRecordPreview.tsx` и этот
//     модуль), и возврат ЛЮБОЙ локальной копии обязан красить тест — иначе
//     реализации снова разъедутся молча.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ProgressRing, { createProgressRing, DEFAULT_STROKE_WIDTH, getProgressRingRadius } from './progressRing'

const SIZE = 200
const RADIUS = SIZE / 2 - DEFAULT_STROKE_WIDTH * 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

describe('progressRing — разметка оригинала', () => {
  it('svg.progress-ring с размером, повёрнутый на -90°, и circle.progress-ring__circle внутри', () => {
    const svg = ProgressRing({ size: SIZE, progress: 0 })

    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.classList.contains('progress-ring')).toBe(true)
    expect(svg.getAttribute('width')).toBe('200')
    expect(svg.getAttribute('height')).toBe('200')
    // без поворота кольцо заполнялось бы от 3 часов, а не от 12
    expect(svg.style.transform).toBe('rotate(-90deg)')

    const circle = svg.firstElementChild as SVGCircleElement
    expect(circle.tagName.toLowerCase()).toBe('circle')
    expect(circle.classList.contains('progress-ring__circle')).toBe(true)
    expect(circle.getAttribute('cx')).toBe('100')
    expect(circle.getAttribute('cy')).toBe('100')
    expect(circle.getAttribute('r')).toBe('' + RADIUS)
    expect(circle.getAttribute('fill')).toBe('transparent')
  })

  it('дефолты штриха — как в оригинале (white / 0.3 / 3.5), и каждый перекрывается пропом', () => {
    const bare = ProgressRing({ size: SIZE, progress: 0 }).firstElementChild!
    expect(bare.getAttribute('stroke')).toBe('white')
    expect(bare.getAttribute('stroke-opacity')).toBe('0.3')
    expect(bare.getAttribute('stroke-width')).toBe('3.5')

    const custom = ProgressRing({
      size: SIZE, progress: 0, stroke: '#000', strokeOpacity: 0.9, strokeWidth: 2,
    }).firstElementChild!
    expect(custom.getAttribute('stroke')).toBe('#000')
    expect(custom.getAttribute('stroke-opacity')).toBe('0.9')
    expect(custom.getAttribute('stroke-width')).toBe('2')
    // радиус считается от ПЕРЕДАННОГО strokeWidth (иначе штрих вылезет за svg)
    expect(custom.getAttribute('r')).toBe('' + getProgressRingRadius(SIZE, 2))
  })

  it('свой класс приезжает ДОПОЛНИТЕЛЬНО к progress-ring (панель записи кружка)', () => {
    const svg = ProgressRing({ size: SIZE, progress: 0, class: 'video-recording-progress-ring' })
    expect(svg.classList.contains('progress-ring')).toBe(true)
    expect(svg.classList.contains('video-recording-progress-ring')).toBe(true)
  })

  it('getProgressRingRadius — формула оригинала (отступ strokeWidth * 2)', () => {
    expect(getProgressRingRadius(200)).toBe(100 - 7)
    expect(getProgressRingRadius(360, 3.5)).toBe(180 - 7)
    expect(getProgressRingRadius(100, 5)).toBe(50 - 10)
  })
})

describe('progressRing — арифметика заполнения', () => {
  const dashoffset = (progress: number) =>
    parseFloat((ProgressRing({ size: SIZE, progress }).firstElementChild as SVGCircleElement).style.strokeDashoffset)

  it('dasharray — полная окружность, dashoffset — незаполненная её часть', () => {
    const circle = ProgressRing({ size: SIZE, progress: 0 }).firstElementChild as SVGCircleElement
    expect(circle.style.strokeDasharray).toBe(`${CIRCUMFERENCE} ${CIRCUMFERENCE}`)
    expect(parseFloat(circle.style.strokeDashoffset)).toBeCloseTo(CIRCUMFERENCE, 6)
  })

  it('0 → пустое кольцо, 0.5 → половина, 1 → полное', () => {
    expect(dashoffset(0)).toBeCloseTo(CIRCUMFERENCE, 6)
    expect(dashoffset(0.5)).toBeCloseTo(CIRCUMFERENCE / 2, 6)
    expect(dashoffset(1)).toBeCloseTo(0, 6)
  })

  it('выход за 0..1 и мусор зажимаются, а не рисуют отрицательный штрих', () => {
    expect(dashoffset(1.5)).toBeCloseTo(0, 6)
    expect(dashoffset(-1)).toBeCloseTo(CIRCUMFERENCE, 6)
    expect(dashoffset(NaN)).toBeCloseTo(CIRCUMFERENCE, 6)
  })
})

describe('progressRing — императивный хендл (createProgressRing)', () => {
  it('отдаёт узел и его circle, стартовый прогресс — 0 по умолчанию', () => {
    const ring = createProgressRing({ size: SIZE })
    expect(ring.element.classList.contains('progress-ring')).toBe(true)
    expect(ring.circle).toBe(ring.element.firstElementChild)
    expect(parseFloat(ring.circle.style.strokeDashoffset)).toBeCloseTo(CIRCUMFERENCE, 6)

    const started = createProgressRing({ size: SIZE, progress: 0.25 })
    expect(parseFloat(started.circle.style.strokeDashoffset)).toBeCloseTo(CIRCUMFERENCE * 0.75, 6)
  })

  it('setProgress двигает dashoffset живого узла', () => {
    const ring = createProgressRing({ size: SIZE })
    ring.setProgress(0.5)
    expect(parseFloat(ring.circle.style.strokeDashoffset)).toBeCloseTo(CIRCUMFERENCE / 2, 6)
    ring.setProgress(1)
    expect(parseFloat(ring.circle.style.strokeDashoffset)).toBeCloseTo(0, 6)
  })

  it('после destroy() setProgress молчит (аналог диспоуза реактивного рута tweb)', () => {
    const ring = createProgressRing({ size: SIZE })
    ring.setProgress(0.5)
    const frozen = ring.circle.style.strokeDashoffset
    ring.destroy()
    ring.setProgress(1)
    expect(ring.circle.style.strokeDashoffset).toBe(frozen)
  })

  it('размер кольца свой у каждого инстанса — окружность не «залипает» на первом', () => {
    const small = createProgressRing({ size: 100 })
    const big = createProgressRing({ size: 360 })
    small.setProgress(0.5)
    big.setProgress(0.5)
    const c100 = 2 * Math.PI * getProgressRingRadius(100)
    const c360 = 2 * Math.PI * getProgressRingRadius(360)
    expect(parseFloat(small.circle.style.strokeDashoffset)).toBeCloseTo(c100 / 2, 6)
    expect(parseFloat(big.circle.style.strokeDashoffset)).toBeCloseTo(c360 / 2, 6)
  })

  it('вызывающий может писать dashoffset сам — хендл ему не мешает (так делает wrapVideo)', () => {
    const ring = createProgressRing({ size: SIZE })
    ring.circle.style.strokeDashoffset = '42'
    expect(ring.circle.style.strokeDashoffset).toBe('42')
  })
})

// ── Пин: одна реализация на всех потребителей ────────────────────────────────
const SRC = join(__dirname, '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

/** Комментарии выкидываем: в шапках врапперов кольцо УПОМИНАЕТСЯ текстом. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** Постройка кольца: классы узлов + JSX-форма того же. */
const RING_MARKUP_RE = /progress-ring__circle|['"`]progress-ring['"`]|className=["']progress-ring/g

describe('progress-ring: единственная реализация — components/progressRing.ts', () => {
  it('разметку кольца не строит больше никто', () => {
    const offenders: Record<string, number> = {}
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      if (rel === 'components/progressRing.ts') continue
      const count = (codeOf(file).match(RING_MARKUP_RE) ?? []).length
      if (count > 0) offenders[rel] = count
    }

    expect(offenders).toEqual({})
  })

  it('оба потребителя берут кольцо из общего модуля', () => {
    for (const rel of ['components/wrappers/video.ts', 'components/composer/RoundRecordPreview.tsx']) {
      expect(codeOf(join(SRC, rel))).toContain("from '@components/progressRing'")
    }
  })
})
