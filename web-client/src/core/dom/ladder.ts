// Порт tweb `components/chat/bubbles.ts:10363-10460` (внутренняя функция
// `animateAsLadder` и всё, что вокруг неё) — «лестница» появления баблов при
// открытии чата.
//
// Ключевое отличие от того, что было у нас: анимируется НЕ ряд `.bubble`, а его
// последний ребёнок `.bubble-content-wrapper` (tweb bubbles.ts:10379
// `bubble.lastElementChild`), плюс аватар группы у последнего сообщения серии
// (bubbles.ts:10386-10390). Сам переход описан CSS'ом портированного партиала
// (`styles/tweb/_chatBubble.scss:3210-3222`):
//   .can-zoom-fade           → transform: scale(1); opacity: 1; transition: var(--bubble-transition-in)
//   .can-zoom-fade.zoom-fade → transform: scale3d(.8,.8,1); opacity: 0
// то есть стартовое состояние ставится классом `zoom-fade`, а снятие класса в
// следующем кадре и запускает переход. Точка отсчёта (transform-origin) у входящих
// и исходящих разная — это тоже в партиале (_chatBubble.scss:3360-3366, :3475-3481).
//
// ЗДЕСЬ — только механика анимации. Кого именно и в каком порядке анимировать
// (три списка `topIds`/`middleIds`/`bottomIds` относительно сообщения, к
// которому прыгаем, — tweb bubbles.ts:10352-10355) решает владелец баблов:
// `components/chat/bubbles.ts::animateAsLadder`.
//
// Отличия от tweb (осознанные):
//   • страховочный таймер: при `body.animation-level-0` CSS-перехода нет вообще
//     (`@include animation-level(2)` в партиале), `transitionend` не придёт и
//     лестница никогда бы не убралась. tweb от этого закрыт таймаутом внутри
//     `dispatchHeavyAnimationEvent`, но там таймаут гасит только heavy-animation,
//     а чистку классов вешает на промис — нам нужен свой резолв;
//   • пустой набор шагов не трогает ленту вовсе. В tweb ветка `if(topIds.length
//     || middleIds.length || bottomIds.length)` (:10435) при полностью пустом
//     наборе оставляет на `chatInner` навешанный `zoom-fading` навсегда —
//     повторять эту ветку нечем, у неё нет предмета.
import { dispatchHeavyAnimationEvent } from './heavyAnimation'

/** tweb bubbles.ts:10437 — длительность самого перехода (--bubble-transition-in) */
const TRANSITION_TIME = 300

/** Один шаг лестницы: обёртка бабла и (опционально) аватар его группы — они едут
 *  вместе, с одной задержкой (tweb `elementsToAnimate`, bubbles.ts:10384-10391). */
export type LadderStep = HTMLElement | HTMLElement[]

/** Один список лестницы — то, что в tweb получает внутренняя `animateAsLadder
 *  (fullMids, offsetIndex)` (bubbles.ts:10366). Списков три, у каждого свой
 *  отсчёт задержек, но `zoom-fading`, чистка и тяжёлая анимация — общие на все
 *  (:10420-10453). */
export interface LadderList {
  steps: LadderStep[]
  /** tweb bubbles.ts:10375 — сдвиг индекса, с которого начинается отсчёт задержек */
  offsetIndex?: number
}

/**
 * Порт tweb bubbles.ts:10361-10461 — каскад из НЕСКОЛЬКИХ списков.
 * `delay` — общий шаг задержки (:10364).
 */
export function animateLadderLists(
  chatInner: HTMLElement,
  lists: LadderList[],
  { delay = 40 }: { delay?: number } = {},
): Promise<void> {
  if (!lists.some((list) => list.steps.length)) return Promise.resolve()

  chatInner.classList.add('zoom-fading')

  // Все узлы, которых лестница коснулась, — по ним же идёт чистка в конце
  // (tweb `setBubbles`, bubbles.ts:10361).
  const touched: HTMLElement[] = []
  const delays: number[] = []
  const promises: Promise<void>[] = []

  for (const { steps, offsetIndex = 0 } of lists) {
    let lastMsDelay = 0
    let last: HTMLElement | undefined
    steps.forEach((step, idx) => {
      // tweb bubbles.ts:10375 — `(idx + offsetIndex) || 0.1`: нулевой индекс без
      // сдвига даёт не 0, а 0.1 шага, иначе первый бабл стартовал бы без задержки
      // и лестница начиналась бы «рывком».
      lastMsDelay = ((idx + offsetIndex) || 0.1) * delay
      const elements = Array.isArray(step) ? step : [step]
      for (const el of elements) {
        el.classList.add('zoom-fade', 'can-zoom-fade')
        el.style.setProperty('transition-delay', `${lastMsDelay}ms`, 'important')
        touched.push(el)
      }
      // tweb ждёт `transitionend` только на обёртке ПОСЛЕДНЕГО шага списка
      // (bubbles.ts:10393-10403)
      last = elements[0]
    })

    delays.push(lastMsDelay)

    const target = last
    promises.push(new Promise<void>((resolve) => {
      // tweb bubbles.ts:10410-10412 — пустой список резолвится сразу
      if (!target) { resolve(); return }
      const onEnd = (e: TransitionEvent) => {
        // событие всплывает из детей бабла — нас интересует только сама обёртка
        if (e.target !== target) return
        target.removeEventListener('transitionend', onEnd)
        resolve()
      }
      target.addEventListener('transitionend', onEnd)
      // страховка: при animation-level-0 перехода нет и transitionend не придёт
      window.setTimeout(resolve, lastMsDelay + TRANSITION_TIME + 50)
    }))
  }

  requestAnimationFrame(() => {
    for (const el of touched) el.classList.remove('zoom-fade')
  })

  // tweb bubbles.ts:10436-10440 — весь каскад объявлен тяжёлой анимацией:
  // animationIntersector глушит лотти/видео/гифки, иначе десяток играющих стикеров
  // конкурирует с лестницей за кадры. Таймаут — по САМОЙ ДОЛГОЙ ветке (:10438).
  const timeout = Math.max(...delays) + TRANSITION_TIME
  return dispatchHeavyAnimationEvent(Promise.all(promises), timeout).then(() => {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        for (const el of touched) {
          el.style.transitionDelay = ''
          el.classList.remove('can-zoom-fade')
        }
        chatInner.classList.remove('zoom-fading')
        resolve()
      })
    })
  })
}

/** Один список — форма для тех, у кого цели прыжка нет (приветствие пустого
 *  чата: tweb гоняет через ту же машину единственный бабл плейсхолдера,
 *  bubbles.ts:10910-10912). */
export function animateLadder(
  chatInner: HTMLElement,
  steps: LadderStep[],
  { delay = 40, offsetIndex = 1 }: { delay?: number; offsetIndex?: number } = {},
): Promise<void> {
  return animateLadderLists(chatInner, [{ steps, offsetIndex }], { delay })
}
