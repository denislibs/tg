// src/core/managers/messages/sendingParams.ts
//
// ПАКЕТ ПАРАМЕТРОВ ОТПРАВКИ — порт tweb `MessageSendingParams`
// (`lib/appManagers/appMessagesManager.ts:255`). В оригинале это ОДИН тип,
// который принимают ВСЕ методы отправки (`sendText`, `sendFile`, `sendOther`,
// `sendGrouped`, `forwardMessages`), а вызывающий собирает его один раз —
// `Chat.getMessageSendingParams()` (`components/chat/chat.ts:1352`). Смысл формы
// не в экономии букв: новый путь отправки физически не может «забыть» поле,
// потому что поле приходит пакетом, а не дописывается в каждый вызов руками.
//
// До этого порта `replyToId`/цитата/`silent`/`effect`/send-as знал ровно один
// путь — текстовый (`useChatSend.sendReal`), а стикер/гиф/файл/голос/кружок/
// гео/контакт/опрос не несли ничего: одиннадцать красных клеток матрицы А
// (`docs/readiness/message-matrix.md`) — одна и та же непротянутая нитка.
//
// ЧТО ИЗ ОРИГИНАЛА НЕ ПЕРЕНЕСЕНО И ПОЧЕМУ (у поля нет предмета, а не «лень»):
//   • `replyToStoryId` — ответ на историю. Истории у нас есть, но ответ НА
//     историю уходит обычным сообщением в приватный чат автора (`storiesManager`),
//     отдельной ссылки «сообщение → история» ни в модели `Message`, ни в
//     `messages` бэкенда нет — поле некуда положить.
//   • `replyToPollOption` — ответ на конкретный вариант опроса (MTProto
//     `inputReplyToMessage.poll_option`). Ни в `domain.Message`, ни в кадре
//     `send_message` бэкенда такого поля нет; UI выбора варианта для ответа тоже
//     нет.
//   • `replyToMonoforumPeerId` — монофорумы (Telegram Direct Messages канала).
//     Подсистемы монофорумов у нас нет ЦЕЛИКОМ (ни типа чата, ни `saved_peer_id`).
//   • `scheduleDate` / `scheduleRepeatPeriod` — отложенная отправка. У нас она
//     НЕ поле пакета, а отдельный эндпоинт (`messages.scheduleMessage` → REST
//     `/chats/{id}/scheduled`), поэтому в пакет её тянуть нечего: он описывает
//     то, что уезжает В КАДРЕ `send_message`.
//   • `updateStickersetOrder` (порядок паков), `savedReaction` (теги Saved
//     Messages), `invertMedia` (медиа под текстом), `confirmedPaymentResult`
//     (звёздная оплата отправки), `suggestedPost` — соответствующих полей нет ни
//     в проводном кадре, ни в бэкенде.
//   • `peerId` — в оригинале часть пакета, у нас chatId явный аргумент каждого
//     метода отправки (`SendArgs.chatId`), дублировать его пакетом незачем.
//
// `replyToPeerId` предмет ИМЕЕТ (кросс-чат ответ, `Message.replyToPeerId`), но
// с оговоркой: бэкенд присланному значению НЕ ДОВЕРЯЕТ и выводит его сам,
// резолвя оригинал по `reply_to_id` (`backend/internal/usecase/chat/message.go:142-165`
// — «источник истины — ФАКТИЧЕСКИЙ чат оригинала»). В кадре поле остаётся (так
// его же кладёт и текстовый путь сегодня), но решающим является серверный вывод.
import type { SendArgs as WireSendArgs } from '../../realtime/connectionManager'

/** Порт tweb `MessageSendingParams` (:255) — имена полей 1:1 с оригиналом. */
export interface MessageSendingParams {
  /** tweb `threadId` — окно треда (форум-топик / комментарии) */
  threadId?: number | null
  /** tweb `replyToMsgId` */
  replyToMsgId?: number | null
  /** tweb `replyToQuote` — цитата фрагмента оригинала; offset в UTF-16 */
  replyToQuote?: { text: string; offset: number } | null
  /** tweb `replyToPeerId` — кросс-чат ответ (исходный чат оригинала) */
  replyToPeerId?: number | null
  /** tweb `silent` — тихая отправка (disable_notification) */
  silent?: boolean
  /** tweb `sendAsPeerId` — отправка от имени канала/группы */
  sendAsPeerId?: number | null
  /** tweb `effect` — полноэкранный эффект сообщения */
  effect?: string | null
}

/** Пустой пакет — для путей, у которых собирать нечего (тесты, фолбэки). */
export const EMPTY_SENDING_PARAMS: MessageSendingParams = {}

/** Ключи пакета — нужны и `splitSendingParams`, и скану-пину (`core/sendingParams.test.ts`). */
export const SENDING_PARAM_KEYS = [
  'threadId', 'replyToMsgId', 'replyToQuote', 'replyToPeerId', 'silent', 'sendAsPeerId', 'effect',
] as const satisfies readonly (keyof MessageSendingParams)[]

/** Проводные поля, которые пакет ПОЛНОСТЬЮ покрывает: их нельзя передать мимо
 *  него. `Required` — потому что пакет их ВСЕГДА проставляет (пусто = явный
 *  null/false, а не «поля нет»); в самом `WireSendArgs` они опциональны. */
export type SendingParamsWireFields =
  Required<Pick<WireSendArgs, 'replyToId' | 'replyToPeerId' | 'replyQuoteText' | 'replyQuoteOffset' | 'threadRootId' | 'silent' | 'effect' | 'sendAsChatId'>>

/**
 * Пакет → проводные поля кадра `send_message`. Порт tweb `getInputReplyTo`
 * (:2674): цитата осмыслена ТОЛЬКО при `replyToMsgId` — в оригинале
 * `quote_text`/`quote_offset` лежат ВНУТРИ `inputReplyToMessage`, поэтому без
 * ответа их и положить некуда; бэкенд сбрасывает их тем же правилом
 * (`message.go:167-169`).
 */
export function sendingParamsToWire(p: MessageSendingParams): SendingParamsWireFields {
  const replyToId = p.replyToMsgId ?? null
  return {
    replyToId,
    replyToPeerId: replyToId != null ? p.replyToPeerId ?? null : null,
    replyQuoteText: replyToId != null ? p.replyToQuote?.text ?? null : null,
    replyQuoteOffset: replyToId != null ? p.replyToQuote?.offset ?? null : null,
    threadRootId: p.threadId ?? null,
    silent: p.silent ?? false,
    effect: p.effect ?? null,
    sendAsChatId: p.sendAsPeerId ?? null,
  }
}

/**
 * Разложить аргументы метода отправки на пакет и «всё остальное». Пакет в
 * оригинале спредится в аргументы плоско (`sendFile({...sendingParams, file})`),
 * поэтому и здесь он часть объекта аргументов, а не вложенное поле — иначе
 * форма разошлась бы с tweb.
 */
export function splitSendingParams<T extends MessageSendingParams>(
  o: T,
): { params: MessageSendingParams; rest: Omit<T, keyof MessageSendingParams> } {
  const { threadId, replyToMsgId, replyToQuote, replyToPeerId, silent, sendAsPeerId, effect, ...rest } = o
  return { params: { threadId, replyToMsgId, replyToQuote, replyToPeerId, silent, sendAsPeerId, effect }, rest }
}
