// Модалка «Предложить пост» (tweb suggestPostPopup): участник без права постинга
// предлагает пост в канал — текст + опционально желаемое время публикации. Сверху
// показаны его прошлые предложки с бейджем статуса (на рассмотрении/одобрено/
// отклонено) — так автор видит их судьбу (backend listSuggestedPosts → свои).
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import RichText from './RichText'
import { useSuggestedPosts } from '../core/hooks/useSuggestedPosts'
import type { SuggestedPostStatus } from '../core/models'
import { useT } from '../i18n'
import s from './SuggestPostPopup.module.scss'

const statusKey: Record<SuggestedPostStatus, string> = {
  pending: 'On review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export default function SuggestPostPopup({ chatId, onClose }: {
  chatId: number
  onClose: () => void
}) {
  const t = useT()
  const { posts, suggest } = useSuggestedPosts(chatId)
  const [text, setText] = useState('')
  // Желаемое время публикации (input[type=datetime-local], локальное); пусто — как можно скорее.
  const [when, setWhen] = useState('')
  const [sending, setSending] = useState(false)

  const trimmed = text.trim()
  const canSend = trimmed.length > 0 && !sending

  const submit = () => {
    if (!canSend) return
    setSending(true)
    const ms = when ? new Date(when).getTime() : NaN
    const publishAt = Number.isFinite(ms) && ms > Date.now() ? Math.floor(ms / 1000) : undefined
    void suggest({ text: trimmed, publishAt })
      .then(() => onClose())
      .catch(() => setSending(false))
  }

  const mine = posts ?? []

  return (
    <Popup open title={t('SuggestedPosts.SuggestAPost')} onClose={onClose} width={420} action={{ label: t('SuggestedPosts.Submit'), onClick: submit }}>
      <div className={s.body}>
        {mine.length > 0 && (
          <>
            <Text size={13.5} weight={600} color="var(--primary-color)" className={s.label}>{t('SuggestedPosts.YourSuggestions')}</Text>
            <div className={s.mine}>
              {mine.map((p) => (
                <div key={p.id} className={s.mineRow}>
                  <Text size={12.5} weight={600} color={p.status === 'rejected' ? '#ff595a' : 'var(--primary-color)'} className={s.badge}>
                    {t(statusKey[p.status])}
                  </Text>
                  <Text size={14} color="var(--primary-text-color)" style={{ wordBreak: 'break-word' }}>
                    <RichText text={p.text} entities={p.entities} linkColor="var(--link-color)" />
                  </Text>
                </div>
              ))}
            </div>
          </>
        )}

        <Text size={13.5} weight={600} color="var(--primary-color)" className={s.label}>{t('SuggestedPosts.YourPost')}</Text>
        <textarea
          className={s.textarea}
          rows={4}
          placeholder={t('SuggestedPosts.PostPlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <Text size={13.5} weight={600} color="var(--primary-color)" className={s.label}>{t('SuggestedPosts.PublishingTime.Label')}</Text>
        <input className={s.input} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <Text size={13} color="var(--secondary-text-color)" style={{ padding: '2px 4px' }}>
          {t('SuggestedPosts.PublishingTime.Hint')}
        </Text>
      </div>
    </Popup>
  )
}
