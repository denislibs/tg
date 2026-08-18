// Медиа сообщения в форме оригинала (MTProto) — вложенный
// `messageMediaPhoto`/`messageMediaDocument` с лестницей `PhotoSize[]` и
// `DocumentAttribute[]`, а не плоский набор полей.
//
// Зачем. Врапперы tweb (`wrapPhoto`/`wrapVideo`/`wrapSticker`/`wrapDocument`/
// `wrapAlbum`) написаны против этой модели: они спрашивают `doc.type`,
// `doc.thumbs`, `doc.attributes`, `photo.sizes`. Пока у нас медиа было плоским,
// каждый вопрос приходилось подделывать отдельным параметром-флагом
// (`isDocument`, `documentType`, `isVideoWithPlayer`, `strippedSize`), и на
// каждом таком переходнике терялся терм оригинала. Здесь модель совпадает —
// врапперы читают её напрямую.
//
// Тип документа НЕ приходит с сервера готовым: он выводится из атрибутов и mime
// ровно так же, как в `appDocsManager.saveDoc` (tweb :150-260). Это тот же
// механизм, а не его результат: сервер описывает файл, клиент решает, каким
// баблом его рисовать.
//
// Имена конструкторов и полей взяты из схемы БУКВАЛЬНО
// (`tweb/src/lib/mtproto/schema.ts`); фаза 0 перехода на TL — модель уже
// TL-совместима, сериализация пока JSON. Необязательность выражается
// ОТСУТСТВИЕМ поля (в TL это бит `flags`), а не `null` и не пустой строкой.
//
// ── Чего в модели НЕТ и почему ───────────────────────────────────────────────
// Реквизиты MTProto-транспорта (`dc_id`, `access_hash`, `file_reference`,
// `date`, семейство `Input*` — в т.ч. `documentAttributeSticker.stickerset`)
// не воспроизводятся: у нас файл адресуется одним числовым id через
// собственный медиа-эндпоинт, предмета у них нет. Варианты
// `photoSizeProgressive`/`photoCachedSize`/`photoSizeEmpty` объявлены (кодек
// фазы 2 обязан их понимать, и портируемый код на них ветвится), но сервером
// не производятся: прогрессивного JPEG мы не отдаём, роль `photoCachedSize`
// целиком несёт `photoStrippedSize`, а «размера нет» в JSON — это
// отсутствующий элемент массива.

// ── PhotoSize: объединение схемы, конструктор за конструктором ─────────────
// Буква `type` — та, по которой `choosePhotoSize` выбирает ступень:
//   `i` — stripped-плейсхолдер (едет в самом сообщении, base64-JPEG);
//   `j` — векторный контур стикера;
//   `y` — сгенерированное сервером превью (байты по `?v=thumb`);
//   `w` — оригинал.
// Три варианта объявлены, но сервером не производятся (предмета в нашем
// хранилище нет) — они нужны, потому что кодек фазы 2 обязан их понимать, и
// потому что портируемый код оригинала на них ветвится.

/** photoSizeEmpty#e17e23c type:string = PhotoSize; */
export interface PhotoSizeEmpty { _: 'photoSizeEmpty'; type: string }
/** photoSize#75c78e60 type:string w:int h:int size:int = PhotoSize; */
export interface PhotoSizeReal { _: 'photoSize'; type: string; w: number; h: number; size: number }
/** photoCachedSize#21e1ad6 type:string w:int h:int bytes:bytes = PhotoSize; */
export interface PhotoCachedSize { _: 'photoCachedSize'; type: string; w: number; h: number; bytes: string }
/** photoStrippedSize#e0b0bc2e type:string bytes:bytes = PhotoSize; */
export interface PhotoStrippedSize { _: 'photoStrippedSize'; type: string; bytes: string }
/** photoSizeProgressive#fa3efb95 type:string w:int h:int sizes:Vector<int> = PhotoSize; */
export interface PhotoSizeProgressive { _: 'photoSizeProgressive'; type: string; w: number; h: number; sizes: number[] }
/** photoPathSize#d8214d41 type:string bytes:bytes = PhotoSize; */
export interface PhotoPathSize { _: 'photoPathSize'; type: string; bytes: string }

export type PhotoSize =
  | PhotoSizeEmpty
  | PhotoSizeReal
  | PhotoCachedSize
  | PhotoStrippedSize
  | PhotoSizeProgressive
  | PhotoPathSize

// ── DocumentAttribute: объединение схемы ───────────────────────────────────

