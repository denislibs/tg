/**
 * Порт tweb `src/components/middleEllipsis.ts` (`MiddleEllipsisElement`) — 1:1
 * по логике. Это НАСТОЯЩИЙ web-component, как в оригинале: длинное имя файла
 * режется посередине (`нача…конец`) по РЕАЛЬНОЙ ширине текста, измеренной
 * канвасом, а не по числу символов и не CSS-многоточием в конце.
 *
 * До этого порта тег `middle-ellipsis-element` жил у нас в
 * `src/customElements.d.ts` как ПУСТОЙ кастомный тег — визуальный слепок без
 * поведения: имя обрезалось хвостом правилом `text-overflow` из
 * `styles/tweb/_document.scss`, то есть расширение файла (самая нужная часть
 * имени) пропадало первым. Здесь оно снова видно, как в Telegram.
 *
 * Отличие от оригинала (следствие нашей модели, не вкусовщина):
 *   • `getTextWidth` в тестовой среде отдаёт 0 (канвас без 2D-контекста) —
 *     элемент тогда просто оставляет полный текст, см. шапку `getTextWidth.ts`.
 */
import { FontFamily, FontSize, FontWeight } from '@config/font'
import getTextWidth from '@helpers/canvas/getTextWidth'
import clamp from '@helpers/number/clamp'
import { fastRaf } from '@helpers/schedulers'
import mediaSizes, { type MediaTypeSizes } from '@core/dom/mediaSizes'

const ellipsis = '…'

interface Mapped {
  text: string
  textLength: number
  from: number
  multiplier: number | false
  font: string
  textWidth: number
  elementWidth: number
}

const map: Map<HTMLElement, Mapped | null> = new Map()
const testQueue: Set<HTMLElement> = new Set()
let pendingTest = false

function setTestQueue() {
  if(pendingTest) {
    return
  }

  pendingTest = true
  fastRaf(() => {
    pendingTest = false
    testQueueElements()
  })
}

function testQueueElements() {
  testQueue.forEach(testElement)
  testQueue.clear()
}

// Строка проводки: пересчёт всех живых элементов на resize окна (tweb
// middleEllipsis.ts:51-57) — держит `middleEllipsis.test.ts`.
window.addEventListener('resize', () => {
  for(const [key] of map) {
    testQueue.add(key)
  }

  setTestQueue()
}, { capture: true, passive: true })

/** Живой геттер ширины, который вешает вызывающий (tweb `(element as any).getSize`). */
type WithGetSize = HTMLElement & { getSize?: () => number }

function getElementWidth(element: HTMLElement): number {
  const getSize = (element as WithGetSize).getSize
  if(getSize) {
    return getSize()
  }

  const type = element.dataset.sizeType as keyof MediaTypeSizes | undefined
  if(type) {
    return mediaSizes.active[type].width
  }

  return element.getBoundingClientRect().width
}

export function testElement(element: HTMLElement): void {
  // не пересчитывать переменные второй раз
  let mapped = map.get(element)
  const firstTime = !mapped

  if(!mapped) {
    const text = element.textContent || ''
    const from = 50
    let fontSize = element.dataset.fontSize
    if(fontSize && +fontSize) fontSize += 'px'

    const font = `${element.dataset.fontWeight || FontWeight} ${fontSize || FontSize} ${FontFamily}`
    mapped = {
      text,
      textLength: text.length,
      from,
      multiplier: from > 0 && from / 100,
      font,
      textWidth: getTextWidth(text, font),
      elementWidth: getElementWidth(element),
    }

    map.set(element, mapped)
  }

  const { text, from, multiplier, font, textWidth } = mapped
  let elementWidth = mapped.elementWidth

  const newElementWidth = getElementWidth(element)
  const widthChanged = firstTime || elementWidth !== newElementWidth
  if(!firstTime && widthChanged) {
    elementWidth = newElementWidth
    mapped.elementWidth = newElementWidth
  }

  if(!widthChanged) {
    return
  }

  if(textWidth > elementWidth) {
    element.setAttribute('title', text)
    let smallerText = text
    while(smallerText.length > 3) {
      const smallerTextLength = smallerText.length
      const half = (multiplier ?
        clamp((multiplier * smallerTextLength) << 0, 1, smallerTextLength - 2) :
        0) ||
        Math.max(smallerTextLength + from - 1, 1)
      const half1 = smallerText.substring(0, half).replace(/\s*$/, '')
      const half2 = smallerText.substring(half + 1).replace(/^\s*/, '')
      smallerText = half1 + half2
      if(getTextWidth(smallerText + ellipsis, font) < elementWidth) {
        element.textContent = half1 + ellipsis + half2
        break
      }
    }

    // * зафиксировать новую ширину после обрезки текста
    mapped.elementWidth = getElementWidth(element)
  } else {
    element.removeAttribute('title')
  }
}

export class MiddleEllipsisElement extends HTMLElement {
  connectedCallback() {
    map.set(this, null)
    if(this.dataset.sizeType || (this as WithGetSize).getSize) {
      testElement(this)
    } else {
      testQueue.add(this)
      setTestQueue()
    }
  }

  disconnectedCallback() {
    map.delete(this)
    testQueue.delete(this)
  }
}

// Строка проводки: без регистрации тег остаётся пустым (поведения нет) —
// держит `middleEllipsis.test.ts`.
if(!customElements.get('middle-ellipsis-element')) {
  customElements.define('middle-ellipsis-element', MiddleEllipsisElement)
}
