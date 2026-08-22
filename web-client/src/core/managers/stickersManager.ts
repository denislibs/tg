// src/core/managers/stickersManager.ts
// Тонкие REST-обёртки над эндпоинтами стикеров и GIF (/sticker-sets, /stickers,
// /gifs — домен общий, tweb тоже держит их в одной панели).
//
// Мапперов здесь больше НЕТ, и это результат порта, а не упрощение: сервер
// отдаёт конструкторы схемы, поэтому форма провода и форма модели совпали —
// разбирать нечего. Стикер приезжает `document`, тем же конструктором, что и
// вложение сообщения (своего типа у стикера в схеме нет вовсе), и проходит тот
// же `saveDocument`, что и документ из ленты: тип файла, размеры, эмодзи и
// набор выводятся ИЗ АТРИБУТОВ, как в appDocsManager оригинала.
//
// Файл стикера лежит в media: mime 'application/json' — несжатый lottie-json,
// 'application/x-tgsticker' — он же под gzip (.tgs, так отдаёт Telegram — им
// залиты все выгруженные наборы; разбор — core/stickers/tgs), 'video/webm' —
// видео-стикер, image/webp|png — статичный. URL клиент строит сам (core/mediaUrl).
import type { RestClient } from '../net/restClient'
import { saveDocument, type MyDocument } from '../media/messageMedia'

/**
 * Набор — конструктор `stickerSet` схемы.
 *
 * Три места, где форма отличается от прежней нашей, и каждое неспроста:
 *   • `short_name` вместо `slug` — имя параметра из схемы;
 *   • вид набора — ФЛАГ `pFlags.emojis`, а не строка `kind`: в схеме вид
 *     сущности не бывает строкой;
 *   • `thumb_document_id` вместо `cover_media_id` — обложка это ДОКУМЕНТ
 *     набора. Нет обложки — вкладка панели показывает первый стикер
 *     (правило клиента, `core/stickers/setThumb.ts`).
 *
 * `installed_date` — срок установки. Он же отвечает на вопрос «установлен
 * ли»: раньше ответом было попадание набора в выдачу ручки, из-за чего один и
 * тот же набор в списке моих и в трендах выглядел по-разному.
 */
export interface StickerSet {
  _: 'stickerSet'
  id: number
  title: string
  short_name: string
  count: number
  pFlags?: Partial<{ emojis: true }>
  installed_date?: number
  thumb_document_id?: number
}

/** Стикер — это `document`. Отдельного типа у него в схеме нет (см. шапку). */
export type Sticker = MyDocument

/** Обратный индекс «эмодзи → документы» (`stickerPack` схемы). */
export interface StickerPack { _: 'stickerPack'; emoticon: string; documents: number[] }

/** Набор вместе с его содержимым — `stickerSetFullCovered` схемы. */
export interface StickerSetCovered {
  _: 'stickerSetFullCovered'
  set: StickerSet
  packs: StickerPack[]
  documents: Sticker[]
}

/**
 * Адрес набора — наша форма схемного объединения `InputStickerSet`
 * (`inputStickerSetShortName` | `inputStickerSetID`). Дискриминатор здесь —
 * присутствие ключа, а не `_`: конструкторами это станет на фазе 3, когда
 * адрес поедет в теле, а не в пути маршрута.
 */
export type InputStickerSetAddress = { shortName: string } | { id: number }

/** Сохранённый GIF — тоже документ: вкладка GIF знает размеры и mime до
 * загрузки файла, поэтому кладка не прыгает по мере скачивания. */
export type SavedGif = MyDocument
/** Результат внешнего поиска (Tenor-прокси /gifs/search) — ЧУЖОЙ контракт, а
 * не наша модель: конвертер на границе, как у Bot API в разметке. */
export interface TenorGif { id: string; mp4Url: string; gifUrl: string; previewUrl: string; width: number; height: number }
export interface GifPage { gifs: TenorGif[]; next: string }

interface RawTenorGif { id: string; mp4_url: string; gif_url: string; preview_url: string; width: number; height: number }

const mapTenorGif = (r: RawTenorGif): TenorGif => ({
  id: r.id, mp4Url: r.mp4_url, gifUrl: r.gif_url, previewUrl: r.preview_url, width: r.width, height: r.height,
})

/** Документы ответа проходят тот же saveDocument, что и документ из ленты:
 *  тип файла, размеры и набор выводятся из атрибутов, а не приезжают готовыми. */
const saveAll = (docs: Sticker[] | undefined): Sticker[] => (docs ?? []).map(saveDocument)

