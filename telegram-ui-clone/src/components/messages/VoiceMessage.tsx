import { useEffect, useState } from 'react'
import Text from '../../shared/ui/Text'
import PlayPauseGlyph from '../PlayPauseGlyph'
import { useManagers } from '../../core/hooks/useManagers'
import { useAudioStore } from '../../stores/audioStore'
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
  mediaUnread,
  tickColor,
  onPlay,
}: {
  mediaId: number
  out: boolean
  time?: string
  status?: MsgStatus
  /** не прослушано получателем — точка после длительности (tweb is-unread) */
  mediaUnread?: boolean
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
    else onPlay() // снятие media_unread — в playVoice (useVoiceQueue)
  }
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isCurrent) {
      const r = e.currentTarget.getBoundingClientRect()
      seekFraction((e.clientX - r.left) / r.width)
    } else {
      handlePlay() // clicking the waveform of an idle message starts it
    }
  }

  // tweb показывает точку обеим сторонам: у получателя — «не прослушал я»,
  // у отправителя — «не прослушал собеседник» (гаснет по media_read).
  const showUnplayedDot = !!mediaUnread

  return (
    <div className={s.voice} data-out={out || undefined}>
      <div className={s.playBtn} onClick={handlePlay}>
        <PlayPauseGlyph playing={playing} className={s.glyph} />
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
