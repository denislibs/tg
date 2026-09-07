// Порт tweb `src/components/transition.ts` (383) — вкладочник `TransitionSlider`
// с обеими функциями анимации: `slideNavigation` (:23-43) и `slideTabs` (:45-95).
//
// Сюда ПЕРЕЕХАЛ бывший `core/dom/navigationTransition.ts`: второй вкладочник в
// репозитории заводить нельзя, а `slideTabs` нужен правой колонке
// (`docs/tweb/shared-media.md` § 2.2, `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`
// задача 3). Оба движка — один и тот же оригинальный файл, различаются только
// callback'ом в карте `transitions` (:141-146).
//
// CSS уже портирован (`styles/tweb/_slider.scss:214-241`, 1:1 с оригиналом):
// по `content.dataset.animation` (:186) вкладкам включается CSS-переход —
// `[data-animation="tabs"] .tabs-tab { transition: transform var(--tabs-transition) }`
// и `[data-animation="navigation"].animating .tabs-tab { transition: transform, filter }`.
// Само движение задаёт JS инлайновыми стилями: элементы разводятся на ±width,
// после reflow инлайн приходящей сбрасывается — и она едет в 0 уже по переходу.
//
// ── Адаптации под наш стек ─────────────────────────────────────────────────
//  • `I18n.getIsRTL()` в `makeTranslate` (:12-14) не портирован: RTL-локалей у
//    нас нет, `langPack.ts:51` его тоже не завёл — зеркалить нечего;
//  • `strictNullChecks` (в tweb выключен): `from`/`to`/`animationFunction`
//    объявлены `| undefined`, `content.children[id]` при `id === -1` даёт
//    `undefined` — это валидный вход (`canHideFirst`, `slider.ts:83`), контейнер
//    закрывается целиком;
//  • `slidePremium` (:97-122) и закомментированный `slideTopics` (:124-139) не
//    портированы: `premiumTabs` у нас негде показать (премиум-вкладок нет), а
//    `topics` мёртв и в оригинале. Тип в союзе оставлен — карта `transitions`
//    для него пуста, и слайдер честно уходит в ветку `animationend`.
//
// ── Единственное отступление в логике ──────────────────────────────────────
// В мгновенной ветке (:271-289) оригинал запускает отложенную уборку
// ПРИХОДЯЩЕЙ вкладки только когда уходящей нет (`else if(to)`, :273-276). У нас
// это не `else`, а самостоятельное `if`. Почему: узел, который был уходящим и
// не успел доехать, держит на себе отложенную уборку — она отберёт у него
// `active` и оставит инлайновый сдвиг уже после того, как он снова стал
// активным, и экран окажется пустым. Ловится возвратом назад быстрее, чем за
// `transitionTime` (открыл вкладку — сразу «назад»). В оригинале эта ветка
// достижима так же (уборка снимается настоящим `transitionend`, который у
// уходящей вкладки всё равно приходит) — то есть это правка бага tweb, а не
// подгонка под наш стек; у нас она подтверждена дважды (#106, #112).
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import { dispatchHeavyAnimationEvent } from '@core/dom/heavyAnimation'
import whichChild from '@helpers/dom/whichChild'
import cancelEvent from '@helpers/dom/cancelEvent'
import type ListenerSetter from '@helpers/listenerSetter'
import liteMode from '@helpers/liteMode'

const USE_3D = true

/** tweb `components/slider.ts:11` — `TRANSITION_TIME` навигационного слайдера. */
export const NAVIGATION_TRANSITION_TIME = 250

/** tweb `transition.ts:11-17`; ветка RTL не портирована (см. шапку). */
function makeTranslate(x: number, y: number) {
  return USE_3D ? `translate3d(${x}px, ${y}px, 0)` : `translate(${x}px, ${y}px)`
}

type TransitionCallback = (tabContent: HTMLElement, prevTabContent: HTMLElement, toRight: boolean) => () => void

type TransitionFunction = {
  callback: TransitionCallback,
  animateFirst: boolean
}

function makeTransitionFunction(options: TransitionFunction) {
  return options
}

