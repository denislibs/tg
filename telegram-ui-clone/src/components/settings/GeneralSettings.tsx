import { useState } from 'react'
import { Box, Slider, Typography, useTheme } from '@mui/material'
import { AnimatePresence } from 'framer-motion'
import WallpaperRounded from '@mui/icons-material/WallpaperRounded'
import BatterySaverRounded from '@mui/icons-material/BatterySaverRounded'
import TgIcon from '../TgIcon'
import patternUrl from '../../assets/pattern.svg'
import { useT } from '../../i18n'
import { useSettings } from '../../settings'
import { type ThemeChoice, type ThemePreset } from '../../theme'
import { SettingsScreen, Section, Row, useCardBg } from './kit'
import ChatWallpaper from './ChatWallpaper'
import PowerSaving from './PowerSaving'

const THEME_CARDS: { preset: ThemePreset; emoji: string; colors: [string, string, string, string]; accent: string }[] = [
  { preset: 'classic', emoji: '🏠', colors: ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'], accent: '#7d63e8' },
  { preset: 'day', emoji: '🐤', colors: ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'], accent: '#3390ec' },
  { preset: 'night', emoji: '⛄', colors: ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5'], accent: '#8774e1' },
  { preset: 'dark', emoji: '💎', colors: ['#4a5a6a', '#2e3a48', '#3a4654', '#28323e'], accent: '#5ea7e8' },
]

const THEME_RADIOS: { choice: ThemeChoice; label: string }[] = [
  { choice: 'classic', label: 'Classic' },
  { choice: 'night', label: 'Night' },
  { choice: 'day', label: 'Day' },
  { choice: 'dark', label: 'Tinted' },
  { choice: 'system', label: 'System' },
]

function RadioRow({
  label,
  sublabel,
  selected,
  onClick,
}: {
  label: string
  sublabel?: string
  selected: boolean
  onClick: () => void
}) {
  const tg = useTheme().tg
  const t = useT()
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 1.05,
        mx: 0.5,
        borderRadius: '12px',
        cursor: 'pointer',
        '&:hover': { background: tg.hover },
      }}
    >
      {selected ? (
        <TgIcon name="radioon" color={tg.accent} />
      ) : (
        <TgIcon name="radiooff" color={tg.textFaint} />
      )}
      <Box>
        <Typography sx={{ fontSize: 16, color: tg.textPrimary }}>{t(label)}</Typography>
        {sublabel && <Typography sx={{ fontSize: 13, color: tg.textSecondary }}>{sublabel}</Typography>}
      </Box>
    </Box>
  )
}

export default function GeneralSettings({ onBack }: { onBack: () => void }) {
  const tg = useTheme().tg
  const t = useT()
  const cardBg = useCardBg()
  const { textSize, timeFormat, themeChoice, update } = useSettings()
  const [dedicated, setDedicated] = useState<'wallpaper' | 'power' | null>(null)

  return (
    <SettingsScreen title="General Settings" onBack={onBack}>
      {/* Settings: text size + wallpaper + power saving */}
      <Section caption="Settings">
        <Box sx={{ px: 2, pt: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography sx={{ fontSize: 16, color: tg.textPrimary }}>{t('Message Text Size')}</Typography>
            <Typography sx={{ fontSize: 16, color: tg.textFaint }}>{textSize}</Typography>
          </Box>
          <Slider
            value={textSize}
            min={12}
            max={24}
            step={1}
            onChange={(_, v) => update({ textSize: v as number })}
            sx={{
              color: tg.accent,
              mt: 0.5,
              '& .MuiSlider-thumb': { width: 18, height: 18 },
            }}
          />
        </Box>
        <Row
          icon={<WallpaperRounded />}
          label="Chat Background"
          chevron
          onClick={() => setDedicated('wallpaper')}
        />
        <Row
          icon={<BatterySaverRounded />}
          label="Power Saving"
          value={t('Disabled')}
          onClick={() => setDedicated('power')}
        />
      </Section>

      {/* Color theme */}
      <Section caption="Color Theme">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 1,
            px: 1.5,
            pt: 1,
            pb: 0.5,
          }}
        >
          {THEME_CARDS.map((c) => {
            const selected = themeChoice === c.preset
            return (
              <Box
                key={c.preset}
                onClick={() => update({ themeChoice: c.preset })}
                sx={{
                  aspectRatio: '3 / 4',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  p: '4px',
                  border: `2px solid ${selected ? c.accent : 'transparent'}`,
                  transition: 'border-color .15s',
                }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    height: '100%',
                    borderRadius: '9px',
                    overflow: 'hidden',
                    background: `linear-gradient(150deg, ${c.colors[0]}, ${c.colors[1]}, ${c.colors[2]}, ${c.colors[3]})`,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    p: 0.75,
                  }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      backgroundImage: `url("${patternUrl}")`,
                      backgroundSize: '120px',
                      mixBlendMode: 'overlay',
                      opacity: 0.5,
                    }}
                  />
                  {/* incoming + outgoing mini bubbles */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', zIndex: 1 }}>
                    <Box sx={{ width: '70%', height: 11, borderRadius: '6px', background: 'rgba(0,0,0,0.28)' }} />
                    <Box
                      sx={{
                        alignSelf: 'flex-end',
                        width: '55%',
                        height: 11,
                        borderRadius: '6px',
                        background: c.accent,
                      }}
                    />
                  </Box>
                  <Typography sx={{ fontSize: 16, lineHeight: 1, zIndex: 1 }}>{c.emoji}</Typography>
                </Box>
              </Box>
            )
          })}
        </Box>
        <Box sx={{ borderRadius: '12px', background: cardBg }}>
          {THEME_RADIOS.map((r) => (
            <RadioRow
              key={r.choice}
              label={r.label}
              selected={themeChoice === r.choice}
              onClick={() => update({ themeChoice: r.choice })}
            />
          ))}
        </Box>
      </Section>

      {/* Time format */}
      <Section caption="Time Format">
        <RadioRow
          label="12-hour"
          sublabel="10:00 PM"
          selected={timeFormat === '12h'}
          onClick={() => update({ timeFormat: '12h' })}
        />
        <RadioRow
          label="24-hour"
          sublabel="22:00"
          selected={timeFormat === '24h'}
          onClick={() => update({ timeFormat: '24h' })}
        />
      </Section>

      <AnimatePresence>
        {dedicated === 'wallpaper' && <ChatWallpaper onBack={() => setDedicated(null)} />}
        {dedicated === 'power' && <PowerSaving onBack={() => setDedicated(null)} />}
      </AnimatePresence>
    </SettingsScreen>
  )
}
