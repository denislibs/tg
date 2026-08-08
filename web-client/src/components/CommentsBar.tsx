import TgIcon from './TgIcon'
import StackedAvatars, { type StackedAvatarPeer } from './messages/StackedAvatars'
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
// хардкод из трёх выдуманных градиентов (P0 №11 аудита). Реальных отдаёт бэкенд
// в `recent_repliers` ответа /channels/{id}/comment_counts — до трёх последних
// комментаторов, новейшие первыми (usecase/chat/discussion.go CommentCounts).
export default function CommentsBar({ onOpen, count, recent }: {
  onOpen?: () => void
  count?: number
  /** последние ответившие (реальные пиры) — стек аватаров перед подписью */
  recent?: StackedAvatarPeer[]
}) {
  const t = useT()
  const [lang] = useLang()

  return (
    <replies-element class={classNames('replies', 'replies-footer', s.footer)} onClick={onOpen}>
      {!!recent?.length && (
        <div className={classNames('replies-footer-avatars', s.avatars)}>
          <StackedAvatars peers={recent} size={30} />
        </div>
      )}
      <span className={classNames('replies-footer-text', s.label)}>
        <span className="i18n">{commentsLabel(count ?? 0, lang, t)}</span>
      </span>
      <TgIcon name="next" size={24} className={classNames('replies-footer-icon', 'replies-footer-icon-next', s.next)} />
    </replies-element>
  )
}
