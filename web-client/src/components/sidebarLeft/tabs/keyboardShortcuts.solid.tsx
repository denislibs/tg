/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/keyboardShortcuts.tsx:1-292 (812502980) —
 * вкладка «Горячие клавиши» (`AppKeyboardShortcutsTab`, `solidJsTabs/tabs.ts`).
 * Задача 10 плана волны 2D (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`).
 *
 * Строка — `Row.Title titleRight=<KeyCombo> titleRightSecondary` (+ `Row.Subtitle`
 * для подсказки, `:69-78`), секции — `Section` с подписью под карточкой. Разметка —
 * дамп `docs/tweb/dom/dumps/14-left-23-settings-shortcuts.json`.
 *
 * Состав вкладки — только сочетания, которые клиент действительно обрабатывает
 * (решение пользователя: на вкладке не показывается то, чего у нас нет). Кто слушает:
 * форматирование — `composer/helpers.ts::SHORTCUTS` + Ctrl+K в
 * `composer/useComposerHotkeys.ts`; Enter / Shift+Enter, ↑ и Ctrl+↑ — там же;
 * Alt+↑/↓ — `appImManager.attachKeydownListener`; Ctrl+F, Ctrl+0 —
 * `AppSidebarLeft.construct` (`addShortcutListener`); Esc — `core/navigation/
 * appNavigationController`; медиа — `mediaViewer/base.ts::onKeyDown`; истории —
 * `core/hooks/useStoryViewer.ts`; редактор — `mediaEditor/MediaEditor.tsx`.
 *
 * Расхождения с оригиналом:
 *  1. Строка «Send message» (`SendShortcutRow`, `:95-123`) — обычная `ShortcutRow`
 *     с Enter, без `InlineSelect` выбора Enter / Ctrl+Enter: настройки
 *     `appSettings.sendShortcut` и её потребителя `isSendShortcutPressed` у нас нет —
 *     композер отправляет только по Enter. По той же причине «New line» всегда
 *     Shift+Enter (у tweb `:127` — Enter при `ctrlEnter`), а у секции нет подписи
 *     `KeyboardShortcuts.Section.Messages.Caption` (`:141`, «Choose how messages are
 *     sent…») — выбирать нечего.
 *  2. Нет строк `JumpToInputStart`/`JumpToInputEnd` (`:145-152`): каретку в начало и
 *     конец поля по PageUp/PageDown наш композер не двигает. Ctrl+PageUp/PageDown
 *     у нас заняты прокруткой ленты (`core/hooks/useFeedPageHotkeys.ts`) — такой
 *     строки у tweb нет, и на вкладку она не выдумывается.
 *  3. Нет секции «Other» со строкой `LockPasscode` (`:250-277`): сочетания
 *     блокировки по код-паролю (`settings.passcode.lockShortcut`) у нас нет —
 *     заведёт задача 18 (`ShortcutBuilder`), тогда же вернётся и секция.
 *  4. `IS_APPLE` — из нашего `@environment/userAgent` (вендорен из tweb 1:1).
 */
import { For, Show, type JSX } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import { IS_APPLE } from '@environment/userAgent'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import styles from './keyboardShortcuts.module.scss'

const KEY_LABELS: { [k: string]: { mac: string, pc: string } } = {
  ctrl: { mac: '⌘', pc: 'Ctrl' },
  shift: { mac: '⇧', pc: 'Shift' },
  alt: { mac: '⌥', pc: 'Alt' },
  meta: { mac: '⌘', pc: 'Win' },
  enter: { mac: '↵', pc: 'Enter' },
  esc: { mac: 'Esc', pc: 'Esc' },
  space: { mac: 'Space', pc: 'Space' },
  up: { mac: '↑', pc: '↑' },
  down: { mac: '↓', pc: '↓' },
  left: { mac: '←', pc: '←' },
  right: { mac: '→', pc: '→' },
  plus: { mac: '+', pc: '+' },
  minus: { mac: '−', pc: '−' },
}

function labelFor(key: string): string {
  const lower = key.toLowerCase()
  const lookup = KEY_LABELS[lower]
  if(lookup) return IS_APPLE ? lookup.mac : lookup.pc
  return key.length === 1 ? key.toUpperCase() : key
}

const Kbd = (props: { children: JSX.Element }) => (
  <span class={styles.kbd}>{props.children}</span>
)

const KeyCombo = (props: { keys: string[] }) => (
  <span class={styles.keys}>
    <For each={props.keys}>
      {(key, index) => (
        <>
          <Show when={index() > 0}>
            <span class={styles.plus}>+</span>
          </Show>
          <Kbd>{labelFor(key)}</Kbd>
        </>
      )}
    </For>
  </span>
)

const KeyAlternatives = (props: { combos: string[][] }) => (
  <span class={styles.keys}>
    <For each={props.combos}>
      {(combo, index) => (
        <>
          <Show when={index() > 0}>
            <span class={styles.or}>/</span>
          </Show>
          <KeyCombo keys={combo} />
        </>
      )}
    </For>
  </span>
)

const ShortcutRow = (props: { action: LangPackKey, hint?: LangPackKey, keys: JSX.Element }) => (
  <Row>
    <Row.Title titleRight={props.keys} titleRightSecondary>
      {i18n(props.action)}
    </Row.Title>
    <Show when={props.hint}>
      <Row.Subtitle>{i18n(props.hint!)}</Row.Subtitle>
    </Show>
  </Row>
)

const FormattingSection = () => (
  <Section
    name="KeyboardShortcuts.Section.Formatting"
    caption="KeyboardShortcuts.Section.Formatting.Caption"
  >
    <ShortcutRow action="KeyboardShortcuts.Action.Bold" keys={<KeyCombo keys={['ctrl', 'B']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Italic" keys={<KeyCombo keys={['ctrl', 'I']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Underline" keys={<KeyCombo keys={['ctrl', 'U']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Strikethrough" keys={<KeyCombo keys={['ctrl', 'S']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Monospace" keys={<KeyCombo keys={['ctrl', 'M']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Spoiler" keys={<KeyCombo keys={['ctrl', 'P']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Link" keys={<KeyCombo keys={['ctrl', 'K']} />} />
  </Section>
)

const MessagesSection = () => (
  // tweb :139-142 — ещё caption="KeyboardShortcuts.Section.Messages.Caption", :95-136 —
  // SendShortcutRow с InlineSelect и NewLineRow от sendShortcut: выбора Ctrl+Enter у нас
  // нет (расхождение 1 в шапке)
  <Section name="KeyboardShortcuts.Section.Messages">
    <ShortcutRow action="KeyboardShortcuts.Action.Send" keys={<KeyCombo keys={['enter']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.NewLine" keys={<KeyCombo keys={['shift', 'enter']} />} />
    {/* tweb :145-152 — JumpToInputStart/End: у нас не обрабатываются (расхождение 2) */}
  </Section>
)

const ChatSection = () => (
  <Section name="KeyboardShortcuts.Section.Chat">
    <ShortcutRow
      action="KeyboardShortcuts.Action.EditLast"
      hint="KeyboardShortcuts.Hint.WhenInputEmpty"
      keys={<KeyCombo keys={['up']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.ReplyToPrevious"
      keys={<KeyCombo keys={['ctrl', 'up']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.NextChat"
      keys={<KeyCombo keys={['alt', 'down']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.PreviousChat"
      keys={<KeyCombo keys={['alt', 'up']} />}
    />
  </Section>
)

const NavigationSection = () => (
  <Section name="KeyboardShortcuts.Section.Navigation">
    <ShortcutRow
      action="KeyboardShortcuts.Action.OpenSearch"
      keys={<KeyCombo keys={['ctrl', 'F']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.SavedMessages"
      keys={<KeyCombo keys={['ctrl', '0']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.ClosePopup"
      keys={<KeyCombo keys={['esc']} />}
    />
  </Section>
)

const MediaViewerSection = () => (
  <Section name="KeyboardShortcuts.Section.MediaViewer">
    <ShortcutRow
      action="KeyboardShortcuts.Action.NextMedia"
      keys={<KeyCombo keys={['right']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.PreviousMedia"
      keys={<KeyCombo keys={['left']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.ZoomIn"
      keys={<KeyCombo keys={['ctrl', 'plus']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.ZoomOut"
      keys={<KeyCombo keys={['ctrl', 'minus']} />}
    />
  </Section>
)

const StoriesSection = () => (
  <Section name="KeyboardShortcuts.Section.Stories">
    <ShortcutRow
      action="KeyboardShortcuts.Action.NextStory"
      keys={<KeyCombo keys={['right']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.PreviousStory"
      keys={<KeyCombo keys={['left']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.PlayPauseStory"
      keys={<KeyCombo keys={['space']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.CloseStories"
      keys={<KeyCombo keys={['down']} />}
    />
  </Section>
)

const MediaEditorSection = () => (
  <Section name="KeyboardShortcuts.Section.MediaEditor">
    <ShortcutRow
      action="KeyboardShortcuts.Action.Undo"
      keys={<KeyCombo keys={['ctrl', 'Z']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.Redo"
      keys={<KeyAlternatives combos={[['ctrl', 'shift', 'Z'], ['ctrl', 'Y']]} />}
    />
  </Section>
)

const KeyboardShortcutsTab = () => (
  <>
    <FormattingSection />
    <MessagesSection />
    <ChatSection />
    <NavigationSection />
    <MediaViewerSection />
    <StoriesSection />
    <MediaEditorSection />
    {/* tweb :250-277, :288 — OtherSection (LockPasscode): сочетания блокировки у нас
        нет до задачи 18 (расхождение 3) */}
  </>
)

export default KeyboardShortcutsTab
