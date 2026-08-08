import { useEffect, useMemo, useState } from 'react'
import Text from '../../shared/ui/Text'
import PlayPauseGlyph from '../PlayPauseGlyph'
import { useManagers } from '../../core/hooks/useManagers'
import { useAudioStore, prefetchSecretAudio } from '../../stores/audioStore'
import { useWaveform, WAVE_BARS, decodeTransmittedBars } from '../../core/audio/waveform'
import { Ticks } from './MessageBubbles'
import { useTranscription, TranscribeButton, TranscribedText } from './Transcription'
import classNames from '../../shared/lib/classNames'
import type { MsgStatus } from '../../data'
import type { SecretMedia } from '../../core/models'
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
  msgId,
  chatId,
  transcription,
  secretMedia,
  out,
  time,
  status,
  mediaUnread,
  onPlay,
}: {
  mediaId: number
  /** id сообщения (для транскрибации) — undefined у оптимистичного */
  msgId?: number
  /** id чата (для транскрибации) */
  chatId?: number
  /** кэш расшифровки на сообщении (Telegram transcribeAudio) */
  transcription?: string
  /** секретный чат (E2E): ключ/iv/mime для расшифровки ciphertext'а голоса */
  secretMedia?: SecretMedia
  out: boolean
  time?: string
  status?: MsgStatus
  /** не прослушано получателем — точка после длительности (tweb is-unread) */
  mediaUnread?: boolean
  onPlay: () => void
}) {
  const managers = useManagers()
  const tr = useTranscription(chatId, msgId, transcription)
  const decoded = useWaveform(mediaId, secretMedia ? { keyB64: secretMedia.keyB64, ivB64: secretMedia.ivB64 } : undefined)
  const [metaDur, setMetaDur] = useState(0)
  // Переданные пики (посчитаны при записи, приоритетнее client-recompute);
  // фолбэк — recompute (старые сообщения без пиков / секретный голос).
  const [metaWaveform, setMetaWaveform] = useState('')
  const transmitted = useMemo(() => decodeTransmittedBars(metaWaveform), [metaWaveform])
  const bars = transmitted.length ? transmitted : decoded.length ? decoded : PLACEHOLDER

  const isCurrent = useAudioStore((s) => s.track?.mediaId === mediaId)
  const playing = useAudioStore((s) => s.playing && s.track?.mediaId === mediaId)
  const curTime = useAudioStore((s) => (s.track?.mediaId === mediaId ? s.currentTime : 0))
  const curDur = useAudioStore((s) => (s.track?.mediaId === mediaId ? s.duration : 0))
  const seekFraction = useAudioStore((s) => s.seekFraction)
  const toggle = useAudioStore((s) => s.toggle)

  // Backend-reported duration (recorded length) for the idle display. Для
  // секретного голоса meta бесполезна (сервер видит только ciphertext) —
  // длительность возьмётся из decoded blob при воспроизведении (curDur).
  useEffect(() => {
    if (secretMedia) return
    let alive = true
    void managers.media.meta(mediaId).then((m) => {
      if (!alive) return
      setMetaDur(m.duration || 0)
      setMetaWaveform(m.waveform || '')
    })
    return () => {
      alive = false
    }
  }, [mediaId, managers, secretMedia])

  // Секретный голос: заранее скачиваем+расшифровываем blob, чтобы к клику URL был
  // готов и .play() вызвался в рамках user-gesture (иначе await теряет активацию).
  useEffect(() => {
    if (!secretMedia) return
    void prefetchSecretAudio(mediaId, { keyB64: secretMedia.keyB64, ivB64: secretMedia.ivB64, mime: secretMedia.mime }).catch(() => {})
  }, [mediaId, secretMedia])

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
    <div className={s.wrap}>
      <div className={classNames(s.voice, tr.available ? s.canTranscribe : '')} data-out={out || undefined}>
      <div className={s.playBtn} onClick={handlePlay}>
        <PlayPauseGlyph playing={playing} size={26} className={s.glyph} />
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
          <Text size={14} color="var(--v-dur)">
            {isCurrent ? `${fmt(curTime)} / ${fmt(duration)}` : fmt(duration)}
          </Text>
          {showUnplayedDot && <div className={s.dot} />}
          <div className={s.spacer} />
          {/* время+тик единым кластером (tweb .time-inner: flex, align-center,
              line-height:1). Цвет тика = цвету времени (muted, как tweb
              --message-status-color), не яркий --b-tick (на night белый). */}
          <span className={s.time}>
            {time}
            {out && <Ticks status={status} color="var(--v-time)" />}
          </span>
        </div>
      </div>
      {tr.available && (
        <TranscribeButton
          className={s.transcribe}
          expanded={tr.expanded}
          pending={tr.pending}
          onClick={tr.toggle}
        />
      )}
      </div>
      {tr.expanded && tr.text && <TranscribedText text={tr.text} color="var(--v-dur)" />}
    </div>
  )
}
