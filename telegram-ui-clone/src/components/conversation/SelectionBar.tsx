// src/components/conversation/SelectionBar.tsx
// The bottom action bar shown in multi-select mode (count + forward + delete).
// Replaces the composer while messages are selected.
import { memo } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'

export interface SelectionBarProps {
  count: number
  onClear: () => void
  onForward: () => void
  onDelete: () => void
}

function SelectionBar({ count, onClear, onForward, onDelete }: SelectionBarProps) {
  const theme = useTheme()
  const tg = theme.tg
  const mode = theme.palette.mode
  const t = useT()

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: '16px',
        left: 0,
        right: 0,
        zIndex: 6,
        width: '100%',
        maxWidth: 688,
        mx: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        height: 56,
        borderRadius: '24px',
        background: tg.bubble,
        boxShadow: mode === 'dark' ? '0 1px 8px 1px rgba(0,0,0,0.35)' : '0 1px 8px 1px rgba(0,0,0,0.12)',
      }}
    >
      <IconButton onClick={onClear} color={tg.textSecondary}>
        <TgIcon name="close" />
      </IconButton>
      <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 600, color: tg.textPrimary }}>
        {t('Selected')}: {count}
      </Typography>
      <IconButton onClick={onForward} color={tg.accent}>
        <TgIcon name="reply" style={{ transform: 'scaleX(-1)' }} />
      </IconButton>
      <IconButton onClick={onDelete} color="#ff595a">
        <TgIcon name="delete" />
      </IconButton>
    </Box>
  )
}

export default memo(SelectionBar)
