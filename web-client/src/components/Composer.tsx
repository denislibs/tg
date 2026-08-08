// src/components/Composer.tsx
// The message composer (input row + reply/edit bars + emoji picker), extracted
// from Chat so the draft text lives in LOCAL state. Typing then
// re-renders only this component — not the whole conversation (feed/header). The
// parent stays in control via callbacks: it owns send/edit/reply/voice logic and
// is notified on send. Keyed by chat in the parent, so it remounts (clearing the
// draft + autofocusing) when the chat changes.
//
// The input is a contenteditable div (not a textarea) so it can show rich
// formatting inline (bold/italic/spoiler/code/quote/link), 1:1 with tweb. On send
// the DOM is serialized to plain text + a MessageEntity[] (see core/markdown).
import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { useDropdownHover } from './emoji/useDropdownHover'
import EmojiHelper from './EmojiHelper'
import StickersHelper, { stickerSuggestEmoji } from './StickersHelper'
import type { Sticker } from '../core/managers/stickersManager'
import type { GifItem } from '../core/gifs'
import MentionsHelper from './MentionsHelper'
import InlineResultsHelper from './InlineResultsHelper'
import type { InlineResult } from '../core/managers/botsManager'
import type { Peer } from '../core/managers/peersManager'
import type { SendAsPeer } from '../core/managers/chatsManager'
import MarkupTooltip from './MarkupTooltip'
import { serialize, apply as applyMarkup, entitiesToFragment, parseMarkdown } from '../core/richtext/markdown'
import SendAsButton from './composer/SendAsButton'
import RoundRecordPreview from './composer/RoundRecordPreview'
import { MAX_LEN, SHORTCUTS, EFFECT_CHOICES, TTL_OPTIONS, ttlShort, htmlToRich, placeCaretEnd } from './composer/helpers'
import { useComposerAutocomplete } from './composer/useComposerAutocomplete'
import { playEmojiEffect, type EmojiEffectKind } from '../core/effects/emojiEffects'
import type { EntityType, MessageEntity } from '../core/models'
import { fmtDur, REC_WAVE_BARS, type VoiceRecorder } from '../core/hooks/useVoiceRecorder'
import { EASE, DUR } from '../motion'
import { useT } from '../i18n'
import { uiEvents } from '../core/hooks/uiEvents'
import { useSettingsStore } from '../settings'
import Menu, { MenuItem } from '../shared/ui/Menu'
import SchedulePopup from './SchedulePopup'
import { createPortal } from 'react-dom'
import { DiscardVoiceDialog } from './messages/ChatDialogs.tsx'
import s from './Composer.module.scss'

// Пикер эмодзи/стикеров/гифок — тяжёлый (сетки, StickersTab/GifsTab), но нужен
// только по открытию. Грузим лениво отдельным чанком — вон из главного бандла.
const EmojiDropdown = lazy(() => import('./emoji/EmojiDropdown'))

const EASE_STD = EASE
const DUR_OUT = DUR.out

export interface ReplyState { msgId?: number; name: string; text: string; color: string; quote?: { text: string; offset: number }; chatId?: number; snapshotName?: string; snapshotText?: string }
export interface EditState { msgId: number; text: string; entities?: MessageEntity[] }
// Плашка форварда (tweb forwarding): превью пересылаемого + опции меню.
export interface ForwardBar { sourceChatId: number; msgIds: number[]; count: number; text: string; hasCaption: boolean; dropAuthor: boolean; dropCaption: boolean }

