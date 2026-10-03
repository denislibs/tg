// Порт tweb `helpers/dom/getCaretPosNew.ts` — 1:1. Позиция каретки внутри поля:
// узел + смещение; если фокус стоит на самом поле (`node === input`), он
// переводится на дочерний узел по индексу.
import findUpAsChild from '@helpers/dom/findUpAsChild'

export default function getCaretPosNew(input: HTMLElement, anchor?: boolean): Partial<ReturnType<typeof getCaretPosF>> & { selection: Selection } {
  const selection = input.ownerDocument.defaultView!.getSelection()!
  const node = selection[anchor ? 'anchorNode' : 'focusNode']
  const offset = selection[anchor ? 'anchorOffset' : 'focusOffset']
  if(!findUpAsChild(node, input) && node !== input) {
    return { selection }
  }

  return { ...getCaretPosF(input, node!, offset), selection }
}

export function getCaretPosF(input: HTMLElement, node: Node, offset: number) {
  if(node === input) {
    const childNodes = input.childNodes
    const childNodesLength = childNodes.length
    if(childNodesLength && offset >= childNodesLength) {
      node = childNodes[childNodesLength - 1]
      offset = (node.textContent || (node as HTMLImageElement).alt || '').length
    } else {
      node = childNodes[offset]
      offset = 0
    }
  }

  return { node: node as ChildNode | undefined, offset }
}
