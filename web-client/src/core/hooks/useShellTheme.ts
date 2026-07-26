// Тема активного чата, поднятая на #app-shell (общий предок трёх колонок):
// CSS-переменные наследуются вниз, поэтому --tg-accent тут тематизирует и боковые
// колонки, не трогая глобальные токены (<html data-theme>) и другие чаты. Обои
// темы остаются локально в колонке чата (ConversationView).
import type { CSSProperties } from 'react'
import { chatThemeVariant, chatThemeBubbleOut, type ChatThemeVariant } from '../../chatThemes'
import { resolvePreset, PRESET_MODE } from '../../theme'
import { useSettingsStore } from '../../settings'
import { useChatsStore } from '../../stores/chatsStore'
import type { Chat } from '../../data'
import type { OpenThread } from '../../stores/navigationStore'

export interface ShellTheme {
  shellThemeVariant: ChatThemeVariant | undefined
  shellThemeStyle: CSSProperties | undefined
}

export function useShellTheme(args: {
  selected: Chat | null
  openThread: OpenThread | null
  threadChat: Chat | null
}): ShellTheme {
  const { selected, openThread, threadChat } = args
  const activeChatNumId = openThread
    ? openThread.chatId
    : (selected && /^\d+$/.test(selected.id) ? Number(selected.id) : null)
  const activeDialogThemeId = useChatsStore((st) =>
    activeChatNumId == null ? undefined : st.dialogs.find((d) => d.chatId === activeChatNumId)?.themeId)
  const shellThemeChoice = useSettingsStore((st) => st.themeChoice)
  const shellThemeMode = PRESET_MODE[resolvePreset(shellThemeChoice)]
  const shellThemeVariant = chatThemeVariant(
    activeDialogThemeId ?? (openThread ? threadChat?.themeId : selected?.themeId),
    shellThemeMode,
  )
  const shellThemeStyle: CSSProperties | undefined = shellThemeVariant
    ? ({
        '--tg-accent': shellThemeVariant.accent,
        '--tg-accentGradient': `linear-gradient(135deg, ${shellThemeVariant.accent}, ${shellThemeVariant.accent})`,
        '--tg-bubbleOutAccent': shellThemeVariant.accent,
        '--tg-bubbleOut': chatThemeBubbleOut(shellThemeVariant.accent, shellThemeMode),
        // Бейдж непрочитанных (список чатов) — часть акцента темы (tweb .badge).
        '--tg-badge': shellThemeVariant.accent,
      } as CSSProperties)
    : undefined
  return { shellThemeVariant, shellThemeStyle }
}
