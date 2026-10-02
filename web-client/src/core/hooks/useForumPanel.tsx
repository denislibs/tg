import { useEffect, useState } from 'react'
import { useSetTransition } from './useSetTransition'
import classNames from '../../shared/lib/classNames'
import s from '../../components/Sidebar.module.scss'
import TopicsPanel from '../../components/TopicsPanel'
import type { TopicRow } from '../managers/groupsManager'
import { cachedPeer } from '../peerCache'
import { getPeerTitle } from '../peers/getPeerTitle'

/** Форум, чья панель тем открыта: ключ пира и имя для шапки панели. */
export type ForumPanelChat = { id: string, name: string }

/** tweb `ForumTab.toggle` (`components/forumTab/forumTab.ts:41-50`): SetTransition
 *  с duration 300 — та же длительность, что у `transitionDrawersParent`
 *  (`appDialogsManager.ts:1641-1656`). */
const FORUM_TRANSITION_TIME = 300

// Форум-группа (tweb toggleForumTabByPeerId): клик по ней открывает панель топиков
// СЛЕВА поверх списка чатов — правая колонка не трогается. Строку форума узнаёт
// клик списка (`appDialogsManager.setListClickListener`, хук `openForum`) и зовёт
// `openForum` — ВРЕМЕННО до 1-6 (форум-таб tweb `forumTab/*`).
//
// Анимация панели — 1:1 tweb `.topics-container` (`_topics.scss:11-45`):
// плавающая панель стоит на `translateX(100%)`, а классы `is-visible`/`forwards`/
// `animating`/`backwards` от SetTransition (`forumTab.ts:41-50`) везут её в 0
// с in-кривой на открытии и out-кривой на закрытии. Здесь их даёт useSetTransition
// (порт singleTransition.ts), а узел живёт в DOM до конца ухода.
export function useForumPanel({ onSelect, activeTopicId, onOpenTopic }: {
  onSelect: (id: string) => void
  activeTopicId: number | null
  onOpenTopic: (chatId: number, topic: TopicRow) => void
}) {
  const [forumChat, setForumChat] = useState<ForumPanelChat | null>(null)

  // Узел панели живёт, пока играет уход (роль AnimatePresence): tweb снимает
  // ForumTab только в `onCloseAfterTimeout` по концу перехода (forumTab.ts:46-48).
  const [rendered, setRendered] = useState<ForumPanelChat | null>(null)
  useEffect(() => {
    if (forumChat) {
      setRendered(forumChat)
      return
    }
    const id = window.setTimeout(() => setRendered(null), FORUM_TRANSITION_TIME)
    return () => window.clearTimeout(id)
  }, [forumChat])

  // `useRafs: firstTime ? 2 : undefined` (forumTab.ts:49): на первом показе узел
  // только что добавлен в DOM, и класс приходится вешать следующим кадром —
  // иначе браузеру не от чего анимировать transform.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!forumChat || !rendered) {
      setShown(false)
      return
    }
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [forumChat, rendered])
  const cls = useSetTransition(shown, 'is-visible', FORUM_TRANSITION_TIME)

  const openForum = (peerId: PeerId) => {
    setForumChat({ id: String(peerId), name: getPeerTitle({ peerId, peer: cachedPeer(peerId) }) })
  }

  const panel = rendered && (
    <div className={classNames(s.forumPanel, cls)}>
      <TopicsPanel
        chatId={Number(rendered.id)}
        chatName={rendered.name}
        activeRootMsgId={activeTopicId}
        onClose={() => setForumChat(null)}
        onOpenTopic={(topic) => onOpenTopic(Number(rendered.id), topic)}
        onViewAsMessages={() => {
          setForumChat(null)
          onSelect(rendered.id)
        }}
      />
    </div>
  )

  // tweb `appDialogsManager.toggleForumTab()` без пира — закрыть панель; его зовёт
  // `closeEverythingInsideNaturally` колонки при переключении папки.
  const closeForum = () => setForumChat(null)

  return { forumChat, openForum, closeForum, panel }
}
