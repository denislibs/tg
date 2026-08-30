import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import { useChannelStats } from '../core/hooks/useChannelStats'
import StatChart from './StatChart'

// Панель «Статистика» канала/супергруппы (аналог tweb sidebarRight/tabs/statistics).
// Слайд-ин сабвью в стиле RightsEditor: шапка + карточки Overview + графики +
// топ-посты. Данные — реальные, ряды считает бэкенд.

// nf — компактный разделитель тысяч (1 234).
const nf = new Intl.NumberFormat(undefined)

// Карточка сводки — `statistics-overview-item` из tweb (`_rightSidebar.scss`:
// значение и подпись под ним, без своей рамки: сетку рисует контейнер).
function OverviewCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="statistics-overview-item">
      <div className="statistics-overview-item-value">{value}</div>
      <div className="statistics-overview-item-value-description">{label}</div>
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
    <div className="sidebar-left-section-container">
      <div className="sidebar-left-section">
        <div className="sidebar-left-section-name">{title}</div>
        <div className="sidebar-left-section-content">
          {children}
        </div>
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
    <div className="tabs-tab sidebar-slider-item scrollable-y-bordered statistics-container active">
      <div className="sidebar-header">
        <button type="button" className="btn-icon sidebar-close-button" onClick={onBack} aria-label={t('Common.Back')}>
          <TgIcon name="back" />
        </button>
        <div className="sidebar-header__title">{t('Statistics')}</div>
      </div>

      <div className="sidebar-content">
      <div className="scrollable scrollable-y">
        {loading && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Text size={15} color="var(--secondary-text-color)">{t('Statistics.Loading')}</Text>
          </div>
        )}
        {error && !loading && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Text size={15} color="var(--secondary-text-color)">{t('Statistics.Unavailable')}</Text>
          </div>
        )}

        {stats && !loading && (
          <>
            {/* Overview — карточки-числа */}
            <div className="sidebar-left-section-container">
              <div className="sidebar-left-section">
                <div className="sidebar-left-section-name">{t('StatisticOverview')}</div>
                {/* Сводка — вендорная сетка `.statistics-overview`
                    (`_rightSidebar.scss`), карточки в ней — `-item`. */}
                <div className="statistics-overview">
                  <OverviewCard value={nf.format(stats.summary.members)} label={isChannel ? t('PeerInfo.Subscribers') : t('PeerMedia.Members')} />
                  <OverviewCard value={nf.format(stats.summary.avgReach)} label={t('ViewsPerPost')} />
                  <OverviewCard value={nf.format(stats.summary.totalViews)} label={t('Statistics.TotalViews')} />
                  <OverviewCard value={nf.format(stats.summary.postsCount)} label={t('PostsSearch.TabName')} />
                  <OverviewCard value={`${notifPct}%`} label={t('Notifications')} />
                </div>
              </div>
            </div>

            {stats.membersGrowth.length > 0 && (
              <ChartSection title={isChannel ? t('Statistics.SubscriberGrowth') : t('Statistics.MemberGrowth')}>
                <StatChart points={stats.membersGrowth} variant="line" />
              </ChartSection>
            )}

            {stats.viewsByDay.length > 0 && (
              <ChartSection title={t('Statistics.ViewsByDay')}>
                <StatChart points={stats.viewsByDay} variant="line" color="var(--green-color, #4dcd5e)" />
              </ChartSection>
            )}

            {stats.postsByDay.length > 0 && (
              <ChartSection title={t('Statistics.PostsByDay')}>
                <StatChart points={stats.postsByDay} variant="bar" />
              </ChartSection>
            )}

            {stats.topPosts.length > 0 && (
              <div className="sidebar-left-section-container">
                <div className="sidebar-left-section">
                  <div className="sidebar-left-section-name">{t('Statistics.TopPosts')}</div>
                  <div className="sidebar-left-section-content">
                  {stats.topPosts.map((p) => (
                    <div
                      key={p.msgId}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text noWrap size={15} color="var(--primary-text-color)">
                          {p.text.trim() || t('Statistics.MediaPost')}
                        </Text>
                        <Text noWrap size={13} color="var(--secondary-text-color)">
                          {new Date(p.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                      </div>
                      <Text size={14} color="var(--secondary-text-color)" style={{ flexShrink: 0 }}>
                        {nf.format(p.views)} 👁
                      </Text>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  )
}
