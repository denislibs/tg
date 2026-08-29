// Порт tweb `src/components/ripple.ts` — 1:1. Довезён вместе с `button.ts` как
// его прямая зависимость (кнопка без ripple() не собирается): в проекте до сих
// пор не было ванильного ripple, только React-версия (`shared/ui/Ripple`),
// которая этот модуль не заменяет — она рисует эффект React-компонентом, а
// портируемым вкладкам (Solid/vanilla) нужен именно этот, DOM-императивный.
//
// Все зависимости уже есть в репозитории портированными 1:1, правки — только
// пути импорта под наши алиасы:
//  • `findUpClassName`/`findUpAsChild` (`@helpers/dom`) — как в `buttonMenu.ts`;
//  • `sequentialDom` (`@helpers/sequentialDom`) — уже портирован ради
//    `renderMediaWithFadeIn`, батчит `circle.remove()`;
//  • `IS_TOUCH_SUPPORTED` — `@environment/touchSupport`;
//  • `fastRaf` — `@helpers/schedulers`;
//  • `liteMode` — `@helpers/liteMode` (гейт «Без анимаций», см. его докблок).
//
// Solid-аксессорная форма (`ripple(elem, accessor)` → `use:ripple` в JSX)
// портирована целиком: волна 2 строит строки/секции настроек на Solid, и им
// нужно вешать рипл директивой, а не императивным вызовом. Модуль сам не JSX
// (обычный `.ts`) — примитивы `solid-js` (`createRenderEffect`/`onCleanup`)
// вызываются как функции, transform'а JSX для этого не нужно; директиву
// `<button use:ripple />` будет писать уже `*.solid.tsx`-потребитель.
import findUpClassName from '@helpers/dom/findUpClassName'
import sequentialDom from '@helpers/sequentialDom'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import { fastRaf } from '@helpers/schedulers'
import liteMode from '@helpers/liteMode'
import { type Accessor, createRenderEffect, onCleanup } from 'solid-js'

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      /**
       * To be used in solid-js as `<button use:ripple />`
       */
      ripple: boolean
    }
  }
}

