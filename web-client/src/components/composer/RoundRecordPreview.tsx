// composer/RoundRecordPreview.tsx
// Полноэкранная «сцена» записи кружка — дерево tweb
// `chat/recording/videoRecordingPanel.tsx:33-64` (монтируется в <body>,
// chatRecording.ts:123 → getOverlayRoot()):
//
//   div.video-recording-stage.video-recording-stage--recording
//     div.video-recording-circle [width/height = 360px]
//       video.video-recording-preview
//       svg.progress-ring.video-recording-progress-ring > circle.progress-ring__circle
//
// Своих кнопок у кружка нет: корзина, волна, таймер и пауза остаются в
// `.voice-recording-panel` (комментарий videoRecordingPanel.tsx:6-9).
//
// Кольцо — ОБЩИЙ модуль `@components/progressRing` (`createProgressRing`), тот
// же, что рисует кольцо кружка в ленте (`wrappers/video.ts`): в tweb эта панель
// монтирует ровно тот же компонент с `strokeOpacity: 0.9` и своим классом
// (videoRecordingPanel.tsx:56-61), а до выноса у нас здесь лежала третья копия
// разметки кольца в JSX. Хендл живёт в ref: узел строит ванильный модуль, React
// лишь вешает его в коробку и гонит прогресс через `setProgress` — как
// ChatRecording в оригинале (chatRecording.ts:584).
import { useEffect, useRef } from 'react'
import { createProgressRing, type ProgressRingHandle } from '@components/progressRing'
import classNames from '../../shared/lib/classNames'

const STAGE_SIZE = 360 // videoRecordingPanel.tsx:19
// chatRecording.ts:46 — VIDEO_RECORD_MAX_MS.
const ROUND_LIMIT_SECS = 60

export default function RoundRecordPreview({ stream, secs, paused }: { stream: MediaStream; secs: number; paused?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const circleRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<ProgressRingHandle | null>(null)
  const progress = Math.min(1, secs / ROUND_LIMIT_SECS)

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])

  // Монтаж кольца: узел общего модуля живёт внутри `.video-recording-circle`,
  // как <ProgressRing> в JSX оригинала.
  useEffect(() => {
    const box = circleRef.current
    if (!box) return
    const ring = createProgressRing({
      size: STAGE_SIZE,
      strokeOpacity: 0.9,
      class: 'video-recording-progress-ring',
    })
    box.append(ring.element)
    ringRef.current = ring
    return () => {
      ring.element.remove()
      ring.destroy()
      ringRef.current = null
    }
  }, [])

  useEffect(() => { ringRef.current?.setProgress(progress) }, [progress])

  return (
    <div className={classNames('video-recording-stage', paused ? 'video-recording-stage--paused' : 'video-recording-stage--recording')}>
      <div ref={circleRef} className="video-recording-circle" style={{ width: STAGE_SIZE, height: STAGE_SIZE }}>
        <video ref={ref} className="video-recording-preview" autoPlay muted playsInline />
      </div>
    </div>
  )
}
