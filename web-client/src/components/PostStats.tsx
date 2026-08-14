import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import Emoji from './emoji/Emoji'
import { useT } from '../i18n'
import { usePostStats } from '../core/hooks/usePostStats'
import StatChart from './StatChart'

// Экран «Статистика поста» канала (аналог tweb messageStatistics). Слайд-ин
// сабвью в стиле ChannelStats: шапка + карточки Overview + разбивка реакций +
// график просмотров по дням. Данные — реальные, ряды считает бэкенд.

const nf = new Intl.NumberFormat(undefined)

function OverviewCard({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        flex: '1 1 40%',
        minWidth: 0,
        padding: '10px 12px',
        borderRadius: 12,
        background: 'var(--surface-color)',
      }}
    >
      <Text size={19} weight={600} color="var(--primary-color)">{value}</Text>
      <Text noWrap size={13} color="var(--secondary-text-color)">{label}</Text>
    </div>
  )
}

export default function PostStats({
  chatId,
  msgId,
  onBack,
}: {
  chatId: number
  msgId: number
  onBack: () => void
}) {
  const t = useT()
  const { stats, loading, error } = usePostStats(chatId, msgId)

  return (
    <div className="tabs-tab sidebar-slider-item scrollable-y-bordered statistics-container active">
      <div className="sidebar-header">
        <button type="button" className="btn-icon sidebar-close-button" onClick={onBack} aria-label={t('Back')}>
          <TgIcon name="back" />
        </button>
        <div className="sidebar-header__title">{t('Post statistics')}</div>
      </div>

      <div className="sidebar-content">
      <div className="scrollable scrollable-y">
        {loading && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Text size={15} color="var(--secondary-text-color)">{t('Loading statistics…')}</Text>
          </div>
        )}
        {error && !loading && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Text size={15} color="var(--secondary-text-color)">{t('Statistics are not available.')}</Text>
          </div>
        )}

        {stats && !loading && (
          <>
            <div className="sidebar-left-section-container">
              <div className="sidebar-left-section">
                <div className="sidebar-left-section-name">{t('Overview')}</div>
                <div className="statistics-overview">
                  <OverviewCard value={nf.format(stats.views)} label={t('Views')} />
                  <OverviewCard value={nf.format(stats.forwards)} label={t('Forwards')} />
                  <OverviewCard value={nf.format(stats.reactionsTotal)} label={t('Reactions')} />
                </div>
              </div>
            </div>

            {stats.reactions.length > 0 && (
              <div className="sidebar-left-section-container">
                <div className="sidebar-left-section">
                  <div className="sidebar-left-section-name">{t('Reactions')}</div>
                  <div className="sidebar-left-section-content">
                  {stats.reactions.map((r) => (
                    <div
                      key={r.emoji}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px' }}
                    >
                      <Emoji e={r.emoji} size={22} />
                      <div style={{ flex: 1 }} />
                      <Text size={15} color="var(--secondary-text-color)" style={{ flexShrink: 0 }}>
                        {nf.format(r.count)}
                      </Text>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            )}

            {stats.viewsByDay.length > 0 && (
              <div className="sidebar-left-section-container">
                <div className="sidebar-left-section">
                  <div className="sidebar-left-section-name">{t('Views by day')}</div>
                  <div className="sidebar-left-section-content">
                  <StatChart points={stats.viewsByDay} variant="line" color="var(--green-color, #4dcd5e)" />
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
