// Порт tweb `src/environment/videoMimeTypesSupport.ts` (812502980) — mime-типы видео,
// которые браузер проигрывает (фильтр выбора файла «Фото или видео», `ChatInput.onAttachClick`).
//
// Расхождение: пробы `IS_MOV_SUPPORTED` (`environment/videoSupport.ts`) у нас нет —
// `video/quicktime` в набор не добавляется; выбрать `.mov` всё равно можно, его
// `onAttachClick` кладёт в `accept` отдельно, как у оригинала.
export type VIDEO_MIME_TYPE = 'image/gif' | 'video/mp4' | 'video/webm' | 'video/quicktime'
const VIDEO_MIME_TYPES_SUPPORTED: Set<VIDEO_MIME_TYPE> = new Set([
  'image/gif', // have to display it as video
  'video/mp4',
  'video/webm',
])

export default VIDEO_MIME_TYPES_SUPPORTED
