// TabsBar — плашка табов поверх скролла: градиент за табами гасит уплывающий
// контент (tweb .folders-tabs-gradient-container / .search-super-tabs-gradient).
// mode='overlay' — абсолютный оверлей над списком (сайдбар);
// mode='sticky' — липнет к верху скролл-контейнера (панель профиля,
// tweb .search-super-tabs-scrollable: position sticky).
import type { CSSProperties, ReactNode, Ref } from 'react'
import classNames from '../../lib/classNames'
import s from './TabsBar.module.scss'

export default function TabsBar({
  mode = 'sticky',
  from,
  top,
  barRef,
  className,
  children,
}: {
  mode?: 'sticky' | 'overlay'
  /** цвет верха градиента (фон под контентом); по умолчанию — surface сайдбара */
  from?: string
  /** отступ прилипания (sticky top) — под absolute-шапкой панели профиля */
  top?: number | string
  /** реф плашки — замер позиции при скролле (header-filled панели профиля) */
  barRef?: Ref<HTMLDivElement>
  className?: string
  children: ReactNode
}) {
  // При sticky-зазоре (числовой top) градиент растягивается вверх на столько же
  // (--tabsbar-gap), чтобы surface-часть фейда закрыла щель между шапкой и плашкой
  // и контент под ней не просвечивал.
  const gap = typeof top === 'number' ? top : 0
  const style: CSSProperties | undefined =
    from || top != null
      ? {
          ...(from ? ({ '--tabsbar-from': from } as CSSProperties) : {}),
          ...(top != null ? { top } : {}),
          ...(gap ? ({ '--tabsbar-gap': `${gap}px` } as CSSProperties) : {}),
        }
      : undefined
  return (
    <div ref={barRef} className={classNames(s.bar, mode === 'overlay' ? s.overlay : s.sticky, className ?? '')} style={style}>
      <div className={s.gradientContainer}>
        <div className={s.gradient} />
      </div>
      {children}
    </div>
  )
}
