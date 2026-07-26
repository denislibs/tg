// src/core/gifs.ts
// Общая GIF-логика вью-слоя: критерий «гифоподобного» медиа и модель элемента
// вкладки GIF (сохранённый с нашего сервера или результат Tenor-поиска).

/**
 * Элемент вкладки GIF. Ровно один источник:
 *  - сохранённый: mediaId + мета нашего сервера (mime решает <video>/<img>);
 *  - Tenor: mp4Url (+previewUrl) — воспроизводится напрямую с CDN до отправки.
 */
export interface GifItem {
  key: string
  width: number
  height: number
  /** сохранённый GIF — media нашего сервера */
  mediaId?: number
  mime?: string
  size?: number
  fileName?: string
  /** Tenor-результат */
  mp4Url?: string
  previewUrl?: string
}

/**
 * «Гифоподобное» медиа рендерится автоплей-циклом без play-диска (tweb GIF):
 * настоящий image/gif либо mp4-гифка — по маркерам имени файла (tenor/giphy/
 * .gif.mp4). duration===0 учитывается ТОЛЬКО у безымянных mp4: бэк длительность
 * видео сам не считает (клиент шлёт её лишь для голосовых), поэтому у обычных
 * видео из пикера duration тоже 0 — но у них всегда есть имя файла.
 */
export function isGifLike(a: { mime?: string; fileName?: string; duration?: number }): boolean {
  if (a.mime === 'image/gif') return true
  if (a.mime !== 'video/mp4') return false
  const fn = (a.fileName ?? '').toLowerCase()
  if (fn.includes('tenor') || fn.includes('giphy') || fn.endsWith('.gif.mp4')) return true
  return fn === '' && a.duration === 0
}
