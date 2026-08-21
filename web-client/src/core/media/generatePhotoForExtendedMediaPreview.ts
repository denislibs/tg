// Порт tweb `src/lib/appManagers/utils/photos/generatePhotoForExtendedMediaPreview.ts`.
//
// Платное медиа ДО оплаты приезжает не медиа, а превью
// (`messageExtendedMediaPreview`: размеры и stripped-байты вместо файла).
// Показать его нечем — врапперы умеют работать только с медиа, — поэтому
// оригинал собирает из превью ПСЕВДО-ФОТО: `id: 0` и единственный размер
// `photoStrippedSize`. Дальше оно идёт в `wrapPhoto`/`wrapAlbum` как обычное
// фото, а «единственный размер — stripped» и есть тот случай, ради которого у
// `wrapPhoto` существует ранний выход (photo.ts:208): качать нечего, превью
// показывается КАК медиа.
//
// ── Отступления от оригинала ────────────────────────────────────────────────
//  • `access_hash`/`dc_id`/`file_reference`/`date` отпадают вместе с
//    транспортом — это реквизиты MTProto-ссылки на файл, которого у
//    неоплаченного медиа и нет;
//  • `video_duration` превью наш бэкенд не производит (длительность — уже
//    сведение о содержимом неоплаченного медиа, его стирает тот же
//    `stripLockedMedia`, что стирает mime), поэтому бейдж таймкода из превью
//    не строится.
import {
  THUMB_TYPE_STRIPPED,
  type MessageExtendedMediaPreview,
  type MyPhoto,
  type PhotoStrippedSize,
} from '@core/media/messageMedia'

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

/**
 * Размеры дописываются В САМУ stripped-ступень (оригинал: `thumb.w = media.w;
 * thumb.h = media.h`) — не для красоты: только так `choosePhotoSize` перестаёт
 * её пропускать (её гвард — `'w' in size`) и возвращает именно её, а
 * `wrapPhoto` по её байтам уходит в ранний выход photo.ts:208. Схема
 * `photoStrippedSize` этих полей не знает — у оригинала они тоже дописаны
 * поверх конструктора, на провод не идут.
 */
type StrippedSizeWithDimensions = PhotoStrippedSize & { w?: number, h?: number }

export default function generatePhotoForExtendedMediaPreview(
  preview: MessageExtendedMediaPreview,
): MyPhoto {
  const thumb: StrippedSizeWithDimensions = {
    _: 'photoStrippedSize',
    type: THUMB_TYPE_STRIPPED,
    bytes: preview.thumb?._ === 'photoStrippedSize' ? preview.thumb.bytes : EMPTY_STRIPPED_THUMB,
    w: preview.w,
    h: preview.h,
  }

  return { _: 'photo', id: 0, sizes: [thumb] }
}
