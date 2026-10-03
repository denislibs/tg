// Порт tweb `src/components/topPeersList.ts` (812502980) — в объёме `renderTopPeerItem` (:13-35).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. `createTopPeersList` (:37-95) не портирован: он читает `appUsersManager.getTopPeers`
//     (`contacts.getTopPeers`), а ручки топа собеседников у нас нет (расхождение 46
//     `components/appSearchSuper.ts`).
//  2. Опций строки `onlyFirstName`, `noIcons` и `withStories` у нашего `DialogElement` нет
//     (С4 шапки `lib/appDialogsManager.ts`): плитка несёт полное имя, без колец историй.
//  3. `managers` строки — явный параметр (у оригинала строка берёт синглтон, С1 там же).
import { addDialogNew, type DialogRowManagers } from '@lib/appDialogsManager'
import type { Middleware } from '@helpers/middleware'

/**
 * Renders one peer the way the left sidebar's search renders its top-peers row: a bigger avatar
 * over a first-name-only title, no subtitle, no status icons. Shared so surfaces that show the
 * same "people" tiles from a different source — the empty-column Chats tip card — look identical
 * to the search instead of re-implementing the item.
 */
export function renderTopPeerItem({ peerId, container, middleware, managers, autonomous = true }: {
  peerId: PeerId,
  container: HTMLElement,
  middleware: Middleware,
  managers: DialogRowManagers,
  autonomous?: boolean,
}) {
  const dialog = addDialogNew({
    peerId,
    container,
    avatarSize: 'bigger',
    autonomous,
    wrapOptions: {
      middleware,
    },
    managers,
  })

  dialog.dom.subtitleEl.remove()

  return dialog
}
