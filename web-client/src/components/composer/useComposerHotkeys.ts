// composer/useComposerHotkeys.ts
// Клавиатура инпута композера. Вынесено из Composer.tsx одним куском, потому что
// это один обработчик с фиксированным порядком веток:
//
//   1. активный хелпер (inline → mentions → emoji) перехватывает Escape/стрелки/Enter/Tab
//      — как `attachListNavigation` в tweb (helpers/dom/attachListNavigation.ts);
//   2. Ctrl/Cmd+↑ — ответ на предыдущее сообщение; чистая ↑ на пустом инпуте —
//      правка своего последнего (tweb editLastMessage);
//   3. Enter — отправка, Shift+Enter — перевод строки;
//   4. Ctrl/Cmd+B/I/U/S/M/P — форматирование, Ctrl/Cmd+K — ссылка.
import { useCallback, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react'
import type { Peer } from '../../core/managers/peersManager'
import type { InlineResult } from '../../core/managers/botsManager'
import type { ComposerEntityType } from '../../core/richtext/markdown'
import { SHORTCUTS } from './helpers'

/** Общая форма состояния хелпера: список + активная позиция (у эмодзи/меншенов есть ещё wordLen). */
interface SugBase<T> { list: T[]; idx: number }

interface Args<E extends SugBase<string>, M extends SugBase<Peer>, I extends SugBase<InlineResult>> {
  editorRef: RefObject<HTMLDivElement | null>
  emptyDraft: boolean
  inlineSug: I | null
  setInlineSug: Dispatch<SetStateAction<I | null>>
  pickInline: (r: InlineResult) => void
  mentionSug: M | null
  setMentionSug: Dispatch<SetStateAction<M | null>>
  pickMention: (p: Peer) => void
  emojiSug: E | null
  setEmojiSug: Dispatch<SetStateAction<E | null>>
  pickEmojiSuggestion: (e: string) => void
  onReplyPrev?: () => void
  onEditLast?: () => void
  submit: () => void
  applyFmt: (type: ComposerEntityType, url?: string) => void
  /** подпись для window.prompt (Ctrl/Cmd+K) */
  urlPromptLabel: string
}

export function useComposerHotkeys<E extends SugBase<string>, M extends SugBase<Peer>, I extends SugBase<InlineResult>>({
  editorRef, emptyDraft,
  inlineSug, setInlineSug, pickInline,
  mentionSug, setMentionSug, pickMention,
  emojiSug, setEmojiSug, pickEmojiSuggestion,
  onReplyPrev, onEditLast, submit, applyFmt, urlPromptLabel,
}: Args<E, M, I>) {
  return useCallback((e: KeyboardEvent) => {
    // Inline-хелпер (tweb InlineHelper, listType 'xy'): стрелки/Enter/Tab/Escape.
    if (inlineSug) {
      if (e.key === 'Escape') { e.preventDefault(); setInlineSug(null); return }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        setInlineSug((sug) => sug && { ...sug, idx: (sug.idx + dir + sug.list.length) % sug.list.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickInline(inlineSug.list[inlineSug.idx])
        return
      }
    }
    // Mentions-хелпер (attachListNavigation тип 'y', autocompletePeerHelper.ts:24).
    if (mentionSug) {
      if (e.key === 'Escape') { e.preventDefault(); setMentionSug(null); return }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        setMentionSug((sug) => sug && { ...sug, idx: (sug.idx + dir + sug.list.length) % sug.list.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(mentionSug.list[mentionSug.idx])
        return
      }
    }
    // Эмодзи-хелпер (тип 'x' + waitForKey, emojiHelper.ts:32/:141): Escape закрывает,
    // стрелки двигают и «будят» навигацию, Enter/Tab выбирают только когда она активна.
    if (emojiSug) {
      if (e.key === 'Escape') { e.preventDefault(); setEmojiSug(null); return }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
        setEmojiSug((sug) => sug && { ...sug, idx: sug.idx < 0 ? 0 : (sug.idx + dir + sug.list.length) % sug.list.length })
        return
      }
      if (emojiSug.idx >= 0 && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault()
        pickEmojiSuggestion(emojiSug.list[emojiSug.idx])
        return
      }
    }
    // Стрелка вверх — только когда хелперы не перехватили. Shift/Alt не трогаем.
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey) {
      if (e.ctrlKey || e.metaKey) {
        if (onReplyPrev) { e.preventDefault(); onReplyPrev() }
        return
      }
      if (emptyDraft && onEditLast) { e.preventDefault(); onEditLast() }
      return
    }
    // Enter отправляет; Shift+Enter переносит строку (в том числе внутри блока кода —
    // многострочный код набирается им, Enter никогда не «запирает» черновик).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      // Ctrl/Cmd+K — ссылка на выделение (tweb createLink). text_link требует URL:
      // спрашиваем через prompt — в композере нет link-инпута, доступного из keydown
      // (MarkupTooltip держит своё состояние).
      if (e.code === 'KeyK') {
        e.preventDefault()
        const sel = window.getSelection()
        const root = editorRef.current
        if (sel && sel.rangeCount && !sel.isCollapsed && root && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
          const url = window.prompt(urlPromptLabel)?.trim()
          if (url) applyFmt('messageEntityTextUrl', /^https?:\/\//i.test(url) ? url : `https://${url}`)
        }
        return
      }
      const fmt = SHORTCUTS[e.code]
      if (fmt) { e.preventDefault(); applyFmt(fmt) }
    }
  }, [
    editorRef, emptyDraft, inlineSug, setInlineSug, pickInline, mentionSug, setMentionSug, pickMention,
    emojiSug, setEmojiSug, pickEmojiSuggestion, onReplyPrev, onEditLast, submit, applyFmt, urlPromptLabel,
  ])
}