/**
 * tweb `slideNavigation.callback` (`transition.ts:23-43`). Уходящая вкладка
 * притормаживает на четверти ширины и притемняется (`brightness(80%)`) — это и
 * есть параллакс, — приходящая въезжает с полной ширины. Возвращает функцию,
 * снимающую инлайн с уходящей по концу перехода.
 *
 * Экспортируется отдельно (в tweb — локальная константа), потому что её зовёт
 * ещё и `runNavigationTransition` ниже.
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

/**
 * tweb `slideTabs.callback` (`transition.ts:45-95`). Симметричный сдвиг на
 * ±width без `filter`: вкладки едут «лентой», как ряд табов профиля. Закрытый
 * в оригинале workaround Jolly Cobra (гашение `overflow-y` на время анимации,
 * :47-54 и :76-91) не портирован — он закомментирован и там.
 */
function slideTabs(tabContent: HTMLElement, prevTabContent: HTMLElement, toRight: boolean) {
  const width = prevTabContent.getBoundingClientRect().width
  const elements = [tabContent, prevTabContent]
  if (toRight) elements.reverse()
  elements[0].style.transform = makeTranslate(-width, 0)
  elements[1].style.transform = makeTranslate(width, 0)
  tabContent.classList.add('active')
  void tabContent.offsetWidth // reflow

  tabContent.style.transform = ''

  return () => {
    prevTabContent.style.transform = ''
  }
}

/** tweb `transition.ts:148` */
export type TransitionSliderType = 'tabs' | 'premiumTabs' | 'navigation' | 'zoom-fade' | 'slide-fade' | 'topics' | 'none' | 'fade'

/** tweb `transition.ts:141-146` */
const transitions: { [type in TransitionSliderType]?: TransitionFunction } = {
  navigation: makeTransitionFunction({ callback: slideNavigation, animateFirst: false }),
  tabs: makeTransitionFunction({ callback: slideTabs, animateFirst: false }),
}

/** tweb `transition.ts:150-162` */
export type TransitionSliderOptions = {
  content: HTMLElement,
  type: TransitionSliderType,
  transitionTime: number,
  onTransitionStart?: (id: number) => void,
  onTransitionStartAfter?: (id: number) => void,
  onTransitionEnd?: (id: number) => void,
  isHeavy?: boolean,
  once?: boolean,
  withAnimationListener?: boolean,
  listenerSetter?: ListenerSetter,
  animateFirst?: boolean
}

