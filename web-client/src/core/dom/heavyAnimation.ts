// Порт tweb `hooks/useHeavyAnimationCheck.ts` (Jolly Cobra's, пропатченный).
//
// Смысл: пока на экране играет ТЯЖЁЛАЯ анимация (переход между экранами, скролл
// к сообщению, круговое раскрытие темы), всё остальное, что жрёт кадры —
// lottie-стикеры, видео-стикеры, гифки — должно встать на паузу, иначе анимация
// дёргается. Модуль — это только шина: кто-то объявляет «идёт тяжёлая анимация»
// (`dispatchHeavyAnimationEvent`), кто-то слушает начало/конец
// (`onHeavyAnimation`) и глушится (у нас — `components/animationIntersector.ts`,
// как в tweb `appImManager.ts:336-342`).
//
// Отличия от tweb:
//   • `deferredPromise`/`CancellablePromise` там общий хелпер, здесь нужен ровно
//     один флаг `isFulfilled` — сделан локально, без нового хелпера;
//   • дефолтный экспорт-хук tweb (подписка + отписка одной функцией) назван
//     `onHeavyAnimation` и отдаёт функцию отписки; отдельный `offHeavyAnimation`
//     оставлен для симметрии (tweb снимает слушателей через ListenerSetter).

/** tweb `helpers/cancellablePromise` в объёме, нужном этому модулю */
type DeferredPromise<T> = Promise<T> & {
  resolve: (value: T) => void
  isFulfilled: boolean
}

function deferredPromise<T>(): DeferredPromise<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((_resolve) => {
    resolve = _resolve
  }) as DeferredPromise<T>

  promise.isFulfilled = false
  promise.resolve = (value: T) => {
    if (promise.isFulfilled) return
    promise.isFulfilled = true
    resolve(value)
  }

  return promise
}

/** tweb `pause` (helpers/schedulers/pause) */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export type HeavyAnimationCallback = () => void

const startCallbacks = new Set<HeavyAnimationCallback>()
const endCallbacks = new Set<HeavyAnimationCallback>()

let isAnimating = false
let heavyAnimationPromise = deferredPromise<void>()
let promisesInQueue = 0

heavyAnimationPromise.resolve()

/**
 * Объявить тяжёлую анимацию. Пока хоть один такой промис не доигран (или не
 * истёк его `timeout`), `isHeavyAnimationInProgress()` истинно, а подписчики
 * держат паузу. Возвращает промис, который резолвится в момент общего конца
 * (tweb useHeavyAnimationCheck.ts:25-56).
 *
 * @param timeout страховка: если промис завис, событие всё равно закончится
 *        (tweb передаёт длительность самой анимации).
 */
export function dispatchHeavyAnimationEvent(promise: Promise<unknown>, timeout?: number): Promise<void> {
  if (!isAnimating) {
    heavyAnimationPromise = deferredPromise<void>()
    startCallbacks.forEach((callback) => callback())
    isAnimating = true
  }

  ++promisesInQueue

  const promises = [
    timeout !== undefined ? pause(timeout) : undefined,
    promise.then(() => {}, () => {}),
  ].filter(Boolean) as Promise<void>[]

  const _heavyAnimationPromise = heavyAnimationPromise
  void Promise.race(promises).then(() => {
    // событие успели прервать/перезапустить — этот счётчик уже не наш
    if (heavyAnimationPromise !== _heavyAnimationPromise || heavyAnimationPromise.isFulfilled) return

    --promisesInQueue
    if (promisesInQueue <= 0) onHeavyAnimationEnd()
  })

  return heavyAnimationPromise
}

function onHeavyAnimationEnd() {
  if (heavyAnimationPromise.isFulfilled) return

  isAnimating = false
  promisesInQueue = 0
  endCallbacks.forEach((callback) => callback())
  heavyAnimationPromise.resolve()
}

/** tweb `interruptHeavyAnimation` — оборвать событие досрочно */
export function interruptHeavyAnimation() {
  onHeavyAnimationEnd()
}

/** tweb `getHeavyAnimationPromise` — «дождаться, пока экран успокоится» */
export function getHeavyAnimationPromise(): Promise<void> {
  return heavyAnimationPromise
}

/** tweb `isAnimating` (там приватный, наружу торчал только через промис) */
export function isHeavyAnimationInProgress(): boolean {
  return isAnimating
}

/**
 * tweb `useHeavyAnimationCheck(onStart, onEnd)` — дефолтный экспорт хука: если
 * анимация уже идёт, `onStart` зовётся сразу (иначе подписчик, созданный посреди
 * перехода, останется незаглушенным). Возвращает функцию отписки.
 */
export function onHeavyAnimation(onStart: HeavyAnimationCallback, onEnd: HeavyAnimationCallback): () => void {
  if (isAnimating) onStart()

  startCallbacks.add(onStart)
  endCallbacks.add(onEnd)

  return () => offHeavyAnimation(onStart, onEnd)
}

export function offHeavyAnimation(onStart: HeavyAnimationCallback, onEnd: HeavyAnimationCallback) {
  startCallbacks.delete(onStart)
  endCallbacks.delete(onEnd)
}
