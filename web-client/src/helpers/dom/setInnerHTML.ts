// Порт tweb `helpers/dom/setInnerHTML.ts` в объёме потребителей (`components/buttonMenu.ts`,
// опция `regularText`; `components/inputField.ts` и `lib/langPack.ts` — через
// экспортированный `setDirection`). Правки:
//   • вход честно допускает `undefined` (tweb сам сравнивает `html === undefined`,
//     но в его сигнатуре этого варианта нет — `strict` там выключен)
//   • `getDirection` — с первым потребителем, карточкой превью ссылки
//     (`components/wrappers/webPage.solid.tsx`)
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

/** tweb `setInnerHTML.ts` `getDirection` */
export function getDirection(): 'auto' {
  return 'auto'
}
