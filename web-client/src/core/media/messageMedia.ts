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

import type { MessageEntity } from '@layer'
import { generateMessageId } from '../history/messageId'
import type { Peer } from '../peers/peerId'

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
 * textWithEntities#751f3146 text:string entities:Vector<MessageEntity> =
 * TextWithEntities;
 *
 * Строка ВМЕСТЕ со своей разметкой одним объектом. Живёт здесь, а не в
 * `core/models.ts`, потому что первыми её спрашивают конструкторы этого файла
 * (вопрос опроса, варианты, заголовок и пункты чек-листа); `core/models.ts`
 * её ре-экспортирует для «проверки фактов».
 */
export interface TextWithEntities {
  _: 'textWithEntities'
  text: string
  entities: MessageEntity[]
}

// ── Гео: ТРИ конструктора, а не один с полями ──────────────────────────────

/**
 * geoPoint#b2a2f663 flags:# long:double lat:double access_hash:long
 * accuracy_radius:flags.0?int = GeoPoint;
 *
 * ТОЧКА, общая для трёх конструкторов гео. Параметр зовётся `long` (долгота), а
 * не `lng`: имя берётся из схемы буквально. `access_hash` — реквизит
 * MTProto-транспорта (им оригинал подписывает запрос картинки карты в своём
 * прокси), `accuracy_radius` — точность `watchPosition`, которой мы не храним.
 */
export interface GeoPoint { _: 'geoPoint'; long: number; lat: number }

/** messageMediaGeo#56e0d474 geo:GeoPoint = MessageMedia; — просто точка. */
export interface MessageMediaGeo { _: 'messageMediaGeo'; geo: GeoPoint }

/**
 * messageMediaVenue#2ec0533f geo:GeoPoint title:string address:string
 * provider:string venue_id:string venue_type:string = MessageMedia;
 *
 * МЕСТО: у точки с подписью оригинал рисует футер с названием и адресом, у
 * голой точки — нет (tweb `geo.ts:190`). `provider`/`venue_id`/`venue_type` —
 * реквизиты СПРАВОЧНИКА мест (foursquare/gplaces), справочника у нас нет вовсе.
 */
export interface MessageMediaVenue { _: 'messageMediaVenue'; geo: GeoPoint; title: string; address: string }

/**
 * messageMediaGeoLive#b940c666 flags:# geo:GeoPoint heading:flags.0?int
 * period:int proximity_notification_radius:flags.1?int = MessageMedia;
 *
 * ЖИВАЯ ТРАНСЛЯЦИЯ. Флага «остановлена» в схеме НЕТ: конец трансляции
 * выражается ИСТЕЧЕНИЕМ срока — `date + period <= now` (tweb `geo.ts:178-179`,
 * `isLiveExpired`), см. `isLiveGeoExpired` ниже. Досрочная остановка приезжает
 * УКОРОЧЕННЫМ `period`.
 */
export interface MessageMediaGeoLive { _: 'messageMediaGeoLive'; geo: GeoPoint; heading?: number; period: number }

/**
 * messageMediaContact#70322949 phone_number:string first_name:string
 * last_name:string vcard:string user_id:long = MessageMedia;
 *
 * Присланная визитка. Все пять параметров ОБЯЗАТЕЛЬНЫЕ и едут всегда, в том
 * числе пустыми: имя визитки мы храним одной строкой, поэтому `last_name` пуст,
 * а `vcard` мы не принимаем вовсе. Пустая строка здесь — ЗНАЧЕНИЕ, а не
 * отсутствие параметра.
 */
export interface MessageMediaContact {
  _: 'messageMediaContact'
  phone_number: string
  first_name: string
  last_name: string
  vcard: string
  user_id: number
}

// ── Опрос ──────────────────────────────────────────────────────────────────

/**
 * pollAnswer#4b7d786a flags:# text:TextWithEntities option:bytes … = PollAnswer;
 *
 * ОДИН вариант: текст и НЕПРОЗРАЧНЫЙ КЛЮЧ. `option` — `bytes`, на JSON-проводе
 * фазы 0 это base64 (как `photoStrippedSize.bytes`); у нас в нём лежит номер
 * варианта одним байтом — см. `pollOptionIndex`.
 */
