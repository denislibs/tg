// Порт tweb `src/helpers/canvas/canvasToBlob.ts:1-11` (812502980, коммит
// 508acd4f5) — 1:1. `canvas.toBlob` в промисе, который ОТКЛОНЯЕТСЯ, если
// кодирование не удалось (колбэк получил `null`), — а не разрешается пустотой.
//
// Внутри 508acd4f5 оригинал перевёл на этот хелпер ещё `scaleMediaElement` и
// `videoToImage`; у нас обоих файлов нет (их потребители — отправка медиа и
// кадр видео — живут иначе: `core/media/scaleImageForSend.ts`), поэтому
// первый и пока единственный потребитель — `helpers/copyMediaToClipboard.ts`.
export default function canvasToBlob(canvas: HTMLCanvasElement, type?: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Failed to encode canvas'))
      }
    }, type, quality)
  })
}