/** documentAttributeImageSize#6c37c15c w:int h:int = DocumentAttribute; */
export interface DocumentAttributeImageSize { _: 'documentAttributeImageSize'; w: number; h: number }
/** documentAttributeAnimated#11b58939 = DocumentAttribute; */
export interface DocumentAttributeAnimated { _: 'documentAttributeAnimated' }
/** documentAttributeSticker#6319d612 … alt:string stickerset:InputStickerSet …
 * `stickerset` не воспроизводится: семейство Input* транспорта, набор у нас
 * адресуется числовым set_id через свою ручку. */
export interface DocumentAttributeSticker { _: 'documentAttributeSticker'; alt: string }
/** documentAttributeVideo#17399fad flags:# round_message:flags.0?true
 * supports_streaming:flags.1?true nosound:flags.3?true duration:double w:int h:int … */
export interface DocumentAttributeVideo {
  _: 'documentAttributeVideo'
  pFlags?: Partial<{ round_message: true; supports_streaming: true; nosound: true }>
  duration: number
  w: number
  h: number
}
/** documentAttributeAudio#9852f9c6 flags:# voice:flags.10?true duration:int
 * title:flags.0?string performer:flags.1?string waveform:flags.2?bytes */
export interface DocumentAttributeAudio {
  _: 'documentAttributeAudio'
  pFlags?: Partial<{ voice: true }>
  duration: number
  title?: string
  performer?: string
  /** пики волны голосового, base64 (5-битная упаковка) */
  waveform?: string
}
/** documentAttributeFilename#15590068 file_name:string = DocumentAttribute; */
export interface DocumentAttributeFilename { _: 'documentAttributeFilename'; file_name: string }

export type DocumentAttribute =
  | DocumentAttributeImageSize
  | DocumentAttributeAnimated
  | DocumentAttributeSticker
  | DocumentAttributeVideo
  | DocumentAttributeAudio
  | DocumentAttributeFilename

export type DocumentAttributeTag = DocumentAttribute['_']

/** Тип документа — то, что оригинал выводит в `doc.type`. */
export type DocumentType = 'sticker' | 'gif' | 'video' | 'round' | 'voice' | 'audio' | 'photo' | 'pdf'

/**
 * Файл. Поля `type`/`w`/`h`/`duration`/`file_name`/`animated` НЕ приходят с
 * сервера — их проставляет `saveDocument` из `attributes` + `mime_type`, как
 * `appDocsManager.saveDoc` в оригинале.
 */
export interface MyDocument {
  _: 'document'
  id: number
  mime_type: string
  size: number
  attributes: DocumentAttribute[]
  thumbs?: PhotoSize[]
  // ── клиентские поля (не идут на провод) ───────────────────────────────────
  // Их проставляет `saveDocument` из `attributes` + `mime_type`. В оригинале
  // это тот же механизм: дополнительные параметры схемы с сентинелом
  // `flags.-1?` (`scripts/in/schema_additional_params.json`), из-за которого
  // они попадают в тип, но не в кодек.
  type?: DocumentType
  w?: number
  h?: number
  duration?: number
  file_name?: string
  animated?: boolean
  /** тип стикера, как `doc.sticker` в оригинале: 1 static, 2 animated, 3 video */
  sticker?: 1 | 2 | 3
  /** эмодзи стикера — `doc.stickerEmojiRaw` оригинала (из `alt`) */
  stickerEmojiRaw?: string
}

/** Фотография: лестница размеров вместе с оригиналом (файл выбирается ступенью). */
export interface MyPhoto {
  _: 'photo'
  id: number
  sizes: PhotoSize[]
}

/**
 * Вложение сообщения.
 *
 * Булевы флаги схемы (`flags.N?true`) собраны в `pFlags` и всегда несут литерал
 * `true`: «выключено» — это ОТСУТСТВИЕ ключа, не `false` и не `null` (так их
 * читает весь портируемый код оригинала). Поля `flags` в объекте нет вовсе —
 * битовая маска живёт только на проводе, сериализатор считает её из присутствия
 * полей (tweb `tl_utils.ts:360-405`, :747).
 *
 * Биты-подсказки `messageMediaDocument` `video`/`round`/`voice` не заполняются:
 * тип документа выводится из его атрибутов (`saveDocument`), а второй источник
 * того же вывода — это ровно тот подделанный флаг, который модель устраняет.
 */
