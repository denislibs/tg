/**
 * Порт tweb `src/lib/appManagers/utils/stickers/isStickerSetAdded.ts` (812502980).
 *
 * «Установлен ли набор» отвечает параметр самого набора — срок установки
 * `installed_date` (шапка `core/managers/stickersManager.ts`), а не попадание в
 * список моих наборов.
 *
 * Расхождение: ветки `!set.pFlags.archived` нет — архива наборов у нас нет
 * (флага `archived` на проводе нет, план 2C, задача 15: архив — О-8).
 */
import type { StickerSet } from '@core/managers/stickersManager'

export default function isStickerSetAdded(set: StickerSet) {
  return !!set.installed_date
}
