// Порт tweb `src/components/putPreloader.ts:4-24` — круговой прелоадер,
// вставляемый В УЖЕ СУЩЕСТВУЮЩИЙ узел. Ванильный близнец React-компонента
// `shared/ui/Preloader.tsx`: разметка у них одна и та же
// (`div.preloader > svg.preloader-circular > circle.preloader-path`,
// стили — `styles/tweb/_preloader.scss`), различается только способ
// монтирования. React-версия рисуется деревом React-экрана, эта — зовётся
// императивным кодом, которому нужен узел прямо сейчас
// (`appSearchSuper.cleanupHTML()` — tweb `appSearchSuper.ts:2780-2788`).
//
// ОТСТУПЛЕНИЕ ОТ ОРИГИНАЛА (форма, не результат): tweb собирает svg строкой и
// вставляет `innerHTML`/`insertAdjacentHTML`. В этом репозитории DOM строится
// через `createElement`/`createElementNS` (правило безопасности, тот же приход
// у `shared/ui/InputSearch/InputSearch.tsx:103-125`), поэтому узлы создаются
// поимённо. Итоговое дерево совпадает с живым дампом Telegram
// (`docs/tweb/dom/dumps/07-right-sidebar.json:250-252`; дамп — одна
// физическая строка JSON, нумерация по развёрнутому тексту с первой строки).
//
// `setButtonLoader` и `PreloaderTsx` (`putPreloader.ts:28-54`) не портированы:
// потребителей нет ни одного, а заводить их «на будущее» — мёртвый код.

const SVG_NS = 'http://www.w3.org/2000/svg'

/** `svg.preloader-circular > circle.preloader-path` — тело прелоадера (tweb `:5-8`). */
function createCircular(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('class', 'preloader-circular')
  svg.setAttribute('viewBox', '25 25 50 50')

  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('class', 'preloader-path')
  circle.setAttribute('cx', '50')
  circle.setAttribute('cy', '50')
  circle.setAttribute('r', '20')
  circle.setAttribute('fill', 'none')
  circle.setAttribute('stroke-miterlimit', '10')

  svg.append(circle)
  return svg
}

/**
 * tweb `putPreloader(elem, returnDiv)` (`:4-24`).
 *
 * `returnDiv = false` — голый svg внутрь `elem` (вариант «в кнопку»), возвращается
 * сам svg. `returnDiv = true` — svg в обёртке `div.preloader`, она и возвращается.
 *
 * Ветка `if(elem)` оригинала (`:15-17`) не портирована: у `elem` там тип `Element`,
 * то есть проверка недостижима при соблюдении типов, а вызывающих с пустым узлом
 * в tweb нет.
 */
export function putPreloader(elem: Element, returnDiv = false): Element {
  const svg = createCircular()

  if(returnDiv) {
    const div = document.createElement('div')
    div.classList.add('preloader')
    div.append(svg)
    elem.append(div)
    return div
  }

  elem.append(svg)
  return svg
}

export default putPreloader
