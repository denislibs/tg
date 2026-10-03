// Порт tweb `src/components/wrappers/reply.ts` (812502980) — плашка ответа/правки/
// пересылки над строкой ввода (`ChatInput.setTopInfo`, input.ts:5353).
//
// Расхождения с оригиналом:
//  1. Цвет автора (`setPeerColorToElement`, `wrapPeerColorPattern` с канвасом
//     `reply-background-canvas`) не ставится — подсистемы цветов пира у нас нет
//     (та же оговорка, что у reply-заголовка бабла, `chat/replyContainer.ts`);
//     рамку `quote-like-border` рисует CSS цветом по умолчанию.
//  2. Опции истории (`storyItem`, `isStoryExpired`), `isChatSensitive`,
//     `savedMusicDocId`, `replyHeader`, `canTranslate`, `useHighlightingColor`/
//     `colorAsOut` не перенесены — нет предмета у вызывающих.
import type { MessageEntity, MyMessage } from '@core/models'
import { setDirection } from '@helpers/dom/setInnerHTML'
import ripple from '@components/ripple'
import ReplyContainer from '@components/chat/replyContainer'

export type WrapPinnedContainerOptions = {
  title?: string | HTMLElement | DocumentFragment
  subtitle?: WrapPinnedContainerOptions['title']
  message?: MyMessage
}

export type WrapReplyOptions = WrapPinnedContainerOptions & {
  /** расхождение 1 — принимается, но цвет не ставится */
  setColorPeerId?: PeerId
  isQuote?: boolean
  noBorder?: boolean
  quote?: { text: string, entities?: MessageEntity[] }
}

export default function wrapReply(options: WrapReplyOptions) {
  const replyContainer = new ReplyContainer('reply')
  const fillPromise = replyContainer.fill!(options)

  replyContainer.container.classList.add('quote-like', 'quote-like-hoverable', 'quote-like-border')
  setDirection(replyContainer.container)
  replyContainer.border.remove()
  ripple(replyContainer.container)

  if(options.isQuote) {
    replyContainer.container.classList.add('quote-like-icon')
    replyContainer.container.classList.add('reply-multiline')
  }

  if(options.noBorder) {
    replyContainer.container.classList.remove('quote-like-border')
  }

  if(!options.subtitle && !options.message) {
    replyContainer.container.classList.add('reply-no-subtitle')
    replyContainer.subtitle.remove()
  }

  return { container: replyContainer.container, fillPromise }
}
