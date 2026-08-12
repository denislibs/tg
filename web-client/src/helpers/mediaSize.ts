// Порт tweb `helpers/mediaSize.ts` — 1:1 по форме (класс `MediaSize` с
// конструктором `width, height = width` и aspect-методами поверх
// `calcImageInBox`). Адаптации:
//   • `calcImageInBox` у нас уже портирован в `core/dom/calcImageInBox.ts`
//     (named export, возвращает plain `{width, height}` вместо tweb
//     `MediaSize` — числа те же, потребителям вьювера нужны только они);
//   • формат `.oxlintrc.json` (без `;`).
import { calcImageInBox } from '@core/dom/calcImageInBox'

export class MediaSize {
  constructor(public width = 0, public height = width) {

  }

  public aspect(boxSize: MediaSize, fitted: boolean) {
    return calcImageInBox(this.width, this.height, boxSize.width, boxSize.height, fitted)
  }

  public aspectFitted(boxSize: MediaSize) {
    return this.aspect(boxSize, true)
  }

  public aspectCovered(boxSize: MediaSize) {
    return this.aspect(boxSize, false)
  }
}

export function makeMediaSize(width?: number, height?: number): MediaSize {
  return new MediaSize(width, height)
}
