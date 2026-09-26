// Порт tweb `src/environment/imageMimeTypesSupport.ts:1-12` (812502980) —
// набор mime-типов картинок, которые браузер точно декодирует. Первый
// потребитель у нас — `helpers/copyMediaToClipboard.ts` (коммит 508acd4f5):
// документ-картинка копируется в буфер, только если её mime в этом наборе.
//
// НЕ портирована вторая половина файла (`:14-33`): асинхронные пробы
// `image/jxl`/`image/heic`/`image/avif` и `IMAGE_MIME_TYPES_SUPPORTED_PROMISE`,
// результаты которых tweb досыпает в набор из `src/index.ts:79-83`. Их предмет
// — приём таких файлов как фото при отправке, а не копирование; без точки
// досыпания (`index.ts`) промис был бы мёртвым кодом. Набор у нас поэтому
// ровно базовый — тот же, каким он у оригинала бывает до разрешения проб.
import IS_WEBP_SUPPORTED from '@environment/webpSupport'

const IMAGE_MIME_TYPES_SUPPORTED = new Set([
  'image/jpeg',
  'image/png',
  'image/bmp',
])

if (IS_WEBP_SUPPORTED) {
  IMAGE_MIME_TYPES_SUPPORTED.add('image/webp')
}

export default IMAGE_MIME_TYPES_SUPPORTED
