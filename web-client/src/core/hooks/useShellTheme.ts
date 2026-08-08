// Тема активного чата (только её вариант — акцент/градиент обоев), нужная
// глобальному ChatBackground (App), чтобы обои темы чата были видны за
// колонками (tweb рисует обои per-peer, а не только в колонке). Цветовые
// CSS-переменные (--primary-color и производные) больше НЕ поднимаются на
// #app-shell — tweb применяет тему чата только на контейнере колонки чата
// (chat.ts applyContainerTheme → applyTheme(theme, this.container)), боковые
// колонки остаются на глобальной теме. Скоуп цвета — в Chat
// (applyChatTheme/clearChatTheme на .root).
import { chatThemeVariant, type ChatThemeVariant } from '../../chatThemes'
import { resolvePreset, PRESET_MODE } from '../../theme'
import { useSettingsStore } from '../../settings'
import { useChatsStore } from '../../stores/chatsStore'
import type { Chat } from '../../data'
import type { OpenThread } from '../../stores/navigationStore'

export interface ShellTheme {
  shellThemeVariant: ChatThemeVariant | undefined
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
  return { shellThemeVariant }
}
