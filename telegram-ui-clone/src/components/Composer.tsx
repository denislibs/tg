// src/components/Composer.tsx
// The message composer (input row + reply/edit bars + emoji picker), extracted
// from ConversationView so the draft text lives in LOCAL state. Typing then
// re-renders only this component — not the whole conversation (feed/header). The
// parent stays in control via callbacks: it owns send/edit/reply/voice logic and
// is notified on send. Keyed by chat in the parent, so it remounts (clearing the
// draft + autofocusing) when the chat changes.
//
// The input is a contenteditable div (not a textarea) so it can show rich
// formatting inline (bold/italic/spoiler/code/quote/link), 1:1 with tweb. On send
// the DOM is serialized to plain text + a MessageEntity[] (see core/markdown).
import { memo, useEffect, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import EmojiDropdown, { useDropdownHover } from './emoji/EmojiDropdown'
import EmojiHelper from './EmojiHelper'
import MentionsHelper from './MentionsHelper'
import InlineResultsHelper from './InlineResultsHelper'
import type { InlineResult } from '../core/managers/botsManager'
import type { Peer } from '../core/managers/peersManager'
import { searchEmojisByWord } from './emoji/emojiData'
import MarkupTooltip from './MarkupTooltip'
import { serialize, apply as applyMarkup, entitiesToFragment, parseMarkdown } from '../core/markdown'
import type { EntityType, MessageEntity } from '../core/models'
import { fmtDur, REC_WAVE_BARS, type VoiceRecorder } from '../core/hooks/useVoiceRecorder'
import { EASE, DUR } from '../motion'
import { useT } from '../i18n'
import { useSettingsStore } from '../settings'
import Menu, { MenuItem } from '../shared/ui/Menu'
import SchedulePopup from './SchedulePopup'
import { createPortal } from 'react-dom'
import {DiscardVoiceDialog} from "./messages/ChatDialogs.tsx";
import s from './Composer.module.scss'

const EASE_STD = EASE
const DUR_OUT = DUR.out

// Max message length (matches the backend's maxMessageRunes / Telegram's 4096).
const MAX_LEN = 4096

// Ctrl/Cmd + key → format. text_link is handled by the tooltip (needs a URL).
const SHORTCUTS: Record<string, EntityType> = {
  KeyB: 'bold', KeyI: 'italic', KeyU: 'underline',
  KeyS: 'strikethrough', KeyM: 'code', KeyP: 'spoiler',
}

export interface ReplyState { msgId?: number; name: string; text: string; color: string; quote?: { text: string; offset: number } }
export interface EditState { msgId: number; text: string; entities?: MessageEntity[] }

interface Props {
  reply: ReplyState | null
  editing: EditState | null
  rec: VoiceRecorder
  // Send the trimmed draft text + its formatting entities. The parent decides
  // reply/edit/draft/channel routing; the composer just clears its draft afterwards.
  // ttlSeconds — self-destruct TTL for secret chats (null/undefined — off).
  // silent — тихая отправка (Telegram disable_notification): без push/звука у получателя.
  onSend: (text: string, entities?: MessageEntity[], ttlSeconds?: number | null, silent?: boolean) => void
  // Fired on every keystroke (parent throttles the outgoing `typing` frame).
  onTyping: () => void
  onCancelReply: () => void
  onCancelEdit: () => void
  // Open the attach menu anchored to the paperclip button.
  onOpenAttach: (rect: DOMRect) => void
  // Files pasted/dropped into the input (images, etc.) — routed to the attach flow.
  onPasteFiles?: (files: File[]) => void
  // Облачный черновик: текст для восстановления при маунте (композер
  // пересоздаётся per-chat через key) + колбэк на каждое изменение текста
  // (родитель дебаунсит сейв — tweb saveDraftDebounced).
  initialDraft?: string
  onDraftChange?: (text: string) => void
  // Кандидаты @упоминаний (участники группы без себя) — включает mentions-хелпер.
  mentions?: Peer[]
  // Inline-режим: резолв «@bot query» → результаты (null — не бот/пусто) и
  // отправка выбранного результата (tweb InlineHelper + sendInlineResult).
  onInlineQuery?: (username: string, query: string) => Promise<InlineResult[] | null>
  onPickInline?: (r: InlineResult) => void
  // Кнопка-меню mini-app бота (tweb bot menu button) — слева от инпута.
  botMenuButton?: { text: string; onClick: () => void }
  // Запланированные сообщения: ПКМ по Send → «Запланировать сообщение».
  onSchedule?: (text: string, entities: MessageEntity[] | undefined, sendAtUnix: number) => void
  // Есть запланированные → кнопка-календарик (tweb btnScheduled) открывает список.
  scheduledCount?: number
  onOpenScheduled?: () => void
  // Медленный режим: секунд до следующей отправки (0/undefined — нет); >0
  // блокирует отправку и показывает обратный отсчёт на кнопке (tweb slowmode).
  slowmodeLeft?: number
  // Секретный чат: показывает кнопку выбора таймера самоуничтожения (tweb secret
  // chat self-destruct). Выбранный TTL уходит третьим аргументом onSend.
  secret?: boolean
}

// Таймер самоуничтожения для секретных чатов (tweb ttl options). null — «Выкл».
const TTL_OPTIONS: { label: string; secs: number | null }[] = [
  { label: 'Off', secs: null },
  { label: '5с', secs: 5 },
  { label: '10с', secs: 10 },
  { label: '30с', secs: 30 },
  { label: '1м', secs: 60 },
  { label: '1ч', secs: 3600 },
  { label: '1д', secs: 86400 },
  { label: '1нед', secs: 604800 },
]
// Короткая подпись выбранного TTL для кнопки-часов.
const ttlShort = (s: number): string =>
  s < 60 ? `${s}с` : s < 3600 ? `${s / 60}м` : s < 86400 ? `${s / 3600}ч` : s < 604800 ? `${s / 86400}д` : `${s / 604800}нед`

// URL schemes safe to keep on a pasted link (others are dropped — see RichText).
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'tg'])
function isSafeUrl(u?: string): boolean {
  if (!u) return false
  const m = u.trim().match(/^([a-z][a-z0-9+.-]*):/i)
  return !m || SAFE_SCHEMES.has(m[1].toLowerCase())
}

