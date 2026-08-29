// Порт tweb `helpers/dom/replaceContent.ts` — 1:1. Точечная замена содержимого
// узла: строка — через `textContent`; единственный дочерний узел — `replaceWith`
// (не трогает соседей, если они появятся); иначе — сброс и `append`.
// Первый потребитель — `components/row.ts` (`withCheckboxSubtitle`: подпись
// строки переключается между «Включено»/«Выключено» по чекбоксу).
export default function replaceContent(elem: HTMLElement, node: string | Node) {
  if (typeof node === 'string') {
    elem.textContent = node
    return
  }

  // children.length не считает текстовые узлы — сравнение firstChild/lastChild,
  // как в оригинале
  const firstChild = elem.firstChild
  if (firstChild) {
    if (elem.lastChild === firstChild) {
      firstChild.replaceWith(node)
    } else {
      elem.textContent = ''
      elem.append(node)
    }
  } else {
    elem.append(node)
  }
}
