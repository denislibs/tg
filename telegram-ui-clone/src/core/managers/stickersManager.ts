// src/core/managers/stickersManager.ts
// Тонкие REST-обёртки над бэкенд-эндпоинтами стикеров (/sticker-sets, /stickers).
// Файл стикера лежит в media: mime 'application/json' — lottie-json,
// image/webp|png — статичный; URL клиент строит сам (core/mediaUrl).
import type { RestClient } from '../net/restClient'

export interface StickerSet { id: number; slug: string; title: string; kind: 'sticker' | 'emoji'; count: number }
export interface Sticker { id: number; setId: number; mediaId: number; emoji: string }

interface RawSticker { id: number; set_id: number; media_id: number; emoji: string }

const mapSticker = (r: RawSticker): Sticker => ({ id: r.id, setId: r.set_id, mediaId: r.media_id, emoji: r.emoji })

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
  }
}
export type StickersManager = ReturnType<typeof newStickersManager>
