// Порт tweb `helpers/dom/setInnerHTML.ts` в объёме потребителя (`components/buttonMenu.ts`,
// опция `regularText`). Правки:
//   • вход честно допускает `undefined` (tweb сам сравнивает `html === undefined`,
//     но в его сигнатуре этого варианта нет — `strict` там выключен)
//   • `setDirection` не экспортируется, а `getDirection` не перенесён: у обоих
//     в проекте нет потребителей (в tweb их зовут ещё не портированные модули)
export default function setInnerHTML(elem: Element, html: string | DocumentFragment | Element | undefined) {
  setDirection(elem)
  if(html === undefined) {
    elem.replaceChildren()
  } else if(typeof(html) === 'string') {
    if(!html) elem.replaceChildren()
    else elem.textContent = html
  } else {
    elem.replaceChildren(html)
  }
}

function setDirection(elem: Element) {
  // Ветка `if(!I18n.isRTL)` в tweb закомментирована — атрибут ставится всегда.
  elem.setAttribute('dir', 'auto')
}
