import { lazy, Suspense } from 'react'

// Обои чата тянут @twallpaper/react (+ его CSS) — тяжёлый рендерер градиента,
// не нужный до первого кадра. Грузим лениво отдельным чанком, вон из главного
// бандла; App и AuthFlow используют эту обёртку, деля один и тот же чанк.
const ChatBackground = lazy(() => import('./ChatBackground'))

// Фолбэк — залитый фон темы (--background-color) на месте обоев (z-index 0), чтобы до
// загрузки чанка за shell'ом не мигала пустота.
export default function ChatBackgroundLazy(props: { themeColors?: string[] }) {
  return (
    <Suspense
      fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 0, background: 'var(--background-color)' }} />}
    >
      <ChatBackground {...props} />
    </Suspense>
  )
}
