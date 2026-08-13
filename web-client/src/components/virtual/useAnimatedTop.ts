// Порт tweb `helpers/solid/createAnimatedValue.ts` (47 строк, читать целиком).
// Формула прогресса и значения — 1:1:
//   progress = easing(min(1, (performance.now() - startTime) / time))
//   current  = (target - startValue) * progress + startValue
// `time` там параметр вызова, у списка чатов это константа 120
// (`deferredSortedVirtualList.tsx`, вызов `createAnimatedValue(top, 120, ...)`).
//
// Ключевое отличие порта (спека, «Форма порта», отступление №2): в оригинале
// `current`/`animating` — solid-сигналы, и потребитель (JSX) реактивно кладёт
// их в `style.top`/`--background`. В React так анимировать нельзя — сигнал
// тикал бы 60 раз/сек и на каждый тик перерисовывал бы всю строку списка.
// Поэтому здесь значение вообще не попадает в состояние React: хук отдаёт
// ref-колбэк, который держит текущее анимируемое значение в ref и каждый
// кадр `animate()` пишет прямо в DOM — как и `--background`, который в
// оригинале выставляет потребитель по `animating()` (deferredSortedVirtualList.tsx:189-194),
// здесь это делает сам хук.
import { useCallback, useEffect, useRef } from 'react'
import { simpleEasing } from '@helpers/easings'
import { animate } from '@helpers/animation'

const ANIMATION_TIME = 120

/** Ставит элементу `top` и `--background`, анимируя переход. */
export function useAnimatedTop(top: number, canAnimate: boolean): (el: HTMLElement | null) => void {
  const elRef = useRef<HTMLElement | null>(null)
  // Последнее фактически применённое к DOM значение (аналог solid-сигнала `current`).
  const currentRef = useRef(top)
  // «Живые» пропсы для ref-колбэка: сам колбэк должен быть стабилен между
  // рендерами (иначе React дёргал бы detach/attach при каждой смене `top`),
  // поэтому актуальные значения читаются из ref, а не из замыкания.
  const topRef = useRef(top)
  topRef.current = top
  // Гасит текущую анимацию (флаг `cleaned` оригинала) — при смене узла или размонтировании.
  const stopRef = useRef<(() => void) | null>(null)

  const setEl = useCallback((el: HTMLElement | null) => {
    // Отцепление (`el === null`) и переприкрепление ТОГО ЖЕ узла — не смена узла,
    // и состояние хука тут трогать нельзя.
    //
    // React 19 переинициализирует ref-колбэк keyed-ребёнка, когда тот переезжает в
    // DOM: под StrictMode (а его включает `main.tsx`) один и тот же своп соседей
    // даёт пару `detach(null)` + `attach(тот же el)`. То же самое делает и
    // потребитель, передавший НЕСТАБИЛЬНЫЙ inline-ref (`ref={(el) => itemRef(el)}`) —
    // уже без всякого StrictMode, в проде. Прежняя безусловная ветка на каждый такой
    // вызов сбрасывала `currentRef`/`top`/`--background` — и переезд строки не
    // анимировался вовсе, строка прыгала (критерий приёмки №4 спеки).
    //
    // Гасить бегущую анимацию на отцеплении тоже не нужно: при размонтировании её
    // снимает cleanup эффекта ниже, при смене узла — ветка `stopRef.current?.()`
    // прямо здесь. Единственный оставшийся случай — узел отцепили и больше ничего не
    // приткнули: анимация доигрывает свои ⩽120 мс на уже отсоединённом от дерева
    // элементе, это не наблюдаемо.
    if (el === null || el === elRef.current) return

    // Гасим анимацию, бежавшую на ПРЕЖНЕМ узле (смена ключа/ремонт строки —
    // старый элемент, к которому был привязан animate()-тик, больше не наш).
    // Осознанное допущение: `top`/`--background` на старом узле НЕ сбрасываются
    // (проверено ревью отдельным тестом) — узел уже отсоединяется от дерева
    // (иначе setEl не вызвался бы с другим el), практического дефекта нет,
    // следующий attach полностью перезапишет оба свойства на новом узле.
    stopRef.current?.()
    stopRef.current = null
    elRef.current = el

    // Первое присвоение узлу — БЕЗ анимации, как `{defer: true}` у
    // `createEffect(on(...))` оригинала (createAnimatedValue.ts:37-38): эффект
    // там не срабатывает на начальное значение сигнала, только на его смену.
    currentRef.current = topRef.current
    el.style.top = `${topRef.current}px`
    el.style.removeProperty('--background')
  }, [])

  useEffect(() => {
    const el = elRef.current
    // `currentRef.current === top` — оптимизация: эффект перезапускается на
    // смену ЛЮБОГО из [top, canAnimate], а не только top (например, гасится
    // «Без анимаций» уже после того, как значение доехало до цели). Без этой
    // проверки такой перезапуск заново дёрнул бы `--background`/`animate()`
    // с startValue === target — визуально пустая, но лишняя анимация.
    if (!el || currentRef.current === top) return

    stopRef.current?.()

    if (!canAnimate) {
      currentRef.current = top
      el.style.top = `${top}px`
      el.style.removeProperty('--background')
      stopRef.current = null
      return
    }

    // createAnimatedValue.ts:16-30
    const startValue = currentRef.current
    const startTime = performance.now()
    let cleaned = false

    el.style.setProperty('--background', 'var(--surface-color)')

    animate(() => {
      if (cleaned) return false

      const progress = simpleEasing(Math.min(1, (performance.now() - startTime) / ANIMATION_TIME))
      currentRef.current = (top - startValue) * progress + startValue
      el.style.top = `${currentRef.current}px`

      if (progress < 1) return true

      el.style.removeProperty('--background')
      return false
    })

    stopRef.current = () => {
      cleaned = true
    }

    // onCleanup оригинала (createAnimatedValue.ts:33-36): реагирует и на
    // размонтирование, и на следующую смену top/canAnimate до завершения кадра.
    return () => {
      stopRef.current?.()
      stopRef.current = null
    }
  }, [top, canAnimate])

  return setEl
}
