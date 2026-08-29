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
import liteMode from '@helpers/liteMode'
import whichChild from '@helpers/dom/whichChild'

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

/**
 * Снять с узла таймер уборки от ПРЕДЫДУЩЕГО перехода (tweb
 * `transition.ts:325-330`). Узел, который был уходящим и не успел доехать,
 * держит на себе отложенную уборку — она отберёт у него `active` уже после
 * того, как он снова стал активным, и экран окажется пустым. Ловится это
 * возвратом назад быстрее, чем за `transitionTime` (открыл вкладку — сразу
 * «назад»), поэтому таймер и живёт НА УЗЛЕ, а не в замыкании перехода.
 *
 * Экспортируется, потому что уборку обязана снимать И мгновенная (без
 * анимации) ветка перехода — а она есть не только здесь: своя живёт в
 * `components/settings/kit.tsx`. В tweb этой функции нет: там уборка снимается
 * настоящим `transitionend` (`transition.ts:200-228`), а таймер — лишь
 * страховка; у нас слушателя нет (сознательное отступление, см. ниже), и
 * страховка стала единственным механизмом — значит и снимать её надо руками.
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
    clearPendingTransitionCleanup(to)

    if (from) onTransitionEndCallback = slideNavigation(to, from, toRight)
    else to.classList.add('active')

    to.classList.remove('from')
    to.classList.add('to')
  }

  // tweb дожидается transitionend и страхуется таймаутом (`transition.ts:352`
  // `transitionTime + 100`). Нам достаточно таймаута: слушатель там нужен ради
  // раннего снятия классов, а не ради корректности.
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

    // tweb `transition.ts:342` — таймер уборки принадлежит УХОДЯЩЕЙ вкладке.
    if (from) from.dataset.transitionTimeout = '' + timeout
  })

  void dispatchHeavyAnimationEvent(finished, transitionTime * 2)
}

/**
 * Вкладочник с ПАМЯТЬЮ о текущей вкладке — то, чем в оригинале занимается сам
 * `TransitionSlider` (`tweb components/transition.ts:238-392`), а не
 * `slideNavigation`. `runNavigationTransition` выше — это одно переключение с
 * уже посчитанным направлением; хранение `from`, вычисление `toRight` и
 * мгновенная (без анимации) ветка живут здесь.
 *
 * Заведено под `SidebarSlider` (`components/slider.ts`), который в tweb строит
 * себе ровно `TransitionSlider({content, type: 'navigation', transitionTime})`
 * (`slider.ts:41-45`). Второго движка анимации не появилось: анимационная часть
 * по-прежнему одна — `runNavigationTransition`.
 *
 * Портировано из `selectTab` оригинала (:240-380) в объёме типа `navigation`:
 *  • `content.dataset.animation = type` (:186) — по нему CSS включает
 *    `transition: transform, filter` детям (`styles/tweb/_slider.scss:226-241`);
 *  • `id instanceof HTMLElement → whichChild(id)` (:247-249) и
 *    `prevId = from ? whichChild(from) : -1` (:381) — направление считается
 *    сравнением ИНДЕКСОВ, поэтому узел сразу переводится в индекс;
 *  • `if(id === prevId) return` (:251) — повторный выбор той же вкладки не
 *    перезапускает переход;
 *  • `toRight = prevId < id` (:307);
 *  • гашение анимации (:258-260): выключенные анимации (`liteMode`) и ПЕРВОЕ
 *    переключение (`prevId === -1`) — у `slideNavigation` в оригинале
 *    `animateFirst: false` (:121), поэтому развилка по `animateFirst` схлопнута
 *    в константу, а не портирована опцией без второго значения;
 *  • мгновенная ветка (:270-288) — снять `active/to/from` с уходящей, выдать
 *    `active` приходящей, снять `animating/backwards` с контейнера.
 *
 * `-1` как id (у tweb это `canHideFirst`, `slider.ts:83`) — валидный вход:
 * `children[-1]` даёт `undefined`, и вкладочник закрывается целиком.
 *
 * Не портированы публичные ручки `prevId`/`getFrom`/`setFrom` (:381-383): у нас
 * нет ни одного потребителя, а внутрь `from` и так виден через замыкание.
 *
 * ДОЛГ. Бухгалтерия `from`/`toRight` сейчас в трёх экземплярах: здесь и вручную
 * в `components/chat/ChatsContainer.tsx` и `components/settings/kit.tsx`. Свести
 * их СЮДА нельзя без переписывания обоих: этот вкладочник адресует вкладки
 * ИНДЕКСОМ в `container.children` и сам держит `from`, а у обоих React-хостов
 * `to`/`from` — ref'ы на узлы, которых в детях может не быть (ChatsContainer
 * держит уходящий чат в списке лишний кадр и подрезает список по таймеру), и
 * `toRight` там приходит из доменного состояния (длина стека чатов, «саб
 * открыт»), а не из сравнения индексов. Общее у всех трёх — САМА анимация
 * (`runNavigationTransition`) и снятие чужой уборки
 * (`clearPendingTransitionCleanup`); оба хоста зовут и то, и другое, включая
 * СВОИ мгновенные пути (`ChatsContainer` — layout-эффект активации,
 * `kit.tsx` — ветка выключенных анимаций): пропуск второго в любом из них даёт
 * пустую колонку, это уже случалось в обоих. Копии самой бухгалтерии уйдут
 * вместе с React-экранами (`kit.tsx` — по мере переезда настроек на слайдер).
 *
 * ДОЛГ-2 (доволновой, диффом не введён, заводится отдельной задачей): таймер
 * уборки у нас ОДИН на весь переход и лежит на `from`, тогда как tweb держит
 * раздельные колбэки на `to` и на `_from` (`transition.ts:325-352`). Два
 * анимированных перехода подряд внутри `transitionTime + 100` — и таймер
 * первого снимет `animating`/`backwards` с контейнера посреди второго: переход
 * оборвётся визуальным скачком.
 */
