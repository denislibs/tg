/**
 * Порт tweb `src/components/sidebarRight/tabs/permissionsPeerDialog.ts:1-36`
 * (812502980) — строка пользователя над тумблерами вкладки прав участника
 * (`chatUserPermissions.solid.tsx`). Дословно; `addDialogNew`/`createChatList` —
 * функциями `lib/appDialogsManager.ts`, менеджеры строки — параметром (С1),
 * статус — `getUserStatusString` (`core/presence.ts`).
 */
import { getUserStatusString } from '@core/presence'
import type { Middleware } from '@helpers/middleware'
import type { User } from '@core/peers/peer'
import { toPeerId } from '@core/peers/peerId'
import { addDialogNew, createChatList, type DialogRowManagers } from '@lib/appDialogsManager'

export default function appendPermissionsPeerDialog(options: {
  /** The section's content element … */
  content: HTMLElement,
  /** … and its title, which the peer row is placed above. */
  title: HTMLElement,
  userId: UserId,
  user: User | undefined,
  middleware: Middleware,
  managers: DialogRowManagers
}) {
  const container = document.createElement('div')
  container.classList.add('chatlist-container')
  options.content.insertBefore(container, options.title)

  const list = createChatList({ new: true })
  container.append(list)

  const { dom } = addDialogNew({
    peerId: toPeerId(options.userId as number, false),
    container: list,
    rippleEnabled: true,
    avatarSize: 'abitbigger',
    meAsSaved: false,
    wrapOptions: {
      middleware: options.middleware,
    },
    managers: options.managers,
  })

  dom.lastMessageSpan.append(getUserStatusString(options.user))
}
