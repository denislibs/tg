/**
 * Порт tweb `src/components/wrappers/album.ts` (`wrapAlbum`) — ванильный.
 *
 * Что делает: раскладывает медиа-группу (Telegram `grouped_id`) в один общий
 * грид (`prepareAlbum` → `Layouter`) и делегирует КАЖДЫЙ элемент профильному
 * врапперу. Ключевое свойство, ради которого альбом — не набор баблов:
 * контейнер один, а каждая ячейка помечена своим `data-mid`/`data-peer-id` —
 * по ним лента находит сообщение под кликом, контекстным меню и выделением
 * (`bubbles.ts` ищет `.grouped-item` через `findUpClassName`).
 *
 * Живой DOM tweb (`docs/tweb/dom/dumps/03-album-channel.json`):
 *   div.attachment.no-brb [style="width: 420px; height: 539px;"]
 *     div.album-item.grouped-item [data-mid data-peer-id style="width…top…left…"]
 *       div.album-item-media.media-container.no-background
 *         img.media-photo
 *
 * ── Отличия от оригинала ────────────────────────────────────────────────────
 *  • вход — наши `Message[]` вместо `Message.message[]` MTProto; размер элемента
 *    берётся из полей самого сообщения (`mediaWidth`/`mediaHeight`), а не из
 *    `choosePhotoSize(media, 480, 480)`: лестницы `PhotoSize` у нас нет,
 *    пропорции ячейки задаёт исходная геометрия медиа — ровно тот же вход у
 *    `Layouter` (ему нужны только соотношения сторон);
 *  • ветка `media` (album.ts:38-46, `noGroupedItem`/`data-index`) не портирована:
 *    в tweb она обслуживает ПРЕДПРОСМОТР ОТПРАВКИ (попап «прикрепить»), где
 *    сообщений ещё нет. Наш попап отправки — React (`SendMediaPopup`) и в
 *    периметр порта ленты не входит; заводить второй вход без вызывающего =
 *    мёртвый код. Сам `prepareAlbum` опцию `noGroupedItem` поддерживает;
 *  • спойлеры (`spoilered`/`sensitive` → `wrapMediaSpoiler`) не портированы:
 *    `wrapMediaSpoiler`+`DotRenderer` в дереве отсутствуют, фичи «скрытое
 *    медиа» у нас нет ни в модели сообщения, ни в UI. Вместе с ними отпали
 *    `containerWidth`/`containerHeight` (они считались только для спойлера);
 *  • `videoTimes` портирован (см. параметр ниже): готовые узлы таймкода от
 *    вызывающего кладутся в ячейку. Заполняет их в tweb бабл — для
 *    НЕПРОПЛАЧЕННОГО платного медиа, где ячейку рисует не `wrapVideo`, а
 *    псевдо-фото из превью; наш бабл — следующий этап порта;
 *  • `chat`/`managers`/`animationGroup` не портированы — в теле оригинала
 *    `chat`/`managers` уходят только в `wrapVideo`/`wrapPhoto` (у нас менеджеры
 *    берутся из точки входа), `animationGroup` — только в `wrapMediaSpoiler`.
 */
import type { ChatAutoDownload } from '@core/hooks/useChatAutoDownload'
import { mediaSizes } from '@core/dom/mediaSizes'
import type { LazyLoadQueue } from '@core/lazyLoadQueue'
import type { Message } from '@core/models'
import prepareAlbum from '@components/prepareAlbum'
import wrapPhoto from '@components/wrappers/photo'
import wrapVideo, { videoDocFromMessage } from '@components/wrappers/video'
import type { CancellablePromise } from '@helpers/cancellablePromise'
import type { Middleware } from '@helpers/middleware'

/** tweb album.ts:57 — зазор между ячейками альбома */
const ALBUM_SPACING = 1
/** tweb album.ts:56 — минимальная ширина ячейки для `Layouter` */
const ALBUM_MIN_WIDTH = 100

/**
 * Фото или видео (tweb `media._ === 'photo'`). У нас тип медиа живёт в
 * `message.type` + `mediaMime` — та же развилка, что у бабла: `video/*` (и тип
 * `video`) идёт в `wrapVideo`, всё остальное в альбоме — картинка.
 */
function isPhotoItem(message: Message): boolean {
  return !(message.type === 'video' || !!message.mediaMime?.startsWith('video/'))
}

