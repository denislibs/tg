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
 *  • вход — наши `MessageReal[]` вместо `Message.message[]` MTProto; вложение из них
 *    достаётся так же, как в оригинале, — `getMediaFromMessage`, и дальше
 *    ветвление идёт по САМОМУ вложению (`media._ === 'photo'`);
 *  • ветка `media` (album.ts:38-46, `noGroupedItem`/`data-index`) не портирована:
 *    в tweb она обслуживает ПРЕДПРОСМОТР ОТПРАВКИ (попап «прикрепить»), где
 *    сообщений ещё нет. Наш попап отправки — React (`SendMediaPopup`) и в
 *    периметр порта ленты не входит; заводить второй вход без вызывающего =
 *    мёртвый код. Сам `prepareAlbum` опцию `noGroupedItem` поддерживает;
 *  • ветка `sensitive` (18+) не портирована — вместе с самой подсистемой
 *    «чувствительный контент» (модерация, аккаунт-настройка, проверка
 *    возраста), см. шапку `components/wrappers/mediaSpoiler.ts`. Признак
 *    `spoilered` и `messageMedia.pFlags.spoiler` портированы полностью;
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
import {
  choosePhotoSize,
  getExtendedMediaPreview,
  getMediaFromMessage,
  isMediaSpoiler,
  type MyDocument,
} from '@core/media/messageMedia'
import type { MessageReal } from '@core/models'
import { isLocalMessageId } from '@core/history/messageId'
import prepareAlbum from '@components/prepareAlbum'
import wrapMediaSpoiler from '@components/wrappers/mediaSpoiler'
import wrapPhoto from '@components/wrappers/photo'
import wrapVideo from '@components/wrappers/video'
import type { CancellablePromise } from '@helpers/cancellablePromise'
import type { Middleware } from '@helpers/middleware'

/** tweb album.ts:57 — зазор между ячейками альбома */
const ALBUM_SPACING = 1
/** tweb album.ts:56 — минимальная ширина ячейки для `Layouter` */
const ALBUM_MIN_WIDTH = 100
/** tweb album.ts:43 — бокс, по которому выбирается ступень ячейки-фотографии */
const ALBUM_ITEM_BOX = 480

export default function wrapAlbum({
  messages, attachmentDiv, middleware, lazyLoadQueue, isVisible, loadPromises,
  autoDownload, uploadPromises, videoTimes, spoilered, animationGroup,
}: {
  messages: MessageReal[]
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
  const items = messages.map((message) => {
    // tweb album.ts:40 `getMediaFromMessage(message, true)`. Платное медиа до
    // оплаты приезжает не медиа, а ПРЕВЬЮ (`messageExtendedMediaPreview`);
    // оригинал подставляет вместо него псевдо-фото и отдаёт альбому параметром
    // `media` (bubbles.ts:8926-8931), а мы эту ветку не портировали (см. шапку)
    // — поэтому подстановка стоит здесь. У псевдо-фото ступень одна и она же
    // stripped, поэтому `wrapPhoto` покажет её КАК медиа и ничего не скачает
    // (ранний выход photo.ts:207).
    const preview = getExtendedMediaPreview(message)
    const media = preview ? generatePhotoForExtendedMediaPreview(preview) : getMediaFromMessage(message)

    // tweb album.ts:42-44 — пропорции ячейки: у фотографии их даёт ступень,
    // выбранная под 480×480, у документа — его собственная геометрия.
    const size = media?._ === 'photo' ? choosePhotoSize(media, ALBUM_ITEM_BOX, ALBUM_ITEM_BOX) : undefined
    return { message, media, size }
  })

  prepareAlbum({
    container: attachmentDiv,
    items: items.map(({ media, size }) => media?._ === 'document' ?
      { w: media.w ?? 0, h: media.h ?? 0 } :
      { w: size?.w ?? 0, h: size?.h ?? 0 }),
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

  items.forEach(({ message, media, size }, idx) => {
    // tweb album.ts:70-71 (без ветки `sensitive`, см. шапку)
    const hasSpoiler = spoilered || isMediaSpoiler(message)

    const div = attachmentDiv.children[idx] as HTMLElement
    div.dataset.mid = '' + message.id
    div.dataset.peerId = '' + message.peerId
    const mediaDiv = div.firstElementChild as HTMLElement

    // tweb album.ts:81-116 — ветка по САМОМУ вложению; у обеих ветвей один и
    // тот же нулевой бокс (размер ячейки уже задан гридом) и один и тот же
    // промис, который уходит в `loadPromises`.
    const thumbPromise = !media ? undefined : media._ === 'photo' ?
      wrapPhoto({
        photo: media,
        // ступень ячейки уже выбрана выше — по ней же считался грид
        // (tweb album.ts:93 `size`)
        size,
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
      wrapVideoItem(media, message, mediaDiv, idx)

    if (thumbPromise) {
      loadPromises?.push(thumbPromise)
    }

    // tweb album.ts:122-148 — крышка кладётся ПОЭЛЕМЕНТНО и только после того,
    // как ячейка построена: спойлеру нужен готовый размер ячейки, а самому
    // медиа под ним ничего не мешает грузиться (кольцо прогресса остаётся под
    // крышкой — `.media-spoiler-container` перекрывает его z-index'ом, а не
    // отменой загрузки).
    // `media` в условии — у нас вложения может не быть вовсе (сообщение без
    // медиа в группе), у tweb оно гарантировано формой `Message.message`
    if (hasSpoiler && middleware && media) { // `middleware` у нас опционален, tweb зовёт его безусловно
      const promise = (thumbPromise || Promise.resolve()).then(async() => {
        if (!middleware()) {
          return
        }

        const { width, height } = div.style
        const itemWidth = +width.slice(0, -1) / 100 * containerWidth
        const itemHeight = +height.slice(0, -1) / 100 * containerHeight
        const container = await wrapMediaSpoiler({
          // tweb album.ts:132 `media` — ступень stripped-превью крышка достаёт
          // из вложения сама
          media,
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

  function wrapVideoItem(doc: MyDocument, message: MessageReal, mediaDiv: HTMLElement, idx: number) {
    return wrapVideo({
      doc,
      container: mediaDiv,
      message: {
        mid: message.id,
        peerId: message.peerId,
        date: message.date,
        mediaUnread: message.pFlags.media_unread,
        // tweb `pFlags.is_outgoing` — у нас оптимистичный id до ack (core/messageToConvMsg.ts:98)
        isOutgoing: isLocalMessageId(message.id),
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
