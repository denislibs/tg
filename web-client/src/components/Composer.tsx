// src/components/Composer.tsx
// Композер — дерево и классы tweb `components/chat/input.ts` (вариант А программы
// parity: классы глобальные, CSS-модуля у поверхности нет):
//
//   div.rows-wrapper-wrapper                                   input.ts:471-473
//     div.rows-wrapper.chat-input-wrapper.chat-input-main-wrapper.chat-rows-wrapper
//       <шесть .autocomplete-helper> + div.reply-wrapper       input.ts:1286-1296
//       div.new-message-wrapper.rows-wrapper-row               input.ts:1012-1013
//         attach · input-message-container · вторичные кнопки ·
//         div.voice-recording-panel (ОВЕРЛЕЙ) · div.btn-send-container
//
// Внешние `.chat-input.chat-input-main` и `.chat-input-container` рендерит Chat.tsx —
// композер начинается с `.rows-wrapper-wrapper` и вешает классы состояний
// (`is-recording`, `is-locked`, `is-helper-active`) на найденных по DOM предков,
// ровно как tweb делает это через ссылку на объект чата.
//
// Инпут — contenteditable (не textarea): в нём живёт инлайновое форматирование
// (bold/italic/spoiler/code/quote/link), 1:1 с tweb. На отправке DOM
// сериализуется в текст + MessageEntity[] (core/richtext/markdown).
import { lazy, memo, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import { useDropdownHover } from './emoji/useDropdownHover'
import { stickerSuggestEmoji } from './StickersHelper'
import type { Sticker } from '../core/managers/stickersManager'
import type { GifItem } from '../core/gifs'
import type { InlineResult } from '../core/managers/botsManager'
import type { Peer } from '../core/managers/peersManager'
import type { SendAsPeer } from '../core/managers/chatsManager'
import MarkupTooltip from './MarkupTooltip'
import { serialize, apply as applyMarkup, entitiesToFragment, parseMarkdown } from '../core/richtext/markdown'
import SendAsButton from './composer/SendAsButton'
import RoundRecordPreview from './composer/RoundRecordPreview'
import ReplyWrapper from './composer/ReplyWrapper'
import MessageInput from './composer/MessageInput'
import SendButton, { type SendBtnIcon } from './composer/SendButton'
import SendMenu from './composer/SendMenu'
import VoiceRecordingPanel from './composer/VoiceRecordingPanel'
import AutocompleteHelpers, { BotCommandsHelper } from './composer/AutocompleteHelpers'
import ComposerMenus from './composer/ComposerMenus'
import { useHostClasses } from './composer/useHostClasses'
import { useInputHeight } from './composer/useInputHeight'
import { MAX_LEN, EFFECT_CHOICES, ttlShort, placeCaretEnd } from './composer/helpers'
import { useComposerAutocomplete } from './composer/useComposerAutocomplete'
import { useComposerClipboard } from './composer/useComposerClipboard'
import { useComposerHotkeys } from './composer/useComposerHotkeys'
import { useSetTransition } from '../core/hooks/useSetTransition'
import { playEmojiEffect, type EmojiEffectKind } from '../core/effects/emojiEffects'
import type { EntityType, MessageEntity } from '../core/models'
import { type VoiceRecorder } from '../core/hooks/useVoiceRecorder'
import { useT } from '../i18n'
import { uiEvents } from '../core/hooks/uiEvents'
import { useSettingsStore } from '../settings'
import SchedulePopup from './SchedulePopup'
import { createPortal } from 'react-dom'
import { DiscardVoiceDialog } from './messages/ChatDialogs.tsx'
import s from './composer/extras.module.scss'

// Пикер эмодзи/стикеров/гифок — тяжёлый (сетки, StickersTab/GifsTab), но нужен
// только по открытию. Грузим лениво отдельным чанком — вон из главного бандла.
const EmojiDropdown = lazy(() => import('./emoji/EmojiDropdown'))

// chatRecording.ts:893 — long-press по кнопке отправки открывает выбор голос/кружок.
const LONG_PRESS_MS = 400

export interface ReplyState { msgId?: number; name: string; text: string; color: string; /** id автора оригинала — в `data-peer-id` на `span.peer-title` (tweb wrapPeerTitle) */ peerId?: number; quote?: { text: string; offset: number }; chatId?: number; snapshotName?: string; snapshotText?: string }
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
  // Групповые дефолт-права: если false — медиа запрещены (attach серый, рекордера
  // нет — кнопка отправки не уходит в микрофон). По умолчанию true.
  canSendMedia?: boolean
  // Платные сообщения (Telegram paid messages): плата за сообщение в звёздах для
  // не-админа (0/undefined — бесплатно). >0 показывает бейдж на кнопке отправки.
  chargeStars?: number
  // ↑ при пустом инпуте (без активных хелперов) — редактировать своё последнее
  // сообщение (tweb ↑ = editLastMessage). Родитель ищет сообщение и ставит editing.
  onEditLast?: () => void
  // Ctrl/Cmd+↑ — ответить на последнее подходящее сообщение окна (tweb).
  onReplyPrev?: () => void
  // Send-as (Telegram send_as): доступные «личности отправителя» (>1 → слева от
  // инпута аватар текущей + попап выбора). onSelect родитель запоминает per-chat.
  sendAs?: { peers: SendAsPeer[]; currentId: number; onSelect: (peerId: number) => void }
  // data-peer-id инпута (input.ts) — маркер «инпут этого пира».
  peerId?: number
}

