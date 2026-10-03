// Ссылка на конкретное сообщение («Copy Message Link» в меню бабла).
//
// Ссылка — как у tweb (`contextMenu.ts::getUrlToMessage`): `t.me/<username>/<mid>`
// у чата с юзернеймом, `t.me/c/<chatId>/<mid>` у остальных, только на своём
// хосте ссылок (`core/publicLink.ts`). Хэш навигации разбирает
// `appImManager.onHashChange` по схеме tweb: `#@имя`, `#<peerId>`, `#@имя?post=<seq>`,
// `#<peerId>?message=<seq>`, `#/im?p=…&post=` (`onHashChangeUnsafe`); кнопка
// публичной страницы бэкенда ведёт на ту же форму (PR #380). Ссылку своего хоста
// (`<tme>/имя/<seq>`) открывает `internalLinkProcessor` (действие `im`).
//
// Якорь сообщения — `seq` (порядковый номер сообщения В ЧАТЕ), а не глобальный
// `id`: именно им оперирует прыжок (`appImManager.setInnerPeer({lastMsgId})`), и
// он же аналог телеграмного `mid` — номера внутри чата, а не по всей базе.
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
