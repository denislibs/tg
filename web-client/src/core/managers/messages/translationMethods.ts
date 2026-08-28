// src/core/managers/messages/translationMethods.ts
//
// Перевод + транскрипция (порт tweb appTranslations). Выделено из God-объекта
// messagesManager: зависит только от rest и точечного патча SSOT. Публичный API
// не меняется — методы спредятся в объект messagesManager.
import type { MessageOp } from '../../realtime/messageOps'
import type { MessagesCtx } from './ctx'

export function newTranslationMethods({ rest, patchMsg, opWindowsFor, emitOps }: MessagesCtx) {
  return {
    /**
     * Перевод текста на toLang (ISO-код). 503 при отключённом провайдере.
     *
     * Ответ — конструктор `messages.translateResult`: ВЕКТОР строк с разметкой
     * (оригинал переводит пачку сообщений одним вызовом; мы просим по одной).
     * Языка-источника у конструктора нет вовсе — перевод просят НА язык.
     */
    async translate(text: string, toLang: string): Promise<{ text: string; source: string }> {
      const r = await rest.post<{ _: 'messages.translateResult'; result: { text: string }[] }>('/translate', { text, to_lang: toLang })
      return { text: r.result?.[0]?.text ?? '', source: '' }
    },

    // Расшифровка голосового/видео-кружка (Telegram transcribeAudio). Реального STT
    // на бэке нет — возвращается детерминированный стаб и кэшируется в SSOT, чтобы
    // блок остался развёрнутым при перерисовке.
    //
    // «Ещё расшифровывается» — ФЛАГ конструктора: его отсутствие и есть «готово».
    async transcribe(peerId: number, msgId: number): Promise<{ text: string; pending: boolean }> {
      const r = await rest.post<{ _: 'messages.transcribedAudio'; text: string; pFlags?: { pending?: true } }>(`/chats/${peerId}/messages/${msgId}/transcribe`, {})
      patchMsg(peerId, (m) => m.id === msgId, (m) => ({ ...m, transcription: r.text }))
      // Расшифровка — ПАРАМЕТР сообщения, и бабл рисует именно его (кэш
      // сообщения приоритетнее локально полученного текста). Значит объявить её
      // окну обязан владелец операцией: прежде она ложилась только в SSOT
      // воркера и доезжала до окна лишь перезагрузкой чата.
      emitOps(opWindowsFor(peerId, msgId).map((key): MessageOp => ({ op: 'patch', key, msgId, fields: { transcription: r.text } })))
      return { text: r.text, pending: !!r.pFlags?.pending }
    },
  }
}
