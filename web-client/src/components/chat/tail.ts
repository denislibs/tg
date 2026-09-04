// Хвост бабла — дословный порт tweb `chat/utils.ts:43-63` (`generateTail`).
//
// SVG 11×20 с `<use href="#message-tail-filled">`: сама форма («капля») лежит
// в спрайте `web-client/index.html` (`symbol#message-tail-filled`, порт tweb
// `index.html:64-68`) — здесь только узел-ссылка. Цвет узла не красится тут:
// `fill: inherit` у формы и `fill: var(--message-background-color)` у самого
// `.bubble-tail` — уже в `styles/tweb/_chatBubble.scss` (:2089-2103,
// :3373-3390, :3495-3512), которые решают, когда хвост вообще виден
// (`.can-have-tail` + `.is-group-last`/`.is-forced-rounded`).
//
// Ветка `asSpan` (пустышка вместо SVG) в оригинале нужна разметке, где хвоста
// не бывает и класс ставится только ради стыковки CSS-отступов; вставка узла
// (`bubbles.ts`) её пока не использует, но порт держит функцию целиком, а не
// половину — по тому же правилу, по которому портируется вся функция, а не
// вызываемая сегодня ветка.
export function generateTail(asSpan?: boolean): SVGSVGElement | HTMLSpanElement {
  if (asSpan) {
    const span = document.createElement('span')
    span.classList.add('bubble-tail')
    return span
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttributeNS(null, 'viewBox', '0 0 11 20')
  svg.setAttributeNS(null, 'width', '11')
  svg.setAttributeNS(null, 'height', '20')
  svg.classList.add('bubble-tail')

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttributeNS(null, 'href', '#message-tail-filled')

  svg.append(use)

  return svg
}
