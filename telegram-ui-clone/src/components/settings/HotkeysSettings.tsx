// «Горячие клавиши» — порт tweb keyboardShortcuts.tsx (статичная таблица
// секциями, клавиши — чипы .kbd; на маке модификаторы показываются символами
// ⌘/⇧, как tweb KEY_LABELS). Список — реальные шорткаты этого клиента:
// форматирование = SHORTCUTS композера, Ctrl+K/Esc/Ctrl+Shift+M = core/hotkeys.
import Text from '../../shared/ui/Text'
import { SettingsScreen, Section } from './kit'
import { useT } from '../../i18n'
import s from './HotkeysSettings.module.scss'

// tweb environment/userAgent IS_APPLE
const IS_APPLE = navigator.userAgent.search(/OS X|iPhone|iPad|iOS/i) !== -1

// tweb KEY_LABELS (нужное нам подмножество)
const KEY_LABELS: Record<string, { mac: string; pc: string }> = {
  ctrl: { mac: '⌘', pc: 'Ctrl' },
  shift: { mac: '⇧', pc: 'Shift' },
  enter: { mac: '↵', pc: 'Enter' },
  esc: { mac: 'Esc', pc: 'Esc' },
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

function ShortcutRow({ action, keys }: { action: string; keys: string[] }) {
  const t = useT()
  return (
    <div className={s.row}>
      <Text noWrap size={16} color="var(--tg-textPrimary)" className={s.label}>
        {t(action)}
      </Text>
      <KeyCombo keys={keys} />
    </div>
  )
}

export default function HotkeysSettings({ onBack }: { onBack: () => void }) {
  return (
    <SettingsScreen title="Keyboard Shortcuts" onBack={onBack} zIndex={50}>
      {/* Чаты: поиск, закрытие, mute — core/hotkeys.ts */}
      <Section caption="Chats">
        <ShortcutRow action="Search" keys={['ctrl', 'K']} />
        <ShortcutRow action="Close Chat" keys={['esc']} />
        <ShortcutRow action="Mute Chat" keys={['ctrl', 'shift', 'M']} />
      </Section>

      {/* Сообщения: Enter/Shift+Enter — Composer.onEditorKeyDown */}
      <Section caption="Messages">
        <ShortcutRow action="Send Message" keys={['enter']} />
        <ShortcutRow action="New Line" keys={['shift', 'enter']} />
      </Section>

      {/* Форматирование — SHORTCUTS из Composer.tsx (Ctrl/Cmd + код клавиши) */}
      <Section caption="Formatting">
        <ShortcutRow action="Bold" keys={['ctrl', 'B']} />
        <ShortcutRow action="Italic" keys={['ctrl', 'I']} />
        <ShortcutRow action="Underline" keys={['ctrl', 'U']} />
        <ShortcutRow action="Strikethrough" keys={['ctrl', 'S']} />
        <ShortcutRow action="Monospace" keys={['ctrl', 'M']} />
        <ShortcutRow action="Spoiler" keys={['ctrl', 'P']} />
      </Section>

      {/* Запись голосового: Esc — подтверждение отмены (Composer) */}
      <Section caption="Recording">
        <ShortcutRow action="Cancel Recording" keys={['esc']} />
      </Section>
    </SettingsScreen>
  )
}
