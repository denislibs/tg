// Порт tweb `helpers/dom/isInDOM.ts` — 1:1, без отличий (только формат под
// `.oxlintrc.json` этого репозитория: без `;`, чинится `oxlint --fix`; логика
// не менялась ни на строку).
//
// Довезено как транзитивная зависимость `helpers/fastSmoothScroll.ts` (Задача 2
// довендоривает зависимости Scrollable/ScrollSaver) — в брифе явно не названа,
// но тривиальна и без сторонних импортов.
/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

/* export function isInDOM(element: Element, parentNode?: HTMLElement): boolean {
  if(!element) {
    return false;
  }

  parentNode = parentNode || document.body;
  if(element === parentNode) {
    return true;
  }
  return isInDOM(element.parentNode as HTMLElement, parentNode);
} */
export default function isInDOM(element: Element): boolean {
  return !!element?.isConnected
}
