// Темы оформления конкретного чата (Telegram messages.setChatTheme): REST-часть
// в воркере. Пустой themeId — сброс.
//
// Локального применения здесь БОЛЬШЕ НЕТ, и это следствие решения Р7: в схеме
// тема живёт не в строке диалога, а в ПОЛНОЙ карточке
// (`chatFull`/`userFull.theme_emoticon`), и владельца-в-воркере у неё поэтому
// не осталось. Сервер рассылает смену всем участникам кадром
// `chat_theme_update` — включая инициатора, — и применяет её единственный
// читатель карточки: `client/realtime/storeProjection.ts` → `core/chatFullCache.ts`.
import type { RestClient } from '../net/restClient'

export function newChatThemesManager({ rest }: { rest: Pick<RestClient, 'put'> }) {
  return {
    async setChatTheme(peerId: number, themeId: string): Promise<void> {
      await rest.put(`/chats/${peerId}/theme`, { theme_id: themeId })
    },
  }
}

export type ChatThemesManager = ReturnType<typeof newChatThemesManager>
