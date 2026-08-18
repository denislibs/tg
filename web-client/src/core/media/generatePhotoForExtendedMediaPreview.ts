// Порт tweb `src/lib/appManagers/utils/photos/generatePhotoForExtendedMediaPreview.ts`.
//
// Платное медиа ДО оплаты приезжает не медиа, а превью
// (`messageExtendedMediaPreview`: размеры, длительность видео и stripped-байты
// вместо файла). Показать его нечем — врапперы умеют работать только с медиа,
// — поэтому оригинал собирает из превью ПСЕВДО-ФОТО: `id: 0` и единственный
// размер `photoStrippedSize`. Дальше оно идёт в `wrapPhoto`/`wrapAlbum` как
// обычное фото, а «единственный размер — stripped» и есть тот случай, ради
// которого у `wrapPhoto` существует ранний выход (photo.ts:208, у нас —
// `strippedSize`): качать нечего, превью показывается КАК медиа.
//
// ── Отступления от оригинала ────────────────────────────────────────────────
//  • на выходе — плоский вход наших врапперов (`mediaId`/`width`/`height`/
//    `strippedThumb`) вместо MTProto `Photo.photo` с `sizes[]`: лестницы
//    `PhotoSize` у нас нет, поэтому «фото с одним stripped-размером»
//    записывается парой полей. `access_hash`/`dc_id`/`file_reference`/`date`
//    отпадают вместе с транспортом — это реквизиты MTProto-ссылки на файл,
//    которого у неоплаченного медиа и нет;
//  • `thumb.w = media.w; thumb.h = media.h` (оригинал дописывает размеры в сам
//    stripped-размер, потому что дальше по коду геометрию читают из него) — у
//    нас размеры и так лежат отдельными полями сообщения.
import type { Message } from '@core/models'

/**
 * Заглушка на случай, когда превью не пришло вовсе. Оригинал держит здесь
 * 20 stripped-байт (`[1, 24, 30, 197, 162, 138, 40, 0, …]`), из которых
 * `getPreviewURLFromBytes` собирает серую JPEG-заплатку 30×24; наш
 * stripped-канал отдаёт превью уже готовым base64-JPEG (см. шапку
 * `core/media/getStrippedThumbIfNeeded.ts`), поэтому те же байты записаны
 * результатом этой сборки — тот же самый кадр, без промежуточного формата.
 */
const EMPTY_STRIPPED_THUMB =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDACgcHiMeGSgjISMtKygwPGRBPDc3PHtYXUlkkYCZlo+AjIqgtObDoKrarYqMyP/L2u71' +
  '////m8H////6/+b9//j/2wBDASstLTw1PHZBQXb4pYyl+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4' +
  '+Pj4+Pj/wAARCAAYAB4DASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
  'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
  '5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEE' +
  'BSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hp' +
  'anN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP0' +
  '9fb3+Pn6/9oADAMBAAIRAxEAPwDFooooAKKKKACiiigAooooA//Z'

/** Псевдо-фото из превью — плоский вход `wrapPhoto`. */
export interface ExtendedMediaPreviewPhoto {
  /** tweb `id: 0` — файла на сервере нет, скачивать нечего */
  mediaId: number
  width?: number
  height?: number
  strippedThumb: string
}

export default function generatePhotoForExtendedMediaPreview(
  message: Pick<Message, 'mediaWidth' | 'mediaHeight' | 'mediaBlur'>,
): ExtendedMediaPreviewPhoto {
  return {
    mediaId: 0,
    width: message.mediaWidth,
    height: message.mediaHeight,
    strippedThumb: message.mediaBlur || EMPTY_STRIPPED_THUMB,
  }
}
