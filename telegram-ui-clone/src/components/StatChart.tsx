import { useMemo, useId } from 'react'
import type { StatPoint } from '../core/managers/statsManager'

// Лёгкий self-contained график на inline SVG (без внешних либ), в духе tweb
// tchart: сглаженная линия с градиентной заливкой-областью под ней + подписи
// дат снизу. Bar-вариант — столбцы (для «постов по дням»). Тема — через
// CSS-переменные --tg-*.
//
// SVG растягивается по ширине (preserveAspectRatio="none"): линии не «толстеют»
// благодаря vectorEffect, а подписи дат вынесены в HTML-строку под графиком,
// чтобы текст не искажался нелинейным масштабом.

const VB_W = 320 // ширина координатного пространства viewBox
const VB_H = 120 // высота координатного пространства viewBox
const PAD_X = 4

type Variant = 'line' | 'bar'

// smoothPath строит сглаженную кривую (Catmull-Rom → cubic bezier) по точкам.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function StatChart({
  points,
  variant = 'line',
  color = 'var(--tg-accent)',
  height = 160,
}: {
  points: StatPoint[]
  variant?: Variant
  color?: string
  height?: number
}) {
  const gradId = useId()

  const geom = useMemo(() => {
    if (points.length === 0) return null
    const values = points.map((p) => p.value)
    const max = Math.max(...values, 1)
    const min = Math.min(...values, 0)
    const span = max - min || 1
    const innerW = VB_W - PAD_X * 2
    const yOf = (v: number) => VB_H - 6 - ((v - min) / span) * (VB_H - 12)
    const xOf = (i: number) =>
      points.length === 1 ? VB_W / 2 : PAD_X + (i / (points.length - 1)) * innerW
    const pts = points.map((p, i) => ({ x: xOf(i), y: yOf(p.value) }))
    return { pts, xOf }
  }, [points])

  if (!geom) return null
  const { pts } = geom

  const line = smoothPath(pts)
  const area = pts.length > 1 ? `${line} L ${pts[pts.length - 1].x} ${VB_H} L ${pts[0].x} ${VB_H} Z` : ''
  const barW = points.length > 0 ? Math.max(2, ((VB_W - PAD_X * 2) / points.length) * 0.6) : 4

  // подписи: первая / середина / последняя (space-between держит их у краёв)
  const first = points[0]
  const mid = points.length > 2 ? points[Math.floor((points.length - 1) / 2)] : null
  const last = points.length > 1 ? points[points.length - 1] : null

  return (
    <div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        <line
          x1={PAD_X}
          y1={VB_H - 1}
          x2={VB_W - PAD_X}
          y2={VB_H - 1}
          stroke="var(--tg-borderColor, rgba(128,128,128,0.2))"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />

        {variant === 'bar' ? (
          points.map((_, i) => {
            const x = geom.xOf(i)
            const y = pts[i].y
            return (
              <rect
                key={i}
                x={x - barW / 2}
                y={y}
                width={barW}
                height={Math.max(0, VB_H - y)}
                rx={1.5}
                fill={color}
                opacity={0.85}
              />
            )
          })
        ) : (
          <>
            {area && <path d={area} fill={`url(#${gradId})`} />}
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 4,
          fontSize: 11,
          color: 'var(--tg-textSecondary)',
        }}
      >
        <span>{fmtDate(first.date)}</span>
        {mid && <span>{fmtDate(mid.date)}</span>}
        {last && <span>{fmtDate(last.date)}</span>}
      </div>
    </div>
  )
}
