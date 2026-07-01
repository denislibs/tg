import type { ReactNode } from 'react'
import { Box, useTheme } from '@mui/material'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { slideInRight } from '../../motion'
import TgSwitch from '../TgSwitch'
import { useT } from '../../i18n'

export function useCardBg() {
  return useTheme().palette.mode === 'dark' ? '#2b2b2b' : '#ffffff'
}

/**
 * Telegram outlined input with a floating label — styles matched to tweb's
 * `.input-field` (_input.scss): 16px radius, 48px height, 13px×16px padding,
 * idle border #2f2f2f/#dfe1e5, 2px accent border + bold accent label on focus.
 */
export function useFieldSx() {
  const theme = useTheme()
  const tg = theme.tg
  const idle = theme.palette.mode === 'dark' ? '#2f2f2f' : '#dfe1e5'
  return {
    '& .MuiOutlinedInput-root': {
      borderRadius: '16px',
      minHeight: 48,
      color: tg.textPrimary,
      fontSize: 16,
      '& fieldset': { borderColor: idle, transition: 'border-color .2s' },
      '&:hover fieldset': { borderColor: tg.accent },
      '&.Mui-focused fieldset': { borderColor: tg.accent, borderWidth: '2px' },
    },
    '& .MuiOutlinedInput-input': { padding: '13px 16px' },
    '& .MuiInputLabel-root': { color: tg.textFaint, fontSize: 16 },
    '& .MuiInputLabel-root.Mui-focused': { color: tg.accent, fontWeight: 600 },
  }
}

/** Full-height slide-in settings screen with a back header. */
export function SettingsScreen({
  title,
  onBack,
  headerRight,
  zIndex = 60,
  children,
}: {
  title: string
  onBack: () => void
  headerRight?: ReactNode
  zIndex?: number
  children: ReactNode
}) {
  const tg = useTheme().tg
  const t = useT()
  return (
    <motion.div
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex,
        background: tg.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1.25 }}>
        <IconButton onClick={onBack} color={tg.textSecondary}>
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color={tg.textPrimary} style={{ flex: 1 }}>
          {t(title)}
        </Text>
        {headerRight}
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', pb: 3 }}>{children}</Box>
    </motion.div>
  )
}

export function Section({
  caption,
  footer,
  children,
}: {
  caption?: string
  footer?: string
  children: ReactNode
}) {
  const tg = useTheme().tg
  const t = useT()
  const cardBg = useCardBg()
  return (
    <Box sx={{ mb: 1.5 }}>
      {caption && (
        <Text size={14} weight={600} color={tg.accent} style={{ paddingLeft: '24px', paddingRight: '24px', paddingBottom: '4px' }}>
          {t(caption)}
        </Text>
      )}
      <Box sx={{ mx: 1.25, borderRadius: '16px', background: cardBg, py: 0.5 }}>{children}</Box>
      {footer && (
        <Text size={13.5} color={tg.textSecondary} style={{ paddingLeft: '24px', paddingRight: '24px', paddingTop: '6px' }}>
          {t(footer)}
        </Text>
      )}
    </Box>
  )
}

/** Generic tappable row: icon? + label (+ subtitle) + right value/chevron/toggle/check. */
export function Row({
  icon,
  label,
  sublabel,
  value,
  onClick,
  danger,
  accent,
  chevron,
  toggle,
  checked,
  selected,
  translate = true,
}: {
  icon?: ReactNode
  label: string
  sublabel?: string
  value?: string
  onClick?: () => void
  danger?: boolean
  accent?: boolean
  chevron?: boolean
  toggle?: boolean
  checked?: boolean
  selected?: boolean
  translate?: boolean
}) {
  const tg = useTheme().tg
  const t = useT()
  const color = danger ? '#ff595a' : accent ? tg.accent : tg.textPrimary
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 1.15,
        mx: 0.5,
        borderRadius: '12px',
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { background: tg.hover } : undefined,
      }}
    >
      {icon && (
        <Box sx={{ color: tg.textSecondary, display: 'flex', '& svg': { fontSize: 24 } }}>{icon}</Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Text noWrap size={16} color={color}>
          {translate ? t(label) : label}
        </Text>
        {sublabel && (
          <Text noWrap size={13.5} color={tg.textSecondary}>
            {sublabel}
          </Text>
        )}
      </Box>
      {value != null && (
        <Text size={15} color={tg.textFaint} style={{ flexShrink: 0 }}>{value}</Text>
      )}
      {toggle && <TgSwitch checked={!!checked} />}
      {selected && <TgIcon name="check" size={22} color={tg.accent} />}
      {chevron && <TgIcon name="next" size={22} color={tg.textFaint} />}
    </Box>
  )
}
