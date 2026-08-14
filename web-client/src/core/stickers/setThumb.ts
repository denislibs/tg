import type { Sticker } from '../managers/stickersManager'

// Иконка вкладки набора в панели. Telegram отдаёт обложку не у всех наборов
// (из 334 выгруженных она есть у 230), и tweb в этом случае рисует первый
// стикер набора — stickerSetThumb.ts: при пустых set.thumbs берётся documents[0].
export function setThumbMediaId(
  set: { coverMediaId?: number },
  stickers: Pick<Sticker, 'mediaId'>[],
): number | undefined {
  return set.coverMediaId ?? stickers[0]?.mediaId
}