export interface PollAnswer { _: 'pollAnswer'; text: TextWithEntities; option: string }

/**
 * poll#966e2dbf id:long flags:# closed:flags.0?true public_voters:flags.1?true
 * multiple_choice:flags.2?true quiz:flags.3?true … question:TextWithEntities
 * answers:Vector<PollAnswer> … hash:long = Poll;
 *
 * САМ ОПРОС — вопрос и варианты, одинаковые для всех зрителей. Анонимность в
 * схеме задана с ДРУГОЙ стороны: `public_voters` («видно, кто как
 * проголосовал»), поэтому анонимный опрос — это ОТСУТСТВИЕ ключа.
 * `hash` (обязательный) не производится: хэш-кэширования запросов у нас нет.
 */
export interface Poll {
  _: 'poll'
  id: number
  pFlags?: Partial<{ closed: true; public_voters: true; multiple_choice: true; quiz: true }>
  question: TextWithEntities
  answers: PollAnswer[]
}

/**
 * pollAnswerVoters#3645230a flags:# chosen:flags.0?true correct:flags.1?true
 * option:bytes voters:flags.2?int … = PollAnswerVoters;
 *
 * Итог ОДНОГО варианта, адресованный тем же ключом `option`. `chosen` — «этот
 * вариант выбрал ЗРИТЕЛЬ»: пер-зрительский выбор живёт ЗДЕСЬ, а не отдельным
 * массивом рядом со счётчиками.
 */
export interface PollAnswerVoters {
  _: 'pollAnswerVoters'
  pFlags?: Partial<{ chosen: true; correct: true }>
  option: string
  voters?: number
}

/**
 * pollResults#ba7bb15e flags:# min:flags.0?true … results:flags.1?Vector<PollAnswerVoters>
 * total_voters:flags.2?int … = PollResults;
 *
 * ИТОГИ — пер-зрительская часть опроса. Обязательных параметров нет ни одного:
 * пустой `pollResults` это законная форма «опрос есть, никто не голосовал».
 *
 * `min` — «объект пришёл УРЕЗАННЫМ»: пер-зрительской части в нём нет. Его
 * ставит кадр `poll_update`, чьё тело одно на всех получателей и потому собрано
 * для «зрителя 0». По нему клиент СОХРАНЯЕТ свой выбор вместо того, чтобы
 * затереть его отсутствием `chosen` (порт `appPollsManager.saveResults`).
 */
export interface PollResults {
  _: 'pollResults'
  pFlags?: Partial<{ min: true }>
  results?: PollAnswerVoters[]
  total_voters?: number
}

/**
 * messageMediaPoll#773f4e66 flags:# poll:Poll results:PollResults
 * attached_media:flags.0?MessageMedia = MessageMedia;
 */
export interface MessageMediaPoll { _: 'messageMediaPoll'; poll: Poll; results: PollResults }

// ── Чек-лист ───────────────────────────────────────────────────────────────

/** todoItem#cba9a52f id:int title:TextWithEntities = TodoItem; */
export interface TodoItem { _: 'todoItem'; id: number; title: TextWithEntities }

/**
 * todoCompletion#221bb5e4 id:int completed_by:Peer date:int = TodoCompletion;
 *
 * ОТМЕТКА лежит НЕ в пункте: пункт неизменяем, а «кто и когда отметил» — своя
 * запись в отдельном векторе. «Кто» — ссылка на пир, а не голый user_id.
 */
export interface TodoCompletion { _: 'todoCompletion'; id: number; completed_by: Peer; date: number }

/**
 * todoList#49b92a26 flags:# others_can_append:flags.0?true
 * others_can_complete:flags.1?true title:TextWithEntities list:Vector<TodoItem>
 * = TodoList;
 *
 * `id` — НАШ параметр вне схемы (`schema_additional_params.json`, предикат
 * `todoList`) и названный остаток АДРЕСАЦИИ: оригинал адресует чек-лист парой
 * «пир + номер сообщения», а наши ручки принимают суррогатный ключ строки.
 */
