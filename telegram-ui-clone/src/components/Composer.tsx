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
import EmojiPicker from './EmojiPicker'
import MarkupTooltip from './MarkupTooltip'
import { serialize, apply as applyMarkup, entitiesToFragment, parseMarkdown } from '../core/markdown'
import type { EntityType, MessageEntity } from '../core/models'
import { fmtDur, REC_WAVE_BARS, type VoiceRecorder } from '../core/hooks/useVoiceRecorder'
import { EASE, DUR } from '../motion'
import { useT } from '../i18n'
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

export interface ReplyState { msgId?: number; name: string; text: string; color: string }
export interface EditState { msgId: number; text: string; entities?: MessageEntity[] }

interface Props {
  reply: ReplyState | null
  editing: EditState | null
  rec: VoiceRecorder
  // Send the trimmed draft text + its formatting entities. The parent decides
  // reply/edit/draft/channel routing; the composer just clears its draft afterwards.
  onSend: (text: string, entities?: MessageEntity[]) => void
  // Fired on every keystroke (parent throttles the outgoing `typing` frame).
  onTyping: () => void
  onCancelReply: () => void
  onCancelEdit: () => void
  // Open the attach menu anchored to the paperclip button.
  onOpenAttach: (rect: DOMRect) => void
  // Files pasted/dropped into the input (images, etc.) — routed to the attach flow.
  onPasteFiles?: (files: File[]) => void
}

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
}: Props) {
  const t = useT()
  const [emptyDraft, setEmptyDraft] = useState(true)
  const [emojiOpen, setEmojiOpen] = useState(false)
  // Live code-point length of the draft, for the over-limit guard/counter.
  const [len, setLen] = useState(0)
  // While recording, Esc opens a "discard voice message?" confirm (tweb-style).
  const [cancelRecOpen, setCancelRecOpen] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const hasText = !emptyDraft
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

  const submit = () => {
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
    onSend(text, entities.length ? entities : undefined)
    clearEditor()
    // Keep focus in the input after sending (tweb) — clearEditor drops the
    // selection/children which blurs the contenteditable, so restore it.
    editorRef.current?.focus()
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
    if (em === '\b') document.execCommand('delete')
    else document.execCommand('insertText', false, em)
    syncEmpty()
    autosize()
  }

  return (
    <>
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
                    {reply.text}
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
              <IconButton
                onClick={(e) => onOpenAttach(e.currentTarget.getBoundingClientRect())}
                color="var(--tg-textSecondary)"
                style={{ width: 40, height: 40 }}
              >
                <TgIcon name="attach" />
              </IconButton>
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
                  onInput={() => { syncEmpty(); autosize(); onTyping() }}
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
              <IconButton
                onClick={() => setEmojiOpen((o) => !o)}
                color={emojiOpen ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}
                style={{ width: 40, height: 40 }}
              >
                <TgIcon name="smile" />
              </IconButton>
            </>
          )}
          {/* Mic / Send — 48×40 rounded pill inside the bar (1:1 with TG .btn-send) */}
          <motion.div
            onClick={() => (hasText ? submit() : rec.recording ? rec.stop(true) : rec.start())}
            whileTap={{ scale: 0.92 }}
            className={s.sendBtn}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={hasText || rec.recording ? 'send' : 'mic'}
                initial={{ scale: 0.5, opacity: 0.8 }}
                animate={{ scale: [0.5, 1.1, 1], opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
                style={{ display: 'inline-flex' }}
              >
                {hasText || rec.recording ? <TgIcon name="send" /> : <TgIcon name="microphone_filled" />}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        </div>
      </div>

      {/* Floating formatting bar over a text selection (tweb MarkupTooltip) */}
      <MarkupTooltip editorRef={editorRef} onApply={applyFmt} />

      <AnimatePresence>
        {emojiOpen && (
          <EmojiPicker
            onPick={insertEmoji}
            onClose={() => setEmojiOpen(false)}
          />
        )}
      </AnimatePresence>

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

export default memo(Composer)
