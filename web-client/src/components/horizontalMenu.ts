// Порт tweb `src/components/horizontalMenu.ts` (215) — полоса вкладок: клик по
// вкладке, класс `active`, автоцентрирование выбранной вкладки в горизонтальном
// скроллере и «полоска от Jolly Cobra» — подчёркивание активной вкладки,
// которое ЕДЕТ от прежней вкладки к новой (`tweb:104-127`).
//
// Как устроено подчёркивание. У каждой вкладки лежит собственный
// `i.menu-horizontal-div-item-background` — абсолютный слой на всю вкладку,
// видимый только у активной (`opacity: 0` → `1` по классу `active`,
// `styles/tweb/_slider.scss:108-121`, партиал совпадает с оригиналом
// `tweb/src/scss/partials/_slider.scss` строка в строку). Анимации «одна
// полоска переезжает» нет физически: перед сменой активной вкладки полоска
// ПРИХОДЯЩЕЙ мгновенно ставится туда, где стоит полоска уходящей (сдвиг
// `translate3d` на разницу `offsetLeft` вкладок + подмена ширины на ширину
// прежней), а следующим кадром ей возвращают её собственные место и ширину уже
// с классом `animate`, у которого в CSS есть `transition: transform, width`
// (`_slider.scss:122-124`). Два кадра обязательны: без разрыва reflow'ом
// браузер схлопнет постановку и снятие в одно вычисление и перехода не будет.
//
// Отступления от оригинала (осознанные, см. отчёт задачи 4):
//
//  1. Слайдер СОДЕРЖИМОГО можно подменить (`createSelectTab`), тогда как
//     оригинал зовёт `TransitionSlider` прямо в теле (`tweb:141-147`). По
//     умолчанию тут и стоит настоящий `TransitionSlider` из
//     `components/transition.ts` — потребители получают оригинальное поведение,
//     а параметр остаётся швом для пинов полосы: они проверяют полосу, а не
//     бухгалтерию классов слайдера, у которой свой файл тестов.
//  2. Позиционная форма `horizontalMenu(tabs, content, onClick, …)` не
//     портирована: она в tweb нужна ради 40 старых мест вызова, у нас
//     потребитель один (`AppSearchSuper`, задача 5) и он новый. Осталась
//     объектная — `horizontalMenuObjArgs` оригинала (`tweb:135-137`).
//  3. Ветка `if(!tabs) return _selectTab` (`tweb:155-157`) не портирована: она
//     обслуживает вызовы «слайдер без полосы вкладок» (tweb `slider.ts:23`).
//     У нас такой потребитель зовёт слайдер напрямую, и ветка была бы мёртвой.
import TransitionSlider from '@components/transition'
import fastSmoothScroll, { FocusDirection } from '@helpers/fastSmoothScroll'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import whichChild from '@helpers/dom/whichChild'
import type ListenerSetter from '@helpers/listenerSetter'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { fastRaf } from '@helpers/schedulers'
import liteMode from '@helpers/liteMode'

/**
 * Время перехода между вкладками, мс — литерал `200` оригинала
 * (`tweb/src/components/horizontalMenu.ts:48` и `:139`, дважды одно и то же
 * число).
 *
 * Число обязано совпадать с CSS-переменной `--tabs-transition`
 * (`styles/_tokens.scss` ← tweb `scss/base.scss:60`): по ней CSS играет сам
 * переезд вкладок и подчёркивания (`styles/tweb/_slider.scss:114,215`), а по
 * этому числу JS считает страховочный таймер уборки (`transition.ts`,
 * `transitionTime + 100`) и длительность доводки полосы вкладок
 * (`fastSmoothScroll({forceDuration})` ниже). Разъедутся — подчёркивание
 * доиграет раньше содержимого, а ряд доедет позже обоих.
 *
 * Совпадение пинится тестом `horizontalMenu.test.ts` («время перехода
 * запинено на CSS-переменную»): он читает `_tokens.scss` и сверяет числа.
 */
