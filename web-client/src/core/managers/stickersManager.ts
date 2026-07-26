// src/core/managers/stickersManager.ts
// Тонкие REST-обёртки над бэкенд-эндпоинтами стикеров и GIF (/sticker-sets,
// /stickers, /gifs — домен общий, tweb тоже держит их в одной панели).
// Файл стикера лежит в media: mime 'application/json' — lottie-json,
// image/webp|png — статичный; URL клиент строит сам (core/mediaUrl).
import type { RestClient } from '../net/restClient'

export interface StickerSet { id: number; slug: string; title: string; kind: 'sticker' | 'emoji'; count: number }
export interface Sticker { id: number; setId: number; mediaId: number; emoji: string }
/** Сохранённый GIF — media нашего сервера (лимит 200 LIFO на бэке). */
export interface SavedGif { mediaId: number }
/** Результат внешнего поиска (Tenor-прокси /gifs/search). */
export interface TenorGif { id: string; mp4Url: string; gifUrl: string; previewUrl: string; width: number; height: number }
export interface GifPage { gifs: TenorGif[]; next: string }

interface RawSticker { id: number; set_id: number; media_id: number; emoji: string }
interface RawTenorGif { id: string; mp4_url: string; gif_url: string; preview_url: string; width: number; height: number }

const mapSticker = (r: RawSticker): Sticker => ({ id: r.id, setId: r.set_id, mediaId: r.media_id, emoji: r.emoji })
const mapTenorGif = (r: RawTenorGif): TenorGif => ({
  id: r.id, mp4Url: r.mp4_url, gifUrl: r.gif_url, previewUrl: r.preview_url, width: r.width, height: r.height,
})

export function newStickersManager({ rest }: { rest: Pick<RestClient, 'get' | 'post' | 'del'> }) {
  return {
    async mySets(): Promise<StickerSet[]> {
      const r = await rest.get<{ sets: StickerSet[] }>('/sticker-sets')
      return r.sets ?? []
    },
    async setBySlug(slug: string): Promise<{ set: StickerSet; stickers: Sticker[] }> {
      const r = await rest.get<{ set: StickerSet; stickers: RawSticker[] }>(`/sticker-sets/${encodeURIComponent(slug)}`)
      return { set: r.set, stickers: (r.stickers ?? []).map(mapSticker) }
    },
    async searchSets(q: string): Promise<StickerSet[]> {
      const r = await rest.get<{ sets: StickerSet[] }>('/sticker-sets/search', { q })
      return r.sets ?? []
    },
    async install(setId: number): Promise<void> { await rest.post(`/sticker-sets/${setId}/install`, {}) },
    async uninstall(setId: number): Promise<void> { await rest.del(`/sticker-sets/${setId}/install`) },
    async recent(): Promise<Sticker[]> {
      const r = await rest.get<{ stickers: RawSticker[] }>('/stickers/recent')
      return (r.stickers ?? []).map(mapSticker)
    },
    async faved(): Promise<Sticker[]> {
      const r = await rest.get<{ stickers: RawSticker[] }>('/stickers/faved')
      return (r.stickers ?? []).map(mapSticker)
    },
    async fave(stickerId: number): Promise<void> { await rest.post(`/stickers/${stickerId}/fave`, {}) },
    async unfave(stickerId: number): Promise<void> { await rest.del(`/stickers/${stickerId}/fave`) },
    async use(stickerId: number): Promise<void> { await rest.post(`/stickers/${stickerId}/use`, {}) },
    async searchByEmoji(emoji: string): Promise<Sticker[]> {
      const r = await rest.get<{ stickers: RawSticker[] }>('/stickers/search', { emoji })
      return (r.stickers ?? []).map(mapSticker)
    },

    // ── GIF ──
    async savedGifs(): Promise<SavedGif[]> {
      const r = await rest.get<{ gifs: { media_id: number }[] }>('/gifs/saved')
      return (r.gifs ?? []).map((g) => ({ mediaId: g.media_id }))
    },
    async saveGif(mediaId: number): Promise<void> { await rest.post('/gifs/saved', { media_id: mediaId }) },
    async deleteGif(mediaId: number): Promise<void> { await rest.del(`/gifs/saved/${mediaId}`) },
    /** Пустой q — трендовые; pos — курсор следующей страницы. Без TENOR_API_KEY бэк отдаёт пустую страницу. */
    async searchGifs(q: string, pos = ''): Promise<GifPage> {
      const r = await rest.get<{ gifs: RawTenorGif[]; next: string }>('/gifs/search', { q, pos })
      return { gifs: (r.gifs ?? []).map(mapTenorGif), next: r.next ?? '' }
    },
  }
}
export type StickersManager = ReturnType<typeof newStickersManager>
