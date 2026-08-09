// TabsBar — плашка табов, липнущая к верху скролл-контейнера (tweb
// .search-super-tabs-scrollable: position sticky), с градиентом за табами,
// который гасит уплывающий контент.
// Табы папок сайдбара так НЕ обёрнуты: там карточка и градиент — прямые дети
// .chatlist-overlay, как в tweb (см. Sidebar.tsx).
import type { CSSProperties, ReactNode, Ref } from 'react'
import classNames from '../../lib/classNames'
import s from './TabsBar.module.scss'

export default function TabsBar({
  top,
  barRef,
  className,
  children,
}: {
  /** отступ прилипания (sticky top) — под absolute-шапкой панели профиля */
  top?: number | string
  /** реф плашки — замер позиции при скролле (header-filled панели профиля) */
  barRef?: Ref<HTMLDivElement>
  className?: string
  children: ReactNode
}) {
  // При sticky-зазоре (числовой top) градиент растягивается вверх на столько же
  // (--tabsbar-gap), чтобы фейд закрыл щель между шапкой и плашкой и контент
  // под ней не просвечивал.
  const gap = typeof top === 'number' ? top : 0
  const style: CSSProperties | undefined =
    top != null
      ? {
          top,
          ...(gap ? ({ '--tabsbar-gap': `${gap}px` } as CSSProperties) : {}),
        }
      : undefined
  return (
    <div ref={barRef} className={classNames(s.bar, className ?? '')} style={style}>
      {/* tweb `.menu-horizontal-gradient-container > .menu-horizontal-gradient`
          (_slider.scss): фейд от --background-color вниз до прозрачного.
          Цвет/высоту задаёт партиал — свои background/height здесь не нужны. */}
      <div className={classNames('menu-horizontal-gradient-container', s.gradientContainer)}>
        <div className="menu-horizontal-gradient" />
      </div>
      {children}
    </div>
  )
}
