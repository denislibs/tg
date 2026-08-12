// src/core/secret/mediaCache.ts
//
// Общий кэш расшифрованных медиа секретного чата (E2E). Сервер хранит только
// ciphertext (media_id) — байты надо скачать, расшифровать ключом файла и отдать
// blob-objectURL с верным mime. Кэшируем по mediaId, чтобы бабл и лайтбокс делили
// один blob-URL (без повторной сети и без гонок revoke). URL живёт до перезагрузки
// страницы — как secretUrlCache для аудио.
// mediaContentUrl здесь — БАЙТЫ шифртекста (E2E): расшифровка возможна только на
// вкладке (ключи чата живут в её сторе), воркерный конвейер downloadMediaURL
// (Task 7) отдал бы <img> нечитаемый ciphertext — сознательно не переводим.
import { decryptMedia } from './crypto'
import { mediaContentUrl, primeMediaToken } from '../mediaUrl'

const cache = new Map<number, string>()
const inflight = new Map<number, Promise<string>>()

/** Скачать ciphertext, расшифровать → blob-URL с верным mime; кэшируется по mediaId. */
export function getSecretMediaUrl(mediaId: number, keyB64: string, ivB64: string, mime: string): Promise<string> {
  const cached = cache.get(mediaId)
  if (cached) return Promise.resolve(cached)
  const running = inflight.get(mediaId)
  if (running) return running
  const job = (async () => {
    await primeMediaToken() // media-токен primed → синхронный URL с токеном
    const res = await fetch(mediaContentUrl(mediaId))
    if (!res.ok) throw new Error(`secret media ${res.status}`)
    const cipher = await res.arrayBuffer()
    const buf = await decryptMedia(cipher, keyB64, ivB64)
    const url = URL.createObjectURL(new Blob([buf], { type: mime }))
    cache.set(mediaId, url)
    return url
  })()
  inflight.set(mediaId, job)
  void job.catch(() => {}).finally(() => inflight.delete(mediaId))
  return job
}

/** Готовый blob-URL из кэша (без запуска расшифровки) — для синхронного морфа лайтбокса. */
export const peekSecretMediaUrl = (mediaId: number): string | undefined => cache.get(mediaId)
