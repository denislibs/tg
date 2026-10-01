// Порт tweb `hooks/useHeavyAnimationCheck.ts` (Jolly Cobra's, пропатченный) —
// 1:1 по логике, построчно сверен с tweb 812502980.
//
// Смысл: пока на экране играет ТЯЖЁЛАЯ анимация (переход между экранами, скролл
// к сообщению, лестница открытия чата, круговое раскрытие темы), всё остальное,
// что жрёт кадры — lottie-стикеры, видео-стикеры, гифки — должно встать на
// паузу, иначе анимация дёргается. Модуль — это только шина: кто-то объявляет
// «идёт тяжёлая анимация» (`dispatchHeavyAnimationEvent`), кто-то слушает
// начало/конец (`onHeavyAnimation`) и глушится (у нас —
// `components/animationIntersector.ts`, как в tweb `appImManager.ts:436-442`).
//
// Отличия от tweb:
//   • путь `@core/dom/heavyAnimation`, а не `@hooks/useHeavyAnimationCheck`
//     (шина портирована сюда раньше и на неё завязаны все потребители);
//   • дефолтный экспорт-хук tweb назван `onHeavyAnimation` (потребители
//     импортируют его `as useHeavyAnimationCheck`);
//   • форматирование — под `.oxlintrc.json` (`DEBUG && log()` → `if(DEBUG) log()`).
import ListenerSetter from '@helpers/listenerSetter'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import DEBUG from '@config/debug'
import pause from '@helpers/schedulers/pause'
import EventListenerBase from '@helpers/eventListenerBase'

export type HeavyAnimationCallback = () => void

const eventListener = new EventListenerBase<{
  start: () => void,
  end: () => void
}>()
const ANIMATION_START_EVENT = 'start'
const ANIMATION_END_EVENT = 'end'

let isAnimating = false
let heavyAnimationPromise: CancellablePromise<void> = deferredPromise<void>()
let promisesInQueue = 0

heavyAnimationPromise.resolve!()

const log = console.log.bind(console.log, '[HEAVY-ANIMATION]:')

/**
 * Объявить тяжёлую анимацию (tweb useHeavyAnimationCheck.ts:25-56). Пока хоть
 * один такой промис не доигран (или не истёк его `timeout`), промис
 * `getHeavyAnimationPromise()` не исполнен, а подписчики держат паузу.
 *
 * @param timeout страховка: если промис завис, событие всё равно закончится
 *        (tweb передаёт длительность самой анимации).
 */
export function dispatchHeavyAnimationEvent(promise: Promise<unknown>, timeout?: number) {
  if(!isAnimating) {
    heavyAnimationPromise = deferredPromise<void>()
    eventListener.dispatchEvent(ANIMATION_START_EVENT)
    isAnimating = true
    if(DEBUG) log('start')
  }

  ++promisesInQueue
  if(DEBUG) log('attach promise, length:', promisesInQueue, timeout)

  const promises = [
    timeout !== undefined ? pause(timeout) : undefined,
    promise.finally(() => {}),
  ].filter(Boolean) as Promise<unknown>[]

  const perf = performance.now()
  const _heavyAnimationPromise = heavyAnimationPromise
  void Promise.race(promises).then(() => {
    if(heavyAnimationPromise !== _heavyAnimationPromise || heavyAnimationPromise.isFulfilled) { // interrupted
      return
    }

    --promisesInQueue
    if(DEBUG) log('promise end, length:', promisesInQueue, performance.now() - perf)
    if(promisesInQueue <= 0) {
      onHeavyAnimationEnd()
    }
  })

  return heavyAnimationPromise
}

(window as unknown as Record<string, unknown>).dispatchHeavyAnimationEvent = dispatchHeavyAnimationEvent

function onHeavyAnimationEnd() {
  if(heavyAnimationPromise.isFulfilled) {
    return
  }

  isAnimating = false
  promisesInQueue = 0
  eventListener.dispatchEvent(ANIMATION_END_EVENT)
  heavyAnimationPromise.resolve!()

  if(DEBUG) log('end')
}

/** tweb `interruptHeavyAnimation` — оборвать событие досрочно */
export function interruptHeavyAnimation() {
  onHeavyAnimationEnd()
}

/** tweb `getHeavyAnimationPromise` — «дождаться, пока экран успокоится»;
 *  `!getHeavyAnimationPromise().isFulfilled` — «анимация идёт». */
export function getHeavyAnimationPromise() {
  return heavyAnimationPromise
}

/**
 * tweb `useHeavyAnimationCheck(onStart, onEnd, listenerSetter?)` — дефолтный
 * экспорт хука (:79-101): если анимация уже идёт, `onStart` зовётся сразу
 * (иначе подписчик, созданный посреди перехода, останется незаглушенным).
 * С `listenerSetter` подписку снимает его `removeAll()`; в любом случае
 * возвращается функция отписки.
 */
export function onHeavyAnimation(
  handleAnimationStart: HeavyAnimationCallback,
  handleAnimationEnd: HeavyAnimationCallback,
  listenerSetter?: ListenerSetter,
) {
  if(isAnimating) {
    handleAnimationStart()
  }

  const add = listenerSetter ? listenerSetter.add(eventListener) : eventListener.addEventListener.bind(eventListener)
  const remove = listenerSetter ? listenerSetter.removeManual.bind(listenerSetter, eventListener) : eventListener.removeEventListener.bind(eventListener)
  add(ANIMATION_START_EVENT, handleAnimationStart)
  add(ANIMATION_END_EVENT, handleAnimationEnd)

  return () => {
    remove(ANIMATION_END_EVENT, handleAnimationEnd)
    remove(ANIMATION_START_EVENT, handleAnimationStart)
  }
}
