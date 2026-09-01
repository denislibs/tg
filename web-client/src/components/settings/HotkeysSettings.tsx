// «Горячие клавиши» — порт tweb keyboardShortcuts.tsx (статичная таблица
// секциями, клавиши — чипы .kbd; на маке модификаторы показываются символами
// ⌘/⇧/⌥, как tweb KEY_LABELS). Список — реальные шорткаты этого клиента:
// форматирование = SHORTCUTS/onEditorKeyDown композера, поиск/избранное/чаты =
// core/hotkeys, медиа = mediaViewer/base.ts (onKeyDown: стрелки вне зума,
// Ctrl+±: порт tweb), сториз = useStoryViewer, редактор = MediaEditor.
import type { LangPackKey } from '@/lang'
import Text from '../../shared/ui/Text'
import { SettingsScreen, Section } from './kit'
import { useT } from '../../i18n'
import s from './HotkeysSettings.module.scss'

// tweb environment/userAgent IS_APPLE
const IS_APPLE = navigator.userAgent.search(/OS X|iPhone|iPad|iOS/i) !== -1

// tweb KEY_LABELS (нужное нам подмножество) + стрелки/пробел/страницы/Alt.
const KEY_LABELS: Record<string, { mac: string; pc: string }> = {
  ctrl: { mac: '⌘', pc: 'Ctrl' },
  shift: { mac: '⇧', pc: 'Shift' },
  alt: { mac: '⌥', pc: 'Alt' },
  enter: { mac: '↵', pc: 'Enter' },
  esc: { mac: 'Esc', pc: 'Esc' },
  space: { mac: 'Space', pc: 'Space' },
  up: { mac: '↑', pc: '↑' },
  down: { mac: '↓', pc: '↓' },
  left: { mac: '←', pc: '←' },
  right: { mac: '→', pc: '→' },
  pageup: { mac: 'PgUp', pc: 'PgUp' },
  pagedown: { mac: 'PgDn', pc: 'PgDn' },
  // tweb keyboardShortcuts.tsx:24-25 — зум вьювера
  plus: { mac: '+', pc: '+' },
  minus: { mac: '−', pc: '−' },
}

function labelFor(key: string): string {
  const lookup = KEY_LABELS[key.toLowerCase()]
  if (lookup) return IS_APPLE ? lookup.mac : lookup.pc
  return key.length === 1 ? key.toUpperCase() : key
}

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className={s.keys}>
      {keys.map((key, i) => (
        <span key={i} className={s.keys}>
          {i > 0 && <span className={s.plus}>+</span>}
          <span className={s.kbd}>{labelFor(key)}</span>
        </span>
      ))}
    </span>
  )
}

// Строка: действие (+ опциональная подсказка мелким шрифтом, как hint tweb) и комбо.
function ShortcutRow({ action, keys, hint }: { action: LangPackKey; keys: string[]; hint?: LangPackKey }) {
  const t = useT()
  return (
    <div className={s.row}>
      <div className={s.label}>
        <Text noWrap size={16} color="var(--primary-text-color)">
          {t(action)}
        </Text>
        {hint && (
          <Text noWrap size={12} color="var(--secondary-text-color)">
            {t(hint)}
          </Text>
        )}
      </div>
      <KeyCombo keys={keys} />
    </div>
  )
}

// Информационная строка без комбо (блокировка приложения — код-пароль).
function InfoRow({ action, hint }: { action: LangPackKey; hint: LangPackKey }) {
  const t = useT()
  return (
    <div className={s.row}>
      <div className={s.label}>
        <Text noWrap size={16} color="var(--primary-text-color)">
          {t(action)}
        </Text>
        <Text noWrap size={12} color="var(--secondary-text-color)">
          {t(hint)}
        </Text>
      </div>
    </div>
  )
}

