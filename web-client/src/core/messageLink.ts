// Ссылка на конкретное сообщение («Copy Message Link» в меню бабла) и прыжок к
// сообщению при открытии чата.
//
// Ссылка — как у tweb (`contextMenu.ts::getUrlToMessage`): `t.me/<username>/<mid>`
// у чата с юзернеймом, `t.me/c/<chatId>/<mid>` у остальных, только на своём
// хосте ссылок (`core/publicLink.ts`). Хэш навигации разбирает
// `appImManager.onHashChange` (порт tweb: `#@имя`, `#<peerId>`, `#/im?p=…&post=`);
// хэши страницы бэкенда `#@имя/<seq>` и `#<peerId>/<seq>` он не принимает — Б-48.
//
// Якорь сообщения — `seq` (порядковый номер сообщения В ЧАТЕ), а не глобальный
// `id`: именно им оперирует прыжок (`setPendingJump(peerId, seq)`), и он же
// аналог телеграмного `mid` — номера внутри чата, а не по всей базе.
import { useSearchStore } from '@stores/searchStore'
import { toChatId } from '@core/peers/peerId'
import { publicPrivatePostLink, publicUsernameLink } from './publicLink'

/**
 * Ссылка на сообщение для буфера обмена (tweb `getUrlToMessage`, без веток
 * треда/комментария — см. шапку `components/chat/contextMenu.ts`).
 */
export function buildMessageLink({
  peerId,
  username,
  seq,
}: {
  peerId: PeerId
  username?: string | null
  seq: number
}): string {
  return username ? publicUsernameLink(username, seq) : publicPrivatePostLink(toChatId(peerId), seq)
}

/**
 * Поставить прыжок к сообщению, который потребит лента чата при открытии
 * (`Chat.tsx` читает `pendingJump` ровно так же для перехода из поиска).
 */
export function requestMessageJump(peerId: PeerId, seq: number): void {
  useSearchStore.getState().setPendingJump(peerId, seq)
}
