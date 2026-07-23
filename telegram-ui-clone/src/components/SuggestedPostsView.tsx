// «Предложенные посты» (Telegram suggested posts): оверлей со списком предложек
// канала. mode='admin' — все ожидающие с действиями «Опубликовать» / по времени /
// «Отклонить»; mode='author' — свои предложки с бейджем статуса (на рассмотрении /
// одобрено / отклонено). Список живёт в suggestedPostsStore, live — realtimeBridge.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import RichText from './RichText'
import SchedulePopup from './SchedulePopup'
import { useSuggestedPosts } from '../core/hooks/useSuggestedPosts'
import type { SuggestedPost, SuggestedPostStatus } from '../core/models'
import { useLang, useT } from '../i18n'
import { EASE } from '../motion'
import s from './SuggestedPostsView.module.scss'

const statusKey: Record<SuggestedPostStatus, string> = {
  pending: 'On review',
  approved: 'Approved',
  rejected: 'Rejected',
}

export default function SuggestedPostsView({ chatId, mode, onClose }: {
  chatId: number
  mode: 'admin' | 'author'
  onClose: () => void
}) {
  const t = useT()
  const [lang] = useLang()
  const { posts, approve, reject } = useSuggestedPosts(chatId)
  // Кому назначаем время публикации при одобрении (id поста) — открывает пикер.
  const [scheduleFor, setScheduleFor] = useState<number | null>(null)

  const list: SuggestedPost[] = (posts ?? []).filter((p) => (mode === 'admin' ? p.status === 'pending' : true))

  const fmtWhen = (ms: number) => {
    const d = new Date(ms)
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return `${d.toLocaleDateString(lang)}, ${hm}`
  }

  return createPortal(
    <div className={s.overlay} onClick={onClose}>
      <motion.div
        className={s.card}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: EASE }}
      >
        <div className={s.header}>
          <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
            {t('Suggested Posts')}
          </Text>
          <IconButton onClick={onClose} color="var(--tg-textSecondary)" aria-label={t('Close')}>
            <TgIcon name="close" size={22} />
          </IconButton>
        </div>
        <div className={s.list}>
          {posts != null && list.length === 0 && (
            <Text size={14.5} color="var(--tg-textSecondary)" style={{ padding: '2rem 1rem', textAlign: 'center', display: 'block' }}>
              {t('No suggested posts here yet…')}
            </Text>
          )}
          {list.map((p) => (
            <div key={p.id} className={s.row}>
              <div className={s.bubble}>
                <div className={s.bubbleHead}>
                  {mode === 'admin' && p.authorName && (
                    <Text size={12.5} color="var(--tg-accent)" weight={600}>{p.authorName}</Text>
                  )}
                  {mode === 'author' && (
                    <Text size={12.5} weight={600} color={p.status === 'rejected' ? '#ff595a' : 'var(--tg-accent)'}>
                      {t(statusKey[p.status])}
                    </Text>
                  )}
                  {p.publishAt != null && (
                    <Text size={12} color="var(--tg-textSecondary)">
                      <TgIcon name="schedule" size={12} /> {fmtWhen(p.publishAt)}
                    </Text>
                  )}
                </div>
                <Text size={15} color="var(--tg-textPrimary)" style={{ wordBreak: 'break-word' }}>
                  <RichText text={p.text} entities={p.entities} linkColor="var(--tg-link)" />
                </Text>
              </div>
              {mode === 'admin' && p.status === 'pending' && (
                <div className={s.actions}>
                  <IconButton size="small" onClick={() => { void approve(p.id) }} title={t('Publish')} aria-label={t('Publish')}>
                    <TgIcon name="check" size={18} color="var(--tg-accent)" />
                  </IconButton>
                  <IconButton size="small" onClick={() => setScheduleFor(p.id)} title={t('Schedule')} aria-label={t('Schedule')}>
                    <TgIcon name="schedule" size={18} color="var(--tg-accent)" />
                  </IconButton>
                  <IconButton size="small" onClick={() => { void reject(p.id) }} title={t('Reject')} aria-label={t('Reject')}>
                    <TgIcon name="close" size={18} color="#ff595a" />
                  </IconButton>
                </div>
              )}
            </div>
          ))}
        </div>
      </motion.div>

      {scheduleFor != null && (
        <SchedulePopup
          onClose={() => setScheduleFor(null)}
          onPick={(unixSeconds) => {
            const id = scheduleFor
            setScheduleFor(null)
            if (id != null) void approve(id, unixSeconds)
          }}
        />
      )}
    </div>,
    document.body,
  )
}
