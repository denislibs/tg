// Появление мессенджера (tweb #main-columns fade-in). При возврате к прежнему
// аккаунту / после смены — scale-enter (флаг ANIMATE_MAIN, main-screen-enter);
// при обычном показе — короткий fade. useLayoutEffect выполняется до первого
// paint — как в tweb, где main-screen-enter вешается на #page-chats ДО построения
// UI (src/index.ts, ветка signed-in), так что билд идёт уже скрытым/масштабированным.
import { useLayoutEffect } from 'react'
import { ANIMATE_MAIN_KEY, playMainScreenEnter } from '../accountTransition'

export function useShellEnterAnimation(): void {
  useLayoutEffect(() => {
    const el = document.getElementById('app-shell')
    if (!el) return

    // Флаг читаем один раз и сразу удаляем: scale-enter — только на первый показ
    // после смены/возврата аккаунта.
    if (!localStorage.getItem(ANIMATE_MAIN_KEY)) {
      // Обычный показ — короткий fade-in. WAAPI без fill не оставляет остаточного
      // состояния: по завершении элемент возвращается к базовому стилю (opacity 1).
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)' })
      return
    }
    localStorage.removeItem(ANIMATE_MAIN_KEY)

    // Стартовое состояние (scale 1.75 / opacity 0) вешаем СИНХРОННО и с погашенным
    // transition. layout-эффекты детей Shell могли форснуть reflow и «зафиксировать»
    // базовый стиль scale(1); тогда добавление .main-screen-enter (в котором есть
    // transition: .2s) запустило бы обратный переход scale(1) → scale(1.75) — видимая
    // вспышка неотмасштабированного Shell перед въездом. Гасим переход, ставим старт
    // мгновенно, форсим reflow, возвращаем transition — дальше штатный enter из tweb.
    const prevTransition = el.style.transition
    el.style.transition = 'none'
    el.classList.add('main-screen-enter')
    void el.offsetWidth // reflow: зафиксировать старт без анимации
    el.style.transition = prevTransition

    // tweb src/index.ts (should_animate_main): doubleRaf → main-screen-entering →
    // pause(200) → снятие классов (после чего остаточного состояния не остаётся).
    void playMainScreenEnter(el)
  }, [])
}
