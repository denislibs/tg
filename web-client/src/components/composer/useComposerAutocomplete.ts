// composer/useComposerAutocomplete.ts
// Автокомплит инпута композера (tweb *Helper'ы): эмодзи по слову у каретки,
// inline-режим «@bot query» и @упоминания участников. Состояние + проверки
// (из onInput) + выбор (из keydown/панелей) вынесены из Composer, чтобы тот
// остался тоньше. Стикер-саджесты остаются в Composer (завязаны на clearEditor).
import { useRef, useState, type RefObject } from 'react'
import { searchEmojisByWord } from '../emoji/emojiData'
import type { Peer } from '../../core/managers/peersManager'
import type { InlineResult } from '../../core/managers/botsManager'
import { placeCaretEnd } from './helpers'

export interface ComposerAutocompleteArgs {
  editorRef: RefObject<HTMLDivElement | null>
  mentions?: Peer[]
  onInlineQuery?: (username: string, query: string) => Promise<InlineResult[] | null>
  onPickInline?: (r: InlineResult) => void
  syncEmpty: () => void
  autosize: () => void
  insertFragment: (frag: DocumentFragment) => void
  clearEditor: () => void
  onDraftChange?: (text: string) => void
}

export function useComposerAutocomplete({
  editorRef, mentions, onInlineQuery, onPickInline,
  syncEmpty, autosize, insertFragment, clearEditor, onDraftChange,
}: ComposerAutocompleteArgs) {
  // ── Эмодзи-автокомплит (tweb emojiHelper): подсказки по слову у каретки ──
  // idx = -1 — навигация «спит» до первой стрелки (tweb waitForKey для слова);
  // для ':query' активируется сразу.
  const [emojiSug, setEmojiSug] = useState<{ list: string[]; wordLen: number; idx: number } | null>(null)
  // ── Inline-режим (tweb InlineHelper): весь инпут начинается с «@bot query» ──
  const [inlineSug, setInlineSug] = useState<{ list: InlineResult[]; idx: number } | null>(null)
  const inlineTimer = useRef<number | undefined>(undefined)
  const inlineReq = useRef(0) // токен запроса — гасим гонки
  // ── @упоминания (tweb mentionsHelper): участники группы по слову '@query' ──
  const [mentionSug, setMentionSug] = useState<{ list: Peer[]; wordLen: number; idx: number } | null>(null)

  // слово перед кареткой (в пределах одной текстовой ноды)
  const caretWord = (): { word: string; node: Text; end: number } | null => {
    const root = editorRef.current
    const sel = window.getSelection()
    if (!root || !sel || !sel.rangeCount || !sel.isCollapsed) return null
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null
    const text = (node.textContent ?? '').slice(0, range.startOffset)
    const m = text.match(/(?:^|\s)(\S+)$/)
    if (!m) return null
    return { word: m[1], node: node as Text, end: range.startOffset }
  }

  // tweb checkAutocomplete: эмодзи-ветка — ':query' или обычное слово без :@/
  const checkEmojiAutocomplete = () => {
    const cw = caretWord()
    if (!cw) {
      setEmojiSug(null)
      return
    }
    const colon = cw.word.startsWith(':')
    const query = colon ? cw.word.slice(1) : cw.word
    if ((!colon && /[:@/]/.test(cw.word)) || query.length < 2) {
      setEmojiSug(null)
      return
    }
    const list = searchEmojisByWord(query)
    if (!list.length) {
      setEmojiSug(null)
      return
    }
    setEmojiSug((prev) => ({
      list,
      wordLen: cw.word.length,
      // не сбрасывать активную позицию, если пользователь уже навигировал
      idx: colon ? Math.max(0, prev?.idx ?? 0) : (prev?.idx ?? -1),
    }))
  }

  // tweb checkInlineAutocomplete: строка вида «@username » (username 3–32) + запрос.
  const checkInlineAutocomplete = () => {
    if (!onInlineQuery) return
    const text = editorRef.current?.textContent ?? ''
    const m = text.match(/^@([a-zA-Z\d_]{3,32})\s([\s\S]*)$/)
    if (!m) {
      setInlineSug(null)
      window.clearTimeout(inlineTimer.current)
      return
    }
    const username = m[1]
    const query = m[2]
    const req = ++inlineReq.current
    window.clearTimeout(inlineTimer.current)
    // debounce 200мс (tweb debounce)
    inlineTimer.current = window.setTimeout(() => {
      void onInlineQuery(username, query).then((list) => {
        if (req !== inlineReq.current) return // устарел
        setInlineSug(list && list.length ? { list, idx: 0 } : null)
      })
    }, 200)
  }
  const pickInline = (r: InlineResult) => {
    onPickInline?.(r)
    setInlineSug(null)
    clearEditor()
    onDraftChange?.('')
    const ed = editorRef.current
    if (ed) { ed.focus(); placeCaretEnd(ed) }
  }

  const checkMentionAutocomplete = () => {
    if (!mentions || mentions.length === 0) return
    const cw = caretWord()
    if (!cw || !cw.word.startsWith('@')) {
      setMentionSug(null)
      return
    }
    const q = cw.word.slice(1).toLowerCase()
    const list = mentions
      .filter((p) => {
        if (!q) return true
        if (p.username.toLowerCase().startsWith(q)) return true
        return p.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))
      })
      .slice(0, 20)
    if (!list.length) {
      setMentionSug(null)
      return
    }
    setMentionSug((prev) => ({
      list,
      wordLen: cw.word.length,
      idx: Math.min(Math.max(0, prev?.idx ?? 0), list.length - 1),
    }))
  }

  // Выбор участника: с username — текст «@username » (распарсится как mention);
  // без username — <a data-mention-id> → text_mention entity (tweb mentionUser).
  const pickMention = (p: Peer) => {
    const cw = caretWord()
    const root = editorRef.current
    if (cw && root) {
      const start = Math.max(0, cw.end - (mentionSug?.wordLen ?? cw.word.length))
      const r = document.createRange()
      r.setStart(cw.node, start)
      r.setEnd(cw.node, cw.end)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      if (p.username) {
        document.execCommand('insertText', false, `@${p.username} `)
      } else {
        const frag = document.createDocumentFragment()
        const a = document.createElement('a')
        a.className = 'md-mention'
        a.dataset.mentionId = String(p.id)
        a.textContent = p.displayName || `#${p.id}`
        frag.appendChild(a)
        frag.appendChild(document.createTextNode(' '))
        insertFragment(frag)
      }
      syncEmpty()
      autosize()
    }
    setMentionSug(null)
  }

  // выбор подсказки: заменить набранное слово эмодзи (tweb insertAtCaret с replaceText)
  const pickEmojiSuggestion = (em: string) => {
    const cw = caretWord()
    const root = editorRef.current
    if (cw && root) {
      const start = Math.max(0, cw.end - (emojiSug?.wordLen ?? cw.word.length))
      const r = document.createRange()
      r.setStart(cw.node, start)
      r.setEnd(cw.node, cw.end)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      document.execCommand('insertText', false, em)
      syncEmpty()
      autosize()
    }
    setEmojiSug(null)
  }

  return {
    emojiSug, setEmojiSug,
    inlineSug, setInlineSug,
    mentionSug, setMentionSug,
    checkEmojiAutocomplete, checkInlineAutocomplete, checkMentionAutocomplete,
    pickEmojiSuggestion, pickMention, pickInline,
  }
}