function Composer({
  reply, editing, forward, rec, onSend, onTyping, onPickSticker, onPickGif, onCancelReply, onCancelEdit,
  onCancelForward, onForwardOption, onForwardAnother, onOpenAttach, onPasteFiles,
  initialDraft, onDraftChange, mentions, onInlineQuery, onPickInline, botMenuButton, onSchedule, canSendWhenOnline, onSendWhenOnline, scheduledCount, onOpenScheduled, slowmodeLeft, secret, canSendMedia = true, chargeStars,
  onEditLast, onReplyPrev, sendAs, peerId,
}: Props) {
  const t = useT()
  const slowmodeBlocked = (slowmodeLeft ?? 0) > 0
  const slowmodeText = (slowmodeLeft ?? 0) >= 60 ? `${Math.ceil((slowmodeLeft ?? 0) / 60)}м` : String(slowmodeLeft ?? 0)
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
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const fakeRef = useRef<HTMLDivElement>(null)
  const newMessageWrapperRef = useRef<HTMLDivElement>(null)
  const botCommandsTextRef = useRef<HTMLSpanElement>(null)
  const forwardActive = !!forward
  // Меню плашки форварда (tweb reply-line-menu): show/hide sender/caption,
  // переслать в другой чат, не пересылать. Открывается кликом по плашке.
  const [fwdMenuOpen, setFwdMenuOpen] = useState(false)
  const fwdBarRef = useRef<HTMLDivElement>(null)
  const [fwdMenuPos, setFwdMenuPos] = useState<{ left: number; bottom: number } | null>(null)
  const openFwdMenu = () => {
    if (!forward) return
    const r = fwdBarRef.current?.getBoundingClientRect()
    if (r) setFwdMenuPos({ left: r.left, bottom: window.innerHeight - r.top + 6 })
    setFwdMenuOpen(true)
  }
  // Тип записи (голос/кружок) — персист в settings; long-press по кнопке
  // открывает меню переключения (tweb chatRecording.setupRecordingModeMenu).
  const recordingMediaType = useSettingsStore((st) => st.recordingMediaType)
  const updateSettings = useSettingsStore((st) => st.update)
  const [recMenu, setRecMenu] = useState<{ right: number; bottom: number } | null>(null)
  // Секретный TTL самоуничтожения (сек; null — выкл) + якорь его меню.
  const [secretTtl, setSecretTtl] = useState<number | null>(null)
  const [ttlMenu, setTtlMenu] = useState<{ left: number; bottom: number } | null>(null)
  const longPressTimer = useRef<number | undefined>(undefined)
  const longPressed = useRef(false)
  // Estimated message count once over the limit (the exact split happens on send).
  const msgCount = len > MAX_LEN ? Math.ceil(len / MAX_LEN) : 0

  const autosize = useInputHeight(editorRef, fakeRef)

  const syncEmpty = () => {
    const txt = editorRef.current?.textContent ?? ''
    setEmptyDraft(!txt.trim())
    // UTF-16 length (O(1)); for over-limit drafts (mostly ASCII code) it matches the
    // backend's rune cap closely. Avoid spreading the whole string — on a huge paste
    // [...txt] allocates a multi-thousand-element array on every input.
    setLen(txt.length)
  }

  // ── Классы состояний на предках (tweb ставит их не на свой узел) ──
  // `.chat-input`: is-recording через SetTransition 200 мс (chatRecording.ts:792 →
  // input.ts:3630-3638) + is-locked (chatRecording.ts:946).
  const recordingCls = useSetTransition(rec.recording, 'is-recording', 200)
  useHostClasses(rootRef, '.chat-input', classNames(recordingCls, rec.recording ? 'is-locked' : ''))
  // `.chat`: is-helper-active раскрывает reply-плашку 0 → 3rem (input.ts:4886-4890).
  const helperActive = !!(reply || editing || forward)
  useHostClasses(rootRef, '.chat', helperActive ? 'is-helper-active' : '')

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

  // input.ts:2718-2724 — ширину кнопки меню бота tweb МЕРЯЕТ и кладёт в
  // `--commands-size` на строке: от неё считается сдвиг инпута (`has-offset`).
  useLayoutEffect(() => {
    const wrapper = newMessageWrapperRef.current
    if (!wrapper) return
    if (!botMenuButton) { wrapper.style.removeProperty('--commands-size'); return }
    const text = botCommandsTextRef.current
    if (text) wrapper.style.setProperty('--commands-size', `${Math.ceil(text.scrollWidth) + 22}px`)
  }, [botMenuButton])

  const clearEditor = () => {
    if (editorRef.current) editorRef.current.replaceChildren()
    setEmptyDraft(true)
    setLen(0)
    setStickerEmoji(null) // пустой инпут — саджесты стикеров гаснут
    autosize() // высота возвращается к одной строке (37px)
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

  const { insertFragment, onPaste, onDrop } = useComposerClipboard({
    editorRef, onPasteFiles, syncEmpty, autosize, onTyping,
  })

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

  const onEditorKeyDown = useComposerHotkeys({
    editorRef, emptyDraft,
    inlineSug, setInlineSug, pickInline,
    mentionSug, setMentionSug, pickMention,
    emojiSug, setEmojiSug, pickEmojiSuggestion,
    onReplyPrev, onEditLast, submit, applyFmt, urlPromptLabel: t('Enter URL'),
  })

  // ── Кнопка отправки: состояние по updateSendBtn() (input.ts:3983-3995) ──
  // Ветки Stories и ChatType.Scheduled у нас отсутствуют; `hasVoiceRecorder` —
  // это наш `canSendMedia` (запрет медиа в группе = рекордера нет).
  const hasVoiceRecorder = canSendMedia
  const sendIcon: SendBtnIcon = editing
    ? 'edit'
    : (!hasVoiceRecorder || rec.recording || !emptyDraft || forwardActive)
      ? 'send'
      : recordingMediaType === 'round' ? 'record-video' : 'record'
  const canSwitchRecordingMode = hasVoiceRecorder && emptyDraft && !rec.recording && !forwardActive && !editing

  // input.ts:3728-3754 — обычный клик по пустому инпуту СТАРТУЕТ запись
  // (удержание тут ни при чём: long-press открывает выбор голос/кружок).
  const onSendClick = () => {
    if (longPressed.current) { longPressed.current = false; return } // consumeLongPressSuppression
    if (sendIcon !== 'record' && sendIcon !== 'record-video') {
      if (rec.recording) rec.stop(true)
      else submit()
    } else {
      void rec.start(recordingMediaType)
    }
  }
  const openRecMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setRecMenu({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 8 })
  }

  // Сдвиг строки под send-as / кнопку меню бота: `has-offset` + data-offset,
  // SetTransition duration 300 (input.ts:2628-2644).
  const offset = sendAs ? 'as' : botMenuButton ? 'commands' : undefined
  const offsetCls = useSetTransition(!!offset, 'has-offset', 300)

  const effectEmoji = selectedEffect ? EFFECT_CHOICES.find((c) => c.kind === selectedEffect)?.emoji ?? null : null

  return (
    <>
      <div ref={rootRef} className="rows-wrapper-wrapper">
        <div className="rows-wrapper chat-input-wrapper chat-input-main-wrapper chat-rows-wrapper">
          <BotCommandsHelper />
          <ReplyWrapper
            reply={reply}
            editing={editing}
            forward={forward}
            onCancelReply={onCancelReply}
            onCancelEdit={() => { onCancelEdit(); clearEditor() }}
            onCancelForward={onCancelForward}
            onOpenForwardMenu={openFwdMenu}
            bodyRef={fwdBarRef}
          />
          <AutocompleteHelpers
            stickerEmoji={stickerEmoji}
            onPickSticker={onPickSticker}
            onPickStickerSuggestion={pickStickerSuggestion}
            emojiSug={emojiSug}
            onPickEmoji={pickEmojiSuggestion}
            mentionSug={mentionSug}
            onPickMention={pickMention}
            inlineSug={inlineSug}
            onPickInline={pickInline}
          />

          <div
            ref={newMessageWrapperRef}
            className={classNames('new-message-wrapper', 'rows-wrapper-row', offsetCls)}
            data-offset={offset}
          >
            {/* Send-as и кнопка меню бота в tweb PREPEND-ятся в строку и лежат
                абсолютом (_chat.scss:865-874) — порядок остальных детей не меняют. */}
            {sendAs && <SendAsButton {...sendAs} />}
            {botMenuButton && (
              <div
                className="new-message-bot-commands"
                onMouseDown={(e) => e.preventDefault()}
                onClick={botMenuButton.onClick}
              >
                <span ref={botCommandsTextRef} className="new-message-bot-commands-view">{botMenuButton.text}</span>
              </div>
            )}

            {/* отступление от tweb: <button> вместо кастомного элемента
                <attach-menu-button> (defineSolidElement) — селекторы
                `.attach-file[.menu-open][.btn-disabled]` от тега не зависят. */}
            <IconButton
              className={classNames('btn-menu-toggle', 'attach-file', canSendMedia ? '' : 'btn-disabled')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => canSendMedia
                ? onOpenAttach(e.currentTarget.getBoundingClientRect())
                : uiEvents.emit('ui:toast', t('Media is not allowed in this group'))}
            >
              <TgIcon name="attach" className="button-icon" size="inherit" />
            </IconButton>

            <MessageInput
              inputRef={editorRef}
              fakeRef={fakeRef}
              empty={emptyDraft}
              placeholder={t('Message')}
              peerId={peerId}
              onInput={() => {
                syncEmpty(); autosize(); onTyping()
                checkInlineAutocomplete(); checkMentionAutocomplete(); checkEmojiAutocomplete(); checkStickerSuggest()
                onDraftChange?.(editorRef.current?.textContent ?? '')
              }}
              onKeyDown={onEditorKeyDown}
              onPaste={onPaste}
              onDrop={onDrop}
            />

            {/* Near the limit: remaining chars. Over it: how many messages the draft
                will split into on send. Узла-аналога в tweb нет — отступление. */}
            {(len > MAX_LEN - 256 || msgCount > 1) && (
              <span
                className={s.counter}
                data-split={msgCount > 1 || undefined}
                title={msgCount > 1 ? `Будет отправлено сообщений: ${msgCount}` : undefined}
              >
                {msgCount > 1 ? `${msgCount} 💬` : MAX_LEN - len}
              </span>
            )}

            {/* Календарик при наличии запланированных (tweb btnScheduled, input.ts:890).
                `.float` + `.show` показывают кнопку только при пустом инпуте. */}
            <IconButton
              noRipple
              className={classNames('btn-scheduled', 'float', (scheduledCount ?? 0) > 0 ? '' : 'hide', emptyDraft ? 'show' : '')}
              onClick={onOpenScheduled}
            >
              <TgIcon name="scheduled" className="button-icon" size="inherit" />
            </IconButton>
            {/* Тумблер клавиатуры бота (input.ts:912-923). У нас reply-клавиатура
                живёт в Chat.tsx, поэтому кнопка структурная и всегда скрыта. */}
            <IconButton noRipple className={classNames('toggle-reply-markup', 'float', 'hide', emptyDraft ? 'show' : '')}>
              <TgIcon name="keyboard" className="button-icon" size="inherit" />
            </IconButton>
            {/* «Предложить пост» (input.ts:1258) — фичи нет, узел структурный. */}
            <IconButton className="hide">
              <TgIcon name="suggested" className="button-icon" size="inherit" />
            </IconButton>
            {/* Таймер самоуничтожения секретного чата — место tweb-кнопки
                btnAutoDeletePeriod (input.ts:1263). */}
            <IconButton
              className={secret ? '' : 'hide'}
              style={secretTtl != null ? { color: 'var(--primary-color)' } : undefined}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setTtlMenu({ left: r.left, bottom: window.innerHeight - r.top + 8 })
              }}
            >
              <TgIcon name="auto_delete_circle_clock" className="button-icon" size="inherit" />
              {/* отступление от tweb: у btnAutoDeletePeriod подписи нет — у нас
                  выбранный TTL иначе никак не виден. */}
              {secretTtl != null && <span className={s.ttlLabel}>{ttlShort(secretTtl)}</span>}
            </IconButton>
            {/* Кнопка подарка (input.ts:1023) — фичи нет, узел структурный. */}
            <IconButton noRipple className={classNames('toggle-send-gift', 'float', 'hide', emptyDraft ? 'show' : '')}>
              <TgIcon name="gift" className="button-icon" size="inherit" />
            </IconButton>

            <IconButton
              noRipple
              ref={emojiDd.buttonRef as React.RefObject<HTMLButtonElement>}
              className={classNames('toggle-emoticons', emojiDd.open ? 'active' : '')}
              {...emojiDd.buttonProps}
            >
              <TgIcon name="smile" className="button-icon" size="inherit" />
            </IconButton>

            {/* Скрытый файловый пикер строки ввода (input.ts:1268-1271). */}
            <input
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.currentTarget.value = ''
                if (files.length) onPasteFiles?.(files)
              }}
            />

            {/* Панель записи — ОВЕРЛЕЙ поверх строки, а не ветка рендера:
                инпут, кнопки и каретка остаются на месте (chatRecording.ts:112). */}
            <VoiceRecordingPanel rec={rec} onCancel={() => rec.stop(false)} />

            <SendButton
              icon={sendIcon}
              disabled={slowmodeBlocked}
              stars={chargeStars}
              effectEmoji={emptyDraft ? null : effectEmoji}
              slowmodeText={slowmodeBlocked ? slowmodeText : null}
              onClick={onSendClick}
              // Не отдавать фокус кнопке: без preventDefault тап/клик блюрит инпут
              // и прячет клавиатуру на touch (tweb шлёт send на mousedown).
              onMouseDown={(e) => {
                e.preventDefault()
                if (e.button !== 0 || !canSwitchRecordingMode) return
                window.clearTimeout(longPressTimer.current)
                // отступление от tweb: оригинал открывает меню прямо в таймауте
                // (chatRecording.ts:889-893); у нас бэкдроп <Menu> поймал бы
                // следующий click и закрыл меню мгновенно — открываем на mouseup,
                // таймер лишь помечает long-press.
                longPressTimer.current = window.setTimeout(() => { longPressed.current = true }, LONG_PRESS_MS)
              }}
              onMouseUp={(e) => {
                window.clearTimeout(longPressTimer.current)
                if (longPressed.current) openRecMenu(e.currentTarget)
              }}
              onMouseLeave={() => { window.clearTimeout(longPressTimer.current); longPressed.current = false }}
              onContextMenu={(e) => {
                e.preventDefault()
                // input.ts:1345-1352 — контекст-меню отправки только когда есть что
                // отправлять и это не правка.
                if (!emptyDraft || forwardActive || rec.recording) { if (!editing) setSendMenuOpen(true); return }
                if (canSwitchRecordingMode) openRecMenu(e.currentTarget)
              }}
              menu={(
                <SendMenu
                  open={sendMenuOpen}
                  onSilent={() => { setSendMenuOpen(false); submit(true) }}
                  onSchedule={onSchedule ? () => { setSendMenuOpen(false); setScheduleOpen(true) } : undefined}
                  onWhenOnline={onSendWhenOnline && canSendWhenOnline ? submitWhenOnline : undefined}
                  onRemoveEffect={selectedEffect ? () => { setSelectedEffect(null); setSendMenuOpen(false) } : undefined}
                  effects={(
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
                  )}
                />
              )}
            />
          </div>
        </div>
      </div>

      {/* Бэкдроп меню отправки: tweb гасит его `.btn-menu-overlay` внутри
          `.btn-send-container` (_chat.scss:122-124). */}
      {sendMenuOpen && (
        <div
          className="btn-menu-overlay"
          style={{ position: 'fixed', inset: 0, zIndex: 3 }}
          onClick={() => setSendMenuOpen(false)}
          onContextMenu={(e) => { e.preventDefault(); setSendMenuOpen(false) }}
        />
      )}

      <ComposerMenus
        forward={forward}
        forwardMenuOpen={fwdMenuOpen}
        forwardMenuAnchor={fwdMenuPos}
        onCloseForwardMenu={() => setFwdMenuOpen(false)}
        onForwardOption={onForwardOption}
        onForwardAnother={onForwardAnother}
        onCancelForward={onCancelForward}
        ttlAnchor={ttlMenu}
        ttlSeconds={secretTtl}
        onPickTtl={(secs) => { setSecretTtl(secs); setTtlMenu(null) }}
        onCloseTtl={() => setTtlMenu(null)}
        recordAnchor={recMenu}
        onPickRecordingMode={(mode) => { updateSettings({ recordingMediaType: mode }); setRecMenu(null) }}
        onCloseRecord={() => setRecMenu(null)}
      />

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
        // отступление от tweb: обёртка `display: contents` нужна только чтобы
        // отдать ref панели ленивому чанку — в раскладке её нет.
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

      {/* Сцена записи кружка — в <body>, как tweb (chatRecording.ts:123) */}
      {rec.recording && rec.mode === 'round' && rec.previewStream && createPortal(
        <RoundRecordPreview stream={rec.previewStream} secs={rec.secs} paused={rec.paused} />,
        document.body,
      )}

      {/* Discard-recording confirm (Esc) */}
      {cancelRecOpen && (
        <DiscardVoiceDialog
          onCancel={() => setCancelRecOpen(false)}
          onDiscard={() => { setCancelRecOpen(false); rec.stop(false) }}
        />
      )}
    </>
  )
}
export default memo(Composer)
