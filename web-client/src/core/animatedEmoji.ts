// src/core/animatedEmoji.ts
// Мини-API анимированных эмодзи (tweb appStickersManager.getAnimatedEmojiSticker):
// сид-набор kind='emoji' со slug 'animated_emoji' грузится ОДИН раз на сессию и
// мапится emoji → mediaId лотти-стикера. Ходим через GET /sticker-sets/{slug},
// а не /stickers/search: поиск ищет только по УСТАНОВЛЕННЫМ наборам юзера, а
// big-emoji в чате должен анимироваться у всех без установки набора.
import type { Sticker } from './managers/stickersManager'

export const ANIMATED_EMOJI_SLUG = 'animated_emoji'

// tweb (emoji: fixEmoji): при сравнении эмодзи вариационный селектор U+FE0F
// игнорируется — '❤️' (с FE0F) и '❤' это один и тот же глиф.
export function normalizeEmoji(emoji: string): string {
  return emoji.replace(/\uFE0F/g, '').trim()
}

/** Чистое построение кэша: нормализованный эмодзи → mediaId (первый выигрывает). */
export function buildEmojiMap(stickers: Pick<Sticker, 'emoji' | 'mediaId'>[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const st of stickers) {
    const key = normalizeEmoji(st.emoji)
    if (key && !map.has(key)) map.set(key, st.mediaId)
  }
  return map
}

let mapPromise: Promise<Map<string, number>> | null = null
let mapSync: Map<string, number> | null = null

function load(): Promise<Map<string, number>> {
  if (!mapPromise) {
    mapPromise = (async () => {
      let map = new Map<string, number>()
      try {
        // Динамический импорт: не тянуть bootstrap (worker, rpc) в граф модуля —
        // чистые normalizeEmoji/buildEmojiMap импортируются без сайд-эффектов.
        const { startClient } = await import('../client/bootstrap')
        const { stickers } = await startClient().managers.stickers.setBySlug(ANIMATED_EMOJI_SLUG)
        map = buildEmojiMap(stickers)
      } catch {
        // Набора может не быть (сид не накатан) — живём без анимированных
        // эмодзи; пустой результат кэшируется, чтобы не долбить бэк на каждый бабл.
      }
      mapSync = map
      return map
    })()
  }
  return mapPromise
}

/** mediaId лотти-стикера для эмодзи или null; первое обращение грузит набор. */
export async function getAnimatedEmoji(emoji: string): Promise<{ mediaId: number } | null> {
  const map = await load()
  const mediaId = map.get(normalizeEmoji(emoji))
  return mediaId != null ? { mediaId } : null
}

/** Синхронный кэш: null и пока набор не загружен, и если эмодзи в нём нет. */
export function peekAnimatedEmoji(emoji: string): { mediaId: number } | null {
  const mediaId = mapSync?.get(normalizeEmoji(emoji))
  return mediaId != null ? { mediaId } : null
}
