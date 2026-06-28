import { Box } from '@mui/material'
import { keyframes } from '@mui/system'

// tweb-style circular preloader: a constant 3/4 (75%) arc with round caps that
// spins at one rotation per second — no growing/shrinking dash.
const rotate = keyframes`
  100% { transform: rotate(360deg); }
`

export default function Preloader({
  size = 40,
  stroke = 3,
  color = 'currentColor',
}: {
  size?: number
  stroke?: number
  color?: string
}) {
  const c = size / 2
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  return (
    <Box
      component="svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      sx={{ animation: `${rotate} 1s linear infinite`, transformOrigin: 'center', display: 'block' }}
    >
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circ * 0.75} ${circ}`}
      />
    </Box>
  )
}
