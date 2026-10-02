/**
 * Порт tweb `src/components/wrappers/stickerSetThumb.ts:1-133` (812502980) —
 * обложка набора стикеров в готовый контейнер (строки установленных наборов
 * вкладки «Стикеры и эмодзи», `sidebarLeft/tabs/stickersAndEmoji.solid.tsx`).
 *
 * Расхождения с оригиналом (следствия нашей модели данных):
 *  1. Ветки `set.thumbs` (`:31-100`: отдельный файл превью набора — lottie,
 *     `<video>` или картинка через `getStickerSetThumbDownloadOptions`) нет: у
 *     нашего `StickerSet` нет `thumbs[]`, обложка адресуется только документом
 *     `thumb_document_id` (шапка `core/managers/stickersManager.ts`). Вместе с
 *     веткой ушёл и параметр `autoplay`: у оригинала его читает только она, а
 *     в ветке документа (`:117-131`) `wrapSticker` зовётся без `play`/`loop`.
 *  2. Обложка-документ (`thumb_document_id`) идёт в `wrapSticker` номером
 *     файла, без плоских полей превью: у оригинала документ достаёт
 *     `appEmojiManager.getCustomEmojiDocument` (`:105`), у нас ручки «документ по
 *     номеру» нет, а загружать ради превью весь набор — лишний запрос на каждую
 *     строку. Набор без обложки — первым документом набора
 *     (`appStickersManager.getStickerSet` → `documents[0]`, `:107`) — у нас
 *     `stickers.getStickerSet({id})`, с его превью и контуром. Правило «обложка,
 *     иначе первый стикер» — то же, что у панели (`core/stickers/setThumb.ts`).
 *  3. `textColor`/`EMOJI_TEXT_COLOR` (`:113-131`) нет: кастомных эмодзи с
 *     `text_color` у нас нет (шапка `wrappers/sticker.ts`).
 *  4. `managers` — наш `Managers` главного потока (`client/bootstrap`), а не
 *     `rootScope.managers`: вызывающий передаёт `tab.managers`.
 */
import type { Managers } from '@/client/bootstrap'
import type { AnimationItemGroup } from '@components/animationIntersector'
import type { LazyLoadQueue } from '@core/lazyLoadQueue'
import { getPathThumb, getStrippedThumb } from '@core/media/messageMedia'
import type { StickerSet } from '@core/managers/stickersManager'
import type { Middleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import wrapSticker from './sticker'

export default async function wrapStickerSetThumb({ set, lazyLoadQueue, container, group, width, height, managers, middleware }: {
  set: StickerSet
  lazyLoadQueue: LazyLoadQueue
  container: HTMLElement
  group: AnimationItemGroup
  width: number
  height: number
  managers: Pick<Managers, 'stickers'>
  middleware: Middleware
}) {
  if(set.thumb_document_id) {
    wrapSticker({
      mediaId: set.thumb_document_id,
      div: container,
      group,
      lazyLoadQueue,
      width,
      height,
      middleware,
    }).render.catch(noop)
    return
  }

  const { stickers } = await managers.stickers.getStickerSet({ id: set.id })
  const doc = stickers[0]
  if(!doc || !middleware()) {
    return
  }

  // as thumb will be used first sticker (tweb :120)
  wrapSticker({
    mediaId: doc.id,
    div: container,
    group,
    lazyLoadQueue,
    width,
    height,
    middleware,
    thumb: getStrippedThumb(doc),
    pathThumb: getPathThumb(doc),
    docWidth: doc.w,
    docHeight: doc.h,
  }).render.catch(noop)
}
