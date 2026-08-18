// src/core/gifs.ts
// Модель элемента вкладки GIF (сохранённый с нашего сервера или результат
// Tenor-поиска).
//
// Критерия «гифоподобного» медиа (`isGifLike`) здесь больше нет: он гадал по
// mime/имени файла/нулевой длительности ровно потому, что у сообщения не было
// документа с атрибутами. Теперь ответ даёт сам документ — `doc.type === 'gif'`,
// выведенный `saveDocument` из `documentAttributeAnimated` и mime (порт
// `appDocsManager.saveDoc`), и спрашивают его так же, как tweb.
import type { TenorGif } from './managers/stickersManager'

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

/** Tenor-результат → элемент кладки (общее для дропдауна и правой колонки). */
export const tenorToItem = (g: TenorGif): GifItem => ({
  key: `t-${g.id}`,
  width: g.width,
  height: g.height,
  mp4Url: g.mp4Url,
  previewUrl: g.previewUrl,
})
