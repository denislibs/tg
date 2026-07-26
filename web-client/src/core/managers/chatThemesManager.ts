// Темы оформления конкретного чата (Telegram messages.setChatTheme): REST-часть
// в воркере. Тема общая для чата — сервер рассылает смену обоим участникам
// фреймом chat_theme_update (realtimeBridge → chatsStore). Пустой themeId — сброс.
import type { RestClient } from '../net/restClient'

export function newChatThemesManager({ rest }: { rest: Pick<RestClient, 'put'> }) {
  return {
    async setChatTheme(chatId: number, themeId: string): Promise<void> {
      await rest.put(`/chats/${chatId}/theme`, { theme_id: themeId })
    },
  }
}

export type ChatThemesManager = ReturnType<typeof newChatThemesManager>