let rippleClickId = 0
function _ripple(
  elem: HTMLElement,
  prepend: boolean | 'no' = true,
  callback: (id: number) => Promise<boolean | void> = () => Promise.resolve(),
  onEnd: ((id: number) => void) | null = null,
  attachListenerTo = elem,
) {
  if (elem.querySelector('.c-ripple')) return
  elem.classList.add('rp')

  const r = document.createElement('div')
  r.classList.add('c-ripple')

  const isSquare = elem.classList.contains('rp-square')
  if (isSquare) {
    r.classList.add('is-square')
  }

  if (prepend !== 'no') {
    elem[prepend ? 'prepend' : 'append'](r)
  }

  let handler: (() => void) | null, lastHandler: typeof handler
  const drawRipple = (clientX: number, clientY: number) => {
    const startTime = Date.now()
    const circle = document.createElement('div')

    const clickId = rippleClickId++

    const auto = false
    const duration = (auto ? .3 : +(r.ownerDocument.defaultView || window).getComputedStyle(r).getPropertyValue('--ripple-duration').replace('s', '')) * 1000

    const _handler = handler = lastHandler = () => {
      const elapsedTime = Date.now() - startTime
      const cb = () => {
        void sequentialDom.mutate(() => {
          circle.remove()
        })

        onEnd?.(clickId)
      }
      if (elapsedTime < duration) {
        const delay = Math.max(duration - elapsedTime, duration / 2)
        setTimeout(() => circle.classList.add('hiding'), Math.max(delay - duration / 2, 0))

        setTimeout(cb, delay)
      } else {
        circle.classList.add('hiding')
        setTimeout(cb, duration / 2)
      }

      if (!IS_TOUCH_SUPPORTED) {
        // Тот же документ/окно, к которому были привешены листенеры (окно
        // самого элемента — окно Document PiP, когда клиент выскочил из
        // него), а не глобальный `window`.
        const win = r.ownerDocument.defaultView || window
        win.removeEventListener('contextmenu', handler as EventListener)
        win.removeEventListener('mousemove', handler as EventListener)
      }

      handler = null
      touchStartFired = false
    }

    void callback?.(clickId)

    fastRaf(() => {
      if (lastHandler !== _handler) {
        return
      }

      const rect = r.getBoundingClientRect()
      circle.classList.add('c-ripple__circle')

      const clickX = clientX - rect.left
      const clickY = clientY - rect.top

      const radius = Math.sqrt((Math.abs(clickY - rect.height / 2) + rect.height / 2) ** 2 + (Math.abs(clickX - rect.width / 2) + rect.width / 2) ** 2)
      const size = radius

      const x = clickX - size / 2
      const y = clickY - size / 2

      circle.style.width = circle.style.height = size + 'px'
      circle.style.left = x + 'px'
      circle.style.top = y + 'px'
      circle.style.opacity = '0'

      r.append(circle)

      void circle.offsetWidth // force reflow
      circle.style.opacity = ''

      if (auto) {
        _handler()
      }
    })
  }

  const isRippleUnneeded = (e: Event) => {
    return e.target !== elem && (
      ['BUTTON', 'A'].includes((e.target as HTMLElement).tagName) ||
        findUpClassName(e.target as HTMLElement, 'c-ripple') !== r
    ) && (
      attachListenerTo === elem ||
        !findUpAsChild(e.target as HTMLElement, attachListenerTo)
    ) && !findUpClassName(e.target as HTMLElement, 'checkbox-field')
  }

  let touchStartFired = false
  if (IS_TOUCH_SUPPORTED) {
    const touchEnd = () => {
      handler?.()
    }

    const onTouchStart = (e: TouchEvent) => {
      if (!liteMode.isAvailable('animations')) {
        return
      }

      if (e.touches.length > 1 || touchStartFired || isRippleUnneeded(e)) {
        return
      }

      touchStartFired = true

      const { clientX, clientY } = e.touches[0]
      drawRipple(clientX, clientY)
      attachListenerTo.addEventListener('touchend', touchEnd, { once: true })

      window.addEventListener('touchmove', (e) => {
        // tweb здесь пишет `e.cancelBubble = true; e.stopPropagation();` —
        // избыточную пару из двух форм одного и того же (по спецификации DOM
        // сеттер `cancelBubble = true` выполняет ровно `stopPropagation()`,
        // это старый алиас). В happy-dom `cancelBubble` объявлен ТОЛЬКО
        // геттером — присваивание бросает `TypeError`, и, в отличие от
        // `cancelEvent.ts`, здесь нет `try/catch`: исключение обрывало бы
        // обработчик ДО `touchEnd()`, а рипл на тач-жесте не убирался бы.
        // Вторая форма (`stopPropagation()`) даёт то же самое поведение в
        // браузере — просто убираем первую, а не дублируем эквивалент.
        e.stopPropagation()
        touchEnd()
        attachListenerTo.removeEventListener('touchend', touchEnd)
      }, { once: true })
    }

    attachListenerTo.addEventListener('touchstart', onTouchStart, { passive: true })
    return {
      dispose: () => {
        attachListenerTo.removeEventListener('touchstart', onTouchStart)
        r.remove()
      },
      element: r,
    }
  } else {
    const onMouseDown = (e: MouseEvent) => {
      if (![0, 2].includes(e.button)) { // только левая и правая кнопки
        return
      }

      if (!liteMode.isAvailable('animations')) {
        return
      }

      if (attachListenerTo.dataset.ripple === '0' || isRippleUnneeded(e)) {
        return
      } else if (touchStartFired) {
        touchStartFired = false
        return
      }

      const { clientX, clientY } = e
      drawRipple(clientX, clientY)
      // Листенеры конца рипла — на ОКНЕ САМОГО ЭЛЕМЕНТА (в Document PiP mouseup
      // стреляет там, а не на главном `window`).
      const win = attachListenerTo.ownerDocument.defaultView || window
      win.addEventListener('mouseup', handler as EventListener, { once: true, passive: true })
      win.addEventListener('contextmenu', handler as EventListener, { once: true, passive: true })
    }

    attachListenerTo.addEventListener('mousedown', onMouseDown, { passive: true })
    return {
      dispose: () => {
        attachListenerTo.removeEventListener('mousedown', onMouseDown)
        r.remove()
      },
      element: r,
    }
  }
}

export default function ripple(elem: HTMLElement, accessor?: Accessor<boolean>, prepend?: boolean | 'no') {
  if (accessor) {
    createRenderEffect(() => {
      const value = accessor()
      if (value === undefined || value) {
        const ret = _ripple(elem, prepend)
        onCleanup(() => {
          ret?.dispose()
        })
      }
    })

    return
  }

  const ret = _ripple(elem, prepend)
  return ret
}
