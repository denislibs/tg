// src/core/animatedEmoji.ts
// Мини-API анимированных эмодзи (tweb appStickersManager.getAnimatedEmojiSticker):
// сид-набор kind='emoji' со slug 'animated_emoji' грузится ОДИН раз на сессию и
// мапится emoji → ДОКУМЕНТ лотти-стикера. Ходим через ручку набора,
// а не /stickers/search: поиск ищет только по УСТАНОВЛЕННЫМ наборам юзера, а
// big-emoji в чате должен анимироваться у всех без установки набора.
import type { Sticker } from './managers/stickersManager'

export const ANIMATED_EMOJI_SLUG = 'animated_emoji'

// tweb (richTextProcessor/fixEmoji.ts: cleanEmoji — её и зовёт
// appStickersManager.getAnimatedEmojiSticker перед сравнением с alt набора):
// вариационный селектор U+FE0F игнорируется — '❤️' (с FE0F) и '❤' это один
// и тот же глиф; так же игнорируются модификаторы тона кожи (🏻🏼🏽🏾🏿,
// U+1F3FB–U+1F3FF) — '👍🏽' должен матчиться на ту же анимацию, что и '👍'
// (в сид-наборе лежит эмодзи без тона кожи, набор один на всех).
export function normalizeEmoji(emoji: string): string {
  return emoji.replace(/\uFE0F/g, '').replace(/🏻|🏼|🏽|🏾|🏿/g, '').trim()
}

/**
 * Чистое построение кэша: нормализованный эмодзи → ДОКУМЕНТ (первый выигрывает).
 *
 * Документ целиком, а не его номер: рендерер стикера читает с него ступени
 * превью и натуральные размеры сам (порт wrapSticker), и голый id заставил бы
 * его рисовать без нижнего слоя.
 */
export function buildEmojiMap(stickers: Sticker[]): Map<string, Sticker> {
  const map = new Map<string, Sticker>()
  for (const st of stickers) {
    const key = normalizeEmoji(st.stickerEmojiRaw ?? '')
    if (key && !map.has(key)) map.set(key, st)
  }
  return map
}

let mapPromise: Promise<Map<string, Sticker>> | null = null
let mapSync: Map<string, Sticker> | null = null

function load(): Promise<Map<string, Sticker>> {
  if (!mapPromise) {
    mapPromise = (async () => {
      let map = new Map<string, Sticker>()
      try {
        // Динамический импорт: не тянуть bootstrap (worker, rpc) в граф модуля —
        // чистые normalizeEmoji/buildEmojiMap импортируются без сайд-эффектов.
        const { startClient } = await import('../client/bootstrap')
        const { stickers } = await startClient().managers.stickers.getStickerSet({ shortName: ANIMATED_EMOJI_SLUG })
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

/** Документ лотти-стикера для эмодзи или null; первое обращение грузит набор. */
export async function getAnimatedEmoji(emoji: string): Promise<Sticker | null> {
  const map = await load()
  return map.get(normalizeEmoji(emoji)) ?? null
}

/** Синхронный кэш: null и пока набор не загружен, и если эмодзи в нём нет. */
export function peekAnimatedEmoji(emoji: string): Sticker | null {
  return mapSync?.get(normalizeEmoji(emoji)) ?? null
}
