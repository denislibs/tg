import type { Sticker } from '../managers/stickersManager'

// Иконка вкладки набора в панели. Telegram отдаёт обложку не у всех наборов
// (из 334 выгруженных она есть у 230), и tweb в этом случае рисует первый
// стикер набора — stickerSetThumb.ts: при пустых set.thumbs берётся documents[0].
//
// Обложка адресуется `thumb_document_id` — это ДОКУМЕНТ набора, а не отдельный
// файл превью (схема различает два случая, у нас есть только этот).
export function setThumbMediaId(
  set: { thumb_document_id?: number },
  stickers: Pick<Sticker, 'id'>[],
): number | undefined {
  return set.thumb_document_id ?? stickers[0]?.id
}
