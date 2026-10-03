// Порт tweb `src/environment/mimeTypeMap.ts` (812502980) в объёме потребителя —
// `helpers/files/getFileMimeType.ts`: прямая карта расширений и синонимы.
// Обратная карта (`MIME_TYPE_EXTENSION_MAP`) приедет со своим потребителем.
// Типы `MTFileExtension`/`MTMimeType` (схема MTProto) у нас — строки.

export const EXTENSION_MIME_TYPE_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  tgv: 'application/x-tgwallpattern',
  tgs: 'application/x-tgsticker',
  json: 'application/json',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  jxl: 'image/jxl',
  bmp: 'image/bmp',
  // * heic last so that the reverse map prefers it over the heif spelling
  heif: 'image/heic',
  heic: 'image/heic',
}

export const MIME_TYPE_ALIASES: Record<string, string> = {
  'video/x-quicktime': 'video/quicktime',
  // * same container and decoder, only a different brand in the header
  'image/heif': 'image/heic',
}
