// src/core/dialogs/draft.ts
//
// Облачный черновик — ПОЛЕ диалога (`dialog.draft`, flags.1?DraftMessage), а не
// отдельный список рядом с ним.
//
// Что было и почему это дефект. Черновики жили своим стором (`AppState.drafts`)
// и своей плоской моделью `{peerId, text, replyToId, date}`, а на проводе едет
// объединение `DraftMessage`. Стоило это двух вещей:
//
//   • «когда чат последний раз трогали» собиралось ИЗ ДВУХ ИСТОЧНИКОВ — даты
//     сообщения и даты черновика, лежавших врозь, — а от неё зависит порядок
//     списка. Индекс диалога приходилось считать с довеском-параметром, и
//     докблок `dialogIndex` это прямо называл: «в tweb черновик лежит внутри
//     dialog.draft, у нас — в отдельном сторе»;
//   • плоская форма теряла `pFlags.no_webpage` (черновик с выключенным превью
//     ссылки) и сводила `reply_to` к числу, хотя в схеме это `InputReplyTo` —
//     объединение, у которого есть и цитата.
//
// «Черновика нет» здесь ОТСУТСТВИЕ поля. Пустой конструктор `draftMessageEmpty`
// — это СОБЫТИЕ «черновик сняли», оно приезжает кадром `updateDraftMessage` и в
// строке списка не хранится: хранить «его сняли» значит держать состояние там,
// где было изменение.

import type { DraftMessage, DraftMessageReal } from '../models'

/** Настоящий черновик, если он есть (пустой конструктор — не черновик). */
export function realDraft(draft: DraftMessage | undefined): DraftMessageReal | undefined {
  return draft?._ === 'draftMessage' ? draft : undefined
}

/** Текст черновика для превью и композера; поле называется `message` — тем же
 *  именем, что у самого сообщения. */
export function draftText(draft: DraftMessage | undefined): string {
  return realDraft(draft)?.message ?? ''
}

/** Есть ли что показывать: пустой текст без ответа — не черновик. */
export function hasDraft(draft: DraftMessage | undefined): boolean {
  const d = realDraft(draft)
  return !!d && (!!d.message.trim() || d.reply_to !== undefined)
}

/** На что отвечает черновик (наш `reply_to_msg_id`), либо null. */
export function draftReplyToId(draft: DraftMessage | undefined): number | null {
  return realDraft(draft)?.reply_to?.reply_to_msg_id ?? null
}

/** Дата черновика, секунды эпохи — те же единицы, что у сообщения. */
export function draftDate(draft: DraftMessage | undefined): number {
  return realDraft(draft)?.date ?? 0
}

/** Черновик, собранный клиентом для оптимистичной записи до ответа ручки. */
export function newDraft(text: string, replyToId: number | null, date: number): DraftMessageReal {
  const d: DraftMessageReal = { _: 'draftMessage', message: text, date }
  if (replyToId != null) d.reply_to = { _: 'inputReplyToMessage', reply_to_msg_id: replyToId }
  return d
}
