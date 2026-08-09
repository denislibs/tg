// Порт tweb `components/chat/bubbles.ts:10363-10460` (animateAsLadder) — «лестница»
// появления баблов при открытии чата.
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
// Отличия от tweb (осознанные):
//   • tweb гоняет три списка (topIds/middleIds/bottomIds относительно сообщения,
//     к которому прыгаем) и складывает их промисы; у нас одна лента, порядок
//     задаёт вызывающий (Chat.tsx отдаёт обёртки снизу вверх) — поэтому один список;
//   • страховочный таймер: при `body.animation-level-0` CSS-перехода нет вообще
//     (`@include animation-level(2)` в партиале), `transitionend` не придёт и
//     лестница никогда бы не убралась. tweb от этого закрыт таймаутом внутри
//     `dispatchHeavyAnimationEvent`, но там таймаут гасит только heavy-animation,
//     а чистку классов вешает на промис — нам нужен свой резолв.
import { dispatchHeavyAnimationEvent } from './heavyAnimation'

/** tweb bubbles.ts:10440 — длительность самого перехода (--bubble-transition-in) */
const TRANSITION_TIME = 300

/** Один шаг лестницы: обёртка бабла и (опционально) аватар его группы — они едут
 *  вместе, с одной задержкой (tweb `elementsToAnimate`, bubbles.ts:10384-10391). */
export type LadderStep = HTMLElement | HTMLElement[]

export function animateLadder(
  chatInner: HTMLElement,
  steps: LadderStep[],
  { delay = 40, offsetIndex = 1 }: { delay?: number; offsetIndex?: number } = {},
): Promise<void> {
  if (!steps.length) return Promise.resolve()

  chatInner.classList.add('zoom-fading')

  // Все узлы, которых лестница коснулась, — по ним же идёт чистка в конце
  // (tweb `setBubbles`, bubbles.ts:10361).
  const touched: HTMLElement[] = []
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
    // tweb ждёт `transitionend` только на обёртке ПОСЛЕДНЕГО шага (bubbles.ts:10393-10403)
    last = elements[0]
  })

  const done = new Promise<void>((resolve) => {
    const target = last
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
  })

  requestAnimationFrame(() => {
    for (const el of touched) el.classList.remove('zoom-fade')
  })

  // tweb bubbles.ts:10441-10444 — весь каскад объявлен тяжёлой анимацией:
  // animationIntersector глушит лотти/видео/гифки, иначе десяток играющих стикеров
  // конкурирует с лестницей за кадры.
  return dispatchHeavyAnimationEvent(done, lastMsDelay + TRANSITION_TIME).then(() => {
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
