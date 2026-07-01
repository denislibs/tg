import { useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import { slideInRight } from '../motion'
import { useT, useLang } from '../i18n'
import type { Lang } from '../i18n'
import Avatar from '../shared/ui/Avatar'
import { useDiscussion } from '../core/hooks/useDiscussion'
import s from './DiscussionView.module.scss'

// Заголовок треда «N комментариев» (tweb: Chat.Title.Comments). Русский/укр — по
// славянским правилам плюрализации (1 / 2-4 / 5+); прочие локали — англо-стиль.
function commentsTitle(count: number, lang: Lang, t: (s: string) => string): string {
  if (count === 0) return t('Comments')
  if (lang === 'ru' || lang === 'uk') {
    const m10 = count % 10
    const m100 = count % 100
    let word: string
    if (m10 === 1 && m100 !== 11) word = lang === 'ru' ? 'комментарий' : 'коментар'
    else if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) word = lang === 'ru' ? 'комментария' : 'коментарі'
    else word = lang === 'ru' ? 'комментариев' : 'коментарів'
    return `${count} ${word}`
  }
  return `${count} ${count === 1 ? t('Comment') : t('Comments')}`
}

export default function DiscussionView({
  channelId,
  postId,
  discussionChatId,
  post,
  onBack,
}: {
  channelId: number
  postId: number
  discussionChatId: number
  post: { title?: string; text?: string; gradient?: string; emoji?: string }
  onBack: () => void
}) {
  const t = useT()
  const [lang] = useLang()
  const { comments, count, send } = useDiscussion(channelId, postId, discussionChatId)
  const [draft, setDraft] = useState('')
  const [pinnedHidden, setPinnedHidden] = useState(false)
  const postRef = useRef<HTMLDivElement>(null)

  const submit = () => {
    if (!draft.trim()) return
    send(draft)
    setDraft('')
  }

  // Клик по плашке — скролл к посту (первому сообщению); поведение как в tweb.
  const jumpToPost = () => postRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const postPreview = post.text || post.title || t('Message')

  return (
    <motion.div
      className={s.root}
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* Header — «N комментариев» */}
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--tg-textPrimary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)" className={s.title}>
          {commentsTitle(count, lang, t)}
        </Text>
      </div>

      {/* Pinned-плашка исходного поста (tweb .pinned-message в topbar-floating-plates) */}
      {!pinnedHidden && (
        <div className={s.pinned} onClick={jumpToPost}>
          <div className={s.pinnedLine} />
          <div className={s.pinnedBody}>
            <Text size={13} weight={600} color="var(--tg-accent)" style={{ lineHeight: 1.2 }}>
              {t('Pinned message')}
            </Text>
            <Text noWrap size={13.5} color="var(--tg-textSecondary)">
              {postPreview}
            </Text>
          </div>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); setPinnedHidden(true) }}
            color="var(--tg-textFaint)"
          >
            <TgIcon name="close" size={20} />
          </IconButton>
        </div>
      )}

      {/* Body */}
      <div className={s.body}>
        {/* Исходный пост — первое сообщение треда */}
        <div className={s.post} ref={postRef}>
          {post.gradient && (
            <div className={s.postMedia} style={{ background: post.gradient }}>
              {post.emoji}
            </div>
          )}
          {post.title && (
            <Text weight={700} size={15} color="var(--tg-textPrimary)" style={{ marginBottom: '2px' }}>
              {post.title}
            </Text>
          )}
          {post.text && <Text size={15} color="var(--tg-textPrimary)">{post.text}</Text>}
        </div>

        {/* Сервис-сообщение «Начало обсуждения» (tweb messageActionDiscussionStarted) */}
        <div className={s.service}>
          <div className={s.serviceMsg}>{t('Discussion started')}</div>
        </div>

        {/* Комментарии */}
        {comments.map((c) =>
          c.out ? (
            <div key={c.key} className={s.rowOut}>
              <div className={s.bubbleOut}>
                <Text size={15}>{c.text}</Text>
                <Text size={12} color="rgba(255,255,255,0.7)" style={{ textAlign: 'right', marginTop: '2px' }}>
                  {c.time}
                </Text>
              </div>
            </div>
          ) : (
            <div key={c.key} className={s.rowIn}>
              <Avatar background={c.color} size="xs" text={c.name.charAt(0)} />
              <div className={s.bubbleIn}>
                <Text size={13.5} weight={600} color={c.color}>{c.name}</Text>
                <Text size={15} color="var(--tg-textPrimary)">{c.text}</Text>
                <Text size={12} color="var(--tg-textFaint)" style={{ textAlign: 'right', marginTop: '2px' }}>
                  {c.time}
                </Text>
              </div>
            </div>
          )
        )}
      </div>

      {/* Footer composer */}
      <div className={s.composer}>
        <input
          className={s.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={t('Comment')}
        />
        <div className={s.sendBtn} onClick={submit}>
          <TgIcon name="microphone" size={22} color="#fff" />
        </div>
      </div>
    </motion.div>
  )
}
