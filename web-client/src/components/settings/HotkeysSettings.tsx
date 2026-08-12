// «Горячие клавиши» — порт tweb keyboardShortcuts.tsx (статичная таблица
// секциями, клавиши — чипы .kbd; на маке модификаторы показываются символами
// ⌘/⇧/⌥, как tweb KEY_LABELS). Список — реальные шорткаты этого клиента:
// форматирование = SHORTCUTS/onEditorKeyDown композера, поиск/избранное/чаты =
// core/hotkeys, медиа = mediaViewer/base.ts (onKeyDown: стрелки вне зума,
// Ctrl+±: порт tweb), сториз = useStoryViewer, редактор = MediaEditor.
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
function ShortcutRow({ action, keys, hint }: { action: string; keys: string[]; hint?: string }) {
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
function InfoRow({ action, hint }: { action: string; hint: string }) {
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
    <SettingsScreen title="Keyboard Shortcuts" onBack={onBack} zIndex={50}>
      {/* Форматирование — SHORTCUTS/onEditorKeyDown композера (mod + код клавиши) */}
      <Section caption="Text Formatting">
        <ShortcutRow action="Bold" keys={['ctrl', 'B']} />
        <ShortcutRow action="Italic" keys={['ctrl', 'I']} />
        <ShortcutRow action="Underline" keys={['ctrl', 'U']} />
        <ShortcutRow action="Strikethrough" keys={['ctrl', 'S']} />
        <ShortcutRow action="Monospace" keys={['ctrl', 'M']} />
        <ShortcutRow action="Spoiler" keys={['ctrl', 'P']} />
        <ShortcutRow action="Link" keys={['ctrl', 'K']} />
      </Section>

      {/* Сообщения — Composer.onEditorKeyDown + mod+PageUp/PageDown ленты */}
      <Section caption="Messages">
        <ShortcutRow action="Send Message" keys={['enter']} />
        <ShortcutRow action="New Line" keys={['shift', 'enter']} />
        <ShortcutRow action="Go to Beginning of History" keys={['ctrl', 'pageup']} />
        <ShortcutRow action="Go to End of History" keys={['ctrl', 'pagedown']} />
      </Section>

      {/* Чат — Composer (↑/mod+↑) + core/hotkeys (Alt+↑/↓) */}
      <Section caption="Chat">
        <ShortcutRow action="Edit Last Message" keys={['up']} hint="when the input is empty" />
        <ShortcutRow action="Reply to Previous Message" keys={['ctrl', 'up']} />
        <ShortcutRow action="Next Chat" keys={['alt', 'down']} />
        <ShortcutRow action="Previous Chat" keys={['alt', 'up']} />
      </Section>

      {/* Навигация — core/hotkeys.ts */}
      <Section caption="Navigation">
        <ShortcutRow action="Search" keys={['ctrl', 'F']} />
        <ShortcutRow action="Saved Messages" keys={['ctrl', '0']} />
        <ShortcutRow action="Close Window or Menu" keys={['esc']} />
      </Section>

      {/* Просмотр медиа — mediaViewer/base.ts onKeyDown (порт tweb: стрелки
          листают вне зума, зум — Ctrl+= / Ctrl+-; строки и подписи 1:1 с
          tweb keyboardShortcuts.tsx:195-214) */}
      <Section caption="Media Viewer">
        <ShortcutRow action="Next Media" keys={['right']} />
        <ShortcutRow action="Previous Media" keys={['left']} />
        <ShortcutRow action="Zoom In" keys={['ctrl', 'plus']} />
        <ShortcutRow action="Zoom Out" keys={['ctrl', 'minus']} />
      </Section>

      {/* Истории — useStoryViewer.ts */}
      <Section caption="Stories">
        <ShortcutRow action="Next Story" keys={['right']} />
        <ShortcutRow action="Previous Story" keys={['left']} />
        <ShortcutRow action="Play/Pause" keys={['space']} />
        <ShortcutRow action="Exit" keys={['down']} />
      </Section>

      {/* Фоторедактор — MediaEditor.tsx */}
      <Section caption="Photo Editor">
        <ShortcutRow action="Undo" keys={['ctrl', 'Z']} />
        <ShortcutRow action="Redo" keys={['ctrl', 'shift', 'Z']} />
      </Section>

      {/* Прочее — информационная строка (саму блокировку не реализуем здесь) */}
      <Section caption="Other">
        <InfoRow action="Lock the App" hint="Passcode is configured in Privacy settings" />
      </Section>
    </SettingsScreen>
  )
}
