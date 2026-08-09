// MediaHeader — общая шапка «иконка → заголовок → подзаголовок» (порт tweb
// `src/components/mediaHeader.tsx`). Её носят все карточки экрана входа.
//
// В tweb контейнер несёт `styles.container`, но этот класс в модуле пуст, и в
// живом DOM у шапки голый `div` — так же и здесь.
import type { CSSProperties, ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'
import s from './mediaHeader.module.scss'

function MediaHeader({ className = '', children }: { className?: string; children?: ReactNode }) {
  return <div className={className}>{children}</div>
}

/** Слот под иконку/лотти/канву. `size` уезжает в `--sticker-size` (tweb 1:1). */
MediaHeader.Sticker = function MediaHeaderSticker({
  size = 130,
  className = '',
  children,
}: {
  size?: number
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={classNames(s.sticker, className)}
      style={{ '--sticker-size': `${size}px` } as CSSProperties}
    >
      {children}
    </div>
  )
}

MediaHeader.Title = function MediaHeaderTitle({
  className = '',
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  // `text-overflow-wrap` стилей не имеет и в самом tweb — это JS-маркер,
  // но в DOM он есть, и differ его сверяет.
  return (
    <div className={classNames(s.title, 'text-center', 'text-overflow-wrap', className)}>
      {children}
    </div>
  )
}

MediaHeader.Subtitle = function MediaHeaderSubtitle({
  secondary,
  className = '',
  children,
}: {
  /** приглушённый вариант (`.secondary`) — на signIn / signQR / authCode */
  secondary?: boolean
  className?: string
  children?: ReactNode
}) {
  // В живом tweb у приглушённого подзаголовка класс `secondary` НЕ хеширован —
  // рядом с модульным идёт глобальный из base.scss (у нас — `styles/tweb/_bridge.scss`).
  return (
    <div
      className={classNames(
        s.subtitle,
        secondary ? classNames(s.secondary, 'secondary') : '',
        'text-center',
        className,
      )}
    >
      {children}
    </div>
  )
}

export default MediaHeader
