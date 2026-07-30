// composer/RoundRecordPreview.tsx
// Круглое зеркальное превью записываемого кружка по центру чата + кольцо
// прогресса лимита (tweb: белая дуга бежит по кругу до 60с).
import { useEffect, useRef } from 'react'
import s from '../Composer.module.scss'

const ROUND_LIMIT = 60

export default function RoundRecordPreview({ stream, secs }: { stream: MediaStream; secs: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  const C = 2 * Math.PI * 49
  return (
    <div className={s.roundPreviewWrap}>
      <video ref={ref} className={s.roundPreview} autoPlay muted playsInline />
      <svg className={s.roundProgress} viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r="49" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.min(1, secs / ROUND_LIMIT))}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
    </div>
  )
}