export function createNavigationTransition(container: HTMLElement, transitionTime = NAVIGATION_TRANSITION_TIME) {
  container.dataset.animation = 'navigation'

  let from: HTMLElement | undefined

  return function selectTab(id: number | HTMLElement, animate = true): void {
    if (id instanceof HTMLElement) id = whichChild(id)

    const prevId = from ? whichChild(from) : -1
    if (id === prevId) return

    const to = container.children[id] as HTMLElement | undefined

    if (!liteMode.isAvailable('animations') || prevId === -1) {
      animate = false
    }

    if (!animate) {
      // Мгновенная ветка обязана снимать чужую отложенную уборку так же, как
      // анимированная: приходящая вкладка получает `active` СЕЙЧАС, а таймер
      // от её собственного недавнего ухода снимет его через `transitionTime`
      // — и колонка опустеет. Ветка достижима не только «выключенными
      // анимациями»: сюда же попадает первое переключение (`prevId === -1`) и
      // явный `animate: false` от владельца.
      //
      // Снимается только с ПРИХОДЯЩЕЙ: таймер живёт на уходящей вкладке
      // перехода, а `from` здесь — приходящая ПРОШЛОГО перехода (`from = to`
      // в конце), на ней его не бывает. Симметричная строка `if (from)` была бы
      // не просто мёртвой: сработай она, наш единственный таймер-лямбда
      // «всё сразу» отменил бы заодно снятие `animating`/`backwards`
      // с контейнера.
      if (to) clearPendingTransitionCleanup(to)
      from?.classList.remove('active', 'to', 'from')
      if (to) {
        to.classList.remove('to', 'from')
        to.classList.add('active')
      }
      container.classList.remove('animating', 'backwards')
      from = to
      return
    }

    runNavigationTransition({ container, to, from, toRight: prevId < id, transitionTime })
    from = to
  }
}
