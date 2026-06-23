import { useLayoutEffect, useRef, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { useT } from '../i18n'

export type FolderKey = 'all' | 'private' | 'groups' | 'channels'

export default function FolderTabs({
  value,
  onChange,
}: {
  value: FolderKey
  onChange: (k: FolderKey) => void
}) {
  const tg = useTheme().tg
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Partial<Record<FolderKey, HTMLDivElement | null>>>({})
  // the active pill — measured from the active tab so it only slides horizontally
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false })

  const tabs: { key: FolderKey; label: string }[] = [
    { key: 'all', label: t('All Chats') },
    { key: 'private', label: t('Private') },
    { key: 'groups', label: t('Groups') },
    { key: 'channels', label: t('Channels') },
  ]

  // measure before paint so the indicator is correct on first render and then
  // animates only its left/width (no vertical jump), and scroll it into view
  useLayoutEffect(() => {
    const c = scrollRef.current
    const el = tabRefs.current[value]
    if (!c || !el) return
    setPill({ left: el.offsetLeft, width: el.offsetWidth, ready: true })
    c.scrollTo({ left: Math.max(0, el.offsetLeft - (c.clientWidth - el.offsetWidth) / 2), behavior: 'smooth' })
  }, [value, t])

  return (
    <Box
      ref={scrollRef}
      sx={{
        display: 'flex',
        gap: '4px',
        px: 1,
        py: 0.75,
        flexShrink: 0,
        position: 'relative',
        overflowX: 'auto',
        '&::-webkit-scrollbar': { display: 'none' },
        scrollbarWidth: 'none',
      }}
    >
      {/* sliding active-tab indicator (horizontal only) */}
      <Box
        sx={{
          position: 'absolute',
          top: 6,
          bottom: 6,
          left: pill.left,
          width: pill.width,
          borderRadius: '20px',
          background: 'rgba(135,116,225,0.18)',
          opacity: pill.ready ? 1 : 0,
          transition: 'left .25s cubic-bezier(.4,0,.2,1), width .25s cubic-bezier(.4,0,.2,1)',
          pointerEvents: 'none',
        }}
      />
      {tabs.map(({ key, label }) => {
        const active = key === value
        return (
          <Box
            key={key}
            ref={(el: HTMLDivElement | null) => {
              tabRefs.current[key] = el
            }}
            onClick={() => onChange(key)}
            sx={{
              position: 'relative',
              flexShrink: 0,
              padding: '6px 16px',
              borderRadius: '20px',
              cursor: 'pointer',
              color: active ? tg.accent : tg.textSecondary,
              transition: 'color 0.2s',
            }}
          >
            <Typography
              component="span"
              sx={{ position: 'relative', fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' }}
            >
              {label}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}
