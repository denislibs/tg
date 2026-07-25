// Появление мессенджера (tweb #main-columns fade-in). При возврате к прежнему
// аккаунту / после смены — scale-enter (флаг ANIMATE_MAIN, main-screen-enter);
// при обычном показе — короткий fade. useLayoutEffect: до paint, без FOUC.
import { useLayoutEffect } from 'react'
import { ANIMATE_MAIN_KEY, playMainScreenEnter } from '../accountTransition'

export function useShellEnterAnimation(): void {
  useLayoutEffect(() => {
    const el = document.getElementById('app-shell')
    if (!el) return
    if (localStorage.getItem(ANIMATE_MAIN_KEY)) {
      localStorage.removeItem(ANIMATE_MAIN_KEY)
      void playMainScreenEnter(el)
    } else {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)' })
    }
  }, [])
}
