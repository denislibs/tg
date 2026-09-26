// Порт tweb `src/environment/webpSupport.ts` (812502980) — 1:1. Нужен
// `imageMimeTypesSupport.ts`: `image/webp` входит в набор декодируемых
// картинок, только если браузер умеет её кодировать канвасом.
const IS_WEBP_SUPPORTED = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')

export default IS_WEBP_SUPPORTED
