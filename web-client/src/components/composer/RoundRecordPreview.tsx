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
import { useEffect, useRef } from 'react'
import classNames from '../../shared/lib/classNames'

const STAGE_SIZE = 360 // videoRecordingPanel.tsx:19
const STROKE_WIDTH = 3.5 // progressRing.tsx:27-33
const RADIUS = STAGE_SIZE / 2 - STROKE_WIDTH * 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
// chatRecording.ts:46 — VIDEO_RECORD_MAX_MS.
const ROUND_LIMIT_SECS = 60

export default function RoundRecordPreview({ stream, secs, paused }: { stream: MediaStream; secs: number; paused?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  const progress = Math.min(1, secs / ROUND_LIMIT_SECS)
  return (
    <div className={classNames('video-recording-stage', paused ? 'video-recording-stage--paused' : 'video-recording-stage--recording')}>
      <div className="video-recording-circle" style={{ width: STAGE_SIZE, height: STAGE_SIZE }}>
        <video ref={ref} className="video-recording-preview" autoPlay muted playsInline />
        <svg className="progress-ring video-recording-progress-ring" width={STAGE_SIZE} height={STAGE_SIZE}>
          <circle
            className="progress-ring__circle"
            cx={STAGE_SIZE / 2}
            cy={STAGE_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#fff"
            strokeOpacity={0.9}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            transform={`rotate(-90 ${STAGE_SIZE / 2} ${STAGE_SIZE / 2})`}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
      </div>
    </div>
  )
}
