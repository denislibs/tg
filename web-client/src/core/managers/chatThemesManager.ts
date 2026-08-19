// Темы оформления конкретного чата (Telegram messages.setChatTheme): REST-часть
// в воркере. Тема общая для чата — сервер рассылает смену обоим участникам
// фреймом chat_theme_update (workerCore.ts::dispatch → dialogs.applyTheme).
// Пустой themeId — сброс.
import type { RestClient } from '../net/restClient'
import type { DialogsManager } from './dialogsManager'

export function newChatThemesManager({ rest, dialogs }: {
  rest: Pick<RestClient, 'put'>
  dialogs: Pick<DialogsManager, 'applyTheme'>
}) {
  return {
    async setChatTheme(peerId: number, themeId: string): Promise<void> {
      await rest.put(`/chats/${peerId}/theme`, { theme_id: themeId })
      // Оптимистики нет (Task 4, порт tweb): применяем ПОСЛЕ ответа сети.
      dialogs.applyTheme(peerId, themeId)
    },
  }
}

export type ChatThemesManager = ReturnType<typeof newChatThemesManager>
