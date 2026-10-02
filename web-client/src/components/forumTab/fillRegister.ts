// Порт tweb `src/components/forumTab/fillRegister.ts` (812502980, 32 строки):
// какой класс форум-таба у пира. Зовёт его `appDialogsManager.startDialogs`
// (tweb `appDialogsManager.ts:879`).
//
// Расхождение: в реестре только форум-группа (`GroupForumTab`). Монофорума
// (`MonoforumTab`, `pFlags.monoforum`) и ботфорума (`BotforumTab`,
// `bot_forum_view`) на бэкенде нет — О-4, О-3. Пир — из зеркала карточек
// (`cachedPeer`), а не `apiManagerProxy.getPeer`.
import { cachedPeer } from '@core/peerCache'
import { ForumTab } from '@components/forumTab/forumTab'
import { GroupForumTab } from '@components/forumTab/groupForumTab'

let filled = false

export function fillForumTabRegister() {
  // * владелец у нас стартует в тестах многократно (расхождение 1 его шапки) —
  // * реестр заполняется один раз, как у вечного синглтона оригинала
  if(filled) return
  filled = true

  ForumTab.register.addEntry({
    check: (peerId) => {
      const peer = cachedPeer(peerId)
      return !!(peer?._ === 'channel' && peer?.pFlags?.forum)
    },
    payload: GroupForumTab,
  })
}