export const TABS_TRANSITION_TIME = 200

type OnChangeArgs = {
  element: HTMLElement
  active: boolean
}

/**
 * Горизонтальный скроллер полосы вкладок. В tweb сюда принимают
 * `ScrollableX | ScrollableContextValue` (`tweb:22`) — обоим нужен только
 * `container`, поэтому тип структурный: наш `components/scrollable.ts`
 * `ScrollableX` подходит без обёрток, а `scrollable2` у нас нет вовсе.
 */
export type ScrollableXLike = { container: HTMLElement }

/** Слайдер содержимого — то, что в tweb возвращает `TransitionSlider`. */
export type SelectTab = ((id: number | HTMLElement, animate?: boolean) => void) & {
  /**
   * Индекс вкладки, активной ПРЯМО СЕЙЧАС, то есть до предстоящего переключения
   * (`tweb transition.ts:376`: внутри слайдера это поле `from`, а `from = to`
   * присваивается только в конце `selectTab`). -1 — переключений ещё не было.
   * От этого индекса полоса считает сдвиг подчёркивания: верни слайдер индекс
   * НОВОЙ вкладки — подчёркивание поехало бы само от себя, то есть никуда.
   */
  prevId: () => number
}

export type CreateSelectTab = (options: {
  content: HTMLElement
  type: 'tabs' | 'navigation'
  transitionTime: number
  onTransitionEnd?: () => void
  listenerSetter?: ListenerSetter
}) => SelectTab

type Args = {
  tabs: HTMLElement
  content: HTMLElement
  /** по умолчанию — `TransitionSlider` (`components/transition.ts`), как в оригинале */
  createSelectTab?: CreateSelectTab
  onClick?: (id: number, tabContent: HTMLElement, animate: boolean) => void | boolean | Promise<void | boolean>
  onTransitionEnd?: () => void
  transitionTime?: number
  scrollableX?: ScrollableXLike
  listenerSetter?: ListenerSetter
  onChange?: (args: OnChangeArgs) => void
}

export type SelectTargetArgs = {
  target: HTMLElement
  id: number
  animate?: boolean
  tabs: HTMLElement
  content?: HTMLElement
  onClick?: Args['onClick']
  scrollableX?: Args['scrollableX']
  transitionTime?: number
  prevId?: number
  selectTab?: (id: number, animate: boolean) => void
  onChange?: Args['onChange']
}

/**
 * Одно переключение вкладки — `tweb:41-131`. Вынесено в оригинале отдельно,
 * потому что зовётся и в обход полосы (tweb `popups/pickUser.tsx:27`).
 */