export default function wrapAlbum({
  messages, attachmentDiv, middleware, lazyLoadQueue, isVisible, loadPromises,
  autoDownload, uploadPromises, videoTimes,
}: {
  messages: Message[]
  attachmentDiv: HTMLElement
  middleware?: Middleware
  lazyLoadQueue?: LazyLoadQueue
  isVisible?: () => boolean
  loadPromises?: Promise<unknown>[]
  autoDownload?: ChatAutoDownload
  /** промисы отгрузки по индексу элемента (tweb `uploadingFileName[idx]`) */
  uploadPromises?: (CancellablePromise<unknown> | undefined)[]
  /**
   * Готовые `.video-time` от вызывающего по индексу элемента (tweb `videoTimes`,
   * album.ts:32,150-153). Механизм нужен там, где ЯЧЕЙКА ВИДЕО НЕ РИСУЕТСЯ
   * враппером и потому не может построить бейдж сама: у tweb это непроплаченное
   * платное медиа (`messageExtendedMediaPreview` — вместо документа приходит
   * превью с `video_duration`, а бабл делает из него псевдо-фото). Длительность
   * знает только вызывающий, поэтому таймкод приезжает готовым узлом и
   * появляется ДО загрузки чего-либо.
   */
  videoTimes?: (HTMLElement | undefined)[]
}): void {
  // ! lowest msgID will be the FIRST in album (комментарий tweb album.ts:37)
  const items = messages.map((message) => ({
    message,
    size: { w: message.mediaWidth ?? 0, h: message.mediaHeight ?? 0 },
  }))

  prepareAlbum({
    container: attachmentDiv,
    items: items.map((i) => ({ w: i.size.w, h: i.size.h })),
    maxWidth: mediaSizes().album.width,
    minWidth: ALBUM_MIN_WIDTH,
    spacing: ALBUM_SPACING,
    forMedia: true,
  })

  items.forEach(({ message }, idx) => {
    const div = attachmentDiv.children[idx] as HTMLElement
    div.dataset.mid = '' + message.id
    div.dataset.peerId = '' + message.chatId
    const mediaDiv = div.firstElementChild as HTMLElement

    // tweb album.ts:82-116 — ветка по типу медиа; у обеих ветвей один и тот же
    // нулевой бокс (размер ячейки уже задан гридом) и один и тот же промис,
    // который уходит в `loadPromises`.
    const thumbPromise = message.mediaId == null ?
      // Платное медиа до оплаты: сервер `media_id` не отдаёт вовсе, качать
      // нечего. У tweb на этом месте псевдо-фото из превью
      // (`generatePhotoForExtendedMediaPreview`) под `wrapMediaSpoiler`;
      // и то, и другое требует правок вне периметра этой задачи (`wrapPhoto`
      // должен уметь показывать stripped-байты КАК медиа, а `DotRenderer`/
      // `wrapMediaSpoiler` в дереве ещё нет) — вынесено в доклад. Таймкод такой
      // ячейки при этом уже работает: он приходит готовым узлом в `videoTimes`.
      undefined :
      !isPhotoItem(message) ?
        // tweb album.ts:100-115 — не-фото ячейку рисует `wrapVideo` теми же
        // аргументами. `noAutoplayAttribute: true` (и нулевой бокс, из которого
        // враппер выводит `isGroupedItem`) — почему видео в альбоме не
        // автоплеится: иначе крутились бы до десяти файлов разом.
        wrapVideoItem(message, mediaDiv, idx) :
        wrapPhoto({
          mediaId: message.mediaId,
          width: message.mediaWidth,
          height: message.mediaHeight,
          strippedThumb: message.mediaBlur,
          thumb: !!message.mediaHasThumb,
          container: mediaDiv,
          boxWidth: 0,
          boxHeight: 0,
          lazyLoadQueue,
          isVisible,
          middleware,
          loadPromises,
          autoDownloadSize: autoDownload?.photo,
          uploadPromise: uploadPromises?.[idx],
        })

    if (thumbPromise) {
      loadPromises?.push(thumbPromise)
    }

    // tweb album.ts:150-153 — готовый таймкод вызывающего кладётся в ячейку
    // последним, поверх уже построенного медиа.
    const videoTime = videoTimes?.[idx]
    if (videoTime) {
      mediaDiv.append(videoTime)
    }
  })

  function wrapVideoItem(message: Message, mediaDiv: HTMLElement, idx: number) {
    const doc = videoDocFromMessage(message)
    if (!doc) return undefined

    return wrapVideo({
      doc,
      container: mediaDiv,
      message: {
        mid: message.id,
        peerId: message.chatId,
        mediaUnread: message.mediaUnread,
        // tweb `pFlags.is_outgoing` — у нас оптимистичный id до ack (core/messageToConvMsg.ts:98)
        isOutgoing: message.id < 0,
      },
      boxWidth: 0,
      boxHeight: 0,
      lazyLoadQueue,
      isVisible,
      middleware,
      loadPromises,
      autoDownload,
      noAutoplayAttribute: true,
      uploadPromise: uploadPromises?.[idx],
    })
  }
}
