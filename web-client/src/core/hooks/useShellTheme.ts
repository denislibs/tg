// Тема активного чата — её публикует в фон страницы оболочка (`App.tsx` →
// `appChatBackground.setBackground({theme})`, роль tweb `Chat.publishBackground`,
// chat.ts:380-433; tweb рисует обои per-peer на фоне всей страницы, а не только в
// колонке). Цветовые CSS-переменные (--primary-color и производные) на шелл НЕ
// поднимаются — tweb применяет тему чата только на контейнере колонки чата
// (chat.ts applyContainerTheme → applyTheme(theme, this.container)), боковые
// колонки остаются на глобальной теме. Скоуп цвета — в Chat
// (applyChatTheme/clearChatTheme на .root).
//
// Хук отдаёт саму тему, а не её вариант дня/ночи: вариант выбирает фон при
// разрешении по текущей теме (`wallpapers.ts::getThemeWallPaper`), как tweb —
// базу облачной темы (`themeController.getThemeSettings`).
//
// Хук читает всё из сторов и не принимает аргументов: публикация стоит выше
// ветвления authed, в точке, где Shell со своим `selected`/`threadChat` ещё не
// существует. На экране входа выбора нет, тема выходит undefined и фон рисует
// обои приложения — как в tweb.
import { useSyncExternalStore } from 'react'
import { chatThemeById, type ChatTheme } from '../../chatThemes'
import { cachedPeerTheme, chatFullMirrorVersion, subscribeChatFullMirror } from '../chatFullCache'
import { useNavigationStore } from '../../stores/navigationStore'
import { useChatStackStore, selectOpenThreadDesc } from '../../stores/chatStackStore'

export interface ShellTheme {
  shellChatTheme: ChatTheme | undefined
}

export function useShellTheme(): ShellTheme {
  const selectedId = useNavigationStore((s) => s.selectedId)
  const openThread = useChatStackStore(selectOpenThreadDesc)
  // Тема живёт в ПОЛНОЙ КАРТОЧКЕ пира (`theme_emoticon`), а не в строке
  // диалога: в схеме её место `chatFull`/`userFull`, и с провода `/chats` она
  // ушла вместе с решением Р7. Зеркало карточек — `core/chatFullCache.ts`;
  // подписка на него нужна, чтобы кадр `chat_theme_update` (и приезд самой
  // карточки) перекрасил обои. Черновик (`draft:<peerId>`) и синтетический чат
  // треда темы не имеют по построению.
  const activeChatNumId = openThread
    ? openThread.peerId
    : (selectedId && /^\d+$/.test(selectedId) ? Number(selectedId) : null)
  useSyncExternalStore(subscribeChatFullMirror, chatFullMirrorVersion)
  const activeDialogThemeId = activeChatNumId == null ? undefined : cachedPeerTheme(activeChatNumId)
  return { shellChatTheme: chatThemeById(activeDialogThemeId) }
}
