import type { CSSProperties } from 'react'
import s from './DialogSkeleton.module.scss'

// A shimmering placeholder list shown while the first page of dialogs loads
// (tweb shows skeleton rows before the real chats fade in).
function Bar({ width, height = 12 }: { width: number | string; height?: number }) {
  const style: CSSProperties = { width, height, borderRadius: height / 2 }
  return <div className={s.bar} style={style} />
}

export default function DialogSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className={s.list}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={s.row} style={{ opacity: 1 - i * 0.06 }}>
          <Bar width={54} height={54} />
          <div className={s.body}>
            <div className={s.top}>
              <Bar width="45%" />
              <div className={s.spacer} />
              <Bar width={28} height={11} />
            </div>
            <Bar width="72%" />
          </div>
        </div>
      ))}
    </div>
  )
}