export interface TodoList {
  _: 'todoList'
  id: number
  pFlags?: Partial<{ others_can_append: true; others_can_complete: true }>
  title: TextWithEntities
  list: TodoItem[]
}

/**
 * messageMediaToDo#8a53b014 flags:# todo:TodoList
 * completions:flags.0?Vector<TodoCompletion> = MessageMedia;
 */
export interface MessageMediaToDo { _: 'messageMediaToDo'; todo: TodoList; completions?: TodoCompletion[] }

// ── Розыгрыш ───────────────────────────────────────────────────────────────

/**
 * messageMediaGiveaway#aa073beb flags:# only_new_subscribers:flags.0?true
 * winners_are_visible:flags.2?true channels:Vector<long> …
 * quantity:int months:flags.4?int stars:flags.5?long until_date:int
 * = MessageMedia;
 *
 * ИДУЩИЙ розыгрыш. Вид приза выражен тем, КАКОЙ параметр присутствует —
 * `months` (подписка) или `stars`; строкового `prize_kind` в схеме нет.
 * `id` — НАШ параметр вне схемы, тот же остаток адресации, что у `todoList.id`.
 *
 * «Участвую ли я» здесь НЕТ и быть не может: тело кадра одно на всех
 * получателей. Это отдельный ответ `GET /giveaways/{id}` (`GiveawayState`).
 */
export interface MessageMediaGiveaway {
  _: 'messageMediaGiveaway'
  id: number
  pFlags?: Partial<{ only_new_subscribers: true; winners_are_visible: true }>
  channels: number[]
  quantity: number
  months?: number
  stars?: number
  until_date: number
}

/**
 * messageMediaGiveawayResults#ceaa3ea1 flags:# … channel_id:long
 * launch_msg_id:int winners_count:int unclaimed_count:int winners:Vector<long>
 * months:flags.4?int stars:flags.5?long … until_date:int = MessageMedia;
 *
 * СОСТОЯВШИЙСЯ розыгрыш — ДРУГОЙ конструктор, а не поле `status` у первого.
 * «Выиграл ли ЗРИТЕЛЬ» отдельным ключом не едет: он есть в векторе `winners`, и
 * клиент отвечает на этот вопрос сам — как на «моя ли реакция».
 */
export interface MessageMediaGiveawayResults {
  _: 'messageMediaGiveawayResults'
  id: number
  pFlags?: Partial<{ only_new_subscribers: true; refunded: true }>
  channel_id: number
  launch_msg_id: number
  winners_count: number
  unclaimed_count: number
  winners: number[]
  months?: number
  stars?: number
  until_date: number
}

// ── Превью ссылки ──────────────────────────────────────────────────────────

/**
 * webPage#e89c45b2 flags:# … id:long url:string display_url:string hash:int
 * type:flags.0?string site_name:flags.1?string title:flags.2?string
 * description:flags.3?string photo:flags.4?Photo … cached_page:flags.10?Page …
 * = WebPage;
 *
 * КАРТОЧКА. Картинка здесь — `photo:Photo`, ОБЫЧНАЯ лестница ступеней, та же,
 * что у фотографии сообщения: россыпи `photo_w`/`photo_h`/`photo_blur` рядом
 * больше нет, и ступень выбирается тем же `choosePhotoSize`.
 *
 * `id` (кэшированная страница на сервере оригинала) и `hash` (хэш-кэширование
 * запроса) не производятся — предмета нет. `has_iv` — НАШ параметр вне схемы
 * (`schema_additional_params.json`, предикат `webPage`): место статьи в схеме
 * есть (`cached_page:Page`), но наша статья — результат reader-парсера, а не
 * вёрстка из конструкторов `PageBlock`, и отдаёт её своя ручка.
 */
