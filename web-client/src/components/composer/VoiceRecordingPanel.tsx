// src/components/composer/VoiceRecordingPanel.tsx
// Панель записи голоса/кружка — порт tweb
// `components/chat/voiceRecording/voiceRecordingPanel.ts` (дерево :60-122).
//
// Главное: это НЕ ветка рендера, а ОВЕРЛЕЙ. Узел живёт в `.new-message-wrapper`
// всегда (chatRecording.ts:112 — insertBefore перед `.btn-send-container`) и
// накрывает строку ввода собой: `position:absolute; inset:0;
// inset-inline-end: calc(--chat-input-height + .5rem)` (_voiceRecordingPanel.scss:7-22),
// оставляя открытой кнопку отправки. Видимость даёт `.chat-input.is-recording`
// (:167-174) — класс вешает композер на предка.
//
// Условных узлов внутри нет вообще: пауза/проигрывание переключаются классами
// `--paused` / `--playing` (voiceRecordingPanel.ts:126-127, :140).
import { useEffect, useRef } from 'react'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { drawWaveform } from './liveWaveform'
import { fmtDur, type VoiceRecorder } from '../../core/hooks/useVoiceRecorder'

// chatRecording.ts:741-745 — `toHHMMSS(seconds) + ',' + сотые (две цифры)`.
function formatRecordingTimer(elapsedMs: number): string {
  const secs = Math.floor(elapsedMs / 1000)
  return `${fmtDur(secs)},${`00${Math.round((elapsedMs % 1000) / 10)}`.slice(-2)}`
}

interface Props {
  rec: VoiceRecorder
  /** отмена записи — «корзина» (chatRecording.onCancelRecordClick, :317-329) */
  onCancel: () => void
}

export default function VoiceRecordingPanel({ rec, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timerRef = useRef<HTMLSpanElement>(null)

  // Таймер идёт МИМО React state: tweb крутит покадровый `fastRaf`-цикл и пишет
  // строку прямо в узел, причём только при её изменении (voiceRecordingPanel.ts:156).
  // 60 setState в секунду перерисовывали бы весь композер.
  const accumulatedRef = useRef(0)
  useEffect(() => {
    const el = timerRef.current
    if (!el) return
    if (!rec.recording) {
      accumulatedRef.current = 0
      el.textContent = '0:00,0' // voiceRecordingPanel.ts:84 — стартовая строка
      return
    }
    if (rec.paused) return // на паузе строка замирает на последнем значении
    const startedAt = performance.now()
    let raf = 0
    let last = ''
    const tick = () => {
      const text = formatRecordingTimer(accumulatedRef.current + (performance.now() - startedAt))
      if (text !== last) {
        last = text
        el.textContent = text
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      accumulatedRef.current += performance.now() - startedAt
    }
  }, [rec.recording, rec.paused])

  // Волна: перерисовываем на каждый новый пик и на ресайз канваса
  // (в оригинале — ResizeObserver, liveWaveform.ts:56-60).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    drawWaveform(canvas, rec.bars)
    const ro = new ResizeObserver(() => drawWaveform(canvas, rec.bars))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [rec.bars])

  // voiceRecordingPanel.ts:121 — `setMode('recording')` зовётся уже в конструкторе,
  // поэтому `--recording` висит на панели и в покое (правил в SCSS у него нет,
  // это маркер для JS); `--paused` подменяет его на паузе (:126-127).
  const mode = rec.recording && rec.paused ? 'voice-recording-panel--paused' : 'voice-recording-panel--recording'

  return (
    <div className={classNames('voice-recording-panel', mode)}>
      <IconButton className="voice-recording-cancel danger" onClick={onCancel}>
        <TgIcon name="delete" className="voice-recording-cancel-icon" size="inherit" />
      </IconButton>
      <div className="voice-recording-pill">
        <div className="voice-recording-lead">
          <div className="voice-recording-dot" />
          {/* отступление от tweb: прослушать записанное до отправки нельзя —
              рекордер (core/hooks/useVoiceRecorder) не отдаёт снапшот для
              декодирования, а он вне зоны этой задачи. Узел структурный: на паузе
              CSS прячет точку и показывает эту кнопку (_voiceRecordingPanel.scss:24-37),
              без неё «лид» пилюли схлопывался бы. */}
          <IconButton className="voice-recording-play">
            <TgIcon name="play" className="voice-recording-play-icon voice-recording-play-icon--play" size="inherit" />
            <TgIcon name="pause" className="voice-recording-play-icon voice-recording-play-icon--pause" size="inherit" />
          </IconButton>
        </div>
        <canvas ref={canvasRef} className="voice-recording-waveform" />
        <span ref={timerRef} className="voice-recording-timer">0:00,0</span>
      </div>
      <IconButton className="voice-recording-pause-toggle" onClick={rec.togglePause}>
        <TgIcon name="pause" className="voice-recording-pause-icon voice-recording-pause-icon--pause" size="inherit" />
        <TgIcon name="microphone_filled" className="voice-recording-pause-icon voice-recording-pause-icon--mic" size="inherit" />
      </IconButton>
    </div>
  )
}
