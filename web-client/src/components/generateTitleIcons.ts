// Порт tweb `src/components/generateTitleIcons.ts` — значки после имени пира
// (`PeerTitle` с `withIcons`). Потребитель — строка списка чатов
// (`lib/appDialogsManager.ts`, tweb `:403` `withIcons: !noIcons`).
//
// Расхождения (у каждого — отсутствующий у нас предмет):
//  1. Синхронная: пир берётся из зеркала (`core/peerCache.ts`), как и имя в
//     нашем `PeerTitle`; `isPremiumFeaturesHidden` (настройка приложения) у нас
//     нет — ветка премиума без неё.
//  2. Эмодзи-статус — юникод `emoji_status_emoticon` текстом в `span.emoji-status`
//     вместо `wrapEmojiStatus` над документом кастом-эмодзи (решение №6 разбора,
//     шапка `UserReal` в `core/peers/peer.ts`); клик по статусу
//     (`clickableEmojiStatus`) — без потребителя.
//  3. Нет `pFlags.fake`/`scam` (`generateFakeIcon`), `monoforum`
//     (`peer-title-direct-badge`), `bot_verification_icon` — наша модель пира
//     этих полей не объявляет (`core/peers/peer.ts`). `verified` есть только у
//     пользователя.
import type { Chat, User } from '@core/peers/peer'
import { cachedPeer } from '@core/peerCache'
import { wrapEmojiText } from '@lib/richtext'
import generatePremiumIcon from '@components/generatePremiumIcon'
import generateVerifiedIcon from '@components/generateVerifiedIcon'

export default function generateTitleIcons({
  peerId,
  noVerifiedIcon,
  noPremiumIcon,
  peer,
}: {
  peerId: PeerId,
  noVerifiedIcon?: boolean,
  noPremiumIcon?: boolean,
  peer?: Chat | User
}): HTMLElement[] {
  peer ??= cachedPeer(peerId)
  const elements: HTMLElement[] = []
  const user = peer?._ === 'user' ? peer : undefined
  if(!user) {
    return elements
  }

  if(!noPremiumIcon) {
    const emoticon = user.emoji_status_emoticon
    if(emoticon) {
      const container = document.createElement('span')
      container.classList.add('emoji-status')
      container.append(wrapEmojiText(emoticon))
      elements.push(container)
    } else if(user.pFlags?.premium) {
      elements.push(generatePremiumIcon())
    }
  }

  if(user.pFlags?.verified && !noVerifiedIcon) {
    elements.push(generateVerifiedIcon())
  }

  return elements
}
