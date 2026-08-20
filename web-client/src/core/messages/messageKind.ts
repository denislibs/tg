// src/core/messages/messageKind.ts
//
// «Что это за сообщение» — ВОПРОС ВИТРИНЫ, а не поле провода.
//
// С провода снято `type: string`, где `"service"` стояло наравне с `"photo"`,
// `"poll"` и `"encrypted"`: одно поле отвечало на три разных вопроса — «это
// служебное?», «какое вложение?», «это шифрованное сообщение секретного чата?».
// Первый вопрос теперь решает ВЫБОР КОНСТРУКТОРА (`message` против
// `messageService`), второй — объединение `MessageMedia` вместе с выведенным из
// атрибутов `doc.type` (`saveDocument`, порт `appDocsManager.saveDoc`), третий —
// наш параметр вне схемы `enc_body`.
//
// Ровно так ветвится и оригинал: `wrapMessageContent` смотрит на `media._`, а
// внутри документа — на `doc.type`. Здесь этот же вывод собран в ОДНУ функцию,
// потому что спрашивают его трое (бабл, превью списка чатов, цитата ответа), и
// три копии вывода — это ровно то, чем было снятое поле.
import { getDocumentFromMessage, type MessageMedia } from '../media/messageMedia'
import type { MyMessage } from '../models'

/**
 * Виды, которые различает витрина. Совпадают с ветками рендера бабла; альбом
 * (`grouped_id`) видом НЕ является — это группировка соседних сообщений, и
 * собирает её лента.
 */
export type MessageKind =
  | 'text'
  | 'photo'
  | 'video'
  | 'gif'
  | 'roundVideo'
  | 'voice'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'geo'
  | 'contact'
  | 'poll'
  | 'checklist'
  | 'giveaway'
  | 'gift'
  | 'call'
  | 'service'
  | 'encrypted'

/** Вид ВЛОЖЕНИЯ — только по объединению `MessageMedia` и атрибутам документа. */
export function mediaKind(media: MessageMedia | undefined): MessageKind | undefined {
  if (!media) return undefined
  if (media._ === 'messageMediaPhoto') return 'photo'
  switch (media.document.type) {
    case 'sticker': return 'sticker'
    case 'gif': return 'gif'
    case 'video': return 'video'
    case 'round': return 'roundVideo'
    case 'voice': return 'voice'
    case 'audio': return 'audio'
    // Картинка, отправленная ФАЙЛОМ, у оригинала тоже `photo` (документ с
    // `documentAttributeImageSize`) — бабл у неё картиночный.
    case 'photo': return 'photo'
    default: return 'document'
  }
}

/** Вид сообщения целиком. */
export function getMessageKind(m: MyMessage): MessageKind {
  if (m._ === 'messageService') {
    // Лог звонка — служебное сообщение с `messageActionPhoneCall`; прежде это
    // был `type === 'call'` с JSON `{video, reason, duration}` внутри текста.
    return m.action._ === 'messageActionPhoneCall' ? 'call' : 'service'
  }
  // Секретный чат — подсистема вне периметра порта: у шифрованного сообщения
  // тела нет вовсе, на проводе едет блоб `iv||ciphertext`.
  if (m.enc_body) return 'encrypted'
  // Долг «объединение MessageMedia не доведено»: опрос, чек-лист, розыгрыш,
  // подарок, гео и контакт — конструкторы ТОГО ЖЕ объединения, но у нас пока
  // собственные поля сообщения (см. `MessageReal`).
  if (m.poll) return 'poll'
  if (m.checklist) return 'checklist'
  if (m.giveaway) return 'giveaway'
  if (m.gift) return 'gift'
  if (m.geo) return 'geo'
  if (m.contact) return 'contact'
  return mediaKind(m.media) ?? 'text'
}

/** Адрес файла вложения; `undefined` — вложения нет. Прежде это было плоское
 *  поле `media_id` рядом с самим вложением — два места на одно значение. */
export function getMediaId(m: MyMessage): number | undefined {
  if (m._ !== 'message' || !m.media) return undefined
  return m.media._ === 'messageMediaDocument' ? m.media.document.id : m.media.photo.id
}

/** Имя файла документа — для превью и лейблов. */
export function getFileName(m: MyMessage): string | undefined {
  return getDocumentFromMessage(m._ === 'message' ? m : undefined)?.file_name || undefined
}
