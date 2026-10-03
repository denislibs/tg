// Порт tweb `src/helpers/dom/getSelectedNodes.ts` (812502980) — 1:1 (закомментированный
// вариант оригинала не перенесён).
import { getAppWindow } from '@helpers/appWindow'

export default function getSelectedNodes() {
  const nodes: Node[] = []
  const selection = getAppWindow().getSelection()
  if(!selection) return nodes
  for(let i = 0; i < selection.rangeCount; ++i) {
    const range = selection.getRangeAt(i)
    let startContainer: Node | null = range.startContainer
    let endContainer: Node | null = range.endContainer
    if(endContainer.nodeType !== endContainer.TEXT_NODE) endContainer = endContainer.firstChild

    while(startContainer && startContainer !== endContainer) {
      nodes.push((startContainer.nodeType === endContainer?.TEXT_NODE ? startContainer : startContainer.firstChild)!)
      startContainer = startContainer.nextSibling
    }

    if(nodes[nodes.length - 1] !== endContainer) {
      nodes.push(endContainer!)
    }
  }

  // * filter null's due to <br>
  return nodes.filter((node) => !!node)
}
