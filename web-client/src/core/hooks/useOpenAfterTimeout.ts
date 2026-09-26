// Порт `SidebarSlider.selectTab` (tweb slider.ts:133-137): вкладке, которую
// открыли, `onOpenAfterTimeout` зовётся через `TRANSITION_TIME` — когда выезд
// уже доиграл. Так tweb уводит из кадра клика работу, которой не место во
// время анимации: `AppSharedMediaTab.onOpenAfterTimeout` → `scrollable.onScroll()`
// (sharedMediaTab.tsx:105-108) — пересчёт триггеров догрузки шаред-медиа.
// Наш `components/slider.ts` делает то же для своих вкладок; панель профиля —
// React-портал вне слайдера, поэтому та же механика здесь хуком.
import { useEffect, useRef } from 'react'
import { NAVIGATION_TRANSITION_TIME } from '@components/transition'

/**
 * @param open — открыта ли панель; колбэк зовётся через `NAVIGATION_TRANSITION_TIME`
 * после перехода в `true` и отменяется, если панель закрыли раньше.
 * @param onOpenAfterTimeout — читается в момент срабатывания (свежее замыкание).
 */
export function useOpenAfterTimeout(open: boolean, onOpenAfterTimeout: () => void): void {
  const cbRef = useRef(onOpenAfterTimeout)
  cbRef.current = onOpenAfterTimeout
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => cbRef.current(), NAVIGATION_TRANSITION_TIME)
    return () => clearTimeout(timer)
  }, [open])
}
