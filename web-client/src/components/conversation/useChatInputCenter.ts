// src/components/conversation/useChatInputCenter.ts
// Порт tweb `ChatInput._center()` (chat/input.ts:1703-1784) — механики подмены
// строки ввода плашкой (панель выделения / `.chat-input-control`).
//
// Как это устроено в оригинале. В `.chat-input-container` лежат ДВА невидимых
// узла-эталона геометрии (input.ts:484-490):
//
//   div.fake-wrapper.fake-rows-wrapper       ← коробка строки ввода
//   div.fake-wrapper.fake-selection-wrapper  ← коробка панели выделения
//
// Оба `position:absolute; z-index:-1; visibility:hidden` (_chat.scss:670-680), то
// есть в раскладке не участвуют и служат ровно одному: `_center()` снимает с них
// getBoundingClientRect и считает, во что должна «сморфиться» строка ввода:
//
//   scale         = widthTo / widthFrom
//   initTranslateX= (widthFrom - widthTo) / 2
//   needTranslateX= rectTo.left - rectFrom.left - initTranslateX
//   transform     = translateX(needTranslateX) scaleX(scale)
//   borderRadius  = 16 + 16 * (1 - scale) px      (только при scale < 1)
//
// и кладёт результат инлайном на `.rows-wrapper`. Параллельно двумя SetTransition
// поднимаются классы-состояния: `is-centering` на контейнере (гасит строку ввода,
// схлопывает reply-плашку, ужимает кнопку отправки — _chat.scss:318-360) и
// `is-centering-to-control` на `.rows-wrapper-wrapper` (проявляет `.chat-input-control`
// селектором-сиблингом `~ .chat-input-control` — _chat.scss:686-728).
//
// Целевой контейнер выбирает `getNeededFakeContainer()` (input.ts:1899-1918):
// идёт выделение — `fakeSelectionWrapper`, нужна плашка — сам `controlContainer`
// (а не фейк: у него своя ширина, `inset-inline: 0` без горизонтальных отступов,
// поэтому scale тут ≠ 1 и морф реально виден).
//
// Всё — императивно по DOM: и `.rows-wrapper-wrapper`, и `.rows-wrapper` рендерит
// Composer, а классы состояний в tweb ставит именно контроллер строки ввода
// (тот же приём, что `useHostClasses` в композере). React их не затрёт: className
// у этих узлов — константа, и на ре-рендере в DOM не переписывается.
import { useLayoutEffect, useRef, type RefObject } from 'react'

export type CenterTarget = 'selection' | 'control' | null

// tweb `SetTransition` (components/singleTransition.ts) для узла, которым владеет
// не React: forwards → `cls forwards` (+`animating` на время анимации);
// backwards → `cls backwards animating`, по окончании снимается и сам `cls`.
function setTransition(el: HTMLElement, className: string, forwards: boolean, duration: number, store: { id?: number }) {
  window.clearTimeout(store.id)
  el.classList.remove('forwards', 'backwards')
  if (forwards) el.classList.add(className, 'forwards')
  else el.classList.add('backwards')

  if (duration <= 0) {
    el.classList.remove('animating', 'backwards')
    if (!forwards) el.classList.remove(className)
    return
  }

  el.classList.add('animating')
  store.id = window.setTimeout(() => {
    el.classList.remove('animating')
    if (!forwards) el.classList.remove(className, 'backwards')
  }, duration)
}

// input.ts:1747 — `duration = animate ? 200 : 0`.
const CENTER_DURATION = 200

export function useChatInputCenter(containerRef: RefObject<HTMLDivElement | null>, target: CenterTarget) {
  const applied = useRef<CenterTarget | undefined>(undefined)
  const containerTimer = useRef<{ id?: number }>({})
  const wrapperTimer = useRef<{ id?: number }>({})

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    // input.ts:1708 — повторный вызов с тем же контейнером ничего не делает.
    if (applied.current === target) return
    // Первая раскладка чата — без анимации (tweb зовёт `_center(…, false)` из
    // finishPeerChange, input.ts:2598).
    const duration = applied.current === undefined ? 0 : CENTER_DURATION
    applied.current = target

    const rowsWrapperWrapper = container.querySelector<HTMLElement>('.rows-wrapper-wrapper')
    const rowsWrapper = container.querySelector<HTMLElement>('.rows-wrapper')
    const fakeRows = container.querySelector<HTMLElement>('.fake-rows-wrapper')
    const to = target === 'selection'
      ? container.querySelector<HTMLElement>('.fake-selection-wrapper')
      : target === 'control'
        ? container.querySelector<HTMLElement>('.chat-input-control')
        : null

    let transform = ''
    let borderRadius = ''
    if (to && fakeRows) {
      const rectTo = to.getBoundingClientRect()
      const rectFrom = fakeRows.getBoundingClientRect()
      const widthFrom = rectFrom.width
      const widthTo = rectTo.width
      if (widthFrom !== widthTo && widthFrom > 0) {
        const scale = widthTo / widthFrom
        const initTranslateX = (widthFrom - widthTo) / 2
        const needTranslateX = rectTo.left - rectFrom.left - initTranslateX
        transform = `translateX(${needTranslateX}px) scaleX(${scale})`
        if (scale < 1) borderRadius = `${16 + 16 * (1 - scale)}px`
      }
    }

    setTransition(container, 'is-centering', !!target, duration, containerTimer.current)
    if (rowsWrapperWrapper) {
      setTransition(rowsWrapperWrapper, 'is-centering-to-control', target === 'control', duration, wrapperTimer.current)
    }
    if (rowsWrapper) {
      rowsWrapper.style.transform = transform
      rowsWrapper.style.borderRadius = borderRadius
    }
  }, [containerRef, target])

  // tweb `updateMessageInput` (input.ts:2822-2850): пока строку ввода закрывает
  // плашка, инпут перестаёт быть contenteditable — иначе автофокус композера увёл
  // бы каретку в невидимый узел (и на тач поднял бы клавиатуру).
  useLayoutEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>('.input-message-input:not(.input-field-input-fake)')
    if (el) el.contentEditable = target ? 'false' : 'true'
  }, [containerRef, target])
}