interface Props {
  reply: ReplyState | null
  editing: EditState | null
  forward: ForwardBar | null
  rec: VoiceRecorder
  // Send the trimmed draft text + its formatting entities. The parent decides
  // reply/edit/draft/channel routing; the composer just clears its draft afterwards.
  // ttlSeconds — self-destruct TTL for secret chats (null/undefined — off).
  // silent — тихая отправка (Telegram disable_notification): без push/звука у получателя.
  // effect — выбранный эффект сообщения (наш аналог Telegram message effects).
  onSend: (text: string, entities?: MessageEntity[], ttlSeconds?: number | null, silent?: boolean, effect?: EmojiEffectKind | null) => void
  // Fired on every keystroke (parent throttles the outgoing `typing` frame).
  onTyping: () => void
  // Отправка стикера (пикер/саджесты) — включает вкладку стикеров в дропдауне
  // и панель саджестов по одиночному эмодзи (tweb StickersHelper).
  onPickSticker?: (st: Sticker) => void
  // Отправка GIF из пикера — включает вкладку GIF в дропдауне (композер, не реакции).
  onPickGif?: (g: GifItem) => void
  onCancelReply: () => void
  onCancelEdit: () => void
  // Плашка форварда: отмена, тоггл опций (скрыть отправителя/подпись), «в другой чат».
  onCancelForward: () => void
  onForwardOption: (opt: { dropAuthor?: boolean; dropCaption?: boolean }) => void
  onForwardAnother: () => void
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
  // «Отправить, когда онлайн» (tweb Schedule.SendWhenOnline): доступно только в
  // личном чате, когда статус собеседника виден и он НЕ онлайн (canSendWhenOnline).
  // Пункт SendMenu + вторичная кнопка в попапе планирования шлют текущий драфт.
  canSendWhenOnline?: boolean
  onSendWhenOnline?: (text: string, entities: MessageEntity[] | undefined) => void
  // Есть запланированные → кнопка-календарик (tweb btnScheduled) открывает список.
  scheduledCount?: number
  onOpenScheduled?: () => void
  // Медленный режим: секунд до следующей отправки (0/undefined — нет); >0
  // блокирует отправку и показывает обратный отсчёт на кнопке (tweb slowmode).
  slowmodeLeft?: number
  // Секретный чат: показывает кнопку выбора таймера самоуничтожения (tweb secret
  // chat self-destruct). Выбранный TTL уходит третьим аргументом onSend.
  secret?: boolean
  // Групповые дефолт-права: если false — медиа запрещены (attach/микрофон серые,
  // вставка файлов блокируется). По умолчанию true.
  canSendMedia?: boolean
  // Платные сообщения (Telegram paid messages): плата за сообщение в звёздах для
  // не-админа (0/undefined — бесплатно). >0 показывает плашку над инпутом.
  chargeStars?: number
  // ↑ при пустом инпуте (без активных хелперов) — редактировать своё последнее
  // сообщение (tweb ↑ = editLastMessage). Родитель ищет сообщение и ставит editing.
  onEditLast?: () => void
  // Ctrl/Cmd+↑ — ответить на последнее подходящее сообщение окна (tweb).
  onReplyPrev?: () => void
  // Send-as (Telegram send_as): доступные «личности отправителя» (>1 → слева от
  // инпута аватар текущей + попап выбора). onSelect родитель запоминает per-chat.
  sendAs?: { peers: SendAsPeer[]; currentId: number; onSelect: (peerId: number) => void }
}

