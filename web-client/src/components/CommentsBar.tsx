import TgIcon from './TgIcon'
import StackedAvatars from './messages/StackedAvatars'
import { getPeerId, type Peer } from '../core/peers/peerId'
import classNames from '../shared/lib/classNames'
import { useT, useLang } from '../i18n'
import { commentsLabel } from '../core/format/commentsLabel'
import s from './CommentsBar.module.scss'

// Футер комментариев поста канала — разметка tweb (живой DOM §3, «video bubble
// single»): replies-element.replies.replies-footer > .replies-footer-avatars
// .stacked-avatars + span.replies-footer-text + span.replies-footer-icon
// .replies-footer-icon-next.tgico. Клик открывает тред обсуждения.
//
// Аватары комментаторов рисуются ТОЛЬКО по реальным данным: раньше здесь стоял
// хардкод из трёх выдуманных градиентов (P0 №11 аудита). Реальные едут в САМОМ
// ПОСТЕ — `replies.recent_repliers` конструктора `messageReplies`, до трёх
// последних комментаторов, новейшие первыми (usecase/chat/discussion.go
// CommentCounts → messagescontainer.go hydrateThreads). Оригинал берёт их
// оттуда же (tweb appMessagesManager.ts:9237-9247); отдельной ручки со своей
// картой счётчиков больше нет.
export default function CommentsBar({ onOpen, count, recent }: {
  onOpen?: () => void
  count?: number
  /** последние ответившие — ССЫЛКИ на пиров (`Vector<Peer>` треда); стеку
   *  аватаров отдаются КЛЮЧАМИ, имя и фото он берёт из зеркала, как tweb. */
  recent?: Peer[]
}) {
  const t = useT()
  const [lang] = useLang()

  return (
    <replies-element class={classNames('replies', 'replies-footer', s.footer)} onClick={onOpen}>
      {!!recent?.length && (
        <div className={classNames('replies-footer-avatars', s.avatars)}>
          <StackedAvatars peerIds={recent.map(getPeerId)} size={30} />
        </div>
      )}
      <span className={classNames('replies-footer-text', s.label)}>
        <span className="i18n">{commentsLabel(count ?? 0, lang, t)}</span>
      </span>
      <TgIcon name="next" size={24} className={classNames('replies-footer-icon', 'replies-footer-icon-next', s.next)} />
    </replies-element>
  )
}
