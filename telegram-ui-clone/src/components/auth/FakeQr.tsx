import { Box } from '@mui/material'

const N = 25 // modules per side
const QUIET = 0 // handled by padding on the wrapper

/** Decorative (non-scannable) QR look: finder patterns + rounded modules,
 *  with a clear center area for the Telegram logo. */
export default function FakeQr({
  size = 220,
  color = '#000',
  logo,
}: {
  size?: number
  color?: string
  logo?: React.ReactNode
}) {
  const unit = size / (N + QUIET * 2)
  const r = unit * 0.42

  const inFinder = (x: number, y: number) => {
    const f = (cx: number, cy: number) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7
    return f(0, 0) || f(N - 7, 0) || f(0, N - 7)
  }
  const inCenterHole = (x: number, y: number) => {
    const lo = (N - 7) / 2
    return x >= lo && x < lo + 7 && y >= lo && y < lo + 7
  }
  // deterministic on/off so the pattern is stable across renders
  const on = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663) ^ (x * y * 83492791)) >>> 0) % 100 < 48

  const cells: React.ReactNode[] = []
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (inFinder(x, y) || inCenterHole(x, y)) continue
      if (!on(x, y)) continue
      cells.push(
        <rect key={`${x}-${y}`} x={x * unit + (unit - r) / 2} y={y * unit + (unit - r) / 2} width={r} height={r} rx={r / 2} fill={color} />,
      )
    }
  }

  // finder pattern: outer rounded square ring + inner rounded dot
  const finder = (cx: number, cy: number) => {
    const o = 7 * unit
    const pad = unit
    return (
      <g key={`f-${cx}-${cy}`}>
        <rect x={cx * unit} y={cy * unit} width={o} height={o} rx={o * 0.28} fill={color} />
        <rect
          x={cx * unit + pad}
          y={cy * unit + pad}
          width={o - pad * 2}
          height={o - pad * 2}
          rx={(o - pad * 2) * 0.26}
          fill="#fff"
        />
        <rect
          x={cx * unit + pad * 2}
          y={cy * unit + pad * 2}
          width={o - pad * 4}
          height={o - pad * 4}
          rx={(o - pad * 4) * 0.3}
          fill={color}
        />
      </g>
    )
  }

  return (
    <Box sx={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {cells}
        {finder(0, 0)}
        {finder(N - 7, 0)}
        {finder(0, N - 7)}
      </svg>
      {logo && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {logo}
        </Box>
      )}
    </Box>
  )
}
