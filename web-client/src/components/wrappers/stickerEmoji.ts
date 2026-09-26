/**
 * Порт tweb `src/components/wrappers/stickerEmoji.ts` (812502980, 28 строк) —
 * анимированный стикер эмодзи в готовый контейнер (заставки мастера 2FA 🔐/💡/🥳).
 * Нет стикера для эмодзи — контейнер получает `media-sticker-wrapper` (место
 * под заставку остаётся) и промис отклоняется `no sticker`, как у оригинала.
 *
 * Отличия от оригинала:
 *  1. Документ — `core/animatedEmoji.ts::getAnimatedEmoji` (набор
 *     `animated_emoji`, наш аналог `appStickersManager.getAnimatedEmojiSticker`),
 *     а не менеджер воркера; `managers` в опциях поэтому нет.
 *  2. Вход нашего `wrapSticker` — `mediaId` + плоские поля документа
 *     (`thumb`/`pathThumb`/`docWidth`/`docHeight`), а не `doc` (шапка
 *     `wrappers/sticker.ts`); их заполняет эта функция.
 */
import { getAnimatedEmoji } from '@core/animatedEmoji'
import { getPathThumb, getStrippedThumb } from '@core/media/messageMedia'
import wrapSticker, { type WrapStickerOptions } from './sticker'

export default async function wrapStickerEmoji(options: Omit<WrapStickerOptions, 'mediaId'> & { emoji: string }) {
  const { emoji, div } = options
  const doc = await getAnimatedEmoji(emoji)
  if(!doc) {
    div.classList.add('media-sticker-wrapper')
    throw new Error('no sticker')
  }

  return wrapSticker({
    mediaId: doc.id,
    thumb: getStrippedThumb(doc),
    pathThumb: getPathThumb(doc),
    docWidth: doc.w,
    docHeight: doc.h,
    play: true,
    loop: false,
    ...options,
  })
}
