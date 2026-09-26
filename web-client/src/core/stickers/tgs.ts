// Lottie приезжает в двух видах: несжатым json (наши сид-наборы времён ручной
// сборки) и .tgs — тем же json под gzip, как его отдаёт Telegram (mime
// application/x-tgsticker, tweb environment/mimeTypeMap.ts). Движку tlottie
// нужен разобранный объект, поэтому gzip снимаем здесь — нативным
// DecompressionStream, как в lottieLoader для assets/tgs; размер распакованного
// ограничен (`gzipUncompress`, порт лимита tweb f3733adc2).
export const TGS_MIME = 'application/x-tgsticker'

export function isLottieMime(contentType: string): boolean {
  return contentType.includes('application/json') || contentType.includes(TGS_MIME)
}

// tweb `apiFileManager.ts:91` (введён в f3733adc2 как 1 МиБ, поднят до 8 МиБ в
// 9b5b04bda «raise TGS_MAX_DECOMPRESSED_SIZE 1MB -> 8MB for large stickers»).
export const TGS_MAX_DECOMPRESSED_SIZE = 8 * 1024 * 1024

/**
 * Порт tweb `helpers/gzipUncompress.ts` с `maxSize` (f3733adc2, «cap decompressed
 * size to guard against gzip bombs»). .tgs приходит из чужого сообщения, и без
 * лимита несколько килобайт gzip разворачиваются в гигабайты.
 *
 * Отличие по средству, не по смыслу: у tweb распаковка — `fflate.Decompress` в
 * crypto-воркере, у нас — нативный `DecompressionStream` (шапка файла), поэтому
 * лимит считается по чанкам потока, а поток гасится, как только сумма перевалила
 * за `maxSize`, — дальше бомба не разворачивается.
 */
export async function gzipUncompress(body: ReadableStream<BufferSource>, maxSize: number): Promise<Uint8Array> {
  const reader = body.pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxSize) {
      reader.cancel().catch(() => {})
      throw new Error('GZIP_MAX_SIZE_EXCEEDED')
    }
    chunks.push(value)
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

export async function readLottie(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes(TGS_MIME)) return res.json()
  const unpacked = await gzipUncompress(res.body!, TGS_MAX_DECOMPRESSED_SIZE)
  return JSON.parse(new TextDecoder().decode(unpacked))
}
