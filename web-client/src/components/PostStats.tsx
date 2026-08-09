import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import Emoji from './emoji/Emoji'
import { useT } from '../i18n'
import { usePostStats } from '../core/hooks/usePostStats'
import StatChart from './StatChart'
import s from './UserInfoPanel.module.scss'

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
    <div className={`${s.rights} ${s.slideIn}`}>
      <div className={s.rightsHeader}>
        <IconButton onClick={onBack} color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text noWrap size={19} weight={600} color="var(--primary-text-color)" style={{ flex: 1 }}>
          {t('Post statistics')}
        </Text>
      </div>

      <div className={s.body}>
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
            <div className={s.section} style={{ marginTop: 8 }}>
              <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionTitle}>
                {t('Overview')}
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <OverviewCard value={nf.format(stats.views)} label={t('Views')} />
                <OverviewCard value={nf.format(stats.forwards)} label={t('Forwards')} />
                <OverviewCard value={nf.format(stats.reactionsTotal)} label={t('Reactions')} />
              </div>
            </div>

            {stats.reactions.length > 0 && (
              <div className={s.section}>
                <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionTitle}>
                  {t('Reactions')}
                </Text>
                <div className={s.cardPlain}>
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
            )}

            {stats.viewsByDay.length > 0 && (
              <div className={s.section}>
                <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionTitle}>
                  {t('Views by day')}
                </Text>
                <div className={s.cardPlain} style={{ padding: '12px 12px 8px' }}>
                  <StatChart points={stats.viewsByDay} variant="line" color="var(--green-color, #4dcd5e)" />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
