// src/components/messages/bubbleParts/mediaBubbles.tsx
// Медиа-баблы: документ/файл, аудио, видео-кружок (превью и «настоящий» со звуком).
import { useRef, useState } from 'react'
import Text from '../../../shared/ui/Text'
import classNames from '../../../shared/lib/classNames'
import TgIcon from '../../TgIcon'
import { mediaContentUrl } from '../../../core/mediaUrl'
import { useTimeFormatter } from '../../../settings'
import type { ConvMsg } from '../../../data'
import { useTranscription, TranscribeButton, TranscribedText } from '../Transcription'
import { Ticks, BubbleTail, bubbleRadius, type Ctx } from './primitives'
import s from '../MessageBubbles.module.scss'

/** document / file */
export function DocumentBubble({ m, out, firstInGroup, lastInGroup }: Ctx) {
  const fmtTime = useTimeFormatter()
  const d = m.document
  return (
    <div
      className={classNames(s.fileBubble, s.doc)}
      data-out={out || undefined}
      style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}
    >
      {lastInGroup && <BubbleTail out={out} color="var(--bb-bg)" />}
      <div
        className={s.fileIcon}
        style={{ background: out ? 'rgba(255,255,255,0.22)' : d?.color ?? 'var(--tg-accent)' }}
      >
        <TgIcon name="download" />
      </div>
      <div className={s.fileBody}>
        <Text noWrap size={15} weight={500}>
          {d?.name}
        </Text>
        <div className={s.fileMetaRow}>
          <Text size={13} color="var(--bb-sub)">
            {d?.size} · {d?.ext}
          </Text>
          <div className={s.spacer} />
          <Text size={12} color="var(--bb-meta)">
            {fmtTime(m.time)}
          </Text>
          <Ticks status={m.status} color="var(--bb-tick)" />
        </div>
      </div>
    </div>
  )
}

/** audio / music */
export function AudioBubble({ m, out, firstInGroup, lastInGroup }: Ctx) {
  const fmtTime = useTimeFormatter()
  const a = m.audio
  return (
    <div
      className={classNames(s.fileBubble, s.audio)}
      data-out={out || undefined}
      style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}
    >
      {lastInGroup && <BubbleTail out={out} color="var(--bb-bg)" />}
      <div
        className={classNames(s.fileIcon, s.fileIconAudio)}
        style={{ background: out ? 'rgba(255,255,255,0.22)' : 'var(--tg-accent)' }}
      >
        <TgIcon name="music" />
      </div>
      <div className={s.fileBody}>
        <Text noWrap size={15} weight={500}>
          {a?.title}
        </Text>
        <Text noWrap size={13} color="var(--bb-sub)">
          {a?.artist}
        </Text>
        <div className={s.fileMetaRow} style={{ marginTop: 2 }}>
          <Text size={12} color="var(--bb-meta)">
            {a?.duration}
          </Text>
          <div className={s.spacer} />
          <Text size={12} color="var(--bb-meta)">
            {fmtTime(m.time)}
          </Text>
          <Ticks status={m.status} color="var(--bb-tick)" />
        </div>
      </div>
    </div>
  )
}

/** round video note (превью) */
export function RoundVideoBubble({ m, out }: Ctx) {
  const fmtTime = useTimeFormatter()
  return (
    <div className={s.round} data-out={out || undefined}>
      <div className={s.roundInner}>
        <div className={s.roundDisc} style={{ background: m.media?.gradient ?? 'var(--tg-accentGradient)' }}>
          <Text size={72} style={{ userSelect: 'none' }}>{m.media?.emoji ?? '🎥'}</Text>
        </div>
        {/* progress ring */}
        <svg className={s.roundRing} viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="97" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
          <circle
            cx="100"
            cy="100"
            r="97"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 97}
            strokeDashoffset={2 * Math.PI * 97 * 0.7}
          />
        </svg>
        <div className={s.roundDur}>{m.videoDuration ?? '0:08'}</div>
      </div>
      <div className={s.roundMeta}>
        <Text size={12} color="var(--tg-textFaint)">{fmtTime(m.time)}</Text>
        <Ticks status={m.status} color="var(--tg-textFaint)" />
      </div>
    </div>
  )
}

