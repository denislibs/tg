// Тема активного чата (только её вариант — акцент/градиент обоев), нужная
// глобальному ChatBackground (App), чтобы обои темы чата были видны за
// колонками (tweb рисует обои per-peer, а не только в колонке). Цветовые
// CSS-переменные (--primary-color и производные) больше НЕ поднимаются на
// шелл — tweb применяет тему чата только на контейнере колонки чата
// (chat.ts applyContainerTheme → applyTheme(theme, this.container)), боковые
// колонки остаются на глобальной теме. Скоуп цвета — в Chat
// (applyChatTheme/clearChatTheme на .root).
//
// Хук читает всё из сторов и не принимает аргументов: обои монтируются выше
// ветвления authed (как `appChatBackground.attach()` в tweb index.ts:544 — до
// разбора authState), то есть в точке, где Shell со своим `selected`/`threadChat`
// ещё не существует. На экране входа выбора нет, вариант выходит undefined и
// обои рисуются дефолтной темой — как в tweb.
import { chatThemeVariant, type ChatThemeVariant } from '../../chatThemes'
import { resolvePreset, PRESET_MODE } from '../../theme'
import { useSettingsStore } from '../../settings'
import { useChatsStore } from '../../stores/chatsStore'
import { useNavigationStore } from '../../stores/navigationStore'
import { useChatStackStore, selectOpenThreadDesc } from '../../stores/chatStackStore'

export interface ShellTheme {
  shellThemeVariant: ChatThemeVariant | undefined
}

export function useShellTheme(): ShellTheme {
  const selectedId = useNavigationStore((s) => s.selectedId)
  const openThread = useChatStackStore(selectOpenThreadDesc)
  // Тема живёт в диалоге (chatsStore.dialogs) — тот же источник, из которого
  // useChatList собирает Chat, поэтому отдельный фолбэк по `selected.themeId`
  // ничего не добавил бы. Черновик (`draft:<peerId>`) и синтетический чат треда
  // темы не имеют по построению.
  const activeChatNumId = openThread
    ? openThread.peerId
    : (selectedId && /^\d+$/.test(selectedId) ? Number(selectedId) : null)
  const activeDialogThemeId = useChatsStore((st) =>
    activeChatNumId == null ? undefined : st.dialogs.find((d) => d.peerId === activeChatNumId)?.themeId)
  const shellThemeChoice = useSettingsStore((st) => st.themeChoice)
  const shellThemeMode = PRESET_MODE[resolvePreset(shellThemeChoice)]
  const shellThemeVariant = chatThemeVariant(activeDialogThemeId, shellThemeMode)
  return { shellThemeVariant }
}
