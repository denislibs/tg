// «Предложенные посты» (Telegram suggested posts): оверлей со списком предложек
// канала. mode='admin' — все ожидающие с действиями «Опубликовать» / по времени /
// «Отклонить»; mode='author' — свои предложки с бейджем статуса (на рассмотрении /
// одобрено / отклонено). Список живёт в suggestedPostsStore, live — realtimeBridge.
import type { LangPackKey } from '@/lang'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import { SentTime } from '../shared/ui/dateNodes'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import RichText from './RichText'
import SchedulePopup from './SchedulePopup'
import { useSuggestedPosts } from '../core/hooks/useSuggestedPosts'
import type { SuggestedPost, SuggestedPostStatus } from '../core/models'
import { useT } from '../i18n'
import s from './SuggestedPostsView.module.scss'

const statusKey: Record<SuggestedPostStatus, LangPackKey> = {
  pending: 'SuggestedPosts.Status.OnReview',
  approved: 'SuggestedPosts.Status.Approved',
  rejected: 'SuggestedPosts.Status.Rejected',
}

export default function SuggestedPostsView({ chatId, mode, onClose }: {
  chatId: number
  mode: 'admin' | 'author'
  onClose: () => void
}) {
  const t = useT()
  const { posts, approve, reject } = useSuggestedPosts(chatId)
  // Кому назначаем время публикации при одобрении (id поста) — открывает пикер.
  const [scheduleFor, setScheduleFor] = useState<number | null>(null)

  const list: SuggestedPost[] = (posts ?? []).filter((p) => (mode === 'admin' ? p.status === 'pending' : true))

  return createPortal(
    <div className={s.overlay} onClick={onClose}>
      <div className={s.card} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className={s.header}>
          <Text size={17} weight={600} color="var(--primary-text-color)" style={{ flex: 1 }}>
            {t('SuggestedPosts.Title')}
          </Text>
          <IconButton onClick={onClose} color="var(--secondary-text-color)" aria-label={t('Close')}>
            <TgIcon name="close" size={22} />
          </IconButton>
        </div>
        <div className={s.list}>
          {posts != null && list.length === 0 && (
            <Text size={14.5} color="var(--secondary-text-color)" style={{ padding: '2rem 1rem', textAlign: 'center', display: 'block' }}>
              {t('SuggestedPosts.Empty')}
            </Text>
          )}
          {list.map((p) => (
            <div key={p.id} className={s.row}>
              <div className={s.bubble}>
                <div className={s.bubbleHead}>
                  {mode === 'admin' && p.authorName && (
                    <Text size={12.5} color="var(--primary-color)" weight={600}>{p.authorName}</Text>
                  )}
                  {mode === 'author' && (
                    <Text size={12.5} weight={600} color={p.status === 'rejected' ? '#ff595a' : 'var(--primary-color)'}>
                      {t(statusKey[p.status])}
                    </Text>
                  )}
                  {p.publishAt != null && (
                    <Text size={12} color="var(--secondary-text-color)">
                      {/* «Сегодня в 14:30» узлом — как у оригинала в поле времени
                          публикации предложки (`chat/suggestPostPopup/publishTimeField.tsx:51`,
                          `formatFullSentTime`). Прежняя склейка `toLocaleDateString(lang)`
                          с руками собранным «ЧЧ:ММ» не уважала настройку 12/24 часа. */}
                      <TgIcon name="schedule" size={12} /> <SentTime timestamp={Math.floor(p.publishAt / 1000)} />
                    </Text>
                  )}
                </div>
                <Text size={15} color="var(--primary-text-color)" style={{ wordBreak: 'break-word' }}>
                  <RichText text={p.text} entities={p.entities} linkColor="var(--link-color)" />
                </Text>
              </div>
              {mode === 'admin' && p.status === 'pending' && (
                <div className={s.actions}>
                  <IconButton size="small" onClick={() => { void approve(p.id) }} title={t('SuggestedPosts.Publish')} aria-label={t('SuggestedPosts.Publish')}>
                    <TgIcon name="check" size={18} color="var(--primary-color)" />
                  </IconButton>
                  <IconButton size="small" onClick={() => setScheduleFor(p.id)} title={t('SuggestedPosts.Schedule')} aria-label={t('SuggestedPosts.Schedule')}>
                    <TgIcon name="schedule" size={18} color="var(--primary-color)" />
                  </IconButton>
                  <IconButton size="small" onClick={() => { void reject(p.id) }} title={t('SuggestedPosts.Reject')} aria-label={t('SuggestedPosts.Reject')}>
                    <TgIcon name="close" size={18} color="#ff595a" />
                  </IconButton>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

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
