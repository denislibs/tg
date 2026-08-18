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
 *  • ветка `sensitive` (18+) не портирована — вместе с самой подсистемой
 *    «чувствительный контент» (модерация, аккаунт-настройка, проверка
 *    возраста), см. шапку `components/wrappers/mediaSpoiler.ts`. Признак
 *    `spoilered` и `messageMedia.pFlags.spoiler` портированы полностью:
 *    у нас это параметр `spoilered` и поле `message.mediaSpoiler`;
 *  • `videoTimes` портирован (см. параметр ниже): готовые узлы таймкода от
 *    вызывающего кладутся в ячейку. Заполняет их в tweb бабл — для
 *    НЕПРОПЛАЧЕННОГО платного медиа, где ячейку рисует не `wrapVideo`, а
 *    псевдо-фото из превью; наш бабл — следующий этап порта;
 *  • `chat`/`managers` не портированы — в теле оригинала они уходят только в
 *    `wrapVideo`/`wrapPhoto` (у нас менеджеры берутся из точки входа).
 */
import type { AnimationItemGroup } from '@components/animationIntersector'
import type { ChatAutoDownload } from '@core/hooks/useChatAutoDownload'
import mediaSizes from '@core/dom/mediaSizes'
import type { LazyLoadQueue } from '@core/lazyLoadQueue'
import generatePhotoForExtendedMediaPreview from '@core/media/generatePhotoForExtendedMediaPreview'
import type { Message } from '@core/models'
import prepareAlbum from '@components/prepareAlbum'
import wrapMediaSpoiler from '@components/wrappers/mediaSpoiler'
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
  autoDownload, uploadPromises, videoTimes, spoilered, animationGroup,
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
   * Скрыть спойлером ВЕСЬ альбом, независимо от признака у сообщений (tweb
   * `spoilered`). Живой предмет у оригинала один — неоплаченное платное медиа
   * (`spoilered: !isAlreadyPaid`, bubbles.ts:8953): купленного никто не видел,
   * поэтому крышка кладётся на каждую ячейку.
   */
  spoilered?: boolean
  /** группа `animationIntersector` для точек спойлера (tweb `animationGroup`) */
  animationGroup?: AnimationItemGroup
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
    maxWidth: mediaSizes.active.album.width,
    minWidth: ALBUM_MIN_WIDTH,
    spacing: ALBUM_SPACING,
    forMedia: true,
  })

  // tweb album.ts:63-65 — пиксельный бокс общего контейнера: ячейки размечены в
  // процентах, а спойлеру нужен размер своей ячейки в пикселях.
  const { width, height } = attachmentDiv.style
  const containerWidth = parseInt(width)
  const containerHeight = parseInt(height)

  items.forEach(({ message }, idx) => {
    // tweb album.ts:71 (без ветки `sensitive`, см. шапку)
    const hasSpoiler = spoilered || !!message.mediaSpoiler

    const div = attachmentDiv.children[idx] as HTMLElement
    div.dataset.mid = '' + message.id
    div.dataset.peerId = '' + message.chatId
    const mediaDiv = div.firstElementChild as HTMLElement

    // Медиа ячейки — аналог `getMediaFromMessage` у оригинала: платное медиа до
    // оплаты приезжает БЕЗ `media_id`, и tweb подставляет вместо него
    // ПСЕВДО-ФОТО из превью (`generatePhotoForExtendedMediaPreview`,
    // bubbles.ts:8929-8931). У такого фото единственный размер — stripped-байты,
    // поэтому ячейка перестаёт быть пустой, а `wrapPhoto` показывает превью КАК
    // медиа (`strippedSize`), ничего не скачивая.
    const isPreview = message.mediaId == null
    const media = isPreview ?
      generatePhotoForExtendedMediaPreview(message) :
      {
        mediaId: message.mediaId as number,
        width: message.mediaWidth,
        height: message.mediaHeight,
        strippedThumb: message.mediaBlur,
      }

    // tweb album.ts:82-116 — ветка по типу медиа; у обеих ветвей один и тот же
    // нулевой бокс (размер ячейки уже задан гридом) и один и тот же промис,
    // который уходит в `loadPromises`.
    const thumbPromise = isPreview || isPhotoItem(message) ?
      wrapPhoto({
        mediaId: media.mediaId,
        width: media.width,
        height: media.height,
        strippedThumb: media.strippedThumb,
        thumb: !!message.mediaHasThumb,
        strippedSize: isPreview,
        container: mediaDiv,
        boxWidth: 0,
        boxHeight: 0,
        lazyLoadQueue,
        isVisible,
        middleware,
        loadPromises,
        autoDownloadSize: autoDownload?.photo,
        uploadPromise: uploadPromises?.[idx],
      }) :
      // tweb album.ts:100-115 — не-фото ячейку рисует `wrapVideo` теми же
      // аргументами. `noAutoplayAttribute: true` (и нулевой бокс, из которого
      // враппер выводит `isGroupedItem`) — почему видео в альбоме не
      // автоплеится: иначе крутились бы до десяти файлов разом.
      wrapVideoItem(message, mediaDiv, idx)

    if (thumbPromise) {
      loadPromises?.push(thumbPromise)
    }

    // tweb album.ts:122-148 — крышка кладётся ПОЭЛЕМЕНТНО и только после того,
    // как ячейка построена: спойлеру нужен готовый размер ячейки, а самому
    // медиа под ним ничего не мешает грузиться (кольцо прогресса остаётся под
    // крышкой — `.media-spoiler-container` перекрывает его z-index'ом, а не
    // отменой загрузки).
    if (hasSpoiler && middleware) { // у нас `middleware` опционален, tweb зовёт его безусловно
      const promise = (thumbPromise || Promise.resolve()).then(async() => {
        if (!middleware()) {
          return
        }

        const { width, height } = div.style
        const itemWidth = +width.slice(0, -1) / 100 * containerWidth
        const itemHeight = +height.slice(0, -1) / 100 * containerHeight
        const container = await wrapMediaSpoiler({
          strippedThumb: media.strippedThumb || '',
          // tweb сюда группу не передаёт вовсе (`bubbles.ts` зовёт `wrapAlbum`
          // без `animationGroup`) — у нас тип строгий, и «без группы» пишется
          // пустой строкой `animationIntersector`.
          animationGroup: animationGroup ?? '',
          middleware,
          width: itemWidth,
          height: itemHeight,
        })

        if (!container || !middleware()) {
          return
        }

        mediaDiv.append(container)
      })

      loadPromises?.push(promise)
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
