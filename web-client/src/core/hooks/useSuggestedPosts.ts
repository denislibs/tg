import { useCallback, useEffect } from 'react'
import { useManagers } from './useManagers'
import { useSuggestedPostsStore } from '../../stores/suggestedPostsStore'
import type { SuggestPostArgs } from '../managers/channelsManager'
import type { SuggestedPost } from '../models'

// ViewModel предложки постов канала: читает список из стора, грузит его при
// монтировании, отдаёт команды suggest/approve/reject. Live-обновления приходят
// не через хук, а через realtimeBridge (кадр suggested_post_update → стор).
export function useSuggestedPosts(chatId: number) {
  const managers = useManagers()
  const posts = useSuggestedPostsStore((s) => s.byChat[chatId])

  useEffect(() => {
    let alive = true
    void managers.channels.listSuggestedPosts(chatId)
      .then((list) => { if (alive) useSuggestedPostsStore.getState().setList(chatId, list) })
      .catch(() => {})
    return () => { alive = false }
  }, [chatId, managers])

  const suggest = useCallback(async (args: SuggestPostArgs): Promise<SuggestedPost> => {
    const p = await managers.channels.suggestPost(chatId, args)
    useSuggestedPostsStore.getState().apply(chatId, p)
    return p
  }, [chatId, managers])

  const approve = useCallback(async (id: number, publishAt?: number): Promise<SuggestedPost> => {
    const p = await managers.channels.approveSuggestedPost(id, publishAt)
    useSuggestedPostsStore.getState().apply(chatId, p)
    return p
  }, [chatId, managers])

  const reject = useCallback(async (id: number): Promise<SuggestedPost> => {
    const p = await managers.channels.rejectSuggestedPost(id)
    useSuggestedPostsStore.getState().apply(chatId, p)
    return p
  }, [chatId, managers])

  return { posts, suggest, approve, reject }
}
