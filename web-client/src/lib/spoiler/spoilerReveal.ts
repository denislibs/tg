// Раскрытие спойлера БЕЗ оверлея частиц — порт tweb `onSpoilerClick`
// (lib/appImManager.ts:511) поверх SetTransition (components/singleTransition.ts).
//
// Это же и режим деградации: когда WebGL2/воркера/анимаций нет, оверлея в DOM
// нет, и текст прячет чистый CSS из `styles/tweb/_spoiler.scss`
// (`.spoiler{background-color}` + `.spoiler-text{opacity:0}`). Клик снимает
// заливку на 5 секунд и возвращает её обратно.
import { animationsEnabled } from './spoilerSupport'

const CLASS_NAME = 'is-spoiler-visible'
const DURATION = 400 / 2 // tweb onSpoilerClick
const SHOW_DURATION = 5000

const timers = new WeakMap<HTMLElement, number[]>()

const clearTimers = (element: HTMLElement) => {
  timers.get(element)?.forEach(clearTimeout)
  timers.delete(element)
}

/**
 * Раскрывает спойлер, внутри которого кликнули.
 * `true` — событие надо погасить (tweb гасит клик только на закрытом спойлере,
 * чтобы он не долетел до обработчиков бабла).
 */
export function revealSpoiler(spoilerElement: HTMLElement): boolean {
  const container =
    (spoilerElement.closest('.spoilers-container') as HTMLElement | null) ??
    spoilerElement.parentElement
  if (!container) return false

  // оверлей частиц раскрывает сам, своей анимацией — CSS-путь ему не мешаем
  if (container.querySelector('.message-spoiler-overlay')) return false

  const wasVisible = container.classList.contains(CLASS_NAME)
  clearTimers(container)

  if (!animationsEnabled()) {
    container.classList.add(CLASS_NAME, 'forwards')
    container.classList.remove('animating')
    timers.set(container, [
      window.setTimeout(() => {
        container.classList.remove(CLASS_NAME, 'forwards')
        clearTimers(container)
      }, SHOW_DURATION),
    ])
    return !wasVisible
  }

  const list: number[] = []
  timers.set(container, list)

  container.classList.add(CLASS_NAME, 'forwards', 'animating')
  list.push(
    window.setTimeout(() => container.classList.remove('animating'), DURATION),
    window.setTimeout(() => {
      // обратный ход: класс остаётся до конца перехода (так же ведёт себя SetTransition)
      container.classList.add('animating', 'backwards')
      container.classList.remove('forwards')
      list.push(
        window.setTimeout(() => {
          container.classList.remove('animating', 'backwards', CLASS_NAME)
          clearTimers(container)
        }, DURATION),
      )
    }, DURATION + SHOW_DURATION),
  )

  return !wasVisible
}