/** tweb `TransitionSlider` (`transition.ts:169-381`). */
const TransitionSlider = (options: TransitionSliderOptions) => {
  const {
    content,
    type,
    transitionTime,
    onTransitionEnd,
    onTransitionStart,
    onTransitionStartAfter,
    isHeavy = true,
    once = false,
    withAnimationListener = true,
    listenerSetter,
  } = options
  let animateFirst = options.animateFirst ?? false

  const { callback: animationFunction, animateFirst: _animateFirst } = transitions[type] || {}
  content.dataset.animation = type

  if (_animateFirst !== undefined) {
    animateFirst = _animateFirst
  }

  const onTransitionEndCallbacks: Map<HTMLElement, () => void> = new Map()
  let animationDeferred: CancellablePromise<void> | undefined
  let from: HTMLElement | undefined

  if (withAnimationListener) {
    const listenerName = animationFunction ? 'transitionend' : 'animationend'

    const onEndEvent = (e: Event) => {
      cancelEvent(e)

      if ((e.target as HTMLElement).parentElement !== content) {
        return
      }

      const callback = onTransitionEndCallbacks.get(e.target as HTMLElement)
      callback?.()

      if (e.target !== from) {
        return
      }

      if (!animationDeferred && isHeavy) return

      if (animationDeferred) {
        // `!` — как во всём коде вокруг `CancellablePromise`: `resolve`
        // домешивается `Object.assign` и по типу опционален (см. шапку
        // `helpers/cancellablePromise.ts`), хотя в рантайме всегда есть.
        animationDeferred.resolve!()
        animationDeferred = undefined
      }

      onTransitionEnd?.(selectTab.prevId())

      content.classList.remove('animating', 'backwards', 'disable-hover')

      if (once) {
        if (listenerSetter) listenerSetter.removeManual(content, listenerName, onEndEvent)
        else content.removeEventListener(listenerName, onEndEvent)
        from = animationDeferred = undefined
        onTransitionEndCallbacks.clear()
      }
    }

    if (listenerSetter) listenerSetter.add(content)(listenerName, onEndEvent)
    else content.addEventListener(listenerName, onEndEvent)
  }

  function selectTab(id: number | HTMLElement, animate = true, overrideFrom?: HTMLElement) {
    if (overrideFrom) {
      from = overrideFrom
    }

    if (id instanceof HTMLElement) {
      id = whichChild(id)
    }

    const prevId = selectTab.prevId()
    if (id === prevId) return false

    onTransitionStart?.(id)

    const to = content.children[id] as HTMLElement | undefined

    if (!liteMode.isAvailable('animations') || (prevId === -1 && !animateFirst)) {
      animate = false
    }

    if (!withAnimationListener) {
      const timeout = content.dataset.timeout
      if (timeout !== undefined) {
        clearTimeout(+timeout)
      }

      delete content.dataset.timeout
    }

    if (!animate) {
      if (from) from.classList.remove('active', 'to', 'from')
      // ОТСТУПЛЕНИЕ ОТ ОРИГИНАЛА (:273-276 — там это `else if`), см. шапку файла:
      // отложенную уборку, повисшую на приходящей вкладке от её собственного
      // недавнего ухода, надо доиграть СЕЙЧАС — иначе она отберёт `active` у
      // уже активной вкладки и оставит её сдвинутой инлайном.
      if (to) {
        const callback = onTransitionEndCallbacks.get(to)
        callback?.()
      }

      if (to) {
        to.classList.remove('to', 'from')
        to.classList.add('active')
      }

      content.classList.remove('animating', 'backwards', 'disable-hover')

      from = to

      onTransitionEnd?.(id)
      return
    }

    if (!withAnimationListener) {
      content.dataset.timeout = '' + window.setTimeout(() => {
        to?.classList.remove('to') // `?.` — `strictNullChecks`; у оригинала (:293) голое `to`
        from?.classList.remove('from') // `?.` вместо `from && …` оригинала (:294) — `no-unused-expressions`
        content.classList.remove('animating', 'backwards', 'disable-hover')
        delete content.dataset.timeout
      }, transitionTime)
    }

    if (from) {
      from.classList.remove('to')
      from.classList.add('from')
    }

    content.classList.add('animating')
    const toRight = prevId < id
    content.classList.toggle('backwards', !toRight)

    let onTransitionEndCallback: ReturnType<TransitionCallback> | undefined
    if (to) {
      // `&& from` — страховка `strictNullChecks`, а не развилка: сюда попадают
      // только анимированные переходы, а `animate` гасится при `prevId === -1`
      // (:258), то есть ровно тогда, когда `from` пуст. У оригинала (:313) в
      // этом месте `from` типизирован как всегда заполненный, и вызов
      // `animationFunction(to, null, …)` там просто бросил бы на
      // `getBoundingClientRect`.
      if (animationFunction && from) {
        onTransitionEndCallback = animationFunction(to, from, toRight)
      } else {
        to.classList.add('active')
      }

      onTransitionStartAfter?.(id)

      to.classList.remove('from')
      to.classList.add('to')
    }

    if (to) {
      const transitionTimeout = to.dataset.transitionTimeout
      if (transitionTimeout) {
        clearTimeout(+transitionTimeout)
      }

      onTransitionEndCallbacks.set(to, () => {
        to.classList.remove('to')
        onTransitionEndCallbacks.delete(to)
      })
    }

    if (from) {
      let timeout: number
      const _from = from
      const callback = () => {
        clearTimeout(timeout)
        _from.classList.remove('active', 'from')

        onTransitionEndCallback?.()

        onTransitionEndCallbacks.delete(_from)
      }

      if (to) {
        timeout = window.setTimeout(callback, transitionTime + 100) // something happened to container
        onTransitionEndCallbacks.set(_from, callback)
      } else {
        timeout = window.setTimeout(callback, transitionTime + 100)
        onTransitionEndCallbacks.set(_from, () => {
          clearTimeout(timeout)
          onTransitionEndCallbacks.delete(_from)
        })
      }

      _from.dataset.transitionTimeout = '' + timeout

      if (isHeavy) {
        if (!animationDeferred) {
          animationDeferred = deferredPromise<void>()
        }

        void dispatchHeavyAnimationEvent(animationDeferred, transitionTime * 2)
      }
    }

    from = to
  }

  /** tweb :376-378 — ручки нужны правой колонке (`appSearchSuper.ts`). */
  selectTab.prevId = () => from ? whichChild(from) : -1
  selectTab.getFrom = () => from
  selectTab.setFrom = (_from: HTMLElement | undefined) => from = _from

  return selectTab
}

export default TransitionSlider

