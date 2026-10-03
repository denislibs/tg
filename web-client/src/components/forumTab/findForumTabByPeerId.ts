// Порт tweb `src/components/forumTab/findForumTabByPeerId.ts` (812502980, 10 строк) — 1:1:
// форум-таб этого пира среди вкладок колонки.
import { ForumTab } from '@components/forumTab/forumTab'

export default function findForumTabByPeerId(
  history: readonly unknown[],
  peerId: PeerId,
) {
  return history.find((tab) => {
    return tab instanceof ForumTab && tab.peerId === peerId
  }) as ForumTab | undefined
}
