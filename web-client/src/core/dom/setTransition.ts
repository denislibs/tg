// src/core/dom/setTransition.ts
// Порт tweb `components/singleTransition.ts` (SetTransition) — императивный
// вариант, который ведёт классы прямо на узле. Нужен там, где переход
// запускается не рендером React, а императивным кодом (`InputSearch.toggleLoading`,
// автомат состояния соединения).
//
// Машина классов у tweb одна на оба варианта, поэтому она здесь ровно одна —
// `transitionClasses`: React-обёртка `core/hooks/useSetTransition` считает по ней
// строку классов, а `setTransition` применяет её же к живому узлу. Дублировать
// правила перехода в двух местах нельзя — это и есть их единственный экземпляр.
//
// Правила (tweb singleTransition.ts:50-76):
//   forwards=true  → className + `forwards`, плюс `animating` на время duration;
//   forwards=false → `backwards` + `animating` на время duration, после чего
//                    снимаются `backwards`, `animating` и сам className.
// Обратный ход className НЕ навешивает (`if(forwards && className)` на :50) —
// поэтому `setTransition({forwards: false})` на узле, где класса и не было,
// ничего не зажигает. Для `InputSearch` это существенно: иначе `isLoading()`
// врал бы `true` все 250 мс после первого же `toggleLoading(false)`.

// Таймер незавершённого перехода живёт на самом узле (tweb :3, `$TRANSITION_TIMEOUT`),
// а не в общей карте — узел уносит его с собой, когда его удаляют из DOM.
const TRANSITION_TIMEOUT = Symbol('TRANSITION_TIMEOUT')
type WithTimeout = Partial<Record<symbol, number>>

/**
 * Классы, которые должны быть на узле в данной фазе перехода, исходя из текущих.
 * Единственный экземпляр правил tweb (см. шапку файла).
 *
 * @param current   классы узла сейчас (порядок сохраняется)
 * @param className класс(ы) состояния, может быть из нескольких через пробел
 * @param animating идёт ли анимация прямо сейчас
 */
export function transitionClasses(
  current: Iterable<string>,
  className: string,
  forwards: boolean,
  animating: boolean,
): string[] {
  const set = new Set(current)
  const own = className ? className.split(' ').filter(Boolean) : []

  if (forwards) {
    // tweb :50-52 — className навешивается только на прямом ходе
    for (const token of own) set.add(token)
    set.add('forwards')
    set.delete('backwards')
    if (animating) set.add('animating')
    else set.delete('animating')
  } else {
    set.delete('forwards')
    if (animating) {
      set.add('backwards')
      set.add('animating')
    } else {
      // tweb :56-60 — по окончании обратного хода снимаются и `backwards`, и className
      for (const token of own) set.delete(token)
      set.delete('backwards')
      set.delete('animating')
    }
  }

  return [...set]
}

// Аналог `liteMode.isAvailable('animations')` из tweb: у нас гейт анимаций — класс
// `body.animation-level-2` (ставит `index.html` статикой и `App.tsx` по настройке
// «Без анимаций»). Тот же приём уже применён в `core/hooks/useCollapsable.ts:47`.
const animationsAvailable = () => document.body.classList.contains('animation-level-2')

export type SetTransitionOptions = {
  element: HTMLElement
  className: string
  forwards: boolean
  duration: number
  onTransitionEnd?: () => void
}

/**
 * Императивный SetTransition: ведёт классы перехода на узле и зовёт
 * `onTransitionEnd` по окончании. Повторный вызов на том же узле отменяет
 * незавершённый предыдущий переход (таймер живёт на самом узле — tweb :18-22).
 *
 * Не портированы `useRafs` и `onTransitionStart` (tweb :38-48, :65): ни один
 * потребитель их не использует (в самом tweb `useRafs` у `inputSearch` закомментирован
 * — inputSearch.ts:171), а мёртвый код мы не заводим.
 */
export function setTransition({ element, className, forwards, duration, onTransitionEnd }: SetTransitionOptions) {
  const pending = (element as unknown as WithTimeout)[TRANSITION_TIMEOUT]
  if (pending !== undefined) clearTimeout(pending)

  const apply = (animating: boolean) => {
    const next = new Set(transitionClasses(element.classList, className, forwards, animating))
    // снимок до мутации: classList живой, удалять по ходу его же обхода нельзя
    const stale = Array.from(element.classList).filter((token) => !next.has(token))
    for (const token of stale) element.classList.remove(token)
    for (const token of next) element.classList.add(token)
  }

  const afterTimeout = () => {
    delete (element as unknown as WithTimeout)[TRANSITION_TIMEOUT]
    apply(false)
    onTransitionEnd?.()
  }

  // tweb :67-71 — без анимаций (или с нулевой длительностью) переход применяется
  // целиком и синхронно, `onTransitionEnd` зовётся тут же
  if (!animationsAvailable() || !duration) {
    afterTimeout()
    return
  }

  apply(true)
  ;(element as unknown as WithTimeout)[TRANSITION_TIMEOUT] = window.setTimeout(afterTimeout, duration)
}