// ───────────────────────────────────────────────────────────────────────────
// Ниже — НЕ порт: одно переключение navigation-перехода без памяти о вкладках.
// В tweb такой функции нет, всё делает `TransitionSlider` выше.
//
// ДОЛГ (#112). Бухгалтерия `from`/`toRight` живёт ещё в двух экземплярах —
// вручную в `components/chat/ChatsContainer.tsx` и `components/settings/kit.tsx`.
// Свести их в `TransitionSlider` нельзя без переписывания обоих: слайдер
// адресует вкладки ИНДЕКСОМ в `content.children` и сам держит `from`, а у обоих
// React-хостов `to`/`from` — ref'ы на узлы, которых в детях может не быть
// (`ChatsContainer` держит уходящий чат в списке лишний кадр и подрезает список
// по таймеру), и `toRight` там приходит из доменного состояния (длина стека
// чатов, «саб открыт»), а не из сравнения индексов. Общее у всех трёх — САМА
// анимация и снятие чужой уборки; оба хоста зовут и то, и другое, включая СВОИ
// мгновенные пути (`ChatsContainer` — layout-эффект активации, `kit.tsx` —
// ветка выключенных анимаций): пропуск второго в любом из них даёт пустую
// колонку, это уже случалось в обоих. Копии уйдут вместе с React-экранами.
//
// ДОЛГ-2 (#106). Таймер уборки здесь ОДИН на весь переход и лежит на `from`,
// тогда как `TransitionSlider` держит раздельные колбэки на `to` и на `_from`.
// Два анимированных перехода подряд внутри `transitionTime + 100` — и таймер
// первого снимет `animating`/`backwards` с контейнера посреди второго.
//
// ДОЛГ-3. Императивный вкладочник в репозитории теперь один, но React-слой
// держит СВОИ переписи того же оригинала: `shared/ui/Tabs/TabSlide.tsx` (177) —
// ветка `slideTabs`, потребители `ChatList.tsx`, `SearchView.tsx`,
// `userInfo/SharedMedia.tsx`; `core/hooks/useTransitionSlider.ts` (60) — ветка
// БЕЗ `animationFunction` (`fade`/`slide-fade`/`zoom-fade`, у нас её играют
// кейфреймы `styles/tweb/_transition.scss`), потребитель `UserInfoPanel.tsx`.
// Перевести их на этот файл нельзя, не переписав хосты: там вкладки —
// JSX-дети, а не заранее лежащие в DOM узлы, адресуемые индексом. Обе копии
// уходят вместе со своими React-экранами (`SharedMedia.tsx` — задача 13 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`).

/**
 * Снять с узла таймер уборки от ПРЕДЫДУЩЕГО перехода (`transition.ts:326-329`).
 * Нужна мгновенным путям React-хостов выше: у них нет `selectTab`, а значит и
 * ветки `!animate`, которая делает это сама.
 */
export function clearPendingTransitionCleanup(el: HTMLElement) {
  const pendingTimeout = el.dataset.transitionTimeout
  if (pendingTimeout) {
    clearTimeout(+pendingTimeout)
    delete el.dataset.transitionTimeout
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
 * Одно переключение вкладки: то же, что `selectTab` для типа `navigation`, но
 * с уже посчитанным направлением и без памяти о текущей вкладке. На всё время
 * перехода объявляется тяжёлая анимация (`transition.ts:368`), чтобы
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
    clearPendingTransitionCleanup(to)

    if (from) onTransitionEndCallback = slideNavigation(to, from, toRight)
    else to.classList.add('active')

    to.classList.remove('from')
    to.classList.add('to')
  }

  // Слушателя `transitionend` здесь нет (в отличие от `TransitionSlider`):
  // хосты сами решают, когда узел уходит из DOM, и события может не быть вовсе.
  // Остаётся страховочный таймер оригинала (`transition.ts:350`).
  const finished = new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      onTransitionEndCallback?.()
      to?.classList.remove('to')
      if (from) {
        from.classList.remove('active', 'from')
        delete from.dataset.transitionTimeout
      }
      container.classList.remove('animating', 'backwards')
      resolve()
    }, transitionTime + 100)

    // `transition.ts:360` — таймер уборки принадлежит УХОДЯЩЕЙ вкладке.
    if (from) from.dataset.transitionTimeout = '' + timeout
  })

  void dispatchHeavyAnimationEvent(finished, transitionTime * 2)
}
