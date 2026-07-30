// src/core/managers/messages/translationMethods.ts
//
// Перевод + транскрипция (порт tweb appTranslations). Выделено из God-объекта
// messagesManager: зависит только от rest и точечного патча SSOT. Публичный API
// не меняется — методы спредятся в объект messagesManager.
import type { MessagesCtx } from './ctx'

export function newTranslationMethods({ rest, patchMsg }: MessagesCtx) {
  return {
    // Перевод произвольного текста на toLang (ISO-код). source — определённый
    // сервером исходный язык. 503 при отключённом провайдере (пробрасывается).
    async translate(text: string, toLang: string): Promise<{ text: string; source: string }> {
      return rest.post<{ text: string; source: string }>('/translate', { text, to_lang: toLang })
    },

    // Расшифровка голосового/видео-кружка (Telegram transcribeAudio). Реального STT
    // на бэке нет — возвращается детерминированный стаб и кэшируется в SSOT, чтобы
    // блок остался развёрнутым при перерисовке.
    async transcribe(chatId: number, msgId: number): Promise<{ text: string; pending: boolean }> {
      const r = await rest.post<{ text: string; pending: boolean }>(`/chats/${chatId}/messages/${msgId}/transcribe`, {})
      patchMsg(chatId, (m) => m.id === msgId, (m) => ({ ...m, transcription: r.text }))
      return r
    },
  }
}
