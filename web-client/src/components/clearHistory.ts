// Порт tweb `src/components/clearHistory.ts` (90 строк) — подтверждение «Очистить
// историю» из меню диалога (`components/dialogsContextMenu.ts`, пункт `ClearHistory`),
// форма tdesktop `DeleteMessagesBox` в режиме `justClear`.
//
// ВРЕМЕННО до 2C-6: `confirmationPopup` — vanilla (`popups/popupPeer.ts`).
//
// Расхождения:
//  1. О-89 волна 7: чекбоксы «удалить и у собеседника» (`ClearHistoryOptionAlso`) и
//     «у всех» в своей группе (`DeleteMessagesOptionAlsoChat`), а с ними `revoke` —
//     на бэкенде очистка только у себя (`DELETE /chats/{id}/history?just_clear=1`,
//     `chatsManager.clearHistory`). Канал у оригинала чистится у всех всегда
//     (`revoke: isBroadcast`) — у нас тоже только у себя.
//  2. Пир — из зеркала главного потока (`cachedPeer`), имя в тексте — `PeerTitle`
//     с миддлварью попапа (как `popups/deleteDialog.ts`, расхождение 6).
import type { FormatterArguments, LangPackKey } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import { getMiddleware } from '@helpers/middleware'
import PeerTitle, { type PeerTitleManagers } from '@components/chat/peerTitle'
import { toastNew } from '@components/toast'
import { confirmationPopup } from '@components/popups/popupPeer'
import canClearHistory from '@core/peers/canClearHistory'
import { cachedPeer } from '@core/peerCache'
import type { Managers } from '@/client/bootstrap'

export type ClearHistoryManagers = PeerTitleManagers & {
  chats: Pick<Managers['chats'], 'clearHistory'>
}

export default async function clearHistoryWithConfirmation(options: {
  peerId: PeerId,
  managers: ClearHistoryManagers
}) {
  const { peerId, managers } = options
  const peer = cachedPeer(peerId)
  if(!canClearHistory(peer)) {
    return false
  }

  // `canClearHistory` has already ruled out everything else this peer could be
  const chat = peer!._ === 'chat' || peer!._ === 'channel' ? peer : undefined
  const isBroadcast = chat?._ === 'channel' && !chat.pFlags?.megagroup

  const middlewareHelper = getMiddleware()
  const wrapPeerTitle = () => new PeerTitle({ peerId, middleware: middlewareHelper.get(), managers }).element

  let descriptionLangKey: LangPackKey,
    descriptionLangArgs: FormatterArguments | undefined
  if(peer!._ === 'user') {
    if(peerId === rootScope.myId) {
      descriptionLangKey = 'AreYouSureClearHistorySavedMessages'
    } else {
      descriptionLangKey = 'AreYouSureClearHistoryWithUser'
      descriptionLangArgs = [wrapPeerTitle()]
      // О-89 волна 7: чекбокс `ClearHistoryOptionAlso` — расхождение 1
    }
  } else if(isBroadcast) {
    descriptionLangKey = 'AreYouSureClearHistoryWithChannel'
    descriptionLangArgs = [wrapPeerTitle()]
  } else {
    descriptionLangKey = 'AreYouSureClearHistory'
    // О-89 волна 7: чекбокс `DeleteMessagesOptionAlsoChat` у создателя — расхождение 1
  }

  try {
    await confirmationPopup({
      peerId,
      managers,
      titleLangKey: 'AlertClearHistory',
      descriptionLangKey,
      descriptionLangArgs,
      button: {
        langKey: 'AlertClearHistory',
        isDanger: true,
      },
    })
  } catch {
    return false
  } finally {
    middlewareHelper.destroy()
  }

  try {
    // Всё остальное (`flushStoragesByPeerId`, строка диалога, окно зеркала) делает
    // воркер и объявляет `dialog_flush` — как `flushHistory` оригинала.
    await managers.chats.clearHistory(peerId)
    return true
  } catch(error) {
    console.error('clear history error', error)
    toastNew({ langPackKey: 'Error.AnError' })
    return false
  }
}
