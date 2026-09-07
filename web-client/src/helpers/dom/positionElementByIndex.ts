// Порт tweb `src/helpers/dom/positionElementByIndex.ts` — 1:1.
//
// Поставить узел на позицию `pos` среди детей `container`, учитывая, что он
// может уже стоять там же (тогда ничего не делать) или выше (тогда целевой
// индекс сдвигается на единицу — его собственный слот освободится). На этом
// стоит `SortedList.onSort`: перестановка одной строки без перерисовки списка.
import whichChild from '@helpers/dom/whichChild'

export default function positionElementByIndex(element: HTMLElement, container: HTMLElement, pos: number, prevPos?: number) {
  if(prevPos === undefined) {
    prevPos = element.parentElement === container ? whichChild(element) : -1
  }

  if(prevPos === pos) {
    return false
  } else if(prevPos !== -1 && prevPos < pos) { // was higher
    pos += 1
  }

  if(!pos) {
    container.prepend(element)
  } else if(container.childElementCount > pos) {
    container.insertBefore(element, container.children[pos])
  } else {
    container.append(element)
  }

  return true
}
