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
 *  • `videoTimes` (готовые `.video-time` от вызывающего) не портирован: их
 *    строит видео-путь бабла, которого ещё нет (см. шов ниже);
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
  autoDownload, uploadPromises,
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

    if (!isPhotoItem(message)) {
      // ШОВ ПОД `wrapVideo` (пишется следующей задачей). Оригинал здесь зовёт
      //   wrapVideo({doc: media, container: mediaDiv, message, boxWidth: 0,
      //     boxHeight: 0, withTail: false, isOut, lazyLoadQueue, middleware,
      //     loadPromises, autoDownload, noAutoplayAttribute: true,
      //     uploadingFileName: uploadingFileName?.[idx]})
      // — с ТЕМИ ЖЕ аргументами, что перечислены выше (album.ts:100-115).
      // До появления враппера видео-ячейка остаётся ПУСТОЙ: подменять её
      // картинкой нельзя — у видео свой слой (постер, `.video-time`,
      // play-кнопка, автоплей), и такая подмена показала бы пользователю не то,
      // молча и правдоподобно. Геометрия ячейки при этом уже верная: грид
      // считается по размерам ВСЕХ элементов, включая видео.
      return
    }

    if (message.mediaId == null) {
      // Платное медиа до оплаты: сервер `media_id` не отдаёт вовсе, качать
      // нечего. Плейсхолдер с оверлеем «разблокировать» — отдельная работа
      // (у tweb это `wrapMediaSpoiler`, которого в дереве нет); просить URL по
      // `null` нельзя, а рисовать пустую картинку — врать.
      return
    }

    const thumbPromise = wrapPhoto({
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

    loadPromises?.push(thumbPromise)
  })
}
