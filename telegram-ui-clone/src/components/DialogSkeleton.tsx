import { Box, useTheme } from '@mui/material'
import { keyframes } from '@mui/system'

// A shimmering placeholder list shown while the first page of dialogs loads
// (tweb shows skeleton rows before the real chats fade in).
const shimmer = keyframes`
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
`

function Bar({ width, height = 12, dark }: { width: number | string; height?: number; dark: boolean }) {
  const base = dark ? '#2a2a2a' : '#e6e6ea'
  const hi = dark ? '#3a3a3a' : '#f2f2f5'
  return (
    <Box
      sx={{
        width,
        height,
        borderRadius: height / 2,
        background: `linear-gradient(90deg, ${base} 25%, ${hi} 37%, ${base} 63%)`,
        backgroundSize: '400% 100%',
        animation: `${shimmer} 1.4s ease infinite`,
      }}
    />
  )
}

export default function DialogSkeleton({ count = 9 }: { count?: number }) {
  const dark = useTheme().palette.mode === 'dark'
  return (
    <Box sx={{ pt: 0.5 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, opacity: 1 - i * 0.06 }}>
          <Bar width={54} height={54} dark={dark} />
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Bar width="45%" dark={dark} />
              <Box sx={{ flex: 1 }} />
              <Bar width={28} height={11} dark={dark} />
            </Box>
            <Bar width="72%" dark={dark} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}