// Parse pasted HTML into our { text, entities }. Strips script/style/comments,
// then reuses serialize() (which understands b/i/u/s/a/code/pre/blockquote +
// inline styles). Unsafe links are dropped.
function htmlToRich(html: string): { text: string; entities: MessageEntity[] } {
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const doc = new DOMParser().parseFromString(cleaned, 'text/html')
  const { text, entities } = serialize(doc.body)
  return { text, entities: entities.filter((e) => e.type !== 'text_link' || isSafeUrl(e.url)) }
}

function placeCaretEnd(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function Composer({
  reply, editing, rec, onSend, onTyping, onCancelReply, onCancelEdit, onOpenAttach, onPasteFiles,
  initialDraft, onDraftChange, mentions, onInlineQuery, onPickInline, botMenuButton, onSchedule, scheduledCount, onOpenScheduled, slowmodeLeft, secret,
}: Props) {
  const slowmodeBlocked = (slowmodeLeft ?? 0) > 0
  const slowmodeText = (slowmodeLeft ?? 0) >= 60 ? `${Math.ceil((slowmodeLeft ?? 0) / 60)}м` : String(slowmodeLeft ?? 0)
  const t = useT()
  const [emptyDraft, setEmptyDraft] = useState(true)
  // Эмодзи-дропдаун: открытие по hover/клику (tweb DropdownHover); клики по
  // инпуту не закрывают его (tweb ignoreOutClickClassName: input-message-input).
  const emojiDd = useDropdownHover((target) => editorRef.current?.contains(target) ?? false)
  // Ленивый первый маунт: до первого открытия панель не в DOM, после — живёт
  // скрытой (display:none), сохраняя скролл/состояние (как tweb).
  const [emojiMounted, setEmojiMounted] = useState(false)
  if (emojiDd.open && !emojiMounted) setEmojiMounted(true)
  // Live code-point length of the draft, for the over-limit guard/counter.
  const [len, setLen] = useState(0)
  // While recording, Esc opens a "discard voice message?" confirm (tweb-style).
  const [cancelRecOpen, setCancelRecOpen] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const hasText = !emptyDraft
  // Тип записи (голос/кружок) — персист в settings; long-press/ПКМ по кнопке
  // открывает меню переключения (tweb chatRecording.setupRecordingModeMenu).
  const recordingMediaType = useSettingsStore((st) => st.recordingMediaType)
  const updateSettings = useSettingsStore((st) => st.update)
  const [recMenu, setRecMenu] = useState<{ right: number; bottom: number } | null>(null)
  // Секретный TTL самоуничтожения (сек; null — выкл) + якорь его меню.
  const [secretTtl, setSecretTtl] = useState<number | null>(null)
  const [ttlMenu, setTtlMenu] = useState<{ left: number; bottom: number } | null>(null)
  const longPressTimer = useRef<number | undefined>(undefined)
  const longPressed = useRef(false)
  const openRecMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setRecMenu({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 8 })
  }
  // Estimated message count once over the limit (the exact split happens on send).
  const msgCount = len > MAX_LEN ? Math.ceil(len / MAX_LEN) : 0

  const syncEmpty = () => {
    const txt = editorRef.current?.textContent ?? ''
    setEmptyDraft(!txt.trim())
    // UTF-16 length (O(1)); for over-limit drafts (mostly ASCII code) it matches the
    // backend's rune cap closely. Avoid spreading the whole string — on a huge paste
    // [...txt] allocates a multi-thousand-element array on every input.
    setLen(txt.length)
  }

  // Auto-grow the input with its content, animated (tweb grows line-by-line up to
  // ~30vh, then scrolls). The 'auto' measure + rAF restores a from-height so the
  // height transition animates instead of jumping.
  const autosize = () => {
    const ed = editorRef.current
    if (!ed) return
    const max = Math.round(window.innerHeight * 0.3)
    const prev = ed.style.height
    ed.style.height = 'auto'
    const target = Math.min(max, ed.scrollHeight)
    ed.style.height = prev || `${target}px`
    requestAnimationFrame(() => {
      const e = editorRef.current
      if (!e) return
      e.style.height = `${target}px`
      e.style.overflowY = e.scrollHeight > max ? 'auto' : 'hidden'
    })
  }

  // Edit start: prefill the draft with the message's formatted content + focus.
  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.replaceChildren(entitiesToFragment(editing.text, editing.entities))
      syncEmpty()
      editorRef.current.focus()
      placeCaretEnd(editorRef.current)
      autosize()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  // Reply start: focus the input.
  useEffect(() => {
    if (reply) editorRef.current?.focus()
  }, [reply])

  // Восстановление облачного черновика при маунте (tweb setDraft: только в
  // пустой инпут; редактирование имеет приоритет).
  useEffect(() => {
    const ed = editorRef.current
    if (initialDraft && ed && !ed.textContent && !editing) {
      ed.textContent = initialDraft
      syncEmpty()
      autosize()
      placeCaretEnd(ed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autofocus on mount (remounts per chat via the parent's key).
  useEffect(() => {
    const id = window.setTimeout(() => editorRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [])
    // While recording, Esc asks to discard (tweb-style confirm), not silently drop.
    useEffect(() => {
        if (!rec.recording) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); setCancelRecOpen(true) }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [rec.recording])

  const clearEditor = () => {
    if (editorRef.current) {
      editorRef.current.replaceChildren()
      editorRef.current.style.height = '' // collapse back to one line
      editorRef.current.style.overflowY = 'hidden'
    }
    setEmptyDraft(true)
    setLen(0)
    // selection is gone after clearing — tell the markup tooltip to hide
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  }

  // ── Планирование (tweb SendMenu → scheduleSending) ──
  const [sendMenuOpen, setSendMenuOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const submitScheduled = (sendAtUnix: number) => {
    const root = editorRef.current
    if (!root || !onSchedule) return
    const raw = serialize(root)
    const { text, entities } = parseMarkdown(raw.text, raw.entities)
    if (!text) return
    onSchedule(text, entities.length ? entities : undefined, sendAtUnix)
    clearEditor()
    onDraftChange?.('')
    setScheduleOpen(false)
  }

  const submit = (silent = false) => {
    if (slowmodeBlocked) return // медленный режим: отправка заблокирована до конца отсчёта
    const root = editorRef.current
    if (!root) return
    const raw = serialize(root)
    if (!raw.text) return
    // Parse markdown markers → entities on send (tweb model: the input stays raw,
    // markers become formatting only when sent). Toolbar-applied entities are passed
    // in and merged/offset-adjusted.
    const { text, entities } = parseMarkdown(raw.text, raw.entities)
    if (!text) return
    // Over the limit is fine — the parent splits into multiple messages
    // (tweb splitStringByLength). The counter shows how many it'll be.
    onSend(text, entities.length ? entities : undefined, secret ? secretTtl : undefined, silent)
    setEmojiSug(null)
    setInlineSug(null)
    clearEditor()
    onDraftChange?.('') // отправка снимает черновик (бэк тоже чистит свой)
    // Keep focus in the input after sending (tweb focusInput = focus + caret at
    // the end) — clearEditor drops the selection which blurs the contenteditable.
    const ed = editorRef.current
    if (ed) { ed.focus(); placeCaretEnd(ed) }
  }

  const applyFmt = (type: EntityType, url?: string) => {
    const root = editorRef.current
    if (!root) return
    applyMarkup(root, type, url)
    syncEmpty()
    autosize()
    onTyping()
  }

  // Insert plain text at the caret as a SINGLE text node. Crucial for large pastes:
  // `execCommand('insertText')` turns every '\n' into its own <div>, so pasting
  // 1000 lines spawns ~1000 nodes + reflows and freezes the tab for seconds. One
  // text node + white-space:pre-wrap renders the newlines with a single mutation.
  const insertPlainText = (text: string) => {
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
  }

  // Insert a prepared DocumentFragment (formatted paste) at the caret.
  const insertFragment = (frag: DocumentFragment) => {
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
  }

  // Insert clipboard/drop content. Order: (1) files/images → attach flow;
  // (2) HTML → entities (keep formatting), but only when its visible text matches
  // the plain text (skip garbage from tables/lists); (3) plain text otherwise.
  // We never inject raw HTML (always our own sanitized DOM), and never run the
  // live parsers on bulk content, so a huge paste stays safe + cheap.
  const insertClipboard = (plain: string, html: string) => {
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
  }

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const files = Array.from(e.clipboardData.files || [])
    if (files.length && onPasteFiles) { onPasteFiles(files); return }
    insertClipboard(e.clipboardData.getData('text/plain').replace(/\r/g, ''), e.clipboardData.getData('text/html'))
    syncEmpty()
    autosize()
    onTyping()
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length && onPasteFiles) { onPasteFiles(files); return }
    insertClipboard(e.dataTransfer.getData('text/plain').replace(/\r/g, ''), e.dataTransfer.getData('text/html'))
    syncEmpty()
    autosize()
  }

  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    // Inline-хелпер (tweb InlineHelper list-навигация): стрелки/Enter/Tab/Escape.
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
    // Mentions-хелпер (tweb attachListNavigation тип 'y'): стрелки вверх/вниз,
    // Enter/Tab выбирают, Escape закрывает.
    if (mentionSug) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionSug(null)
        return
      }
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
    // Эмодзи-хелпер перехватывает навигацию (tweb attachListNavigation):
    // Escape закрывает; стрелки двигают (и «будят» навигацию для слова);
    // Enter/Tab выбирают только когда навигация активна.
    if (emojiSug) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setEmojiSug(null)
        return
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
        setEmojiSug((sug) =>
          sug && {
            ...sug,
            idx: sug.idx < 0 ? 0 : (sug.idx + dir + sug.list.length) % sug.list.length,
          },
        )
        return
      }
      if (emojiSug.idx >= 0 && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault()
        pickEmojiSuggestion(emojiSug.list[emojiSug.idx])
        return
      }
    }
    // Enter always sends; Shift+Enter adds a line (incl. inside a code block, so
    // multi-line blocks are typed with Shift+Enter — Enter never traps the draft).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const fmt = SHORTCUTS[e.code]
      if (fmt) { e.preventDefault(); applyFmt(fmt) }
    }
  }

  const insertEmoji = (em: string) => {
    const root = editorRef.current
    if (!root) return
    root.focus()
    document.execCommand('insertText', false, em)
    syncEmpty()
    autosize()
  }
  // Кнопка backspace в нижних табах дропдауна (tweb emoji-tabs-delete).
  const deleteBeforeCaret = () => {
    const root = editorRef.current
    if (!root) return
    root.focus()
    document.execCommand('delete')
    syncEmpty()
    autosize()
  }

  // ── Эмодзи-автокомплит (tweb emojiHelper): подсказки по слову у каретки ──
  // idx = -1 — навигация «спит» до первой стрелки (tweb waitForKey для слова);
  // для ':query' активируется сразу.
  const [emojiSug, setEmojiSug] = useState<{ list: string[]; wordLen: number; idx: number } | null>(null)

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

  // ── Inline-режим (tweb InlineHelper): весь инпут начинается с «@bot query» ──
  const [inlineSug, setInlineSug] = useState<{ list: InlineResult[]; idx: number } | null>(null)
  const inlineTimer = useRef<number | undefined>(undefined)
  const inlineReq = useRef(0) // токен запроса — гасим гонки

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

  // ── @упоминания (tweb mentionsHelper): участники группы по слову '@query' ──
  const [mentionSug, setMentionSug] = useState<{ list: Peer[]; wordLen: number; idx: number } | null>(null)

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

  return (
    <>
      {/* composerBox — relative-якорь плашки эмодзи-подсказок над инпутом */}
      <div className={s.composerBox}>
      {/* Плашка эмодзи-автокомплита (tweb emoji-helper) */}
      <AnimatePresence>
        {inlineSug && !rec.recording && (
          <InlineResultsHelper results={inlineSug.list} activeIdx={inlineSug.idx} onPick={pickInline} />
        )}
        {mentionSug && !inlineSug && !rec.recording && (
          <MentionsHelper peers={mentionSug.list} activeIdx={mentionSug.idx} onPick={pickMention} />
        )}
        {emojiSug && !mentionSug && !inlineSug && !rec.recording && (
          <EmojiHelper emojis={emojiSug.list} activeIdx={emojiSug.idx} onPick={pickEmojiSuggestion} />
        )}
      </AnimatePresence>
      {/* Composer container: reply section + input row in ONE box */}
      <div className={s.container}>
        {/* Animated reply bar (inside the container) */}
        <AnimatePresence initial={false}>
          {reply && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: DUR_OUT, ease: EASE_STD }}
              style={{ overflow: 'hidden' }}
            >
              <div className={s.bar} style={{ background: `${reply.color}1f` }}>
                <TgIcon name="reply" size={22} color={reply.color} />
                <div className={s.barBody} style={{ borderLeft: `2px solid ${reply.color}` }}>
                  <Text size={14} weight={600} color={reply.color}>
                    {t('Reply to')} {reply.name}
                  </Text>
                  <Text noWrap size={14} color="var(--tg-textSecondary)">
                    {reply.quote ? (
                      <>
                        <TgIcon name="quote_outline" size={13} style={{ verticalAlign: '-1px', marginRight: 3, opacity: 0.7 }} />
                        {reply.quote.text}
                      </>
                    ) : reply.text}
                  </Text>
                </div>
                <IconButton size="small" onClick={onCancelReply} color="var(--tg-textFaint)">
                  <TgIcon name="close" size={20} />
                </IconButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Animated edit bar */}
        <AnimatePresence initial={false}>
          {editing && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: DUR_OUT, ease: EASE_STD }}
              style={{ overflow: 'hidden' }}
            >
              <div className={s.bar} style={{ background: 'color-mix(in srgb, var(--tg-accent) 12%, transparent)' }}>
                <TgIcon name="edit" size={22} color="var(--tg-accent)" />
                <div className={s.barBody} style={{ borderLeft: '2px solid var(--tg-accent)' }}>
                  <Text size={14} weight={600} color="var(--tg-accent)">{t('Edit message')}</Text>
                  <Text noWrap size={14} color="var(--tg-textSecondary)">{editing.text}</Text>
                </div>
                <IconButton size="small" onClick={() => { onCancelEdit(); clearEditor() }} color="var(--tg-textFaint)">
                  <TgIcon name="close" size={20} />
                </IconButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input row — buttons anchor to the BOTTOM so they stay put as the input grows */}
        <div className={s.inputRow}>
          {rec.recording ? (
            <>
              {/* cancel (discard) */}
              <IconButton onClick={() => rec.stop(false)} color="#ff5a5a" style={{ width: 40, height: 40, flexShrink: 0 }}>
                <TgIcon name="delete" />
              </IconButton>
              {/* tinted pill: dot/timer + live waveform (tweb voice-recording-pill) */}
              <div className={s.recPill}>
                {rec.paused ? (
                  <div className={s.recDotPaused} />
                ) : (
                  <motion.span
                    className={s.recDotLive}
                    animate={{ opacity: [1, 0.25, 1] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <Text size={16} color="var(--tg-textPrimary)" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {fmtDur(rec.secs)}
                </Text>
                {/* live input-level waveform — fills the full pill width
                    (left-padded with a baseline, each bar flexes to fill) */}
                <div className={s.wave}>
                  {[...Array(Math.max(0, REC_WAVE_BARS - rec.bars.length)).fill(0.05), ...rec.bars]
                    .slice(-REC_WAVE_BARS)
                    .map((h, i) => (
                      <div
                        key={i}
                        className={s.waveBar}
                        style={{ height: `${Math.round(4 + h * 20)}px`, opacity: 0.45 + 0.55 * (i / REC_WAVE_BARS) }}
                      />
                    ))}
                </div>
              </div>
              {/* pause / resume toggle */}
              <IconButton onClick={rec.togglePause} color="var(--tg-accent)" style={{ width: 40, height: 40, flexShrink: 0 }}>
                {rec.paused ? <TgIcon name="microphone_filled" /> : <TgIcon name="pause" />}
              </IconButton>
            </>
          ) : (
            <>
              {/* Кнопка-меню mini-app бота (tweb bot menu button) — пилюля слева */}
              {botMenuButton && (
                <button type="button" className={s.menuBtn} onMouseDown={(e) => e.preventDefault()} onClick={botMenuButton.onClick}>
                  <TgIcon name="bots" size={20} />
                  <span>{botMenuButton.text}</span>
                </button>
              )}
              <IconButton
                onClick={(e) => onOpenAttach(e.currentTarget.getBoundingClientRect())}
                color="var(--tg-textSecondary)"
                style={{ width: 40, height: 40 }}
              >
                <TgIcon name="attach" />
              </IconButton>
              {/* Таймер самоуничтожения — только в секретном чате (tweb secret ttl).
                  Тинт accent + короткая подпись, когда таймер включён. */}
              {secret && (
                <IconButton
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setTtlMenu({ left: r.left, bottom: window.innerHeight - r.top + 8 })
                  }}
                  color={secretTtl != null ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}
                  style={{ width: 40, height: 40, position: 'relative' }}
                >
                  <TgIcon name="timer" />
                  {secretTtl != null && (
                    <span
                      style={{
                        position: 'absolute', bottom: 1, right: 0,
                        fontSize: 9, fontWeight: 700, lineHeight: 1,
                        color: 'var(--tg-accent)', pointerEvents: 'none',
                      }}
                    >
                      {ttlShort(secretTtl)}
                    </span>
                  )}
                </IconButton>
              )}
              {/* Календарик при наличии запланированных (tweb btnScheduled) */}
              {(scheduledCount ?? 0) > 0 && onOpenScheduled && (
                <IconButton onClick={onOpenScheduled} color="var(--tg-accent)" style={{ width: 40, height: 40 }}>
                  <TgIcon name="scheduled" />
                </IconButton>
              )}
              {/* contenteditable input + placeholder overlay. minHeight matches the
                  40px buttons and centers a single line with them; multi-line grows
                  upward (the row is flex-end, so buttons stay pinned to the bottom). */}
              <div className={s.editorWrap}>
                {emptyDraft && (
                  <Text
                    aria-hidden
                    size={16}
                    color="var(--tg-textFaint)"
                    className={s.placeholder}
                  >
                    {t('Message')}
                  </Text>
                )}
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline
                  // No live markdown conversion in the input (tweb keeps typed markers
                  // raw; they're parsed on send). Only the toolbar/shortcuts format live.
                  onInput={() => { syncEmpty(); autosize(); onTyping(); checkInlineAutocomplete(); checkMentionAutocomplete(); checkEmojiAutocomplete(); onDraftChange?.(editorRef.current?.textContent ?? '') }}
                  onKeyDown={onEditorKeyDown}
                  onPaste={onPaste}
                  onDrop={onDrop}
                  className={s.editor}
                />
              </div>
              {/* Near the limit: remaining chars. Over it: how many messages the
                  draft will split into on send (tweb-style). */}
              {(len > MAX_LEN - 256 || msgCount > 1) && (
                <Text
                  title={msgCount > 1 ? `Будет отправлено сообщений: ${msgCount}` : undefined}
                  size={12}
                  color={msgCount > 1 ? 'var(--tg-accent)' : 'var(--tg-textFaint)'}
                  className={s.counter}
                >
                  {msgCount > 1 ? `${msgCount} 💬` : MAX_LEN - len}
                </Text>
              )}
              <span ref={emojiDd.buttonRef} {...emojiDd.buttonProps} style={{ display: 'inline-flex' }}>
                <IconButton
                  color={emojiDd.open ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}
                  style={{ width: 40, height: 40 }}
                >
                  <TgIcon name="smile" />
                </IconButton>
              </span>
            </>
          )}
          {/* Mic / Send — 48×40 rounded pill inside the bar (1:1 with TG .btn-send) */}
          <motion.div
            onClick={() => {
              if (longPressed.current) { longPressed.current = false; return } // long-press открыл меню — клик глотаем
              if (hasText) submit()
              else if (rec.recording) rec.stop(true)
              else void rec.start(recordingMediaType)
            }}
            // Не отдавать фокус кнопке: без preventDefault тап/клик блюрит инпут и
            // прячет клавиатуру на touch (tweb шлёт send на mousedown — фокус не теряется).
            // Плюс long-press ~400ms (tweb) открывает меню выбора голос/кружок.
            onMouseDown={(e) => {
              e.preventDefault()
              if (hasText || rec.recording) return
              window.clearTimeout(longPressTimer.current)
              // таймер лишь помечает long-press; меню откроется на mouseup —
              // так click после отпускания глотается кнопкой, а не бэкдропом меню
              longPressTimer.current = window.setTimeout(() => { longPressed.current = true }, 400)
            }}
            onMouseUp={(e) => {
              window.clearTimeout(longPressTimer.current)
              if (longPressed.current) openRecMenu(e.currentTarget as HTMLElement)
            }}
            onMouseLeave={() => { window.clearTimeout(longPressTimer.current); longPressed.current = false }}
            onContextMenu={(e) => {
              e.preventDefault()
              // ПКМ/long-press по Send с текстом — меню отправки (tweb SendMenu):
              // «Без звука» + «Запланировать».
              if (hasText) {
                setSendMenuOpen(true)
                return
              }
              if (!hasText && !rec.recording) openRecMenu(e.currentTarget as HTMLElement)
            }}
            whileTap={{ scale: 0.92 }}
            className={s.sendBtn}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={slowmodeBlocked ? 'slow' : hasText || rec.recording ? 'send' : 'mic'}
                initial={{ scale: 0.5, opacity: 0.8 }}
                animate={{ scale: [0.5, 1.1, 1], opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
                style={{ display: 'inline-flex' }}
              >
                {slowmodeBlocked
                  ? <span className={s.slowmodeTimer}>{slowmodeText}</span>
                  : hasText || rec.recording ? <TgIcon name="send" /> : <TgIcon name={recordingMediaType === 'round' ? 'recordround' : 'microphone_filled'} />}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
      </div>

      {/* Меню планирования по ПКМ на Send (tweb SendMenu) */}
      <Menu
        open={sendMenuOpen}
        onClose={() => setSendMenuOpen(false)}
        style={{ right: 24, bottom: 72, transformOrigin: 'bottom right' }}
      >
        {/* Тихая отправка (tweb SendMenu «Send Without Sound») — per-send: шлём сразу */}
        <MenuItem
          icon={<TgIcon name="nosound" size={20} />}
          label={t('Send Without Sound')}
          onClick={() => { setSendMenuOpen(false); submit(true) }}
        />
        {onSchedule && (
          <MenuItem
            icon={<TgIcon name="schedule" size={20} />}
            label={t('Schedule Message')}
            onClick={() => { setSendMenuOpen(false); setScheduleOpen(true) }}
          />
        )}
      </Menu>
      {scheduleOpen && <SchedulePopup onPick={submitScheduled} onClose={() => setScheduleOpen(false)} />}

      {/* Floating formatting bar over a text selection (tweb MarkupTooltip) */}
      <MarkupTooltip editorRef={editorRef} onApply={applyFmt} />

      {emojiMounted && (
        <div ref={emojiDd.panelRef} style={{ display: 'contents' }}>
          <EmojiDropdown
            open={emojiDd.open}
            onPick={insertEmoji}
            onDelete={deleteBeforeCaret}
            onClose={emojiDd.close}
            panelProps={emojiDd.panelProps}
          />
        </div>
      )}

        {/* Меню таймера самоуничтожения секретного чата (tweb self-destruct ttl) */}
        {ttlMenu && (
          <Menu
            open
            onClose={() => setTtlMenu(null)}
            style={{ left: ttlMenu.left, bottom: ttlMenu.bottom, transformOrigin: 'bottom left' }}
          >
            {TTL_OPTIONS.map((o) => (
              <MenuItem
                key={o.label}
                icon={<TgIcon name="timer" size={20} />}
                label={o.secs == null ? t('Off') : o.label}
                right={secretTtl === o.secs ? <TgIcon name="check" size={18} color="var(--tg-accent)" /> : undefined}
                onClick={() => { setSecretTtl(o.secs); setTtlMenu(null) }}
              />
            ))}
          </Menu>
        )}

        {/* Выбор типа записи: голос / видео-кружок (tweb recording mode menu) */}
        {recMenu && (
          <Menu
            open
            onClose={() => setRecMenu(null)}
            style={{ right: recMenu.right, bottom: recMenu.bottom, transformOrigin: 'bottom right' }}
          >
            <MenuItem
              icon={<TgIcon name="microphone" size={20} />}
              label={t('Record voice message')}
              onClick={() => { updateSettings({ recordingMediaType: 'voice' }); setRecMenu(null) }}
            />
            <MenuItem
              icon={<TgIcon name="recordround" size={20} />}
              label={t('Record video message')}
              onClick={() => { updateSettings({ recordingMediaType: 'round' }); setRecMenu(null) }}
            />
          </Menu>
        )}

        {/* Живое круглое превью записи кружка (tweb videoRecordingPanel, 360px) */}
        {rec.recording && rec.mode === 'round' && rec.previewStream && createPortal(
          <RoundRecordPreview stream={rec.previewStream} secs={rec.secs} />,
          document.body,
        )}

        {/* Discard-recording confirm (Esc) */}
        <AnimatePresence>
            {cancelRecOpen && (
                <DiscardVoiceDialog
                    onCancel={() => setCancelRecOpen(false)}
                    onDiscard={() => { setCancelRecOpen(false); rec.stop(false) }}
                />
            )}
        </AnimatePresence>
    </>
  )
}

// Круглое зеркальное превью записываемого кружка по центру чата + кольцо
// прогресса лимита (tweb: белая дуга бежит по кругу до 60с).
const ROUND_LIMIT = 60
function RoundRecordPreview({ stream, secs }: { stream: MediaStream; secs: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  const C = 2 * Math.PI * 49
  return (
    <div className={s.roundPreviewWrap}>
      <video ref={ref} className={s.roundPreview} autoPlay muted playsInline />
      <svg className={s.roundProgress} viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r="49" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.min(1, secs / ROUND_LIMIT))}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
    </div>
  )
}

export default memo(Composer)