export default function HotkeysSettings({ onBack }: { onBack: () => void }) {
  return (
    <SettingsScreen title='KeyboardShortcuts.Title' onBack={onBack} zIndex={50}>
      {/* Форматирование — SHORTCUTS/onEditorKeyDown композера (mod + код клавиши) */}
      <Section caption='KeyboardShortcuts.Section.Formatting'>
        <ShortcutRow action='KeyboardShortcuts.Action.Bold' keys={['ctrl', 'B']} />
        <ShortcutRow action='KeyboardShortcuts.Action.Italic' keys={['ctrl', 'I']} />
        <ShortcutRow action='KeyboardShortcuts.Action.Underline' keys={['ctrl', 'U']} />
        <ShortcutRow action='KeyboardShortcuts.Action.Strikethrough' keys={['ctrl', 'S']} />
        <ShortcutRow action='KeyboardShortcuts.Action.Monospace' keys={['ctrl', 'M']} />
        <ShortcutRow action='KeyboardShortcuts.Action.Spoiler' keys={['ctrl', 'P']} />
        <ShortcutRow action='KeyboardShortcuts.Action.Link' keys={['ctrl', 'K']} />
      </Section>

      {/* Сообщения — Composer.onEditorKeyDown + mod+PageUp/PageDown ленты */}
      <Section caption='KeyboardShortcuts.Section.Messages'>
        <ShortcutRow action='SendMessage' keys={['enter']} />
        <ShortcutRow action='KeyboardShortcuts.Action.NewLine' keys={['shift', 'enter']} />
        <ShortcutRow action='KeyboardShortcuts.Action.HistoryStart' keys={['ctrl', 'pageup']} />
        <ShortcutRow action='KeyboardShortcuts.Action.HistoryEnd' keys={['ctrl', 'pagedown']} />
      </Section>

      {/* Чат — Composer (↑/mod+↑) + core/hotkeys (Alt+↑/↓) */}
      <Section caption='KeyboardShortcuts.Section.Chat'>
        <ShortcutRow action='KeyboardShortcuts.Action.EditLast' keys={['up']} hint='KeyboardShortcuts.Hint.WhenInputEmpty' />
        <ShortcutRow action='KeyboardShortcuts.Action.ReplyToPrevious' keys={['ctrl', 'up']} />
        <ShortcutRow action='KeyboardShortcuts.Action.NextChat' keys={['alt', 'down']} />
        <ShortcutRow action='KeyboardShortcuts.Action.PreviousChat' keys={['alt', 'up']} />
      </Section>

      {/* Навигация — core/hotkeys.ts */}
      <Section caption='KeyboardShortcuts.Section.Navigation'>
        <ShortcutRow action="Search" keys={['ctrl', 'F']} />
        <ShortcutRow action='SavedMessages' keys={['ctrl', '0']} />
        <ShortcutRow action='KeyboardShortcuts.Action.ClosePopup' keys={['esc']} />
      </Section>

      {/* Просмотр медиа — mediaViewer/base.ts onKeyDown (порт tweb: стрелки
          листают вне зума, зум — Ctrl+= / Ctrl+-; строки и подписи 1:1 с
          tweb keyboardShortcuts.tsx:195-214) */}
      <Section caption='KeyboardShortcuts.Section.MediaViewer'>
        <ShortcutRow action='KeyboardShortcuts.Action.NextMedia' keys={['right']} />
        <ShortcutRow action='KeyboardShortcuts.Action.PreviousMedia' keys={['left']} />
        <ShortcutRow action='MediaZoomIn' keys={['ctrl', 'plus']} />
        <ShortcutRow action='MediaZoomOut' keys={['ctrl', 'minus']} />
      </Section>

      {/* Истории — useStoryViewer.ts */}
      <Section caption='KeyboardShortcuts.Section.Stories'>
        <ShortcutRow action='KeyboardShortcuts.Action.NextStory' keys={['right']} />
        <ShortcutRow action='KeyboardShortcuts.Action.PreviousStory' keys={['left']} />
        <ShortcutRow action='KeyboardShortcuts.Action.PlayPause' keys={['space']} />
        <ShortcutRow action='KeyboardShortcuts.Action.Exit' keys={['down']} />
      </Section>

      {/* Фоторедактор — MediaEditor.tsx */}
      <Section caption='KeyboardShortcuts.Section.PhotoEditor'>
        <ShortcutRow action='Undo' keys={['ctrl', 'Z']} />
        <ShortcutRow action='KeyboardShortcuts.Action.Redo' keys={['ctrl', 'shift', 'Z']} />
      </Section>

      {/* Прочее — информационная строка (саму блокировку не реализуем здесь) */}
      <Section caption="Other">
        <InfoRow action='KeyboardShortcuts.Action.LockApp' hint='KeyboardShortcuts.Hint.PasscodeNotSet' />
      </Section>
    </SettingsScreen>
  )
}
