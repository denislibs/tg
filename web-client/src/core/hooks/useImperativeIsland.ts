// Граница React → vanilla: одно место, где React отдаёт узел портированному из
// tweb императивному коду и забирает обратно.
//
// Зачем. Код tweb написан в расчёте на ОДНОРАЗОВЫЙ контейнер: он досыпает в DOM
// свои узлы (сентинелы `StickyIntersector`, кольцо `ProgressivePreloader`,
// канвасы плееров) и не убирает их за собой, потому что в оригинале контейнер
// выбрасывается целиком. React даёт постоянный узел, поэтому досыпанное
// переживает размонтирование, а в StrictMode ещё и удваивается. До этого хука
// каждый мост чинил это по-своему — `Chat.tsx` и `useEmoticonsStickySpy.ts`
// вручную писали один и тот же `querySelectorAll('.sticky_sentinel').remove()`.
//
// Что хук берёт на себя:
//   • момент запуска — layout-фаза, ДО пейнта (иначе замер геометрии и
//     восстановление скролла видны как прыжок);
//   • зону актуальности — дочерний scope `useMiddlewareHelper`, протухающий
//     на teardown (правила — web-client/CLAUDE.md, «Асинхронщина и актуальность»);
//   • уборку — либо сносом одноразового контейнера целиком (`mode: 'own'`),
//     либо сносом досыпанных узлов по селектору (`strays`).
//
// Чего хук НЕ делает: не превращает императивный код в React. Если узлом
// владеет React, а императивный код лишь помечает состояние, — класс приходит
// пропом, острова здесь нет (случай `is-sticky` в docs/tweb/bubbles.md).
// Exit-анимации тоже не его дело: узел держит в DOM `useMountTransition`, и к
// моменту размонтирования острова анимация уже доиграла.
import { useCallback, useLayoutEffect, useRef, type DependencyList } from 'react'
import type { Middleware } from '@helpers/middleware'
import { useMiddlewareHelper } from './useMiddlewareHelper'

export type ImperativeIslandSetup = (
  /** узел, которым владеет императивный код (см. `mode`) */
  container: HTMLElement,
  ctx: {
    /** актуальность прогона: протухает на teardown, как tweb middleware */
    middleware: Middleware
    /** сам React-узел — нужен, когда `mode: 'own'` и важен внешний бокс */
    host: HTMLElement
  },
) => void | VoidFunction

export type ImperativeIslandOptions = {
  /**
   * `host` (по умолчанию) — отдаём сам React-узел. Ничего не меняет в вёрстке,
   * подходит коду, который ДЕКОРИРУЕТ существующее дерево (`StickyIntersector`
   * досыпает сентинелы внутрь наблюдаемых секций).
   *
   * `own` — создаём внутри одноразовый `div` и отдаём его. Всё, что туда
   * досыпали, уезжает вместе с ним. Подходит коду, который СТРОИТ своё
   * поддерево (плееры, морфы, канвасы). Учти: это лишний уровень в DOM —
   * если снаружи flex/grid или абсолютное позиционирование, проверь вёрстку.
   */
  mode?: 'own' | 'host'
  /** класс одноразового контейнера (только `mode: 'own'`) */
  className?: string
  /**
   * Селектор узлов, которые императивный код досыпал в host и не убирает сам
   * (`mode: 'host'`). Ищется внутри host на любой глубине.
   *
   * Автоматически это не определить: React в это же время рендерит в тот же
   * узел свои дети, и отличить их от чужих по факту появления нельзя.
   */
  strays?: string
  /**
   * Узел приходит чужим ref'ом, а не нашим ref-колбэком (частый случай: узел
   * рендерит родитель и передаёт `RefObject` вниз — `useEmoticonsStickySpy`,
   * скролл-контейнер ленты). Тогда остров поднимается layout-эффектом, а
   * возвращённый ref-колбэк не нужен.
   *
   * Смену самого узла в этом режиме хук не видит — она должна быть в `deps`.
   */
  host?: { current: HTMLElement | null }
}

/**
 * @returns ref-колбэк для узла-хозяина. Пересоздаёт остров при смене `deps`
 *          и при смене самого узла.
 *
 * @example
 * const ref = useImperativeIsland((host) => {
 *   const intersector = new StickyIntersector(host, onStuck)
 *   return () => intersector.disconnect()
 * }, [onStuck], { strays: '.sticky_sentinel' })
 *
 * return <div ref={ref} className="bubbles-inner" />
 */
export function useImperativeIsland<T extends HTMLElement = HTMLElement>(
  setup: ImperativeIslandSetup,
  deps: DependencyList,
  options: ImperativeIslandOptions = {},
): (node: T | null) => void {
  const helper = useMiddlewareHelper()

  // Читаются в момент запуска острова, поэтому в deps не нужны: пересоздавать
  // остров при каждой смене инлайновой стрелки — не то, чего от него ждут.
  const setupRef = useRef(setup)
  setupRef.current = setup
  const optionsRef = useRef(options)
  optionsRef.current = options

  const hostRef = useRef<T | null>(null)
  const teardownRef = useRef<VoidFunction | null>(null)

  const stop = useCallback(() => {
    const teardown = teardownRef.current
    teardownRef.current = null
    teardown?.()
  }, [])

  const start = useCallback((host: T) => {
    stop()

    const { mode = 'host', className, strays } = optionsRef.current
    const scope = helper.get().create()

    let container: HTMLElement = host
    if (mode === 'own') {
      container = document.createElement('div')
      if (className) container.className = className
      host.appendChild(container)
    }

    let dispose: VoidFunction | void
    try {
      dispose = setupRef.current(container, { middleware: scope.get(), host })
    } catch (e) {
      // Остров не поднялся — контейнер за собой убираем, иначе он останется
      // висеть пустым и следующий прогон добавит второй.
      if (mode === 'own') container.remove()
      scope.destroy()
      throw e
    }

    teardownRef.current = () => {
      dispose?.()
      scope.destroy()
      if (mode === 'own') container.remove()
      else if (strays) host.querySelectorAll(strays).forEach((el) => el.remove())
    }
  }, [helper, stop])

  // Смена deps при живом узле — пересоздать остров. В режиме ref-колбэка первый
  // прогон пропускаем: колбэк уже поднял остров в этом же коммите, до
  // layout-эффектов. В режиме чужого ref'а поднимать больше некому — здесь и
  // поднимаем, и здесь же гасим на размонтировании.
  const startedRef = useRef(false)
  useLayoutEffect(() => {
    const external = optionsRef.current.host
    if (external) {
      const host = external.current as T | null
      hostRef.current = host
      if (host) start(host)
      return stop
    }
    if (!startedRef.current) {
      startedRef.current = true
      return
    }
    const host = hostRef.current
    if (host) start(host)
    // Список зависимостей приходит от вызывающего — статически он здесь и не
    // может быть литералом; проверяет его линтер на стороне вызова.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Размонтирование компонента. Обычно ref-колбэк с null отрабатывает сам, но
  // порядок «отцепить ref» и «погасить эффект» гарантировать не на что —
  // teardown идемпотентен, поэтому дублирование безопасно.
  useLayoutEffect(() => stop, [stop])

  return useCallback((node: T | null) => {
    if (node === hostRef.current) return
    hostRef.current = node
    if (node) start(node)
    else stop()
  }, [start, stop])
}

export default useImperativeIsland
