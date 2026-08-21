// src/core/managers/stickersManager.ts
// Тонкие REST-обёртки над бэкенд-эндпоинтами стикеров и GIF (/sticker-sets,
// /stickers, /gifs — домен общий, tweb тоже держит их в одной панели).
// Файл стикера лежит в media: mime 'application/json' — несжатый lottie-json,
// 'application/x-tgsticker' — он же под gzip (.tgs, так отдаёт Telegram — им
// залиты все выгруженные наборы; разбор — core/stickers/tgs), 'video/webm' —
// видео-стикер, image/webp|png — статичный. URL клиент строит сам (core/mediaUrl).
import type { RestClient } from '../net/restClient'

/**
 * coverMediaId — обложка набора (не у всех: из 334 наборов есть у 230,
 * `omitempty` на бэке). Когда её нет, вкладка панели показывает первый
 * стикер набора — правило кодирует `core/stickers/setThumb.ts`.
 */
export interface StickerSet { id: number; slug: string; title: string; kind: 'sticker' | 'emoji'; count: number; coverMediaId?: number }
/**
 * Метаданные файла (width/height/mime/thumb) приезжают вместе со стикером —
 * бэк снимает их джойном на media. Клиенту они нужны ДО загрузки байтов:
 * по размерам он вписывает стикер в бокс по пропорции (tweb
 * `makeMediaSize(doc.w, doc.h).aspectFitted`), по mime заранее знает рендерер,
 * а thumb (base64 JPEG, как `blur_preview` у медиа) показывает нижним слоем,
 * пока файл летит. Нули/пустые значения — «метаданных нет» (медиа загружено до
 * появления процессинга): бокс тогда квадратный, нижнего слоя нет.
 *
 * pathThumb — векторный контур (Telegram photoPathSize, base64) для ещё более
 * раннего нижнего слоя — SVG-силуэта (см. `core/stickers/getPathFromBytes`,
 * `components/StickerMedia.tsx`). undefined — контур не выгружен для этого
 * стикера (у части импортированных документов его не было).
 */
export interface Sticker {
  id: number
  setId: number
  mediaId: number
  emoji: string
  width: number
  height: number
  mime: string
  thumb: string
  pathThumb?: string
}
/**
 * Адрес набора — наша форма схемного объединения `InputStickerSet`
 * (`inputStickerSetShortName` | `inputStickerSetID`). Дискриминатор здесь —
 * присутствие ключа, а не `_`: конструкторами это станет на фазе 3, когда
 * адрес поедет в теле, а не в пути маршрута.
 */
export type InputStickerSetAddress = { shortName: string } | { id: number }

/** Сохранённый GIF — media нашего сервера (лимит 200 LIFO на бэке). */
export interface SavedGif { mediaId: number }
/** Результат внешнего поиска (Tenor-прокси /gifs/search). */
export interface TenorGif { id: string; mp4Url: string; gifUrl: string; previewUrl: string; width: number; height: number }
export interface GifPage { gifs: TenorGif[]; next: string }

interface RawStickerSet {
  id: number
  slug: string
  title: string
  kind: 'sticker' | 'emoji'
  count: number
  /** обложка набора; отсутствует в ответе (omitempty) у наборов без обложки */
  cover_media_id?: number
}
interface RawSticker {
  id: number
  set_id: number
  media_id: number
  emoji: string
  width?: number
  height?: number
  mime?: string
  /** base64 JPEG stripped-превью; null у медиа без сгенерированного превью */
  thumb?: string | null
  /** base64 векторного контура (photoPathSize); null — контур не выгружен */
  path_thumb?: string | null
}
interface RawTenorGif { id: string; mp4_url: string; gif_url: string; preview_url: string; width: number; height: number }

const mapStickerSet = (r: RawStickerSet): StickerSet => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  kind: r.kind,
  count: r.count,
  coverMediaId: r.cover_media_id,
})
const mapSticker = (r: RawSticker): Sticker => ({
  id: r.id,
  setId: r.set_id,
  mediaId: r.media_id,
  emoji: r.emoji,
  width: r.width ?? 0,
  height: r.height ?? 0,
  mime: r.mime ?? '',
  thumb: r.thumb ?? '',
  pathThumb: r.path_thumb ?? undefined,
})
const mapTenorGif = (r: RawTenorGif): TenorGif => ({
  id: r.id, mp4Url: r.mp4_url, gifUrl: r.gif_url, previewUrl: r.preview_url, width: r.width, height: r.height,
})
/** Ключ набора → его первые стикеры (covered sets, см. StickerSet.coverMediaId
 * докблок). Бэк отдаёт карту JSON-объектом (ключи — строки set_id), клиенту
 * удобнее Map<number, Sticker[]> — быстрый lookup по StickerSet.id при рендере
 * строки набора (StickersSearchTab), без парсинга строки на каждый чих. */
