// Порт tweb `src/hooks/useCollapsable.ts` — сворачивание ряда историй по колесу.
//
// Состояние ДВОИЧНОЕ: в tweb `onMove` начинается с `if(isWheel || true)`, то есть
// дробная ветка (плавное протаскивание по 1/600 дельты) намеренно закорочена и
// прогресс всегда прыгает между 0 (развёрнут) и 1 (свёрнут); плавность даёт
// CSS-transition на контейнере. Стартовое состояние — свёрнуто.
//
// Правила из tweb дословно:
//   • список прокручен (scrollTop > 0) и мы не свёрнуты → свернуть немедленно;
//   • инерционная докрутка (WheelClassifier === 'inertia') игнорируется;
//   • новое состояние = delta < 0 (вверх) ? развёрнуто : свёрнуто;
//   • если список прокручен и мы не развёрнуты, либо идёт 75 мс-кулдаун — гасим
//     жест и заводим кулдаун заново (tweb: debounce(onScrolled, 75) + isDebounced()).
//     Сам `onScrolled` в tweb начинается с `return;` — он мёртв, живёт только
//     сторожевой таймер, поэтому здесь остался просто таймер.
//
// `isTransition` берётся из transitionstart/transitionend самого контейнера.
import { useCallback, useEffect, useRef, useState } from 'react'
import WheelClassifier from '../../shared/lib/wheelClassifier'

export const STATE_FOLDED = 1
export const STATE_UNFOLDED = 0

const COOLDOWN_MS = 75

export interface CollapsableOptions {
  /** прокручиваемый список под рядом (его scrollTop блокирует разворачивание) */
  scrollable: () => HTMLElement | null
  /** узел, на котором слушаем колесо (tweb: .connection-status-bottom) */
  listenWheelOn: () => HTMLElement | null
  /** сам сворачиваемый контейнер (с него читаем transitionstart/end) */
  container: () => HTMLElement | null
  /** не реагировать вовсе (в tweb — когда историй нет) */
  shouldIgnore?: () => boolean
}

export interface Collapsable {
  progress: number
  folded: boolean
  isTransition: boolean
  unfold: (e?: { preventDefault: () => void; stopPropagation: () => void }) => void
  fold: () => void
}

// tweb `liteMode.isAvailable('animations')` — у нас гейт CSS-анимаций это
// класс `body.animation-level-2` (index.html).
const animationsAvailable = () => document.body.classList.contains('animation-level-2')

export default function useCollapsable(props: CollapsableOptions): Collapsable {
  const [progress, _setProgress] = useState<number>(STATE_FOLDED)
  const [isTransition, setIsTransition] = useState(false)

  // tweb useCollapsable.ts:29-32: смена состояния СРАЗУ поднимает isTransition,
  // не дожидаясь transitionstart, — иначе кадр между setProgress и стартом
  // перехода контейнер уже кликабелен (disable-hover снят), а он ещё едет.
  const progressRef = useRef(progress)
  progressRef.current = progress

  const setProgress = useCallback((value: number) => {
    // отступление от tweb: холостую установку того же значения отбрасываем —
    // иначе isTransition поднялся бы, а transitionend его не снял бы (перехода
    // нет) и контейнер навсегда остался бы под disable-hover.
    if (value === progressRef.current) return
    if (animationsAvailable()) setIsTransition(true)
    _setProgress(value)
  }, [])
  const optsRef = useRef(props)
  optsRef.current = props

  const cooldownRef = useRef<number | undefined>(undefined)
  const classifierRef = useRef(new WheelClassifier())

  const isDebounced = () => cooldownRef.current !== undefined
  const debounced = () => {
    window.clearTimeout(cooldownRef.current)
    cooldownRef.current = window.setTimeout(() => { cooldownRef.current = undefined }, COOLDOWN_MS)
  }
  const clearDebounce = () => {
    window.clearTimeout(cooldownRef.current)
    cooldownRef.current = undefined
  }

  const unfold = useCallback((e?: { preventDefault: () => void; stopPropagation: () => void }) => {
    if (progressRef.current !== STATE_UNFOLDED) {
      setProgress(STATE_UNFOLDED)
      e?.preventDefault()
      e?.stopPropagation()
    }
  }, [setProgress])

  // отступление от tweb: там `fold()` = `scrollTo(progress(), false)` — прогресс
  // едет к 1 покадрово за 125 мс (animateSingle). Дробный прогресс имеет смысл
  // только вместе с закороченной ветвью onMove; в бинарном режиме он даёт лишь
  // рваный кадр поверх CSS-перехода, поэтому ставим состояние сразу.
  const fold = useCallback(() => setProgress(STATE_FOLDED), [setProgress])

  // Колесо на .connection-status-bottom (tweb: listenWheelOn, passive: false).
  useEffect(() => {
    const el = optsRef.current.listenWheelOn()
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      const o = optsRef.current
      if (o.shouldIgnore?.()) return

      // tweb: delta = -e.wheelDeltaY (обратный знак к deltaY)
      const delta = -(('wheelDeltaY' in e ? (e as WheelEvent & { wheelDeltaY: number }).wheelDeltaY : -e.deltaY * 3))
      const scrollTop = o.scrollable()?.scrollTop ?? 0

      if (scrollTop && progressRef.current !== STATE_FOLDED) {
        setProgress(STATE_FOLDED)
        clearDebounce()
        return
      }

      if (classifierRef.current.push(e) === 'inertia') return

      const newState = delta < 0 ? STATE_UNFOLDED : STATE_FOLDED
      if ((scrollTop && progressRef.current !== STATE_UNFOLDED) || isDebounced()) {
        debounced()
        return
      }

      if (progressRef.current === newState) return

      e.preventDefault()
      e.stopPropagation()
      setProgress(newState)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  // isTransition — по событиям перехода самого контейнера (tweb 1:1).
  useEffect(() => {
    const el = optsRef.current.container()
    if (!el) return
    const start = (e: TransitionEvent) => { if (e.target === el) setIsTransition(true) }
    const end = (e: TransitionEvent) => { if (e.target === el) setIsTransition(false) }
    el.addEventListener('transitionstart', start)
    el.addEventListener('transitionend', end)
    return () => {
      el.removeEventListener('transitionstart', start)
      el.removeEventListener('transitionend', end)
    }
  })

  useEffect(() => () => clearDebounce(), [])

  return { progress, folded: progress === STATE_FOLDED, isTransition, unfold, fold }
}