export interface WebPage {
  _: 'webPage'
  url: string
  display_url: string
  site_name?: string
  title?: string
  description?: string
  photo?: MyPhoto
  has_iv?: boolean
}

/** messageMediaWebPage#ddf10c3b flags:# … webpage:WebPage = MessageMedia; */
export interface MessageMediaWebPage { _: 'messageMediaWebPage'; webpage: WebPage }

// ── Платное медиа ──────────────────────────────────────────────────────────

/**
 * messageExtendedMediaPreview#ad628cc8 flags:# w:flags.0?int h:flags.0?int
 * thumb:flags.1?PhotoSize video_duration:flags.2?int = MessageExtendedMedia;
 *
 * Что видит зритель, НЕ оплативший платное медиа: коробка кадра и
 * stripped-подложка — и ничего, по чему можно было бы получить байты.
 */
export interface MessageExtendedMediaPreview {
  _: 'messageExtendedMediaPreview'
  w?: number
  h?: number
  thumb?: PhotoSize
  video_duration?: number
}

/** messageExtendedMedia#ee479c64 media:MessageMedia = MessageExtendedMedia; */
export interface MessageExtendedMediaReal { _: 'messageExtendedMedia'; media: MessageMedia }

/**
 * MessageExtendedMedia — объединение схемы. «Заблокировано» это ВЫБОР
 * КОНСТРУКТОРА позиции вектора, а не булев ключ рядом: неоплативший физически
 * не получает объекта, из которого можно достать байты.
 */
export type MessageExtendedMedia = MessageExtendedMediaPreview | MessageExtendedMediaReal

/**
 * messageMediaPaidMedia#a8852491 stars_amount:long
 * extended_media:Vector<MessageExtendedMedia> = MessageMedia;
 *
 * Платность — не приписка к вложению, а ОБЁРТКА: настоящее медиа лежит внутри
 * вектора `extended_media` (либо не лежит вовсе — тогда там превью).
 */
export interface MessageMediaPaidMedia {
  _: 'messageMediaPaidMedia'
  stars_amount: number
  extended_media: MessageExtendedMedia[]
}

/**
 * Вложение сообщения — ОБЪЕДИНЕНИЕ схемы целиком.
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
 *
 * Гео, визитка, опрос, чек-лист, розыгрыш, превью ссылки и платное медиа —
 * ТОЖЕ конструкторы этого объединения, а не собственные поля сообщения рядом с
 * `media`. Подарка среди них нет: `messageMediaStarGift` в схеме отсутствует,
 * подарок приходит СЛУЖЕБНЫМ сообщением с действием `messageActionStarGift`.
 */
export type MessageMedia =
  | { _: 'messageMediaPhoto'; pFlags?: Partial<{ spoiler: true }>; photo: MyPhoto }
  | { _: 'messageMediaDocument'; pFlags?: Partial<{ spoiler: true }>; document: MyDocument }
  | MessageMediaGeo
  | MessageMediaVenue
  | MessageMediaGeoLive
  | MessageMediaContact
  | MessageMediaPoll
  | MessageMediaToDo
  | MessageMediaGiveaway
  | MessageMediaGiveawayResults
  | MessageMediaWebPage
  | MessageMediaPaidMedia

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

/**
 * Нормализует вложение С ПРОВОДА: выводит поля документа из атрибутов и
 * переводит вложенные номера сообщений в клиентское пространство. Заходит
 * ВНУТРЬ обёрток — платное медиа несёт настоящее вложение в своём векторе, а
 * карточка ссылки может нести документ, — иначе у вложенного документа не
 * оказалось бы выведенного типа.
 *
 * Зовётся РОВНО ОДИН РАЗ на каждый приехавший объект: на границе разбора
 * сообщения (`mapMessage`) и на границе каждого кадра, несущего вложение
 * (`cacheGeoLive`/`cachePoll`/`cacheChecklist`/`cacheGiveaway`/`cacheWebPage`).
 * Перевод номера не идемпотентен, поэтому второго вызова быть не должно.
 */
