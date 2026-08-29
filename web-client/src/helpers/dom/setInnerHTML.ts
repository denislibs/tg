// Порт tweb `helpers/dom/setInnerHTML.ts` в объёме потребителей (`components/buttonMenu.ts`,
// опция `regularText`; `components/row.ts` — `createTitle`/`createSubtitle` через
// экспортированный `setDirection`). Правки:
//   • вход честно допускает `undefined` (tweb сам сравнивает `html === undefined`,
//     но в его сигнатуре этого варианта нет — `strict` там выключен)
//   • `getDirection` не перенесён: потребителей у него в репозитории нет
//     (в tweb его зовут ещё не портированные модули)
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

export function setDirection(elem: Element) {
  // Ветка `if(!I18n.isRTL)` в tweb закомментирована — атрибут ставится всегда.
  elem.setAttribute('dir', 'auto')
}
