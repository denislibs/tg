// Порт tweb `helpers/dom/documentFragmentToHTML.ts` — 1:1. Сериализация фрагмента,
// собранного `createElement`/`textContent` (`wrapDraftText`), для
// `execCommand('insertHTML')` в `insertRichTextAsHTML`: текст — `encodeEntities`,
// элементы — `outerHTML` (атрибуты экранирует сериализатор браузера).
import encodeEntities from '@helpers/string/encodeEntities'

export default function documentFragmentToHTML(fragment: DocumentFragment) {
  return Array.from(fragment.childNodes).map((node) => {
    return node.nodeType === node.TEXT_NODE ? encodeEntities(node.textContent ?? '') : (node as Element).outerHTML
  }).join('')
}
