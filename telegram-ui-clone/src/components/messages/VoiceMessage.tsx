import { useEffect, useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { withAlpha } from '../../core/cssColor'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useAudioStore } from '../../stores/audioStore'
import { useVoicePlayed } from '../../stores/voicePlayedStore'
import { useWaveform, WAVE_BARS } from '../../core/audio/waveform'
import { Ticks } from './MessageBubbles'
import type { MsgStatus } from '../../data'

// A flat placeholder shown until the real waveform is decoded.
const PLACEHOLDER = Array.from({ length: WAVE_BARS }, () => 0.25)

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function VoiceMessage({
  mediaId,
  out,
  time,
  status,
  msgId,
  tickColor,
  onPlay,
}: {
  mediaId: number
  out: boolean
  time?: string
  status?: MsgStatus
  msgId?: number
  tickColor: string
  onPlay: () => void
}) {
  const managers = useManagers()
  const tg = useTheme().tg
  const decoded = useWaveform(mediaId)
  const bars = decoded.length ? decoded : PLACEHOLDER
  const [metaDur, setMetaDur] = useState(0)

  const isCurrent = useAudioStore((s) => s.track?.mediaId === mediaId)
  const playing = useAudioStore((s) => s.playing && s.track?.mediaId === mediaId)
  const curTime = useAudioStore((s) => (s.track?.mediaId === mediaId ? s.currentTime : 0))
  const curDur = useAudioStore((s) => (s.track?.mediaId === mediaId ? s.duration : 0))
  const seekFraction = useAudioStore((s) => s.seekFraction)
  const toggle = useAudioStore((s) => s.toggle)

  const played = useVoicePlayed((s) => !!(msgId != null && s.played[msgId]))
  const markPlayed = useVoicePlayed((s) => s.mark)

  // Backend-reported duration (recorded length) for the idle display.
  useEffect(() => {
    let alive = true
    void managers.media.meta(mediaId).then((m) => {
      if (alive) setMetaDur(m.duration || 0)
    })
    return () => {
      alive = false
    }
  }, [mediaId, managers])

  const duration = isCurrent && curDur ? curDur : metaDur
  const progress = isCurrent && duration ? curTime / duration : 0

  const handlePlay = () => {
    if (isCurrent) toggle()
    else {
      if (!out && msgId != null) markPlayed(msgId)
      onPlay()
    }
  }
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isCurrent) {
      const r = e.currentTarget.getBoundingClientRect()
      seekFraction((e.clientX - r.left) / r.width)
    } else {
      handlePlay() // clicking the waveform of an idle message starts it
    }
  }

  // On the light-tinted out bubble, the play/waveform use the saturated accent
  // (bubbleOutText); incoming uses the accent on the grey bubble.
  const accentOnBubble = out ? tg.bubbleOutAccent : tg.accent
  const onBg = accentOnBubble
  const offBg = out ? withAlpha(tg.bubbleOutAccent, 0.3) : tg.textFaint
  const showUnplayedDot = !out && msgId != null && !played

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 1, minWidth: 200 }}>
      <Box
        onClick={handlePlay}
        sx={{
          position: 'relative',
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // saturated accent circle with a white glyph on both light-tint
          // (out) and grey (in) bubbles (tweb).
          background: accentOnBubble,
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        {/* play ↔ pause morph (tweb cross-fades + rotates the glyph) */}
        <AnimatePresence initial={false} mode="popLayout">
          <Box
            key={playing ? 'pause' : 'play'}
            component={motion.span}
            initial={{ opacity: 0, scale: 0.4, rotate: -45 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.4, rotate: 45 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            sx={{ position: 'absolute', display: 'flex' }}
          >
            {playing ? <TgIcon name="pause" /> : <TgIcon name="play" />}
          </Box>
        </AnimatePresence>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          onClick={handleSeek}
          sx={{ display: 'flex', alignItems: 'center', gap: '2px', height: 24, cursor: isCurrent ? 'pointer' : 'default' }}
        >
          {bars.map((h, i) => (
            <Box
              key={i}
              sx={{
                width: '3px',
                flexShrink: 0,
                borderRadius: '2px',
                height: `${Math.round(5 + h * 18)}px`,
                background: i / bars.length <= progress ? onBg : offBg,
              }}
            />
          ))}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
          <Typography sx={{ fontSize: 12.5, color: out ? tg.bubbleOutText : tg.textSecondary }}>
            {isCurrent ? `${fmt(curTime)} / ${fmt(duration)}` : fmt(duration)}
          </Typography>
          {showUnplayedDot && (
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', background: tg.accent, flexShrink: 0 }} />
          )}
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: out ? withAlpha(tg.bubbleOutText, 0.7) : tg.textFaint }}>
            {time}
          </Typography>
          {out && <Ticks status={status} color={tickColor} />}
        </Box>
      </Box>
    </Box>
  )
}