export function saveMessageMedia(media: MessageMedia | undefined): MessageMedia | undefined {
  if (!media) return undefined
  if (media._ === 'messageMediaDocument') saveDocument(media.document)
  else if (media._ === 'messageMediaPaidMedia') {
    for (const item of media.extended_media) {
      if (item._ === 'messageExtendedMedia') saveMessageMedia(item.media)
    }
  } else if (media._ === 'messageMediaGiveawayResults') {
    // `launch_msg_id` — НОМЕР сообщения-запуска, то есть такой же адрес, как
    // `message.id` и `reply_to.reply_to_msg_id`, и переводить его надо там же
    // (порт `appMessagesManager.saveMessageMedia`, ветка
    // `messageMediaGiveawayResults`). Верхний уровень маппер переводил, а этот
    // номер оставался в СЕРВЕРНОМ пространстве — «перейти к сообщению-запуску»
    // промахнулось бы мимо. Ноль и отрицательные пропускаем, как оригинал:
    // это «сообщение неизвестно», а не адрес.
    if (media.launch_msg_id > 0) media.launch_msg_id = generateMessageId(media.launch_msg_id)
  }
  return media
}

/** Носитель вложения: обычное сообщение либо вью-модельная строка ленты. Ветка
 *  `{ media?: never }` — это ПИЛЮЛЯ (`messageService`): поля `media` у неё в
 *  схеме нет вовсе, и вопрос «какое вложение» законно отвечается «никакого». */
export type MaybeWithMedia = { _?: string; media?: MessageMedia } | undefined | null

/**
 * Порт `getMediaFromMessage` (tweb `utils/messages/getMediaFromMessage.ts`):
 * ФАЙЛ вложения, каким бы конструктором он ни был обёрнут. Ветки `webpage` и
 * `extended_media` теперь настоящие — раньше их не было, потому что превью
 * ссылки и платное медиа ехали собственными полями сообщения.
 *
 * У заблокированного платного медиа файла нет ВОВСЕ (приезжает
 * `messageExtendedMediaPreview`) — отвечаем `undefined`, а не подставляем
 * псевдо-фото: подстановку делает `generatePhotoForExtendedMediaPreview` там,
 * где надо рисовать, как и в оригинале.
 */
export function getMediaFromMessage(
  message: MaybeWithMedia,
): MyPhoto | MyDocument | undefined {
  return mediaFile(message?.media)
}

function mediaFile(media: MessageMedia | undefined): MyPhoto | MyDocument | undefined {
  switch (media?._) {
    case 'messageMediaPhoto': return media.photo
    case 'messageMediaDocument': return media.document
    case 'messageMediaWebPage': return media.webpage.photo
    case 'messageMediaPaidMedia': {
      const first = media.extended_media[0]
      return first?._ === 'messageExtendedMedia' ? mediaFile(first.media) : undefined
    }
    default: return undefined
  }
}

/**
 * Файл, который рисует САМ БАБЛ. От `getMediaFromMessage` отличается ровно
 * карточкой ссылки: её картинка — тоже файл вложения (медиавьювер открывает
 * именно её, и скачивает её же меню сообщения), но бабл у карточки ТЕКСТОВЫЙ —
 * она рисуется ВНУТРИ тела сообщения (tweb bubbles.ts:8112), а не вместо него.
 *
 * Пока превью ссылки ехало собственным ключом сообщения, разницы не было вовсе:
 * `getMediaFromMessage` про него не знал. Теперь знает — и вопрос «чем рисовать
 * бабл» обязан задаваться отдельно от вопроса «какой у вложения файл».
 */
export function getBubbleMedia(message: MaybeWithMedia): MyPhoto | MyDocument | undefined {
  return message?.media?._ === 'messageMediaWebPage' ? undefined : getMediaFromMessage(message)
}

/** Документ вложения; `undefined`, если вложение — не документ. */
export function getDocumentFromMessage(
  message: MaybeWithMedia,
): MyDocument | undefined {
  const file = getMediaFromMessage(message)
  return file?._ === 'document' ? file : undefined
}

