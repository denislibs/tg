// composer/useComposerClipboard.ts
// Вставка в инпут: каретка, буфер обмена и drop. Вынесено из Composer.tsx —
// сам компонент остаётся про рендер и состояние.
//
// Ключевое правило (CLAUDE.md, «Безопасность»): пользовательский контент никогда
// не попадает в DOM сырой HTML-строкой — только своими узлами через Range.
import { useCallback, type ClipboardEvent, type DragEvent, type RefObject } from 'react'
import { entitiesToFragment } from '../../core/richtext/markdown'
import { htmlToRich } from './helpers'

interface Args {
  editorRef: RefObject<HTMLDivElement | null>
  onPasteFiles?: (files: File[]) => void
  syncEmpty: () => void
  autosize: () => void
  onTyping: () => void
}

export function useComposerClipboard({ editorRef, onPasteFiles, syncEmpty, autosize, onTyping }: Args) {
  // Вставка простого текста ОДНОЙ текстовой нодой. Критично для больших вставок:
  // `execCommand('insertText')` делает из каждого '\n' отдельный <div>, и вставка
  // 1000 строк рождает ~1000 узлов с рефлоу — вкладка замирает на секунды. Одна
  // текстовая нода + white-space: pre-wrap рисуют те же переводы строк одной мутацией.
  const insertPlainText = useCallback((text: string) => {
    const root = editorRef.current
    if (!root) return
    const sel = window.getSelection()
    const node = document.createTextNode(text)
    if (sel && sel.rangeCount && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      root.appendChild(node)
    }
  }, [editorRef])

  /** Вставка готового фрагмента (форматированная вставка, кастом-эмодзи, mention). */
  const insertFragment = useCallback((frag: DocumentFragment) => {
    const root = editorRef.current
    if (!root) return
    const last = frag.lastChild
    const sel = window.getSelection()
    if (sel && sel.rangeCount && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(frag)
      if (last) { range.setStartAfter(last); range.collapse(true); sel.removeAllRanges(); sel.addRange(range) }
    } else {
      root.appendChild(frag)
    }
  }, [editorRef])

  // Порядок разбора: (1) файлы → поток вложений; (2) HTML → сущности (сохранить
  // форматирование), но только если его видимый текст совпал с plain-версией
  // (иначе это мусор из таблиц/списков); (3) иначе простой текст.
  const insertClipboard = useCallback((plain: string, html: string) => {
    if (html && html.trim()) {
      const rich = htmlToRich(html)
      const richLen = rich.text.replace(/\s/g, '').length
      const plainLen = plain.replace(/\s/g, '').length
      if (rich.entities.length && richLen === plainLen) {
        insertFragment(entitiesToFragment(rich.text, rich.entities))
        return
      }
    }
    insertPlainText(plain)
  }, [insertFragment, insertPlainText])

  const onPaste = useCallback((e: ClipboardEvent) => {
    e.preventDefault()
    const files = Array.from(e.clipboardData.files || [])
    if (files.length && onPasteFiles) { onPasteFiles(files); return }
    insertClipboard(e.clipboardData.getData('text/plain').replace(/\r/g, ''), e.clipboardData.getData('text/html'))
    syncEmpty()
    autosize()
    onTyping()
  }, [autosize, insertClipboard, onPasteFiles, onTyping, syncEmpty])

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length && onPasteFiles) { onPasteFiles(files); return }
    insertClipboard(e.dataTransfer.getData('text/plain').replace(/\r/g, ''), e.dataTransfer.getData('text/html'))
    syncEmpty()
    autosize()
  }, [autosize, insertClipboard, onPasteFiles, syncEmpty])

  return { insertFragment, onPaste, onDrop }
}
