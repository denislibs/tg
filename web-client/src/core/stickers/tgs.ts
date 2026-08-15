// Lottie приезжает в двух видах: несжатым json (наши сид-наборы времён ручной
// сборки) и .tgs — тем же json под gzip, как его отдаёт Telegram (mime
// application/x-tgsticker, tweb environment/mimeTypeMap.ts). Движку tlottie
// нужен разобранный объект, поэтому gzip снимаем здесь — нативным
// DecompressionStream, как в lottieLoader для assets/tgs.
export const TGS_MIME = 'application/x-tgsticker'

export function isLottieMime(contentType: string): boolean {
  return contentType.includes('application/json') || contentType.includes(TGS_MIME)
}

export async function readLottie(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes(TGS_MIME)) return res.json()
  const unpacked = new Response(res.body!.pipeThrough(new DecompressionStream('gzip')))
  return unpacked.json()
}
