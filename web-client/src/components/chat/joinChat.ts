// Порт tweb `src/components/chat/joinChat.ts` (812502980) — вступление в
// публичный чат по кнопке «Вступить»/«Подписаться» (`input.ts` joinBtn).
//
// Расхождения:
//  • вступление у нас одно — `POST /channels/join {username}` (`channels.join`):
//    ветки `appChatsManager.addChatUser` для basic-группы нет (basic-групп нет),
//    а приватный чат вступается только по ссылке-приглашению (`joinChatInvite`);
//  • `handleChannelsTooMuch` и `handleCommunityChatJoinError` не портированы —
//    лимита каналов и сообществ у сервера нет;
//  • `updates` ответа сервер не шлёт — список диалогов перечитывается сам
//    (`dialogs.refresh`), иначе вступивший чат появится только при следующей
//    reset-загрузке.
import type { Managers } from '@/client/bootstrap'
import { cachedChat } from '@core/peerCache'

export default async function joinChat(options: { peerId: PeerId, managers: Managers }) {
  const { peerId, managers } = options
  const chat = cachedChat(peerId)
  const username = chat && 'username' in chat ? chat.username : undefined
  if(!username) {
    return
  }

  await managers.channels.join(username)
  await managers.dialogs.refresh()
}