export async function selectTarget({
  target,
  id,
  animate = true,
  tabs,
  content,
  onClick,
  scrollableX,
  transitionTime = TABS_TRANSITION_TIME,
  prevId = -1,
  selectTab,
  onChange,
}: SelectTargetArgs) {
  if (onClick) {
    const tabContent = content?.children[id] as HTMLElement
    const result1 = onClick(id, tabContent, animate)
    const canChange = result1 instanceof Promise ? await result1 : result1
    if (canChange === false) {
      return
    }
  }

  if (scrollableX) {
    const containerEl = scrollableX.container
    // Skip the scroll round-trip when there's no actual scrolling to do:
    //   - row has no horizontal overflow (every tab is already visible)
    //   - selecting the first tab while already at scrollLeft 0 (you can't
    //     scroll past the start to "center" it, so fastSmoothScroll
    //     clamps path to 0 and no-ops anyway)
    // Common at the moment the search panel opens — `selectTab(0)` runs
    // against a row whose scroll position is the default 0.
    const noOverflow = containerEl.scrollWidth <= containerEl.clientWidth
    const isFirstAndAtStart = id === 0 && containerEl.scrollLeft === 0
    if (!noOverflow && !isFirstAndAtStart) {
      // `void` — наша правка под oxlint (`no-floating-promises`): обещание
      // скролла в оригинале так же никем не ожидается.
      void fastSmoothScroll({
        container: containerEl,
        element: target.parentElement!.children[id] as HTMLElement,
        position: 'center',
        forceDirection: animate ? undefined : FocusDirection.Static,
        forceDuration: transitionTime,
        axis: 'x',
      })
    }
  }

  if (!liteMode.isAvailable('animations')) {
    animate = false
  }

  if (target.classList.contains('active') || id === prevId) {
    return false
  }

  const mutateCallback = animate ? fastRaf : (cb: () => void) => cb()

  const prev = tabs.querySelector(tabs.firstElementChild!.tagName.toLowerCase() + '.active') as HTMLElement | null
  if (prev) {
    mutateCallback(() => {
      prev.classList.remove('active')
      onChange?.({ element: prev, active: false })
    })
  }

  // a great stripe from Jolly Cobra
  if (prevId !== -1 && animate) {
    const selector = '.menu-horizontal-div-item-background'
    mutateCallback(() => {
      const indicator = target.querySelector(selector)! as HTMLElement
      const currentIndicator = target.parentElement!.children[prevId].querySelector(selector)! as HTMLElement

      currentIndicator.classList.remove('animate')
      indicator.classList.remove('animate')

      const shiftLeft = currentIndicator.parentElement!.offsetLeft - indicator.parentElement!.offsetLeft
      const clientWidth = indicator.clientWidth
      const scaleFactor = currentIndicator.clientWidth / clientWidth
      indicator.style.transform = `translate3d(${shiftLeft}px, 0, 0)`
      indicator.style.width = `${clientWidth * scaleFactor}px`

      fastRaf(() => {
        indicator.classList.add('animate')
        indicator.style.transform = 'none'
        indicator.style.width = ''
      })
    })
  }

  mutateCallback(() => {
    target.classList.add('active')
    onChange?.({ element: target, active: true })
  })

  selectTab?.(id, animate)
}

/**
 * Полоса вкладок целиком — `tweb:139-215` (объектная форма `tweb:135-137`).
 * Возвращает `selectTab` слайдера, обёрнутый прокси: вызов «снаружи»
 * (`selectTab(2)`) обязан переключить не только содержимое, но и саму полосу —
 * иначе подчёркивание останется на прежней вкладке (`tweb:172-188`).
 */
export function horizontalMenu({
  tabs,
  content,
  createSelectTab = TransitionSlider,
  onClick,
  onTransitionEnd,
  transitionTime = TABS_TRANSITION_TIME,
  scrollableX,
  listenerSetter,
  onChange,
}: Args) {
  const _selectTab = createSelectTab({
    content,
    type: tabs || content.dataset.animation === 'tabs' ? 'tabs' : 'navigation',
    transitionTime,
    onTransitionEnd,
    listenerSetter,
  })

  const _selectTarget = (target: HTMLElement, id: number, animate = true) => {
    return selectTarget({
      target,
      id,
      animate,
      tabs,
      content,
      onClick,
      scrollableX,
      transitionTime,
      prevId: _selectTab.prevId(),
      selectTab: _selectTab,
      onChange,
    })
  }

  const proxy = new Proxy(_selectTab, {
    apply: (_target, _that, args) => {
      const animate = args[1] !== undefined ? args[1] : true

      let id: number, el: HTMLElement
      if (args[0] instanceof HTMLElement) {
        id = whichChild(args[0])
        el = args[0]
      } else {
        id = +args[0]
        el = (tabs.querySelector(`[data-tab="${id}"]`) || tabs.children[id]) as HTMLElement
      }

      void _selectTarget(el, id, animate)
    },
  })

  attachClickEvent(tabs, (e) => {
    let target = e.target as HTMLElement | null
    target = findUpAsChild(target, tabs)
    if (!target) return false

    let id: number
    if (target.dataset.tab) {
      id = +target.dataset.tab
      if (id === -1) {
        return false
      }
    } else {
      id = whichChild(target)
    }

    void _selectTarget(target, id)
  }, { listenerSetter })

  return proxy
}
