// «Новый секретный чат» (наша фича, E2E; Отступление В7-1 плана волны 7): рукопожатие
// `managers.secret.start` с выбранным контактом, статус «ожидание» и открытие созданного чата.
// ЧИСТАЯ функция поверх сторов, без React, — по той же причине, что `openPeer.ts` рядом: её
// зовёт Solid-вкладка контактов (`sidebarLeft/tabs/contacts.solid.tsx`, опция `{secret: true}`,
// пункт `#new-menu` «Новый секретный чат»).
//
// Контакт берётся из адресной книги, и личного диалога с ним может не быть — поэтому собеседник
// адресуется ключом пользователя, а не строкой списка. Созданный чат — новый пир: ветки
// черновика (`useNavigationActions::onChatCreated`) у него не бывает, открытие — `selectChat` и
// перечитывание списка, как у только что созданной группы.
import type { Managers } from '@/client/bootstrap'
import { useNavigationStore } from '@stores/navigationStore'
import { useSecretChatStore } from '@stores/secretChatStore'

export type StartSecretChatManagers = Pick<Managers, 'secret' | 'dialogs'>

export async function startSecretChat(managers: StartSecretChatManagers, userId: PeerId): Promise<void> {
  const { peerId } = await managers.secret.start(userId)
  useSecretChatStore.getState().setStatus(peerId, 'awaiting')
  useNavigationStore.getState().selectChat(String(peerId))
  // `.catch`: fire-and-forget, `refresh()` пробрасывает HttpError
  void managers.dialogs.refresh().catch(() => {})
}
