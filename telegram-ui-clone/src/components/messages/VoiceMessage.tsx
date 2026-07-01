import { useEffect, useState } from 'react'
import Text from '../../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useAudioStore } from '../../stores/audioStore'
import { useVoicePlayed } from '../../stores/voicePlayedStore'
import { useWaveform, WAVE_BARS } from '../../core/audio/waveform'
import { Ticks } from './MessageBubbles'
import type { MsgStatus } from '../../data'
import s from './VoiceMessage.module.scss'

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

  const showUnplayedDot = !out && msgId != null && !played

  return (
    <div className={s.voice} data-out={out || undefined}>
      <div className={s.playBtn} onClick={handlePlay}>
        {/* play ↔ pause morph (tweb cross-fades + rotates the glyph) */}
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={playing ? 'pause' : 'play'}
            className={s.glyph}
            initial={{ opacity: 0, scale: 0.4, rotate: -45 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.4, rotate: 45 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            {playing ? <TgIcon name="pause" /> : <TgIcon name="play" />}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className={s.body}>
        <div
          className={s.wave}
          onClick={handleSeek}
          style={{ cursor: isCurrent ? 'pointer' : 'default' }}
        >
          {bars.map((h, i) => (
            <div
              key={i}
              className={s.waveBar}
              style={{
                height: `${Math.round(5 + h * 18)}px`,
                background: i / bars.length <= progress ? 'var(--v-accent)' : 'var(--v-off)',
              }}
            />
          ))}
        </div>
        <div className={s.meta}>
          <Text size={12.5} color="var(--v-dur)">
            {isCurrent ? `${fmt(curTime)} / ${fmt(duration)}` : fmt(duration)}
          </Text>
          {showUnplayedDot && <div className={s.dot} />}
          <div className={s.spacer} />
          <Text size={12} color="var(--v-time)">
            {time}
          </Text>
          {out && <Ticks status={status} color={tickColor} />}
        </div>
      </div>
    </div>
  )
}
