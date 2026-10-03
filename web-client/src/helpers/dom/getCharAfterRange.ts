// Порт tweb `helpers/dom/getCharAfterRange.ts` — 1:1: символ сразу после конца
// диапазона (в том же текстовом узле или в первом текстовом узле дальше по
// дереву). Потребитель — `applyMarkdown` для цитаты (перенос строки за выделением).
export default function getCharAfterRange(range: Range): string | undefined {
  const newRange = document.createRange()

  // * the range does not end at the end of its text node
  if(range.endContainer.nodeType === Node.TEXT_NODE && range.endOffset < range.endContainer.nodeValue!.length) {
    newRange.setStart(range.endContainer, range.endOffset)
    newRange.setEnd(range.endContainer, range.endOffset + 1)
    return newRange.toString()
  }

  // * the range ends at the end of its node and there is a next text node
  const nextTextNode = findNextTextNode(range.endContainer)
  if(nextTextNode) {
    newRange.setStart(nextTextNode, 0)
    newRange.setEnd(nextTextNode, Math.min(nextTextNode.nodeValue!.length, 1))
    return newRange.toString()
  }
}

function findNextTextNode(node: Node | null): Text | undefined {
  while(node && !node.nextSibling) {
    node = node.parentNode
  }

  if(node && node.nextSibling) {
    return findFirstTextNode(node.nextSibling)
  }
}

function findFirstTextNode(node: Node): Text | undefined {
  if(node.nodeType === Node.TEXT_NODE) {
    return node as Text
  }

  for(let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    const result = findFirstTextNode(child)
    if(result) {
      return result
    }
  }
}
