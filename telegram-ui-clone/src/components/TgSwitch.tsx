import { Box, useTheme } from '@mui/material'

/**
 * Telegram-style toggle, 1:1 with tweb's .checkbox-field-toggle:
 * track 31x14 (pill), 20px round thumb in surface-color with a 2px border that
 * matches the track colour (grey off / accent on), thumb overhangs the track by
 * the 3px offset on each side.
 */
const TRACK_W = 31
const TRACK_H = 14
const THUMB = 20
const OFFSET = 3
const CONTAINER_W = TRACK_W + OFFSET * 2 // 37

export default function TgSwitch({
  checked,
  onClick,
}: {
  checked: boolean
  onClick?: (e: React.MouseEvent) => void
}) {
  const theme = useTheme()
  const tg = theme.tg
  const off = theme.palette.mode === 'dark' ? '#707579' : '#c4c9cc'
  const lineColor = checked ? tg.accent : off

  return (
    <Box
      onClick={onClick}
      sx={{ position: 'relative', width: CONTAINER_W, height: THUMB, flexShrink: 0, cursor: 'pointer' }}
    >
      {/* track */}
      <Box
        sx={{
          position: 'absolute',
          top: (THUMB - TRACK_H) / 2,
          left: OFFSET,
          width: TRACK_W,
          height: TRACK_H,
          borderRadius: TRACK_H / 2,
          background: lineColor,
          transition: 'background-color .1s ease',
        }}
      />
      {/* thumb */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: checked ? CONTAINER_W - THUMB : 0,
          width: THUMB,
          height: THUMB,
          boxSizing: 'border-box',
          borderRadius: '50%',
          background: tg.sidebarBg,
          border: `2px solid ${lineColor}`,
          transition: 'left .14s cubic-bezier(.22,.75,.7,1.3), border-color .1s ease',
        }}
      />
    </Box>
  )
}
