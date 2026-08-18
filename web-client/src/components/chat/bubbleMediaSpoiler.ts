// Порт приватного метода tweb `ChatBubbles.wrapMediaSpoiler`
// (`components/chat/bubbles.ts:6034-6066`) — крышка спойлера над ОДИНОЧНЫМ
// медиа-баблом (у альбома своя ветка, `wrappers/album.ts:122-148`).
//
// Что делает (дословно оригинал): дожидается промиса самого медиа, сверяет
// актуальность поколения, берёт УЖЕ ПОСТАВЛЕННЫЙ размер контейнера вложения
// (`attachmentDiv.style`, его задал `setAttachmentSize` внутри враппера) и
// кладёт поверх контейнер `.media-spoiler-container`.
//
// Три вещи, которые видно только в связке (и потому здесь, а не в
// `wrappers/mediaSpoiler.ts`):
//  • ЖДЁМ промис медиа — крышке нужен готовый размер `attachmentDiv`; до
//    `setAttachmentSize` он пустой, и точки рисовались бы по нулевому боксу;
//  • ЗАГРУЗКУ НЕ ОТМЕНЯЕМ: медиа под крышкой качается как обычно, вместе со
//    своим кольцом прогресса — крышка просто перекрывает его
//    (`.media-spoiler-container { z-index: 2 }`, `styles/tweb/_bridge.scss`);
//  • АВТОПЛЕЙ гасит ВЫЗЫВАЮЩИЙ, а не крышка: у tweb это
//    `noAutoplayAttribute: !!spoiler` в вызове `wrapVideo` (bubbles.ts:8571) —
//    иначе видео крутилось бы под крышкой. Обратно его включает раскрытие
//    (`onMediaSpoilerClick` → `video.autoplay = true` + `safePlay`).
//
// Клик по крышке в оригинале ловит не она сама, а делегирование контейнера
// ленты (bubbles.ts:3236-3243: `findUpClassName(target, 'media-spoiler-container')`
// → `onMediaSpoilerClick`). Эта строка приедет в `bubbles.ts` вместе с его
// медиа-веткой — там же, где появится и вызывающий этого модуля; сам обработчик
// раскрытия уже портирован (`wrappers/mediaSpoiler.ts`).
import wrapMediaSpoiler from '@components/wrappers/mediaSpoiler'
import type { AnimationItemGroup } from '@components/animationIntersector'
import type { Middleware } from '@helpers/middleware'

export default async function wrapBubbleMediaSpoiler({
  strippedThumb, promise, middleware, attachmentDiv, animationGroup,
}: {
  /** stripped-превью самого сообщения (`Message.mediaBlur`; tweb берёт его из `media`) */
  strippedThumb: string | undefined
  /** промис враппера медиа — tweb `promise` (`wrapPhoto`/`wrapVideo`) */
  promise: Promise<unknown>
  middleware: Middleware
  /** контейнер вложения бабла (tweb `attachmentDiv`) */
  attachmentDiv: HTMLElement
  animationGroup: AnimationItemGroup
}): Promise<void> {
  await promise
  if (!middleware()) {
    return
  }

  const { width, height } = attachmentDiv.style
  const container = await wrapMediaSpoiler({
    strippedThumb: strippedThumb || '',
    width: parseInt(width),
    height: parseInt(height),
    middleware,
    animationGroup,
  })

  // tweb `attachmentDiv.append(container)` без проверки: там `wrapMediaSpoiler`
  // возвращает `undefined` только при полном отсутствии превью, и append(undefined)
  // дописал бы в бабл строку «undefined». Проверка — типовой аналог его
  // раннего выхода `if(!thumb) return`.
  if (!container || !middleware()) {
    return
  }

  attachmentDiv.append(container)
}