/** Медиа скрыто заслонкой (`messageMedia.pFlags.spoiler`). Заслонка есть только
 *  у фото и документа — у остальных конструкторов такого бита нет вовсе. */
export function isMediaSpoiler(message: MaybeWithMedia): boolean {
  const media = message?.media
  return (media?._ === 'messageMediaPhoto' || media?._ === 'messageMediaDocument')
    && media.pFlags?.spoiler === true
}

// ── Доступ к конструкторам объединения ─────────────────────────────────────

/** Гео-точка вложения, каким бы из трёх конструкторов оно ни было. */
export function getGeoFromMedia(media: MessageMedia | undefined): GeoPoint | undefined {
  switch (media?._) {
    case 'messageMediaGeo':
    case 'messageMediaVenue':
    case 'messageMediaGeoLive':
      return media.geo
    default: return undefined
  }
}

/**
 * Трансляция ЗАКОНЧИЛАСЬ. Порт `isLiveExpired` (tweb `geo.ts:178-179`):
 * `date + period <= now`. Отдельного флага «остановлена» в схеме нет —
 * досрочная остановка приезжает укороченным `period`, а вопрос задаётся
 * ТОЛЬКО так. Второго способа ответить на него нет и не должно быть.
 *
 * `date` — дата сообщения (секунды эпохи), `now` — тоже секунды.
 */
export function isLiveGeoExpired(media: MessageMediaGeoLive, date: number, nowSeconds: number): boolean {
  return date + media.period <= nowSeconds
}

/**
 * Номер варианта опроса из его ключа. `option` в схеме — НЕПРОЗРАЧНЫЕ байты; у
 * нас в них лежит номер одним байтом (`domain.PollOption`), и ручка голосования
 * принимает именно номер. Перевод живёт в одном месте, чтобы ключ не начали
 * читать позицией в массиве — позиции в схеме нет вовсе.
 */
export function pollOptionIndex(option: string): number {
  return atob(option).charCodeAt(0)
}

/** Ключ варианта из его номера — обратная сторона `pollOptionIndex`. */
export function pollOptionKey(index: number): string {
  return btoa(String.fromCharCode(index))
}

/** Итог варианта по его ключу; `undefined` — итогов по нему ещё нет. */
export function pollVotersFor(results: PollResults, option: string): PollAnswerVoters | undefined {
  return results.results?.find((r) => r.option === option)
}

/**
 * Позиция вектора платного медиа, которую видит ЗРИТЕЛЬ. Вектор у нас всегда
 * длиной один (альбомов платных вложений мы не собираем), но вектор остаётся
 * вектором, поэтому берётся первый элемент, а не «поле».
 */
export function getExtendedMedia(media: MessageMediaPaidMedia): MessageExtendedMedia | undefined {
  return media.extended_media[0]
}

/** Платное медиа НЕ оплачено зрителем: вместо объекта приехало превью. */
export function isPaidMediaLocked(media: MessageMediaPaidMedia): boolean {
  return getExtendedMedia(media)?._ === 'messageExtendedMediaPreview'
}

/** Платное вложение сообщения; `undefined` — вложение не платное. */
export function getPaidMedia(message: MaybeWithMedia): MessageMediaPaidMedia | undefined {
  return message?.media?._ === 'messageMediaPaidMedia' ? message.media : undefined
}

/**
 * ПРЕВЬЮ неоплаченного платного медиа; `undefined` — либо вложение не платное,
 * либо зритель уже оплатил и получил объект целиком.
 *
 * Гейт «показывать ли контент» задаётся ИМЕННО так — вопросом «какой
 * конструктор приехал», — а не булевым ключом рядом: неоплативший физически не
 * получает объекта, из которого можно достать байты.
 */
export function getExtendedMediaPreview(message: MaybeWithMedia): MessageExtendedMediaPreview | undefined {
  const paid = getPaidMedia(message)
  if (!paid) return undefined
  const item = getExtendedMedia(paid)
  return item?._ === 'messageExtendedMediaPreview' ? item : undefined
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
