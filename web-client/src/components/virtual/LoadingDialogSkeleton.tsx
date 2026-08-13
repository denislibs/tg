// Порт 1:1 tweb src/components/loadingDialogSkeleton.tsx (56 строк) — скелетон
// строки списка чатов на месте ещё не загруженного индекса виртуального списка
// (Task 3 плана «Виртуальный список чатов»). Solid-компонент оригинала переведён
// на React (createSignal/onCleanup → useState/useEffect), формула ширины плашек
// и вся геометрия SCSS — дословно из оригинала.
import { useEffect, useState, type CSSProperties } from 'react'
import classNames from '../../shared/lib/classNames'
import s from './LoadingDialogSkeleton.module.scss'

// tweb loadingDialogSkeleton.tsx:6-11 — псевдослучайная (но детерминированная
// от seed) ширина плашки в диапазоне [min, max).
function pseudoRandomRange(seed: number, min: number, max: number): number {
  const x = Math.sin(seed * 10000 + 999999) * 10000
  const rand = x - Math.floor(x)

  return min + rand * (max - min)
}

export type LoadingDialogSkeletonSize = 72 | 64

const LoadingDialogSkeleton: React.FC<{
  className?: string
  style?: CSSProperties
  noAvatar?: boolean
  size: LoadingDialogSkeletonSize
  seed: number
}> = ({ className, style, noAvatar, size, seed }) => {
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    // tweb :24-31 — шиммер включается с задержкой (экономия производительности
    // при быстром скролле списка), таймер снимается при размонтировании.
    const timeout = self.setTimeout(() => setAnimating(true), 1500)
    return () => self.clearTimeout(timeout)
  }, [])

  return (
    <div
      className={classNames(
        s.Container,
        'loading-dialog-skeleton',
        s['size' + size],
        noAvatar ? s.noAvatar : '',
        animating ? s.shimmer : '',
        className ?? '',
      )}
      style={style}
    >
      <div className={s.Avatar} />
      <div className={s.Content}>
        <div className={s.Title}>
          <div
            className={s.TitleLeft}
            style={{ '--width': (pseudoRandomRange(seed, 100, 120) | 0) + 'px' } as CSSProperties}
          />
          <div
            className={s.TitleRight}
            style={{ '--width': (pseudoRandomRange(seed, 20, 60) | 0) + 'px' } as CSSProperties}
          />
        </div>
        <div
          className={s.Subtitle}
          style={{ '--width': (pseudoRandomRange(seed, 60, 200) | 0) + 'px' } as CSSProperties}
        />
      </div>
    </div>
  )
}

export default LoadingDialogSkeleton
