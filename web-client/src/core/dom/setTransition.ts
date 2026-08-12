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

import liteMode from '@helpers/liteMode'

// Таймер незавершённого перехода живёт на самом узле (tweb :3, `$TRANSITION_TIMEOUT`),
// а не в общей карте — узел уносит его с собой, когда его удаляют из DOM.
// Так же живёт и id подвешенного raf-отложенного запуска (tweb :3, `$TRANSITION_RAF`).
const TRANSITION_TIMEOUT = Symbol('TRANSITION_TIMEOUT')
const TRANSITION_RAF = Symbol('TRANSITION_RAF')
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

export type SetTransitionOptions = {
  element: HTMLElement
  className: string
  forwards: boolean
  duration: number
  onTransitionEnd?: () => void
  useRafs?: number
}

/**
 * Императивный SetTransition: ведёт классы перехода на узле и зовёт
 * `onTransitionEnd` по окончании. Повторный вызов на том же узле отменяет
 * незавершённый предыдущий переход (таймер живёт на самом узле — tweb :18-22).
 *
 * `useRafs` (tweb :38-48) — отложить запуск на N кадров: узлу, только что
 * вставленному в DOM, класс в том же кадре не даст CSS-перехода. Довезён
 * вместе с потребителем — `ProgressivePreloader` (`components/preloader.ts`,
 * attach/detach). `onTransitionStart` (tweb :65) по-прежнему не портирован:
 * потребителей нет, мёртвый код не заводим.
 */
export function setTransition(options: SetTransitionOptions) {
  const { element, className, forwards, duration, onTransitionEnd, useRafs } = options
  const pending = (element as unknown as WithTimeout)[TRANSITION_TIMEOUT]
  if (pending !== undefined) clearTimeout(pending)

  // tweb :27-32 — отмена подвешенного raf-отложенного запуска предыдущего вызова
  const pendingRaf = (element as unknown as WithTimeout)[TRANSITION_RAF]
  if (pendingRaf !== undefined) {
    cancelAnimationFrame(pendingRaf)
    if (!useRafs) delete (element as unknown as WithTimeout)[TRANSITION_RAF]
  }

  // tweb :38-48 — raf-цепочка: каждый кадр снимает один useRafs, потом запуск
  if (useRafs && liteMode.isAvailable('animations') && duration) {
    ;(element as unknown as WithTimeout)[TRANSITION_RAF] = window.requestAnimationFrame(() => {
      delete (element as unknown as WithTimeout)[TRANSITION_RAF]
      setTransition({ ...options, useRafs: useRafs - 1 })
    })
    return
  }

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
  // целиком и синхронно, `onTransitionEnd` зовётся тут же. Гейт — тот же
  // `liteMode.isAvailable('animations')`, что и в оригинале (`singleTransition.ts:38,67`);
  // у нас он читает настройку «Без анимаций», из которой `App.tsx:272-274` выводит
  // и классы `body.animation-level-*` для CSS.
  if (!liteMode.isAvailable('animations') || !duration) {
    afterTimeout()
    return
  }

  apply(true)
  ;(element as unknown as WithTimeout)[TRANSITION_TIMEOUT] = window.setTimeout(afterTimeout, duration)
}
