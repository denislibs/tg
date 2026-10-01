/**
 * Порт tweb `src/hooks/useCollapsable.ts` (812502980) — файлом, на Solid.
 * Сворачивание шапки-карусели аватаров по колесу/свайпу: прогресс двоичный
 * (`onMove` оригинала начинается с `if(isWheel || true)`, дробная ветка
 * закорочена), стартовое состояние — свёрнуто, плавность даёт CSS-переход
 * контейнера.
 *
 * Первый потребитель — корень настроек (`sidebarLeft/tabs/settings.solid.tsx`,
 * своя шапка профиля: `PeerProfileAvatars` + этот хук, как tweb
 * `peerProfileAvatars.ts:350-373` делает внутри класса). React-двойник для
 * правой панели и ряда историй — `core/hooks/useCollapsable.ts` (долг
 * `backlogs/frontend/collapsable-solid-owner.md`: сведётся к этому файлу, когда
 * владельцы переедут на Solid).
 *
 * Расхождения с оригиналом:
 *  1. Пути импортов: `SwipeHandler` — `@core/dom/swipeHandler` (у tweb
 *     `@components/swipeHandler`), `WheelClassifier` — `@shared/lib/wheelClassifier`
 *     (у tweb `@helpers/dom/wheelClassifier`). Код классов — порт тех же файлов.
 *  2. Мёртвая дробная ветка `onMove` (после `if(isWheel || true) {…; return}`)
 *     и мёртвое тело `onScrolled` (начинается с `return;`) не перенесены: они
 *     недостижимы и у оригинала. Живым остался только сторожевой `debounced`
 *     (его `isDebounced`/`clearTimeout` читает живая ветка). Вместе с ними ушли
 *     `scrollTo`-анимация, которую зовёт лишь `fold()`, — см. п. 3.
 *  3. `fold()` у оригинала — `scrollTo(progress(), false)`: 125-мс
 *     `animateSingle` прогресса к 1. Прогресс двоичный (0 или 1), поэтому
 *     анимация из 0 даёт одно промежуточное дробное значение и 1, а из 1 — сразу
 *     1: наблюдаемый итог — `setProgress(STATE_FOLDED)` в следующем кадре.
 *     Здесь — тот же итог без промежуточных кадров (`clearAnimation` +
 *     `setProgress`), как у `unfold` оригинала.
 */
import SwipeHandler from '@core/dom/swipeHandler'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { cancelAnimationByKey } from '@helpers/animation'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import WheelClassifier from '@shared/lib/wheelClassifier'
import liteMode from '@helpers/liteMode'
import debounce from '@helpers/schedulers/debounce'
import noop from '@helpers/noop'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import { createSignal, createMemo, onCleanup, createEffect } from 'solid-js'

const STATE_FOLDED = 1
const STATE_UNFOLDED = 0

export function useCollapsable(props: {
  scrollable: () => HTMLElement,
  listenWheelOn: HTMLElement,
  container: () => HTMLElement,
  shouldIgnore?: () => boolean,
  skipAnimationClassName?: string,
  disableHoverWhenFolded?: boolean
}) {
  const [progress, _setProgress] = createSignal(STATE_FOLDED)
  const [isTransition, setIsTransition] = createSignal(false)
  const folded = createMemo(() => progress() === STATE_FOLDED)

  const setProgress = (progress: number, skipAnimation?: boolean) => {
    if(liteMode.isAvailable('animations') && !skipAnimation) setIsTransition(true)
    _setProgress(progress)
  }

  const clearAnimation = () => {
    cancelAnimationByKey(props.container())
  }

  // tweb :62-72 — тело `onScrolled` мертво (расхождение 2), жив только таймер
  const debounced = debounce(noop, 75, false, true)
  const classifier = new WheelClassifier()

  const onMove = (delta: number, e?: WheelEvent | TouchEvent) => {
    const scrollTop = props.scrollable().scrollTop
    const isWheel = !!e && 'deltaY' in e // cross-realm-safe `instanceof WheelEvent` (Document PiP window)
    if(scrollTop && progress() !== STATE_FOLDED) {
      setProgress(STATE_FOLDED)
      debounced.clearTimeout()
      return
    }

    if(isWheel) {
      const type = classifier.push(e as WheelEvent)
      if(type === 'inertia') {
        return
      }
    }

    const newState = delta < 0 ? STATE_UNFOLDED : STATE_FOLDED
    if((scrollTop && progress() !== STATE_UNFOLDED) || debounced.isDebounced()) {
      void debounced()
      return
    }

    if(progress() === newState) {
      return
    }

    if(e) cancelEvent(e)
    setProgress(newState)
  }

  const onWheel = (e: WheelEvent) => {
    if(props.shouldIgnore?.()) {
      return
    }

    // tweb :133-138: `deltaY` — стандартный аналог `-wheelDeltaY` с тем же знаком.
    onMove(e.deltaY, e)
  }
  subscribeOn(props.listenWheelOn)('wheel', onWheel, { passive: false })

  if(IS_TOUCH_SUPPORTED) {
    const swipeHandler = new SwipeHandler({
      element: props.listenWheelOn,
      onSwipe: (_xDiff, yDiff, e) => {
        const delta = -yDiff
        onMove(delta, e as unknown as TouchEvent)
      },
      cancelEvent: false,
      cursor: '',
      verifyTouchTarget: (e) => {
        return e instanceof TouchEvent && !props.shouldIgnore?.() && !findUpClassName(e.target as HTMLElement, 'folders-tabs-scrollable')
      },
    })

    onCleanup(() => {
      swipeHandler.removeListeners()
    })
  }

  const unfold = (e?: { preventDefault: () => void, stopPropagation: () => void }) => {
    const wasProgress = progress()
    if(wasProgress !== STATE_UNFOLDED) {
      clearAnimation()
      setProgress(STATE_UNFOLDED)
      if(e) cancelEvent(e as Event)
    }
  }

  // расхождение 3
  const fold = () => {
    clearAnimation()
    setProgress(STATE_FOLDED)
  }

  createEffect(() => {
    const container = props.container()
    if(!container) {
      return
    }

    container.classList.toggle('disable-hover', (props.disableHoverWhenFolded ? folded() : false) || isTransition())
    if(props.skipAnimationClassName) container.classList.toggle(props.skipAnimationClassName, folded() && !isTransition())
  })

  createEffect(() => {
    const container = props.container()
    if(!container) {
      return
    }

    subscribeOn(container)('transitionstart', (e) => e.target === container && setIsTransition(true))
    subscribeOn(container)('transitionend', (e) => e.target === container && setIsTransition(false))
  })

  return { folded, unfold, fold, progress, clearAnimation, isTransition, STATE_FOLDED, STATE_UNFOLDED }
}
