import { useEffect, useMemo, useState, type ReactNode } from 'react'
import AudioPlayIcon from './AudioPlayIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useAudioStore, prefetchSecretAudio } from '../../stores/audioStore'
import {
  useWaveform,
  decodeTransmittedPeaks,
  buildWaveformBars,
  WAVEFORM_BAR_WIDTH,
  WAVEFORM_BAR_MARGIN,
  WAVEFORM_HEIGHT,
} from '../../core/audio/waveform'
import { useTranscription, TranscribeButton, TranscribedText } from './Transcription'
import classNames from '../../shared/lib/classNames'
import type { SecretMedia } from '../../core/models'

// Пока пики не приехали — ровная «тихая» волна (пики 0..31, здесь минимум).
const PLACEHOLDER_PEAKS = Array.from({ length: 100 }, () => 4)

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
  /** узел времени бабла (tweb `.audio .time` — абсолютом в нижний угол) */
  time?: ReactNode
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
  const transmitted = useMemo(() => decodeTransmittedPeaks(metaWaveform), [metaWaveform])

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
  // Высоты баров в пикселях — порт tweb createWaveformBars: и число баров, и
  // нормировка зависят от записи, поэтому считается после duration.
  const wave = useMemo(() => {
    // recompute-фолбэк отдаёт 0..1 — приводим к шкале пиков 0..31
    const src = transmitted.length
      ? transmitted
      : decoded.length
        ? decoded.map((v) => Math.round(v * 31))
        : PLACEHOLDER_PEAKS
    return buildWaveformBars(src, duration)
  }, [transmitted, decoded, duration])

  // SVG-волна 1:1 tweb (createWaveformBars): бары — <rect> с y = высота
  // контейнера − высота бара, то есть выровнены по НИЗУ, а не по центру.
  const waveSvg = (
    <svg
      className="audio-waveform-bars"
      width={wave.width}
      height={WAVEFORM_HEIGHT}
      viewBox={`0 0 ${wave.width} ${WAVEFORM_HEIGHT}`}
    >
      {wave.bars.map((h, i) => (
        <rect
          key={i}
          className="audio-waveform-bar"
          x={i * (WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_MARGIN)}
          y={WAVEFORM_HEIGHT - h}
          width={WAVEFORM_BAR_WIDTH}
          height={h}
          rx={1}
          ry={1}
        />
      ))}
    </svg>
  )

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

  // Дерево tweb (живой DOM §3, голосовое mid 21397 + _audio.scss):
  //   audio-element.audio.is-voice[.is-out][.is-unread][.can-transcribe]
  //     div.audio-toggle.audio-ico[.playing] > div.audio-play-icon > .part.one/.two
  //     div.audio-waveform-container > .audio-waveform-background + .audio-waveform-fake
  //     div.audio-time
  //     div.audio-to-text-button
  //     span.time + span.clearfix
  // Кастомный тег audio-element — как в оригинале (в tweb это web-component;
  // у нас поведение на React, но имя узла держим, чтобы совпадали селекторы).
  return (
    <audio-element
      class={classNames(
        'audio',
        'is-voice',
        out ? 'is-out' : '',
        showUnplayedDot ? 'is-unread' : '',
        tr.available ? 'can-transcribe' : '',
      )}
    >
      <div className={classNames('audio-toggle', 'audio-ico', playing ? 'playing' : '')} onClick={handlePlay}>
        <AudioPlayIcon />
      </div>
      {/* tweb: два одинаковых SVG — фоновый (полупрозрачный) и его клон,
          обрезаемый по ширине = прогрессу воспроизведения */}
      <div
        className="audio-waveform-container"
        onClick={handleSeek}
        style={{ cursor: isCurrent ? 'pointer' : 'default' }}
      >
        <div className="audio-waveform audio-waveform-background">{waveSvg}</div>
        <div className="audio-waveform audio-waveform-fake" style={{ width: `${progress * 100}%` }}>
          {waveSvg}
        </div>
      </div>
      <div className="audio-time">
        {isCurrent && curTime > 0 && curTime !== duration
          ? `${fmt(curTime)} / ${fmt(duration)}`
          : fmt(duration)}
      </div>
      {tr.available && (
        <TranscribeButton expanded={tr.expanded} pending={tr.pending} onClick={tr.toggle} />
      )}
      {time}
      <span className="clearfix" />
      {tr.expanded && tr.text && <TranscribedText text={tr.text} />}
    </audio-element>
  )
}