function Composer({
  reply, editing, forward, rec, onSend, onTyping, onPickSticker, onPickGif, onCancelReply, onCancelEdit,
  onCancelForward, onForwardOption, onForwardAnother, onOpenAttach, onPasteFiles,
  initialDraft, onDraftChange, mentions, onInlineQuery, onPickInline, botMenuButton, onSchedule, canSendWhenOnline, onSendWhenOnline, scheduledCount, onOpenScheduled, slowmodeLeft, secret, canSendMedia = true, chargeStars,
  onEditLast, onReplyPrev, sendAs,
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
  // Плашка форварда активна → показываем «Отправить» (стрелку) даже при пустом
  // инпуте: пустой коммент = просто пересылка (tweb forwarding без текста).
  const forwardActive = !!forward
  const showSend = hasText || forwardActive
  // Меню плашки форварда (tweb reply-line-menu): show/hide sender/caption,
  // переслать в другой чат, не пересылать. Открывается кликом по плашке.
  const [fwdMenuOpen, setFwdMenuOpen] = useState(false)
  const fwdBarRef = useRef<HTMLDivElement>(null)
  const [fwdMenuPos, setFwdMenuPos] = useState<{ left: number; bottom: number } | null>(null)
  const openFwdMenu = () => {
    const r = fwdBarRef.current?.getBoundingClientRect()
    if (r) setFwdMenuPos({ left: r.left, bottom: window.innerHeight - r.top + 6 })
    setFwdMenuOpen(true)
  }
  // Кнопка в режиме микрофона, но медиа в группе запрещены — светло-серая,
  // клик показывает тост вместо записи.
  const micDisabled = !canSendMedia && !showSend && !rec.recording && !slowmodeBlocked
  // Серая (неактивная) кнопка: запрет медиа-микрофона ИЛИ отсчёт slowmode.
  const sendBtnMuted = micDisabled || slowmodeBlocked
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
    setStickerEmoji(null) // пустой инпут — саджесты стикеров гаснут
    // selection is gone after clearing — tell the markup tooltip to hide
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  }

  // Выбранный эффект сообщения (send-меню); сбрасывается после отправки.
  const [selectedEffect, setSelectedEffect] = useState<EmojiEffectKind | null>(null)

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
  // «Отправить, когда онлайн» (tweb Schedule.SendWhenOnline): планирует текущий
  // драфт без даты (бэк ждёт presence собеседника). Тот же разбор, что и submit.
  const submitWhenOnline = () => {
    const root = editorRef.current
    if (!root || !onSendWhenOnline) return
    const raw = serialize(root)
    const { text, entities } = parseMarkdown(raw.text, raw.entities)
    if (!text) return
    onSendWhenOnline(text, entities.length ? entities : undefined)
    clearEditor()
    onDraftChange?.('')
    setScheduleOpen(false)
    setSendMenuOpen(false)
  }

  const submit = (silent = false) => {
    if (slowmodeBlocked) return // медленный режим: отправка заблокирована до конца отсчёта
    const root = editorRef.current
    if (!root) return
    const raw = serialize(root)
    if (!raw.text) {
      // Пустой инпут при активном форварде — просто пересылаем (без комментария).
      // Родитель финализирует форвард в onSend, игнорируя пустой текст.
      if (forwardActive) {
        onSend('', undefined, secret ? secretTtl : undefined, silent, null)
        setSelectedEffect(null)
        clearEditor()
      }
      return
    }
    // Parse markdown markers → entities on send (tweb model: the input stays raw,
    // markers become formatting only when sent). Toolbar-applied entities are passed
    // in and merged/offset-adjusted.
    const { text, entities } = parseMarkdown(raw.text, raw.entities)
    if (!text) return
    // Over the limit is fine — the parent splits into multiple messages
    // (tweb splitStringByLength). The counter shows how many it'll be.
    onSend(text, entities.length ? entities : undefined, secret ? secretTtl : undefined, silent, selectedEffect)
    setSelectedEffect(null) // эффект одноразовый — сбрасываем после отправки
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
    // Стрелка вверх (хелперы уже отработали и вышли выше, если были активны):
    // Ctrl/Cmd+↑ — ответ на предыдущее; чистая ↑ на пустом инпуте — правка своего
    // последнего сообщения (tweb). Модификаторы Shift/Alt не трогаем.
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey) {
      if (e.ctrlKey || e.metaKey) {
        if (onReplyPrev) { e.preventDefault(); onReplyPrev() }
        return
      }
      if (emptyDraft && onEditLast) { e.preventDefault(); onEditLast() }
      return
    }
    // Enter always sends; Shift+Enter adds a line (incl. inside a code block, so
    // multi-line blocks are typed with Shift+Enter — Enter never traps the draft).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      // Ctrl/Cmd+K — ссылка на выделенный текст (tweb createLink). text_link
      // требует URL: спрашиваем через prompt — в композере нет отдельного
      // link-инпута, доступного из keydown (MarkupTooltip держит своё состояние).
      if (e.code === 'KeyK') {
        e.preventDefault()
        const sel = window.getSelection()
        const root = editorRef.current
        if (sel && sel.rangeCount && !sel.isCollapsed && root && root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
          const url = window.prompt(t('Enter URL'))?.trim()
          if (url) applyFmt('text_link', /^https?:\/\//i.test(url) ? url : `https://${url}`)
        }
        return
      }
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
  // Вставка кастом-эмодзи из пикера (tweb onEmojiSelected с docId): атомарный
  // contenteditable=false span с fallback-глифом + data-doc-id. serialize()
  // на отправке превратит его в entity custom_emoji с document_id (media id).
  const insertCustomEmoji = (documentId: number, emoji: string) => {
    const root = editorRef.current
    if (!root) return
    root.focus()
    const span = document.createElement('span')
    span.className = 'md-custom-emoji'
    span.contentEditable = 'false'
    span.dataset.docId = String(documentId)
    span.textContent = emoji
    const frag = document.createDocumentFragment()
    frag.appendChild(span)
    insertFragment(frag)
    syncEmpty()
    autosize()
    onTyping()
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

  // ── Стикеры-саджесты (tweb stickersHelper): в инпуте ровно один эмодзи ──
  const [stickerEmoji, setStickerEmoji] = useState<string | null>(null)
  const checkStickerSuggest = () => {
    if (!onPickSticker) return
    setStickerEmoji(stickerSuggestEmoji(editorRef.current?.textContent ?? ''))
  }
  const pickStickerSuggestion = (st: Sticker) => {
    onPickSticker?.(st)
    setStickerEmoji(null)
    clearEditor()
    onDraftChange?.('')
    const ed = editorRef.current
    if (ed) { ed.focus(); placeCaretEnd(ed) }
  }

  // Автокомплит инпута (эмодзи / inline «@bot query» / @упоминания) — вынесен в
  // хук useComposerAutocomplete; стикер-саджесты остаются выше (завязаны на clearEditor).
  const {
    emojiSug, setEmojiSug, inlineSug, setInlineSug, mentionSug, setMentionSug,
    checkEmojiAutocomplete, checkInlineAutocomplete, checkMentionAutocomplete,
    pickEmojiSuggestion, pickMention, pickInline,
  } = useComposerAutocomplete({
    editorRef, mentions, onInlineQuery, onPickInline,
    syncEmpty, autosize, insertFragment, clearEditor, onDraftChange,
  })

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
        {emojiSug && !mentionSug && !inlineSug && !stickerEmoji && !rec.recording && (
          <EmojiHelper emojis={emojiSug.list} activeIdx={emojiSug.idx} onPick={pickEmojiSuggestion} />
        )}
        {onPickSticker && stickerEmoji && !mentionSug && !inlineSug && !rec.recording && (
          <StickersHelper key={stickerEmoji} emoji={stickerEmoji} onPick={pickStickerSuggestion} />
        )}
      </AnimatePresence>
      {/* Composer container: reply section + input row in ONE box */}
      <div className={s.container}>
        {/* Платные сообщения (Telegram paid messages): плашка о стоимости для не-админа. */}
        {(chargeStars ?? 0) > 0 && (
          <div className={s.paidBar}>
            <Text size={13.5} color="var(--secondary-text-color)">
              {t('Each message costs')} {chargeStars} ⭐
            </Text>
          </div>
        )}
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
              <div className={s.bar}>
                <TgIcon name="reply" size={22} color={reply.color} />
                <div className={s.barBody} style={{ background: `${reply.color}1f`, boxShadow: `inset 3px 0 0 ${reply.color}` }}>
                  <Text size={14} weight={600} color={reply.color}>
                    {t('Reply to')} {reply.snapshotName ?? reply.name}
                  </Text>
                  <Text noWrap size={14} color="var(--secondary-text-color)">
                    {reply.quote ? (
                      <>
                        <TgIcon name="quote_outline" size={13} style={{ verticalAlign: '-1px', marginRight: 3, opacity: 0.7 }} />
                        {reply.quote.text}
                      </>
                    ) : reply.snapshotText ?? reply.text}
                  </Text>
                </div>
                <IconButton size="small" onClick={onCancelReply} color="var(--secondary-text-color)">
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
              <div className={s.bar}>
                <TgIcon name="edit" size={22} color="var(--primary-color)" />
                <div className={s.barBody} style={{ background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)', boxShadow: 'inset 3px 0 0 var(--primary-color)' }}>
                  <Text size={14} weight={600} color="var(--primary-color)">{t('Edit message')}</Text>
                  <Text noWrap size={14} color="var(--secondary-text-color)">{editing.text}</Text>
                </div>
                <IconButton size="small" onClick={() => { onCancelEdit(); clearEditor() }} color="var(--secondary-text-color)">
                  <TgIcon name="close" size={20} />
                </IconButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Плашка форварда (tweb forwarding): иконка + превью (заголовок «Переслать
            сообщение» + «Отправитель: текст») + акцентная полоса; клик по телу
            открывает меню опций. Крестик — отмена (Do Not Forward). */}
        <AnimatePresence initial={false}>
          {forward && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: DUR_OUT, ease: EASE_STD }}
              style={{ overflow: 'hidden' }}
            >
              <div className={s.bar}>
                <TgIcon name="forward" size={22} color="var(--primary-color)" />
                <div
                  ref={fwdBarRef}
                  className={s.barBody}
                  style={{ background: 'color-mix(in srgb, var(--primary-color) 12%, transparent)', boxShadow: 'inset 3px 0 0 var(--primary-color)', cursor: 'pointer' }}
                  onClick={openFwdMenu}
                >
                  <Text noWrap size={14} weight={600} color="var(--primary-color)">
                    {forward.count === 1
                      ? (forward.dropAuthor ? t('Forward Message (sender name hidden)') : t('Forward Message'))
                      : `${t('Forward Messages')} (${forward.count})`}
                  </Text>
                  <Text noWrap size={14} color="var(--secondary-text-color)">{forward.text}</Text>
                </div>
                <IconButton size="small" onClick={onCancelForward} color="var(--secondary-text-color)">
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
                <Text size={16} color="var(--primary-text-color)" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
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
              <IconButton onClick={rec.togglePause} color="var(--primary-color)" style={{ width: 40, height: 40, flexShrink: 0 }}>
                {rec.paused ? <TgIcon name="microphone_filled" /> : <TgIcon name="pause" />}
              </IconButton>
            </>
          ) : (
            <>
              {/* Send-as: аватар текущей «личности отправителя» + попап выбора
                  (tweb new-message-send-as) — только когда личностей больше одной */}
              {sendAs && <SendAsButton {...sendAs} />}
              {/* Кнопка-меню mini-app бота (tweb bot menu button) — пилюля слева */}
              {botMenuButton && (
                <button type="button" className={s.menuBtn} onMouseDown={(e) => e.preventDefault()} onClick={botMenuButton.onClick}>
                  <TgIcon name="bots" size={20} />
                  <span>{botMenuButton.text}</span>
                </button>
              )}
              <IconButton
                onClick={(e) => canSendMedia
                  ? onOpenAttach(e.currentTarget.getBoundingClientRect())
                  : uiEvents.emit('ui:toast', t('Media is not allowed in this group'))}
                color={canSendMedia ? 'var(--secondary-text-color)' : 'var(--secondary-text-color)'}
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
                  color={secretTtl != null ? 'var(--primary-color)' : 'var(--secondary-text-color)'}
                  style={{ width: 40, height: 40, position: 'relative' }}
                >
                  <TgIcon name="timer" />
                  {secretTtl != null && (
                    <span
                      style={{
                        position: 'absolute', bottom: 1, right: 0,
                        fontSize: 9, fontWeight: 700, lineHeight: 1,
                        color: 'var(--primary-color)', pointerEvents: 'none',
                      }}
                    >
                      {ttlShort(secretTtl)}
                    </span>
                  )}
                </IconButton>
              )}
              {/* Календарик при наличии запланированных (tweb btnScheduled) */}
              {(scheduledCount ?? 0) > 0 && onOpenScheduled && (
                <IconButton onClick={onOpenScheduled} color="var(--primary-color)" style={{ width: 40, height: 40 }}>
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
                    color="var(--secondary-text-color)"
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
                  onInput={() => { syncEmpty(); autosize(); onTyping(); checkInlineAutocomplete(); checkMentionAutocomplete(); checkEmojiAutocomplete(); checkStickerSuggest(); onDraftChange?.(editorRef.current?.textContent ?? '') }}
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
                  color={msgCount > 1 ? 'var(--primary-color)' : 'var(--secondary-text-color)'}
                  className={s.counter}
                >
                  {msgCount > 1 ? `${msgCount} 💬` : MAX_LEN - len}
                </Text>
              )}
              <span ref={emojiDd.buttonRef} {...emojiDd.buttonProps} style={{ display: 'inline-flex' }}>
                <IconButton
                  color={emojiDd.open ? 'var(--primary-color)' : 'var(--secondary-text-color)'}
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
              if (showSend) submit()
              else if (rec.recording) rec.stop(true)
              else if (!canSendMedia) uiEvents.emit('ui:toast', t('Media is not allowed in this group'))
              else void rec.start(recordingMediaType)
            }}
            // Не отдавать фокус кнопке: без preventDefault тап/клик блюрит инпут и
            // прячет клавиатуру на touch (tweb шлёт send на mousedown — фокус не теряется).
            // Плюс long-press ~400ms (tweb) открывает меню выбора голос/кружок.
            onMouseDown={(e) => {
              e.preventDefault()
              if (showSend || rec.recording || !canSendMedia) return
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
              if (!showSend && !rec.recording && canSendMedia) openRecMenu(e.currentTarget as HTMLElement)
            }}
            whileTap={{ scale: sendBtnMuted ? 1 : 0.92 }}
            className={sendBtnMuted ? `${s.sendBtn} ${s.sendBtnMuted}` : s.sendBtn}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={slowmodeBlocked ? 'slow' : showSend || rec.recording ? 'send' : 'mic'}
                initial={{ scale: 0.5, opacity: 0.8 }}
                animate={{ scale: [0.5, 1.1, 1], opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
                style={{ display: 'inline-flex' }}
              >
                {slowmodeBlocked
                  ? <span className={s.slowmodeTimer}>{slowmodeText}</span>
                  : showSend || rec.recording ? <TgIcon name="send" /> : <TgIcon name={recordingMediaType === 'round' ? 'recordround' : 'microphone_filled'} />}
              </motion.span>
            </AnimatePresence>
            {/* Выбран эффект сообщения — маленький эмодзи-бейдж на кнопке отправки. */}
            {selectedEffect && hasText && (
              <span className={s.effectBadge} aria-hidden>
                {EFFECT_CHOICES.find((c) => c.kind === selectedEffect)?.emoji}
              </span>
            )}
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
        {/* «Отправить, когда онлайн» (tweb Schedule.SendWhenOnline) — только когда
            собеседник в личке офлайн со видимым статусом (canSendWhenOnline). */}
        {onSendWhenOnline && canSendWhenOnline && (
          <MenuItem
            icon={<TgIcon name="online" size={20} />}
            label={t('Send When Online')}
            onClick={submitWhenOnline}
          />
        )}
        {/* Эффект сообщения (наш аналог Telegram message effects): ряд эмодзи —
            выбор ставит эффект для следующей отправки + короткое превью. */}
        <div className={s.effectRow} role="group" aria-label={t('Message effect')}>
          {EFFECT_CHOICES.map((c) => (
            <button
              key={c.kind}
              type="button"
              className={selectedEffect === c.kind ? s.effectPicked : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const next = selectedEffect === c.kind ? null : c.kind
                setSelectedEffect(next)
                if (next) playEmojiEffect(next)
                setSendMenuOpen(false)
              }}
            >
              {c.emoji}
            </button>
          ))}
        </div>
      </Menu>

      {/* Меню плашки форварда (tweb reply-line-menu): радио show/hide sender + (при
          наличии подписи) show/hide caption, «переслать в другой чат», «не пересылать».
          Галочка слева отмечает активный вариант; выравнивание — прозрачной иконкой. */}
      <Menu
        open={fwdMenuOpen}
        onClose={() => setFwdMenuOpen(false)}
        style={fwdMenuPos ? { left: fwdMenuPos.left, bottom: fwdMenuPos.bottom, transformOrigin: 'bottom left' } : undefined}
      >
        <MenuItem
          icon={<TgIcon name="check" size={20} color={forward && !forward.dropAuthor ? 'var(--primary-color)' : 'transparent'} />}
          label={t('Show sender name')}
          onClick={() => { onForwardOption({ dropAuthor: false }); setFwdMenuOpen(false) }}
        />
        <MenuItem
          icon={<TgIcon name="check" size={20} color={forward && forward.dropAuthor ? 'var(--primary-color)' : 'transparent'} />}
          label={t('Hide sender name')}
          onClick={() => { onForwardOption({ dropAuthor: true }); setFwdMenuOpen(false) }}
        />
        {forward?.hasCaption && (
          <>
            <MenuItem
              icon={<TgIcon name="check" size={20} color={forward && !forward.dropCaption ? 'var(--primary-color)' : 'transparent'} />}
              label={t('Show caption')}
              onClick={() => { onForwardOption({ dropCaption: false }); setFwdMenuOpen(false) }}
            />
            <MenuItem
              icon={<TgIcon name="check" size={20} color={forward && forward.dropCaption ? 'var(--primary-color)' : 'transparent'} />}
              label={t('Hide caption')}
              onClick={() => { onForwardOption({ dropCaption: true }); setFwdMenuOpen(false) }}
            />
          </>
        )}
        <MenuItem
          icon={<TgIcon name="replace" size={20} />}
          label={t('Forward to Another Chat')}
          onClick={() => { setFwdMenuOpen(false); onForwardAnother() }}
        />
        <MenuItem
          icon={<TgIcon name="delete" size={20} />}
          label={t('Do Not Forward')}
          danger
          onClick={() => { setFwdMenuOpen(false); onCancelForward() }}
        />
      </Menu>

      {scheduleOpen && (
        <SchedulePopup
          onPick={submitScheduled}
          onClose={() => setScheduleOpen(false)}
          onWhenOnline={onSendWhenOnline && canSendWhenOnline ? submitWhenOnline : undefined}
        />
      )}

      {/* Floating formatting bar over a text selection (tweb MarkupTooltip) */}
      <MarkupTooltip editorRef={editorRef} onApply={applyFmt} />

      {emojiMounted && (
        <div ref={emojiDd.panelRef} style={{ display: 'contents' }}>
          <Suspense fallback={null}>
            <EmojiDropdown
              open={emojiDd.open}
              onPick={insertEmoji}
              onPickCustomEmoji={insertCustomEmoji}
              onPickSticker={onPickSticker}
              onPickGif={onPickGif}
              onDelete={deleteBeforeCaret}
              onClose={emojiDd.close}
              panelProps={emojiDd.panelProps}
            />
          </Suspense>
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
                right={secretTtl === o.secs ? <TgIcon name="check" size={18} color="var(--primary-color)" /> : undefined}
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
export default memo(Composer)
