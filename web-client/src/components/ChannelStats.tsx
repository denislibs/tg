import { motion } from 'framer-motion'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { slideInRight } from '../motion'
import { useT } from '../i18n'
import { useChannelStats } from '../core/hooks/useChannelStats'
import StatChart from './StatChart'
import s from './UserInfoPanel.module.scss'

// Панель «Статистика» канала/супергруппы (аналог tweb sidebarRight/tabs/statistics).
// Слайд-ин сабвью в стиле RightsEditor: шапка + карточки Overview + графики +
// топ-посты. Данные — реальные, ряды считает бэкенд.

// nf — компактный разделитель тысяч (1 234).
const nf = new Intl.NumberFormat(undefined)

function OverviewCard({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        flex: '1 1 40%',
        minWidth: 0,
        padding: '10px 12px',
        borderRadius: 12,
        background: 'var(--tg-sidebarBg)',
      }}
    >
      <Text size={19} weight={600} color="var(--tg-accent)">{value}</Text>
      <Text noWrap size={13} color="var(--tg-textSecondary)">{label}</Text>
    </div>
  )
}

function ChartSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className={s.section}>
      <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
        {title}
      </Text>
      <div className={s.cardPlain} style={{ padding: '12px 12px 8px' }}>
        {children}
      </div>
    </div>
  )
}

export default function ChannelStats({
  chatId,
  isChannel,
  onBack,
}: {
  chatId: number
  isChannel: boolean
  onBack: () => void
}) {
  const t = useT()
  const { stats, loading, error } = useChannelStats(chatId)

  const notifPct =
    stats && stats.summary.members > 0
      ? Math.round((stats.summary.notificationsOn / stats.summary.members) * 100)
      : 0

  return (
    <motion.div variants={slideInRight} initial="initial" animate="animate" exit="exit" className={s.rights}>
      <div className={s.rightsHeader}>
        <IconButton onClick={onBack} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text noWrap size={19} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
          {t('Statistics')}
        </Text>
      </div>

      <div className={s.body}>
        {loading && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Text size={15} color="var(--tg-textSecondary)">{t('Loading statistics…')}</Text>
          </div>
        )}
        {error && !loading && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Text size={15} color="var(--tg-textSecondary)">{t('Statistics are not available.')}</Text>
          </div>
        )}

        {stats && !loading && (
          <>
            {/* Overview — карточки-числа */}
            <div className={s.section} style={{ marginTop: 8 }}>
              <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                {t('Overview')}
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <OverviewCard value={nf.format(stats.summary.members)} label={isChannel ? t('Subscribers') : t('Members')} />
                <OverviewCard value={nf.format(stats.summary.avgReach)} label={t('Views per post')} />
                <OverviewCard value={nf.format(stats.summary.totalViews)} label={t('Total views')} />
                <OverviewCard value={nf.format(stats.summary.postsCount)} label={t('Posts')} />
                <OverviewCard value={`${notifPct}%`} label={t('Notifications')} />
              </div>
            </div>

            {stats.membersGrowth.length > 0 && (
              <ChartSection title={isChannel ? t('Subscriber growth') : t('Member growth')}>
                <StatChart points={stats.membersGrowth} variant="line" />
              </ChartSection>
            )}

            {stats.viewsByDay.length > 0 && (
              <ChartSection title={t('Views by day')}>
                <StatChart points={stats.viewsByDay} variant="line" color="var(--tg-green, #4dcd5e)" />
              </ChartSection>
            )}

            {stats.postsByDay.length > 0 && (
              <ChartSection title={t('Posts by day')}>
                <StatChart points={stats.postsByDay} variant="bar" />
              </ChartSection>
            )}

            {stats.topPosts.length > 0 && (
              <div className={s.section}>
                <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionTitle}>
                  {t('Top posts')}
                </Text>
                <div className={s.cardPlain}>
                  {stats.topPosts.map((p) => (
                    <div
                      key={p.msgId}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text noWrap size={15} color="var(--tg-textPrimary)">
                          {p.text.trim() || t('Media post')}
                        </Text>
                        <Text noWrap size={13} color="var(--tg-textSecondary)">
                          {new Date(p.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                      </div>
                      <Text size={14} color="var(--tg-textSecondary)" style={{ flexShrink: 0 }}>
                        {nf.format(p.views)} 👁
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}