/**
 * Настоящий видео-кружок (tweb wrappers/video.ts, doc.type === 'round'): без клика
 * крутится muted-превью в цикле; клик — воспроизведение со звуком с начала (кольцо
 * прогресса + остаток), повторный клик — пауза. Белая точка — media_unread, гаснет
 * на первом timeupdate со звуком (tweb readMessages).
 */
export function RoundVideoRealBubble({ m, onPlayed, onSoundPlay }: { m: ConvMsg; onPlayed?: () => void; onSoundPlay?: (el: HTMLVideoElement) => void }) {
  const fmtTime = useTimeFormatter()
  const ref = useRef<HTMLVideoElement>(null)
  const [sound, setSound] = useState(false)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1, только в sound-режиме
  const [left, setLeft] = useState<number | null>(null)
  const reported = useRef(false)
  const dur = m.mediaDuration ?? 0
  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (!sound) {
      v.muted = false
      v.loop = false
      v.currentTime = 0
      void v.play()
      setSound(true)
      setPaused(false)
      onSoundPlay?.(v)
    } else if (v.paused) {
      void v.play()
      setPaused(false)
      onSoundPlay?.(v) // ре-аттач, если плашку успели закрыть
    } else {
      v.pause()
      setPaused(true)
    }
  }
  const onPauseEvt = () => { if (sound) setPaused(true) }
  const onPlayEvt = () => { if (sound) setPaused(false) }
  const onTime = () => {
    const v = ref.current
    if (!v || !sound) return
    if (!reported.current && !m.out && m.mediaUnread) {
      reported.current = true
      onPlayed?.()
    }
    const total = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : dur
    if (total > 0) {
      setProgress(v.currentTime / total)
      setLeft(Math.max(0, Math.ceil(total - v.currentTime)))
    }
  }
  const onEnded = () => {
    const v = ref.current
    setSound(false)
    setPaused(false)
    setProgress(0)
    setLeft(null)
    if (v) {
      v.muted = true
      v.loop = true
      v.currentTime = 0
      void v.play()
    }
  }
  const tr = useTranscription(m.chatId, m.id, m.transcription)
  const fmt = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`
  const badge = sound && left != null ? fmt(left) : fmt(Math.round(dur))
  const noSound = !sound || paused
  const C = 2 * Math.PI * 49
  return (
    <div className={s.roundReal} data-out={m.out || undefined}>
      <div className={s.roundRealDisc} onClick={toggle}>
        <video
          ref={ref}
          className={s.roundRealVideo}
          src={m.mediaId != null ? mediaContentUrl(m.mediaId) : undefined}
          playsInline
          muted
          loop
          autoPlay
          onTimeUpdate={onTime}
          onEnded={onEnded}
          onPause={onPauseEvt}
          onPlay={onPlayEvt}
        />
        {progress > 0 && (
          <svg className={s.roundRealRing} viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="49" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 50 50)"
            />
          </svg>
        )}
        {/* бейдж (tweb .video-time): остаток/длительность + nosound + точка unread */}
        <div className={s.roundRealBadge}>
          {badge}
          {noSound && <TgIcon name="nosound" size={16} style={{ verticalAlign: '-3px', marginLeft: 2 }} />}
          {m.mediaUnread && <span className={s.roundRealDot} />}
        </div>
        {/* время + галочки — внутри круга снизу (tweb) */}
        <div className={s.roundRealMeta}>
          <Text size={12} color="#fff">{fmtTime(m.time)}</Text>
          {m.out && <Ticks status={m.status} color="#fff" />}
        </div>
      </div>
      {tr.available && (
        <div className={s.roundRealTranscribe}>
          <TranscribeButton expanded={tr.expanded} pending={tr.pending} onClick={tr.toggle} />
        </div>
      )}
      {tr.expanded && tr.text && <TranscribedText text={tr.text} />}
    </div>
  )
}
