// src/core/media/localPreview.ts
//
// blob:-URL локального превью отправляемого медиа — ВКЛАДОЧНОЕ обогащение, не
// факт сессии. Владелец окна (менеджер воркера) про него не знает СОЗНАТЕЛЬНО:
// SSOT воркера общий на все вкладки, а blob-URL резолвится только в том
// браузерном контексте, где создан, — разослав его операцией, мы бы дали
// остальным вкладкам битый превью навсегда (localUrl приоритетнее mediaId в
// рендере и позже не очищается). Раньше ту же задачу решал `origin_tab` в кадре
// pending_new: воркер рассылал localUrl всем, а каждая вкладка вырезала чужой.
// Теперь его просто нет в SSOT: вкладка, породившая blob, накладывает его на
// пришедшую операцию у себя (storeProjection), остальные операцию применяют как
// есть и рисуют серверное медиа, когда оно приедет.
//
// Перенос аплоада целиком в воркер (тогда превью минтит он же, как
// downloadMediaURL) — отдельная задача; до неё это самый узкий способ сохранить
// мгновенный превью у отправителя.
import type { MessageOp } from '../realtime/messageOps'

const byClientId = new Map<string, string>()

/** Запомнить превью своей отправки (зовёт путь отправки ДО RPC sendMessage —
 *  операция вставки прилетит уже после и найдёт запись). */
export function setLocalPreview(clientMsgId: string, url: string): void {
  byClientId.set(clientMsgId, url)
}

/** Бабл ушёл из окна, не дождавшись сервера (отмена аплоада) — запись больше не
 *  на что накладывать. */
export function dropLocalPreview(clientMsgId: string): void {
  byClientId.delete(clientMsgId)
}

/** Наложить своё превью на операции воркера. Трогает только `insert` своих же
 *  баблов: у временного (id < 0) проставляет localUrl, на настоящем сообщении
 *  (положительный id — доехал ack/эхо) снимает запись — дальше localUrl несёт
 *  само сообщение окна (слияние по clientId в messageOps.insert). */
export function withLocalPreview(ops: MessageOp[]): MessageOp[] {
  if (!byClientId.size) return ops
  return ops.map((op) => {
    if (op.op !== 'insert' || !op.msg.clientId) return op
    const url = byClientId.get(op.msg.clientId)
    if (!url) return op
    if (op.msg.id >= 0) { byClientId.delete(op.msg.clientId); return op }
    return { ...op, msg: { ...op.msg, localUrl: url } }
  })
}