export type Covers = Map<number, Sticker[]>
const mapCovers = (raw: Record<string, RawSticker[]> | undefined): Covers => {
  const out = new Map<number, Sticker[]>()
  for (const [setId, sts] of Object.entries(raw ?? {})) out.set(Number(setId), (sts ?? []).map(mapSticker))
  return out
}

export function newStickersManager({ rest }: { rest: Pick<RestClient, 'get' | 'post' | 'del'> }) {
  return {
    async mySets(): Promise<StickerSet[]> {
      const r = await rest.get<{ sets: RawStickerSet[] }>('/sticker-sets')
      return (r.sets ?? []).map(mapStickerSet)
    },
    /**
     * Набор со стикерами по АДРЕСУ — порт `messages.getStickerSet(stickerset:
     * InputStickerSet)`. Адрес это объединение: короткое имя набора либо его
     * число; у REST каждому конструктору отвечает свой маршрут, на фазе 3 они
     * схлопнутся в один метод с объединением в теле.
     *
     * Обратного поиска «набор по файлу» здесь больше нет и быть не должно:
     * набор приезжает В САМОМ документе (`doc.stickerSetInput`, порт
     * `saveDocument`), как у оригинала, где такого метода не существует вовсе.
     */
    async getStickerSet(input: InputStickerSetAddress): Promise<{ set: StickerSet; stickers: Sticker[] }> {
      const path = 'shortName' in input
        ? `/sticker-sets/${encodeURIComponent(input.shortName)}`
        : `/sticker-sets/id/${input.id}`
      const r = await rest.get<{ set: RawStickerSet; stickers: RawSticker[] }>(path)
      return { set: mapStickerSet(r.set), stickers: (r.stickers ?? []).map(mapSticker) }
    },
    /** covers — первые 5 стикеров каждого набора выдачи (одним запросом,
     * без похода за полным составом на каждую строку) — экран поиска рисует
     * превью строки сразу из них, не дожидаясь setBySlug. */
    async searchSets(q: string): Promise<{ sets: StickerSet[]; covers: Covers }> {
      const r = await rest.get<{ sets: RawStickerSet[]; covers?: Record<string, RawSticker[]> }>('/sticker-sets/search', { q })
      return { sets: (r.sets ?? []).map(mapStickerSet), covers: mapCovers(r.covers) }
    },
    /** Трендовые наборы (новые первыми, лимит featuredLim=2000 на бэке) — экран поиска
     * стикеров показывает их при пустом запросе (tweb getFeaturedStickers).
     * covers — см. searchSets. */
    async featuredSets(): Promise<{ sets: StickerSet[]; covers: Covers }> {
      const r = await rest.get<{ sets: RawStickerSet[]; covers?: Record<string, RawSticker[]> }>('/sticker-sets/featured')
      return { sets: (r.sets ?? []).map(mapStickerSet), covers: mapCovers(r.covers) }
    },
    async install(setId: number): Promise<void> { await rest.post(`/sticker-sets/${setId}/install`, {}) },
    async uninstall(setId: number): Promise<void> { await rest.del(`/sticker-sets/${setId}/install`) },
    async recent(): Promise<Sticker[]> {
      const r = await rest.get<{ stickers: RawSticker[] }>('/stickers/recent')
      return (r.stickers ?? []).map(mapSticker)
    },
    /** очистка недавних (tweb clearRecentStickers) */
    async clearRecent(): Promise<void> { await rest.del('/stickers/recent') },
    async faved(): Promise<Sticker[]> {
      const r = await rest.get<{ stickers: RawSticker[] }>('/stickers/faved')
      return (r.stickers ?? []).map(mapSticker)
    },
    // Избранное и недавние адресуют ФАЙЛ (document.id схемы), а не строку
    // набора: у оригинала messages.faveSticker/saveRecentSticker принимают
    // InputDocument. Побочно это снимает дубль — тот же файл, добавленный из
    // двух наборов, попадал в список дважды.
    async fave(docId: number): Promise<void> { await rest.post(`/stickers/${docId}/fave`, {}) },
    async unfave(docId: number): Promise<void> { await rest.del(`/stickers/${docId}/fave`) },
    async use(docId: number): Promise<void> { await rest.post(`/stickers/${docId}/use`, {}) },
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
