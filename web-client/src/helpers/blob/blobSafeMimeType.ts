// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

// https://www.iana.org/assignments/media-types/media-types.xhtml
export default function blobSafeMimeType(mimeType: string) {
  if([
    'image/jpeg',
    'image/png',
    'image/gif',
    // 'image/svg+xml' убран (расхождение с tweb, SEC-5): SVG-blob, открытый
    // top-level/во фрейме, исполняет скрипты в origin приложения. Стикеры/медиа
    // рендерятся только в <img>/<video>, где SVG безопасен, а этот allow-list
    // ныне не имеет потребителей — не возвращаем исполняемый тип.
    'image/webp',
    'image/bmp',
    'image/avif',
    'image/jxl',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav', // though it is not in list
    'application/json',
    'application/pdf'
  ].indexOf(mimeType) === -1) {
    return 'application/octet-stream';
  }

  return mimeType;
}