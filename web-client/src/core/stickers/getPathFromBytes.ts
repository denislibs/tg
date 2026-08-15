// Порт tweb `src/helpers/bytes/getPathFromBytes.ts` (1:1, включая lookup-таблицу
// и разбор байт-в-байт) — формат векторного контура Telegram (photoPathSize,
// https://core.telegram.org/api/files#vector-thumbnails). Алгоритм не
// переписывать и не «улучшать»: символы и границы диапазонов заданы протоколом.
//
// Байт кодирует либо букву команды/координаты из lookup-таблицы (старшие 2 бита
// установлены — num >= 192), либо цифру 0-63 с разделителем перед ней: запятая
// у чисел 128-191, минус у чисел 64-127, без разделителя у чисел 0-63.
export default function getPathFromBytes(bytes: Uint8Array): string {
  const lookup = 'AACAAAAHAAALMAAAQASTAVAAAZaacaaaahaaalmaaaqastava.az0123456789-,'

  let path = 'M'
  for (let i = 0, length = bytes.length; i < length; ++i) {
    const num = bytes[i]

    if (num >= 128 + 64) {
      path += lookup[num - 128 - 64]
    } else {
      if (num >= 128) {
        path += ','
      } else if (num >= 64) {
        path += '-'
      }
      path += '' + (num & 63)
    }
  }
  path += 'z'

  return path
}

/**
 * SVG-силуэт из контура (tweb `createSvgFromBytes`, там же). Строится через
 * `createElementNS`, не строкой markup — так же, как остальной императивный DOM
 * этого приложения (`stickerAppearance`), и без риска инъекции через `d`.
 */
export function createSvgFromBytes(
  bytes: Uint8Array,
  width = 512,
  height = 512,
): { svg: SVGSVGElement; path: SVGPathElement } {
  const d = getPathFromBytes(bytes)
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg') as SVGSVGElement
  svg.setAttributeNS(null, 'viewBox', `0 0 ${width} ${height}`)

  const path = document.createElementNS(ns, 'path') as SVGPathElement
  path.setAttributeNS(null, 'd', d)
  svg.append(path)

  return { svg, path }
}

/**
 * То же самое, но контур приезжает не Uint8Array, а base64-строкой — так наш
 * бэк отдаёт `path_thumb` в JSON (tweb работает поверх бинарного MTProto,
 * `photoPathSize.bytes` там сразу Uint8Array; у нас транспорт другой, поэтому
 * шаг декодирования appended сверху, а не часть портируемого алгоритма).
 */
export function createSvgFromBase64(base64: string, width = 512, height = 512) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return createSvgFromBytes(bytes, width, height)
}