export type MessageMedia =
  | { _: 'messageMediaPhoto'; pFlags?: Partial<{ spoiler: true }>; photo: MyPhoto }
  | { _: 'messageMediaDocument'; pFlags?: Partial<{ spoiler: true }>; document: MyDocument }

/** Буквы ступеней, которые производит наш бэкенд (domain/mtmedia.go). */
export const THUMB_TYPE_STRIPPED = 'i'
export const THUMB_TYPE_PATH = 'j'
export const THUMB_TYPE_SERVER = 'y'
export const THUMB_TYPE_FULL = 'w'

// ── mime-типы, которые различает наш медиа-конвейер ─────────────────────────
// Порт `EXTENSION_MIME_TYPE_MAP` из оригинала, суженный до тех расширений, чей
// mime реально проставляет наш бэкенд (ffprobe/seed-стикеры).
const MIME_WEBP = 'image/webp'
const MIME_WEBM = 'video/webm'
const MIME_GIF = 'image/gif'
const MIME_MP4 = 'video/mp4'
const MIME_OGG = 'audio/ogg'
const MIME_PDF = 'application/pdf'
/** lottie-стикер: наш бэкенд отдаёт его под этим mime (seed-stickers/main.go) */
const MIME_TGS = 'application/x-tgsticker'

/**
 * Порт `appDocsManager.saveDoc` (tweb :150-260) в части вывода типа документа:
 * проходит атрибуты, затем уточняет по mime. Мутирует документ на месте — как
 * в оригинале, где `saveDoc` дописывает поля в сам объект.
 *
 * ── Отступления от оригинала ────────────────────────────────────────────────
 *  • ветки `documentAttributeCustomEmoji`, `stickerset`/`stickerEmojiRaw`,
 *    `supportsStreaming` и подстановки `file_name` для voice/round здесь нет:
 *    кастомных эмодзи как документов у нас нет, набор стикера приезжает своей
 *    ручкой, а стримингом владеет `resolveStreamUrl` (см. CLAUDE.md «Медиа»);
 *  • `IS_WEBP_SUPPORTED` из гейта стикера убран: наш бэкенд не конвертирует
 *    webp, и второй ветки рендера под неподдерживаемый webp у нас нет;
 *  • lottie распознаётся по одному mime (`application/x-tgsticker`), без
 *    дополнительной сверки `file_name === 'AnimatedSticker.tgs'`: у оригинала
 *    tgs приезжает под общим `application/x-tgsticker` и от обычного gzip
 *    отличается именно именем, у нас этот mime выставляет наш же процессор
 *    только стикерам.
 */
export function saveDocument(doc: MyDocument): MyDocument {
  for (const attribute of doc.attributes) {
    switch (attribute._) {
      case 'documentAttributeAudio':
        if (doc.type === 'round') break
        doc.duration = attribute.duration
        doc.type = attribute.pFlags?.voice && doc.mime_type === MIME_OGG ? 'voice' : 'audio'
        break
      case 'documentAttributeVideo':
        doc.duration = attribute.duration
        doc.w = attribute.w
        doc.h = attribute.h
        doc.type = attribute.pFlags?.round_message ? 'round' : 'video'
        break
      case 'documentAttributeSticker':
        doc.stickerEmojiRaw = attribute.alt
        if (doc.mime_type === MIME_WEBP) {
          doc.type = 'sticker'
          doc.sticker = 1
        } else if (doc.mime_type === MIME_WEBM) {
          doc.type = 'sticker'
          doc.sticker = 3
          doc.animated = true
        }
        break
      case 'documentAttributeImageSize':
        doc.type = 'photo'
        doc.w = attribute.w
        doc.h = attribute.h
        break
      case 'documentAttributeAnimated':
        if (doc.mime_type === MIME_GIF || doc.mime_type === MIME_MP4) doc.type = 'gif'
        doc.animated = true
        break
      case 'documentAttributeFilename':
        doc.file_name = attribute.file_name
        break
    }
  }

  if (doc.mime_type === MIME_PDF) doc.type = 'pdf'
  else if (doc.mime_type === MIME_GIF) doc.type = 'gif'
  else if (doc.mime_type === MIME_TGS) {
    doc.type = 'sticker'
    doc.animated = true
    doc.sticker = 2
  }

  doc.file_name ||= ''
  return doc
}

/** Нормализует вложение с провода: выводит поля документа из атрибутов. */
export function saveMessageMedia(media: MessageMedia | undefined): MessageMedia | undefined {
  if (!media) return undefined
  if (media._ === 'messageMediaDocument') saveDocument(media.document)
  return media
}

