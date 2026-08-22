// Фикстура стикера для тестов — ОДНА на всех.
//
// Заведена вместе с портом стикеров на модель схемы: стикер стал `document`, и
// собирать его руками в каждом тесте значило бы разложить по файлам два десятка
// копий одного знания «где у документа лежат ступени и атрибуты». Тот же приём,
// что у `core/messages/testMessage.ts` и `core/dialogs/testDialog.ts`.
//
// Документ проходит `saveDocument` — как и всё, что приезжает с провода:
// `type`/`w`/`h`/`sticker`/`stickerEmojiRaw`/`stickerSetInput` выводятся ИЗ
// АТРИБУТОВ, а не проставляются фикстурой. Тест, забывший про это, увидел бы
// не то, что видит приложение.
import { saveDocument, type MyDocument } from '../media/messageMedia'

export interface StickerFixture {
  /** id ДОКУМЕНТА — единственный ключ файла (Р2 разбора стикеров) */
  id?: number
  /** набор, которому он принадлежит; 0/undefined — «набора нет» */
  setId?: number
  emoji?: string
  width?: number
  height?: number
  mime?: string
  size?: number
  /** base64 stripped-превью (photoStrippedSize) */
  thumb?: string
  /** base64 векторного контура (photoPathSize) */
  pathThumb?: string
}

export function makeSticker({
  id = 1,
  setId = 0,
  emoji = '😀',
  width = 512,
  height = 512,
  mime = 'image/webp',
  size = 1024,
  thumb,
  pathThumb,
}: StickerFixture = {}): MyDocument {
  const thumbs = []
  if (thumb !== undefined) thumbs.push({ _: 'photoStrippedSize' as const, type: 'i', bytes: thumb })
  if (pathThumb !== undefined) thumbs.push({ _: 'photoPathSize' as const, type: 'j', bytes: pathThumb })
  return saveDocument({
    _: 'document',
    id,
    mime_type: mime,
    size,
    ...(thumbs.length ? { thumbs } : {}),
    // ПОРЯДОК как у сервера и у Telegram: размер кадра ПЕРЕД атрибутом
    // стикера. Обратный порядок затирал бы тип (`documentAttributeImageSize`
    // безусловно ставит type='photo'), и фикстура показывала бы не то, что
    // видит приложение.
    attributes: [
      { _: 'documentAttributeImageSize', w: width, h: height },
      {
        _: 'documentAttributeSticker',
        alt: emoji,
        stickerset: setId ? { _: 'inputStickerSetID', id: setId } : { _: 'inputStickerSetEmpty' },
      },
    ],
  })
}

/** Набор — конструктор `stickerSet` схемы. */
export function makeStickerSet({
  id = 1,
  shortName = 'set',
  title = 'Набор',
  count = 1,
  emojis = false,
  thumbDocumentId,
  installedDate,
}: {
  id?: number
  shortName?: string
  title?: string
  count?: number
  /** набор анимированных эмодзи — ФЛАГ, а не строка вида */
  emojis?: boolean
  thumbDocumentId?: number
  installedDate?: number
} = {}) {
  return {
    _: 'stickerSet' as const,
    id,
    short_name: shortName,
    title,
    count,
    ...(emojis ? { pFlags: { emojis: true as const } } : {}),
    ...(thumbDocumentId !== undefined ? { thumb_document_id: thumbDocumentId } : {}),
    ...(installedDate !== undefined ? { installed_date: installedDate } : {}),
  }
}
