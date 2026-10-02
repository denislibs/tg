// Порт tweb `src/helpers/dom/documentFragmentToNodes.ts` (812502980, 1-10) —
// фрагмент → массив узлов (текстовые узлы — строкой) для Solid-разметки:
// фрагмент одноразовый, а массив узлов Solid вставляет и переставляет сам.
export default function documentFragmentToNodes(fragment: DocumentFragment) {
  const nodes: (Node | string)[] = Array.from({ length: fragment.childNodes.length })
  let node = fragment.firstChild
  let i = 0
  while(node) {
    nodes[i++] = node.nodeType === node.TEXT_NODE ? node.nodeValue! : node
    node = node.nextSibling
  }
  return nodes
}
