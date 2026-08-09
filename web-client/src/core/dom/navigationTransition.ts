// Порт JS-части navigation-перехода из tweb: `slideNavigation`
// (`components/transition.ts:23-42`) + бухгалтерия классов из `TransitionSlider`
// (`components/transition.ts:238-392`).
//
// CSS уже портирован (`styles/tweb/_slider.scss:226-241`): у контейнера
// `[data-animation="navigation"].animating` детям-вкладкам включается
// `transition: transform, filter` (при `.backwards` — с out-кривой). Само
// движение задаёт JS инлайновыми стилями: уходящая вкладка притормаживает на
// четверть ширины и притемняется (`brightness(80%)`) — это и есть параллакс,
// приходящая въезжает с полной ширины. После reflow инлайн сбрасывается, и
// вкладки едут в 0 уже по CSS-переходу.
import { dispatchHeavyAnimationEvent } from './heavyAnimation'

/** tweb `components/slider.ts:11` */
export const NAVIGATION_TRANSITION_TIME = 250

/** tweb `transition.ts:11-17` — USE_3D = true; RTL у нас нет, зеркалить нечего */
function makeTranslate(x: number, y: number) {
  return `translate3d(${x}px, ${y}px, 0)`
}

/**
 * tweb `slideNavigation.callback` (`transition.ts:23-42`).
 * Возвращает функцию, снимающую инлайн с уходящей вкладки по концу перехода.
 */
export function slideNavigation(tabContent: HTMLElement, prevTabContent: HTMLElement, toRight: boolean) {
  const width = prevTabContent.getBoundingClientRect().width
  const elements = [tabContent, prevTabContent]
  if (toRight) elements.reverse()
  elements[0].style.filter = 'brightness(80%)'
  elements[0].style.transform = makeTranslate(-width * 0.25, 0)
  elements[1].style.transform = makeTranslate(width, 0)

  tabContent.classList.add('active')
  void tabContent.offsetWidth // reflow

  tabContent.style.transform = ''
  tabContent.style.filter = ''

  return () => {
    prevTabContent.style.transform = prevTabContent.style.filter = ''
  }
}

export interface NavigationTransitionOptions {
  /** контейнер-вкладочник, `[data-animation="navigation"]` */
  container: HTMLElement
  /** приходящая вкладка; её может не быть, если контейнер закрывается целиком */
  to?: HTMLElement | null
  /** уходящая вкладка; её может не быть (её двигает другой слой) */
  from?: HTMLElement | null
  /** true — идём «вперёд» по стеку экранов (индекс растёт), false — назад */
  toRight: boolean
  /** длительность перехода; должна совпадать с CSS */
  transitionTime?: number
}

/**
 * Одно переключение вкладки. Делает то же, что `TransitionSlider.selectTab` для
 * типа `navigation`: ставит контейнеру `animating`/`backwards`, раздаёт вкладкам
 * `from`/`to`/`active`, запускает параллакс и на всё время перехода объявляет
 * тяжёлую анимацию (tweb `transition.ts:368`
 * `dispatchHeavyAnimationEvent(animationDeferred, transitionTime * 2)`), чтобы
 * интерсектор погасил стикеры/видео и переход не дёргался.
 */
export function runNavigationTransition(options: NavigationTransitionOptions) {
  const { container, to, from, toRight, transitionTime = NAVIGATION_TRANSITION_TIME } = options

  container.classList.add('animating')
  container.classList.toggle('backwards', !toRight)

  if (from) {
    from.classList.remove('to')
    from.classList.add('from')
  }

  let onTransitionEndCallback: (() => void) | undefined
  if (to) {
    if (from) onTransitionEndCallback = slideNavigation(to, from, toRight)
    else to.classList.add('active')

    to.classList.remove('from')
    to.classList.add('to')
  }

  // tweb дожидается transitionend и страхуется таймаутом (`transition.ts:352`
  // `transitionTime + 100`). Нам достаточно таймаута: слушатель там нужен ради
  // раннего снятия классов, а не ради корректности.
  const finished = new Promise<void>((resolve) => {
    setTimeout(() => {
      onTransitionEndCallback?.()
      to?.classList.remove('to')
      from?.classList.remove('active', 'from')
      container.classList.remove('animating', 'backwards')
      resolve()
    }, transitionTime + 100)
  })

  void dispatchHeavyAnimationEvent(finished, transitionTime * 2)
}