/**
 * Порт `getMediaFromMessage` (tweb) в нашем периметре: у вложения ровно два
 * варианта, поэтому ветки webpage/extended_media/game здесь нет — у нас превью
 * ссылки и платное медиа едут своими полями сообщения.
 */
export function getMediaFromMessage(
  message: { media?: MessageMedia } | undefined | null,
): MyPhoto | MyDocument | undefined {
  const media = message?.media
  if (!media) return undefined
  return media._ === 'messageMediaDocument' ? media.document : media.photo
}

/** Документ вложения; `undefined`, если вложение — фотография или его нет. */
export function getDocumentFromMessage(
  message: { media?: MessageMedia } | undefined | null,
): MyDocument | undefined {
  const media = message?.media
  return media?._ === 'messageMediaDocument' ? media.document : undefined
}

/** Медиа скрыто заслонкой (`messageMedia.pFlags.spoiler`). */
export function isMediaSpoiler(message: { media?: MessageMedia } | undefined | null): boolean {
  return message?.media?.pFlags?.spoiler === true
}

/** Ступени вложения независимо от варианта (`photo.sizes` / `doc.thumbs`). */
function sizesOf(media: MyPhoto | MyDocument | undefined): PhotoSize[] {
  if (!media) return []
  return (media._ === 'photo' ? media.sizes : media.thumbs) ?? []
}

/** Байты stripped-плейсхолдера (`photoStrippedSize`, ступень `i`). */
export function getStrippedThumb(media: MyPhoto | MyDocument | undefined): string | undefined {
  return sizesOf(media).find((s) => s._ === 'photoStrippedSize')?.bytes
}

/** Векторный контур стикера (`photoPathSize`, ступень `j`). */
export function getPathThumb(media: MyPhoto | MyDocument | undefined): string | undefined {
  return sizesOf(media).find((s) => s._ === 'photoPathSize')?.bytes
}

/** У медиа есть сгенерированное сервером превью (ступень `y`). */
export function hasServerThumb(media: MyPhoto | MyDocument | undefined): boolean {
  return sizesOf(media).some((s) => s._ === 'photoSize' && s.type === THUMB_TYPE_SERVER)
}

/** Ступени, у которых есть геометрия (гвард оригинала: `'w' in photoSize`). */
type SizedPhotoSize = PhotoSizeReal | PhotoCachedSize | PhotoSizeProgressive
function isSized(size: PhotoSize): size is SizedPhotoSize {
  return 'w' in size || 'h' in size
}

/**
 * Размеры кадра: у фотографии — верхняя ступень лестницы, у документа —
 * выведенные `saveDocument` `w`/`h` (то есть его атрибут), как в оригинале.
 */
export function getMediaDimensions(media: MyPhoto | MyDocument | undefined): { w?: number; h?: number } {
  if (!media) return {}
  if (media._ === 'document') return { w: media.w, h: media.h }
  const sized = media.sizes.filter(isSized)
  const full = sized.find((s) => s.type === THUMB_TYPE_FULL) ?? sized[sized.length - 1]
  return { w: full?.w, h: full?.h }
}

/**
 * Порт `choosePhotoSize` (tweb `utils/photos/choosePhotoSize.ts`): выбирает
 * первую ступень, которая покрывает бокс. Ступени без размеров (stripped,
 * контур) пропускаются, как и в оригинале.
 *
 * Отступление: параметров `useBytes`/`pushDocumentSize` нет — первый нужен
 * оригиналу, чтобы вернуть stripped-ступень вместо `photoSizeEmpty` (у нас
 * stripped читается отдельным `getStrippedThumb`), второй дописывает в
 * лестницу документа его собственный размер, которого у нас в `thumbs` и не
 * должно быть: файл документа адресуется его id, а не ступенью.
 */
export function choosePhotoSize(
  media: MyPhoto | MyDocument | undefined,
  boxWidth = 0,
  boxHeight = 0,
): SizedPhotoSize | undefined {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  if (ratio > 1) {
    boxWidth *= 2
    boxHeight *= 2
  }
  let best: SizedPhotoSize | undefined
  for (const size of sizesOf(media)) {
    if (!isSized(size)) continue
    best = size
    const scale = Math.min(boxWidth / (size.w || 1), boxHeight / (size.h || 1), 1)
    if (size.w * scale >= boxWidth || size.h * scale >= boxHeight) break
  }
  return best
}
