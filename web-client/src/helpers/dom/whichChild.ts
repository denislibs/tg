// Порт tweb `src/helpers/dom/whichChild.ts` 1:1.
//
// Зачем отдельный хелпер, а не `Array.prototype.indexOf.call(parent.children, el)`:
// в tweb это общая утилита, и портируемые вкладки/переходы зовут её по имени —
// расхождение имени пришлось бы править в каждом порте. Отсчёт идёт по
// `previousElementSibling`, то есть по ЭЛЕМЕНТАМ; текстовые узлы считаются
// только по явному `countNonElements` (у tweb — та же развилка).
export default function whichChild(elem: Node | null | undefined, countNonElements?: boolean): number {
  if(!elem?.parentNode) {
    return -1
  }

  if(countNonElements) {
    return Array.from(elem.parentNode.childNodes).indexOf(elem as ChildNode)
  }

  let i = 0
  let node: Element | null = elem as Element
  while((node = node.previousElementSibling) !== null) ++i
  return i
}
