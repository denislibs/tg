import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import { useT, useLang } from '../i18n'
import { commentsLabel } from '../core/commentsLabel'
import s from './CommentsBar.module.scss'

// Recent-commenter avatars (decorative stack, as tweb shows the last few
// commenters' photos before the label).
const commenters = [
  { bg: 'linear-gradient(135deg,#ff5f6d,#ffc371)', label: 'ДЧ' },
  { bg: 'linear-gradient(135deg,#43e97b,#38f9d7)', label: '' },
  { bg: 'linear-gradient(135deg,#5b5b5b,#1a1a1a)', label: '' },
]

// Channel post replies-footer (tweb .replies.replies-footer): a row attached to
// the bottom of the post bubble — commenter avatars + "N комментариев" + a chevron
// pinned to the end. Clicking opens the discussion thread.
export default function CommentsBar({ onOpen, count }: { onOpen?: () => void; count?: number }) {
  const t = useT()
  const [lang] = useLang()

  return (
    <div className={s.footer} onClick={onOpen}>
      <div className={s.avatars}>
        {commenters.map((c, i) => (
          <div key={i} className={s.avatar} style={{ background: c.bg }}>
            {c.label}
          </div>
        ))}
      </div>
      <Text size={15} weight={700} color="var(--tg-accent)" className={s.label}>
        {commentsLabel(count ?? 0, lang, t)}
      </Text>
      <TgIcon name="next" size={24} color="var(--tg-accent)" className={s.next} />
    </div>
  )
}
