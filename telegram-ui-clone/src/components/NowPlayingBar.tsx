import { memo, useState, type ReactNode } from 'react'
import { Box, Menu, MenuItem, Slider, Typography, useTheme } from '@mui/material'
import { withAlpha } from '../core/cssColor'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon, { type IconName } from './TgIcon'
import { useAudioStore } from '../stores/audioStore'

// A round control button with a hover circle + press-scale feedback.
function RoundBtn({
  onClick,
  color,
  active,
  hoverBg,
  label,
  children,
}: {
  onClick: (e: React.MouseEvent<HTMLElement>) => void
  color: string
  active?: boolean
  hoverBg: string
  label: string
  children: ReactNode
}) {
  return (
    <Box
      component={motion.button}
      type="button"
      aria-label={label}
      onClick={onClick}
      whileTap={{ scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      sx={{
        border: 'none',
        p: 0,
        width: 40,
        height: 40,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color,
        background: active ? withAlpha(color, 0.16) : 'transparent',
        transition: 'background .15s',
        '&:hover': { background: active ? withAlpha(color, 0.16) : hoverBg },
      }}
    >
      {children}
    </Box>
  )
}

// The global "now playing" bar — modelled on tweb's `.pinned-container.pinned-audio`:
// a flat surface strip (not a floating pill) with rewind/play/forward, a title +
// thin seek line, and right-side utils (volume slider, speed, close).
// Takes no props and owns its own audio-store subscriptions, so memo() keeps it
// from re-rendering whenever the parent (ConversationView) does — only its own
// store updates (play/seek/time tick) drive it.
function NowPlayingBar() {
  const theme = useTheme()
  const tg = theme.tg
  const track = useAudioStore((s) => s.track)
  const playing = useAudioStore((s) => s.playing)
  const currentTime = useAudioStore((s) => s.currentTime)
  const duration = useAudioStore((s) => s.duration)
  const rate = useAudioStore((s) => s.rate)
  const muted = useAudioStore((s) => s.muted)
  const volume = useAudioStore((s) => s.volume)
  const toggle = useAudioStore((s) => s.toggle)
  const next = useAudioStore((s) => s.next)
  const prev = useAudioStore((s) => s.prev)
  const seekFraction = useAudioStore((s) => s.seekFraction)
  const setRate = useAudioStore((s) => s.setRate)
  const toggleMute = useAudioStore((s) => s.toggleMute)
  const setVolume = useAudioStore((s) => s.setVolume)
  const closePlayer = useAudioStore((s) => s.close)

  const [volOpen, setVolOpen] = useState(false)
  const [rateAnchor, setRateAnchor] = useState<null | HTMLElement>(null)
  const hoverBg = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'
  const frac = duration > 0 ? currentTime / duration : 0
  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }
  const rateLabel = rate === 1 ? '1X' : rate === 1.5 ? '1.5X' : '2X'
  const effVol = muted ? 0 : volume
  const volIconName: IconName = effVol === 0 ? 'volume_off' : effVol < 0.5 ? 'volume_down' : 'volume_up'

  return (
    <AnimatePresence>
      {track && (
        <motion.div
          initial={{ y: -56, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -56, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        >
          <Box
            sx={{
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              height: 48,
              px: 0.5,
              borderRadius: '24px',
              background: tg.bubble,
              boxShadow: theme.palette.mode === 'dark' ? '0 2px 10px rgba(0,0,0,0.4)' : '0 2px 10px rgba(0,0,0,0.12)',
            }}
          >
            <RoundBtn onClick={prev} color={tg.accent} hoverBg={hoverBg} label="prev">
              <TgIcon name="fast_rewind" />
            </RoundBtn>
            <RoundBtn onClick={toggle} color={tg.accent} hoverBg={hoverBg} label="play/pause">
              <Box sx={{ position: 'relative', width: 24, height: 24 }}>
                <AnimatePresence initial={false} mode="popLayout">
                  <Box
                    key={playing ? 'pause' : 'play'}
                    component={motion.span}
                    initial={{ opacity: 0, scale: 0.4, rotate: -45 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.4, rotate: 45 }}
                    transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                    sx={{ position: 'absolute', inset: 0, display: 'flex' }}
                  >
                    {playing ? <TgIcon name="pause" /> : <TgIcon name="play" />}
                  </Box>
                </AnimatePresence>
              </Box>
            </RoundBtn>
            <RoundBtn onClick={next} color={tg.accent} hoverBg={hoverBg} label="next">
              <TgIcon name="fast_forward" />
            </RoundBtn>

            <Box sx={{ flex: 1, minWidth: 0, px: 1.25 }}>
              <Typography noWrap sx={{ fontSize: 15, fontWeight: 600, color: tg.textPrimary, lineHeight: 1.25 }}>
                {track.title}
              </Typography>
              <Typography noWrap sx={{ fontSize: 13, color: tg.textSecondary, lineHeight: 1.25 }}>
                {fmt(currentTime)}
                {track.subtitle ? ` • ${track.subtitle}` : ''}
              </Typography>
            </Box>

            {/* volume with a vertical slider popup (hover/focus) */}
            <Box
              sx={{ position: 'relative', display: 'flex' }}
              onMouseEnter={() => setVolOpen(true)}
              onMouseLeave={() => setVolOpen(false)}
            >
              <RoundBtn onClick={toggleMute} color={volOpen ? tg.accent : tg.textSecondary} active={volOpen} hoverBg={hoverBg} label="volume">
                <TgIcon name={volIconName} />
              </RoundBtn>
              <AnimatePresence>
                {volOpen && (
                  <Box
                    component={motion.div}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.14 }}
                    sx={{
                      position: 'absolute',
                      top: '100%',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      mt: 0.5,
                      py: 1.5,
                      width: 36,
                      height: 120,
                      borderRadius: '18px',
                      background: tg.bubble,
                      boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 40,
                    }}
                  >
                    <Slider
                      orientation="vertical"
                      min={0}
                      max={1}
                      step={0.01}
                      value={effVol}
                      onChange={(_, v) => setVolume(v as number)}
                      sx={{
                        color: tg.accent,
                        '& .MuiSlider-rail': { width: 4, opacity: 0.3 },
                        '& .MuiSlider-track': { width: 4, border: 'none' },
                        '& .MuiSlider-thumb': { width: 14, height: 14, '&:hover, &.Mui-focusVisible': { boxShadow: `0 0 0 6px ${withAlpha(tg.accent, 0.16)}` } },
                      }}
                    />
                  </Box>
                )}
              </AnimatePresence>
            </Box>

            <Box
              component={motion.button}
              type="button"
              onClick={(e: React.MouseEvent<HTMLElement>) => setRateAnchor(e.currentTarget)}
              whileTap={{ scale: 0.9 }}
              sx={{ border: 'none', px: 1, py: 0.5, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: rateAnchor ? tg.accent : tg.textSecondary, userSelect: 'none', borderRadius: '10px', background: rateAnchor ? withAlpha(tg.accent, 0.16) : 'transparent', '&:hover': { background: rateAnchor ? withAlpha(tg.accent, 0.16) : hoverBg } }}
            >
              {rateLabel}
            </Box>
            <Menu
              anchorEl={rateAnchor}
              open={!!rateAnchor}
              onClose={() => setRateAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              slotProps={{ paper: { sx: { background: tg.bubble, borderRadius: '12px', minWidth: 96 } } }}
            >
              {[0.5, 1, 1.5, 2].map((r) => (
                <MenuItem
                  key={r}
                  selected={rate === r}
                  onClick={() => { setRate(r); setRateAnchor(null) }}
                  sx={{ fontSize: 15, fontWeight: 600, color: rate === r ? tg.accent : tg.textPrimary }}
                >
                  {r}x
                </MenuItem>
              ))}
            </Menu>
            <RoundBtn onClick={closePlayer} color={tg.textSecondary} hoverBg={hoverBg} label="close">
              <TgIcon name="close" />
            </RoundBtn>

            {/* progress line along the bottom of the plate (tweb) */}
            <Box
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                seekFraction((e.clientX - r.left) / r.width)
              }}
              sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: tg.hover, cursor: 'pointer' }}
            >
              <Box sx={{ width: `${Math.round(frac * 100)}%`, height: '100%', background: tg.accent }} />
            </Box>
          </Box>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default memo(NowPlayingBar)