/**
 * Ключ набора → его первые стикеры. Собирается из вектора
 * `stickerSetCovered`, где набор и его документы едут ОДНИМ объектом — карта
 * нужна только для быстрого lookup при рендере строки набора, ради которого её
 * и заводили.
 */
export type Covers = Map<number, Sticker[]>

/** Вектор covered-наборов → пара «наборы, карта превью». */
function splitCovered(sets: StickerSetCovered[] | undefined): { sets: StickerSet[]; covers: Covers } {
  const out: StickerSet[] = []
  const covers: Covers = new Map()
  for (const c of sets ?? []) {
    out.push(c.set)
    covers.set(c.set.id, saveAll(c.documents))
  }
  return { sets: out, covers }
}

export function newStickersManager({ rest }: { rest: Pick<RestClient, 'get' | 'post' | 'del'> }) {
  return {
    /** messages.allStickers — установленные наборы. */
    async mySets(): Promise<StickerSet[]> {
      const r = await rest.get<{ sets: StickerSet[] }>('/sticker-sets')
      return r.sets ?? []
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
      const r = await rest.get<{ set: StickerSet; documents: Sticker[] }>(path)
      return { set: r.set, stickers: saveAll(r.documents) }
    },
    /** messages.foundStickerSets — поиск наборов. Набор едет ВМЕСТЕ со своими
     * первыми документами (stickerSetFullCovered), поэтому строка выдачи
     * рисует превью сразу, не дожидаясь запроса за полным составом. */
    async searchSets(q: string): Promise<{ sets: StickerSet[]; covers: Covers }> {
      const r = await rest.get<{ sets: StickerSetCovered[] }>('/sticker-sets/search', { q })
      return splitCovered(r.sets)
    },
    /** messages.featuredStickers — тренды (экран поиска при пустом запросе,
     * tweb getFeaturedStickers). Порядок задаёт САМ вектор: отдельного `rank`
     * на проводе нет. */
    async featuredSets(): Promise<{ sets: StickerSet[]; covers: Covers }> {
      const r = await rest.get<{ sets: StickerSetCovered[] }>('/sticker-sets/featured')
      return splitCovered(r.sets)
    },
    async install(setId: number): Promise<void> { await rest.post(`/sticker-sets/${setId}/install`, {}) },
    async uninstall(setId: number): Promise<void> { await rest.del(`/sticker-sets/${setId}/install`) },
    /** messages.recentStickers. Параллельный вектор `dates` (когда стикер был
     * использован) пока не потребителен: панель показывает недавние в порядке
     * ответа, и порядок этот тот же самый. */
    async recent(): Promise<Sticker[]> {
      const r = await rest.get<{ stickers: Sticker[] }>('/stickers/recent')
      return saveAll(r.stickers)
    },
    /** очистка недавних (tweb clearRecentStickers) */
    async clearRecent(): Promise<void> { await rest.del('/stickers/recent') },
    /** messages.favedStickers. */
    async faved(): Promise<Sticker[]> {
      const r = await rest.get<{ stickers: Sticker[] }>('/stickers/faved')
      return saveAll(r.stickers)
    },
    // Избранное и недавние адресуют ФАЙЛ (document.id схемы), а не строку
    // набора: у оригинала messages.faveSticker/saveRecentSticker принимают
    // InputDocument. Побочно это снимает дубль — тот же файл, добавленный из
    // двух наборов, попадал в список дважды.
    async fave(docId: number): Promise<void> { await rest.post(`/stickers/${docId}/fave`, {}) },
    async unfave(docId: number): Promise<void> { await rest.del(`/stickers/${docId}/fave`) },
    async use(docId: number): Promise<void> { await rest.post(`/stickers/${docId}/use`, {}) },
    /** messages.stickers — поиск по эмодзи. Ручка остаётся, хотя обратный
     * индекс `packs` даёт тот же ответ по УСТАНОВЛЕННЫМ наборам: поиск идёт по
     * всем, включая неустановленные, содержимого которых у клиента нет. */
    async searchByEmoji(emoji: string): Promise<Sticker[]> {
      const r = await rest.get<{ stickers: Sticker[] }>('/stickers/search', { emoji })
      return saveAll(r.stickers)
    },

    // ── GIF ──
    /** messages.savedGifs — сохранённые GIF ДОКУМЕНТАМИ: размеры и mime
     * известны до загрузки файла, поэтому кладка не прыгает по мере
     * скачивания (прежде ехала голая ссылка на media). */
    async savedGifs(): Promise<SavedGif[]> {
      const r = await rest.get<{ gifs: SavedGif[] }>('/gifs/saved')
      return saveAll(r.gifs)
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
